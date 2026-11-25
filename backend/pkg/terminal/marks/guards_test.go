package marks

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestASecondEndOfAnEndedCommandChangesNothing(t *testing.T) {
	clock := newClock()
	s := newTestScanner(t, clock, 0)
	feedAll(s, cycle("ls", "out", "0"))
	before := only(t, s)
	clock.advance(5_000_000_000)
	ms := feedAll(s, osc("133;D;5"))
	sameKinds(t, ms, KindCommandEnd)
	if ms[0].CommandID != "" || ms[0].DurationMS != 0 {
		t.Fatalf("a second end closes a command: %+v", ms[0])
	}
	if after := only(t, s); after != before {
		t.Fatalf("a second end rewrote the record:\n before %v %v %v\n after  %v %v %v",
			before.ExitCode, before.EndedAt, before.OutputEnd, after.ExitCode, after.EndedAt, after.OutputEnd)
	}
}

func TestAnExitCodeThatDoesNotFitIsNoCodeAndNeverWraps(t *testing.T) {
	// 18446744073709551617 is 2^64 + 1: a digit loop without a bound wraps it to the valid code 1.
	for _, code := range []string{"18446744073709551617", "2147483648", "-2147483649", "99999999999999999999999"} {
		s := newTestScanner(t, newClock(), 0)
		ms := feedAll(s, osc("133;A")+osc("133;C")+osc("133;D;"+code))
		if ms[2].HasExitCode {
			t.Fatalf("D;%s gives the exit code %d", code, ms[2].ExitCode)
		}
	}
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, osc("133;A")+osc("133;C")+osc("133;D;2147483647")+osc("133;A")+osc("133;C")+osc("133;D;-2147483648"))
	if ms[2].ExitCode != 2147483647 || !ms[2].HasExitCode || ms[5].ExitCode != -2147483648 || !ms[5].HasExitCode {
		t.Fatalf("the limits of int32 are not read: %+v %+v", ms[2], ms[5])
	}
}

func TestANegativeExitCodeIsRead(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, osc("133;A")+osc("133;C")+osc("133;D;-1"))
	if !ms[2].HasExitCode || ms[2].ExitCode != -1 {
		t.Fatalf("D;-1 is %+v", ms[2])
	}
	if rec := only(t, s); rec.ExitCode != -1 || !rec.HasExitCode {
		t.Fatalf("the record has %v", rec)
	}
}

func TestVSCodePromptLettersAreReadLikeOSC133(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, osc("633;A")+osc("633;B")+osc("633;C")+osc("633;D;4"))
	sameKinds(t, ms, KindPromptStart, KindInputStart, KindCommandStart, KindCommandEnd)
	if ms[3].ExitCode != 4 || !ms[3].HasExitCode || ms[3].CommandID != "c1" {
		t.Fatalf("633;D;4 is %+v", ms[3])
	}
	// A letter followed by more letters is none of them.
	if longer := feedAll(newTestScanner(t, newClock(), 0), osc("633;AB")+osc("133;AB")); len(longer) != 0 {
		t.Fatalf("a longer word is read as a letter: %v", longer)
	}
}

func TestRedrawIsReadFromTheOptionAndFromARepeat(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, osc("133;A;redraw=1"))
	if !ms[0].Redraw {
		t.Fatalf("A;redraw=1 on a fresh prompt is not a redraw: %+v", ms[0])
	}
	s = newTestScanner(t, newClock(), 0)
	ms = feedAll(s, osc("133;A")+osc("133;C")+osc("133;A;redraw=1")+osc("133;A"))
	if !ms[2].Redraw || ms[3].Redraw {
		t.Fatalf("inside a running command: redraw=1 gives %v and a plain A gives %v, want true and false", ms[2].Redraw, ms[3].Redraw)
	}
	if ms[2].CommandID != "c1" || len(s.Log().Records()) != 1 {
		t.Fatalf("a prompt mark in a running command opened another: %v", s.Log().Records())
	}
	s = newTestScanner(t, newClock(), 0)
	ms = feedAll(s, osc("133;A")+osc("133;A"))
	if ms[0].Redraw || !ms[1].Redraw {
		t.Fatalf("a repeated A: %v %v", ms[0].Redraw, ms[1].Redraw)
	}
}

func TestAnEndedByTheSTAndByBELGiveTheSameOutputStart(t *testing.T) {
	for name, wrap := range map[string]func(string) string{"BEL": osc, "ST": oscST} {
		s := newTestScanner(t, newClock(), 0)
		data := wrap("133;A") + wrap("133;C") + "out" + wrap("133;D;0")
		feedAll(s, data)
		rec := only(t, s)
		if got := data[rec.OutputStart:rec.OutputEnd]; got != "out" {
			t.Fatalf("%s: the output offsets give %q, want out", name, got)
		}
	}
}

func TestAMarkOfADirectoryPrintsNoDirectory(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, osc("7;file://h/secret-dir")+osc("633;P;Cwd=/other-secret;"+testNonce))
	sameKinds(t, ms, KindCwd, KindCwd)
	for _, m := range ms {
		for _, v := range []any{m, &m} {
			for _, got := range printed(v) {
				if strings.Contains(got, "secret") {
					t.Fatalf("a mark prints its directory: %q", got)
				}
			}
		}
	}
}

func TestATrustedDirectoryHasItsEscapedControlBytesStripped(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, osc(`633;P;Cwd=/tmp/a\x1bb\x07c\x00d;`+testNonce))
	sameKinds(t, ms, KindCwd)
	if ms[0].Cwd != "/tmp/abcd" {
		t.Fatalf("the directory is %q, want /tmp/abcd", ms[0].Cwd)
	}
}

func TestASemicolonInAGenuineLineOrDirectoryIsPartOfIt(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, osc("133;A")+osc("633;E;echo a;b;c;"+testNonce)+osc("633;P;Cwd=/a;b;"+testNonce)+osc("133;C"))
	sameKinds(t, ms, KindPromptStart, KindCwd, KindCommandStart)
	if ms[1].Cwd != "/a;b" || ms[1].Trust != TrustNonce {
		t.Fatalf("the directory is %+v", ms[1])
	}
	if ms[2].CommandLine != "echo a;b;c" || ms[2].Trust != TrustNonce {
		t.Fatalf("the line is %+v", ms[2])
	}
}

func TestANonceAfterOtherBytesIsRefused(t *testing.T) {
	for _, given := range []string{"x" + testNonce, testNonce + "x", "x" + testNonce + "x", testNonce[:10] + testNonce} {
		s := newTestScanner(t, newClock(), 0)
		ms := feedAll(s, osc("133;A")+osc("633;E;ls;"+given)+osc("633;P;Cwd=/x;"+given)+osc("133;C"))
		sameKinds(t, ms, KindPromptStart, KindCommandStart)
		if ms[1].CommandLine != "" || ms[1].Trust != TrustUnverified {
			t.Fatalf("%q: the line is taken: %+v", given, ms[1])
		}
		if dir, _ := s.Log().Cwd(); dir != "" {
			t.Fatalf("%q: the directory is taken: %q", given, dir)
		}
		if st := s.Stats(); st.Forged != 2 {
			t.Fatalf("%q: forged is %d, want 2", given, st.Forged)
		}
	}
}

func TestTheNonceTextAndGoFormsNeverPrintTheValue(t *testing.T) {
	n, err := ParseNonce(testNonce)
	if err != nil {
		t.Fatal(err)
	}
	text, err := n.MarshalText()
	if err != nil || string(text) != "«secret»" {
		t.Fatalf("MarshalText is %q %v", text, err)
	}
	if got := n.GoString(); got != "«secret»" {
		t.Fatalf("GoString is %q", got)
	}
	if got := n.String(); got != "«secret»" {
		t.Fatalf("String is %q", got)
	}
	type holder struct{ N Nonce }
	for _, v := range []any{n, &n, holder{N: n}, map[string]Nonce{"n": n}, []Nonce{n}} {
		j, _ := json.Marshal(v)
		for _, got := range append(printed(v), string(j)) {
			if strings.Contains(got, testNonce) {
				t.Fatalf("%T prints the nonce: %q", v, got)
			}
		}
	}
}

func TestAVerifiedLineBeforeAnyPromptBelongsToTheNextCommand(t *testing.T) {
	for name, data := range map[string]string{
		"E then C":     osc("633;E;ls;"+testNonce) + osc("133;C"),
		"E then A":     osc("633;E;ls;"+testNonce) + osc("133;A") + osc("133;C"),
		"after an end": cycle("pwd", "x", "0") + osc("633;E;ls;"+testNonce) + osc("133;C"),
	} {
		s := newTestScanner(t, newClock(), 0)
		ms := feedAll(s, data)
		last, rec := ms[len(ms)-1], s.Log().Records()
		got := rec[len(rec)-1]
		if last.CommandLine != "ls" || last.Trust != TrustNonce || got.CommandLine != "ls" || got.Trust != TrustNonce {
			t.Fatalf("%s: the line is lost: mark %+v record %v", name, last, got)
		}
	}
	// A line is the line of one command: the next one does not inherit it.
	s := newTestScanner(t, newClock(), 0)
	feedAll(s, osc("633;E;ls;"+testNonce)+osc("133;C")+osc("133;D;0")+osc("133;A")+osc("133;C"))
	if recs := s.Log().Records(); len(recs) != 2 || recs[1].CommandLine != "" || recs[1].Trust != TrustUnverified {
		t.Fatalf("the next command took the line: %v", recs)
	}
	// A line that comes while a command runs is dropped, not kept for the next one.
	s = newTestScanner(t, newClock(), 0)
	feedAll(s, osc("133;A")+osc("133;C")+osc("633;E;rm;"+testNonce)+osc("133;D;0")+osc("133;A")+osc("133;C"))
	if recs := s.Log().Records(); len(recs) != 2 || recs[0].CommandLine != "" || recs[1].CommandLine != "" {
		t.Fatalf("a line in a running command was kept: %v", recs)
	}
}
