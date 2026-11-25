//go:build !windows

package terminal

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sync"
	"sync/atomic"
	"time"
)

// THE STREAM OF A CHANNEL TERMINAL (docs/ui-next/terminal-channel-protocol.md has the frames and the handshake).
//
// The first frame of a stream is the attach request, and nothing is read before it. The connection is the holder: while it lasts
// the terminal is its, and when it ends the terminal is detached and its lease runs. A second stream that shows the capability
// takes the terminal; the first is told and closed, and cannot type. Who holds the terminal and what a call does to it are one
// step under the terminal's lock (the idea of withHeld in #677, with the stream for the window): input is admitted to the
// terminal's queue under the lock that decides the holder, so that what was admitted before a handover is applied before what the
// new holder sends, and what is sent after it is refused.

// The frame types: the first byte of every frame. The page's are below 0x80 and the host's above.
const (
	frameAttach    byte = 0x01
	frameInput     byte = 0x02
	frameResize    byte = 0x03
	frameAck       byte = 0x04
	frameDetach    byte = 0x05
	frameReady     byte = 0x81
	frameOutput    byte = 0x82
	frameGap       byte = 0x83
	frameEnded     byte = 0x84
	frameTakenOver byte = 0x85
	frameNotFound  byte = 0x86
	// frameApplied and frameReleased are the frames of version 2; frameUnsupported is the host's refusal of any other version.
	frameApplied     byte = 0x87
	frameReleased    byte = 0x88
	frameUnsupported byte = 0x89
)

const (
	// attachVersion is the only version of the attach request the host speaks. Version 2 added the frames applied and released and
	// the field input_applied of ready; an attach of another version is answered with the unsupported frame.
	attachVersion = 2
	// maxAttachBytes bounds the first frame: a capability, a version and an offset make about a hundred bytes.
	maxAttachBytes = 1 << 10
	// outputHeaderBytes is the type and the offset that precede the bytes of an output frame.
	outputHeaderBytes = 9
	resizeBodyBytes   = 4
	ackBodyBytes      = 4
)

// attachRequest is the first frame's JSON: the version of the protocol, the capability, and the offset of the first byte the page
// does not have (absent: the page has nothing).
type attachRequest struct {
	V    int     `json:"v"`
	Cap  string  `json:"cap"`
	From *uint64 `json:"from_offset"`
}

// attachKind is what the first frame of a stream is.
type attachKind int

const (
	// attachMalformed: not a well-formed attach request that names a capability.
	attachMalformed attachKind = iota
	// attachOtherVersion: a well-formed attach request of a version the host does not speak.
	attachOtherVersion
	// attachOK: a well-formed attach request of this version.
	attachOK
)

// parseAttach reads the first frame of a stream. The version is decided from the request alone, before any capability is looked
// at (a request that states none is malformed), so that the answer to another version says nothing about whether the capability opens a terminal.
func parseAttach(frame []byte) (attachRequest, attachKind) {
	var req attachRequest
	if len(frame) < 2 || len(frame) > maxAttachBytes || frame[0] != frameAttach {
		return req, attachMalformed
	}
	if err := json.Unmarshal(frame[1:], &req); err != nil || req.Cap == "" || req.V == 0 {
		return req, attachMalformed
	}
	if req.V != attachVersion {
		return req, attachOtherVersion
	}
	return req, attachOK
}

// unsupportedFrame says which version the host speaks.
func unsupportedFrame() []byte {
	return append([]byte{frameUnsupported}, fmt.Sprintf(`{"v":%d}`, attachVersion)...)
}

// readyBody is the JSON of the ready frame: where the replay starts and ends, what was lost, the size and the modes the replay
// starts under and ends under, where the shell is and what holds it, what the host said when the terminal started (without its
// capability), how long the terminal is kept once this stream ends, and how it ended when it already had.
type readyBody struct {
	V          int           `json:"v"`
	Start      uint64        `json:"start"`
	End        uint64        `json:"end"`
	Lost       uint64        `json:"lost"`
	Size       Size          `json:"size"`
	StartSize  Size          `json:"start_size"`
	Modes      TerminalModes `json:"modes"`
	StartModes TerminalModes `json:"start_modes"`
	Cwd        Directory     `json:"cwd"`
	Busy       Foreground    `json:"busy"`
	Session    Session       `json:"session"`
	LeaseMs    int           `json:"lease_ms"`
	Ended      *End          `json:"ended,omitempty"`
	// InputApplied is the bytes of input the host has applied from this capability, across streams, plus those it has queued ahead of
	// this stream's input (section 5 of the protocol): the page resends what it sent after it. Zero for the kept end of a terminal.
	InputApplied uint64 `json:"input_applied"`
}

// readyFrame is the host's answer to a request that opens a terminal. lost is how much of what the page asked for is gone: the
// distance from its offset up to the first byte the host still has, nothing for a page that gave no offset.
func readyFrame(info Session, view *replayView, from *uint64, leaseMs int, cwd Directory, busy Foreground, ended *End, inputApplied uint64) ([]byte, error) {
	var lost uint64
	if from != nil && *from < view.start {
		lost = view.start - *from
	}
	raw, err := json.Marshal(readyBody{
		V: attachVersion, Start: view.start, End: view.end, Lost: lost, Size: view.size, StartSize: view.startSize, Modes: view.now,
		StartModes: view.startModes(), Cwd: cwd, Busy: busy, Session: info, LeaseMs: leaseMs, Ended: ended, InputApplied: inputApplied,
	})
	if err != nil {
		return nil, err
	}
	return append([]byte{frameReady}, raw...), nil
}

// outputFrame is the type, the offset of the first byte and the bytes, which it copies: the transport keeps the frame.
func outputFrame(offset uint64, parts [][]byte) []byte {
	size := outputHeaderBytes
	for _, part := range parts {
		size += len(part)
	}
	frame := make([]byte, outputHeaderBytes, size)
	frame[0] = frameOutput
	binary.BigEndian.PutUint64(frame[1:outputHeaderBytes], offset)
	for _, part := range parts {
		frame = append(frame, part...)
	}
	return frame
}

// gapFrame says the bytes from from to to were overwritten before they were sent: the next output starts at to.
func gapFrame(from, to uint64) []byte {
	frame := make([]byte, 0, 1+2*8)
	frame = append(frame, frameGap)
	frame = binary.BigEndian.AppendUint64(frame, from)
	return binary.BigEndian.AppendUint64(frame, to)
}

// appliedFrame says how many bytes of input the host has applied from the capability.
func appliedFrame(n uint64) []byte {
	return binary.BigEndian.AppendUint64([]byte{frameApplied}, n)
}

func endedFrame(end End) ([]byte, error) {
	raw, err := json.Marshal(end)
	if err != nil {
		return nil, err
	}
	return append([]byte{frameEnded}, raw...), nil
}

// ---- a stream as the manager holds it ----

// channelConn is one stream that holds, or held, a channel terminal. Its counters are atomics, because the pump reads them
// without waiting for the stream.
type channelConn struct {
	ch    Channel
	clock clock
	// sent is the offset of the next byte of output the page has not been given; the sender advances it, under the session's
	// output lock, when a Send returns. begun is the bytes of output the sender has begun to hand to the transport, counted before
	// the Send (a page can acknowledge a frame before its Send returns), sentBytes the bytes of output it was given (a gap is
	// not), acked the bytes the page said it parsed (never more than begun), lost the bytes the stream said it missed.
	sent, begun, sentBytes, acked, lost atomic.Uint64
	// ackSeen says the page acknowledged at least once: from then on it holds no more than ChannelInflightBytes unacknowledged.
	ackSeen atomic.Bool
	// began is the clock's time when the stream was made, with the clock's monotonic reading when it has one, and progressAt is the
	// time of the last progress as the nanoseconds since began: a frame the transport took, an acknowledgement, the moment the stream
	// took the terminal, or the moment output came for a sender that had none to send. A stamp made from UnixNano has no monotonic
	// reading, and a wall clock that is set back would make the last progress lie in the future.
	began      time.Time
	progressAt atomic.Int64
	// replayEnd is where the replay ended when the stream took the terminal (the end that the ready frame says): no output frame
	// begins below it and ends above it, so that the page, which writes what is below it muted, tells the replay from the live
	// output. It is set once, by claim, before the sender starts.
	replayEnd uint64
	// displaced says another stream took the terminal; stopped says this one's frames are no longer read: the sender ends.
	displaced, stopped atomic.Bool
	// released says the terminal was let go by the stream that held it while this stream watched it, and evicted that this watcher
	// was one too many: both are set once, under the session's mu, and wake the sender.
	released, evicted atomic.Bool
	// reported is the input count this stream was last told: set by claim (what its ready states), and from then on only by the
	// sender, which sends an applied frame when the host's count passes it.
	reported uint64
	// gone is closed when another stream takes the terminal: an input of this stream that waits for room in the queue looks again.
	gone     chan struct{}
	goneOnce sync.Once
	// wake wakes the sender: output, an acknowledgement, a handover, an end, a stop.
	wake chan struct{}
	// finished is closed when the sender has returned.
	finished chan struct{}
}

func newChannelConn(ch Channel, clk clock) *channelConn {
	return &channelConn{
		ch: ch, clock: clk, sent: atomic.Uint64{}, begun: atomic.Uint64{}, sentBytes: atomic.Uint64{}, acked: atomic.Uint64{}, lost: atomic.Uint64{},
		ackSeen: atomic.Bool{}, began: clk.Now(), progressAt: atomic.Int64{}, replayEnd: 0, displaced: atomic.Bool{}, stopped: atomic.Bool{},
		released: atomic.Bool{}, evicted: atomic.Bool{}, reported: 0,
		gone: make(chan struct{}), goneOnce: sync.Once{}, wake: make(chan struct{}, 1), finished: make(chan struct{}),
	}
}

func (c *channelConn) signal() {
	select {
	case c.wake <- struct{}{}:
	default:
	}
}

// progress notes that the page is alive: now, on the manager's clock.
func (c *channelConn) progress() { c.progressAt.Store(int64(c.clock.Now().Sub(c.began))) }

// lastProgress is the time of the last progress, with the monotonic reading of the clock the stream was made on.
func (c *channelConn) lastProgress() time.Time {
	return c.began.Add(time.Duration(c.progressAt.Load()))
}

// displace is what the stream that takes the terminal does to the one that held it: its sender is told, in its own time, and
// sends the frame that says so after the frame it may be parked in.
func (c *channelConn) displace() {
	c.displaced.Store(true)
	c.goneOnce.Do(func() { close(c.gone) })
	c.signal()
}

// wait blocks the sender until there is something for it to look at, and says false once the connection is gone.
func (c *channelConn) wait() bool {
	select {
	case <-c.wake:
		return true
	case <-c.ch.Done():
		return false
	}
}

// ---- serving a stream ----

// errNotClaimable says a stream cannot take a terminal: its end is decided.
var errNotClaimable = errors.New("the terminal cannot be claimed")

// ServeChannel serves one stream until it ends: it reads the attach request, and if the capability opens a terminal the stream
// holds it, is handed the replay of what the page lacks and then the live output on the same ordered connection, and carries the
// page's input, resizes and acknowledgements. When the stream ends, however it ends, a terminal it holds is detached and its lease
// runs. A request that is not an attach, or whose capability opens nothing, gets the one not-found frame and the stream closes. A
// stream that has sent nothing when the first-frame wait is over (channelFirstFrameWait) is closed with no answer.
func (m *Manager) ServeChannel(ch Channel) {
	defer func() { _ = ch.Close() }()
	// The transport has no ping and no read deadline of its own, so a connection that never sends would keep its slot of the transport
	// and this goroutine for ever: the wait is on the manager's clock, and the close wakes the Recv below. The boundary is not exact: a
	// first frame that arrives at the very moment the wait ends may find the stream closed, and the page that finds its stream closed
	// attaches again, as it does for any stream that ends.
	idle := m.clock.AfterFunc(m.channel.firstFrame, func() { _ = ch.Close() })
	first, err := ch.Recv()
	idle.Stop()
	if err != nil {
		return
	}
	req, kind := parseAttach(first)
	switch kind {
	case attachMalformed:
		refuseChannel(ch)
		return
	case attachOtherVersion:
		_ = ch.Send(unsupportedFrame())
		return
	case attachOK:
	}
	s, kept := m.lookupCap(req.Cap)
	switch {
	case s != nil:
		m.serveLive(ch, s, req.From)
	case kept != nil:
		m.serveEnded(ch, kept, req.From)
	default:
		refuseChannel(ch)
	}
}

// refuseChannel is the one answer of a stream that opens nothing.
func refuseChannel(ch Channel) { _ = ch.Send([]byte{frameNotFound}) }

// serveLive serves a stream that opened a terminal that is running.
func (m *Manager) serveLive(ch Channel, s *session, from *uint64) {
	c := newChannelConn(ch, m.clock)
	view, err := s.claim(c, from)
	switch {
	case errors.Is(err, errEndingByItself):
		// The shell ended by itself: it leaves its end, and the page that is attaching is owed it.
		s.awaitDone(closeWait)
		if _, kept := m.lookupCap(s.channel.capability.reveal()); kept != nil {
			m.serveEnded(ch, kept, from)
		} else {
			refuseChannel(ch)
		}
		return
	case errors.Is(err, errNotClaimable):
		refuseChannel(ch)
		return
	case err != nil:
		return // an offset that is not this terminal's: the stream closes, with no answer
	}
	cwd, busy := s.whereAndWhat()
	ready, err := readyFrame(s.info, &view, from, int(s.lease/time.Millisecond), cwd, busy, nil, c.reported)
	if err != nil || ch.Send(ready) != nil {
		m.release(s, c)
		return
	}
	go m.runSender(s, c)
	m.takeFrames(s, c)
	// The stream ended, or broke the protocol: the terminal is let go, the sender stops, and a Send that is parked returns.
	m.release(s, c)
	c.stopped.Store(true)
	c.signal()
	_ = ch.Close()
	<-c.finished
}

// whereAndWhat reads where the shell is and what holds its terminal, from the system and outside every lock.
func (s *session) whereAndWhat() (Directory, Foreground) {
	path, reason := s.directory()
	busy := UnknownForeground(ReasonQueryFailed)
	if shell, group, known := s.groups(); known {
		busy = foregroundOf(shell, group)
	}
	return Directory{Path: path, Reason: reason}, busy
}

// serveEnded serves a stream that opened the kept end of a terminal: the ready frame (which says how it ended), what it wrote
// from the offset the page has, the end again, and the stream closes. No terminal is held, and nothing is read from the page.
func (m *Manager) serveEnded(ch Channel, kept *tombstone, from *uint64) {
	view, err := kept.ring.view(from)
	if err != nil {
		return
	}
	ready, err := readyFrame(kept.info, &view, from, 0, Directory{Path: "", Reason: ReasonEnded}, UnknownForeground(ReasonEnded), &kept.end, 0)
	if err != nil || ch.Send(ready) != nil {
		return
	}
	for at := view.start; at < view.end; {
		parts, to := kept.ring.slices(at, m.channel.frame)
		if ch.Send(outputFrame(at, parts)) != nil {
			return
		}
		at = to
	}
	if end, endErr := endedFrame(kept.end); endErr == nil {
		_ = ch.Send(end)
	}
}

// claim is the decision that a stream holds a terminal, taken and acted on in one step under the terminal's lock: a terminal whose
// end is decided cannot be claimed; the stream that held it is displaced, to be told in its own time; the lease is over; the
// replay is read together with the ring's bounds; the stream's cursor starts at the first byte it is owed.
func (s *session) claim(c *channelConn, from *uint64) (replayView, error) {
	var none replayView
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fate.set || s.ending.Load() {
		if s.fate.closedBy == "" {
			return none, errEndingByItself
		}
		return none, errNotClaimable
	}
	s.outMu.Lock()
	view, err := s.ring.view(from)
	if err == nil {
		c.sent.Store(view.start)
		c.replayEnd = view.end
	}
	s.outMu.Unlock()
	if err != nil {
		return none, err
	}
	if old := s.channel.holder; old != nil {
		old.displace()
		s.channel.watchLocked(old)
	}
	// The count this stream's ready states: what the device took and what the queue holds ahead of this stream's input, read in the
	// step that decides the holder, so that no input is admitted between this number and the stream's first one.
	c.reported = s.channel.inputAdmitted.Load()
	s.channel.holder = c
	s.channel.holderPtr.Store(c)
	s.endLeaseLocked()
	s.attachment++
	c.progress()
	s.channel.signalPump()
	return view, nil
}

// release lets go of a terminal a stream held, when it still holds it: the stream was the holder, so the terminal is detached and
// its lease starts, unless its end is decided. A stream that was displaced has nothing to let go.
func (m *Manager) release(s *session, c *channelConn) {
	s.mu.Lock()
	s.channel.unwatchLocked(c)
	if s.channel.holder == c {
		s.channel.holder = nil
		s.channel.holderPtr.Store(nil)
		if !s.fate.set && !s.ending.Load() {
			s.armLeaseLocked(s.lease)
			// The terminal runs and nobody holds it: the fact is stated to every watcher in this step, so that a stream that attaches
			// after it is nobody's business to them. A terminal whose end is decided is never free: its watchers are told the end.
			s.channel.freeLocked()
		}
	}
	s.mu.Unlock()
	s.channel.signalPump()
	m.log.Debugw(m.ctx, "channel released", "session", s.id, "lost", c.lost.Load(), "overwritten", s.channelStats().overwritten)
}

// channelEnded is what the end of a channel terminal does for the stream that holds it: the end is set after the last byte of
// output is in the ring (the stream sends it after the output), and the sender is woken. No event of the events lane goes out.
func (m *Manager) channelEnded(s *session, end End) {
	s.channel.ended.Store(&end)
	if holder := s.channel.holderPtr.Load(); holder != nil {
		holder.signal()
	}
	s.mu.Lock()
	watchers := slices.Clone(s.channel.watchers)
	s.mu.Unlock()
	for _, w := range watchers {
		w.signal()
	}
}

// takeFrames reads the page's frames, in order, until the stream ends or breaks the protocol.
func (m *Manager) takeFrames(s *session, c *channelConn) {
	for {
		frame, err := c.ch.Recv()
		if err != nil || !m.takeFrame(s, c, frame) {
			return
		}
	}
}

// takeFrame applies one frame the page sent, and says whether the stream goes on. A frame too short or too long for its type, a
// size that is not one, a second attach and a type that is the host's or nobody's end the stream, as a detach frame does: the page
// that leaves says so, and the terminal is let go at once.
func (m *Manager) takeFrame(s *session, c *channelConn, frame []byte) bool {
	if len(frame) == 0 {
		return false
	}
	body := frame[1:]
	switch frame[0] {
	case frameInput:
		if len(body) > ChannelMaxInputBytes {
			return false
		}
		if len(body) > 0 {
			o := writeOp(body)
			o.applied = s.channel.noteApplied
			m.applyFrom(s, c, o)
		}
		return true
	case frameResize:
		if len(body) != resizeBodyBytes {
			return false
		}
		rows, cols, err := checkSize(int(binary.BigEndian.Uint16(body[2:])), int(binary.BigEndian.Uint16(body[:2])))
		if err != nil {
			return false
		}
		m.applyFrom(s, c, resizeOp(rows, cols))
		return true
	case frameAck:
		if len(body) != ackBodyBytes {
			return false
		}
		s.ackFrom(c, binary.BigEndian.Uint32(body))
		return true
	default: // a detach, an attach again, a frame that is the host's, a type nobody has
		return false
	}
}

func writeOp(data []byte) *op {
	o := newOp(opWrite, 0)
	o.data = data
	return o
}

func resizeOp(rows, cols uint16) *op {
	o := newOp(opResize, 0)
	o.rows, o.cols = rows, cols
	return o
}

// applyFrom hands an input operation of the stream's to the terminal's queue, in one step with the decision that the stream holds
// the terminal, and waits for the answer: the frames of one stream are applied in order, and a write that blocks in the kernel
// (a program that does not read its terminal) holds up this stream's later frames and nobody else's. A stream that does not hold
// the terminal types nothing: its operation is refused, and counted.
func (m *Manager) applyFrom(s *session, c *channelConn, o *op) {
	if !s.admitFrom(c, o) {
		return
	}
	select {
	case err := <-o.done:
		_ = err // The shell's answer to input is nothing the stream acts on: a shell that is gone is the end the page is told of.
	case <-c.ch.Done():
	}
}

// admitFrom admits the operation to the terminal's queue if the stream holds the terminal and the terminal's end is not decided,
// in the same step under the lock that decides who holds it: the operations admitted before a handover are applied before the new
// holder's, and one admitted after is not. A queue that has no room (a write that blocks in the kernel keeps its bytes in it) is
// waited for, and the stream's right to type is looked at again each time: the input of the stream that holds the terminal is never
// dropped, and that of a stream that lost the terminal is refused. It says whether the operation was admitted.
func (s *session) admitFrom(c *channelConn, o *op) bool {
	for {
		s.mu.Lock()
		if s.channel.holder != c || s.fate.set || s.ending.Load() {
			s.mu.Unlock()
			s.channel.refused.Add(1)
			return false
		}
		room, err := s.queue.admitOrWait(o)
		if err == nil && o.kind == opWrite {
			s.channel.inputAdmitted.Add(uint64(len(o.data)))
		}
		s.mu.Unlock()
		if err == nil {
			s.channel.admitted.Add(1)
			return true
		}
		if room == nil {
			s.channel.refused.Add(1)
			return false
		}
		s.channel.roomWaits.Add(1)
		select {
		case <-room:
		case <-c.gone:
		case <-c.ch.Done():
			s.channel.refused.Add(1)
			return false
		}
	}
}

// ackFrom is the page saying it parsed n more bytes of what it was sent: its in-flight bytes go down, and that is progress. An
// acknowledgement of a stream that does not hold the terminal counts for nothing, and the page can never acknowledge more than the
// sender has begun to hand to the transport, which a frame that is acknowledged before its Send returns already is.
func (s *session) ackFrom(c *channelConn, n uint32) {
	if s.channel.holderPtr.Load() != c {
		return
	}
	c.ackSeen.Store(true)
	c.acked.Store(min(c.acked.Load()+uint64(n), c.begun.Load()))
	c.progress()
	c.signal()
	s.channel.signalPump()
}

// ---- the sender ----

type stepKind int

const (
	// stepIdle: nothing to send, wait for output. stepWaitAck: the page holds as much unacknowledged as it may, wait for it to
	// acknowledge. stepGap: the ring overwrote bytes the stream had not sent. stepOutput: a frame of output. stepEnded: the
	// terminal ended and everything it wrote was sent.
	stepIdle stepKind = iota
	stepWaitAck
	stepGap
	stepOutput
	stepEnded
)

// senderStep is what the sender does next.
type senderStep struct {
	kind     stepKind
	from, to uint64
	parts    [][]byte
	end      *End
}

// nextStep decides what the sender does next, from the ring as it is now. The end is read before the ring: if it is set, the
// ring is final. A page that acknowledges holds no more than the window unacknowledged, counted from the bytes handed to the
// transport: a frame is cut to the credit that is left, so that a page that acknowledges when it holds a whole window is always
// given one, and the sender waits only when there is no credit at all.
func (s *session) nextStep(c *channelConn, lim channelLimits) senderStep {
	ended := s.channel.ended.Load()
	limit, credit := lim.frame, true
	if c.ackSeen.Load() {
		limit, credit = creditLeft(c, lim)
	}
	s.outMu.Lock()
	start, end, pos := s.ring.start(), s.ring.end, c.sent.Load()
	var parts [][]byte
	var to uint64
	if credit && pos >= start && pos < end {
		parts, to = s.ring.slices(pos, cutAtReplayEnd(limit, pos, c.replayEnd))
	}
	s.outMu.Unlock()
	switch {
	case pos < start:
		return senderStep{kind: stepGap, from: pos, to: start, parts: nil, end: nil}
	case pos < end:
		if !credit {
			return senderStep{kind: stepWaitAck, from: 0, to: 0, parts: nil, end: nil}
		}
		return senderStep{kind: stepOutput, from: pos, to: to, parts: parts, end: nil}
	case ended != nil:
		return senderStep{kind: stepEnded, from: 0, to: 0, parts: nil, end: ended}
	default:
		return senderStep{kind: stepIdle, from: 0, to: 0, parts: nil, end: nil}
	}
}

// creditLeft is how many bytes of output a page that acknowledges may be given now, at most a frame, and whether it may be given
// any: the window less what was handed to the transport and is not acknowledged.
func creditLeft(c *channelConn, lim channelLimits) (int, bool) {
	window := uint64(lim.inflight) //nolint:gosec // The limit is a positive number of bytes.
	acked := c.acked.Load()        // read first: it only grows, and begun is never less than it
	room := window - min(c.begun.Load()-acked, window)
	if room == 0 {
		return 0, false
	}
	return int(min(room, uint64(lim.frame))), true //nolint:gosec // The limit is a positive number of bytes, and the result is at most a frame.
}

// cutAtReplayEnd is the most that a frame beginning at pos may take: no more than limit, and, while pos is below the end of the
// replay, no more than what is left of the replay.
func cutAtReplayEnd(limit int, pos, replayEnd uint64) int {
	if pos >= replayEnd {
		return limit
	}
	return int(min(uint64(limit), replayEnd-pos)) //nolint:gosec // The result is at most limit.
}

// advance is the stream having been handed a frame: its cursor moves, that is progress, and the pump may have room.
func (s *session) advance(c *channelConn, step senderStep) {
	s.outMu.Lock()
	c.sent.Store(step.to)
	s.outMu.Unlock()
	if step.kind == stepGap {
		c.lost.Add(step.to - step.from)
	} else {
		c.sentBytes.Add(step.to - step.from)
	}
	c.progress()
	s.channel.signalPump()
}

// runSender is the stream's one sender: it reads the ring from the stream's cursor at the pace of the page (Send blocks while
// the transport's queue is full), says what the ring overwrote in a gap frame, and when the terminal has ended and everything it
// wrote was sent, sends the end and closes the connection. A stream that was displaced is sent the frame that says so, after the
// frame it may be parked in, and closed.
func (m *Manager) runSender(s *session, c *channelConn) {
	defer close(c.finished)
	sd := &sender{m: m, s: s, c: c, idle: false, told: false, reported: c.reported}
	for {
		if !sd.step() {
			return
		}
	}
}

// sender is the state of one stream's sender.
type sender struct {
	m *Manager
	s *session
	c *channelConn
	// idle is set when the last thing the sender did was to wait for output.
	idle bool
	// told is set once the stream, displaced, was sent taken-over; reported is the input count the page was last told.
	told     bool
	reported uint64
}

// step does one thing for the stream's sender and says whether the sender goes on.
func (sd *sender) step() bool {
	c := sd.c
	switch {
	case c.stopped.Load():
		return false
	case c.displaced.Load():
		return sd.watch()
	}
	if n := sd.s.channel.inputApplied.Load(); n > sd.reported {
		// At most one frame for the writes that returned since the last: a page that takes frames slowly is told once, with the total.
		sd.reported = n
		return c.ch.Send(appliedFrame(n)) == nil
	}
	next := sd.s.nextStep(c, sd.m.channel)
	switch next.kind {
	case stepIdle:
		sd.idle = true
		return c.wait()
	case stepWaitAck:
		return c.wait()
	case stepGap:
		return sd.send(gapFrame(next.from, next.to), next)
	case stepOutput:
		if sd.idle {
			// Output came for a sender that had none: the page has had no chance to take it until now.
			c.progress()
			sd.idle = false
		}
		return sd.send(outputFrame(next.from, next.parts), next)
	case stepEnded:
		if frame, err := endedFrame(*next.end); err == nil {
			_ = c.ch.Send(frame)
		}
		_ = c.ch.Close()
		return false
	}
	return false
}

// watch is what the sender of a displaced stream does: it tells the page, after the frame it may be parked in, that it lost the terminal,
// and then waits as a watcher: it sends no output and nothing of input (a displaced stream is told no applied), and it ends with the
// one frame that says what became of the terminal: released, when the stream that held it ended while it ran, or the end of the terminal.
// A watcher that was one too many is closed with no frame. It says whether the sender goes on.
func (sd *sender) watch() bool {
	c := sd.c
	if !sd.told {
		sd.told = true
		return c.ch.Send([]byte{frameTakenOver}) == nil
	}
	switch {
	case c.evicted.Load():
	case c.released.Load():
		_ = c.ch.Send([]byte{frameReleased})
	default:
		end := sd.s.channel.ended.Load()
		if end == nil {
			return c.wait()
		}
		if frame, err := endedFrame(*end); err == nil {
			_ = c.ch.Send(frame)
		}
	}
	_ = c.ch.Close()
	return false
}

// send hands the page a frame and, when the transport took it, moves the stream's cursor on. It says whether the sender goes on.
func (sd *sender) send(frame []byte, next senderStep) bool {
	if next.kind == stepOutput {
		// Counted before the Send: the page can acknowledge the frame before the Send returns.
		sd.c.begun.Add(next.to - next.from)
	}
	if sd.c.ch.Send(frame) != nil {
		return false
	}
	sd.s.advance(sd.c, next)
	return true
}
