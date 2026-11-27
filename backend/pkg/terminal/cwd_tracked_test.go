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

// THE TRACKED DIRECTORY (issue #694 step 6). "New terminal here" and the card's directory follow the directory the shell said it is in, when
// the shell's integration is on and the directory came with the session's nonce; otherwise the system is asked, as it always was. The shell of
// these tests starts in the account's home (the system's answer) and prints directories that are not the home, so the two answers differ.

// cwdOf asks the channel.
func cwdOf(t *testing.T, k *marked) Directory {
	t.Helper()
	got, err := k.f.m.ChannelCwd(k.info.Cap)
	require.NoError(t, err)
	return got
}

func TestTheDirectoryIsTheOneTheShellProvedWithTheNonceAndFollowsIt(t *testing.T) {
	k := newMarked(t)
	first, second := t.TempDir(), t.TempDir()
	require.Equal(t, Directory{Path: k.f.home}, cwdOf(t, k), "before any mark the system's answer: the shell's own directory")

	k.print(k.command("cd first", "", 0, first))
	guarded(t, "tracked", func() {
		assert.Equal(t, Directory{Path: first}, cwdOf(t, k), "the directory the shell proved, not the one the process is in")
	})
	k.print(k.command("cd second", "", 0, second))
	guarded(t, "follows", func() {
		assert.Equal(t, Directory{Path: second}, cwdOf(t, k), "the newest one")
	})
}

func TestADirectoryNoNonceVouchedForIsNeverTheAnswer(t *testing.T) {
	k := newMarked(t)
	genuine, forged := t.TempDir(), t.TempDir()
	wrong := strings.Repeat("f", len(k.nonce))
	k.print(osc("633;P;Cwd="+forged+";"+wrong) + osc("633;P;Cwd="+forged) + osc("7;file://host"+forged))
	guarded(t, "forged-ignored", func() {
		assert.Equal(t, Directory{Path: k.f.home}, cwdOf(t, k), "a wrong nonce, no nonce and OSC 7 (anything can print it) change nothing")
	})
	// The other half: the same mark with the nonce is believed.
	k.print(osc("633;P;Cwd=" + genuine + ";" + k.nonce))
	guarded(t, "genuine-believed", func() {
		assert.Equal(t, Directory{Path: genuine}, cwdOf(t, k))
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
	require.NoError(t, os.WriteFile(filepath.Join(k.dir, "claim"), []byte(osc("633;P;Cwd="+elsewhere+";"+k.nonce)), 0o600))
	page := off.m.attachMarks(t, info.Cap, nil)
	page.waitReady()
	_, writeErr := off.m.chanOf(t, info).master.Write([]byte("claim\n"))
	require.NoError(t, writeErr)
	page.waitBytes(len(osc("633;P;Cwd=" + elsewhere + ";" + k.nonce)))
	got, cwdErr := off.m.ChannelCwd(info.Cap)
	require.NoError(t, cwdErr)
	guarded(t, "no-integration", func() {
		assert.Equal(t, Directory{Path: off.home}, got, "no scanner reads a terminal without the integration: what it prints names no directory")
	})
}

// The events lane (a terminal with no channel, asked by its id) gives the same answer from the same record.
func TestTheEventsLanesDirectoryIsTheTrackedOneToo(t *testing.T) {
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
	tracked := t.TempDir()

	say := func(text string) {
		t.Helper()
		require.NoError(t, os.WriteFile(filepath.Join(dir, "say"), []byte(text), 0o600))
		want := s.next() + uint64(len(text))
		_, writeErr := s.master.Write([]byte("say\n"))
		require.NoError(t, writeErr)
		require.Eventually(t, func() bool { return s.next() >= want }, settle, time.Millisecond, "the shell printed it")
	}
	got, err := f.m.Cwd(info.ID)
	require.NoError(t, err)
	require.Equal(t, Directory{Path: f.home}, got, "before any mark the system's answer")

	say(osc("633;P;Cwd=" + tracked + ";" + strings.Repeat("f", len(nonce))))
	got, err = f.m.Cwd(info.ID)
	require.NoError(t, err)
	assert.Equal(t, Directory{Path: f.home}, got, "a wrong nonce changes nothing")

	say(osc("633;P;Cwd=" + tracked + ";" + nonce))
	got, err = f.m.Cwd(info.ID)
	require.NoError(t, err)
	guarded(t, "events-tracked", func() {
		assert.Equal(t, Directory{Path: tracked}, got, "the events lane follows the shell's proof")
	})
}
