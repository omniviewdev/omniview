package terminal

import (
	"math/rand/v2"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// read feeds a tracker data in pieces of at most piece bytes.
func read(data string, piece int) *modeTracker {
	t := new(modeTracker)
	for len(data) > 0 {
		n := min(piece, len(data))
		t.feed([]byte(data[:n]))
		data = data[n:]
	}
	return t
}

func modesOf(data string) TerminalModes { return read(data, len(data)+1).modes() }

func withModes(change func(m *TerminalModes)) TerminalModes {
	m := TerminalModes{Known: true, KittyKeyboard: []int{}}
	change(&m)
	return m
}

// The modes a program switches on are the ones the tracker reports, and the ones it switches off are not.
func TestTheTrackerReadsTheModesThatProgramsSwitchOnAndOff(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  TerminalModes
	}{
		{"nothing", "ls -l\r\ntotal 0\r\n", withModes(func(*TerminalModes) {})},
		{"alternate screen 1049", "\x1b[?1049h", withModes(func(m *TerminalModes) { m.AltScreen = true })},
		{"alternate screen 47", "\x1b[?47h", withModes(func(m *TerminalModes) { m.AltScreen = true })},
		{"alternate screen 1047", "\x1b[?1047h", withModes(func(m *TerminalModes) { m.AltScreen = true })},
		{"alternate screen left", "\x1b[?1049h\x1b[?1049l", withModes(func(*TerminalModes) {})},
		{"bracketed paste", "\x1b[?2004h", withModes(func(m *TerminalModes) { m.BracketedPaste = true })},
		{"bracketed paste off", "\x1b[?2004h\x1b[?2004l", withModes(func(*TerminalModes) {})},
		{"application cursor keys", "\x1b[?1h", withModes(func(m *TerminalModes) { m.ApplicationCursor = true })},
		{"focus events", "\x1b[?1004h", withModes(func(m *TerminalModes) { m.FocusEvents = true })},
		{"cursor hidden", "\x1b[?25l", withModes(func(m *TerminalModes) { m.CursorHidden = true })},
		{"cursor shown again", "\x1b[?25l\x1b[?25h", withModes(func(*TerminalModes) {})},
		{"mouse click 1000", "\x1b[?1000h", withModes(func(m *TerminalModes) { m.MouseTracking = MouseClick })},
		{"mouse click 9", "\x1b[?9h", withModes(func(m *TerminalModes) { m.MouseTracking = MouseClick })},
		{"mouse drag", "\x1b[?1002h", withModes(func(m *TerminalModes) { m.MouseTracking = MouseDrag })},
		{"mouse any motion", "\x1b[?1003h", withModes(func(m *TerminalModes) { m.MouseTracking = MouseAnyMotion })},
		{"mouse click and drag, one sequence", "\x1b[?1000;1002h", withModes(func(m *TerminalModes) { m.MouseTracking = MouseClick | MouseDrag })},
		{"mouse drag off keeps click", "\x1b[?1000h\x1b[?1002h\x1b[?1002l", withModes(func(m *TerminalModes) { m.MouseTracking = MouseClick })},
		{"mouse sgr", "\x1b[?1006h", withModes(func(m *TerminalModes) { m.MouseEncoding = MouseSGR })},
		{"mouse sgr off", "\x1b[?1006h\x1b[?1006l", withModes(func(*TerminalModes) {})},
		{"mouse utf8 then sgr: the last one set is in force", "\x1b[?1005h\x1b[?1006h", withModes(func(m *TerminalModes) { m.MouseEncoding = MouseSGR })},
		{"switching off the encoding that is not in force changes nothing", "\x1b[?1006h\x1b[?1005l", withModes(func(m *TerminalModes) { m.MouseEncoding = MouseSGR })},
		{"mouse urxvt", "\x1b[?1015h", withModes(func(m *TerminalModes) { m.MouseEncoding = MouseURXVT })},
		{
			"a full-screen program with the mouse", "\x1b[?1049;1000;1006;2004;1h\x1b[?25l",
			withModes(func(m *TerminalModes) {
				m.AltScreen, m.MouseTracking, m.MouseEncoding, m.BracketedPaste, m.ApplicationCursor, m.CursorHidden = true, MouseClick, MouseSGR, true, true, true
			}),
		},
		{"the ANSI modes are not these", "\x1b[4h\x1b[20h\x1b[?1049h\x1b[4l", withModes(func(m *TerminalModes) { m.AltScreen = true })},
		{"text around a sequence changes nothing", "é日本\x1b[?2004h😀 ls\r\n", withModes(func(m *TerminalModes) { m.BracketedPaste = true })},
		{"a parameter too long to be a mode", "\x1b[?99999999999999999h", withModes(func(*TerminalModes) {})},
		{"an intermediate byte makes it another sequence", "\x1b[?1049 h", withModes(func(*TerminalModes) {})},
		{"a sub-parameter makes it another sequence", "\x1b[?1049:1h", withModes(func(*TerminalModes) {})},
		{"a private marker after a parameter is malformed", "\x1b[1?1049h", withModes(func(*TerminalModes) {})},
		{"a sequence the tracker does not read is skipped to its end", "\x1b[38;2;1;2;3m\x1b[?2004h", withModes(func(m *TerminalModes) { m.BracketedPaste = true })},
	}
	for _, c := range cases {
		assert.Equal(t, c.want, modesOf(c.input), c.name)
	}
}

// Text inside a string is text: a title that looks like a sequence switches nothing.
func TestTheTrackerSkipsStringsWholeSoTheirTextIsNeverTakenForAMode(t *testing.T) {
	assert.Equal(t, withModes(func(*TerminalModes) {}), modesOf("\x1b]0;[?1049h\x07"), "an OSC ended by BEL")
	assert.Equal(t, withModes(func(*TerminalModes) {}), modesOf("\x1b]0;[?1049h\x1b\\"), "an OSC ended by ST")
	assert.Equal(t, withModes(func(*TerminalModes) {}), modesOf("\x1bP[?1049h\x1b\\"), "a DCS")
	assert.Equal(t, withModes(func(*TerminalModes) {}), modesOf("\x1b_[?1049h\x1b\\"), "an APC")
	assert.Equal(t, withModes(func(*TerminalModes) {}), modesOf("\x1bP[?1049h\x07text"), "BEL does not end a DCS: the string goes on")
	assert.Equal(t, withModes(func(m *TerminalModes) { m.AltScreen = true }), modesOf("\x1b]0;title\x07\x1b[?1049h"), "a sequence after the string counts")
	assert.Equal(t, withModes(func(m *TerminalModes) { m.AltScreen = true }), modesOf("\x1b]0;title\x1b[?1049h"),
		"an ESC that is not the start of an ST ends the string and begins a sequence of its own")
	assert.Equal(t, withModes(func(*TerminalModes) {}), modesOf("\x1b[?10\x18049h"), "CAN cancels the sequence: what follows is text")
	assert.Equal(t, withModes(func(*TerminalModes) {}), modesOf("\x1b[?10\x1a049h"), "SUB cancels it too")
	assert.Equal(t, withModes(func(m *TerminalModes) { m.AltScreen = true }), modesOf("\x1b]0;a\x18\x1b[?1049h"), "CAN ends a string")
}

// The two resets: the full one clears every mode, the soft one only the keys and the cursor.
func TestTheTrackerFollowsTheFullAndTheSoftReset(t *testing.T) {
	assert.Equal(t, withModes(func(*TerminalModes) {}),
		modesOf("\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[?2004h\x1b[?1h\x1b[?25l\x1b[?1004h\x1b[>3u\x1bc"), "RIS: everything is back")
	assert.Equal(t, withModes(func(m *TerminalModes) { m.AltScreen, m.BracketedPaste, m.MouseTracking = true, true, MouseClick }),
		modesOf("\x1b[?1h\x1b[?25l\x1b[?1049h\x1b[?2004h\x1b[?1000h\x1b[!p"), "DECSTR: the cursor keys and the cursor, only")
	assert.Equal(t, withModes(func(m *TerminalModes) { m.AltScreen = true }), modesOf("\x1b[?1049h\x1b(B\x1b[?1049h"), "a character set designation is not a reset")
}

// The keyboard protocol's stack: push, pop, set, a separate one for each screen, and a bound.
func TestTheTrackerFollowsTheKittyKeyboardStack(t *testing.T) {
	stack := func(input string) []int { return modesOf(input).KittyKeyboard }
	assert.Equal(t, []int{}, stack(""), "none in use")
	assert.Equal(t, []int{1}, stack("\x1b[>1u"))
	assert.Equal(t, []int{0}, stack("\x1b[>u"), "a push with no flags pushes zero")
	assert.Equal(t, []int{1, 5}, stack("\x1b[>1u\x1b[>5u"))
	assert.Equal(t, []int{1}, stack("\x1b[>1u\x1b[>5u\x1b[<u"), "a pop with no count pops one")
	assert.Equal(t, []int{}, stack("\x1b[>1u\x1b[>5u\x1b[<2u"), "a pop of two")
	assert.Equal(t, []int{}, stack("\x1b[>1u\x1b[<9u"), "a pop of more than there is empties it")
	assert.Equal(t, []int{}, stack("\x1b[<u"), "a pop of nothing is nothing")
	assert.Equal(t, []int{8}, stack("\x1b[>1u\x1b[=8u"), "set replaces the top")
	assert.Equal(t, []int{9}, stack("\x1b[>1u\x1b[=8;2u"), "mode 2 adds to the top")
	assert.Equal(t, []int{0}, stack("\x1b[>1u\x1b[=1;3u"), "mode 3 takes from the top")
	assert.Equal(t, []int{4}, stack("\x1b[=4u"), "set with an empty stack makes the top")
	assert.Equal(t, []int{1}, stack("\x1b[>1u\x1b[?u"), "a query changes nothing")
	assert.Equal(t, []int{7}, stack("\x1b[>1u\x1b[?1049h\x1b[>7u"), "the alternate screen has a stack of its own")
	assert.Equal(t, []int{1}, stack("\x1b[>1u\x1b[?1049h\x1b[>7u\x1b[?1049l"), "and leaving it shows the main one again")

	var deep strings.Builder
	for i := 1; i <= 20; i++ {
		deep.WriteString("\x1b[>" + string(rune('0'+i%10)) + "u")
	}
	got := stack(deep.String())
	require.Len(t, got, maxKittyDepth, "the stack is bounded")
	assert.Equal(t, 0, got[len(got)-1], "and it is the oldest that goes: the last push (20) is on top")
}

// A boundary is the ground state after a byte that is not part of a multi-byte character.
func TestTheTrackerSaysWhereTheOutputIsAtABoundary(t *testing.T) {
	at := func(input string) bool { return read(input, 1).atBoundary() }
	assert.True(t, at(""), "the start is one")
	assert.True(t, at("abc"))
	assert.True(t, at("ab\r\n"))
	assert.False(t, at("\x1b"), "after ESC")
	assert.False(t, at("\x1b["), "inside a CSI")
	assert.False(t, at("\x1b[1;3"), "inside its parameters")
	assert.True(t, at("\x1b[1;31m"), "after its final byte")
	assert.False(t, at("\x1b]0;ti"), "inside an OSC")
	assert.True(t, at("\x1b]0;ti\x07"), "after its BEL")
	assert.False(t, at("\x1b]0;ti\x1b"), "after the ESC of its ST")
	assert.True(t, at("\x1b]0;ti\x1b\\"), "after its ST")
	assert.False(t, at("\x1bP1$r"), "inside a DCS")
	assert.False(t, at("\x1b("), "after an intermediate")
	assert.True(t, at("\x1b(B"), "after the final of a character set designation")
	assert.False(t, at("\xc3"), "inside a UTF-8 sequence")
	assert.False(t, at("é"), "after a complete one the next byte is not known yet: the output may be inside a sequence of three")
	assert.True(t, at("é "), "and after the byte that follows it, ASCII, it is")
	assert.True(t, at("\x1b[1\x18"), "CAN ends the sequence")
}

// A vocabulary of what terminals write, for the streams the next tests cut.
func pieces() []string {
	return []string{
		"hello ", "world\r\n", "x", "é", "日本語", "😀", "\t", "\r\n",
		"\x1b[1;31m", "\x1b[0m", "\x1b[38;2;1;2;3m", "\x1b[38:2::1:2:3m", "\x1b[H", "\x1b[2J", "\x1b[10;20H", "\x1b[K",
		"\x1b[?1049h", "\x1b[?1049l", "\x1b[?1000h", "\x1b[?1000l", "\x1b[?1006h", "\x1b[?1006l", "\x1b[?2004h", "\x1b[?2004l",
		"\x1b[?25l", "\x1b[?25h", "\x1b[?1h", "\x1b[?1l", "\x1b[?1004h", "\x1b[?1002;1003h", "\x1b[>1u", "\x1b[>5u", "\x1b[<u", "\x1b[=2;2u",
		"\x1b]0;a title\x07", "\x1b]8;;http://example.com\x1b\\", "\x1bP1$r\x1b\\", "\x1b_Gi=1\x1b\\", "\x1b(B", "\x1b=", "\x1b>", "\x1bc", "\x1b[!p",
		"\x1b", "\x1b[", "\x1b]", "\x1b[?", "\x18", "\x1a", "\x07", "\x1b\\",
	}
}

func randomStream(rng *rand.Rand, n int) string {
	vocabulary := pieces()
	var b strings.Builder
	for i := 0; i < n; i++ {
		b.WriteString(vocabulary[rng.IntN(len(vocabulary))])
	}
	return b.String()
}

// The shell's output is cut where its reads end, anywhere: a sequence split across two reads must give what
// the whole gives. Every stream of the vocabulary, cut at every single position and into pieces of every
// small size, ends in the same modes and at the same boundary as the stream read whole.
func TestTheTrackerGivesTheSameModesWhereverTheOutputIsCut(t *testing.T) {
	rng := rand.New(rand.NewPCG(7, 11))
	for range 300 {
		stream := randomStream(rng, 1+rng.IntN(30))
		whole := read(stream, len(stream)+1)
		for piece := 1; piece <= 7; piece++ {
			cut := read(stream, piece)
			require.Equal(t, *whole, *cut, "pieces of %d bytes: %q", piece, stream)
		}
		for at := 1; at < len(stream); at++ {
			split := new(modeTracker)
			split.feed([]byte(stream[:at]))
			split.feed([]byte(stream[at:]))
			require.Equal(t, *whole, *split, "cut at %d: %q", at, stream)
		}
	}
}

// A clone is a tracker of its own: feeding it changes nothing in the one it came from.
func TestACloneOfTheTrackerSharesNothingWithItsOrigin(t *testing.T) {
	origin := read("\x1b[>1u\x1b[?1049h\x1b[>4u", 3)
	before := origin.modes()
	clone := origin.clone()
	clone.feed([]byte("\x1b[>9u\x1b[?1049l\x1b[?2004h\x1b[<u"))
	assert.Equal(t, before, origin.modes())
	assert.NotEqual(t, before, clone.modes())
}
