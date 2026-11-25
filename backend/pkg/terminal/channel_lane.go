//go:build !windows

package terminal

import "sync"

// THE LANE OF A STREAM'S INPUT (docs/ui-next/terminal-channel-protocol.md section 8).
//
// The stream's reader takes frames from the transport and does nothing that waits for the terminal. A frame that goes to the terminal's
// queue (input, resize) is put on the stream's lane, which one worker takes in order and admits to the queue,
// waiting for room when the queue is full (a program that does not read its terminal keeps its bytes in it). A frame that is a
// control (close, detach, ack, a violation) is acted on by the reader at once, whatever the lane waits for: a close that arrives while a
// write is blocked ends the terminal, and the kill wakes the write. Order is the lane's and then the queue's: what the stream sent
// is admitted in the order it sent it, and applied in that order.
//
// The lane is bounded: a stream that has more than laneBytes of input waiting on it, for a terminal that does not read, is closed (the
// page sends again from the input_applied of its next ready), which lets the terminal go and starts its lease.

// laneBytes is how much input may wait on one stream's lane for room in the terminal's queue.
const laneBytes = 8 << 20

// laneItem is one frame on the lane: an operation for the queue. (An acknowledgement is not on the lane: it is acted on as it is read,
// so that a write that blocks does not freeze the output's flow control.)
type laneItem struct{ o *op }

type inputLane struct {
	mu    sync.Mutex
	items []laneItem
	bytes int
	// admitting is set while the worker has taken an item and has not yet admitted it; waitingRoom while it waits for room in the queue.
	admitting, waitingRoom bool
	closed                 bool
	wake                   chan struct{}
	// changed is closed, and replaced, whenever the lane's state changes: settle waits on it.
	changed chan struct{}
	done    chan struct{}
}

func newInputLane() *inputLane {
	return &inputLane{
		mu: sync.Mutex{}, items: nil, bytes: 0, admitting: false, waitingRoom: false, closed: false,
		wake: make(chan struct{}, 1), changed: make(chan struct{}), done: make(chan struct{}),
	}
}

func (l *inputLane) notifyLocked() {
	close(l.changed)
	l.changed = make(chan struct{})
}

// push puts a frame on the lane, and says false when the lane holds too much already.
func (l *inputLane) push(it laneItem) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	size := len(it.o.data)
	if l.bytes+size > laneBytes {
		return false
	}
	l.items = append(l.items, it)
	l.bytes += size
	l.notifyLocked()
	select {
	case l.wake <- struct{}{}:
	default:
	}
	return true
}

// setWaitingRoom says the worker waits (or has stopped waiting) for room in the terminal's queue.
func (l *inputLane) setWaitingRoom(waiting bool) {
	l.mu.Lock()
	l.waitingRoom = waiting
	l.notifyLocked()
	l.mu.Unlock()
}

// close says nothing more will be put on the lane: the worker ends when it has taken what is there.
func (l *inputLane) close() {
	l.mu.Lock()
	l.closed = true
	l.notifyLocked()
	l.mu.Unlock()
	select {
	case l.wake <- struct{}{}:
	default:
	}
}

// settle waits until the worker has admitted everything put on the lane, or waits for room that only the terminal can make: a page that
// leaves with a detach has the input the host could take in taken in, and a lane that waits for a terminal that does not read does
// not hold the detach back.
func (l *inputLane) settle() {
	for {
		l.mu.Lock()
		if (len(l.items) == 0 && !l.admitting) || l.waitingRoom {
			l.mu.Unlock()
			return
		}
		changed := l.changed
		l.mu.Unlock()
		<-changed
	}
}

// run is the lane's worker: it takes the items in order and hands them to the terminal's queue. It ends when the lane is closed and
// empty.
func (m *Manager) runLane(s *session, c *channelConn) {
	l := c.lane
	defer close(l.done)
	for {
		l.mu.Lock()
		for len(l.items) == 0 {
			if l.closed {
				l.mu.Unlock()
				return
			}
			l.mu.Unlock()
			<-l.wake
			l.mu.Lock()
		}
		it := l.items[0]
		l.items = l.items[1:]
		l.bytes -= len(it.o.data)
		l.admitting = true
		l.notifyLocked()
		l.mu.Unlock()

		s.admitFrom(c, it.o)
		l.mu.Lock()
		l.admitting = false
		l.notifyLocked()
		l.mu.Unlock()
	}
}
