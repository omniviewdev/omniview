package gateway

import (
	"context"
	"sync"
	"time"
)

// perMessageOverhead is what a queued message costs against the byte bound on
// top of its payload: the slice header, the timestamp and the allocator's own
// overhead. Charging it makes many small messages cost what they cost in
// memory, so the byte bound alone bounds the queue and no message count is
// needed (a count would cut off a page that keeps up with a burst of small
// events, or let a large number of tiny ones through).
const perMessageOverhead = 128

// tunnelQueue holds the events one tunnel still has to send to its page. The
// gateway reads the host's events socket continuously and puts every message
// that passes the filter here, so a page that reads slowly never slows the
// host down: the host buffers events for each socket without a bound, and a
// gateway that stopped reading it would make the host's memory grow.
//
// The queue is bounded in bytes and in age. A push that would pass either
// bound fails, and the caller cuts the page off; it does not drop the message,
// because a page that silently misses events shows stale state. An empty queue
// takes one message of any size: the filter has already admitted it, and a
// message the page has not been given a chance to read is not the page's
// fault (a bound smaller than the largest admitted event would otherwise cut
// every page off for the same broadcast).
type tunnelQueue struct {
	maxBytes int
	maxAge   time.Duration

	mu     sync.Mutex
	items  []queuedMessage
	head   int
	bytes  int
	closed bool
	// wake holds at most one token, left by a push for a waiting pop.
	wake chan struct{}
}

type queuedMessage struct {
	payload []byte
	at      time.Time
}

func newTunnelQueue(maxBytes int, maxAge time.Duration) *tunnelQueue {
	return &tunnelQueue{
		maxBytes: maxBytes, maxAge: maxAge,
		mu: sync.Mutex{}, items: nil, head: 0, bytes: 0, closed: false, wake: make(chan struct{}, 1),
	}
}

// push queues a message. It reports false, and queues nothing, when the queue
// is closed, or when it is not empty and the message would take it past its
// byte bound or the oldest queued message has waited longer than the age bound.
func (q *tunnelQueue) push(payload []byte, now time.Time) bool {
	cost := len(payload) + perMessageOverhead
	q.mu.Lock()
	if q.closed {
		q.mu.Unlock()
		return false
	}
	if q.head < len(q.items) && (q.bytes+cost > q.maxBytes || now.Sub(q.items[q.head].at) > q.maxAge) {
		q.mu.Unlock()
		return false
	}
	q.items = append(q.items, queuedMessage{payload: payload, at: now})
	q.bytes += cost
	q.mu.Unlock()
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
			q.bytes -= len(item.payload) + perMessageOverhead
			if q.head == len(q.items) {
				q.items, q.head = q.items[:0], 0
			} else if q.head > len(q.items)/2 {
				// Move what is left to the front and clear the slots it
				// vacated, which still hold the payloads they were copied from.
				n := copy(q.items, q.items[q.head:])
				clear(q.items[n:])
				q.items, q.head = q.items[:n], 0
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
