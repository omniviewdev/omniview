package terminal

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// THE TITLE A PROGRAM SETS (issue #695 step 4): what the scanner reads out of the output, and what it keeps of it. A title is output of
// a shell or of a program: untrusted text, with no control character in it, valid UTF-8 and bounded.

// feedAll feeds chunks to a fresh scanner and says the last title it read and how many it read.
func feedAll(chunks ...string) (string, int) {
	var scan titleScanner
	last, n := "", 0
	for _, chunk := range chunks {
		if title, ok := scan.Feed([]byte(chunk)); ok {
			last, n = title, n+1
		}
	}
	return last, n
}

func TestTheScannerReadsOSCZeroAndTwoEndedByBELOrST(t *testing.T) {
	for name, tc := range map[string]struct{ in, want string }{
		"OSC 2 and BEL":              {"\x1b]2;build\x07", "build"},
		"OSC 0 and BEL":              {"\x1b]0;build\x07", "build"},
		"OSC 2 and ST":               {"\x1b]2;build\x1b\\", "build"},
		"OSC 0 and ST":               {"\x1b]0;build\x1b\\", "build"},
		"text around the sequence":   {"before\r\n\x1b]2;build\x07after", "build"},
		"a title with a semicolon":   {"\x1b]2;a;b;c\x07", "a;b;c"},
		"an empty title resets it":   {"\x1b]2;\x07", ""},
		"the last of two in a chunk": {"\x1b]2;one\x07x\x1b]0;two\x07", "two"},
		"UTF-8 text":                 {"\x1b]2;déjà vu — 東京\x07", "déjà vu — 東京"},
	} {
		t.Run(name, func(t *testing.T) {
			got, n := feedAll(tc.in)
			assert.Positive(t, n, "the title was read")
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestTheScannerReadsATitleCutAtEveryByteOfTheStream(t *testing.T) {
	stream := "xx\x1b[1m\x1b]2;in two\x1b\\yy\x1b]0;and the other\x07zz"
	for cut := 1; cut < len(stream); cut++ {
		got, n := feedAll(stream[:cut], stream[cut:])
		assert.Equal(t, "and the other", got, "cut at %d", cut)
		assert.NotZero(t, n, "cut at %d", cut)
	}
	// One byte at a time.
	var scan titleScanner
	var last string
	count := 0
	for i := range len(stream) {
		if title, ok := scan.Feed([]byte{stream[i]}); ok {
			last = title
			count++
		}
	}
	assert.Equal(t, "and the other", last)
	assert.Equal(t, 2, count, "each sequence was read once, however the bytes came")
}

func TestTheScannerReadsNothingOfOtherSequences(t *testing.T) {
	for name, in := range map[string]string{
		"OSC 1 sets the icon name":        "\x1b]1;icon\x07",
		"OSC 20 starts with a 2":          "\x1b]20;nope\x07",
		"OSC 22 starts with a 2":          "\x1b]22;nope\x07",
		"OSC 0 with no text and no colon": "\x1b]0\x07",
		"OSC 7 is the directory":          "\x1b]7;file:///tmp\x07",
		"OSC 133 is a prompt mark":        "\x1b]133;A\x07",
		"OSC 8 is a link":                 "\x1b]8;;https://example.com\x07text\x1b]8;;\x07",
		"a CSI with a bracket in it":      "\x1b[2;3]x",
		"a title the CAN cancels":         "\x1b]2;gone\x18after\x07",
		"a title the SUB cancels":         "\x1b]2;gone\x1aafter\x07",
		"an OSC that never ends":          "\x1b]2;never ends",
		"plain text":                      "echo 2;title\r\n",
	} {
		_, n := feedAll(in)
		assert.Zero(t, n, name)
	}
}

func TestAnOSCThatEndsWhereAnEscapeBeginsAnotherSequenceStillSetsItsTitle(t *testing.T) {
	// The emulator ends an OSC at an ESC that is not the start of ST, and reads the sequence that ESC begins: both are read.
	got, n := feedAll("\x1b]2;a\x1b[31mred")
	assert.Equal(t, "a", got)
	assert.Equal(t, 1, n)
	got, n = feedAll("\x1b]2;a\x1b]0;b\x07")
	assert.Equal(t, "b", got)
	assert.Equal(t, 2, n)
}

func TestAHundredKilobytesOfTitleCostsTheScannerItsBoundAndKeepsTheTitleBounded(t *testing.T) {
	var scan titleScanner
	huge := "\x1b]2;" + strings.Repeat("A", 100<<10) + "\x07"
	title, ok := scan.Feed([]byte(huge))
	require.True(t, ok, "the title was read")
	assert.Len(t, title, maxTitleBytes, "and cut to what a title keeps")
	assert.LessOrEqual(t, cap(scan.buf), maxTitleRead+4, "the scanner never held more than its bound of the sequence")
	// The scanner is in the ground state again: the next title is read whole.
	next, ok := scan.Feed([]byte("\x1b]2;next\x07"))
	assert.True(t, ok)
	assert.Equal(t, "next", next)
}

func TestAHundredKilobytesOfTitleCutAcrossManyChunks(t *testing.T) {
	var scan titleScanner
	_, ok := scan.Feed([]byte("\x1b]2;"))
	assert.False(t, ok)
	for range 100 {
		_, ok := scan.Feed([]byte(strings.Repeat("B", 1024)))
		assert.False(t, ok, "the title is not read before its end")
	}
	title, ok := scan.Feed([]byte("\x07"))
	require.True(t, ok)
	assert.Len(t, title, maxTitleBytes)
	assert.LessOrEqual(t, cap(scan.buf), maxTitleRead+4)
}

func TestACleanTitleHasNoControlCharacterNoSeparatorNoBidirectionalControlAndIsValidUTF8(t *testing.T) {
	for name, tc := range map[string]struct{ in, want string }{
		"C0 controls are dropped":              {"a\x01b\x02c\x1fd", "abcd"},
		"DEL is dropped":                       {"a\x7fb", "ab"},
		"C1 controls are dropped":              {"a\u0085b\u009bc", "abc"},
		"a tab and a line feed are dropped":    {"a\tb\nc\rd", "abcd"},
		"the line separator is dropped":        {"a\u2028b\u2029c", "abc"},
		"bidirectional controls are dropped":   {"a\u202eb\u2066c\u2069d\u200fe", "abcde"},
		"invalid UTF-8 becomes a replacement":  {"a\xffb", "a\ufffdb"},
		"a cut sequence becomes a replacement": {"a\xe6\x9d", "a\ufffd"},
		"outer white space goes":               {"  \u00a0 title  ", "title"},
		"only controls is an empty title":      {"\x01\x02\x03", ""},
		"an ESC is dropped, its text is not":   {"a\x1bb", "ab"},
	} {
		got := cleanTitle([]byte(tc.in))
		assert.Equal(t, tc.want, got, name)
		assert.True(t, utf8.ValidString(got), name)
	}
}

func TestACleanTitleIsCutAtARuneBoundaryAtTheBound(t *testing.T) {
	got := cleanTitle([]byte(strings.Repeat("東", 200)))
	assert.LessOrEqual(t, len(got), maxTitleBytes)
	assert.Greater(t, len(got), maxTitleBytes-utf8.UTFMax, "as much as fits is kept")
	assert.True(t, utf8.ValidString(got), "no rune is cut in half")
	assert.Equal(t, strings.Repeat("東", len(got)/3), got)
}

func TestTheTrackerStatesAChangeOnlyWhenThePairChanges(t *testing.T) {
	tr := newTitleTracker()
	assert.False(t, tr.wantsLook(), "a terminal that never had a title looks at nothing")
	tr.feed([]byte("\x1b]2;one\x07"))
	assert.True(t, tr.wantsLook(), "a title came: the foreground is looked at")
	assert.True(t, tr.settle(false, true), "the first title is a change")
	assert.Equal(t, "one", tr.text)
	assert.False(t, tr.program, "the shell held the foreground")
	assert.EqualValues(t, 1, tr.seq)
	assert.False(t, tr.wantsLook(), "a shown title that no program holds is not looked at again")

	tr.feed([]byte("\x1b]2;one\x07"))
	assert.False(t, tr.settle(false, true), "the same title with the same fact is no change")
	assert.EqualValues(t, 1, tr.seq)

	tr.feed([]byte("\x1b]2;two\x07"))
	assert.True(t, tr.settle(true, true))
	assert.True(t, tr.program)
	assert.True(t, tr.wantsLook(), "a program runs under the title: it is looked at until it ends")
	assert.False(t, tr.settle(true, false), "when the host cannot tell, the last answer stands")
	assert.True(t, tr.program)
	assert.True(t, tr.settle(false, true), "the program ended")
	assert.Equal(t, "two", tr.text, "the title stays, with the fact that no program holds it")
	assert.EqualValues(t, 3, tr.seq)

	tr.feed([]byte("\x1b]2;\x07"))
	assert.True(t, tr.settle(true, true))
	assert.Empty(t, tr.text)
	assert.False(t, tr.program, "no title, no program under it")
}
