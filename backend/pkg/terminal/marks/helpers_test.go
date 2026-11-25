package marks

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

// testNonce is the nonce of the sessions of the tests. It has the shape of a real one and stands for the secret: a
// test that prints it anywhere it should not be has found a defect.
const testNonce = "0123456789abcdef0123456789abcdef"

// wrongNonce is a nonce of the same shape that is not the session's.
const wrongNonce = "fedcba9876543210fedcba9876543210"

// fakeClock is the producer's clock of a test: it moves when the test says so.
type fakeClock struct{ t time.Time }

func newClock() *fakeClock { return &fakeClock{t: time.Date(2026, 11, 24, 10, 0, 0, 0, time.UTC)} }

func (c *fakeClock) Now() time.Time { return c.t }

func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }

// newTestScanner makes a scanner with the test nonce, on a clock the test holds.
func newTestScanner(t *testing.T, clock *fakeClock, maxRecords int) *Scanner {
	t.Helper()
	nonce, err := ParseNonce(testNonce)
	if err != nil {
		t.Fatalf("the test nonce is refused: %v", err)
	}
	return New(Config{Nonce: nonce, Now: clock.Now, MaxRecords: maxRecords, StartOffset: 0})
}

// osc is an OSC sequence that ends at BEL, oscST one that ends at ST.
func osc(body string) string { return "\x1b]" + body + "\a" }

func oscST(body string) string { return "\x1b]" + body + "\x1b\\" }

// feedAll feeds data whole and returns the marks.
func feedAll(s *Scanner, data string) []Mark { return s.Feed([]byte(data), nil) }

// kinds lists the kinds of marks, to compare an order in one line.
func kinds(ms []Mark) []Kind {
	out := make([]Kind, 0, len(ms))
	for _, m := range ms {
		out = append(out, m.Kind)
	}
	return out
}

func sameKinds(t *testing.T, ms []Mark, want ...Kind) {
	t.Helper()
	if got := kinds(ms); !reflect.DeepEqual(got, want) {
		t.Fatalf("the marks have the kinds %v, want %v", got, want)
	}
}

// at is the offset of the first byte of sub in data.
func at(t *testing.T, data, sub string) uint64 {
	t.Helper()
	i := strings.Index(data, sub)
	if i < 0 {
		t.Fatalf("%q is not in the stream", sub)
	}
	return uint64(i)
}

// only returns the single record of the log.
func only(t *testing.T, s *Scanner) Record {
	t.Helper()
	recs := s.Log().Records()
	if len(recs) != 1 {
		t.Fatalf("the log keeps %d commands, want 1: %v", len(recs), recs)
	}
	return recs[0]
}

// cycle is one prompt, one command and its end, the marks of a script that has the nonce.
func cycle(line, output string, exit string) string {
	return osc("133;A") + "$ " + osc("133;B") + line + "\r\n" +
		osc("633;E;"+line+";"+testNonce) + osc("133;C") + output + "\r\n" + osc("133;D;"+exit)
}

func sprintf(format string, args ...any) string { return fmt.Sprintf(format, args...) }
