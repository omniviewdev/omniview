package terminal

import (
	"bytes"
	"strings"
	"unicode"
	"unicode/utf8"
)

// THE TITLE A PROGRAM SETS (issue #695 step 4; docs/ui-next/terminal-channel-protocol.md section 4b).
//
// A program sets the title of its terminal with OSC 0 (icon name and title) and OSC 2 (title). The host reads those two out of the
// output in the one step that appends the output to the replay ring, so that the page never has to scan the bytes (a tab that no body
// is mounted for would miss them), keeps the last one in a bounded string and says, with it, whether a program runs: the producer's own
// fact (the process group that holds the terminal's foreground, and a command the shell's integration said it started), taken when the
// title is set and while a program runs, and never by the page.
//
// A title is output of a shell or of a program, so it is untrusted text: what is kept has no control character, no line or paragraph
// separator and no bidirectional control (nothing that can carry an escape sequence or reorder what a tab says), is valid UTF-8 and is
// at most maxTitleBytes long. A title of any length costs the scanner at most maxTitleRead bytes.

const (
	// maxTitleBytes is the most a title keeps, in bytes of UTF-8, after it is cleaned.
	maxTitleBytes = 256
	// maxTitleRead is the most of one title that the scanner holds: the rest of a longer one is dropped as it passes.
	maxTitleRead = 1024
	// titlePrefixBytes is the "0;" or "2;" that begins the body of the OSC.
	titlePrefixBytes = 2
	// titleFrameVersion is the version of the title frame: the value of the attach's `title` and of the ready frame's.
	titleFrameVersion = 1
)

// titleScanner reads OSC 0 and OSC 2 out of the output, across the chunks it is fed.
type titleScanner struct {
	state titleScanState
	// buf holds the body of the OSC being read, after its introducer, at most maxTitleRead + 2 bytes ("0;" and the text).
	buf []byte
	// ignore says the OSC being read is not one this scanner reads, and over that its text was longer than maxTitleRead.
	ignore, over bool
	// off is the offset of the next byte to be fed, cur the offset of the byte being read, and lastEnd the offset after the last title that was read.
	off, cur, lastEnd uint64
}

type titleScanState uint8

const (
	titleGround titleScanState = iota
	titleEscape
	titleEscapeIntermediate
	titleCSI
	titleOSC
	titleOSCEscape
	titleString
	titleStringEscape
)

// Feed reads the next bytes of the output and answers the last title that was set in them, cleaned, and whether one was. The scanner is the
// emulator's own reading of the sequences that matter here: CAN and SUB cancel a sequence, BEL or ESC \ ends an OSC, an ESC that is not the
// start of ST ends it too and begins a sequence of its own, and a control character inside an OSC is ignored.
func (t *titleScanner) Feed(p []byte) (string, bool) {
	var title string
	found := false
	for i := 0; i < len(p); i++ {
		if t.state == titleGround {
			// Nothing but ESC leaves the ground state: skip to it.
			j := bytes.IndexByte(p[i:], escByte)
			if j < 0 {
				break
			}
			i += j
		}
		t.cur = t.off + uint64(i)
		if text, ok := t.step(p[i]); ok {
			title, found = text, true
			t.lastEnd = t.cur + 1
		}
	}
	t.off += uint64(len(p))
	return title, found
}

// step reads one byte and answers the title it completed, if it did.
func (t *titleScanner) step(b byte) (string, bool) {
	switch b {
	case canByte, subByte:
		t.state = titleGround
		return "", false
	case escByte:
		return t.escape()
	}
	switch t.state {
	case titleGround, titleString:
		// Only ESC leaves the ground state, and a string runs on to its terminator.
	case titleEscape:
		t.afterEscape(b)
	case titleEscapeIntermediate:
		if b >= '0' && b <= '~' || b >= 0x80 {
			t.state = titleGround
		}
	case titleCSI:
		if b >= '@' && b <= '~' {
			t.state = titleGround
		}
	case titleOSC:
		if b == belByte {
			return t.finish()
		}
		if b >= 0x20 && b != 0x7f {
			t.collect(b)
		}
	case titleOSCEscape:
		if b == '\\' {
			return t.finish()
		}
		text, ok := t.finish()
		t.afterEscape(b)
		return text, ok
	case titleStringEscape:
		if b == '\\' {
			t.state = titleGround
			return "", false
		}
		t.afterEscape(b)
	}
	return "", false
}

// escape reads an ESC.
func (t *titleScanner) escape() (string, bool) {
	switch t.state {
	case titleOSC:
		t.state = titleOSCEscape
		return "", false
	case titleString:
		t.state = titleStringEscape
		return "", false
	case titleOSCEscape:
		// ESC ESC inside an OSC: the first ended it, and the second begins a sequence.
		text, ok := t.finish()
		t.state = titleEscape
		return text, ok
	case titleGround, titleEscape, titleEscapeIntermediate, titleCSI, titleStringEscape:
		// ESC begins a sequence wherever it comes (a sequence it interrupts is cancelled).
	}
	t.state = titleEscape
	return "", false
}

// afterEscape reads the byte after ESC.
func (t *titleScanner) afterEscape(b byte) {
	switch {
	case b == '[':
		t.state = titleCSI
	case b == ']':
		t.state = titleOSC
		if t.buf == nil {
			t.buf = make([]byte, 0, maxTitleRead+titlePrefixBytes)
		}
		t.buf = t.buf[:0]
		t.ignore, t.over = false, false
	case b == 'P' || b == 'X' || b == '^' || b == '_':
		t.state = titleString
	case b >= ' ' && b <= '/':
		t.state = titleEscapeIntermediate
	case b >= '0' && b <= '~' || b >= 0x80:
		t.state = titleGround
	default:
		// Any other control character is carried out inside the sequence, which goes on.
		t.state = titleEscape
	}
}

// collect keeps a byte of an OSC that is read, and drops it when the OSC is not one this scanner reads or it is too long.
func (t *titleScanner) collect(b byte) {
	if t.ignore || t.over {
		return
	}
	if len(t.buf) == maxTitleRead+titlePrefixBytes {
		t.over = true
		return
	}
	t.buf = append(t.buf, b)
	switch len(t.buf) {
	case 1:
		// OSC 0 and OSC 2: "0;" or "2;" and the text. 1 is the icon name, 20 and 22 are others.
		if b != '0' && b != '2' {
			t.ignore = true
		}
	case titlePrefixBytes:
		if b != ';' {
			t.ignore = true
		}
	}
}

// finish ends the OSC being read.
func (t *titleScanner) finish() (string, bool) {
	t.state = titleGround
	if t.ignore || len(t.buf) < titlePrefixBytes {
		return "", false
	}
	// A title that was longer than the scanner holds is cut here, as one that is longer than a title keeps.
	return cleanTitle(t.buf[titlePrefixBytes:]), true
}

// cleanTitle is what a title keeps of the bytes a program sent: valid UTF-8 (a byte that is not becomes U+FFFD), without a control character
// (C0, DEL and C1: nothing that can carry an escape sequence), a line or paragraph separator or a bidirectional control (nothing that reorders
// what a tab says), cut at a rune boundary to maxTitleBytes, with its outer white space removed.
func cleanTitle(raw []byte) string {
	var out strings.Builder
	out.Grow(min(len(raw), maxTitleBytes))
	// A run of bytes that are not UTF-8 is one replacement character.
	for _, r := range strings.ToValidUTF8(string(raw), "\ufffd") {
		if droppedInTitle(r) {
			continue
		}
		if out.Len()+utf8.RuneLen(r) > maxTitleBytes {
			break
		}
		out.WriteRune(r)
	}
	return strings.TrimFunc(out.String(), unicode.IsSpace)
}

// droppedInTitle says a rune never reaches a title.
func droppedInTitle(r rune) bool {
	switch {
	case unicode.IsControl(r):
		return true
	case unicode.Is(unicode.Cf, r) && r != '\u200d' && r != '\u200c':
		// Zero-width and invisible format characters (U+200B, U+2060, U+FEFF, U+00AD, the tags), but for the joiners (U+200D of an emoji sequence, U+200C of Persian and Hindi spellings).
		return true
	case r == '\u115f' || r == '\u1160' || r == '\u3164' || r == '\uffa0' || r == '\u2800':
		// Fillers and the blank braille cell: they draw as nothing.
		return true
	case r == '\u2028' || r == '\u2029':
		return true
	case r == '\u061c' || r == '\u200e' || r == '\u200f':
		return true
	case r >= '\u202a' && r <= '\u202e':
		return true
	case r >= '\u2066' && r <= '\u2069':
		return true
	}
	return false
}

// titleTracker is the title of one terminal, as the host holds it. The output lock orders every call.
type titleTracker struct {
	scan titleScanner
	// pending is the last title the scanner read since the last settle, and has says there is one.
	pending   string
	pendingAt uint64
	has       bool
	// text and program are the fact the host states: the title, and whether a program runs while it is set. seq counts the changes of the pair, so
	// that a stream tells by one number whether it has sent the current one. A terminal that never had a title has seq 0.
	text    string
	program bool
	seq     uint64
	// at is the offset after the sequence that set text.
	at uint64
}

func newTitleTracker() *titleTracker { return new(titleTracker) }

// feed reads the next bytes of the output.
func (t *titleTracker) feed(p []byte) {
	if title, ok := t.scan.Feed(p); ok {
		t.pending, t.pendingAt, t.has = title, t.scan.lastEnd, true
	}
}

// wantsLook says the foreground has to be looked at: a title came, or a program runs under the one that is shown (and may have ended).
func (t *titleTracker) wantsLook() bool { return t.has || t.program }

// setAfter says the title is one the shell's prompt did not draw: it was set after the last prompt was drawn (promptEnd is the offset after the last input-start mark: PS1 sits between the prompt-start and it), as a
// preexec hook sets it, and no program holds it yet. The vouched start of a command that follows makes it that program's.
func (t *titleTracker) setAfter(promptEnd uint64) bool {
	return t.text != "" && !t.program && t.at > promptEnd
}

// settle takes what the scanner read and the foreground fact and says whether the stated pair changed. known is false when the host
// could not tell, and then the last answer stands. A terminal with no title has no program under it.
func (t *titleTracker) settle(program, known bool) bool {
	text := t.text
	if t.has {
		text, t.at, t.pending, t.has = t.pending, t.pendingAt, "", false
	}
	if !known {
		program = t.program
	}
	if text == "" {
		program = false
	}
	if text == t.text && program == t.program {
		return false
	}
	t.text, t.program = text, program
	t.seq++
	return true
}
