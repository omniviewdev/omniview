//go:build !windows

package terminal

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
)

// testKey is a page key: a page makes a random one; the tests use these.
const (
	testKey      = "page-0123456789abcdef-A"
	otherTestKey = "page-fedcba9876543210-B"
)

// event is one OutputAt as the page got it.
type event struct {
	offset uint64
	data   []byte
}

// pageSink is the sink of the exec lane for terminals that have a page key: the output comes with its offset.
// It keeps every event of every session, in order, as the stream of record, tells which of its two methods was
// called, and hands each event to a hook, which is the page.
type pageSink struct {
	mu     sync.Mutex
	events map[string][]event
	plain  map[string]int
	ends   map[string][]End
	hook   func(id string, offset uint64, data []byte)
	// discard keeps the sizes and no bytes: for a test of many terminals whose memory is what is measured.
	discard bool
	bytes   map[string]uint64
}

func newPageSink() *pageSink {
	return &pageSink{events: map[string][]event{}, plain: map[string]int{}, ends: map[string][]End{}, bytes: map[string]uint64{}}
}

// setHook sets what each OutputAt is handed to: the page.
func (p *pageSink) setHook(hook func(id string, offset uint64, data []byte)) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.hook = hook
}

// tombstoneCount is how many ended terminals the manager remembers.
func (m *Manager) tombstoneCount() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return len(m.tombs)
}

func (p *pageSink) Output(id string, data []byte) {
	p.mu.Lock()
	p.plain[id]++
	p.mu.Unlock()
	_ = data
}

func (p *pageSink) OutputAt(id string, offset uint64, data []byte) {
	p.mu.Lock()
	if !p.discard {
		p.events[id] = append(p.events[id], event{offset: offset, data: data})
	}
	p.bytes[id] += uint64(len(data))
	hook := p.hook
	p.mu.Unlock()
	if hook != nil {
		hook(id, offset, data)
	}
}

func (p *pageSink) Closed(id string, end End) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ends[id] = append(p.ends[id], end)
}

// stream is everything the session wrote, from the events, which must be contiguous: each starts where the one
// before ended.
func (p *pageSink) stream(t *testing.T, id string) []byte {
	t.Helper()
	p.mu.Lock()
	defer p.mu.Unlock()
	var out []byte
	for i, e := range p.events[id] {
		require.Equal(t, uint64(len(out)), e.offset, "event %d of %s does not start where the one before ended", i, id)
		out = append(out, e.data...)
	}
	return out
}

// raw is the bytes of the events as they came, with no check: for a poll.
func (p *pageSink) raw(id string) string {
	p.mu.Lock()
	defer p.mu.Unlock()
	var out strings.Builder
	for _, e := range p.events[id] {
		out.Write(e.data)
	}
	return out.String()
}

// waitFor waits until the session has written want, and returns what it has written.
func (p *pageSink) waitFor(t *testing.T, id, want string) string {
	t.Helper()
	require.Eventually(t, func() bool { return strings.Contains(p.raw(id), want) }, 30*time.Second, 5*time.Millisecond,
		"session %s never wrote %q; it wrote %q", id, want, p.raw(id))
	return p.raw(id)
}

func (p *pageSink) plainCalls(id string) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.plain[id]
}

func (p *pageSink) closes(id string) []End {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]End(nil), p.ends[id]...)
}

func (p *pageSink) waitEnd(t *testing.T, id string) End {
	t.Helper()
	require.Eventually(t, func() bool { return len(p.closes(id)) > 0 }, 30*time.Second, 10*time.Millisecond, "session %s never closed", id)
	ends := p.closes(id)
	require.Len(t, ends, 1, "exactly one CLOSE for %s", id)
	return ends[0]
}

func newPageManager(t *testing.T) (*Manager, *pageSink) {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	sink := newPageSink()
	ctx, cancel := context.WithCancel(context.Background())
	m := NewManager(ctx, logging.NewNop(), sink)
	t.Cleanup(func() {
		for _, id := range m.running() {
			_ = m.CloseSession(id)
		}
		cancel()
	})
	return m, sink
}

// isHeld says the reader is held, as it is while nobody is attached.
func (f *flowControl) isHeld() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.held
}

// state is what a test reads of the session's lease and owner at one moment.
func (s *session) state() (bool, Owner, bool, uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.detached, s.owner, s.leaseTimer != nil, s.leaseGen
}

// startKeyed starts a terminal with a page key that runs script, for owner.
func (m *Manager) startKeyed(t *testing.T, script string, owner Owner, opts Options) Session {
	t.Helper()
	opts.Command = []string{sh(t), "-c", script}
	if opts.PageKey == "" {
		opts.PageKey = testKey
	}
	info, err := m.Start(opts, owner)
	require.NoError(t, err)
	return info
}

// quiet waits until the session's output has not moved for a quarter of a second, and says where it stands.
func quiet(t *testing.T, m *Manager, id string) uint64 {
	t.Helper()
	s := m.session(t, id)
	last := ^uint64(0)
	stable := 0
	require.Eventually(t, func() bool {
		now := s.next()
		if now == last {
			stable++
		} else {
			stable, last = 0, now
		}
		return stable >= 10
	}, 30*time.Second, 25*time.Millisecond, "the output of %s never settled", id)
	return last
}

// testPage is the page of the protocol in docs/ui-next/status/T2-go.md: it takes the events in order, drops what
// it has, and when it comes back it listens first, then attaches, holds what arrives while the call is in flight,
// applies the replay, and then those events, dropping what the replay covers.
type testPage struct {
	m  *Manager
	id string

	mu        sync.Mutex
	alive     bool
	attaching bool
	pending   []event
	next      uint64
	data      bytes.Buffer
	gaps      int
	dups      int
	partial   int
	// onEvent is told, outside the lock, after each event the page applied: a test uses it to kill the page at a
	// place of its choosing.
	onEvent func(p *testPage)
}

func newTestPage(m *Manager, id string) *testPage { return &testPage{m: m, id: id, alive: true} }

// take is the page's listener for the session.
func (p *testPage) take(offset uint64, data []byte) {
	p.mu.Lock()
	if !p.alive {
		p.mu.Unlock()
		return
	}
	if p.attaching {
		p.pending = append(p.pending, event{offset: offset, data: data})
		p.mu.Unlock()
		return
	}
	applied := p.apply(offset, data)
	hook := p.onEvent
	p.mu.Unlock()
	if hook != nil {
		hook(p)
	}
	p.mu.Lock()
	alive := p.alive
	p.mu.Unlock()
	if alive && applied {
		// What the page rendered is acknowledged, and only that: an event it dropped, because the replay has it,
		// was counted by the host before the attach forgot the debt, and is not acknowledged.
		_ = p.m.Ack(p.id, len(data))
	}
}

// apply is the rule of the protocol: an event below what the page has is dropped, one at what it has is
// appended, one above it is a gap. It says whether the event was appended.
func (p *testPage) apply(offset uint64, data []byte) bool {
	switch end := offset + uint64(len(data)); {
	case end <= p.next:
		p.dups++
	case offset < p.next:
		p.partial++
	case offset > p.next:
		p.gaps++
	default:
		p.data.Write(data)
		p.next = end
		return true
	}
	return false
}

// die is the page going away: nothing is taken or acknowledged from now on.
func (p *testPage) die() {
	p.mu.Lock()
	p.alive = false
	p.mu.Unlock()
}

// have is the offset the page asks to attach from: the length of what it rendered.
func (p *testPage) have() uint64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.next
}

// comeBack is the page after a reload: listen, attach as owner with the key, apply the replay, then what came in
// meanwhile. It returns the answer.
func (p *testPage) comeBack(t *testing.T, owner Owner, key string) *Attached {
	t.Helper()
	p.mu.Lock()
	p.alive, p.attaching, p.pending = true, true, nil
	from := p.next
	p.mu.Unlock()

	got, err := p.m.Attach(p.id, owner, AttachRequest{PageKey: key, FromOffset: &from})
	require.NoError(t, err)

	p.mu.Lock()
	rep := got.Replay
	switch {
	case rep.Start > p.next:
		// The host no longer has what the page lacks: a page starts afresh.
		p.gaps++
		p.data.Reset()
		p.data.Write(rep.Data)
	default:
		p.data.Write(rep.Data[p.next-rep.Start:])
	}
	p.next = rep.End
	pending := p.pending
	p.pending, p.attaching = nil, false
	acknowledge := 0
	for _, e := range pending {
		if p.apply(e.offset, e.data) {
			acknowledge += len(e.data)
		}
	}
	p.mu.Unlock()
	if acknowledge > 0 {
		_ = p.m.Ack(p.id, acknowledge)
	}
	return got
}

func (p *testPage) bytes() []byte {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]byte(nil), p.data.Bytes()...)
}

func (p *testPage) faults() (int, int, int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.gaps, p.dups, p.partial
}

// numbered is what `seq 1 n` prints through a pty: a number to a line, the line ended by CR LF.
func numbered(n int) []byte {
	var b bytes.Buffer
	for i := 1; i <= n; i++ {
		b.WriteString(strconv.Itoa(i))
		b.WriteString("\r\n")
	}
	return b.Bytes()
}

// cpuTime is the CPU time a process has used: from /proc where there is one, from ps where there is not.
func cpuTime(t *testing.T, pid int) time.Duration {
	t.Helper()
	if raw, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat"); err == nil {
		// The command is in parentheses and may hold spaces: the fields after the last one are the ones counted.
		fields := strings.Fields(string(raw[bytes.LastIndexByte(raw, ')')+1:]))
		user, errUser := strconv.ParseInt(fields[11], 10, 64)
		system, errSystem := strconv.ParseInt(fields[12], 10, 64)
		require.NoError(t, errUser)
		require.NoError(t, errSystem)
		const ticksPerSecond = 100
		return time.Duration(user+system) * time.Second / ticksPerSecond
	}
	out, err := exec.Command("ps", "-o", "time=", "-p", strconv.Itoa(pid)).Output()
	require.NoError(t, err)
	var total time.Duration
	for _, part := range strings.Split(strings.TrimSpace(string(out)), ":") {
		seconds, parseErr := strconv.ParseFloat(part, 64)
		require.NoError(t, parseErr, "ps said %q", out)
		total = total*60 + time.Duration(seconds*float64(time.Second))
	}
	return total
}

// heapInUse is the live heap after a collection.
func heapInUse() uint64 {
	runtime.GC()
	runtime.GC()
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)
	return stats.HeapAlloc
}
