package marks

import (
	"bytes"
	"math/rand/v2"
	"runtime"
	"strings"
	"testing"
)

const flood = 16 << 20

// feedChunks feeds data in reads of size n, reusing one slice for the marks as the manager's reader does.
func feedChunks(s *Scanner, data []byte, n int) {
	out := make([]Mark, 0, n)
	for len(data) > 0 {
		k := min(n, len(data))
		out = s.Feed(data[:k], out[:0])
		data = data[k:]
	}
}

func heapInUse() uint64 {
	runtime.GC()
	var m runtime.MemStats
	runtime.ReadMemStats(&m)
	return m.HeapAlloc
}

func TestAMegabyteOSCIsDroppedCountedAndTheScannerRecovers(t *testing.T) {
	big := strings.Repeat("a", 1<<20)
	cases := map[string]string{
		"command line": "633;E;" + big + ";" + testNonce,
		"directory":    "7;file://h/" + big,
		"prompt":       "133;A;" + big,
	}
	for name, body := range cases {
		for _, wrap := range []func(string) string{osc, oscST} {
			s := newTestScanner(t, newClock(), 0)
			ms := feedAll(s, wrap(body))
			if len(ms) != 0 {
				t.Fatalf("%s: a megabyte of payload gives marks", name)
			}
			if st := s.Stats(); st.Oversize != 1 || st.Forged != 0 {
				t.Fatalf("%s: the payload is not counted as dropped: %+v", name, st)
			}
			ms = feedAll(s, cycle("ls", "out", "0"))
			sameKinds(t, ms, KindPromptStart, KindInputStart, KindCommandStart, KindCommandEnd)
			if ms[2].CommandLine != "ls" || ms[2].Trust != TrustNonce {
				t.Fatalf("%s: the scanner does not recover: %+v", name, ms[2])
			}
		}
	}
	// The same megabyte of a title is nothing to count, and a cut inside it changes nothing.
	s := newTestScanner(t, newClock(), 0)
	data := []byte(osc("0;"+big) + cycle("ls", "out", "0"))
	ms := s.Feed(data[:1<<19], nil)
	ms = s.Feed(data[1<<19:], ms)
	sameKinds(t, ms, KindPromptStart, KindInputStart, KindCommandStart, KindCommandEnd)
	if st := s.Stats(); st.Oversize != 0 || st.Malformed != 0 || st.Forged != 0 {
		t.Fatalf("a long title is counted: %+v", st)
	}
}

// floodBlock is a block of a session of 64 KiB: genuine commands, forged marks and output, cut anywhere by reads.
func floodBlock() []byte {
	var b bytes.Buffer
	lines := strings.Repeat("output output output\r\n", 40)
	for b.Len() < 64<<10 {
		b.WriteString(cycle("make all", lines, "0"))
		b.WriteString(osc("633;E;" + strings.Repeat("x", MaxCommandLine) + ";" + wrongNonce))
		b.WriteString(osc("7;file://h/" + strings.Repeat("d", 1000)))
		b.WriteString(osc("133;A") + osc("133;C") + osc("133;D;1"))
	}
	return b.Bytes()
}

func TestTheRecordStaysBoundedUnderA16MBFlood(t *testing.T) {
	const max = 64
	s := newTestScanner(t, newClock(), max)
	block := floodBlock()
	before := heapInUse()
	for fed := 0; fed < flood; fed += len(block) {
		feedChunks(s, block, 32<<10)
	}
	total := (flood/len(block) + 1) * len(block)
	if got := len(s.Log().Records()); got > max {
		t.Fatalf("the log keeps %d commands, want at most %d", got, max)
	}
	if last, ok := s.Log().Last(); !ok || last.CommandID == "c1" {
		t.Fatalf("the log does not follow the newest command: %v", last)
	}
	if st := s.Stats(); st.Bytes != uint64(total) || s.Offset() != uint64(total) {
		t.Fatalf("the scanner counts %d bytes, want %d", st.Bytes, total)
	}
	if after := heapInUse(); after > before+(4<<20) {
		t.Fatalf("the heap grew from %d to %d bytes under a flood", before, after)
	}
	runtime.KeepAlive(s)
}

func TestTheRecordStaysBoundedWhateverTheFloodIsMadeOf(t *testing.T) {
	floods := map[string]string{
		"prompts only":       osc("133;A") + "x",
		"starts only":        osc("133;C") + "x",
		"ends only":          osc("133;D;1") + "x",
		"prompt and end":     osc("133;A") + osc("133;D;1"),
		"long lines":         osc("133;A") + osc("633;E;"+strings.Repeat("y", 3000)+";"+testNonce) + osc("133;C") + osc("133;D;0"),
		"directories":        osc("7;file://h/" + strings.Repeat("z", 3000)),
		"unfinished strings": "\x1b]633;E;" + strings.Repeat("y", 100),
	}
	for name, unit := range floods {
		s := newTestScanner(t, newClock(), 16)
		data := []byte(strings.Repeat(unit, (1<<20)/len(unit)))
		before := heapInUse()
		for range 4 {
			feedChunks(s, data, 32<<10)
		}
		if st := s.Stats(); st.Bytes != uint64(4*len(data)) {
			t.Fatalf("%s: the scanner counts %d bytes, want %d", name, st.Bytes, 4*len(data))
		}
		if got := len(s.Log().Records()); got > 16 {
			t.Fatalf("%s: the log keeps %d commands, want at most 16", name, got)
		}
		if after := heapInUse(); after > before+(2<<20) {
			t.Fatalf("%s: the heap grew from %d to %d bytes", name, before, after)
		}
		runtime.KeepAlive(s)
	}
}

func TestTheScannerNeverChangesAByte(t *testing.T) {
	rng := rand.New(rand.NewPCG(7, 11))
	alphabet := []byte("\x1b\x1b\x1b]]];;;1377 \a\\\x18\x1a[PX^_ADCEB0123456789abc\r\n\x9d\x9c\xc3\xa9%/:")
	for range 200 {
		data := make([]byte, 1+rng.IntN(4096))
		for i := range data {
			if rng.IntN(4) == 0 {
				data[i] = byte(rng.IntN(256))
			} else {
				data[i] = alphabet[rng.IntN(len(alphabet))]
			}
		}
		keep := bytes.Clone(data)
		s := newTestScanner(t, newClock(), 0)
		for rest := data; len(rest) > 0; {
			k := min(1+rng.IntN(300), len(rest))
			s.Feed(rest[:k], nil)
			rest = rest[k:]
		}
		if !bytes.Equal(data, keep) {
			t.Fatal("the scanner changed the bytes it was given")
		}
		if s.Offset() != uint64(len(data)) {
			t.Fatalf("the offset is %d after %d bytes", s.Offset(), len(data))
		}
	}
	data := []byte(sessionStream())
	keep := bytes.Clone(data)
	feedAll(newTestScanner(t, newClock(), 0), string(data))
	s := newTestScanner(t, newClock(), 0)
	s.Feed(data, nil)
	if !bytes.Equal(data, keep) {
		t.Fatal("the scanner changed the bytes of a session")
	}
}

func TestReadsOfOrdinaryOutputAllocateNothing(t *testing.T) {
	s := newTestScanner(t, newClock(), 4)
	out := make([]Mark, 0, 64)
	plain := bytes.Repeat([]byte("the quick brown fox\r\n"), 1500)
	colors := bytes.Repeat([]byte("\x1b[1;31mred\x1b[0m \x1b[38;2;1;2;3mx\x1b[?25l"), 500)
	strs := []byte(osc("0;a title") + osc("52;c;YWJj") + "\x1bP1$r0m\x1b\\" + osc("133;L") + osc("1337;SetMark") + osc("633;F"))
	cwd := []byte(osc("7;file://h/home/me/work") + osc("633;P;Cwd=/home/me/work;"+testNonce))
	split := [][]byte{[]byte("text \x1b]633;E;ls -l;"), []byte(testNonce[:5]), []byte(testNonce[5:] + "\a\x1b]133;D;0\x1b"), []byte("\\more")}
	cycleBytes := []byte(osc("133;A") + "$ " + osc("133;B") + "ls\r\n" + osc("133;C") + "out\r\n" + osc("133;D;0"))
	if ms := feedAll(s, cycle("ls", "out", "0")); len(ms) != 4 {
		t.Fatalf("a command gives %d marks, want 4", len(ms))
	}
	for name, p := range map[string][]byte{"plain": plain, "colors": colors, "strings": strs, "directory": cwd} {
		s.Feed(p, out[:0])
		if n := testing.AllocsPerRun(50, func() { out = s.Feed(p, out[:0]) }); n != 0 {
			t.Fatalf("%s: a read allocates %v times, want 0", name, n)
		}
	}
	if n := testing.AllocsPerRun(50, func() {
		for _, p := range split {
			out = s.Feed(p, out[:0])
		}
	}); n > 1 {
		t.Fatalf("a read cut inside a sequence allocates %v times, want at most 1", n)
	}
	if out = s.Feed(cycleBytes, out[:0]); len(out) != 4 {
		t.Fatalf("a command gives %d marks, want 4", len(out))
	}
	// A whole command allocates its id and nothing else.
	for range 10 {
		s.Feed(cycleBytes, out[:0])
	}
	if n := testing.AllocsPerRun(50, func() { out = s.Feed(cycleBytes, out[:0]) }); n > 1 {
		t.Fatalf("a command allocates %v times, want at most 1", n)
	}
}

func FuzzFeed(f *testing.F) {
	f.Add([]byte(sessionStream()))
	f.Add([]byte("\x1b]7;file://h/a\x1b[31m\x18\x1b]133;D;9999999999999\a\x1bP\x1b\\"))
	f.Add([]byte("\x1b]633;E;a\\x\\\\x00;" + testNonce + "\a\x1b]633;P;Cwd=;" + testNonce))
	f.Fuzz(func(t *testing.T, data []byte) {
		keep := bytes.Clone(data)
		whole := newTestScanner(t, newClock(), 8)
		wholeMarks := whole.Feed(data, nil)
		cut := len(data) / 2
		halves := newTestScanner(t, newClock(), 8)
		halfMarks := halves.Feed(data[:cut], nil)
		halfMarks = halves.Feed(data[cut:], halfMarks)
		if !bytes.Equal(data, keep) {
			t.Fatal("the scanner changed the bytes")
		}
		if bytes.Equal(data, []byte(sessionStream())) && len(wholeMarks) != 6 {
			t.Fatalf("the session gives %d marks, want 6", len(wholeMarks))
		}
		if len(wholeMarks) != len(halfMarks) {
			t.Fatalf("a cut at %d changes the marks: %d against %d", cut, len(wholeMarks), len(halfMarks))
		}
		for _, m := range wholeMarks {
			if strings.ContainsAny(m.Cwd, "\x00\x01\x02\x03\x04\x05\x06\a\b\t\n\v\f\r\x0e\x0f\x10\x11\x12\x13\x14\x15\x16\x17\x18\x19\x1a\x1b\x1c\x1d\x1e\x1f\x7f") {
				t.Fatalf("a directory has a control byte: %q", m.Cwd)
			}
			if len(m.CommandLine) > MaxCommandLine || len(m.Cwd) > MaxCwd {
				t.Fatal("a mark is over its limit")
			}
		}
	})
}
