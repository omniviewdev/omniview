package terminal

import (
	"sync"
	"time"
)

// flowControl is the credit that paces one terminal, and it is the only pacing there is: a shell that
// writes faster than its client takes the output is held in its own write (the kernel's pty buffer is the
// only buffer left), so the host never has more than a bounded amount of output delivered and not
// credited. That bounds what the terminal manager hands on, not what the transport keeps after the point
// where it credits: docs/ui-next/status/T1-go.md, 2.8.6, has the measured cases.
//
// The host counts the bytes it delivered and nobody has credited. At FlowHighBytes it stops reading the
// pty; it reads again once the count is down to FlowLowBytes. Credit comes from one source at a time:
//
//   - The transport (delivered). The sink says when the transport took an event on its way to the client:
//     for Wails' server mode, when the worker that writes the client's socket serializes it, which it does
//     one event at a time and only as fast as the socket drains. A client that never acknowledges
//     anything, and that reads, is never held up; one that stops reading stops the credit.
//   - The client (ack). From its FIRST acknowledgement on, only the client's acknowledgements credit: it
//     reports what it parsed, which is stronger than what its socket took, and a hidden page that stops
//     acknowledging pauses the shell for as long as it likes.
//
// A pause on transport credit has a watchdog, because that credit is the host's inference about a
// transport it does not own, and an inference can fail in the one way that matters: a transport that
// serializes where the host does not look would never credit, and every terminal would freeze at the high
// mark. When no credit has come for stall, the watchdog gives a step (FlowStepBytes), and it gives at most
// FlowStallCeilingBytes in all until real credit comes again, so what a client that really has stalled has
// not been credited for is at most the high mark plus the ceiling, and a terminal whose credit does not
// come trickles instead of freezing, with a warning in the log. The watchdog only pauses the read: it
// drops nothing.
//
// reset forgets the debt (an attach hands the client the ring, so what was in flight before is moot), and
// release ends the pacing for good (the session is closing and the shell must be read to finish exiting).
type flowControl struct {
	mu       sync.Mutex
	unacked  int
	explicit bool
	released bool
	paused   bool
	// held pauses the reader whatever the credit says, for as long as nobody is attached: the shell is held in
	// its own write, the host reads and buffers nothing, and no credit that comes (or that the watchdog gives)
	// lets it go. restart ends it.
	held bool
	// stepped is what the watchdog has given since real credit last came.
	stepped int
	stall   time.Duration
	onStep  func(stepped int)
	wake    chan struct{}
}

// newFlowControl makes the credit of one session. stall is how long a pause waits for credit before the
// watchdog steps (zero: never); onStep is told, with the total stepped so far, each time it does.
func newFlowControl(stall time.Duration, onStep func(stepped int)) *flowControl {
	return &flowControl{
		mu: sync.Mutex{}, unacked: 0, explicit: false, released: false, paused: false, held: false, stepped: 0,
		stall: stall, onStep: onStep, wake: make(chan struct{}, 1),
	}
}

// sent counts n bytes about to be delivered. It is called BEFORE the delivery, so credit can never arrive
// for bytes that were not counted yet.
func (f *flowControl) sent(n int) {
	f.mu.Lock()
	f.unacked += n
	f.mu.Unlock()
}

// delivered credits n bytes the transport took, unless the client has taken over the credit.
func (f *flowControl) delivered(n int) {
	f.mu.Lock()
	if f.explicit {
		f.mu.Unlock()
		return
	}
	f.stepped = 0
	f.credit(n)
}

// ack credits n bytes the client took in. The first call makes the client's acknowledgements the only credit.
func (f *flowControl) ack(n int) {
	f.mu.Lock()
	f.explicit = true
	f.stepped = 0
	f.credit(n)
}

// credit takes n off the debt and wakes the reader if that frees it. It is called with f.mu held and
// unlocks it.
func (f *flowControl) credit(n int) {
	f.unacked = max(0, f.unacked-n)
	resume := f.paused && !f.held && f.unacked <= FlowLowBytes
	f.mu.Unlock()
	if resume {
		f.signal()
	}
}

// reset forgets the debt: the client starts from the ring it was handed.
func (f *flowControl) reset() {
	f.mu.Lock()
	f.unacked = 0
	f.stepped = 0
	resume := f.paused
	f.mu.Unlock()
	if resume {
		f.signal()
	}
}

// hold pauses the reader until restart or release, whatever credit comes: the client is gone.
func (f *flowControl) hold() {
	f.mu.Lock()
	f.held = true
	f.mu.Unlock()
}

// restart is the credit of a client that attaches: the hold ends and the debt is forgotten (the client starts
// from the replay it was handed, and does not acknowledge it). Who gives credit is not forgotten: a terminal
// whose client acknowledged keeps on being paced by acknowledgements alone, as it was, so that a page that
// dies right after it attached, before its first acknowledgement, still leaves the host at the high mark and
// the replay ring with everything the next page lacks.
func (f *flowControl) restart() {
	f.mu.Lock()
	f.held = false
	f.unacked = 0
	f.stepped = 0
	f.mu.Unlock()
	f.signal()
}

// release ends the pacing for good. A session that is closing has to be read: on macOS a process cannot
// finish exiting while the pty it holds has output that nobody reads, and the host closes the master only
// after the shell has exited.
func (f *flowControl) release() {
	f.mu.Lock()
	f.released = true
	f.mu.Unlock()
	f.signal()
}

func (f *flowControl) signal() {
	select {
	case f.wake <- struct{}{}:
	default:
	}
}

// step is the watchdog: no credit has come for a whole stall, so it gives FlowStepBytes of it, up to the
// ceiling. A client that acknowledges is never stepped: its pause is its own choice.
func (f *flowControl) step() {
	f.mu.Lock()
	if f.explicit || f.released || f.held || f.stepped >= FlowStallCeilingBytes {
		f.mu.Unlock()
		return
	}
	grant := min(FlowStepBytes, FlowStallCeilingBytes-f.stepped)
	f.stepped += grant
	stepped := f.stepped
	f.credit(grant)
	if f.onStep != nil {
		f.onStep(stepped)
	}
}

// check decides, under the lock, whether the reader has to wait. It reports whether the pacing was released,
// whether the reader is paused for credit, and whether the watchdog watches this pause (a pause on the
// transport's credit, not on a client's acknowledgements).
func (f *flowControl) check() (bool, bool, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.released {
		f.paused = false
		return true, false, false
	}
	if f.held {
		f.paused = true
		return false, true, false
	}
	if !f.paused && f.unacked >= FlowHighBytes {
		f.paused = true
	}
	if f.paused && f.unacked <= FlowLowBytes {
		f.paused = false
	}
	return false, f.paused, !f.explicit && f.stall > 0
}

// sleep waits for credit, for a release, or for the stall to pass (when the watchdog watches), and steps when
// it passes. It reports false when stop was closed: the reader has nothing more to wait for.
func (f *flowControl) sleep(stop <-chan struct{}, watch bool) bool {
	var expired <-chan time.Time
	if watch {
		timer := time.NewTimer(f.stall)
		defer timer.Stop()
		expired = timer.C
	}
	select {
	case <-f.wake:
	case <-stop:
		return false
	case <-expired:
		f.step()
	}
	return true
}

// wait blocks the reader while the output it delivered is uncredited past the high mark, until credit has
// brought it down to the low mark, the pacing is released, or stop is closed (the shell has exited: what
// is left in the pty is bounded by the kernel and is delivered without credit).
func (f *flowControl) wait(stop <-chan struct{}) {
	for {
		released, paused, watch := f.check()
		if released || !paused || !f.sleep(stop, watch) {
			return
		}
	}
}
