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
	// Env is extra environment for the shell: name to value, added to the launch environment the shell starts from
	// (T1-go.md 2.8.1), a name that is already there takes the value given. It is not the shell's login environment:
	// the shell computes that itself, and the user's startup files may overwrite a name given here. A name is POSIX
	// ([A-Za-z_][A-Za-z0-9_]*, at most MaxEnvName bytes) and is not one the host sets or strips (OMNIVIEW_*, PLUGIN_*,
	// WAILS_*, GOWORK, the launching terminal's variables, TERM, COLORTERM, TERM_PROGRAM, TERM_PROGRAM_VERSION, PWD,
	// SHELL); a value has no NUL and at most MaxEnvValue bytes; there are at most MaxEnvEntries names and MaxEnvBytes
	// bytes of names and values in all. Anything else refuses the whole start, naming `launch.env.<NAME>`, and
	// nothing starts. An error never carries a value.
	Env map[string]string `json:"env,omitempty"`
	// PageKey makes the terminal outlive the page that opened it, and is how a page that comes back finds it: the
	// page makes one random key (a UUID in its sessionStorage serves), gives it here for every terminal it opens
	// and gives it again to ListTerminals and AttachTerminal after a reload. A terminal with a key is not ended
	// when its window goes away: it is detached and kept for LeaseMs (docs/ui-next/status/T2-go.md), its output
	// carries an offset, and what the shell wrote while the page was away is replayed on attach. A terminal
	// without one ends with its window, as before, and cannot be attached again. The key is the page's secret:
	// whoever has it may attach, nothing lists it, and it is 16 to 128 printable ASCII characters (anything else
	// is refused, naming the field).
	PageKey string `json:"page_key,omitempty"`
	// LeaseMs is how long the terminal is kept for a page that comes back once its page is gone, in
	// milliseconds. Zero is LeaseDefault; above LeaseMax is refused, naming the field. It means something
	// only for a terminal that is kept: one with a PageKey (the events lane) or a Channel terminal (the
	// channel lane), which exclude each other. A lease for a terminal that is neither is refused.
	LeaseMs int `json:"lease_ms,omitempty"`
	// Channel makes the terminal a channel terminal: it is reached by the capability that the answer of CreateTerminal
	// carries (Session.Cap, once) and by one stream for each terminal (docs/ui-next/terminal-channel-protocol.md), it
	// has no window and no event, and it is invisible to every call that names a terminal by its id. The stream that
	// holds it is its holder: when that stream ends the terminal is kept for LeaseMs, and a stream that shows the
	// capability takes it over. The host never lets a page that sleeps block the shell (Limits.ChannelRingBytes).
	// It excludes PageKey, which is the events lane's.
	Channel bool `json:"channel,omitempty"`
	// There is no flow-control option; what paces a terminal depends on its lane. A terminal of the events lane is
	// paced by credit (FlowHighBytes, FlowLowBytes), so the host never has more than that delivered and not
	// credited for a client; that bounds what the terminal manager hands on, not what the transport keeps after it
	// credits (docs/ui-next/status/T1-go.md, 2.8.6), and the credit comes from Manager.Ack and Manager.Delivered.
	// A channel terminal does not use that credit: it is paced between ChannelHighBytes and ChannelLowBytes while
	// its page is alive, and its acknowledgements are frames of its own stream
	// (docs/ui-next/terminal-channel-protocol.md).
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
	// Env is the Launch's.
	Env map[string]string
	// PageKey and LeaseMs are the Launch's.
	PageKey string
	LeaseMs int
	// Channel is the Launch's: the terminal is reached by a capability and a stream, and has no owner.
	Channel bool
	// Labels and Params are what the caller attached to the session; the exec lane lists them with it.
	Labels map[string]string
	Params map[string]string
}

// Shell names the program that runs in a terminal.
type Shell struct {
	// Requested is the shell the caller asked for when another one started in its place: the one asked for
	// is not installed or not executable, so the next shell of the stated order started (the caller's
	// setting, $SHELL, the account's shell, bash, sh). Empty when the shell that started is the one asked for.
	Requested string `json:"requested,omitempty"`
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
	// FlowHighBytes and FlowLowBytes are the marks of the credit that paces every terminal: the host
	// stops reading the shell's output while FlowHighBytes of what it delivered have not been credited
	// (so it holds at most that, plus one read of DefaultReadBufferSize, for a client that does not read)
	// and reads again at FlowLowBytes.
	FlowHighBytes int `json:"flow_high_bytes"`
	FlowLowBytes  int `json:"flow_low_bytes"`
	// HangupGraceMs is how long a closing session gets, in milliseconds, between the hangup it is sent
	// and the kill.
	HangupGraceMs int `json:"hangup_grace_ms"`
	// DrainCapMs is the most the host reads from the pty once the shell has exited, in milliseconds: a
	// process of the shell's session that keeps the pty open and writing does not keep the session alive.
	DrainCapMs int `json:"drain_cap_ms"`
	// FlowStallMs is how long a pause on the transport's credit waits, in milliseconds, before the watchdog
	// gives a step of FlowStepBytes; FlowStallCeilingBytes is the most it gives in all until real credit
	// comes again. A client that acknowledges is never stepped.
	FlowStallMs           int `json:"flow_stall_ms"`
	FlowStepBytes         int `json:"flow_step_bytes"`
	FlowStallCeilingBytes int `json:"flow_stall_ceiling_bytes"`
	// ReplayBytes is how much of a terminal's output the host keeps to replay for a page that attaches again
	// (whole chunks, so a little less than this at times): enough for the whole credit window of a client that
	// acknowledges, so that its attach has no gap. LeaseDefaultMs and LeaseMaxMs are the lease of a detached
	// terminal (Launch.LeaseMs) and the most a caller may ask for.
	ReplayBytes    int `json:"replay_bytes"`
	LeaseDefaultMs int `json:"lease_default_ms"`
	LeaseMaxMs     int `json:"lease_max_ms"`
	// ChannelRingBytes is how much output a channel terminal keeps whatever its page does; ChannelHighBytes and
	// ChannelLowBytes are the marks between which the shell is paced while its page is alive; ChannelStallMs is how long
	// a page may make no progress before the shell is let go; ChannelInflightBytes is the most a page that acknowledges
	// holds unacknowledged; ChannelFrameBytes is the largest output frame and ChannelMaxInputBytes the largest input
	// frame (the channel's protocol is in docs/ui-next/terminal-channel-protocol.md).
	ChannelRingBytes     int `json:"channel_ring_bytes"`
	ChannelHighBytes     int `json:"channel_high_bytes"`
	ChannelLowBytes      int `json:"channel_low_bytes"`
	ChannelStallMs       int `json:"channel_stall_ms"`
	ChannelInflightBytes int `json:"channel_inflight_bytes"`
	ChannelFrameBytes    int `json:"channel_frame_bytes"`
	ChannelMaxInputBytes int `json:"channel_max_input_bytes"`
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
	// The credit that paces the session is stated by Limits.
	Limits Limits `json:"limits"`
	// Environment says where the shell's environment came from and how the host's login probe went.
	Environment Environment `json:"environment"`
	// Integration says whether the shell tells the host where its commands start and end (shell integration), and
	// when it does not, why not. The page reads it and never guesses.
	Integration Integration `json:"integration"`
	// LeaseMs is how long the terminal is kept for its page once the page is gone, in milliseconds. Zero: it
	// has no page key and ends with its window.
	LeaseMs int `json:"lease_ms"`
	// Cap is the terminal's capability, set only in the answer of CreateTerminal for a channel terminal (Launch.Channel):
	// 32 random bytes of the host's, base64url, one for the terminal. It is the only way to reach the terminal, it is
	// answered once, and nothing lists it, logs it, puts it in an event, a URL or an error.
	Cap string `json:"cap,omitempty"`
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
	// ClosedByDetachTimeout: no page attached again before the lease of a terminal its page left ran out. (The
	// word the exec lane's SDK uses for the same end.)
	ClosedByDetachTimeout ClosedBy = "detach-timeout"
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
	// DrainCapped says the host stopped reading at the drain cap although the pty was still open and
	// written to: a process of the shell's session (a background job) holds it. What that process writes
	// after the cap is not delivered.
	DrainCapped bool `json:"drain_capped,omitempty"`
	// DroppedBytes is how many bytes the host read after the cap and discarded: a lower bound, because
	// what the process writes after the host closes the pty is lost to the kernel and cannot be counted.
	DroppedBytes int `json:"dropped_bytes,omitempty"`
	// LastOffset is one past the last byte of output the session wrote: the length of its output, in the numbering
	// that the events of a terminal with a page key and Replay.End use. A page that has taken in LastOffset bytes
	// has it all.
	LastOffset uint64 `json:"last_offset"`
}

// clone is a copy of the end that shares nothing with it: its pointers are copies too, so that a caller that changes what it was
// given changes its own copy.
func (e End) clone() End {
	if e.ExitCode != nil {
		code := *e.ExitCode
		e.ExitCode = &code
	}
	if e.Failure != nil {
		failure := *e.Failure
		e.Failure = &failure
	}
	return e
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
	// ReasonEnded: the terminal ended; there is no shell to ask.
	ReasonEnded UnknownReason = "ended"
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

// Command is one command of a terminal's record: what the shell's integration said about it (the marks of package marks), with the offsets of
// the output it printed. The offsets are those of the terminal's output stream (the `offset` of an output frame): `[output_start, output_end)` is
// what the command printed. Times are on the host's clock when it read the marks.
//
// `command_line` and `cwd` are the user's data: the command line is here only when the shell sent it with the session's nonce (`command_trust`
// `nonce`), and the directory says in `cwd_trust` how far it can be believed. A mark any program could have printed gives neither.
type Command struct {
	ID string `json:"id"`
	// State is prompt, input, running or ended. Ran is false for a prompt that ended with no command (Ctrl-C at an empty prompt).
	State string `json:"state"`
	Ran   bool   `json:"ran"`
	// CommandLine is the line as the shell sent it, empty without the nonce.
	CommandLine  string `json:"command_line,omitempty"`
	CommandTrust string `json:"command_trust"`
	Cwd          string `json:"cwd,omitempty"`
	CwdTrust     string `json:"cwd_trust"`
	// ExitCode is absent while the command runs and for a shell that sends none (pwsh).
	ExitCode *int32 `json:"exit_code,omitempty"`
	// StartedUnixMs and EndedUnixMs are absent for a time that has not come.
	StartedUnixMs int64  `json:"started_unix_ms,omitempty"`
	EndedUnixMs   int64  `json:"ended_unix_ms,omitempty"`
	PromptOffset  uint64 `json:"prompt_offset"`
	OutputStart   uint64 `json:"output_start"`
	OutputEnd     uint64 `json:"output_end"`
}

// Commands is the record of a channel terminal: the newest commands the shell's integration told of, oldest first, at most 512.
type Commands struct {
	// Integration is the state of the shell integration of the terminal: the record is empty for off, skipped and failed (unconfirmed has a scanner).
	Integration IntegrationState `json:"integration"`
	// Running is the id of the command that has started and not ended, empty when none has.
	Running string `json:"running,omitempty"`
	// Cwd is the directory the shell last said it is in, and CwdTrust how far that can be believed (`nonce`, or empty when it said none).
	Cwd      string `json:"cwd,omitempty"`
	CwdTrust string `json:"cwd_trust,omitempty"`
	// End is the length of the output the record was read at.
	End      uint64    `json:"end"`
	Commands []Command `json:"commands"`
}

// Sink receives a session's events. All calls for one session come from one goroutine at a time and
// in order: every Output of a session precedes its one Closed. Calls for different sessions may be
// concurrent. A Sink must not call back into the Manager for the same session, except Ack and DeliveryCredit.
//
// A Sink that returns from Output once the transport has taken the bytes (a blocking write, a bounded
// queue) needs nothing more: the manager credits what Output returned from. A Sink whose Output returns
// at once, whatever the client is doing (an unbounded queue, as Wails' server mode has), implements
// DeliveryReporter and tells the manager when the transport really took the bytes: it asks for the session's
// Credit (Manager.DeliveryCredit) inside Output and calls Credit.Delivered later, from any goroutine. The Credit
// is bound to the session, so a report that comes after the session ended and its id was reused credits nothing.
// The credit comes back only as fast as the client's socket drains.
type Sink interface {
	// Output delivers bytes the shell wrote. The slice belongs to the receiver. The bytes are the
	// shell's, untouched: a multi-byte character may be cut between two calls.
	Output(sessionID string, data []byte)
	// Closed delivers how the session ended. It is the last call for the session.
	Closed(sessionID string, end End)
}

// DeliveryReporter marks a Sink that reports, through Credit.Delivered, when the transport has taken
// output on its way to the client. Without the mark the manager takes the return of Output for delivery.
type DeliveryReporter interface {
	ReportsDelivery()
}

// OffsetSink is a Sink that is also told where each output lies in the session's one sequence of bytes: its
// offset is the number of bytes the session wrote before it. The manager calls OutputAt, and not Output, for a
// terminal that has a page key; any other terminal's output goes to Output as before. Every OutputAt of a
// session is contiguous with the one before it: offset is the previous offset plus its length.
//
// The manager holds a lock an attach waits for while it calls OutputAt, so that the events below the end of an
// attach's replay are all out before the attach answers: OutputAt must return without waiting for anything an
// attach does (a queue that takes the event at once, as the exec lane's does).
type OffsetSink interface {
	Sink
	// OutputAt delivers bytes the shell wrote, which start at offset. The slice belongs to the receiver.
	OutputAt(sessionID string, offset uint64, data []byte)
}

// DetachmentSink is a Sink that is also told when a page lost a terminal it had attached (Detachment). The
// call comes from the call that changed hands (Attach, Detach, ReleaseOwned), after it did and with no lock held,
// so it may be concurrent with the session's output; it must not call back into the Manager for the session.
type DetachmentSink interface {
	Sink
	// Detached says a page lost the terminal and why.
	Detached(sessionID string, detachment Detachment)
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

	// FlowHighBytes and FlowLowBytes are the marks of the credit that paces every terminal: the host stops
	// reading a shell's output while FlowHighBytes of what it delivered have not been credited, and reads
	// again at FlowLowBytes. (VS Code's pty host pauses at 100,000 characters and resumes at 5,000; the unit
	// here is bytes and the marks are larger because a Wails event costs more than a Node message.)
	FlowHighBytes = 1 << 20
	FlowLowBytes  = 256 << 10

	// FlowStall, FlowStepBytes and FlowStallCeilingBytes are the watchdog of a pause on the transport's
	// credit (flowControl): after FlowStall without credit it gives FlowStepBytes, and at most
	// FlowStallCeilingBytes until real credit comes again. It only pauses the read and drops nothing: what a
	// client that stopped reading has not been credited for is at most the high mark plus the ceiling, and a
	// transport whose credit never comes trickles instead of freezing.
	FlowStall             = 2 * time.Second
	FlowStepBytes         = FlowLowBytes
	FlowStallCeilingBytes = 8 << 20

	// HangupGrace is how long a closing session gets between the hangup its foreground program and
	// shell are sent and the kill of what ignored it.
	HangupGrace = 1500 * time.Millisecond

	// drainCap is the most the host reads from the pty once the shell has exited, counted from the exit and
	// not per read: a process that keeps the pty open and writing (a background job) cannot keep the session
	// alive. The CLOSE comes at the cap, with the shell's exit facts.
	drainCap = 3 * time.Second

	// ReplayBytes is how much of a terminal's output is kept to replay (Limits.ReplayBytes): the whole
	// credit window of a client that acknowledges (FlowHighBytes, plus one read) and the room that dropping
	// whole chunks takes, so that a page that left with the host at the high mark finds every byte it lacks.
	ReplayBytes = FlowHighBytes + FlowLowBytes
	// LeaseDefault is how long a terminal is kept for the page that left it, and LeaseMax is the most a caller
	// may ask for.
	LeaseDefault = 5 * time.Minute
	LeaseMax     = 30 * time.Minute
	// MinPageKeyBytes and MaxPageKeyBytes bound a page key: long enough that nobody guesses it.
	MinPageKeyBytes = 16
	MaxPageKeyBytes = 128
	// TombstoneLimit is how many terminals that ended while no page was attached the host remembers, so that the
	// page that comes back can still read how they ended.
	TombstoneLimit = 16
	// ChannelTombstoneLimit is how many ends of channel terminals the host remembers. The ends of the events lane have the budget
	// above and neither lane takes the other's: the oldest of a lane goes first, even before its lease is over, so the time an end is
	// listed with is not a promise that it is still there.
	ChannelTombstoneLimit = 16
	// The channel of a terminal opened with Launch.Channel (docs/ui-next/terminal-channel-protocol.md): the host
	// reads the shell into a ring of ChannelRingBytes whatever the page does, and the ring overwrites its oldest
	// bytes, counting them, when it is full. A stream's sender reads the ring in frames of at most ChannelFrameBytes
	// at the pace of its page. While the page is alive (a frame was taken or acknowledged within ChannelStall) and
	// more than ChannelHighBytes wait unsent the shell is paced until ChannelLowBytes wait (lossless); a page that
	// made no progress for ChannelStall, or none attached, never holds the shell. A page that acknowledges holds at
	// most ChannelInflightBytes sent and not acknowledged. ChannelMaxInputBytes bounds one input frame.
	ChannelRingBytes     = 8 << 20
	ChannelHighBytes     = 1 << 20
	ChannelLowBytes      = 256 << 10
	ChannelStall         = 2 * time.Second
	ChannelInflightBytes = 1 << 20
	ChannelFrameBytes    = 64 << 10
	ChannelMaxInputBytes = 1 << 20
	// MaxListedCaps bounds the capabilities one ListChannels call may carry.
	MaxListedCaps = 1024

	maxIDLength = 128
)

// defaultLimits states the bounds above.
func defaultLimits() Limits {
	return Limits{
		MaxDimension:          MaxDimension,
		PendingOps:            MaxPendingOps,
		PendingBytes:          MaxPendingBytes,
		SeqAhead:              MaxSeqAhead,
		GapWaitMs:             int(GapWait / time.Millisecond),
		FlowHighBytes:         FlowHighBytes,
		FlowLowBytes:          FlowLowBytes,
		HangupGraceMs:         int(HangupGrace / time.Millisecond),
		DrainCapMs:            int(drainCap / time.Millisecond),
		FlowStallMs:           int(FlowStall / time.Millisecond),
		FlowStepBytes:         FlowStepBytes,
		FlowStallCeilingBytes: FlowStallCeilingBytes,
		ReplayBytes:           ReplayBytes,
		LeaseDefaultMs:        int(LeaseDefault / time.Millisecond),
		LeaseMaxMs:            int(LeaseMax / time.Millisecond),
		ChannelRingBytes:      ChannelRingBytes,
		ChannelHighBytes:      ChannelHighBytes,
		ChannelLowBytes:       ChannelLowBytes,
		ChannelStallMs:        int(ChannelStall / time.Millisecond),
		ChannelInflightBytes:  ChannelInflightBytes,
		ChannelFrameBytes:     ChannelFrameBytes,
		ChannelMaxInputBytes:  ChannelMaxInputBytes,
	}
}
