package gateway

import (
	"context"
	"sync"
	"time"
)

// tunnelQueue holds the events one tunnel still has to send to its page. The
// gateway reads the host's events socket continuously and puts every message
// that passes the filter here, so a page that reads slowly never slows the
// host down: the host buffers events for each socket without a bound, and a
// gateway that stopped reading it would make the host's memory grow.
//
// The queue is bounded in bytes, in messages and in age. A push that would
// pass any bound fails, and the caller cuts the page off; it does not drop the
// message, because a page that silently misses events shows stale state.
type tunnelQueue struct {
	maxBytes    int
	maxMessages int
	maxAge      time.Duration

	mu     sync.Mutex
	items  []queuedMessage
	head   int
	bytes  int
	closed bool
	// wake holds one token while the queue may have something to pop or has
	// been closed.
	wake chan struct{}
}

type queuedMessage struct {
	payload []byte
	at      time.Time
}

func newTunnelQueue(maxBytes, maxMessages int, maxAge time.Duration) *tunnelQueue {
	return &tunnelQueue{
		maxBytes:    maxBytes,
		maxMessages: maxMessages,
		maxAge:      maxAge,
		mu:          sync.Mutex{},
		items:       nil,
		head:        0,
		bytes:       0,
		closed:      false,
		wake:        make(chan struct{}, 1),
	}
}

// push queues a message. It reports false, and queues nothing, when the queue
// is closed, when the message would take it past its byte or message bound,
// or when the oldest queued message has waited longer than the age bound.
func (q *tunnelQueue) push(payload []byte, now time.Time) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return false
	}
	queued := len(q.items) - q.head
	if queued >= q.maxMessages || q.bytes+len(payload) > q.maxBytes {
		return false
	}
	if queued > 0 && now.Sub(q.items[q.head].at) > q.maxAge {
		return false
	}
	q.items = append(q.items, queuedMessage{payload: payload, at: now})
	q.bytes += len(payload)
	q.signal()
	return true
}

// pop waits for the oldest message and returns it with the time it was
// queued. It reports false when the queue is closed and empty or ctx ends
// first.
func (q *tunnelQueue) pop(ctx context.Context) ([]byte, time.Time, bool) {
	for {
		q.mu.Lock()
		if q.head < len(q.items) {
			item := q.items[q.head]
			q.items[q.head] = queuedMessage{payload: nil, at: time.Time{}}
			q.head++
			q.bytes -= len(item.payload)
			if q.head == len(q.items) {
				q.items, q.head = q.items[:0], 0
			} else if q.head > len(q.items)/2 {
				q.items = append(q.items[:0], q.items[q.head:]...)
				q.head = 0
			}
			more := q.head < len(q.items)
			q.mu.Unlock()
			if more {
				q.signal()
			}
			return item.payload, item.at, true
		}
		closed := q.closed
		q.mu.Unlock()
		if closed {
			return nil, time.Time{}, false
		}
		select {
		case <-q.wake:
		case <-ctx.Done():
			return nil, time.Time{}, false
		}
	}
}

// close ends the queue: pushes fail and pops return what is left, then false.
// It drops what is queued, which the tunnel will not send.
func (q *tunnelQueue) close() {
	q.mu.Lock()
	q.closed = true
	q.items, q.head, q.bytes = nil, 0, 0
	q.mu.Unlock()
	q.signal()
}

// signal leaves one wake token for a waiting pop.
func (q *tunnelQueue) signal() {
	select {
	case q.wake <- struct{}{}:
	default:
	}
}

// queued reports the number of messages and the number of bytes waiting.
func (q *tunnelQueue) queued() (int, int) {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.items) - q.head, q.bytes
}
