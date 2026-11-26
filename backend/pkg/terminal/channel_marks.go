//go:build !windows

package terminal

import (
	"encoding/json"

	"github.com/omniviewdev/omniview/backend/pkg/terminal/marks"
)

// THE MARKS OF A TERMINAL (issue #694 step 4; docs/ui-next/terminal-channel-protocol.md section 4a).
//
// The scanner of package marks reads the shell's integration marks out of the output, in the one step that appends the output to the replay ring
// (so a mark's offsets are the offsets of the output frames), and the ring keeps the marks it read in a bounded list beside the bytes. A stream
// whose page asked for them (attach `marks` 1) is sent each mark in a frame of its own type, after the bytes of its sequence and cut so that
// the page stands exactly where the sequence ends, and a stream that attaches again, from the start or from an offset, is sent the marks it
// has not seen from the same list: a replay gives the same marks at the same offsets.
//
// What is believed. A terminal whose shell has no integration has no nonce, no scanner and no marks, whatever a program prints. For one that has,
// every mark of the prompt and the command (OSC 133) is sent with trust `unverified`: any program can print it, so it serves a gutter and a jump
// and nothing else; the command line and the directory are sent only when the shell proved them with the session's nonce, and a directory that
// anything could have printed (OSC 7) is dropped here, so that the page never has it to believe. A command is RUNNING for the host only when the
// start mark came with a command line that the nonce vouches for.

const (
	// marksFrameVersion is the version of the marks frame: the value of the attach's `marks` and of the ready frame's.
	marksFrameVersion = 1
)

// markJSON is one mark of the frame, as the page reads it. Command and Cwd are the user's data: they are here only with trust `nonce`.
type markJSON struct {
	Kind       string  `json:"kind"`
	At         uint64  `json:"at"`
	End        uint64  `json:"end"`
	ID         string  `json:"id,omitempty"`
	Trust      string  `json:"trust"`
	Command    string  `json:"command,omitempty"`
	Cwd        string  `json:"cwd,omitempty"`
	Exit       *int32  `json:"exit,omitempty"`
	DurationMs *uint64 `json:"duration_ms,omitempty"`
	TimeMs     int64   `json:"time_ms,omitempty"`
	Redraw     bool    `json:"redraw,omitempty"`
}

type marksBody struct {
	V     int        `json:"v"`
	Marks []markJSON `json:"marks"`
}

// marksFrame is the frame that carries ms, which are in the order of the output.
func marksFrame(ms []marks.Mark) []byte {
	body := marksBody{V: marksFrameVersion, Marks: make([]markJSON, 0, len(ms))}
	for i := range ms {
		m := &ms[i]
		out := markJSON{
			Kind: m.Kind.String(), At: m.AtOffset, End: m.EndOffset, ID: m.CommandID, Trust: m.Trust.String(),
			Command: m.CommandLine, Cwd: m.Cwd, Exit: nil, DurationMs: nil, TimeMs: 0, Redraw: m.Redraw,
		}
		if !m.Time.IsZero() {
			out.TimeMs = m.Time.UnixMilli()
		}
		if m.Kind == marks.KindCommandEnd {
			if m.HasExitCode {
				code := m.ExitCode
				out.Exit = &code
			}
			if m.CommandID != "" {
				duration := m.DurationMS
				out.DurationMs = &duration
			}
		}
		body.Marks = append(body.Marks, out)
	}
	raw, err := json.Marshal(body)
	if err != nil {
		// A struct of strings and numbers has no error to give.
		return []byte{frameMarks}
	}
	return append([]byte{frameMarks}, raw...)
}

// ---- what the terminal knows of its commands ----

// verifiedRunning is the command that the shell said it started and has not ended, with the nonce's proof of its line: what "a command is running"
// means. A start mark that anything could have printed does not make a terminal busy.
func (s *session) verifiedRunning() (marks.Record, bool) {
	var none marks.Record
	if s.ring.marks == nil {
		return none, false
	}
	return s.ring.marks.running()
}

// withMarks is what holds the terminal, given what the shell said about its commands: a command that runs makes the terminal busy even when the
// shell holds the foreground (a builtin loop, a command that was stopped and resumed under it) and when the system would not say. A program that
// holds the foreground is busy, as it was.
func (s *session) withMarks(fg Foreground) Foreground {
	if fg.State == StateBusy {
		return fg
	}
	if _, running := s.verifiedRunning(); !running {
		return fg
	}
	// Marks add busy and nothing else: the name and the process group are the pull fact's, which knows none here. The first word of a line can be an
	// assignment (`FOO=1 make`), so it is not made a name.
	return Foreground{State: StateBusy, Name: "", PGID: 0, Reason: ""}
}

// commands is the record of the terminal, read in one step with the output's length.
func (s *session) commands() Commands {
	out := Commands{Integration: s.info.Integration.State, Running: "", Cwd: "", CwdTrust: "", End: 0, Commands: []Command{}}
	s.outMu.Lock()
	defer s.outMu.Unlock()
	out.End = s.ring.end
	return s.ring.commandsInto(out)
}

// commandsInto adds the ring's record to out. The caller holds the output lock, which orders the scanner's writes.
func (r *replayRing) commandsInto(out Commands) Commands {
	if r.marks == nil {
		return out
	}
	log := r.marks.log()
	if rec, ok := r.marks.running(); ok {
		out.Running = rec.CommandID
	}
	if dir, trust := log.Cwd(); trust == marks.TrustNonce {
		out.Cwd, out.CwdTrust = dir, trust.String()
	}
	for _, rec := range log.Records() {
		out.Commands = append(out.Commands, commandOf(rec))
	}
	return out
}

func commandOf(rec marks.Record) Command {
	c := Command{
		ID: rec.CommandID, State: rec.State.String(), Ran: rec.Ran, CommandLine: rec.CommandLine, CommandTrust: rec.Trust.String(),
		Cwd: "", CwdTrust: marks.TrustUnverified.String(), ExitCode: nil, StartedUnixMs: 0, EndedUnixMs: 0,
		PromptOffset: rec.PromptOffset, OutputStart: rec.OutputStart, OutputEnd: rec.OutputEnd,
	}
	if rec.CwdTrust == marks.TrustNonce {
		c.Cwd, c.CwdTrust = rec.Cwd, rec.CwdTrust.String()
	}
	if rec.State == marks.StateEnded && rec.HasExitCode {
		code := rec.ExitCode
		c.ExitCode = &code
	}
	if !rec.StartedAt.IsZero() {
		c.StartedUnixMs = rec.StartedAt.UnixMilli()
	}
	if !rec.EndedAt.IsZero() {
		c.EndedUnixMs = rec.EndedAt.UnixMilli()
	}
	return c
}

// ChannelCommands reads the record of a channel terminal: the commands the shell's integration told of, with their offsets.
func (m *Manager) ChannelCommands(presented string) (Commands, error) {
	s, err := m.liveByCapability(presented)
	if err != nil {
		return Commands{}, err
	}
	out := s.commands()
	if s.ending.Load() {
		return Commands{}, ChannelNotFound()
	}
	return out, nil
}
