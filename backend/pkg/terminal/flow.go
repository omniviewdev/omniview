package terminal

import "sync"

// flowControl bounds what the host has read from a shell and delivered but the caller has not yet
// acknowledged. While FlowHighBytes are unacknowledged the reader stops reading the pty, so the
// shell blocks in its own write (real backpressure: the kernel's pty buffer is the only buffer left)
// and reading resumes once the caller has acknowledged down to FlowLowBytes. Without it the only
// buffer between a fast shell and a page that is hidden or slow is the transport's own, which has no
// bound.
type flowControl struct {
	mu      sync.Mutex
	unacked int
	paused  bool
	wake    chan struct{}
}

func newFlowControl() *flowControl {
	return &flowControl{mu: sync.Mutex{}, unacked: 0, paused: false, wake: make(chan struct{}, 1)}
}

// sent counts n bytes about to be delivered. It is called BEFORE the delivery, so an acknowledgement
// can never arrive for bytes that were not counted yet.
func (f *flowControl) sent(n int) {
	f.mu.Lock()
	f.unacked += n
	f.mu.Unlock()
}

// ack counts n bytes taken in by the caller.
func (f *flowControl) ack(n int) {
	f.mu.Lock()
	f.unacked = max(0, f.unacked-n)
	resume := f.paused && f.unacked <= FlowLowBytes
	f.mu.Unlock()
	if resume {
		select {
		case f.wake <- struct{}{}:
		default:
		}
	}
}

// wait blocks the reader while the output it delivered is unacknowledged past the high mark, until the
// caller has caught up to the low mark or stop is closed (the shell has exited: what is left in the pty
// is bounded by the kernel and is delivered without credit).
func (f *flowControl) wait(stop <-chan struct{}) {
	for {
		f.mu.Lock()
		if !f.paused && f.unacked >= FlowHighBytes {
			f.paused = true
		}
		if f.paused && f.unacked <= FlowLowBytes {
			f.paused = false
		}
		paused := f.paused
		f.mu.Unlock()
		if !paused {
			return
		}
		select {
		case <-f.wake:
		case <-stop:
			return
		}
	}
}
