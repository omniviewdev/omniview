//go:build !windows

package terminal

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
)

// THE HELPERS OF THE CHANNEL TESTS (docs/ui-next/terminal-channel-protocol.md).
//
// The wire is written out here again, by hand and with literal numbers, on purpose: a test that built its frames with
// the host's own encoder would agree with the host about a wrong table. A fake channel stands for a page and its
// transport: it takes the host's frames in order, parks a Send or lets it through one frame at a time when the test
// says so (a page that sleeps does not take frames), and hands the host the frames the page sent. No wait in these
// tests decides an outcome: a wait is for an event that must come, with a bound that only a missing event reaches,
// and the order of two events is forced by a channel or by the clock a test moves.

// The frame types of the protocol.
const (
	wAttach       byte = 0x01
	wInput        byte = 0x02
	wResize       byte = 0x03
	wAck          byte = 0x04
	wDetach       byte = 0x05
	wClose        byte = 0x06
	wReady        byte = 0x81
	wOutput       byte = 0x82
	wGap          byte = 0x83
	wEnded        byte = 0x84
	wTakenOver    byte = 0x85
	wNotFound     byte = 0x86
	wApplied      byte = 0x87
	wReleased     byte = 0x88
	wCloseRefused byte = 0x8a
	wMarks        byte = 0x8b
	wTitle        byte = 0x8c
)

// settle is the bound of a wait for an event that must come.
const settle = 30 * time.Second

// controlOffVariable names the controls the runner switches off (docs/ui-next/status/T3-channel/mutate.py.txt).
const controlOffVariable = "TERMINAL_CHANNEL_CONTROL_OFF"

// guarded runs the assertion that a negative control is named for. The runner puts a fault in a scratch copy of the
// source, expects the test to fail in this assertion, and then switches the assertion off with the variable above and
// expects the same fault to pass undetected: an assertion that a fault trips for another reason proves nothing.
func guarded(t *testing.T, name string, assertion func()) {
	t.Helper()
	if slices.Contains(strings.Split(os.Getenv(controlOffVariable), ","), name) {
		return
	}
	assertion()
}

// ---- the fake channel ----

var errFakeClosed = errors.New("the fake channel is closed")

type fakeGate int

const (
	gateOpen fakeGate = iota
	gatePark
	gateMeter
)

// fakeChannel is both ends of one stream: the host's, which the manager serves, and the page's.
type fakeChannel struct {
	mu   sync.Mutex
	cond *sync.Cond
	// toPage holds the frames the host sent and the transport took, in order; read is how many the page took out.
	toPage [][]byte
	read   int
	// toHost holds the frames the page sent that the host has not received.
	toHost [][]byte
	// sends counts the Send calls begun and taken those that returned.
	sends, taken int
	// recvs counts the Recv calls begun: when it goes up, the host has finished with the frame it took before.
	recvs int
	// waiting is how many Recv calls wait for a frame now: the host is inside its read of the page's next frame.
	waiting int
	// lastSend is the frame of the latest Send that began, whether or not it returned.
	lastSend []byte
	// gate decides what a Send does from the gateFrom-th on: pass, park until release, or pass one for each token.
	gate     fakeGate
	gateFrom int
	tokens   int
	closed   bool
	done     chan struct{}
}

func newFakeChannel(t testing.TB) *fakeChannel {
	t.Helper()
	f := &fakeChannel{
		mu: sync.Mutex{}, toPage: nil, read: 0, toHost: nil, sends: 0, taken: 0, recvs: 0, waiting: 0, lastSend: nil, gate: gateOpen, gateFrom: 0, tokens: 0, closed: false, done: make(chan struct{}),
	}
	f.cond = sync.NewCond(&f.mu)
	t.Cleanup(func() { _ = f.Close() })
	return f
}

// Send is the host's: it blocks while the gate says the page takes nothing.
func (f *fakeChannel) Send(frame []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := f.sends
	f.sends++
	f.lastSend = frame
	for !f.closed && f.gate != gateOpen && n >= f.gateFrom && (f.gate == gatePark || f.tokens == 0) {
		f.cond.Wait()
	}
	if f.closed {
		return errFakeClosed
	}
	if f.gate == gateMeter && n >= f.gateFrom {
		f.tokens--
	}
	f.toPage = append(f.toPage, frame)
	f.taken++
	f.cond.Broadcast()
	return nil
}

// Recv is the host's: the page's frames in the order it sent them. Once the connection is closed it returns nothing
// more, as Wails does, which drops the frames that were queued.
func (f *fakeChannel) Recv() ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.recvs++
	for len(f.toHost) == 0 && !f.closed {
		f.waiting++
		f.cond.Wait()
		f.waiting--
	}
	if f.closed {
		return nil, errFakeClosed
	}
	frame := f.toHost[0]
	f.toHost = f.toHost[1:]
	return frame, nil
}

func (f *fakeChannel) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.closed {
		f.closed = true
		close(f.done)
	}
	f.cond.Broadcast()
	return nil
}

func (f *fakeChannel) Done() <-chan struct{} { return f.done }

// park makes the Send calls from the n-th on wait until release: a page that does not read.
func (f *fakeChannel) park(from int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.gate, f.gateFrom = gatePark, from
	f.cond.Broadcast()
}

// meter makes each Send from the n-th on wait for a token: a page that takes one frame when the test lets it.
func (f *fakeChannel) meter(from int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.gate, f.gateFrom = gateMeter, from
	f.cond.Broadcast()
}

// allow gives n tokens to a metered channel.
func (f *fakeChannel) allow(n int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.tokens += n
	f.cond.Broadcast()
}

// release lets every Send through again.
func (f *fakeChannel) release() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.gate = gateOpen
	f.cond.Broadcast()
}

// counts says how many Send calls began and how many returned.
func (f *fakeChannel) counts() (int, int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.sends, f.taken
}

// recvCalls says how many Recv calls began.
func (f *fakeChannel) recvCalls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.recvs
}

// recvWaiting says how many Recv calls wait for a frame: with it at one the host has finished with every frame it took, and the
// next call of Recv that begins is the host having finished with the frame the page sends now.
func (f *fakeChannel) recvWaiting() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.waiting
}

// allFrames is every frame the host sent that the transport took, in order.
func (f *fakeChannel) allFrames() [][]byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.toPage)
}

// pageSend is the page sending a frame. A closed connection takes nothing.
func (f *fakeChannel) pageSend(frame []byte) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if !f.closed {
		f.toHost = append(f.toHost, slices.Clone(frame))
	}
	f.cond.Broadcast()
}

// nextFrame is the page taking the next frame the host sent: it blocks until there is one, and says false once the
// connection is closed and everything that was delivered has been taken.
func (f *fakeChannel) nextFrame() ([]byte, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for f.read >= len(f.toPage) && !f.closed {
		f.cond.Wait()
	}
	if f.read < len(f.toPage) {
		frame := f.toPage[f.read]
		f.read++
		return frame, true
	}
	return nil, false
}

func (f *fakeChannel) isClosed() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.closed
}

// lastSendFrame is the frame of the latest Send that began: the one a parked Send holds.
func (f *fakeChannel) lastSendFrame() []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lastSend
}

// ---- the frames ----

func attachFrame(capability string, from *uint64) []byte {
	if from == nil {
		return append([]byte{wAttach}, fmt.Sprintf(`{"v":2,"cap":%q,"writer":%q}`, capability, writerID(0))...)
	}
	return append([]byte{wAttach}, fmt.Sprintf(`{"v":2,"cap":%q,"from_offset":%d,"writer":%q}`, capability, *from, writerID(0))...)
}

func inputFrame(text string) []byte { return append([]byte{wInput}, text...) }

func resizeFrame(cols, rows uint16) []byte {
	return binary.BigEndian.AppendUint16(binary.BigEndian.AppendUint16([]byte{wResize}, cols), rows)
}

func ackFrame(n uint32) []byte { return binary.BigEndian.AppendUint32([]byte{wAck}, n) }

func detachFrame() []byte { return []byte{wDetach} }

func closeFrame() []byte { return []byte{wClose} }

// readyWire is the JSON of the ready frame, as the page reads it.
type readyWire struct {
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
	Ended      *End          `json:"ended"`
	// InputApplied is the bytes of input the host has applied from this capability, across streams.
	InputApplied uint64 `json:"input_applied"`
	// WriterKnown says the host had a count for the attach's writer before this attach.
	WriterKnown bool `json:"writer_known"`
	// Marks is the version of the marks frame this stream carries: absent when the page asked for none or the terminal has none.
	Marks int `json:"marks"`
	// Title is the version of the title frame this stream carries: absent when the page asked for none.
	Title int `json:"title"`
}

// titleWire is the JSON of a title frame, as the page reads it.
type titleWire struct {
	V       int    `json:"v"`
	Title   string `json:"title"`
	Program bool   `json:"program"`
}

// markWire is one mark of a marks frame, as the page reads it.
type markWire struct {
	Kind       string `json:"kind"`
	At         uint64 `json:"at"`
	End        uint64 `json:"end"`
	ID         string `json:"id"`
	Trust      string `json:"trust"`
	Command    string `json:"command"`
	Cwd        string `json:"cwd"`
	Exit       *int32 `json:"exit"`
	DurationMs *int64 `json:"duration_ms"`
	TimeMs     int64  `json:"time_ms"`
	Redraw     bool   `json:"redraw"`
	// seenAt is where the page stood in the output when the frame came: set by the test page, not part of the wire.
	seenAt uint64
}

// marksWire is the JSON of a marks frame.
type marksWire struct {
	V     int        `json:"v"`
	Marks []markWire `json:"marks"`
}

// hostFrame is a frame the host sent, read.
type hostFrame struct {
	kind     byte
	ready    readyWire
	offset   uint64
	data     []byte
	from, to uint64
	end      End
	applied  uint64
	marks    marksWire
	title    titleWire
	raw      []byte
}

func decodeHostFrame(raw []byte) (hostFrame, error) {
	var frame hostFrame
	if len(raw) == 0 {
		return frame, errors.New("an empty frame")
	}
	frame.kind = raw[0]
	body := raw[1:]
	switch frame.kind {
	case wReady:
		if err := json.Unmarshal(body, &frame.ready); err != nil {
			return frame, fmt.Errorf("a ready frame that is not JSON: %w", err)
		}
	case wOutput:
		if len(body) < 8 {
			return frame, errors.New("an output frame shorter than its offset")
		}
		frame.offset, frame.data = binary.BigEndian.Uint64(body[:8]), body[8:]
	case wGap:
		if len(body) != 16 {
			return frame, fmt.Errorf("a gap frame of %d bytes", len(raw))
		}
		frame.from, frame.to = binary.BigEndian.Uint64(body[:8]), binary.BigEndian.Uint64(body[8:])
	case wEnded:
		if err := json.Unmarshal(body, &frame.end); err != nil {
			return frame, fmt.Errorf("an ended frame that is not JSON: %w", err)
		}
	case wApplied:
		if len(body) != 8 {
			return frame, fmt.Errorf("an applied frame of %d bytes", len(raw))
		}
		frame.applied = binary.BigEndian.Uint64(body)
	case wMarks:
		frame.raw = body
		if err := json.Unmarshal(body, &frame.marks); err != nil {
			return frame, fmt.Errorf("a marks frame that is not JSON: %w", err)
		}
	case wTitle:
		frame.raw = body
		if err := json.Unmarshal(body, &frame.title); err != nil {
			return frame, fmt.Errorf("a title frame that is not JSON: %w", err)
		}
	case wTakenOver, wNotFound, wReleased, wCloseRefused:
		if len(body) != 0 {
			return frame, fmt.Errorf("a frame of type %#x that has a payload", frame.kind)
		}
	default:
		return frame, fmt.Errorf("a frame of unknown type %#x", frame.kind)
	}
	return frame, nil
}

// ---- the page ----

// pageSegment is the bytes of one output frame and the offset it said they start at.
type pageSegment struct {
	offset uint64
	data   []byte
}

// chanPage is a page that follows the protocol: it takes the host's frames in order, checks that each output starts
// where the one before ended (or where a gap said it would), and keeps everything it saw.
type chanPage struct {
	t      *testing.T
	f      *fakeChannel
	served chan struct{}
	done   chan struct{}

	mu        sync.Mutex
	ready     *readyWire
	readies   int
	next      uint64
	segs      []pageSegment
	gaps      [][2]uint64
	ended     []End
	takenOver int
	notFound  int
	// applied is the value of every applied frame, in order; released counts the released frames.
	applied      []uint64
	released     int
	closeRefused int
	// marks is every mark of every marks frame, in the order they came, with the offset the page stood at when each came; markFrames is the raw JSON of each frame.
	marks      []markWire
	markFrames [][]byte
	// titles is every title frame, in the order they came, and titleRaw the raw JSON of each.
	titles   []titleWire
	titleRaw [][]byte
	faults   []string
	frames   int
	order    []byte
	closed   bool
	ackEvery int
	unacked  int
	// dead says the page has gone: what the host sent after is lost to it, as the frames queued in a closed tab are.
	dead bool
	// lag is how late the page's goroutine is for each frame it takes, in nanoseconds: the page of a machine that is busy. A test sets
	// it to see what it does when the page is late.
	lag atomic.Int64
}

func newChanPage(t *testing.T, f *fakeChannel, ackEvery int) *chanPage {
	t.Helper()
	return &chanPage{
		t: t, f: f, served: nil, done: make(chan struct{}), mu: sync.Mutex{}, ready: nil, readies: 0, next: 0, segs: nil, gaps: nil, ended: nil,
		takenOver: 0, notFound: 0, faults: nil, frames: 0, order: nil, closed: false, ackEvery: ackEvery, unacked: 0, dead: false,
	}
}

func (p *chanPage) run() {
	defer close(p.done)
	for {
		raw, ok := p.f.nextFrame()
		if !ok {
			p.mu.Lock()
			p.closed = true
			p.mu.Unlock()
			return
		}
		if lag := time.Duration(p.lag.Load()); lag > 0 {
			time.Sleep(lag)
		}
		if ack := p.take(raw); ack > 0 {
			p.f.pageSend(ackFrame(ack))
		}
	}
}

// take applies one frame and says how many bytes the page acknowledges for it.
func (p *chanPage) take(raw []byte) uint32 {
	frame, err := decodeHostFrame(raw)
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.dead {
		return 0
	}
	p.frames++
	if err != nil {
		p.faults = append(p.faults, err.Error())
		return 0
	}
	p.order = append(p.order, frame.kind)
	if len(p.ended) > 0 {
		p.faults = append(p.faults, fmt.Sprintf("a frame of type %#x after the end", frame.kind))
	}
	switch frame.kind {
	case wReady:
		p.readies++
		if p.readies > 1 {
			p.faults = append(p.faults, "a second ready frame")
		}
		ready := frame.ready
		p.ready = &ready
		p.next = ready.Start
	case wOutput:
		return p.takeOutput(frame)
	case wGap:
		p.requireReady("a gap")
		if frame.from != p.next || frame.to <= frame.from {
			p.faults = append(p.faults, fmt.Sprintf("a gap [%d, %d) where the page stands at %d", frame.from, frame.to, p.next))
		}
		p.gaps = append(p.gaps, [2]uint64{frame.from, frame.to})
		p.next = frame.to
	case wEnded:
		p.ended = append(p.ended, frame.end)
	case wMarks:
		p.requireReady("a marks")
		p.markFrames = append(p.markFrames, frame.raw)
		if len(frame.marks.Marks) == 0 || frame.marks.V != 1 {
			p.faults = append(p.faults, fmt.Sprintf("a marks frame of version %d with %d marks", frame.marks.V, len(frame.marks.Marks)))
		}
		for _, mark := range frame.marks.Marks {
			if mark.End > p.next {
				p.faults = append(p.faults, fmt.Sprintf("a mark %s ending at %d before the bytes of it: the page stands at %d", mark.Kind, mark.End, p.next))
			}
			if n := len(p.marks); n > 0 && mark.End <= p.marks[n-1].End {
				p.faults = append(p.faults, fmt.Sprintf("a mark ending at %d after one ending at %d", mark.End, p.marks[n-1].End))
			}
			mark.seenAt = p.next
			p.marks = append(p.marks, mark)
		}
	case wTitle:
		p.requireReady("a title")
		p.titleRaw = append(p.titleRaw, frame.raw)
		if frame.title.V != 1 {
			p.faults = append(p.faults, fmt.Sprintf("a title frame of version %d", frame.title.V))
		}
		p.titles = append(p.titles, frame.title)
	case wApplied:
		p.requireReady("an applied")
		if n := len(p.applied); n > 0 && frame.applied <= p.applied[n-1] {
			p.faults = append(p.faults, fmt.Sprintf("an applied frame of %d after one of %d", frame.applied, p.applied[n-1]))
		}
		p.applied = append(p.applied, frame.applied)
	case wReleased:
		p.released++
	case wCloseRefused:
		p.closeRefused++
	case wTakenOver:
		p.takenOver++
	case wNotFound:
		p.notFound++
	}
	return 0
}

func (p *chanPage) takeOutput(frame hostFrame) uint32 {
	p.requireReady("an output")
	if frame.offset != p.next {
		p.faults = append(p.faults, fmt.Sprintf("an output at %d where the page stands at %d", frame.offset, p.next))
	}
	if len(frame.data) == 0 || len(frame.data) > ChannelFrameBytes {
		p.faults = append(p.faults, fmt.Sprintf("an output frame of %d bytes", len(frame.data)))
	}
	p.segs = append(p.segs, pageSegment{offset: frame.offset, data: frame.data})
	p.next = frame.offset + uint64(len(frame.data))
	if p.ackEvery == 0 {
		return 0
	}
	p.unacked += len(frame.data)
	if p.unacked < p.ackEvery {
		return 0
	}
	n := p.unacked
	p.unacked = 0
	return uint32(n)
}

func (p *chanPage) requireReady(what string) {
	if p.ready == nil {
		p.faults = append(p.faults, what+" before the ready frame")
	}
}

// page-side calls

func (p *chanPage) input(text string)        { p.f.pageSend(inputFrame(text)) }
func (p *chanPage) resize(cols, rows uint16) { p.f.pageSend(resizeFrame(cols, rows)) }
func (p *chanPage) ack(n uint32)             { p.f.pageSend(ackFrame(n)) }
func (p *chanPage) detach()                  { p.f.pageSend(detachFrame()) }
func (p *chanPage) closeTerminal()           { p.f.pageSend(closeFrame()) }
func (p *chanPage) send(frame []byte)        { p.f.pageSend(frame) }
func (p *chanPage) close()                   { _ = p.f.Close() }
func (p *chanPage) isClosed() bool           { return p.f.isClosed() }

// die is the page going away at this moment: what it took until now is what it has, whatever the host had sent and the
// transport had queued is lost to it, and the connection ends. It returns what the page had.
func (p *chanPage) die() pageState {
	p.mu.Lock()
	p.dead = true
	p.mu.Unlock()
	st := p.state()
	p.close()
	return st
}

// state is a copy of what the page saw.
type pageState struct {
	ready        *readyWire
	segs         []pageSegment
	gaps         [][2]uint64
	ended        []End
	takenOver    int
	notFound     int
	applied      []uint64
	released     int
	closeRefused int
	marks        []markWire
	markFrames   [][]byte
	titles       []titleWire
	titleRaw     [][]byte
	faults       []string
	frames       int
	order        []byte
	closed       bool
	next         uint64
}

func (p *chanPage) state() pageState {
	p.mu.Lock()
	defer p.mu.Unlock()
	return pageState{
		ready: p.ready, segs: slices.Clone(p.segs), gaps: slices.Clone(p.gaps), ended: slices.Clone(p.ended), takenOver: p.takenOver, notFound: p.notFound,
		applied: slices.Clone(p.applied), released: p.released, closeRefused: p.closeRefused, marks: slices.Clone(p.marks), markFrames: slices.Clone(p.markFrames), titles: slices.Clone(p.titles), titleRaw: slices.Clone(p.titleRaw), faults: slices.Clone(p.faults), frames: p.frames, order: slices.Clone(p.order), closed: p.closed, next: p.next,
	}
}

// bytes is every byte of output the page took, in the order it took them.
func (s pageState) bytes() []byte {
	var out bytes.Buffer
	for _, seg := range s.segs {
		out.Write(seg.data)
	}
	return out.Bytes()
}

// waitFor waits, for at most settle, until what the page saw satisfies ok. A stream that has closed brings no more frames: a
// condition it does not satisfy then never will be, and the wait fails at once instead of at the bound. (The poll's cadence
// decides nothing: the wait fails only for an event that never came.)
func (p *chanPage) waitFor(what string, ok func(pageState) bool) pageState {
	p.t.Helper()
	deadline := time.Now().Add(settle)
	for {
		last := p.state()
		if ok(last) {
			return last
		}
		if last.closed {
			require.FailNow(p.t, "the stream closed before the page saw "+what, "frames %d, order %x, faults %v", last.frames, last.order, last.faults)
		}
		if time.Now().After(deadline) {
			require.FailNow(p.t, "the page never saw "+what, "frames %d, order %x, faults %v", last.frames, last.order, last.faults)
		}
		time.Sleep(time.Millisecond)
	}
}

// describe says what the host counted for a terminal and what its page saw (none, for a test that has no page): the message of a
// wait that failed. A stream that stands still is told by its numbers, and not by a bare timeout.
func describe(s *session, page *chanPage) string {
	st := s.channelStats()
	host := fmt.Sprintf("host: end %d, sent %d, kept %d, waits %d, stall releases %d, held %t", st.end, st.sent, st.kept, st.waits, st.stallReleases, st.held)
	if page == nil {
		return host
	}
	ps := page.state()
	return fmt.Sprintf("%s; page: %d frames, at offset %d, faults %v, closed %t", host, ps.frames, ps.next, ps.faults, ps.closed)
}

// waitHost waits, for at most settle, until what the host counted for the terminal satisfies ok, and returns what it counted; if it
// never does, the test fails with the sentence it was given and the numbers (describe). Where a test waits for the host, the host's
// own counters are the barrier. The transport's count says that a Send returned, and the page's state says that the page's goroutine
// has taken the frame, later; neither says that the host has finished with it. (The poll's cadence decides nothing: the wait fails
// only for an event that never came.)
func waitHost(t *testing.T, s *session, page *chanPage, failure string, ok func(channelStats) bool) channelStats {
	t.Helper()
	deadline := time.Now().Add(settle)
	for {
		st := s.channelStats()
		if ok(st) {
			return st
		}
		if time.Now().After(deadline) {
			require.FailNow(t, failure, describe(s, page))
		}
		time.Sleep(time.Millisecond)
	}
}

// waitSenderParked waits, for at most settle, until the stream's sender has begun its first frame of output: the second Send of a
// transport that took the ready frame and parks the next. The sender stamps the progress of the page when it first sees output and
// before it hands the frame over, and nothing stamps again while the page takes nothing, so from here on the deadline of a stall is
// settled and a clock that a test moves is moved by exactly what the test says. A test that moves the clock before this decides a
// deadline that the stamp of a sender that is late, on a machine that is busy, can move (S5 of the review of PR 704).
func waitSenderParked(t *testing.T, f *fakeChannel) {
	t.Helper()
	require.Eventually(t, func() bool { begun, _ := f.counts(); return begun >= 2 }, settle, time.Millisecond,
		"the sender never began its first frame of output: the stamp of the page's first progress is not settled")
}

func (p *chanPage) waitReady() *readyWire {
	p.t.Helper()
	return p.waitFor("the ready frame", func(s pageState) bool { return s.ready != nil }).ready
}

func (p *chanPage) waitClosed() pageState {
	p.t.Helper()
	return p.waitFor("the stream close", func(s pageState) bool { return s.closed })
}

func (p *chanPage) waitServed() {
	p.t.Helper()
	select {
	case <-p.served:
	case <-time.After(settle):
		require.Fail(p.t, "the manager did not return from serving the stream")
	}
}

// waitBytes waits until the page has taken n bytes of output.
func (p *chanPage) waitBytes(n int) pageState {
	p.t.Helper()
	return p.waitFor(fmt.Sprintf("%d bytes of output", n), func(s pageState) bool { return len(s.bytes()) >= n })
}

// ---- the manager ----

// newChannelManager is a manager for channel terminals: its sink is the events lane's, so that any event a channel
// terminal sends is seen, its limits are the ones given, and it ends every terminal when the test does.
func newChannelManager(t *testing.T, limits func(*channelLimits)) (*Manager, *pageSink) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	sink := newPageSink()
	ctx, cancel := context.WithCancel(context.Background())
	m := NewManager(ctx, logging.NewNop(), sink)
	if limits != nil {
		limits(&m.channel)
	}
	t.Cleanup(func() {
		cancel()
		m.Shutdown()
	})
	return m, sink
}

// smallChannel is the limits of the hidden-page tests: a ring that a test fills many times over in a moment.
func smallChannel(l *channelLimits) {
	l.ring = 256 << 10
	l.high = 64 << 10
	l.low = 16 << 10
	l.inflight = 64 << 10
	l.stall = 2 * time.Second
}

// startChannel starts a channel terminal that runs script, and says its capability.
func (m *Manager) startChannel(t *testing.T, script string, opts Options) Session {
	t.Helper()
	opts.Command = []string{sh(t), "-c", script}
	opts.Channel = true
	info, err := m.Start(opts, nil)
	require.NoError(t, err)
	require.NotEmpty(t, info.Cap, "a channel terminal is answered its capability")
	return info
}

// attach opens a stream that shows the capability, and serves it on a goroutine of its own.
func (m *Manager) attach(t *testing.T, capability string, from *uint64) *chanPage {
	t.Helper()
	return m.attachAcking(t, capability, from, 0)
}

func (m *Manager) attachAcking(t *testing.T, capability string, from *uint64, ackEvery int) *chanPage {
	t.Helper()
	f := newFakeChannel(t)
	return m.attachOn(t, f, capability, from, ackEvery)
}

func (m *Manager) attachOn(t *testing.T, f *fakeChannel, capability string, from *uint64, ackEvery int) *chanPage {
	t.Helper()
	p := newChanPage(t, f, ackEvery)
	served := make(chan struct{})
	p.served = served
	go p.run()
	go func() {
		defer close(served)
		m.ServeChannel(f)
	}()
	f.pageSend(attachFrame(capability, from))
	return p
}

// attachAs opens a stream whose attach states the writer (docs/ui-next/terminal-channel-protocol.md section 5): the opaque id of one feed.
func (m *Manager) attachAs(t *testing.T, capability, writer string) *chanPage {
	t.Helper()
	f := newFakeChannel(t)
	p := newChanPage(t, f, 0)
	served := make(chan struct{})
	p.served = served
	go p.run()
	go func() {
		defer close(served)
		m.ServeChannel(f)
	}()
	f.pageSend(attachFrameAs(capability, writer))
	return p
}

// attachFrameWithMarks is an attach of a page that reads the marks frame of version 1 (docs/ui-next/terminal-channel-protocol.md section 4a).
func attachFrameWithMarks(capability string, from *uint64) []byte {
	if from == nil {
		return append([]byte{wAttach}, fmt.Sprintf(`{"v":2,"cap":%q,"writer":%q,"marks":1}`, capability, writerID(0))...)
	}
	return append([]byte{wAttach}, fmt.Sprintf(`{"v":2,"cap":%q,"from_offset":%d,"writer":%q,"marks":1}`, capability, *from, writerID(0))...)
}

// attachMarks opens a stream of a page that reads marks, and serves it on a goroutine of its own.
func (m *Manager) attachMarks(t *testing.T, capability string, from *uint64) *chanPage {
	t.Helper()
	f := newFakeChannel(t)
	p := newChanPage(t, f, 0)
	served := make(chan struct{})
	p.served = served
	go p.run()
	go func() {
		defer close(served)
		m.ServeChannel(f)
	}()
	f.pageSend(attachFrameWithMarks(capability, from))
	return p
}

// attachFrameTitle is an attach of a page that reads the title frame of version 1 (docs/ui-next/terminal-channel-protocol.md section 4b), and the marks when marks is set.
func attachFrameTitle(capability string, from *uint64, marks bool) []byte {
	extra := `,"title":1`
	if marks {
		extra += `,"marks":1`
	}
	if from == nil {
		return append([]byte{wAttach}, fmt.Sprintf(`{"v":2,"cap":%q,"writer":%q%s}`, capability, writerID(0), extra)...)
	}
	return append([]byte{wAttach}, fmt.Sprintf(`{"v":2,"cap":%q,"from_offset":%d,"writer":%q%s}`, capability, *from, writerID(0), extra)...)
}

// attachTitle opens a stream of a page that reads the title frame (and the marks, when marks is set), and serves it on a goroutine of its own.
func (m *Manager) attachTitle(t *testing.T, capability string, from *uint64, marks bool) *chanPage {
	t.Helper()
	f := newFakeChannel(t)
	p := newChanPage(t, f, 0)
	served := make(chan struct{})
	p.served = served
	go p.run()
	go func() {
		defer close(served)
		m.ServeChannel(f)
	}()
	f.pageSend(attachFrameTitle(capability, from, marks))
	return p
}

func attachFrameAs(capability, writer string) []byte {
	return append([]byte{wAttach}, fmt.Sprintf(`{"v":2,"cap":%q,"writer":%q}`, capability, writer)...)
}

// writerApplied is the bytes the device took from the writer, as the host counts them.
func (s *session) writerApplied(id string) uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, w := range s.channel.writers {
		if w.id == id {
			return w.applied.Load()
		}
	}
	return 0
}

// writerID is the id of the nth test writer: 16 bytes as 32 lowercase hex digits.
func writerID(n int) string { return fmt.Sprintf("%032x", n) }

// chanOf is the session of a channel terminal.
func (m *Manager) chanOf(t *testing.T, info Session) *session { return m.session(t, info.ID) }

// ---- a device that holds the input back ----

// gatedDevice is a terminal's input as the queue applies it: each write or resize announces itself and waits for the
// test to let it through, and the order they were let through in is the order they were applied in.
type gatedDevice struct {
	mu      sync.Mutex
	applied []string
	entered chan string
	gate    chan struct{}
	opened  bool
}

func newGatedDevice() *gatedDevice {
	return &gatedDevice{mu: sync.Mutex{}, applied: nil, entered: make(chan string, 4096), gate: make(chan struct{}, 4096), opened: false}
}

func (d *gatedDevice) apply(what string) {
	d.entered <- what
	<-d.gate
	d.mu.Lock()
	d.applied = append(d.applied, what)
	d.mu.Unlock()
}

func (d *gatedDevice) Write(p []byte) (int, error) {
	d.apply("w:" + string(p))
	return len(p), nil
}

func (d *gatedDevice) Resize(rows, cols uint16) error {
	d.apply(fmt.Sprintf("r:%dx%d", rows, cols))
	return nil
}

// openAll lets every call through, now and later.
func (d *gatedDevice) openAll() {
	d.mu.Lock()
	defer d.mu.Unlock()
	if !d.opened {
		d.opened = true
		close(d.gate)
	}
}

func (d *gatedDevice) log() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return slices.Clone(d.applied)
}

// waitEntered waits for the next call that reaches the device.
func (d *gatedDevice) waitEntered(t *testing.T) string {
	t.Helper()
	select {
	case what := <-d.entered:
		return what
	case <-time.After(settle):
		require.Fail(t, "no input reached the device")
		return ""
	}
}

// useDevice replaces the input queue of a session by one over dev, so that a test decides when an input is applied.
func (s *session) useDevice(dev device) {
	s.mu.Lock()
	old := s.queue
	s.queue = newInputQueue(dev, queueLimits{ops: MaxPendingOps, bytes: MaxPendingBytes, ahead: MaxSeqAhead, gapWait: GapWait})
	s.mu.Unlock()
	old.close(errors.New("replaced by the test"))
}

// ---- the counting sequence ----

// The terminals of the hidden-page tests write the counting sequence "1\n2\n3\n...": every byte of it is known from its
// offset, so that what a ring holds, or what a page took, is checked byte by byte against what the child wrote.

// countingBand is the lines of the counting sequence that have digits digits.
type countingBand struct {
	digits    int
	first     uint64
	lines     uint64
	startByte uint64
}

func countingBands() []countingBand {
	var bands []countingBand
	var at uint64
	first, lines := uint64(1), uint64(9)
	for digits := 1; digits <= 12; digits++ {
		bands = append(bands, countingBand{digits: digits, first: first, lines: lines, startByte: at})
		at += lines * uint64(digits+1)
		first *= 10
		lines *= 10
	}
	return bands
}

// countingLen is how long the first n lines of the sequence are.
func countingLen(n uint64) uint64 {
	var total uint64
	for _, band := range countingBands() {
		take := min(n, band.lines)
		total += take * uint64(band.digits+1)
		n -= take
		if n == 0 {
			break
		}
	}
	return total
}

// countingBytes is n bytes of the sequence, from the offset from.
func countingBytes(from, n uint64) []byte {
	out := make([]byte, 0, n)
	var band countingBand
	for _, b := range countingBands() {
		if from >= b.startByte && from < b.startByte+b.lines*uint64(b.digits+1) {
			band = b
			break
		}
	}
	width := uint64(band.digits + 1)
	line := band.first + (from-band.startByte)/width
	skip := (from - band.startByte) % width
	for uint64(len(out)) < n {
		text := strconv.FormatUint(line, 10) + "\n"
		out = append(out, text[skip:]...)
		skip = 0
		line++
	}
	return out[:n]
}

// gate is a named pipe that holds a flooding child back until the test lets it go, so that nothing is typed into its terminal: a
// line typed before the shell has switched the echo off is echoed into the output, and moves every offset of what follows. The
// zero gate holds nothing back.
type gate struct{ path string }

func newGate(t *testing.T) gate {
	t.Helper()
	path := filepath.Join(t.TempDir(), "go")
	require.NoError(t, syscall.Mkfifo(path, 0o600))
	return gate{path: path}
}

// wait is the shell's side of the gate: nothing for the zero gate.
func (g gate) wait() string {
	if g.path == "" {
		return ""
	}
	return "read go < '" + g.path + "'; "
}

// release lets the child go: it opens the pipe for writing once the child has opened it for reading, and writes it a line. The open
// does not wait for the child (a non-blocking open of a pipe that nothing has open for reading is refused with ENXIO), so that a
// child that never opens the pipe is a failure at the bound, with a message, and not a test that hangs until the binary's timeout.
func (g gate) release(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(settle)
	for {
		file, err := os.OpenFile(g.path, os.O_WRONLY|syscall.O_NONBLOCK, 0)
		if err == nil {
			_, err = file.WriteString("go\n")
			require.NoError(t, err)
			require.NoError(t, file.Close())
			return
		}
		require.ErrorIs(t, err, syscall.ENXIO, "the only reason the gate cannot be opened is that the child has not opened it yet")
		require.True(t, time.Now().Before(deadline), "the child never opened the gate")
		time.Sleep(time.Millisecond)
	}
}

// countingScript is a shell script that writes the counting sequence, in blocks, to a terminal whose output is not
// processed (a line that ended with a newline would come out with a carriage return too, and some systems add a second
// one under load): lines of it, or for ever when lines is below zero. It waits for the gate first, so that a page can be there
// before the first byte. A bounded sequence is followed by a program that stays.
//
// The shell forks nothing: it execs perl, which sets the terminal's modes, waits for the gate and writes. A shell that forks a
// child on a loaded machine can print a diagnostic of its own (bash as sh on macOS: "sh: child setpgid (n to n): Operation not
// permitted"), which would be the first bytes of a stream whose every offset the tests know.
func countingScript(lines int, hold gate) string {
	limit := "1e18"
	if lines >= 0 {
		limit = strconv.Itoa(lines)
	}
	wait := ""
	if hold.path != "" {
		wait = `open(my $g, "<", "` + hold.path + `") or exit 2; my $line = <$g>; close($g); `
	}
	return `exec perl -e 'system("stty -opost -echo"); ` + wait + `$|=1; my ($i,$n)=(1,` + limit + `); while ($i <= $n) { my $stop=$i+3999; $stop=$n if $stop>$n; my $s=""; $s.="$_\n" for $i..$stop; $i=$stop+1; syswrite(STDOUT,$s) or exit 1 } exec("sleep", "3600")'`
}

func TestTheCountingSequenceHelperIsRight(t *testing.T) {
	var all bytes.Buffer
	for i := 1; i <= 20000; i++ {
		all.WriteString(strconv.Itoa(i) + "\n")
	}
	want := all.Bytes()
	require.EqualValues(t, len(want), countingLen(20000))
	for _, from := range []uint64{0, 1, 2, 17, 18, 19, 20, 100, 1888, 1889, 1890, 9999, 10000, 77777} {
		for _, n := range []uint64{1, 5, 64, 1000} {
			if from+n > uint64(len(want)) {
				continue
			}
			require.Equal(t, want[from:from+n], countingBytes(from, n), "from %d, %d bytes", from, n)
		}
	}
	require.EqualValues(t, 18, countingLen(9))
	require.EqualValues(t, 3, countingLen(10)-countingLen(9), "line 10 has three bytes")
}
