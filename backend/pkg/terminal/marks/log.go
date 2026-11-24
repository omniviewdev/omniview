package marks

import (
	"fmt"
	"strconv"
	"sync"
	"time"
)

// DefaultMaxRecords is how many commands a Log keeps when Config.MaxRecords is not set.
const DefaultMaxRecords = 512

// MaxCommandLine and MaxCwd are the most bytes of a command line and of a directory that a Record keeps. A longer
// command line is cut at the limit; a longer directory is dropped (it is no directory a shell is in). With
// DefaultMaxRecords they bound a Log at about 4 MiB, and a typical one is a few hundred bytes a command.
const (
	MaxCommandLine = 4096
	MaxCwd         = 4096
)

// State is how far a command has come.
type State uint8

// The states of a command's record.
const (
	// StatePrompt is a prompt shown and no input yet, StateInput a prompt with its input started.
	StatePrompt State = iota
	StateInput
	// StateRunning is a command that started (OSC 133 C) and did not end.
	StateRunning
	// StateEnded is a command that ended (OSC 133 D), with or without having run.
	StateEnded
)

func (s State) String() string {
	switch s {
	case StatePrompt:
		return "prompt"
	case StateInput:
		return "input"
	case StateRunning:
		return "running"
	case StateEnded:
		return "ended"
	}
	return "state(" + strconv.Itoa(int(s)) + ")"
}

// Record is what is known of one command. All offsets are positions in the session's output (the offsets of the
// replay and of the output frames).
//
// The marks that carry no nonce (every OSC 133 and OSC 7 there is) are believed for navigation only. What a
// program in the session could not have printed is what the nonce vouches for: the command line (Trust) and the
// directory when the shell sent it with the nonce (CwdTrust). The exit code is never vouched for.
type Record struct {
	// CommandID is "c1", "c2", ...: unique and monotonic in the session, and the same on every mark of a command.
	CommandID string
	State     State
	// Ran says that the command started: a prompt that ended with no start (Ctrl-C at an empty prompt) did not.
	Ran bool
	// CommandLine is the line as the shell sent it, with the nonce, unescaped, at most MaxCommandLine bytes. It is
	// data of the user's: it may hold control bytes, and it is never logged without a gate. Empty without the nonce.
	CommandLine string
	// Trust is the trust of CommandLine: TrustNonce when the line came with the nonce.
	Trust Trust
	// Cwd is the directory the command started in (the one the prompt was in, until it starts). A directory sent with
	// the nonce wins over any other; CwdTrust says which one this is.
	Cwd         string
	CwdTrust    Trust
	ExitCode    int32
	HasExitCode bool
	// StartedAt and EndedAt are on the producer's clock (Config.Now).
	StartedAt time.Time
	EndedAt   time.Time
	// PromptOffset is where the first mark of the command is.
	PromptOffset uint64
	// OutputStart is the offset after the start mark, OutputEnd the offset of the end mark, so that
	// [OutputStart, OutputEnd) is what the command printed. OutputEnd is meaningful when State is StateEnded and
	// Ran is true; both are 0 for a command that never ran.
	OutputStart uint64
	OutputEnd   uint64
}

// Format prints a record without its command line and directory, whatever the verb: those are the user's, and the
// reflection of fmt would print them.
func (r Record) Format(f fmt.State, _ rune) {
	_, _ = fmt.Fprintf(f, "marks.Record{id=%s state=%s ran=%t trust=%s exit=%s prompt=%d output=[%d,%d)}",
		r.CommandID, r.State, r.Ran, r.Trust, exitText(r.ExitCode, r.HasExitCode), r.PromptOffset, r.OutputStart, r.OutputEnd)
}

func exitText(code int32, has bool) string {
	if !has {
		return "none"
	}
	return strconv.FormatInt(int64(code), decimalBase)
}

const decimalBase = 10

// Log is the bounded record of the commands of one session: the newest MaxRecords, addressed by id or by offset.
// It is safe for use by many goroutines; the Scanner that fills it is not.
type Log struct {
	mu sync.Mutex
	// recs is a ring: oldest at head once it is full.
	recs []Record
	head int
	max  int
	seq  uint64
	// trusted is the last directory sent with the nonce, loose the last one that OSC 7 gave.
	trusted string
	loose   string
}

func newLog(maxRecords int) *Log {
	if maxRecords <= 0 {
		maxRecords = DefaultMaxRecords
	}
	l := new(Log)
	l.max = maxRecords
	return l
}

// Format prints the size of a log, whatever the verb: a log holds command lines.
func (l *Log) Format(f fmt.State, _ rune) {
	l.mu.Lock()
	n := len(l.recs)
	l.mu.Unlock()
	_, _ = fmt.Fprintf(f, "marks.Log{records=%d}", n)
}

// Records returns the commands kept, oldest first, as a copy.
func (l *Log) Records() []Record {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make([]Record, 0, len(l.recs))
	for i := range l.recs {
		out = append(out, l.recs[(l.head+i)%len(l.recs)])
	}
	return out
}

// Last returns the newest command.
func (l *Log) Last() (Record, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	r := l.newest()
	if r == nil {
		var none Record
		return none, false
	}
	return *r, true
}

// Running returns the command that has started and has not ended: what "a command is running" means.
func (l *Log) Running() (Record, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if r := l.newest(); r != nil && r.State == StateRunning {
		return *r, true
	}
	var none Record
	return none, false
}

// At returns the command that the byte at offset belongs to: the newest whose first mark is at or before it. An
// offset before the oldest command kept is in none.
func (l *Log) At(offset uint64) (Record, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for i := len(l.recs) - 1; i >= 0; i-- {
		if r := &l.recs[(l.head+i)%len(l.recs)]; r.PromptOffset <= offset {
			return *r, true
		}
	}
	var none Record
	return none, false
}

// Cwd returns the directory the shell is in, and how far it can be believed: the last one sent with the nonce, else
// the last one an OSC 7 gave (unverified: any program can print it).
func (l *Log) Cwd() (string, Trust) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.cwd()
}

func (l *Log) cwd() (string, Trust) {
	if l.trusted != "" {
		return l.trusted, TrustNonce
	}
	return l.loose, TrustUnverified
}

// newest is the last command opened, nil when there is none. The caller holds the lock.
func (l *Log) newest() *Record {
	if len(l.recs) == 0 {
		return nil
	}
	return &l.recs[(l.head+len(l.recs)-1)%len(l.recs)]
}

// open adds a command in the given state, dropping the oldest when the log is full. The caller holds the lock.
func (l *Log) open(at uint64, state State) *Record {
	l.seq++
	cwd, trust := l.cwd()
	r := Record{
		CommandID: "c" + strconv.FormatUint(l.seq, decimalBase), State: state, Ran: false, CommandLine: "", Trust: TrustUnverified,
		Cwd: cwd, CwdTrust: trust, ExitCode: 0, HasExitCode: false, StartedAt: time.Time{}, EndedAt: time.Time{},
		PromptOffset: at, OutputStart: 0, OutputEnd: 0,
	}
	if len(l.recs) < l.max {
		l.recs = append(l.recs, r)
		return &l.recs[len(l.recs)-1]
	}
	l.recs[l.head] = r
	slot := &l.recs[l.head]
	l.head = (l.head + 1) % len(l.recs)
	return slot
}

// isOpen says whether a command still takes marks: it has not ended.
func isOpen(r *Record) bool { return r != nil && r.State != StateEnded }

// prompt reads a prompt start (A). A prompt while the command is still at its prompt is the same prompt drawn
// again (a resize, a framework that prints its own mark as well); one while a command runs is not a prompt of a
// new command, and does not end it.
func (l *Log) prompt(at uint64) (string, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	r := l.newest()
	switch {
	case !isOpen(r):
		return l.open(at, StatePrompt).CommandID, false
	case r.State == StateRunning:
		return r.CommandID, false
	}
	return r.CommandID, true
}

// input reads an input start (B).
func (l *Log) input(at uint64) string {
	l.mu.Lock()
	defer l.mu.Unlock()
	r := l.newest()
	if !isOpen(r) {
		return l.open(at, StateInput).CommandID
	}
	if r.State == StatePrompt {
		r.State = StateInput
	}
	return r.CommandID
}

// start reads a command start (C): the offset of the mark, where its output begins, and the producer's time. It
// says whether this mark started the command; a second start of a running command is not one.
func (l *Log) start(at, outputStart uint64, now time.Time) (Record, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	r := l.newest()
	if !isOpen(r) {
		r = l.open(at, StatePrompt)
	}
	if r.State == StateRunning {
		return *r, false
	}
	r.State, r.Ran, r.StartedAt, r.OutputStart = StateRunning, true, now, outputStart
	r.Cwd, r.CwdTrust = l.cwd()
	return *r, true
}

// end reads a command end (D) and returns the id of the command and how long it ran, or no id when no command
// is open.
func (l *Log) end(at uint64, code int32, hasCode bool, now time.Time) (string, uint64) {
	l.mu.Lock()
	defer l.mu.Unlock()
	r := l.newest()
	if !isOpen(r) {
		return "", 0
	}
	r.State, r.ExitCode, r.HasExitCode, r.EndedAt = StateEnded, code, hasCode, now
	var durationMS uint64
	if r.Ran {
		r.OutputEnd = at
		durationMS = uint64(max(0, now.Sub(r.StartedAt).Milliseconds()))
	}
	return r.CommandID, durationMS
}

// setLine gives the command at its prompt the line the shell sent with the nonce. A line after the start is not
// the line of this command; one before it replaces an earlier one.
func (l *Log) setLine(line string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if r := l.newest(); isOpen(r) && r.State != StateRunning {
		r.CommandLine, r.Trust = line, TrustNonce
	}
}

// noteCwd keeps a directory and returns it as a string, the one it already holds when it is the same (a prompt
// prints its directory every time, and a read of the stream must not allocate for it).
func (l *Log) noteCwd(dir []byte, trusted bool) string {
	l.mu.Lock()
	defer l.mu.Unlock()
	slot := &l.loose
	if trusted {
		slot = &l.trusted
	}
	if string(dir) != *slot {
		*slot = string(dir)
	}
	return *slot
}
