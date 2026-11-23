package terminal

import "bytes"

// modeTracker reads the escape sequences in a terminal's output, which it never changes, to know which input
// modes the programs of the terminal have switched on (TerminalModes). A page that shows a terminal again
// from a replay has to be told them: the bytes that switched them on may be older than the replay, and an
// emulator that does not know that vim has the mouse and the alternate screen sends the wrong bytes for a
// click and shows the wrong screen.
//
// It is the scanner of a terminal's parser, cut to what it has to find (the states of the DEC ANSI parser
// that VT100.net describes): it follows ESC sequences, CSI sequences with their parameters, and the strings
// (OSC, DCS, SOS, PM, APC) that run to a terminator, which it skips whole, so that text inside a title is
// never taken for a mode. It is fed bytes in the pieces the shell wrote them, in any cut: every state it is
// in between two bytes is kept, and a sequence split across two reads gives what the whole would.
//
// It also says when the output is at a boundary (atBoundary): in the ground state, not inside an escape
// sequence, a string or a UTF-8 sequence, which is where a replay may start.
type modeTracker struct {
	state scanState
	// last is the last byte fed.
	last byte

	// The CSI sequence being read.
	private byte
	inter   byte
	bad     bool
	params  [maxCSIParams]int
	count   int
	cur     int
	have    bool

	// The modes.
	altScreen      bool
	bracketedPaste bool
	appCursor      bool
	focusEvents    bool
	cursorHidden   bool
	mouse          int
	encoding       int
	// kitty is the keyboard protocol's stack of each screen: the main one and the alternate one.
	kitty [2][]int
}

type scanState uint8

const (
	scanGround scanState = iota
	// scanEscape is after ESC, scanEscapeIntermediate after ESC and an intermediate byte (a character set
	// designation, for one).
	scanEscape
	scanEscapeIntermediate
	// scanCSI is inside ESC [ and up to its final byte.
	scanCSI
	// scanOSC is inside a string that ends at BEL or ST, scanString inside one that ends at ST (DCS, SOS, PM,
	// APC), and scanStringEscape is after an ESC inside either: the ST that ends it, or the start of a new
	// sequence that cancels it.
	scanOSC
	scanString
	scanStringEscape
)

const (
	escByte = 0x1b
	canByte = 0x18
	subByte = 0x1a
	belByte = 0x07
	// highBit marks a byte of a multi-byte UTF-8 sequence: not ASCII, so not a place a replay may start.
	highBit = 0x80
	decimal = 10
	// maxCSIParams is how many parameters of a sequence are kept (xterm keeps 16); the rest are read and dropped.
	maxCSIParams = 16
	// maxParam clamps a parameter: a longer number is no mode, and the sum must not overflow.
	maxParam = 65535
	// maxKittyDepth is the deepest the keyboard protocol's stack is kept (the protocol says an implementation may
	// bound it, and drops the oldest).
	maxKittyDepth = 16
)

// DEC private mode numbers.
const (
	modeAppCursor      = 1
	modeMouseX10       = 9
	modeCursorVisible  = 25
	modeAltScreenOld   = 47
	modeMouseClick     = 1000
	modeMouseDrag      = 1002
	modeMouseAny       = 1003
	modeFocusEvents    = 1004
	modeMouseUTF8      = 1005
	modeMouseSGR       = 1006
	modeAltScreenClear = 1047
	modeAltScreenSave  = 1049
	modeMouseURXVT     = 1015
	modeBracketedPaste = 2004
)

// Kitty keyboard protocol: the modes of CSI = flags ; mode u.
const (
	kittySetAll = 1
	kittySetAdd = 2
	kittySetDel = 3
)

// atBoundary reports whether the output fed so far is at a place a replay may start: in the ground state,
// and not after the byte of a UTF-8 sequence that may not be complete.
func (t *modeTracker) atBoundary() bool { return t.state == scanGround && t.last < highBit }

// feed reads p, the next bytes of the output.
func (t *modeTracker) feed(p []byte) {
	for len(p) > 0 {
		if t.state == scanGround {
			// Nothing but ESC leaves the ground state: skip to it.
			i := bytes.IndexByte(p, escByte)
			if i < 0 {
				t.last = p[len(p)-1]
				return
			}
			p = p[i:]
		}
		t.step(p[0])
		p = p[1:]
	}
}

// feedToBoundary reads p up to and including the first byte after which the output is at a boundary, and says
// how many bytes that is: all of p when no boundary comes in it.
func (t *modeTracker) feedToBoundary(p []byte) int {
	for i, b := range p {
		t.step(b)
		if t.atBoundary() {
			return i + 1
		}
	}
	return len(p)
}

// step reads one byte.
func (t *modeTracker) step(b byte) {
	t.last = b
	switch b {
	case canByte, subByte:
		// CAN and SUB cancel a sequence and are not part of one.
		t.state = scanGround
		return
	case escByte:
		if t.state == scanOSC || t.state == scanString {
			t.state = scanStringEscape
			return
		}
		t.state = scanEscape
		return
	}
	switch t.state {
	case scanGround:
		// Only ESC leaves it, and feed skips to that.
	case scanString:
		// A string runs on to its terminator.
	case scanEscape:
		t.escape(b)
	case scanEscapeIntermediate:
		t.escapeIntermediate(b)
	case scanCSI:
		t.csi(b)
	case scanOSC:
		if b == belByte {
			t.state = scanGround
		}
	case scanStringEscape:
		if b == '\\' {
			t.state = scanGround
			return
		}
		// The ESC was not the start of an ST: it ended the string and began a sequence of its own.
		t.state = scanEscape
		t.escape(b)
	}
}

// escape reads the byte after ESC.
func (t *modeTracker) escape(b byte) {
	switch {
	case b == '[':
		t.state = scanCSI
		t.beginCSI()
	case b == ']':
		t.state = scanOSC
	case b == 'P' || b == 'X' || b == '^' || b == '_':
		t.state = scanString
	case b >= ' ' && b <= '/':
		t.state = scanEscapeIntermediate
	case b >= '0' && b <= '~':
		if b == 'c' {
			// RIS, the full reset.
			t.reset()
		}
		t.state = scanGround
	case b >= highBit:
		t.state = scanGround
	}
	// Any other control character is carried out inside the sequence, which goes on.
}

// escapeIntermediate reads a byte after ESC and an intermediate: more intermediates, or the final.
func (t *modeTracker) escapeIntermediate(b byte) {
	switch {
	case b >= ' ' && b <= '/':
		// Another intermediate.
	case b >= '0' && b <= '~' || b >= highBit:
		t.state = scanGround
	}
}

func (t *modeTracker) beginCSI() {
	t.private, t.inter, t.bad = 0, 0, false
	t.count, t.cur, t.have = 0, 0, false
}

// csi reads a byte of a CSI sequence: parameters, intermediates, and the final byte that carries it out.
func (t *modeTracker) csi(b byte) {
	switch {
	case b >= '@' && b <= '~':
		t.finishCSI(b)
	case b >= '0' && b <= ';':
		t.csiParameter(b)
	case b >= '<' && b <= '?':
		t.csiPrivate(b)
	case b >= ' ' && b <= '/':
		if t.inter == 0 {
			t.inter = b
		}
	case b >= highBit:
		t.bad = true
	}
	// Any other control character is carried out inside the sequence, which goes on.
}

// csiParameter reads a digit, a ';' or a ':' of a CSI sequence. There are no parameters after an intermediate,
// and a sub-parameter (':') is nothing the tracker reads: the sequence is skipped to its end.
func (t *modeTracker) csiParameter(b byte) {
	switch {
	case t.inter != 0 || b == ':':
		t.bad = true
	case b == ';':
		t.pushParam()
	default:
		t.cur = min(t.cur*decimal+int(b-'0'), maxParam)
		t.have = true
	}
}

// csiPrivate reads the private marker of a CSI sequence, which has to come first.
func (t *modeTracker) csiPrivate(b byte) {
	if t.private == 0 && t.count == 0 && !t.have && t.inter == 0 {
		t.private = b
		return
	}
	t.bad = true
}

// finishCSI reads the final byte: the sequence is carried out, unless it was malformed.
func (t *modeTracker) finishCSI(final byte) {
	if !t.bad {
		if t.have || t.count > 0 {
			t.pushParam()
		}
		t.dispatchCSI(final)
	}
	t.state = scanGround
}

func (t *modeTracker) pushParam() {
	if t.count < maxCSIParams {
		t.params[t.count] = t.cur
		t.count++
	}
	t.cur, t.have = 0, false
}

// param is the i-th parameter, or def when it is absent or zero.
func (t *modeTracker) param(i, def int) int {
	if i < t.count && t.params[i] != 0 {
		return t.params[i]
	}
	return def
}

// dispatchCSI carries out the sequences that change a mode: DECSET and DECRST, the keyboard protocol's push,
// pop and set, and the soft reset.
func (t *modeTracker) dispatchCSI(final byte) {
	switch {
	case t.private == '?' && t.inter == 0 && (final == 'h' || final == 'l'):
		for _, mode := range t.params[:t.count] {
			t.setMode(mode, final == 'h')
		}
	case t.inter == 0 && final == 'u':
		switch t.private {
		case '>':
			t.kittyPush(t.param(0, 0))
		case '<':
			t.kittyPop(t.param(0, 1))
		case '=':
			t.kittySet(t.param(0, 0), t.param(1, kittySetAll))
		}
	case t.private == 0 && t.inter == '!' && final == 'p':
		// DECSTR, the soft reset: the keys and the cursor go back to their defaults; the screen, the mouse and
		// the paste mode stay.
		t.appCursor = false
		t.cursorHidden = false
	}
}

// setMode switches a DEC private mode.
func (t *modeTracker) setMode(mode int, on bool) {
	switch mode {
	case modeAppCursor:
		t.appCursor = on
	case modeMouseX10, modeMouseClick:
		t.mouse = withBit(t.mouse, MouseClick, on)
	case modeMouseDrag:
		t.mouse = withBit(t.mouse, MouseDrag, on)
	case modeMouseAny:
		t.mouse = withBit(t.mouse, MouseAnyMotion, on)
	case modeCursorVisible:
		t.cursorHidden = !on
	case modeAltScreenOld, modeAltScreenClear, modeAltScreenSave:
		t.altScreen = on
	case modeFocusEvents:
		t.focusEvents = on
	case modeMouseUTF8:
		t.setEncoding(MouseUTF8, on)
	case modeMouseSGR:
		t.setEncoding(MouseSGR, on)
	case modeMouseURXVT:
		t.setEncoding(MouseURXVT, on)
	case modeBracketedPaste:
		t.bracketedPaste = on
	}
}

func withBit(set, bit int, on bool) int {
	if on {
		return set | bit
	}
	return set &^ bit
}

// setEncoding switches a mouse encoding on, or off when it is the one in use: the default is then back.
func (t *modeTracker) setEncoding(encoding int, on bool) {
	switch {
	case on:
		t.encoding = encoding
	case t.encoding == encoding:
		t.encoding = MouseX10
	}
}

// stack is the keyboard protocol's stack of the screen that is showing: the protocol keeps one for each.
func (t *modeTracker) stack() *[]int {
	if t.altScreen {
		return &t.kitty[1]
	}
	return &t.kitty[0]
}

func (t *modeTracker) kittyPush(flags int) {
	stack := t.stack()
	if len(*stack) >= maxKittyDepth {
		*stack = append([]int(nil), (*stack)[1:]...)
	}
	*stack = append(*stack, flags)
}

func (t *modeTracker) kittyPop(n int) {
	stack := t.stack()
	*stack = (*stack)[:max(0, len(*stack)-n)]
}

// kittySet changes the flags at the top of the stack: it replaces them, adds to them or takes from them.
func (t *modeTracker) kittySet(flags, mode int) {
	stack := t.stack()
	if len(*stack) == 0 {
		*stack = append(*stack, 0)
	}
	top := &(*stack)[len(*stack)-1]
	switch mode {
	case kittySetAll:
		*top = flags
	case kittySetAdd:
		*top |= flags
	case kittySetDel:
		*top &^= flags
	}
}

// reset is the full reset (ESC c): every mode back to its default.
func (t *modeTracker) reset() {
	t.altScreen, t.bracketedPaste, t.appCursor, t.focusEvents, t.cursorHidden = false, false, false, false, false
	t.mouse, t.encoding = 0, MouseX10
	t.kitty = [2][]int{nil, nil}
}

// modes is what the tracker knows now.
func (t *modeTracker) modes() TerminalModes {
	return TerminalModes{
		Known: true, AltScreen: t.altScreen, BracketedPaste: t.bracketedPaste, ApplicationCursor: t.appCursor,
		FocusEvents: t.focusEvents, CursorHidden: t.cursorHidden, MouseTracking: t.mouse, MouseEncoding: t.encoding,
		KittyKeyboard: append([]int{}, *t.stack()...),
	}
}

// clone is a copy that does not share the stacks, to be fed on its own.
func (t *modeTracker) clone() modeTracker {
	c := *t
	c.kitty = [2][]int{append([]int(nil), t.kitty[0]...), append([]int(nil), t.kitty[1]...)}
	return c
}
