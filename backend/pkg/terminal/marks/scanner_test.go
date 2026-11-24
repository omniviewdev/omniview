package marks

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

// sessionStream is a whole session of a shell with the integration script: a directory, a prompt, a command with
// its line, its output with colors, its end, and both terminators.
func sessionStream() string {
	return oscST("7;file://host/home/me") +
		osc("633;P;Cwd=/home/me;"+testNonce) +
		osc("133;A") + "$ " + osc("133;B") + "ls -l\r\n" +
		osc("633;E;ls\\x20-l;"+testNonce) + oscST("133;C") +
		"\x1b[31mred\x1b[0m\r\n" + osc("133;D;2")
}

// feedSplit feeds data cut at the given offsets and returns the marks, the records and the stats.
func feedSplit(t *testing.T, data string, cuts ...int) ([]Mark, []Record, Stats) {
	t.Helper()
	s := newTestScanner(t, newClock(), 0)
	var got []Mark
	prev := 0
	for _, c := range append(cuts, len(data)) {
		got = s.Feed([]byte(data[prev:c]), got)
		prev = c
	}
	return got, s.Log().Records(), s.Stats()
}

func TestMarksAreTheSameWhenTheStreamIsSplitAtEveryOffset(t *testing.T) {
	data := sessionStream()
	want, wantRecs, wantStats := feedSplit(t, data)
	sameKinds(t, want, KindCwd, KindCwd, KindPromptStart, KindInputStart, KindCommandStart, KindCommandEnd)
	if want[4].CommandLine != "ls -l" || want[4].Trust != TrustNonce {
		t.Fatalf("the whole stream does not give the command line with the nonce: %+v", want[4])
	}
	if want[5].ExitCode != 2 || !want[5].HasExitCode {
		t.Fatalf("the whole stream does not give exit 2: %+v", want[5])
	}
	for i := 1; i < len(data); i++ {
		got, recs, stats := feedSplit(t, data, i)
		if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(recs, wantRecs) || stats != wantStats {
			t.Fatalf("a cut at offset %d changes the result:\n got %v\nwant %v", i, got, want)
		}
	}
	// Every byte alone, and every pair of cuts of the shorter part of the stream.
	every := make([]int, 0, len(data))
	for i := 1; i < len(data); i++ {
		every = append(every, i)
	}
	if got, recs, _ := feedSplit(t, data, every...); !reflect.DeepEqual(got, want) || !reflect.DeepEqual(recs, wantRecs) {
		t.Fatalf("one byte at a time changes the result:\n got %v\nwant %v", got, want)
	}
	short := cycle("ls", "out", "0")
	shortWant, _, _ := feedSplit(t, short)
	if len(shortWant) != 4 {
		t.Fatalf("the short stream gives %d marks, want 4", len(shortWant))
	}
	for i := 1; i < len(short); i++ {
		for j := i + 1; j < len(short); j++ {
			if got, _, _ := feedSplit(t, short, i, j); !reflect.DeepEqual(got, shortWant) {
				t.Fatalf("cuts at %d and %d change the result:\n got %v\nwant %v", i, j, got, shortWant)
			}
		}
	}
}

func TestACommandIsOneRecordAddressedByOffset(t *testing.T) {
	clock := newClock()
	s := newTestScanner(t, clock, 0)
	data := osc("633;P;Cwd=/work;"+testNonce) + cycle("make", "building", "3")
	cut := int(at(t, data, "building"))
	started := clock.Now()
	ms := s.Feed([]byte(data[:cut]), nil)
	clock.advance(1500 * time.Millisecond)
	ms = s.Feed([]byte(data[cut:]), ms)
	sameKinds(t, ms, KindCwd, KindPromptStart, KindInputStart, KindCommandStart, KindCommandEnd)
	for _, m := range ms[1:] {
		if m.CommandID != "c1" {
			t.Fatalf("a mark of the command has the id %q, want c1: %v", m.CommandID, m)
		}
	}
	prompt, input, start, end := ms[1], ms[2], ms[3], ms[4]
	if prompt.AtOffset != at(t, data, "\x1b]133;A") || input.AtOffset != at(t, data, "\x1b]133;B") ||
		start.AtOffset != at(t, data, "\x1b]133;C") || end.AtOffset != at(t, data, "\x1b]133;D") {
		t.Fatalf("the marks are not at the first byte of their sequence: %v", ms)
	}
	if end.ExitCode != 3 || !end.HasExitCode || end.DurationMS != 1500 {
		t.Fatalf("the end is not exit 3 after 1500 ms: %+v", end)
	}
	rec := only(t, s)
	want := Record{
		CommandID: "c1", State: StateEnded, Ran: true, CommandLine: "make", Trust: TrustNonce,
		Cwd: "/work", CwdTrust: TrustNonce, ExitCode: 3, HasExitCode: true,
		StartedAt: started, EndedAt: started.Add(1500 * time.Millisecond),
		PromptOffset: prompt.AtOffset,
		OutputStart:  start.AtOffset + uint64(len(osc("133;C"))),
		OutputEnd:    end.AtOffset,
	}
	if rec != want {
		t.Fatalf("the record is\n %v\nwant %v", rec, want)
	}
	if got := data[rec.OutputStart:rec.OutputEnd]; got != "building\r\n" {
		t.Fatalf("the output offsets give %q, want the output", got)
	}
}

func TestAnEndWithNoCodeHasNoExitCode(t *testing.T) {
	for _, end := range []string{osc("133;D"), osc("133;D;"), osc("133;D;abc"), osc("133;D;99999999999")} {
		s := newTestScanner(t, newClock(), 0)
		ms := feedAll(s, osc("133;A")+osc("133;C")+end)
		sameKinds(t, ms, KindPromptStart, KindCommandStart, KindCommandEnd)
		if ms[2].HasExitCode {
			t.Fatalf("%q gives an exit code: %+v", end, ms[2])
		}
		if rec := only(t, s); rec.State != StateEnded || !rec.Ran || rec.HasExitCode {
			t.Fatalf("%q does not end the command without a code: %v", end, rec)
		}
	}
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, osc("133;A")+osc("133;C")+osc("133;D;0;aid=7"))
	if !ms[2].HasExitCode || ms[2].ExitCode != 0 {
		t.Fatalf("D;0;aid=7 is not exit 0: %+v", ms[2])
	}
}

func TestAnEndWithoutAStartIsAPromptThatRanNothing(t *testing.T) {
	// Ctrl-C at an empty prompt: the shell ends the prompt it showed, then shows the next.
	clock := newClock()
	s := newTestScanner(t, clock, 0)
	ms := feedAll(s, osc("133;A")+"$ "+osc("133;B")+"^C"+osc("133;D;130")+osc("133;A")+"$ "+osc("133;B"))
	sameKinds(t, ms, KindPromptStart, KindInputStart, KindCommandEnd, KindPromptStart, KindInputStart)
	if ms[2].CommandID != "c1" || ms[3].CommandID != "c2" || ms[4].CommandID != "c2" {
		t.Fatalf("the ids are %q %q %q, want c1 c2 c2", ms[2].CommandID, ms[3].CommandID, ms[4].CommandID)
	}
	if ms[2].DurationMS != 0 || ms[2].ExitCode != 130 {
		t.Fatalf("the end of a prompt that ran nothing: %+v", ms[2])
	}
	recs := s.Log().Records()
	if len(recs) != 2 || recs[0].State != StateEnded || recs[0].Ran || recs[0].ExitCode != 130 ||
		recs[0].OutputStart != 0 || recs[0].OutputEnd != 0 || recs[1].State != StateInput {
		t.Fatalf("the records are %v", recs)
	}
	if _, running := s.Log().Running(); running {
		t.Fatal("a prompt that ran nothing is running")
	}
}

func TestARepeatedPromptIsTheSameCommandRedrawn(t *testing.T) {
	for _, second := range []string{osc("133;A"), osc("133;A;redraw=1"), osc("133;A;k=s")} {
		s := newTestScanner(t, newClock(), 0)
		ms := feedAll(s, osc("133;A")+"$ "+second+"$ "+osc("133;B"))
		sameKinds(t, ms, KindPromptStart, KindPromptStart, KindInputStart)
		if ms[0].Redraw || !ms[1].Redraw {
			t.Fatalf("%q: the first prompt is redrawn %v and the second %v", second, ms[0].Redraw, ms[1].Redraw)
		}
		if ms[0].CommandID != "c1" || ms[1].CommandID != "c1" || ms[2].CommandID != "c1" {
			t.Fatalf("%q: a redrawn prompt is not one command: %v", second, ms)
		}
		only(t, s)
	}
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, cycle("ls", "x", "0")+osc("133;A"))
	if last := ms[len(ms)-1]; last.CommandID != "c2" || last.Redraw {
		t.Fatalf("the prompt after an end is not a new command: %+v", last)
	}
}

func TestACommandMayStartWithoutAnInputMarkOrAPrompt(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, osc("133;A")+osc("133;C")+"out"+osc("133;D;0"))
	sameKinds(t, ms, KindPromptStart, KindCommandStart, KindCommandEnd)
	if rec := only(t, s); !rec.Ran || rec.State != StateEnded || rec.CommandID != "c1" {
		t.Fatalf("C without B: %v", rec)
	}
	s = newTestScanner(t, newClock(), 0)
	ms = feedAll(s, osc("133;C")+"out"+osc("133;D;1")+osc("133;B"))
	sameKinds(t, ms, KindCommandStart, KindCommandEnd, KindInputStart)
	if ms[0].CommandID != "c1" || ms[1].CommandID != "c1" || ms[2].CommandID != "c2" {
		t.Fatalf("C and B with no prompt do not open commands: %v", ms)
	}
	if recs := s.Log().Records(); len(recs) != 2 || recs[0].ExitCode != 1 || recs[1].State != StateInput {
		t.Fatalf("the records are %v", recs)
	}
}

func TestAnEndWithNoCommandOpenIsKeptAsAMarkOnly(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, osc("133;D;0"))
	sameKinds(t, ms, KindCommandEnd)
	if ms[0].CommandID != "" {
		t.Fatalf("an end of no command has the id %q", ms[0].CommandID)
	}
	if n := len(s.Log().Records()); n != 0 {
		t.Fatalf("an end of no command makes %d records", n)
	}
}

func TestAnOutputMarkInsideARunningCommandDoesNotEndIt(t *testing.T) {
	// A program in the command prints a prompt mark and a second start: the command goes on, and the real end ends it.
	s := newTestScanner(t, newClock(), 0)
	feedAll(s, osc("133;A")+osc("133;B")+osc("133;C")+osc("133;A")+osc("133;C")+osc("133;B"))
	rec, running := s.Log().Running()
	if !running || rec.CommandID != "c1" || len(s.Log().Records()) != 1 {
		t.Fatalf("a mark in the output of a command changed it: %v running=%v", s.Log().Records(), running)
	}
	feedAll(s, osc("133;D;0"))
	if _, running := s.Log().Running(); running {
		t.Fatal("the command is still running after its end")
	}
}

func TestForeignPromptFrameworksDriveNavigationAtLowTrust(t *testing.T) {
	// powerlevel10k, starship and oh-my-zsh print their own marks, and so does the integration script after them.
	cases := map[string]string{
		"p10k": osc("133;A") + osc("133;A") + "> " + osc("133;B") + osc("133;B") + osc("133;C") + "x" + osc("133;D;0"),
		"starship": oscST("133;A") + "❯ " + oscST("133;B") + oscST("133;C") + "x" +
			oscST("133;D;0") + osc("7;file://host/home/me"),
		"oh-my-zsh": osc("133;A;cl=m;aid=12345") + osc("133;B") + osc("7;file://host/home/me") +
			osc("133;C;aid=12345") + "x" + osc("133;D;0;aid=12345"),
	}
	for name, data := range cases {
		s := newTestScanner(t, newClock(), 0)
		ms := feedAll(s, data)
		if len(ms) < 4 {
			t.Fatalf("%s: %d marks", name, len(ms))
		}
		for _, m := range ms {
			if m.Trust != TrustUnverified || m.CommandLine != "" {
				t.Fatalf("%s: a foreign mark is trusted or carries a line: %+v", name, m)
			}
		}
		rec := only(t, s)
		if rec.State != StateEnded || !rec.Ran || rec.ExitCode != 0 || rec.Trust != TrustUnverified || rec.CommandLine != "" {
			t.Fatalf("%s: the record is %v", name, rec)
		}
	}
}

func TestMarksInsideStringsAndCancelledSequencesAreNotMarks(t *testing.T) {
	cases := map[string]string{
		"dcs":         "\x1bPq]133;A\a\x1b\\",
		"apc":         "\x1b_]133;A\a\x1b\\",
		"pm":          "\x1b^133;A\x1b\\",
		"sos":         "\x1bX133;A\x1b\\",
		"cancelled":   "\x1b]133;A\x18\a",
		"substituted": "\x1b]133;A\x1a\a",
		"csi":         "\x1b[1;2]133;A\a",
		"c1 osc":      "\x9d133;A\a",
		"text":        "]133;A\a",
	}
	for name, data := range cases {
		s := newTestScanner(t, newClock(), 0)
		if ms := feedAll(s, data); len(ms) != 0 {
			t.Fatalf("%s: %q gives marks %v", name, data, ms)
		}
		// And the sequence that follows is read: the text was skipped, not swallowed.
		if ms := feedAll(s, "\x1b\\"+osc("133;A")); len(ms) != 1 {
			t.Fatalf("%s: the scanner does not go on after %q: %v", name, data, ms)
		}
	}
}

func TestAnEscapeStartsANewSequenceAndEndsTheOneItInterrupts(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, "\x1b]133;A\x1b]133;B\a")
	sameKinds(t, ms, KindPromptStart, KindInputStart)
	if ms[0].AtOffset != 0 || ms[1].AtOffset != 7 {
		t.Fatalf("the offsets are %d and %d, want 0 and 7", ms[0].AtOffset, ms[1].AtOffset)
	}
	s = newTestScanner(t, newClock(), 0)
	ms = feedAll(s, "\x1b\x1b]133;A\a")
	sameKinds(t, ms, KindPromptStart)
	if ms[0].AtOffset != 1 {
		t.Fatalf("an ESC before ESC ] puts the mark at %d, want 1", ms[0].AtOffset)
	}
	// A DCS that an ESC ] interrupts is cancelled by it, as the emulator does.
	s = newTestScanner(t, newClock(), 0)
	sameKinds(t, feedAll(s, "\x1bPq1\x1b]133;A\a"), KindPromptStart)
}

func TestTheStartOffsetShiftsEveryOffset(t *testing.T) {
	const start = 1 << 40
	nonce, _ := ParseNonce(testNonce)
	s := New(Config{Nonce: nonce, Now: newClock().Now, MaxRecords: 0, StartOffset: start})
	data := "abc" + osc("133;A")
	ms := feedAll(s, data)
	sameKinds(t, ms, KindPromptStart)
	if ms[0].AtOffset != start+3 || s.Offset() != start+uint64(len(data)) {
		t.Fatalf("the mark is at %d and the offset is %d", ms[0].AtOffset, s.Offset())
	}
	if rec := only(t, s); rec.PromptOffset != start+3 {
		t.Fatalf("the prompt of the record is at %d", rec.PromptOffset)
	}
}

func TestTheOffsetAndTheStatsCountEveryByteFed(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	data := sessionStream()
	feedAll(s, data)
	if st := s.Stats(); st.Bytes != uint64(len(data)) || s.Offset() != uint64(len(data)) || st.Marks != 6 {
		t.Fatalf("stats %+v offset %d, want %d bytes and 6 marks", st, s.Offset(), len(data))
	}
}

func TestTheStringsOfAMarkAndARecordDoNotShowTheCommandLine(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, cycle("secret-command --token=abc", "x", "0"))
	if len(ms) != 4 {
		t.Fatalf("%d marks, want 4", len(ms))
	}
	rec := only(t, s)
	for _, v := range []any{ms[3], &ms[3], rec, &rec} {
		for _, f := range []string{"%v", "%+v", "%#v", "%s"} {
			if got := sprintf(f, v); strings.Contains(got, "secret-command") || got == "" {
				t.Fatalf("%s of %T is %q", f, v, got)
			}
		}
	}
}
