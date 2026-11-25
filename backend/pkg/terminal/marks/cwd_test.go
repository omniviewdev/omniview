package marks

import (
	"strings"
	"testing"
)

func TestOSC7GivesTheDirectoryDecodedAndUnverified(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"host", "7;file://host/home/me/My%20Dir", "/home/me/My Dir"},
		{"no host", "7;file:///tmp/x", "/tmp/x"},
		{"utf-8 percent", "7;file://host/tmp/%C3%A9", "/tmp/é"},
		{"utf-8 raw", "7;file://host/tmp/é", "/tmp/é"},
		{"root", "7;file://host/", "/"},
		{"bad escape kept", "7;file://host/a%zzb", "/a%zzb"},
		{"semicolon", "7;file://host/a;b", "/a;b"},
	}
	for _, c := range cases {
		for term, wrap := range map[string]func(string) string{"BEL": osc, "ST": oscST} {
			s := newTestScanner(t, newClock(), 0)
			ms := feedAll(s, wrap(c.body))
			sameKinds(t, ms, KindCwd)
			if ms[0].Cwd != c.want || ms[0].Trust != TrustUnverified {
				t.Fatalf("%s with %s: the mark is %+v, want the directory %q unverified", c.name, term, ms[0], c.want)
			}
			if dir, trust := s.Log().Cwd(); dir != c.want || trust != TrustUnverified {
				t.Fatalf("%s with %s: the log says %q %v", c.name, term, dir, trust)
			}
		}
	}
}

func TestOSC7ThatIsNoDirectoryGivesNoMark(t *testing.T) {
	for _, body := range []string{"7;file://host", "7;http://host/x", "7;/tmp/x", "7;"} {
		s := newTestScanner(t, newClock(), 0)
		if ms := feedAll(s, osc(body)); len(ms) != 0 {
			t.Fatalf("%q gives marks %v", body, ms)
		}
		if st := s.Stats(); st.Malformed != 1 {
			t.Fatalf("%q is not counted as malformed: %+v", body, st)
		}
	}
}

func TestAControlByteInADirectoryNeverEndsTheSequenceExceptTheOnesThatDo(t *testing.T) {
	// Every C0 byte put raw in the middle of a path. ESC and BEL end the sequence, so the path is what came before;
	// CAN and SUB cancel it; any other is dropped from the path. None is ever in a directory.
	for b := range byte(0x20) {
		data := "\x1b]7;file://host/tmp/a" + string([]byte{b}) + "b\x1b\\"
		s := newTestScanner(t, newClock(), 0)
		ms := feedAll(s, data)
		var want string
		switch b {
		case 0x1b, 0x07:
			want = "/tmp/a"
		case 0x18, 0x1a:
			want = ""
		default:
			want = "/tmp/ab"
		}
		if want == "" {
			if len(ms) != 0 {
				t.Fatalf("byte %#02x: a cancelled sequence gives marks %v", b, ms)
			}
			continue
		}
		if len(ms) != 1 || ms[0].Kind != KindCwd || ms[0].Cwd != want {
			t.Fatalf("byte %#02x: the marks are %v, want the directory %q", b, ms, want)
		}
	}
}

func TestAControlByteThatIsEncodedIsStrippedToo(t *testing.T) {
	for _, body := range []string{
		"7;file://host/tmp/a%1bb", "7;file://host/tmp/a%07b", "7;file://host/tmp/a%00b",
		"7;file://host/tmp/a%7fb", "7;file://host/tmp/a%0ab", "7;file://host/tmp/a\x7fb",
	} {
		s := newTestScanner(t, newClock(), 0)
		ms := feedAll(s, osc(body))
		sameKinds(t, ms, KindCwd)
		if ms[0].Cwd != "/tmp/ab" {
			t.Fatalf("%q gives the directory %q, want /tmp/ab", body, ms[0].Cwd)
		}
	}
}

func TestARawEscapeInADirectoryEndsTheSequenceAndStartsAnother(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, "\x1b]7;file://h/tmp/a\x1b[31m/y\a\x1b]133;A\a")
	sameKinds(t, ms, KindCwd, KindPromptStart)
	if ms[0].Cwd != "/tmp/a" {
		t.Fatalf("the directory is %q, want /tmp/a", ms[0].Cwd)
	}
	if ms[1].AtOffset != at(t, "\x1b]7;file://h/tmp/a\x1b[31m/y\a\x1b]133;A\a", "\x1b]133;A") {
		t.Fatalf("the sequence after the escape is at %d", ms[1].AtOffset)
	}
}

func TestADirectoryTooLongIsDroppedAndCounted(t *testing.T) {
	s := newTestScanner(t, newClock(), 0)
	ms := feedAll(s, osc("7;file://h/"+strings.Repeat("a", MaxCwd))+osc("7;file://h/"+strings.Repeat("a", MaxCwd-1)))
	sameKinds(t, ms, KindCwd)
	if len(ms[0].Cwd) != MaxCwd {
		t.Fatalf("the directory has %d bytes, want %d", len(ms[0].Cwd), MaxCwd)
	}
	if st := s.Stats(); st.Oversize != 1 {
		t.Fatalf("a directory over the limit is not counted: %+v", st)
	}
}
