// Package marks reads the shell-integration marks (OSC 133, OSC 633 and OSC 7) out of a terminal's output, which
// it never changes, and keeps a bounded record of the commands they describe.
package marks

import "time"

// Kind says what a Mark marks.
type Kind uint8

// The kinds of a Mark (the SDK's MarkKind, without the unspecified zero).
const (
	KindUnspecified Kind = iota
	KindPromptStart
	KindInputStart
	KindCommandStart
	KindCommandEnd
	KindCwd
)

// Trust says how far a Mark can be believed.
type Trust uint8

// The trust levels of a Mark (the SDK's MarkTrust).
const (
	TrustUnverified Trust = iota
	TrustNonce
)

// Mark is one mark read from the output.
type Mark struct {
	Kind        Kind
	AtOffset    uint64
	ExitCode    int32
	HasExitCode bool
	Cwd         string
	CommandID   string
	CommandLine string
	Trust       Trust
	DurationMS  uint64
	Redraw      bool
}

// State is how far a command has come.
type State uint8

// The states of a command's record.
const (
	StatePrompt State = iota
	StateInput
	StateRunning
	StateEnded
)

// Record is what is known of one command.
type Record struct {
	CommandID    string
	State        State
	Ran          bool
	CommandLine  string
	Trust        Trust
	Cwd          string
	CwdTrust     Trust
	ExitCode     int32
	HasExitCode  bool
	StartedAt    time.Time
	EndedAt      time.Time
	PromptOffset uint64
	OutputStart  uint64
	OutputEnd    uint64
}

// Stats counts what the scanner saw.
type Stats struct {
	Bytes     uint64
	Marks     uint64
	Forged    uint64
	Oversize  uint64
	Malformed uint64
}

// Config makes a Scanner.
type Config struct {
	Nonce       Nonce
	Now         func() time.Time
	MaxRecords  int
	StartOffset uint64
}

// Scanner reads output.
type Scanner struct {
	log *Log
}

// New makes a Scanner.
func New(cfg Config) *Scanner {
	_ = cfg
	return &Scanner{log: &Log{}}
}

// Feed reads p and appends the marks in it to out.
func (s *Scanner) Feed(p []byte, out []Mark) []Mark {
	_ = p
	return out
}

// Offset is how many bytes were fed, plus the start offset.
func (s *Scanner) Offset() uint64 { return 0 }

// Stats says what the scanner saw.
func (s *Scanner) Stats() Stats { return Stats{} }

// Log is the record of the commands.
func (s *Scanner) Log() *Log { return s.log }
