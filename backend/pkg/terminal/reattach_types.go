package terminal

import "time"

// A terminal that has a page key (Launch.PageKey) survives the page that opened it: when its window is
// retired or reloaded it is DETACHED, not ended, and kept for a lease; a page that comes back finds it with
// ListTerminals, takes it over with AttachTerminal, and is handed the output it missed. These are the shapes
// of that exchange. Their names are the ones the exec lane's SDK uses for the same facts (Replay, Detached,
// TerminalModes, lease_expires_unix_ms), so that the host's local provider and a plugin's sessions can be
// read by the same code.

// Size is the size of a terminal in cells.
type Size struct {
	Cols int `json:"cols"`
	Rows int `json:"rows"`
}

// Mouse tracking bits (TerminalModes.MouseTracking) and encodings (TerminalModes.MouseEncoding).
const (
	// MouseClick is the click tracking of ?9 and ?1000, MouseDrag the button-motion tracking of ?1002 and
	// MouseAnyMotion the all-motion tracking of ?1003.
	MouseClick     = 1
	MouseDrag      = 2
	MouseAnyMotion = 4

	// MouseX10 is the default encoding, MouseUTF8 is ?1005, MouseSGR is ?1006 and MouseURXVT is ?1015.
	MouseX10   = 0
	MouseUTF8  = 1
	MouseSGR   = 2
	MouseURXVT = 3
)

// TerminalModes are the input modes the programs of a terminal have switched on, read from its output by the
// host (the program that set them is not asked): what an emulator that starts from a replay needs to be told
// before the replay, because the bytes that set them may be older than the replay. The host reads the modes of
// every terminal it runs, so Known is always true here.
//
//nolint:revive // The name is the exec lane SDK's own for the same facts: the host's provider and a plugin's sessions are read by the same code.
type TerminalModes struct {
	Known bool `json:"known"`
	// AltScreen is the alternate screen (?47, ?1047, ?1049).
	AltScreen bool `json:"alt_screen"`
	// BracketedPaste is ?2004, ApplicationCursor is ?1 (cursor keys send SS3 sequences), FocusEvents is ?1004
	// and CursorHidden is ?25 reset.
	BracketedPaste    bool `json:"bracketed_paste"`
	ApplicationCursor bool `json:"application_cursor"`
	FocusEvents       bool `json:"focus_events"`
	CursorHidden      bool `json:"cursor_hidden"`
	// MouseTracking is a set of the Mouse bits above and MouseEncoding is one of the encodings.
	MouseTracking int `json:"mouse_tracking"`
	MouseEncoding int `json:"mouse_encoding"`
	// KittyKeyboard is the stack of the kitty keyboard protocol's flags of the screen that is showing, bottom
	// first, at most 16 entries; empty when the protocol is not in use.
	KittyKeyboard []int `json:"kitty_keyboard"`
}

// Replay is the output a page needs to show a terminal again: the bytes from Start to End of the session's
// one sequence of output, and the facts an emulator needs to show them as they were. It describes EXACTLY the
// output the page does not have: the events that come after the attach continue at End, with no byte lost and
// none repeated, and an event whose offset is below End is already in Data.
type Replay struct {
	// Start is the offset of the first byte of Data. It is the offset the page asked for (FromOffset) when the
	// host still has it, and then the page's emulator goes on from where it was. Otherwise it is the oldest
	// offset the host still has, which is above FromOffset (bytes were dropped between them, and the page
	// starts its emulator afresh) or, with no FromOffset, the start of the ring, a position where the output
	// is not inside an escape sequence or a UTF-8 sequence.
	Start uint64 `json:"start"`
	// End is where the live output continues.
	End uint64 `json:"end"`
	// Data is the output from Start to End, untouched.
	Data []byte `json:"data"`
	// StartSize is the size the output at Start was written for and StartModes are the modes in force at
	// Start: an emulator that starts at Start is set to them first. Size and Modes are the size and the modes
	// now, after Data; the replay itself brings an emulator from StartModes to Modes, and Size is what it is
	// resized to when the replay is in.
	StartSize  Size          `json:"start_size"`
	StartModes TerminalModes `json:"start_modes"`
	Size       Size          `json:"size"`
	Modes      TerminalModes `json:"modes"`
}

// AttachRequest is the second argument of AttachTerminal.
type AttachRequest struct {
	// PageKey is the key the terminal was opened with. A window that opened the terminal itself and is still
	// its owner (a native window that reloaded in place keeps its identity) needs no key.
	PageKey string `json:"page_key,omitempty"`
	// FromOffset is the offset of the first byte the page does not have: the offset and length of the last
	// event it took in. Absent, the page has nothing and gets all the host kept.
	FromOffset *uint64 `json:"from_offset,omitempty"`
}

// Attached is the answer of AttachTerminal.
type Attached struct {
	// Session is what the host said when the terminal started, so that a page that lost it has it again. Its
	// Cols and Rows are the size the terminal STARTED at; the size now is Replay.Size.
	Session Session `json:"session"`
	// Replay is the output to show and where the live output continues.
	Replay Replay `json:"replay"`
	// Cwd and Busy are the directory the shell is in and what holds the terminal, as of the attach.
	Cwd  Directory  `json:"cwd"`
	Busy Foreground `json:"busy"`
	// Ended is set when the shell had already ended while no page was attached: Replay is what it wrote, this
	// is how it ended, and no live output follows. (The CLOSE event of such a terminal went to nobody.)
	Ended *End `json:"ended,omitempty"`
}

// DetachRequest is the second argument of DetachTerminal.
type DetachRequest struct {
	// PageKey is the key the terminal was opened with, or absent for the window that owns it.
	PageKey string `json:"page_key,omitempty"`
	// LeaseMs is how long to keep the terminal, in milliseconds. Zero is the terminal's own lease (what it
	// was opened with, or LeaseDefault); above LeaseMax is cut to it, and the answer says what applies.
	LeaseMs int `json:"lease_ms,omitempty"`
}

// Detached is the answer of DetachTerminal.
type Detached struct {
	// LeaseMs is the lease that applies, and LeaseExpiresUnixMs is when the terminal ends if no page attaches
	// before: Unix milliseconds.
	LeaseMs            int   `json:"lease_ms"`
	LeaseExpiresUnixMs int64 `json:"lease_expires_unix_ms"`
}

// Released is what a window going away did to its terminals: how many it detached (those that have a page key)
// and how many it ended (any other). It is not a bound type: the wrapper only counts.
type Released struct {
	Detached int
	Ended    int
}

// Listed is one terminal of ListTerminals: what a page that comes back needs to match it with a tab.
type Listed struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	PID       int       `json:"pid"`
	Shell     Shell     `json:"shell"`
	// Labels and Params are what the page attached when it opened the terminal.
	Labels map[string]string `json:"labels"`
	Params map[string]string `json:"params"`
	// Size is the size now.
	Size Size `json:"size"`
	// Attached says a window has the terminal; false: it is detached and ends at LeaseExpiresUnixMs unless a
	// page attaches before.
	Attached bool `json:"attached"`
	// NextOffset is the offset the next output will have and ReplayStart is the oldest offset the host keeps.
	NextOffset  uint64 `json:"next_offset"`
	ReplayStart uint64 `json:"replay_start"`
	// LeaseExpiresUnixMs is when a detached terminal ends, in Unix milliseconds; zero when it is attached.
	LeaseExpiresUnixMs int64 `json:"lease_expires_unix_ms"`
	// Ended is set for a terminal that ended while no page was attached: how it ended. Its output is still
	// there to attach to, until its lease would have run out.
	Ended *End `json:"ended,omitempty"`
}
