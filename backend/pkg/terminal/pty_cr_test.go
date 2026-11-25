//go:build !windows

package terminal

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// THE EXTRA CR OF THE TERMINAL OF MACOS. The tty turns each LF a program writes into CR LF. When its output queue is full between the
// CR and the LF, the terminal of macOS keeps the CR, finishes the character later and writes the CR again: the stream has CR CR LF where
// the program wrote one line end. The first CR is then the last byte of a read of the pty master (the queue was full: a read of 1024
// bytes on the machine that found it) and the next read begins with CR LF. It is the kernel's: the bytes are in what the master gives the
// host before any code of the host reads them, and a program that does nothing but read the master of a pty that awk writes to sees them
// too (docs/ui-next/terminal/backend-catalog-terminal.md has the whole account). A flood is what fills the queue, so a test that holds a
// flood to the text the program printed fails now and then on macOS, under load, with one byte too many.
//
// The oracle of such a test is what the kernel gave the host, which Manager.tee holds, and the host's delivery is held to it byte for
// byte: a byte the host lost or repeated at a join is still a failure. What the program printed is checked against that oracle, less
// the CRs that the terminal of macOS adds, and nothing else.

// ptyTee is what the kernel gave the host: the bytes of every read of every pty master of a manager, as Manager.tee is given them,
// and where each read ended.
type ptyTee struct {
	mu    sync.Mutex
	bytes map[string][]byte
	ends  map[string][]int
}

// teePty has the manager tee the reads of its pty masters. It is called before the manager starts a terminal.
func teePty(m *Manager) *ptyTee {
	p := &ptyTee{mu: sync.Mutex{}, bytes: map[string][]byte{}, ends: map[string][]int{}}
	m.tee = p.record
	return p
}

func (p *ptyTee) record(id string, data []byte) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.bytes[id] = append(p.bytes[id], data...)
	p.ends[id] = append(p.ends[id], len(p.bytes[id]))
}

// stream is a copy of what the kernel gave the host for a session so far.
func (p *ptyTee) stream(id string) []byte {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]byte(nil), p.bytes[id]...)
}

// readEnds says where each read of the session's master ended: the offset of the first byte of the next read.
func (p *ptyTee) readEnds(id string) []int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]int(nil), p.ends[id]...)
}

// withoutTheCRsOfMacOS says what the program printed, from what the kernel gave the host and where its reads ended: the stream less
// every CR that ends a read and is followed by CR LF (and the CRs of a run of them), and the offsets of the CRs it took out. A CR
// anywhere else, a line end that lost its CR, any other byte: left as it is, for the comparison to fail on.
func withoutTheCRsOfMacOS(stream []byte, readEnds []int) (text []byte, removed []int) {
	for _, end := range readEnds {
		if end <= 0 || end >= len(stream) || stream[end-1] != '\r' {
			continue
		}
		next := end
		for next < len(stream) && stream[next] == '\r' {
			next++
		}
		if next > end && next < len(stream) && stream[next] == '\n' {
			removed = append(removed, end-1)
		}
	}
	text = make([]byte, 0, len(stream))
	from := 0
	for _, at := range removed {
		text = append(text, stream[from:at]...)
		from = at + 1
	}
	return append(text, stream[from:]...), removed
}

// The tee is given every read of the pty master, in order, and its reads are the bytes the host went on to deliver.
func TestTheTeeHoldsEveryByteTheHostReadFromThePtyBeforeTheHostSawIt(t *testing.T) {
	m, sink := newPageManager(t)
	tee := teePty(m)
	info := m.startKeyed(t, `printf 'one\ntwo\n'`, owner(0), Options{ID: "tee-1"})
	sink.waitEnd(t, info.ID)

	raw := tee.stream(info.ID)
	assert.Equal(t, "one\r\ntwo\r\n", string(raw), "what the pty gave the host: the program's lines, each ended by the CR LF of the tty")
	assert.Equal(t, sink.stream(t, info.ID), raw, "and it is what the host delivered")
	ends := tee.readEnds(info.ID)
	require.NotEmpty(t, ends, "the tee was given at least one read")
	assert.Equal(t, len(raw), ends[len(ends)-1], "the last read ends where the stream does")
	for i := 1; i < len(ends); i++ {
		assert.Greater(t, ends[i], ends[i-1], "every read has bytes")
	}
}

// Only the CR the terminal of macOS adds is taken out: one that ends a read and is followed by CR LF. The program's own CR LF, split by
// a read between its CR and its LF, stays; so does a CR that is not at the end of a read, a line end that lost its CR and a byte that
// is gone.
func TestTheCRsOfTheTerminalOfMacOSAreTheOnlyDifferenceTheFloodChecksLetGo(t *testing.T) {
	text := string(numbered(3))
	cases := []struct {
		name    string
		reads   []string
		want    string
		removed []int
	}{
		{"nothing added", []string{"1\r\n2\r\n3\r\n"}, text, nil},
		{"a CR at the end of a read, before CR LF", []string{"1\r\n2\r", "\r\n3\r\n"}, text, []int{4}},
		{"two in a row, each at the end of a read", []string{"1\r\n2\r", "\r", "\r\n3\r\n"}, text, []int{4, 5}},
		{"two on different lines", []string{"1\r", "\r\n2\r\n3\r", "\r\n"}, text, []int{1, 8}},
		{"the program's own CR LF split between its CR and its LF", []string{"1\r\n2\r", "\n3\r\n"}, text, nil},
		{"the program's own CR LF whole at a read's end", []string{"1\r\n2\r\n", "3\r\n"}, text, nil},
		{"a CR before CR LF that is not at the end of a read", []string{"1\r\n2\r\r\n3\r\n"}, "1\r\n2\r\r\n3\r\n", nil},
		{"a line end that lost its CR", []string{"1\r\n2\n3\r\n"}, "1\r\n2\n3\r\n", nil},
		{"a byte that is gone", []string{"1\r\n", "3\r\n"}, "1\r\n3\r\n", nil},
		{"a CR at the end of the stream", []string{"1\r\n2\r\n3\r\n", "\r"}, "1\r\n2\r\n3\r\n\r", nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var stream []byte
			var ends []int
			for _, read := range c.reads {
				stream = append(stream, read...)
				ends = append(ends, len(stream))
			}
			got, removed := withoutTheCRsOfMacOS(stream, ends)
			assert.Equal(t, c.want, string(got))
			assert.Equal(t, c.removed, removed, "where the CRs were")
		})
	}
}
