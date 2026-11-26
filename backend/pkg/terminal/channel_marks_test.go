//go:build !windows

package terminal

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// THE MARKS ON THE STREAM (issue #694 step 4; docs/ui-next/terminal-channel-protocol.md section 4a).
//
// The shell of these tests is a script named zsh that the host gives its integration to (it reads the nonce and says "ready" on the
// channel, as the real scripts do) and then prints, byte for byte, the file whose name it is typed: so the output, its offsets and every
// mark in it are known to the test, and the nonce is the session's own, read from the session. What a real zsh and bash do with the
// same marks is the seam's (a later step).

// marksShellScript prints the file it is typed the name of. No echo and no output processing: the bytes of the file are the bytes of the output.
const marksShellScript = `#!/bin/sh
read nonce <&3
read original <&3
stty -echo -opost
echo ready >&3
while read -r name; do
  [ "$name" = quit ] && exit 0
  cat "$MARKS_DIR/$name"
done
`

// osc is an OSC sequence that ends at BEL.
func osc(body string) string { return "\x1b]" + body + "\a" }

// marked is a channel terminal on the shell above, and everything it has printed.
type marked struct {
	t     *testing.T
	f     *integrationFixture
	dir   string
	info  Session
	nonce string
	// out is everything the shell printed, which is the terminal's output from offset zero.
	out []byte
	n   int
}

func newMarked(t *testing.T, env ...string) *marked { return newMarkedWith(t, nil, env...) }

// newMarkedWith is newMarked with prep run on the manager before the terminal starts (its limits, its clock).
func newMarkedWith(t *testing.T, prep func(*Manager), env ...string) *marked {
	t.Helper()
	dir := t.TempDir()
	shell := filepath.Join(dir, "zsh")
	require.NoError(t, os.WriteFile(shell, []byte(marksShellScript), 0o700))
	f := newIntegrationFixture(t, "zsh", shell, append([]string{"MARKS_DIR=" + dir}, env...)...)
	if prep != nil {
		prep(f.m)
	}
	info, err := f.m.Start(Options{Command: []string{shell}, Cwd: f.home, Cols: 100, Rows: 30, Channel: true}, nil)
	require.NoError(t, err)
	require.Equal(t, IntegrationOn, info.Integration.State, "the host gave the fake shell its integration")
	k := &marked{t: t, f: f, dir: dir, info: info, nonce: "", out: nil, n: 0}
	k.nonce = f.m.chanOf(t, info).nonce.Reveal()
	require.NotEmpty(t, k.nonce)
	return k
}

// print makes the shell print text, and waits until it is in the terminal's output.
func (k *marked) print(text string) {
	k.t.Helper()
	k.n++
	name := fmt.Sprintf("part%d", k.n)
	require.NoError(k.t, os.WriteFile(filepath.Join(k.dir, name), []byte(text), 0o600))
	s := k.f.m.chanOf(k.t, k.info)
	// A channel terminal has no id binding: the test types on the pty as the stream's worker does.
	_, err := s.master.Write([]byte(name + "\n"))
	require.NoError(k.t, err)
	k.out = append(k.out, text...)
	require.Eventually(k.t, func() bool { return s.next() >= uint64(len(k.out)) }, settle, time.Millisecond, "the shell printed %s", name)
}

func (k *marked) attach(from *uint64) *chanPage {
	k.t.Helper()
	return k.f.m.attachMarks(k.t, k.info.Cap, from)
}

// command is the marks of one command that a script with the nonce prints: the prompt, the input, the line with the nonce, the start, the
// output, the end and the directory.
func (k *marked) command(line, output string, exit int, cwd string) string {
	return osc("133;A") + "$ " + osc("133;B") + line + "\r\n" +
		osc("633;E;"+line+";"+k.nonce) + osc("133;C") + output + "\r\n" +
		osc(fmt.Sprintf("133;D;%d", exit)) + osc("633;P;Cwd="+cwd+";"+k.nonce)
}

// marksOf waits until the page has taken n marks and the output up to the last of them.
func marksOf(t *testing.T, p *chanPage, n int) []markWire {
	t.Helper()
	st := p.waitFor(fmt.Sprintf("%d marks", n), func(s pageState) bool { return len(s.marks) >= n })
	require.Empty(t, st.faults, "the stream is as the protocol says")
	return st.marks
}

// sequences is what the marks address in the output: the bytes of each sequence.
func sequences(out []byte, ms []markWire) []string {
	got := make([]string, 0, len(ms))
	for _, m := range ms {
		if m.End > uint64(len(out)) || m.At >= m.End {
			got = append(got, fmt.Sprintf("<[%d,%d) outside the %d bytes of output>", m.At, m.End, len(out)))
			continue
		}
		got = append(got, string(out[m.At:m.End]))
	}
	return got
}

func kindsOf(ms []markWire) []string {
	got := make([]string, 0, len(ms))
	for _, m := range ms {
		got = append(got, m.Kind)
	}
	return got
}

// The marks come after their bytes, each at its own offset: the output is cut where a mark's sequence ends, so that the page's emulator is
// exactly there when the mark is handed to it, and every mark addresses its sequence by the offsets it states.
func TestMarksArriveInOrderWithTheOutputAndEachAddressesItsOwnSequence(t *testing.T) {
	k := newMarked(t)
	page := k.attach(nil)
	ready := page.waitReady()
	guarded(t, "ready-says-marks", func() {
		assert.Equal(t, 1, ready.Marks, "the page asked for the frame of version 1 and the terminal has an integration: the ready frame says marks are coming")
	})
	k.print(k.command("ls", "a  b", 0, "/home/me"))
	k.print(k.command("false", "", 1, "/home/me/src"))
	want := []string{"prompt-start", "input-start", "command-start", "command-end", "cwd", "prompt-start", "input-start", "command-start", "command-end", "cwd"}
	got := marksOf(t, page, len(want))
	st := page.waitBytes(len(k.out))

	guarded(t, "marks-kinds-in-order", func() {
		assert.Equal(t, want, kindsOf(got))
	})
	guarded(t, "marks-address-their-sequence", func() {
		assert.Equal(t, []string{
			osc("133;A"), osc("133;B"), osc("133;C"), osc("133;D;0"), osc("633;P;Cwd=/home/me;" + k.nonce),
			osc("133;A"), osc("133;B"), osc("133;C"), osc("133;D;1"), osc("633;P;Cwd=/home/me/src;" + k.nonce),
		}, sequences(st.bytes(), got), "each mark's [at, end) holds exactly its sequence in the output the page took")
	})
	guarded(t, "marks-at-their-offset", func() {
		for i, m := range got {
			assert.Equal(t, m.End, m.seenAt, "mark %d (%s) came when the page stood where its sequence ends: the output is cut there", i, m.Kind)
		}
	})
	guarded(t, "marks-content", func() {
		assert.Equal(t, "ls", got[2].Command)
		assert.Equal(t, "nonce", got[2].Trust, "the command line came with the nonce")
		assert.Equal(t, "c1", got[2].ID)
		require.NotNil(t, got[3].Exit)
		assert.EqualValues(t, 0, *got[3].Exit)
		require.NotNil(t, got[8].Exit)
		assert.EqualValues(t, 1, *got[8].Exit)
		assert.Equal(t, "c2", got[8].ID)
		assert.Equal(t, "/home/me/src", got[9].Cwd)
		assert.Equal(t, "nonce", got[9].Trust)
		assert.Positive(t, got[2].TimeMs, "the producer's time of the start")
		assert.Positive(t, got[3].TimeMs, "and of the end")
		assert.GreaterOrEqual(t, got[3].TimeMs, got[2].TimeMs)
		require.NotNil(t, got[3].DurationMs)
		assert.Equal(t, "unverified", got[0].Trust, "a prompt mark carries no nonce: navigation only")
	})
}

// A page that attaches again, now or after a reload, is given the same marks at the same offsets: the replay is the output from the
// start of what the host kept and the marks of it, and a page that comes back by its offset is given the marks it has not seen, none twice
// (but the one that ends at its offset, which the stream may have cut: the page knows it by its end).
func TestAReplayGivesTheSameMarksAtTheSameOffsets(t *testing.T) {
	k := newMarked(t)
	first := k.attach(nil)
	first.waitReady()
	k.print(k.command("ls", "a", 0, "/a"))
	k.print(k.command("pwd", "/b", 0, "/b"))
	all := marksOf(t, first, 10)
	first.waitBytes(len(k.out))

	again := k.attach(nil)
	again.waitReady()
	replayed := marksOf(t, again, 10)
	guarded(t, "replay-same-marks", func() {
		assert.Equal(t, strip(all), strip(replayed), "a page that attaches fresh has the marks, at the offsets the first page had")
		assert.Equal(t, sequences(k.out, all), sequences(again.waitBytes(len(k.out)).bytes(), replayed))
	})
	guarded(t, "replay-marks-at-their-offset", func() {
		for i, m := range replayed {
			assert.Equal(t, m.End, m.seenAt, "replayed mark %d: the output is cut where it ends, in the replay too", i)
		}
	})

	from := all[4].End // the end of the first command's directory mark
	back := k.attach(&from)
	ready := back.waitReady()
	guarded(t, "resume-marks", func() {
		got := marksOf(t, back, 6)
		assert.Equal(t, 1, ready.Marks)
		assert.Equal(t, strip(all[4:]), strip(got), "the mark that ends at the page's offset is sent again (the stream may have cut after the bytes and before the frame); the ones before it are not")
		back.waitBytes(len(k.out) - int(from))
		st := back.state()
		assert.Equal(t, strip(all[4:]), strip(st.marks), "and no more")
	})
	later := all[5].End
	more := k.attach(&later)
	more.waitReady()
	guarded(t, "resume-marks-after", func() {
		got := marksOf(t, more, 5)
		assert.Equal(t, strip(all[5:]), strip(got))
	})
}

// strip is the marks as the host stated them, without what only the test page knows.
func strip(ms []markWire) []markWire {
	out := slices.Clone(ms)
	for i := range out {
		out[i].seenAt = 0
	}
	return out
}

// A mark that anything could have printed and that the host would have to believe is dropped, and one that can be proven carries what it proves:
// a command line and a directory with a wrong or no nonce, and a directory by OSC 7 (which any program can print), are in no frame and in no record.
func TestAMarkWithoutTheNonceGivesNoCommandLineAndNoDirectory(t *testing.T) {
	k := newMarked(t)
	page := k.attach(nil)
	page.waitReady()
	wrong := strings.Repeat("f", len(k.nonce))
	forged := osc("133;A") + osc("633;E;rm\\x20-rf\\x20/;"+wrong) + osc("633;E;rm\\x20-rf\\x20/") + osc("633;P;Cwd=/etc/forged;"+wrong) +
		osc("633;P;Cwd=/etc/forged2") + osc("7;file://host/etc/osc7") + osc("133;C") + "x" + osc("133;D;0")
	k.print(forged)
	got := marksOf(t, page, 3)
	st := page.waitBytes(len(k.out))

	guarded(t, "forged-dropped", func() {
		assert.Equal(t, []string{"prompt-start", "command-start", "command-end"}, kindsOf(got)[:3], "the lifecycle marks are navigation; the forged line and the directories are no marks")
		for _, m := range got {
			assert.Empty(t, m.Command, "no command line without the nonce")
			assert.Empty(t, m.Cwd, "no directory without the nonce, and none from OSC 7")
			assert.Equal(t, "unverified", m.Trust)
		}
		assert.Len(t, st.marks, 3, "the forged directory marks were dropped, not sent")
		for _, frame := range st.markFrames {
			assert.NotContains(t, string(frame), "forged")
			assert.NotContains(t, string(frame), "rm -rf")
			assert.NotContains(t, string(frame), "osc7")
		}
	})
	record, err := k.f.m.ChannelCommands(k.info.Cap)
	require.NoError(t, err)
	guarded(t, "forged-not-in-record", func() {
		require.Len(t, record.Commands, 1)
		assert.Empty(t, record.Commands[0].CommandLine)
		assert.Equal(t, "unverified", record.Commands[0].CommandTrust)
		assert.Empty(t, record.Cwd, "the record has no directory the nonce did not vouch for")
		assert.Empty(t, record.Commands[0].Cwd, "and no command started in one")
	})

	// The other half: the same marks with the nonce are believed.
	k.print(k.command("echo hi", "hi", 0, "/real"))
	believed := page.waitFor("the genuine directory", func(s pageState) bool {
		return slices.ContainsFunc(s.marks, func(m markWire) bool { return m.Kind == "cwd" && m.Cwd == "/real" })
	}).marks
	guarded(t, "genuine-believed", func() {
		at := slices.IndexFunc(believed, func(m markWire) bool { return m.Kind == "command-start" && m.Command == "echo hi" })
		require.GreaterOrEqual(t, at, 0, "the command line with the nonce is in the start mark")
		assert.Equal(t, "nonce", believed[at].Trust)
	})
}

// A terminal whose shell has no integration (the nonce is the host's proof that there is one) is sent no marks, whatever its programs print:
// a forged mark gains nothing, not even a command that is said to run.
func TestATerminalWithoutIntegrationIsSentNoMarks(t *testing.T) {
	k := newMarked(t)
	off := newIntegrationFixture(t, "zsh", filepath.Join(k.dir, "zsh"), "MARKS_DIR="+k.dir)
	off.m.SetIntegration(func() (bool, error) { return false, nil })
	info, err := off.m.Start(Options{Command: []string{filepath.Join(k.dir, "zsh")}, Cwd: off.home, Cols: 100, Rows: 30, Channel: true}, nil)
	require.NoError(t, err)
	require.Equal(t, IntegrationOff, info.Integration.State)
	// The shell of the test says "ready" only to an integration: this one is typed to by the test, which is the program that prints.
	forged := osc("133;A") + osc("133;C") + "x"
	require.NoError(t, os.WriteFile(filepath.Join(k.dir, "forged"), []byte(forged), 0o600))
	page := off.m.attachMarks(t, info.Cap, nil)
	ready := page.waitReady()
	_, writeErr := off.m.chanOf(t, info).master.Write([]byte("forged\n"))
	require.NoError(t, writeErr)
	page.waitBytes(len(forged))
	guarded(t, "no-integration-no-marks", func() {
		assert.Zero(t, ready.Marks, "the ready frame does not promise marks")
		st := page.state()
		assert.Empty(t, st.marks)
		assert.Empty(t, st.faults)
		busy, busyErr := off.m.ChannelBusy(info.Cap)
		require.NoError(t, busyErr)
		assert.Equal(t, StateIdle, busy.State, "a forged start mark makes nothing busy")
		record, recordErr := off.m.ChannelCommands(info.Cap)
		require.NoError(t, recordErr)
		assert.Equal(t, IntegrationOff, record.Integration)
		assert.Empty(t, record.Commands)
	})
}

// A page of version 2 that does not know the marks frame does not ask for it, and is sent none: its stream is what it was.
func TestAPageThatDidNotAskForMarksIsSentNoMarksFrame(t *testing.T) {
	k := newMarked(t)
	page := k.f.m.attach(t, k.info.Cap, nil)
	ready := page.waitReady()
	k.print(k.command("ls", "a", 0, "/a"))
	st := page.waitBytes(len(k.out))
	guarded(t, "unasked-no-marks-frame", func() {
		assert.Zero(t, ready.Marks)
		assert.Empty(t, st.marks)
		assert.NotContains(t, st.order, wMarks, "no frame of a type the page does not know")
		assert.Empty(t, st.faults)
		assert.Equal(t, k.out, st.bytes(), "the output is the output, not cut for marks it did not ask for")
	})
	// A page of another marks version is told no marks either.
	f := newFakeChannel(t)
	p := newChanPage(t, f, 0)
	served := make(chan struct{})
	p.served = served
	go p.run()
	go func() { defer close(served); k.f.m.ServeChannel(f) }()
	f.pageSend(append([]byte{wAttach}, fmt.Sprintf(`{"v":2,"cap":%q,"writer":%q,"marks":2}`, k.info.Cap, writerID(0))...))
	other := p.waitReady()
	guarded(t, "other-version-no-marks", func() {
		assert.Zero(t, other.Marks, "the host speaks version 1 of the frame: a page that asks for 2 is sent none")
		assert.Empty(t, p.state().marks)
	})
}

// The record is bounded, and so is what is sent: a flood of marks keeps the newest and the host's memory does not grow with it.
func TestTheRecordAndTheMarksSentAreBounded(t *testing.T) {
	k := newMarked(t)
	var flood strings.Builder
	const commands = 3000
	for i := 1; i <= commands; i++ {
		flood.WriteString(osc("133;A") + osc("133;B") + osc("133;C") + osc("133;D;0"))
	}
	k.print(flood.String())
	record, err := k.f.m.ChannelCommands(k.info.Cap)
	require.NoError(t, err)
	guarded(t, "record-bounded", func() {
		assert.LessOrEqual(t, len(record.Commands), 512, "the record keeps the newest 512 commands")
		require.NotEmpty(t, record.Commands)
		assert.Equal(t, fmt.Sprintf("c%d", commands), record.Commands[len(record.Commands)-1].ID, "and they are the newest")
	})
	page := k.attach(nil)
	page.waitReady()
	// The last mark comes after the last bytes: the page has all of it when the last mark has come.
	st := page.waitFor("the last mark", func(s pageState) bool {
		n := len(s.marks)
		return n > 0 && s.marks[n-1].End == uint64(len(k.out))
	})
	guarded(t, "marks-bounded", func() {
		assert.GreaterOrEqual(t, len(st.marks), 1024, "the newest 1,024 marks are kept")
		assert.LessOrEqual(t, len(st.marks), 2048, "and no more than twice that is held, whatever the flood")
		assert.Empty(t, st.faults)
		last := st.marks[len(st.marks)-1]
		assert.Equal(t, uint64(len(k.out)), last.End, "the last mark is the last of the output")
		assert.Equal(t, "command-end", last.Kind)
	})
}

// A command is running from its start mark to its end mark, on the host's say: the shell says so, and the host does not infer it from the process
// that holds the foreground (which is the shell itself while a builtin loops and after a command is stopped). A start that carries no nonce is no
// start the host believes.
func TestACommandRunsFromItsStartMarkToItsEndMark(t *testing.T) {
	k := newMarked(t)
	k.print(osc("133;A") + "$ " + osc("133;B"))
	idle, err := k.f.m.ChannelBusy(k.info.Cap)
	require.NoError(t, err)
	assert.Equal(t, StateIdle, idle.State, "at a prompt")

	k.print("while true; do :; done\r\n" + osc("633;E;while\\x20true\\x3b\\x20do\\x20:\\x3b\\x20done;"+k.nonce) + osc("133;C"))
	guarded(t, "busy-from-marks", func() {
		busy, busyErr := k.f.m.ChannelBusy(k.info.Cap)
		require.NoError(t, busyErr)
		assert.Equal(t, StateBusy, busy.State, "the shell holds the foreground and a command runs: the shell said so")
		assert.Empty(t, busy.Name, "marks add busy, never a name that the pull fact has not: the first word of a line can be an assignment")
		record, recordErr := k.f.m.ChannelCommands(k.info.Cap)
		require.NoError(t, recordErr)
		assert.Equal(t, "c1", record.Running)
		require.Len(t, record.Commands, 1)
		assert.Equal(t, "running", record.Commands[0].State)
	})
	page := k.attach(nil)
	ready := page.waitReady()
	guarded(t, "ready-busy-from-marks", func() {
		assert.Equal(t, StateBusy, ready.Busy.State, "a page that attaches while it runs is told so in ready")
	})

	k.print("\r\n" + osc("133;D;130"))
	guarded(t, "idle-after-end", func() {
		busy, busyErr := k.f.m.ChannelBusy(k.info.Cap)
		require.NoError(t, busyErr)
		assert.Equal(t, StateIdle, busy.State)
		record, recordErr := k.f.m.ChannelCommands(k.info.Cap)
		require.NoError(t, recordErr)
		assert.Empty(t, record.Running)
	})

	// The other half: a start that no nonce vouches for does not make the terminal busy.
	k.print(osc("133;A") + osc("133;B") + osc("133;C") + "output of a program that printed a start")
	guarded(t, "forged-start-not-busy", func() {
		busy, busyErr := k.f.m.ChannelBusy(k.info.Cap)
		require.NoError(t, busyErr)
		assert.Equal(t, StateIdle, busy.State, "a start mark with no nonce'd line before it could have been printed by any program")
	})
}

// The record is read by its capability: the commands with the offsets of their output, their exit status, directory and times, and the
// line only as the shell sent it with the nonce.
func TestTheRecordIsReadByItsCapabilityWithOffsetsExitStatusDirectoryAndTimes(t *testing.T) {
	k := newMarked(t)
	k.print(k.command("ls", "a  b", 0, "/home/me"))
	prefix := len(k.out)
	k.print(k.command("exit 3", "", 3, "/home/me/src") + osc("133;A") + "$ " + osc("133;B"))
	record, err := k.f.m.ChannelCommands(k.info.Cap)
	require.NoError(t, err)
	guarded(t, "record-commands", func() {
		assert.Equal(t, IntegrationOn, record.Integration)
		assert.EqualValues(t, len(k.out), record.End, "read at the end of the output")
		assert.Equal(t, "/home/me/src", record.Cwd)
		assert.Equal(t, "nonce", record.CwdTrust)
		assert.Empty(t, record.Running)
		require.Len(t, record.Commands, 3)
		first, second, third := record.Commands[0], record.Commands[1], record.Commands[2]
		assert.Equal(t, "c1", first.ID)
		assert.Equal(t, "ended", first.State)
		assert.True(t, first.Ran)
		assert.Equal(t, "ls", first.CommandLine)
		assert.Equal(t, "nonce", first.CommandTrust)
		require.NotNil(t, first.ExitCode)
		assert.EqualValues(t, 0, *first.ExitCode)
		assert.Positive(t, first.StartedUnixMs)
		assert.GreaterOrEqual(t, first.EndedUnixMs, first.StartedUnixMs)
		start := bytes.Index(k.out, []byte(osc("133;C")+"a  b")) + len(osc("133;C"))
		assert.EqualValues(t, start, first.OutputStart, "the output starts after the start mark")
		assert.EqualValues(t, bytes.Index(k.out, []byte(osc("133;D;0"))), first.OutputEnd, "and ends where the end mark begins")
		assert.EqualValues(t, 0, first.PromptOffset)
		assert.Equal(t, "exit 3", second.CommandLine)
		require.NotNil(t, second.ExitCode)
		assert.EqualValues(t, 3, *second.ExitCode)
		assert.GreaterOrEqual(t, second.PromptOffset, uint64(prefix), "the second command begins after the first")
		assert.Equal(t, "/home/me", second.Cwd, "the directory the command started in")
		assert.Equal(t, "nonce", second.CwdTrust)
		assert.Equal(t, "/home/me/src", third.Cwd, "and the next one starts where the shell said it was")
		assert.Equal(t, "input", third.State, "a prompt that is waiting for input")
		assert.False(t, third.Ran)
		assert.Nil(t, third.ExitCode)
		assert.Zero(t, third.StartedUnixMs)
	})
	for _, wrong := range []string{"", "x", strings.Repeat("A", 43), k.info.ID} {
		_, wrongErr := k.f.m.ChannelCommands(wrong)
		require.Error(t, wrongErr)
		assert.Equal(t, ChannelNotFound().Error(), wrongErr.Error(), "one answer for a capability that opens nothing")
	}
}

// The nonce is in no frame the host composes but the output, and in nothing the record says: the marks, the ready frame, the record and the log.
func TestTheNonceIsInNoMarkFrameNoReadyFrameNoRecordAndNoLog(t *testing.T) {
	k := newMarked(t)
	page := k.attach(nil)
	page.waitReady()
	k.print(k.command("ls", "a", 0, "/a") + osc("633;E;x;"+strings.Repeat("0", len(k.nonce))))
	marksOf(t, page, 5)
	st := page.waitBytes(len(k.out))
	guarded(t, "canary-frames", func() {
		for i, frame := range st.markFrames {
			assert.NotContains(t, string(frame), k.nonce, "marks frame %d", i)
		}
		ready, err := json.Marshal(st.ready)
		require.NoError(t, err)
		assert.NotContains(t, string(ready), k.nonce)
		assert.Contains(t, string(st.bytes()), k.nonce, "the output holds the nonce, inside the shell's own marks: the one sink the canary does not search")
	})
	record, err := k.f.m.ChannelCommands(k.info.Cap)
	require.NoError(t, err)
	busy, err := k.f.m.ChannelBusy(k.info.Cap)
	require.NoError(t, err)
	guarded(t, "canary-record", func() {
		encoded, encodeErr := json.Marshal(record)
		require.NoError(t, encodeErr)
		assert.NotContains(t, string(encoded), k.nonce)
		assert.NotContains(t, fmt.Sprintf("%v %+v %#v", record, busy, k.f.m.chanOf(t, k.info).ring), k.nonce)
		for _, logged := range k.f.logs.Records() {
			assert.NotContains(t, fmt.Sprintf("%v %v %v", logged.Message, logged.Fields, logged.ToMap()), k.nonce, "a log line of the host")
		}
	})
}

// A terminal that ended by itself keeps its marks with its output: a page that comes back to the kept end is given the same marks.
func TestTheKeptEndOfATerminalHasItsMarks(t *testing.T) {
	k := newMarked(t)
	page := k.attach(nil)
	page.waitReady()
	k.print(k.command("ls", "a", 0, "/a"))
	all := marksOf(t, page, 5)
	_, err := k.f.m.chanOf(t, k.info).master.Write([]byte("quit\n"))
	require.NoError(t, err)
	page.waitFor("the end", func(s pageState) bool { return len(s.ended) > 0 })

	again := k.attach(nil)
	ready := again.waitReady()
	got := marksOf(t, again, 5)
	guarded(t, "kept-end-marks", func() {
		assert.Equal(t, 1, ready.Marks)
		assert.NotNil(t, ready.Ended)
		assert.Equal(t, strip(all), strip(got))
	})
}

// A page that sleeps while the ring overwrites is told one gap, and the marks that ended inside what the gap skipped are not sent after it: the
// stream goes on with the marks that end after the gap.
func TestMarksThatEndedInsideAGapAreNotSentAfterIt(t *testing.T) {
	var clock *fakeClock
	k := newMarkedWith(t, func(m *Manager) {
		smallChannel(&m.channel)
		clock = withFakeClock(m)
	})
	s := k.f.m.chanOf(t, k.info)
	f := newFakeChannel(t)
	f.park(1)
	page := newChanPage(t, f, 0)
	go page.run()
	go k.f.m.ServeChannel(f)
	f.pageSend(attachFrameWithMarks(k.info.Cap, nil))
	page.waitReady()
	first := k.command("ls", "a", 0, "/a")
	var flood strings.Builder
	flood.WriteString(first)
	for range 600 {
		flood.WriteString(osc("133;A") + osc("133;C") + strings.Repeat("x", 1000) + osc("133;D;0"))
	}
	text := flood.String()
	require.Greater(t, len(text), 2*k.f.m.channel.ring)
	require.NoError(t, os.WriteFile(filepath.Join(k.dir, "flood"), []byte(text), 0o600))
	_, err := s.master.Write([]byte("flood\n"))
	require.NoError(t, err)
	waitSenderParked(t, f)
	require.Eventually(t, func() bool { return s.channelStats().waits >= 1 }, settle, time.Millisecond)
	clock.Advance(k.f.m.channel.stall)
	require.Eventually(t, func() bool { return s.channelStats().end == uint64(len(text)) }, settle, time.Millisecond, "the shell wrote it all with the page asleep")
	f.release()
	st := page.waitFor("the gap", func(s pageState) bool { return len(s.gaps) >= 1 })
	gap := st.gaps[0]
	last := page.waitFor("the last mark", func(s pageState) bool {
		n := len(s.marks)
		return n > 0 && s.marks[n-1].End == uint64(len(text))
	})
	guarded(t, "gap-skips-marks", func() {
		assert.Empty(t, last.faults)
		for _, m := range last.marks {
			if m.End > gap[0] {
				assert.Greater(t, m.End, gap[1], "mark %s ending at %d is inside what the gap [%d,%d) skipped", m.Kind, m.End, gap[0], gap[1])
			}
		}
	})
}

// What the pull fact knows is never removed by the marks: a program that holds the foreground keeps its name and process group (the close flow
// kills by group), and the marks only add busy where the pull fact says idle.
func TestMarksNeverRemoveWhatTheForegroundFactKnows(t *testing.T) {
	k := newMarked(t)
	s := k.f.m.chanOf(t, k.info)
	k.print(osc("133;A") + osc("133;B") + "make\r\n" + osc("633;E;FOO\\x3d1\\x20make;"+k.nonce) + osc("133;C"))
	pull := Foreground{State: StateBusy, Name: "sleep", PGID: 4242, Reason: ""}
	guarded(t, "marks-keep-pull-fact", func() {
		assert.Equal(t, pull, s.withMarks(pull))
	})
	guarded(t, "busy-from-marks", func() {
		idle := s.withMarks(Foreground{State: StateIdle, Name: "", PGID: 0, Reason: ""})
		assert.Equal(t, StateBusy, idle.State)
		assert.Empty(t, idle.Name)
	})
}

// A shell that is replaced (exec zsh) never prints the end of its command: the prompt of the new one does, and a prompt ends any running command.
func TestANewPromptEndsAnyRunningCommand(t *testing.T) {
	k := newMarked(t)
	k.print(osc("133;A") + osc("133;B") + "exec zsh\r\n" + osc("633;E;exec\\x20zsh;"+k.nonce) + osc("133;C"))
	busy, err := k.f.m.ChannelBusy(k.info.Cap)
	require.NoError(t, err)
	guarded(t, "busy-from-marks", func() { require.Equal(t, StateBusy, busy.State) })
	k.print(osc("133;A") + "$ " + osc("133;B"))
	guarded(t, "prompt-ends-running", func() {
		busy, err = k.f.m.ChannelBusy(k.info.Cap)
		require.NoError(t, err)
		assert.Equal(t, StateIdle, busy.State)
		record, recordErr := k.f.m.ChannelCommands(k.info.Cap)
		require.NoError(t, recordErr)
		assert.Empty(t, record.Running)
	})
	// The next command is its own: its start is believed, it is running, and the replaced command keeps no exit code.
	k.print(osc("633;E;sleep\\x2030;"+k.nonce) + osc("133;C"))
	guarded(t, "next-command-after-replaced", func() {
		record, recordErr := k.f.m.ChannelCommands(k.info.Cap)
		require.NoError(t, recordErr)
		require.Len(t, record.Commands, 2)
		assert.Nil(t, record.Commands[0].ExitCode)
		assert.Equal(t, "sleep 30", record.Commands[1].CommandLine)
		assert.Equal(t, record.Commands[1].ID, record.Running)
	})
}
