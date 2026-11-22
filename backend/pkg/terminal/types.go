// Package terminal runs the host's local terminals: a shell on a pseudo-terminal of this machine.
// It says what it knows about each terminal instead of leaving a reader to guess: which shell
// started and where, what size the shell started at, whether a program other than the shell holds
// the terminal, which directory it is in, and how the session ended. A session belongs to an owner
// (the window that opened it) and ends with it.
package terminal

import "time"

// Owner names what a session belongs to. Any comparable value serves: the host passes the identity
// of the window that opened the terminal. The zero value is no owner: the session lives until it is
// closed.
type Owner any

// Launch is the second argument of CreateTerminal: where the terminal starts, how big it is, and how
// its output is paced. Every field is optional; zero is "not given".
type Launch struct {
	// Cols and Rows are the size of the terminal in cells. The pty is opened at this size before the
	// shell starts, so the shell lays out its first prompt for it. Zero is "not given" and becomes the
	// default (DefaultCols by DefaultRows), each dimension on its own; a dimension below zero or over
	// MaxDimension is refused, naming it.
	Cols int `json:"cols,omitempty"`
	Rows int `json:"rows,omitempty"`
	// Cwd is the directory the shell starts in: an absolute path to a directory that exists. Empty: the
	// user's home. Anything else is refused, naming the field.
	Cwd string `json:"cwd,omitempty"`
	// Flow asks for flow control: the host stops reading the shell's output while FlowHighBytes of what
	// it delivered are unacknowledged and reads again once the caller has acknowledged it down to
	// FlowLowBytes (AckTerminal). The shell blocks in its own write meanwhile, so a hidden or slow page
	// costs the shell time and the host no memory. Off (the default): the host reads and delivers as fast
	// as the shell writes, which is what a caller that never acknowledges needs.
	Flow bool `json:"flow,omitempty"`
}

// Options is what the manager starts a terminal from. CreateTerminal builds it from the SDK's session
// options (the id, the command, the labels and params) and the Launch.
type Options struct {
	// ID is the session id the caller chose, so that it can listen for the session's events before
	// the shell starts. Empty: the host makes one. An id that is in use is refused.
	ID string
	// Command names the shell. Empty is the account's login shell. The first element is a shell's
	// name or path and the rest are arguments that follow the login flags. A program that is not a
	// shell is refused.
	Command []string
	Cols    int
	Rows    int
	Cwd     string
	Flow    bool
	// Labels and Params are what the caller attached to the session; the exec lane lists them with it.
	Labels map[string]string
	Params map[string]string
}

// Shell names the program that runs in a terminal.
type Shell struct {
	// Path is the absolute path of the executable that started.
	Path string `json:"path"`
	// Name is the shell's own name (`zsh`, `bash`), the one a tab can show: the file a symlink
	// points at, not the name of the link.
	Name string `json:"name"`
}

// Limits are the bounds the host holds a session to, stated so that a caller never hard-codes them.
type Limits struct {
	// MaxDimension is the largest number of columns or rows a size may have.
	MaxDimension int `json:"max_dimension"`
	// PendingOps and PendingBytes bound the input operations (writes and resizes) a session holds
	// while it applies them one at a time. Past either bound a call is refused at once, typed
	// `INPUT_BACKLOG`, and nothing is dropped.
	PendingOps   int `json:"pending_ops"`
	PendingBytes int `json:"pending_bytes"`
	// SeqAhead is how far ahead of the next expected sequence number a call may be.
	SeqAhead int `json:"seq_ahead"`
	// GapWaitMs is how long an operation waits for its predecessor, in milliseconds, before the
	// host gives the missing number up.
	GapWaitMs int `json:"gap_wait_ms"`
	// FlowHighBytes and FlowLowBytes are the marks of flow control (Launch.Flow): at most
	// FlowHighBytes of delivered output wait for an acknowledgement, plus one read of
	// DefaultReadBufferSize; reading resumes at FlowLowBytes.
	FlowHighBytes int `json:"flow_high_bytes"`
	FlowLowBytes  int `json:"flow_low_bytes"`
	// HangupGraceMs is how long a closing session gets, in milliseconds, between the hangup it is sent
	// and the kill.
	HangupGraceMs int `json:"hangup_grace_ms"`
}

// Session is what the host says about a terminal it started.
type Session struct {
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"created_at"`
	// PID is the shell's process id.
	PID int `json:"pid"`
	// Shell is the shell that started.
	Shell Shell `json:"shell"`
	// Cwd is the directory the shell started in.
	Cwd string `json:"cwd"`
	// Cols and Rows are the size the pty was opened at: the size asked for, or the default.
	Cols int `json:"cols"`
	Rows int `json:"rows"`
	// Flow says whether flow control is on for this session.
	Flow   bool   `json:"flow"`
	Limits Limits `json:"limits"`
}

// EndReason says how a session ended. It is the one field every End has.
type EndReason string

const (
	// EndExited: the shell exited by itself; ExitCode is its status.
	EndExited EndReason = "exited"
	// EndSignaled: a signal the host did not send killed the shell; Signal names it.
	EndSignaled EndReason = "signaled"
	// EndClosed: the host ended the session; ClosedBy says who asked.
	EndClosed EndReason = "closed"
	// EndFailed: the pty or the wait for the shell failed; Failure says where.
	EndFailed EndReason = "failed"
)

// ClosedBy says who asked the host to end a session.
type ClosedBy string

const (
	// ClosedByRequest: a caller closed the session (the user pressed Close).
	ClosedByRequest ClosedBy = "request"
	// ClosedByWindow: the window that owned the session went away.
	ClosedByWindow ClosedBy = "window"
	// ClosedByShutdown: the host is shutting down.
	ClosedByShutdown ClosedBy = "shutdown"
)

// FailureStage says where a session failed.
type FailureStage string

const (
	// StageRead: reading the shell's output failed while the shell was running.
	StageRead FailureStage = "read"
	// StageWait: waiting for the shell's status failed.
	StageWait FailureStage = "wait"
	// StagePty: the pty closed while the shell was still running.
	StagePty FailureStage = "pty"
)

// Failure is what went wrong when a session failed.
type Failure struct {
	Stage FailureStage `json:"stage"`
	// Message is the system's own words, for a person to read. Nothing branches on it.
	Message string `json:"message"`
}

// End says how a session ended, as typed fields. Which fields are set depends on Reason:
// exited has ExitCode, signaled has Signal and SignalNumber, closed has ClosedBy, failed has
// Failure. It is the payload of the session's one CLOSE event, which follows the last output.
type End struct {
	Reason EndReason `json:"reason"`
	// ExitCode is the shell's exit status. A pointer, because zero is a status.
	ExitCode *int `json:"exit_code,omitempty"`
	// Signal is the name of the signal that killed the shell (`SIGTERM`), SignalNumber its number.
	Signal       string   `json:"signal,omitempty"`
	SignalNumber int      `json:"signal_number,omitempty"`
	CoreDumped   bool     `json:"core_dumped,omitempty"`
	ClosedBy     ClosedBy `json:"closed_by,omitempty"`
	Failure      *Failure `json:"failure,omitempty"`
}

// State is the answer to "is something other than the shell in the foreground of the terminal?".
// It has three values on purpose: a platform that cannot tell says so instead of guessing.
type State string

const (
	// StateIdle: the shell itself holds the foreground. Background jobs do not count.
	StateIdle State = "idle"
	// StateBusy: a process other than the shell holds the foreground.
	StateBusy State = "busy"
	// StateUnknown: the host cannot tell; Reason says why. A caller that has to decide asks.
	StateUnknown State = "unknown"
)

// UnknownReason says why a Foreground or a Directory is unknown.
type UnknownReason string

const (
	// ReasonUnsupported: this build cannot run local terminals (Windows: the host has no ConPTY
	// backend, and a ConPTY has no foreground process group to ask about), or the platform has no
	// cheap way to read the fact.
	ReasonUnsupported UnknownReason = "unsupported"
	// ReasonQueryFailed: the system refused the question.
	ReasonQueryFailed UnknownReason = "query-failed"
	// ReasonRemote: the session runs on another machine; the host holds no terminal for it.
	ReasonRemote UnknownReason = "remote"
)

// Foreground is the fact "what holds the terminal now". It is a snapshot: it can change the moment
// it is read.
type Foreground struct {
	State State `json:"state"`
	// Name is the busy process's name, when the platform gives it (see foreground_*.go). Empty: the
	// platform did not say, which does not make the state less true.
	Name string `json:"name,omitempty"`
	// PGID is the foreground process group, when busy.
	PGID int `json:"pgid,omitempty"`
	// Reason is set when State is unknown.
	Reason UnknownReason `json:"reason,omitempty"`
}

// UnknownForeground is the answer of a host that cannot tell.
func UnknownForeground(reason UnknownReason) Foreground {
	return Foreground{State: StateUnknown, Name: "", PGID: 0, Reason: reason}
}

// Directory is the fact "where is the shell now": its current working directory, read from the system
// when asked (`/proc/<pid>/cwd` on Linux, `proc_info` on macOS), so a new terminal can open here and a
// tab can show the directory. It is a snapshot.
type Directory struct {
	// Path is the shell's current directory, when known.
	Path string `json:"path,omitempty"`
	// Reason is set when it is not known.
	Reason UnknownReason `json:"reason,omitempty"`
}

// Sink receives a session's events. All calls for one session come from one goroutine at a time and
// in order: every Output of a session precedes its one Closed. Calls for different sessions may be
// concurrent. A Sink must not call back into the Manager for the same session, except Ack.
type Sink interface {
	// Output delivers bytes the shell wrote. The slice belongs to the receiver. The bytes are the
	// shell's, untouched: a multi-byte character may be cut between two calls.
	Output(sessionID string, data []byte)
	// Closed delivers how the session ended. It is the last call for the session.
	Closed(sessionID string, end End)
}

const (
	// DefaultCols and DefaultRows are the size of a terminal the caller gave none for.
	DefaultCols = 80
	DefaultRows = 24
	// MaxDimension is the largest number of columns or rows a size may have.
	MaxDimension = 1000

	// MaxPendingOps and MaxPendingBytes bound the input a session holds while it applies it one
	// operation at a time. The byte bound counts what already waits, so a single large write is
	// accepted when nothing waits.
	MaxPendingOps   = 256
	MaxPendingBytes = 1 << 20
	// MaxSeqAhead is how many numbers ahead of the next expected a sequenced operation may be.
	MaxSeqAhead = 64
	// GapWait is how long an operation waits for the one before it before the host gives the
	// missing sequence number up and goes on.
	GapWait = 2 * time.Second

	// FlowHighBytes and FlowLowBytes are the marks of flow control: the host stops reading a shell's
	// output while FlowHighBytes of what it delivered are unacknowledged, and reads again at
	// FlowLowBytes. (VS Code's pty host pauses at 100,000 characters and resumes at 5,000; the unit
	// here is bytes and the marks are larger because a Wails event costs more than a Node message.)
	FlowHighBytes = 1 << 20
	FlowLowBytes  = 256 << 10

	// HangupGrace is how long a closing session gets between the hangup its foreground program and
	// shell are sent and the kill of what ignored it.
	HangupGrace = 1500 * time.Millisecond

	maxIDLength = 128
)

// defaultLimits states the bounds above.
func defaultLimits() Limits {
	return Limits{
		MaxDimension:  MaxDimension,
		PendingOps:    MaxPendingOps,
		PendingBytes:  MaxPendingBytes,
		SeqAhead:      MaxSeqAhead,
		GapWaitMs:     int(GapWait / time.Millisecond),
		FlowHighBytes: FlowHighBytes,
		FlowLowBytes:  FlowLowBytes,
		HangupGraceMs: int(HangupGrace / time.Millisecond),
	}
}
