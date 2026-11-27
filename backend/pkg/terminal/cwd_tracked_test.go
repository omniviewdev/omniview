//go:build !windows

package terminal

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// THE TRACKED DIRECTORY (issue #694 step 6). "New terminal here" and the card's directory follow the directory the shell said it is in with the
// session's nonce, but only while the system agrees that the shell's process is in that very directory (the same inode, so the shell's logical
// spelling of a symlink is kept): a shell that was replaced (`exec zsh`: the new one has no integration) or that moved while a command runs would
// otherwise be answered for with a stale directory. When the system cannot say, the tracked one is the answer; otherwise the system's is.

// goTo makes the fake shell change its own directory (no output), and waits until it has by sending a command after it and waiting for its output.
func goTo(t *testing.T, k *marked, dir string) {
	t.Helper()
	_, err := k.f.m.chanOf(t, k.info).master.Write([]byte("cd:" + dir + "\n"))
	require.NoError(t, err)
	k.print("") // the shell reads this after the cd; nothing is printed, so wait on the process's own directory instead
	require.Eventually(t, func() bool {
		got, pullErr := processCwd(k.f.m.chanOf(t, k.info).cmd.Process.Pid)
		if pullErr != nil {
			return false
		}
		want, evalErr := filepath.EvalSymlinks(dir)
		return evalErr == nil && got == want
	}, settle, time.Millisecond, "the shell is in %s", dir)
}

func cwdOf(t *testing.T, k *marked) Directory {
	t.Helper()
	got, err := k.f.m.ChannelCwd(k.info.Cap)
	require.NoError(t, err)
	return got
}

func TestTheDirectoryIsTheOneTheShellProvedWhereTheSystemAgreesAndFollowsIt(t *testing.T) {
	k := newMarked(t)
	first, second := t.TempDir(), t.TempDir()
	require.Equal(t, Directory{Path: k.f.home}, cwdOf(t, k), "before any mark the system's answer")

	goTo(t, k, first)
	k.print(osc("633;P;Cwd=" + first + ";" + k.nonce))
	guarded(t, "tracked", func() {
		assert.Equal(t, Directory{Path: first}, cwdOf(t, k))
	})
	goTo(t, k, second)
	k.print(osc("633;P;Cwd=" + second + ";" + k.nonce))
	guarded(t, "follows", func() {
		assert.Equal(t, Directory{Path: second}, cwdOf(t, k))
	})
}

// After `exec zsh` the new shell has no integration and tells nothing; a command that changed the shell's directory tells nothing either: the
// last proof names a directory the shell is no longer in, and the system's answer is the true one.
func TestAProofThatTheSystemContradictsIsNotTheAnswer(t *testing.T) {
	k := newMarked(t)
	stale, now := t.TempDir(), t.TempDir()
	goTo(t, k, stale)
	k.print(osc("633;P;Cwd=" + stale + ";" + k.nonce))
	goTo(t, k, now)
	guarded(t, "stale-proof", func() {
		assert.Equal(t, Directory{Path: now}, cwdOf(t, k), "the shell moved with no word: the system says where it is")
	})
}

func TestTheShellsOwnSpellingOfASymlinkedDirectoryIsKept(t *testing.T) {
	k := newMarked(t)
	target := t.TempDir()
	link := filepath.Join(t.TempDir(), "link")
	require.NoError(t, os.Symlink(target, link))
	goTo(t, k, link)
	k.print(osc("633;P;Cwd=" + link + ";" + k.nonce))
	guarded(t, "logical-spelling", func() {
		assert.Equal(t, Directory{Path: link}, cwdOf(t, k), "the same directory, in the words the shell used")
	})
}

func TestADirectoryNoNonceVouchedForIsNeverTheAnswer(t *testing.T) {
	k := newMarked(t)
	elsewhere := t.TempDir()
	goTo(t, k, elsewhere)
	other := t.TempDir()
	wrong := strings.Repeat("f", len(k.nonce))
	k.print(osc("633;P;Cwd="+other+";"+wrong) + osc("633;P;Cwd="+other) + osc("7;file://host"+other))
	guarded(t, "forged-ignored", func() {
		assert.Equal(t, Directory{Path: elsewhere}, cwdOf(t, k), "a wrong nonce, no nonce and OSC 7 change nothing")
	})
}

func TestAProvedDirectoryThatIsNotADirectoryHereFallsBackToTheSystemsAnswer(t *testing.T) {
	k := newMarked(t)
	file := filepath.Join(t.TempDir(), "file")
	require.NoError(t, os.WriteFile(file, nil, 0o600))
	for name, claimed := range map[string]string{
		"missing":  filepath.Join(t.TempDir(), "gone"),
		"a file":   file,
		"relative": ".",
	} {
		k.print(osc("633;P;Cwd=" + claimed + ";" + k.nonce))
		guarded(t, "fallback-"+strings.ReplaceAll(name, " ", "-"), func() {
			assert.Equal(t, Directory{Path: k.f.home}, cwdOf(t, k), "%s: a terminal cannot start there (an ssh session names a remote path)", name)
		})
	}
}

func TestATerminalWithoutIntegrationAnswersWithTheSystemsDirectory(t *testing.T) {
	k := newMarked(t)
	off := newIntegrationFixture(t, "zsh", filepath.Join(k.dir, "zsh"), "MARKS_DIR="+k.dir)
	off.m.SetIntegration(func() (bool, error) { return false, nil })
	info, err := off.m.Start(Options{Command: []string{filepath.Join(k.dir, "zsh")}, Cwd: off.home, Cols: 100, Rows: 30, Channel: true}, nil)
	require.NoError(t, err)
	require.Equal(t, IntegrationOff, info.Integration.State)
	elsewhere := t.TempDir()
	claim := osc("633;P;Cwd=" + elsewhere + ";" + k.nonce)
	require.NoError(t, os.WriteFile(filepath.Join(k.dir, "claim"), []byte(claim), 0o600))
	page := off.m.attachMarks(t, info.Cap, nil)
	page.waitReady()
	_, writeErr := off.m.chanOf(t, info).master.Write([]byte("claim\n"))
	require.NoError(t, writeErr)
	page.waitBytes(len(claim))
	got, cwdErr := off.m.ChannelCwd(info.Cap)
	require.NoError(t, cwdErr)
	guarded(t, "no-integration", func() {
		assert.Equal(t, Directory{Path: off.home}, got, "no scanner reads a terminal without the integration")
	})
}

// The events lane (a terminal with no channel, asked by its id) gives the same answer from the same record.
func TestTheEventsLanesDirectoryFollowsTheSameRule(t *testing.T) {
	dir := t.TempDir()
	shell := filepath.Join(dir, "zsh")
	require.NoError(t, os.WriteFile(shell, []byte(marksShellScript), 0o700))
	f := newIntegrationFixture(t, "zsh", shell, "MARKS_DIR="+dir)
	info, err := f.m.Start(Options{Command: []string{shell}, Cwd: f.home, Cols: 100, Rows: 30}, nil)
	require.NoError(t, err)
	require.Equal(t, IntegrationOn, info.Integration.State)
	s := f.m.session(t, info.ID)
	nonce := s.nonce.Reveal()
	require.NotEmpty(t, nonce)
	tracked, elsewhere := t.TempDir(), t.TempDir()

	send := func(line string) {
		t.Helper()
		_, writeErr := s.master.Write([]byte(line + "\n"))
		require.NoError(t, writeErr)
	}
	say := func(text string) {
		t.Helper()
		require.NoError(t, os.WriteFile(filepath.Join(dir, "say"), []byte(text), 0o600))
		want := s.next() + uint64(len(text))
		send("say")
		require.Eventually(t, func() bool { return s.next() >= want }, settle, time.Millisecond, "the shell printed it")
	}
	moveTo := func(to string) {
		t.Helper()
		send("cd:" + to)
		require.Eventually(t, func() bool {
			got, pullErr := processCwd(s.cmd.Process.Pid)
			want, evalErr := filepath.EvalSymlinks(to)
			return pullErr == nil && evalErr == nil && got == want
		}, settle, time.Millisecond)
	}
	moveTo(tracked)
	say(osc("633;P;Cwd=" + tracked + ";" + strings.Repeat("f", len(nonce))))
	got, err := f.m.Cwd(info.ID)
	require.NoError(t, err)
	assert.Equal(t, Directory{Path: tracked}, got, "a wrong nonce changes nothing: the system says so")
	say(osc("633;P;Cwd=" + tracked + ";" + nonce))
	got, err = f.m.Cwd(info.ID)
	require.NoError(t, err)
	guarded(t, "events-tracked", func() {
		assert.Equal(t, Directory{Path: tracked}, got)
	})
	moveTo(elsewhere)
	got, err = f.m.Cwd(info.ID)
	require.NoError(t, err)
	guarded(t, "events-stale-proof", func() {
		assert.Equal(t, Directory{Path: elsewhere}, got, "the proof names a directory the shell left")
	})
}
