package terminal

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

// Feed reads the next bytes of the output and answers the last title that was set in them, cleaned, and whether one was.
func (t *titleScanner) Feed(p []byte) (string, bool) {
	return "", false
}

// cleanTitle is what a title keeps of the bytes a program sent.
func cleanTitle(raw []byte) string {
	return ""
}

// titleTracker is the title of one terminal, as the host holds it. The output lock orders every call.
type titleTracker struct {
	scan titleScanner
	// pending is the last title the scanner read since the last settle, and has says there is one.
	pending string
	has     bool
	// text and program are the fact the host states: the title, and whether a program runs while it is set. seq counts the changes of the pair, so
	// that a stream tells by one number whether it has sent the current one. A terminal that never had a title has seq 0.
	text    string
	program bool
	seq     uint64
}

func newTitleTracker() *titleTracker { return new(titleTracker) }

// feed reads the next bytes of the output.
func (t *titleTracker) feed(p []byte) {}

// wantsLook says the foreground has to be looked at: a title came, or a program runs under the one that is shown (and may have ended).
func (t *titleTracker) wantsLook() bool { return false }

// settle takes what the scanner read and the foreground fact and says whether the stated pair changed. known is false when the host
// could not tell, and then the last answer stands.
func (t *titleTracker) settle(program, known bool) bool { return false }
