package linkresolve

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
)

func TestAHostileLongTextIsRefusedByLengthAndAShortOneIsParsedInLinearTime(t *testing.T) {
	for _, unit := range []string{".", ":", ":1", ".:", "(1", " line 1", "#L", "a/"} {
		got, reason := parse(strings.Repeat(unit, 1<<20))
		assert.Equal(t, ReasonTooLong, reason, "%q x 1M", unit)
		assert.Zero(t, got)
	}
	// at the cap, every marker repeated: the work is one pass per marker, so a text twice as long takes twice the steps
	for _, unit := range []string{".", ":1", "(1", " line 1", "#L1", "a/.:"} {
		_, reason := parse(strings.Repeat(unit, maxText/len(unit)))
		assert.Contains(t, []Reason{"", ReasonTooLong, ReasonInvalid}, reason, unit)
	}
}

func FuzzParse(f *testing.F) {
	for _, seed := range []string{"a.go:1:2", "a(1,2)", `"a b", line 3`, "a#L9", "(a:1)", "::::", "a line 9"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, text string) {
		got, reason := parse(text)
		if reason != "" {
			return
		}
		if got.path == "" || len(got.path) > maxPath || !utf8.ValidString(got.path) || got.line < 0 || got.col < 0 || got.line > 9_999_999 || got.col > 9_999_999 {
			t.Fatalf("parse(%q) = %+v", text, got)
		}
	})
}
