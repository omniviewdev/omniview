// Package marks reads the shell-integration marks of a terminal's output: OSC 133 (prompt start, input start,
// command start, command end), OSC 633 of VS Code (the command line and the directory, with a nonce) and OSC 7
// (the directory). It never changes a byte of the output. It tolerates a sequence cut across reads, bounds every
// buffer, and keeps a bounded Log of the commands the marks describe.
//
// # Trust
//
// Any program that prints to the terminal can print these sequences, so a mark is believed as far as it can be
// proven. The session has a secret (Nonce) that the host gives to its shell integration script alone. A mark that
// carries it (the command line of 633;E and the directory of 633;P;Cwd) is TrustNonce. Everything else, which is
// every OSC 133 and OSC 7 and also what prompt frameworks print on their own, is TrustUnverified: good for a
// gutter and for jumping between commands, never for a command line or for the directory of a new terminal. A
// mark with a wrong or missing nonce gives no command line and no directory at all.
//
// The package is a leaf with the shape of the SDK's planned pkg/v1/exec/scan (Mark, MarkKind as Kind, MarkTrust as
// Trust, the nonce that prints as a secret): when the SDK ships it this package becomes an import. The terminal
// modes tracker (TerminalModes) stays in package terminal until then.
//
// # Offsets
//
// Every offset is a position in the session's output, which is how the replay and the output frames are
// addressed. A Mark's AtOffset is the offset of the ESC that begins its sequence; a Record's OutputStart is the
// offset after the sequence of the command start, so the output of a command is [OutputStart, OutputEnd).
package marks

import (
	"fmt"
	"log/slog"
	"strconv"
	"time"
)

// Kind says what a Mark marks (the SDK's MarkKind).
type Kind uint8

// The kinds of a Mark.
const (
	KindUnspecified Kind = iota
	// KindPromptStart is OSC 133 A, KindInputStart is B, KindCommandStart is C, KindCommandEnd is D.
	KindPromptStart
	KindInputStart
	KindCommandStart
	KindCommandEnd
	// KindCwd is a directory: OSC 7 or 633;P;Cwd.
	KindCwd
)

func (k Kind) String() string {
	switch k {
	case KindUnspecified:
		return "unspecified"
	case KindPromptStart:
		return "prompt-start"
	case KindInputStart:
		return "input-start"
	case KindCommandStart:
		return "command-start"
	case KindCommandEnd:
		return "command-end"
	case KindCwd:
		return "cwd"
	}
	return "kind(" + strconv.Itoa(int(k)) + ")"
}

// Trust says how far a Mark can be believed (the SDK's MarkTrust). The zero value is the safe one.
type Trust uint8

// The trust levels of a Mark.
const (
	// TrustUnverified is a mark that anything could have printed.
	TrustUnverified Trust = iota
	// TrustNonce is a mark that carried the session's nonce.
	TrustNonce
)

func (t Trust) String() string {
	if t == TrustNonce {
		return "nonce"
	}
	return "unverified"
}

// Mark is one mark read from the output (the SDK's Mark).
type Mark struct {
	Kind Kind
	// AtOffset is the offset of the first byte of the sequence, EndOffset the offset after its last byte: the mark is
	// read when the output has been read up to EndOffset, and no byte of the sequence is addressed above it.
	AtOffset  uint64
	EndOffset uint64
	// ExitCode is the status of a command end; HasExitCode is false when the shell sent none (pwsh does not).
	ExitCode    int32
	HasExitCode bool
	// Cwd is the directory of a KindCwd mark.
	Cwd string
	// CommandID is "c1", "c2", ...: the same on the marks of one command. Empty for an end that closes no command.
	CommandID string
	// CommandLine is on the command start, only with TrustNonce: unescaped, at most MaxCommandLine bytes. It is
	// the user's data and may hold control bytes.
	CommandLine string
	Trust       Trust
	// DurationMS is on a command end: from the command start to the end, on the producer's clock.
	DurationMS uint64
	// Redraw is a prompt that is the same prompt drawn again, not a new one.
	Redraw bool
	// Time is the producer's clock (Config.Now) when a command started or ended: zero on every other mark.
	Time time.Time
}

// newMark makes a mark with every field set.
func newMark(kind Kind, at uint64) Mark {
	return Mark{
		Kind: kind, AtOffset: at, EndOffset: at, ExitCode: 0, HasExitCode: false, Cwd: "", CommandID: "", CommandLine: "",
		Trust: TrustUnverified, DurationMS: 0, Redraw: false, Time: time.Time{},
	}
}

// Format prints a mark without its command line and directory, whatever the verb: fmt would print them from the
// fields, and they are the user's.
func (m Mark) Format(f fmt.State, _ rune) {
	_, _ = fmt.Fprintf(f, "marks.Mark{kind=%s at=%d id=%s trust=%s exit=%s duration=%dms redraw=%t}",
		m.Kind, m.AtOffset, m.CommandID, m.Trust, exitText(m.ExitCode, m.HasExitCode), m.DurationMS, m.Redraw)
}

// LogValue is what a logger records of a mark: no command line and no directory.
func (m Mark) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("kind", m.Kind.String()), slog.Uint64("at", m.AtOffset), slog.String("id", m.CommandID),
		slog.String("trust", m.Trust.String()), slog.Uint64("duration_ms", m.DurationMS), slog.Bool("redraw", m.Redraw),
	)
}

// LogValue is what a logger records of a record: no command line and no directory.
func (r Record) LogValue() slog.Value {
	return slog.GroupValue(
		slog.String("id", r.CommandID), slog.String("state", r.State.String()), slog.Bool("ran", r.Ran),
		slog.String("trust", r.Trust.String()), slog.Uint64("prompt", r.PromptOffset),
		slog.Uint64("output_start", r.OutputStart), slog.Uint64("output_end", r.OutputEnd),
	)
}

// Stats counts what a Scanner saw. Every field only grows.
type Stats struct {
	// Bytes is how many bytes were fed, Marks how many marks came out.
	Bytes uint64
	Marks uint64
	// Forged counts marks that should have carried the nonce and did not carry the right one.
	Forged uint64
	// Oversize counts sequences and fields over their limit, which were dropped.
	Oversize uint64
	// Malformed counts marks that could not be read (an OSC 7 that is no file URL).
	Malformed uint64
}
