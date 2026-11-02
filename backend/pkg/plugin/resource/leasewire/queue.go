package leasewire

import (
	"errors"
	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"strconv"
	"sync"
	"time"
)

const (
	MaxFrameBytes    = 256 << 10
	MaxPendingBytes  = 1 << 20
	MaxPendingFrames = 64
	InactiveTimeout  = 30 * time.Second
)

var (
	ErrClosed        = errors.New("lease delivery closed")
	ErrOverflow      = errors.New("lease delivery overflow; reset required")
	ErrFrameTooLarge = errors.New("lease frame exceeds byte budget")
	ErrGeneration    = errors.New("invalid result generation or sequence")
	ErrDrainPending  = errors.New("drain already in flight")
)

// Queue is one consumer's delivery state. The owner must close it on window
// teardown and expire it using Expire. Returned doorbells must be targeted to
// the owning window and must not carry the frame itself.
type Queue struct {
	mu                                    sync.Mutex
	lease, generation                     string
	next                                  uint64
	items                                 [][]byte
	bytes                                 int
	control                               []byte
	complete                              []byte
	deferred                              []byte
	announced                             string
	deferredReason                        string
	doorbell, draining, closed, completed bool
	overflow                              bool
	pendingSince                          time.Time
}

func NewQueue(lease, generation string) (*Queue, error) {
	if lease == "" || generation == "" || len(lease) > 1024 || len(generation) > 1024 {
		return nil, ErrInvalid
	}
	if err := preflight(ResultDataFrame{LeaseID: lease, Generation: generation}); err != nil {
		return nil, err
	}
	return &Queue{lease: lease, generation: generation, next: 1}, nil
}
func (q *Queue) pending() bool { return q.control != nil || len(q.items) > 0 || q.complete != nil }
func (q *Queue) signal(now time.Time) bool {
	if !q.pending() {
		q.pendingSince = time.Time{}
		return false
	}
	if q.pendingSince.IsZero() {
		q.pendingSince = now
	}
	if q.doorbell || q.draining {
		return false
	}
	q.doorbell = true
	return true
}

// Publish enqueues one complete atomic frame. Overflow never discards silently:
// the caller must invoke Reset with a new host-issued generation before retrying.
func (q *Queue) Publish(f ResultDataFrame, now time.Time) (bool, error) {
	if e := preflight(f); e != nil {
		return false, e
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return false, ErrClosed
	}
	if q.overflow {
		return false, ErrOverflow
	}
	if f.LeaseID != q.lease || f.Generation != q.generation || q.next == 0 || f.Sequence != strconv.FormatUint(q.next, 10) {
		return false, ErrGeneration
	}
	if (q.next == 1) != (f.Payload.Kind == "open") {
		return false, ErrGeneration
	}
	if q.completed {
		return false, ErrClosed
	}
	b, e := f.encode()
	if e != nil {
		return false, e
	}
	if len(b) > MaxFrameBytes {
		return false, ErrFrameTooLarge
	}
	if len(q.items) >= MaxPendingFrames || q.bytes+len(b) > MaxPendingBytes {
		q.overflow = true
		q.items = nil
		q.bytes = 0
		q.complete = nil
		return false, ErrOverflow
	}
	q.items = append(q.items, b)
	q.bytes += len(b)
	q.next++
	return q.signal(now), nil
}

// Reset drops queued data and enqueues an independent control barrier.
// A second reset is coalesced behind the pending announced barrier.
func (q *Queue) Reset(next, reason string, now time.Time) (bool, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return false, ErrClosed
	}
	if next == "" || len(next) > 1024 || next == q.generation {
		return false, ErrGeneration
	}
	old := q.generation
	if q.control != nil {
		old = q.announced
		if next == old {
			return false, ErrGeneration
		}
	}
	f := ResultControlFrame{Lane: "control", LeaseID: q.lease, Payload: ResultControlPayload{Kind: "reset", Generation: &old, NextGeneration: &next, Reason: &reason}}
	if err := preflight(f); err != nil {
		return false, err
	}
	b, e := f.encode()
	if e != nil {
		return false, e
	}
	if len(b) > MaxFrameBytes {
		return false, ErrFrameTooLarge
	}
	if q.control != nil {
		// Preserve a binding-change barrier when a later reset is weaker.
		if q.deferred != nil && q.deferredReason == "bindingChanged" && reason != "bindingChanged" {
			reason = "bindingChanged"
			f.Payload.Reason = &reason
			b, e = f.encode()
			if e != nil {
				return false, e
			}
		}
		q.items = nil
		q.bytes = 0
		q.complete = nil
		q.overflow = false
		q.deferred = b
		q.deferredReason = reason
		q.generation = next
		q.next = 1
		q.completed = false
		return q.signal(now), nil
	}
	q.items = nil
	q.bytes = 0
	q.complete = nil
	q.control = b
	q.announced = next
	q.generation = next
	q.next = 1
	q.completed = false
	q.overflow = false
	return q.signal(now), nil
}

// Complete follows queued data. Closing is terminal and takes priority over
// data and reset, independently of data queue saturation.
func (q *Queue) Complete(now time.Time) (bool, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return false, ErrClosed
	}
	if q.overflow {
		return false, ErrOverflow
	}
	if q.next == 1 || q.completed {
		return false, ErrInvalid
	}
	g := q.generation
	state := "complete"
	f := ResultControlFrame{Lane: "control", LeaseID: q.lease, Payload: ResultControlPayload{Kind: "control", Generation: &g, State: &state}}
	if err := preflight(f); err != nil {
		return false, err
	}
	b, e := f.encode()
	if e != nil {
		return false, e
	}
	q.complete = b
	q.completed = true
	return q.signal(now), nil
}

// Terminate clears protected data even if an optional diagnostic cannot be
// encoded. The returned doorbell remains actionable when err is non-nil.
func (q *Queue) Terminate(reason string, failure *apperror.AppError, now time.Time) (bool, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return false, ErrClosed
	}
	if !oneOf(reason, "closed", "cancelled", "failed", "accessInvalidated") {
		return false, ErrInvalid
	}
	f := ResultControlFrame{Lane: "control", LeaseID: q.lease, Payload: ResultControlPayload{Kind: "close", Reason: &reason, Error: failure}}
	serializationErr := preflight(f)
	var b []byte
	if serializationErr == nil {
		b, serializationErr = f.encode()
	}
	if serializationErr != nil || len(b) > MaxFrameBytes {
		// A malformed optional diagnostic cannot retain protected data.
		if serializationErr == nil {
			serializationErr = ErrFrameTooLarge
		}
		f.Payload.Error = nil
		b, _ = f.encode()
	}
	q.items = nil
	q.bytes = 0
	q.complete = nil
	q.deferred = nil
	q.deferredReason = ""
	q.control = b
	q.closed = true
	return q.signal(now), serializationErr
}

// BeginDrain and EndDrain bracket exactly one transport response. The caller
// must invoke EndDrain even on failed delivery, then close the lease on loss.
func (q *Queue) BeginDrain() ([]byte, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.draining {
		return nil, ErrDrainPending
	}
	q.draining = true
	q.doorbell = false
	var b []byte
	if q.control != nil {
		b = q.control
		q.control = nil
		if q.deferred != nil {
			q.control = q.deferred
			q.announced = q.generation
			q.deferred = nil
			q.deferredReason = ""
		}
	} else if len(q.items) > 0 {
		b = q.items[0]
		q.items[0] = nil
		q.items = q.items[1:]
		q.bytes -= len(b)
	} else if q.complete != nil {
		b = q.complete
		q.complete = nil
	}
	return b, nil
}
func (q *Queue) EndDrain(now time.Time) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if !q.draining {
		return false
	}
	q.draining = false
	q.pendingSince = time.Time{}
	return q.signal(now)
}

// Expire closes and clears pending delivery after an inactive timeout.
func (q *Queue) Expire(now time.Time) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.pendingSince.IsZero() || now.Sub(q.pendingSince) < InactiveTimeout {
		return false
	}
	q.items = nil
	q.bytes = 0
	q.control = nil
	q.complete = nil
	q.deferred = nil
	q.deferredReason = ""
	q.closed = true
	q.doorbell = false
	q.pendingSince = time.Time{}
	return true
}

// Close releases delivery immediately without waiting for the consumer.
func (q *Queue) Close() {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.closed = true
	q.items = nil
	q.bytes = 0
	q.control = nil
	q.complete = nil
	q.deferred = nil
	q.deferredReason = ""
	q.doorbell = false
	q.pendingSince = time.Time{}
}
