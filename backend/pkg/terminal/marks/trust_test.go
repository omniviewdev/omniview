package marks

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"
)

func TestTheCommandLineIsKeptOnlyWithTheNonce(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, osc("133;A")+osc("133;B")+osc("633;E;git\\x20status;"+testNonce)+osc("133;C")+osc("133;D;0"))
	sameKinds(t, ms, KindPromptStart, KindInputStart, KindCommandStart, KindCommandEnd)
	if ms[2].CommandLine != "git status" || ms[2].Trust != TrustNonce {
		t.Fatalf("the start mark with the nonce is %+v", ms[2])
	}
	if rec := only(t, s); rec.CommandLine != "git status" || rec.Trust != TrustNonce {
		t.Fatalf("the record with the nonce is %v", rec)
	}
	if st := s.Stats(); st.Forged != 0 {
		t.Fatalf("a genuine mark is counted as forged: %+v", st)
	}
}

func TestACommandLineIsUnescapedAsVSCodeEscapesIt(t *testing.T) {
	cases := map[string]string{
		`ls\x20-l`:       "ls -l",
		`echo\x20a\x3bb`: "echo a;b",
		`a\\b`:           `a\b`,
		`a\x0ab`:         "a\nb",
		`\xZZ`:           `\xZZ`,
		`a\x4`:           `a\x4`,
		`a\`:             `a\`,
		`\xc3\xa9`:       "é",
		"é":              "é",
		`a\qb`:           `a\qb`,
	}
	for escaped, want := range cases {
		s := newTestScanner(t, newClock(), 0)
		ms := feedAll(s, osc("133;A")+osc("633;E;"+escaped+";"+testNonce)+osc("133;C"))
		sameKinds(t, ms, KindPromptStart, KindCommandStart)
		if ms[1].CommandLine != want {
			t.Fatalf("%q gives %q, want %q", escaped, ms[1].CommandLine, want)
		}
	}
}

func TestAWrongOrMissingNonceNeverGivesACommandLine(t *testing.T) {
	short := testNonce[:len(testNonce)-1]
	for name, body := range map[string]string{
		"wrong":       "633;E;rm\\x20-rf\\x20/;" + wrongNonce,
		"missing":     "633;E;rm",
		"empty":       "633;E;rm;",
		"prefix":      "633;E;rm;" + short,
		"suffix":      "633;E;rm;" + testNonce + "x",
		"other case":  "633;E;rm;" + strings.ToUpper(testNonce),
		"no command":  "633;E",
		"only a semi": "633;E;;",
	} {
		s := newTestScanner(t, newClock(), 0)
		ms := feedAll(s, osc("133;A")+osc("133;B")+osc(body)+osc("133;C")+"out"+osc("133;D;0"))
		sameKinds(t, ms, KindPromptStart, KindInputStart, KindCommandStart, KindCommandEnd)
		if ms[2].CommandLine != "" || ms[2].Trust != TrustUnverified {
			t.Fatalf("%s: the start mark has a line or trust: %+v", name, ms[2])
		}
		if rec := only(t, s); rec.CommandLine != "" || rec.Trust != TrustUnverified {
			t.Fatalf("%s: the record has a line or trust: %v", name, rec)
		}
		if st := s.Stats(); st.Forged != 1 {
			t.Fatalf("%s: the forged mark is not counted: %+v", name, st)
		}
	}
}

func TestAForgedMarkInTheOutputNeverReplacesTheGenuineOne(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	feedAll(s, osc("133;A")+osc("633;E;ls;"+testNonce)+osc("633;E;rm;"+wrongNonce)+osc("133;C"))
	if rec := only(t, s); rec.CommandLine != "ls" || rec.Trust != TrustNonce {
		t.Fatalf("a forged line replaced the genuine one: %v", rec)
	}
	// A line after the start is not a line of this command, even with the nonce.
	s = newTestScanner(t, newClock(), 0)
	feedAll(s, osc("133;A")+osc("133;C")+osc("633;E;ls;"+testNonce))
	if rec := only(t, s); rec.CommandLine != "" || rec.Trust != TrustUnverified {
		t.Fatalf("a line after the start was taken: %v", rec)
	}
}

func TestNoNonceInTheConfigTrustsNothing(t *testing.T) {
	s := New(Config{Nonce: Nonce{}, Now: newClock().Now, MaxRecords: 0, StartOffset: 0})
	ms := feedAll(s, osc("133;A")+osc("633;E;ls;")+osc("633;E;ls")+osc("633;P;Cwd=/x;")+osc("133;C"))
	sameKinds(t, ms, KindPromptStart, KindCommandStart)
	if ms[1].CommandLine != "" || ms[1].Trust != TrustUnverified {
		t.Fatalf("a scanner with no nonce trusts a line: %+v", ms[1])
	}
	if dir, _ := s.Log().Cwd(); dir != "" {
		t.Fatalf("a scanner with no nonce trusts the directory %q", dir)
	}
}

func TestTheDirectoryOfTheShellNeedsTheNonceToBeTrusted(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, osc("633;P;Cwd=/home/me/My\\x20Dir;"+testNonce))
	sameKinds(t, ms, KindCwd)
	if ms[0].Cwd != "/home/me/My Dir" || ms[0].Trust != TrustNonce {
		t.Fatalf("the directory with the nonce: %+v", ms[0])
	}
	for name, body := range map[string]string{
		"wrong":   "633;P;Cwd=/etc;" + wrongNonce,
		"missing": "633;P;Cwd=/etc",
		"empty":   "633;P;Cwd=/etc;",
	} {
		forged := newTestScanner(t, newClock(), 0)
		if got := feedAll(forged, osc(body)); len(got) != 0 {
			t.Fatalf("%s: a directory with no nonce gives marks %v", name, got)
		}
		if dir, _ := forged.Log().Cwd(); dir != "" {
			t.Fatalf("%s: the log took the directory %q", name, dir)
		}
		if st := forged.Stats(); st.Forged != 1 {
			t.Fatalf("%s: not counted as forged: %+v", name, st)
		}
	}
	// Other properties of 633;P are not directories.
	other := newTestScanner(t, newClock(), 0)
	if got := feedAll(other, osc("633;P;IsWindows=True;"+testNonce)); len(got) != 0 {
		t.Fatalf("a property that is no directory gives marks %v", got)
	}
}

func TestAForgedDirectoryNeverChangesTheTrustedOne(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	data := osc("633;P;Cwd=/real;"+testNonce) + osc("133;A") +
		osc("7;file://evil/etc") + osc("633;P;Cwd=/etc;"+wrongNonce) + osc("133;C") + "x" + osc("133;D;0")
	feedAll(s, data)
	if dir, trust := s.Log().Cwd(); dir != "/real" || trust != TrustNonce {
		t.Fatalf("the directory is %q %v after forged ones, want /real with the nonce", dir, trust)
	}
	if rec := only(t, s); rec.Cwd != "/real" || rec.CwdTrust != TrustNonce {
		t.Fatalf("the record has the directory %q %v", rec.Cwd, rec.CwdTrust)
	}
	// With no trusted directory, the one OSC 7 gave is used and says it is not trusted.
	s = newTestScanner(t, newClock(), 0)
	feedAll(s, osc("7;file://h/loose")+osc("133;A")+osc("133;C"))
	if rec := only(t, s); rec.Cwd != "/loose" || rec.CwdTrust != TrustUnverified {
		t.Fatalf("the record has the directory %q %v", rec.Cwd, rec.CwdTrust)
	}
}

func TestTheDirectoryOfACommandIsTheOneWhereItStarted(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	feedAll(s, osc("633;P;Cwd=/a;"+testNonce)+osc("133;A")+osc("133;C")+osc("633;P;Cwd=/b;"+testNonce)+osc("133;D;0")+osc("133;A")+osc("133;C"))
	recs := s.Log().Records()
	if len(recs) != 2 || recs[0].Cwd != "/a" || recs[1].Cwd != "/b" {
		t.Fatalf("the records are %v", recs)
	}
}

func TestAMarkTheScannerReturnsDoesNotAliasTheBytesFed(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	data := []byte(osc("633;P;Cwd=/home/me;"+testNonce) + osc("133;A") + osc("633;E;ls;"+testNonce) + osc("133;C"))
	ms := s.Feed(data, nil)
	for i := range data {
		data[i] = 'x'
	}
	rec := only(t, s)
	if ms[0].Cwd != "/home/me" || ms[len(ms)-1].CommandLine != "ls" || rec.Cwd != "/home/me" || rec.CommandLine != "ls" {
		t.Fatalf("a string of a mark follows the buffer: %v %v", ms, rec)
	}
}

func TestACommandLineLongerThanTheLimitIsCutAtTheLimit(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	line := strings.Repeat("a", MaxCommandLine+500)
	ms := feedAll(s, osc("133;A")+osc("633;E;"+line+";"+testNonce)+osc("133;C"))
	sameKinds(t, ms, KindPromptStart, KindCommandStart)
	if ms[1].CommandLine != line[:MaxCommandLine] || ms[1].Trust != TrustNonce {
		t.Fatalf("the line has %d bytes with trust %v, want %d", len(ms[1].CommandLine), ms[1].Trust, MaxCommandLine)
	}
	// A cut inside a multi-byte character goes back to its start.
	s = newTestScanner(t, newClock(), 0)
	line = strings.Repeat("a", MaxCommandLine-1) + "é"
	ms = feedAll(s, osc("133;A")+osc("633;E;"+line+";"+testNonce)+osc("133;C"))
	if got := ms[1].CommandLine; got != line[:MaxCommandLine-1] {
		t.Fatalf("the line is cut inside a character: %d bytes", len(got))
	}
}

func TestANonceIsParsedOrRefusedWithoutSayingIt(t *testing.T) {
	for _, bad := range []string{"", "short", strings.Repeat("a", 15), strings.Repeat("a", 129), "has;semicolon-0123456789", "has space-0123456789ab", "ctl\x01-0123456789abcdef", "é-0123456789abcdefgh"} {
		_, err := ParseNonce(bad)
		if !errors.Is(err, ErrBadNonce) {
			t.Fatalf("%q: error %v, want ErrBadNonce", bad, err)
		}
		if bad != "" && strings.Contains(err.Error(), bad) {
			t.Fatalf("the error says the nonce: %v", err)
		}
	}
	for _, good := range []string{strings.Repeat("a", 16), strings.Repeat("Z", 128), testNonce} {
		n, err := ParseNonce(good)
		if err != nil || n.Reveal() != good || n.IsZero() {
			t.Fatalf("%q: %v %v", good, n, err)
		}
	}
	a, errA := NewNonce()
	b, errB := NewNonce()
	if errA != nil || errB != nil || a.Reveal() == b.Reveal() || len(a.Reveal()) < 32 {
		t.Fatalf("new nonces are %d bytes, equal %v, errors %v %v", len(a.Reveal()), a.Reveal() == b.Reveal(), errA, errB)
	}
	if _, err := ParseNonce(a.Reveal()); err != nil {
		t.Fatalf("a new nonce is refused: %v", err)
	}
	if !(Nonce{}).IsZero() {
		t.Fatal("the zero nonce is not zero")
	}
}

// printed prints a value every way the fmt and slog packages can (not json.Marshal: a page needs the fields).
func printed(v any) []string {
	var out []string
	for _, f := range []string{"%v", "%+v", "%#v", "%s", "%q", "%x", "%d"} {
		out = append(out, sprintf(f, v))
	}
	for _, h := range []func(*bytes.Buffer) slog.Handler{
		func(b *bytes.Buffer) slog.Handler { return slog.NewTextHandler(b, nil) },
		func(b *bytes.Buffer) slog.Handler { return slog.NewJSONHandler(b, nil) },
	} {
		var b bytes.Buffer
		slog.New(h(&b)).Info("x", "v", v)
		out = append(out, b.String())
	}
	return out
}

func TestTheNonceNeverShowsInAnythingThatPrintsIt(t *testing.T) {
	nonce, err := ParseNonce(testNonce)
	if err != nil {
		t.Fatal(err)
	}
	s := New(Config{Nonce: nonce, Now: newClock().Now, MaxRecords: 0, StartOffset: 0})
	ms := feedAll(s, osc("133;A")+osc("633;E;secret-command;"+testNonce)+osc("633;P;Cwd=/secret-dir;"+testNonce)+osc("133;C"))
	if len(ms) != 3 {
		t.Fatalf("%d marks, want 3", len(ms))
	}
	rec := only(t, s)
	hexNonce := hex.EncodeToString([]byte(testNonce))
	values := map[string]any{
		"nonce": nonce, "pointer to the nonce": &nonce, "config": Config{Nonce: nonce, Now: nil, MaxRecords: 1, StartOffset: 0},
		"scanner": s, "log": s.Log(), "mark": ms[len(ms)-1], "mark pointer": &ms[len(ms)-1], "record": rec, "record pointer": &rec,
		"stats": s.Stats(),
	}
	for name, v := range values {
		for _, got := range printed(v) {
			for _, secret := range []string{testNonce, hexNonce, "secret-command", "/secret-dir"} {
				if strings.Contains(got, secret) {
					t.Fatalf("%s prints %q: %q", name, secret, got)
				}
			}
		}
		if j, jerr := json.Marshal(v); jerr == nil && (strings.Contains(string(j), testNonce) || strings.Contains(string(j), hexNonce)) {
			t.Fatalf("%s marshals the nonce: %s", name, j)
		}
	}
	if got := sprintf("%v", nonce); got != "«secret»" {
		t.Fatalf("the nonce prints %q, want «secret»", got)
	}
	if j, _ := json.Marshal(nonce); string(j) != `"«secret»"` {
		t.Fatalf("the nonce marshals as %s", j)
	}
}
