package terminal

import (
	"sync"
	"time"
)

// device is what a session's input is applied to: the master side of its pty.
type device interface {
	// Write sends bytes to the shell. It may block for as long as the shell does not read.
	Write(p []byte) (int, error)
	// Resize sets the size of the terminal.
	Resize(rows, cols uint16) error
}

type opKind int

const (
	opWrite opKind = iota
	opResize
)

// op is one input operation: what a caller asked for and the place its answer goes.
type op struct {
	data []byte
	// seq is the caller's sequence number; zero is "not sequenced".
	seq  uint64
	rows uint16
	cols uint16
	kind opKind
	once sync.Once
	// done receives the one answer; it has room for it, so answering never blocks.
	done chan error
}

func newOp(kind opKind, seq uint64) *op {
	return &op{data: nil, seq: seq, rows: 0, cols: 0, kind: kind, once: sync.Once{}, done: make(chan error, 1)}
}

// finish answers the caller, once: whoever ends the operation first decides the answer.
func (o *op) finish(err error) { o.once.Do(func() { o.done <- err }) }

// queueLimits are the bounds of one queue.
type queueLimits struct {
	ops     int
	bytes   int
	ahead   uint64
	gapWait time.Duration
}

// inputQueue applies the writes and resizes of ONE session one at a time, in order, and holds at most
// limits.ops operations (and limits.bytes bytes) that are not applied yet. Nothing about it is shared
// with another session: a device that does not read stalls this queue and no other.
//
// Order. An operation without a sequence number is applied in the order its call reached the queue.
// An operation with one is applied in sequence order whatever the order its calls reached the queue
// in: the transport behind the calls (HTTP, an IPC channel) may run unawaited calls at the same time
// and deliver them in any order, and the number is the only thing that says the order they were sent
// in. Sequence numbers count up from 1, one for each operation, writes and resizes alike. A call that
// arrives ahead of its predecessor waits for it; if the predecessor does not come within gapWait the
// missing numbers are given up and the call goes on, and the late call, if it ever arrives, is
// refused as stale, so nothing is applied out of order and nothing is dropped without its caller
// being told.
//
// Bound. Past limits.ops pending operations, or limits.bytes pending bytes for a call that carries bytes,
// a call is refused at once with the backlog error: the operation was not applied and consumed no
// sequence number, so the caller may send it again. A call that carries no bytes (a resize) is refused
// only for the operations bound: when the bytes are full because writes wait for the resize that is
// missing, it is the one call that can release them. A call returns when its operation has been applied,
// or refused. The queue keeps its own copy of a write's bytes from the moment it takes the write in.
type inputQueue struct {
	dev   device
	limit queueLimits

	// ready holds released operations in the order they are applied. Its capacity is limits.ops and
	// no more than that many operations are ever pending, so sending to it never blocks.
	ready   chan *op
	quit    chan struct{}
	stopped chan struct{}

	mu      sync.Mutex
	err     error // set when the queue is closed: what every pending and later operation fails with
	next    uint64
	held    map[uint64]*op // sequenced operations that arrived ahead of next
	gap     *time.Timer    // runs while held is not empty
	pending int            // operations held, ready or running
	bytes   int            // their bytes
	running *op
}

func newInputQueue(dev device, limit queueLimits) *inputQueue {
	q := &inputQueue{
		dev: dev, limit: limit,
		ready: make(chan *op, limit.ops), quit: make(chan struct{}), stopped: make(chan struct{}),
		mu: sync.Mutex{}, err: nil, next: 1, held: make(map[uint64]*op), gap: nil, pending: 0, bytes: 0, running: nil,
	}
	go q.run()
	return q
}

// expects is the sequence number the queue takes next: the lowest not yet taken (a call ahead of it that waits
// has not been taken). It is 0 once the queue is closed: nothing more is taken.
func (q *inputQueue) expects() uint64 {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.err != nil {
		return 0
	}
	return q.next
}

// write applies data to the device. It returns when the write has been applied or refused.
func (q *inputQueue) write(seq uint64, data []byte) error {
	o := newOp(opWrite, seq)
	o.data = data
	return q.submit(o)
}

// resize sets the size of the terminal. It returns when the resize has been applied or refused.
func (q *inputQueue) resize(seq uint64, rows, cols uint16) error {
	o := newOp(opResize, seq)
	o.rows, o.cols = rows, cols
	return q.submit(o)
}

func (q *inputQueue) submit(o *op) error {
	if err := q.admit(o); err != nil {
		return err
	}
	return <-o.done
}

// admit decides whether the queue takes the operation, and where it goes.
func (q *inputQueue) admit(o *op) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.err != nil {
		return q.err
	}
	if q.pending >= q.limit.ops || (len(o.data) > 0 && q.bytes >= q.limit.bytes) {
		return backlogError()
	}
	switch {
	case o.seq == 0:
		q.accept(o)
	case o.seq < q.next:
		return staleError(o.seq, q.next)
	case o.seq > q.next:
		if o.seq-q.next > q.limit.ahead {
			return aheadError(o.seq, q.next)
		}
		if q.held[o.seq] != nil {
			return staleError(o.seq, q.next)
		}
		o.own()
		q.held[o.seq] = o
		q.pending++
		q.bytes += len(o.data)
		q.armGap()
	default:
		q.next++
		q.accept(o)
		q.releaseHeld()
	}
	return nil
}

// own gives the operation its own copy of the bytes of a write, once the queue has taken it in: the
// caller's slice is the caller's again when close answers the call, and the executor may still be
// reading it then.
func (o *op) own() {
	if len(o.data) > 0 {
		o.data = append([]byte(nil), o.data...)
	}
}

// accept puts an operation in line to be applied. The caller holds q.mu.
func (q *inputQueue) accept(o *op) {
	o.own()
	q.pending++
	q.bytes += len(o.data)
	q.ready <- o
}

// releaseHeld moves the held operations that now follow next into the line. The caller holds q.mu.
func (q *inputQueue) releaseHeld() {
	for h := q.held[q.next]; h != nil; h = q.held[q.next] {
		delete(q.held, q.next)
		q.next++
		q.ready <- h
	}
	q.disarmGap()
	if len(q.held) > 0 {
		q.armGap()
	}
}

func (q *inputQueue) armGap() {
	if q.gap == nil {
		q.gap = time.AfterFunc(q.limit.gapWait, q.giveUp)
	}
}

func (q *inputQueue) disarmGap() {
	if q.gap != nil {
		q.gap.Stop()
		q.gap = nil
	}
}

// giveUp is the gap timer's function: the operation the held ones wait for did not come, so the
// numbers up to the first held one are given up and the held ones go on.
func (q *inputQueue) giveUp() {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.gap = nil
	if q.err != nil || len(q.held) == 0 {
		return
	}
	lowest := uint64(0)
	for seq := range q.held {
		if lowest == 0 || seq < lowest {
			lowest = seq
		}
	}
	q.next = lowest
	q.releaseHeld()
}

// run is the queue's one executor: it applies the line's operations, one at a time.
func (q *inputQueue) run() {
	defer close(q.stopped)
	for {
		select {
		case <-q.quit:
			return
		case o := <-q.ready:
			q.mu.Lock()
			if q.err != nil {
				err := q.err
				q.mu.Unlock()
				o.finish(err)
				continue
			}
			q.running = o
			q.mu.Unlock()
			err := q.apply(o)
			q.mu.Lock()
			q.running = nil
			q.pending--
			q.bytes -= len(o.data)
			q.mu.Unlock()
			o.finish(err)
		}
	}
}

func (q *inputQueue) apply(o *op) error {
	switch o.kind {
	case opWrite:
		if len(o.data) == 0 {
			return nil
		}
		_, err := q.dev.Write(o.data)
		return err
	case opResize:
		return q.dev.Resize(o.rows, o.cols)
	}
	return nil
}

// close ends the queue: every operation that is held, waiting or running is answered with cause at
// once, and so is every later one. It does not wait for the executor, which may be inside a write the
// device has not returned from; the executor ends when that write does.
func (q *inputQueue) close(cause error) {
	q.mu.Lock()
	if q.err != nil {
		q.mu.Unlock()
		return
	}
	q.err = cause
	q.disarmGap()
	held := q.held
	q.held = nil
	running := q.running
	q.mu.Unlock()
	close(q.quit)
	for _, o := range held {
		o.finish(cause)
	}
	if running != nil {
		running.finish(cause)
	}
	for {
		select {
		case o := <-q.ready:
			o.finish(cause)
		default:
			return
		}
	}
}
