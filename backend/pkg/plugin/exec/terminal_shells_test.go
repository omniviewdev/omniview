//go:build !windows

package exec

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/terminal"
	"github.com/omniviewdev/omniview/internal/shellenv"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// defaultShellSetting answers the one setting the terminal reads for its shell and leaves the rest of the provider unimplemented.
type defaultShellSetting struct {
	pkgsettings.Provider
	value string
	err   error
}

func (s *defaultShellSetting) GetString(id string) (string, error) {
	if id != "terminal.defaultShell" {
		panic("the terminal asked for the setting " + id)
	}
	return s.value, s.err
}

func (s *defaultShellSetting) GetBool(string) (bool, error) { return true, nil }

// linkedShell is a shell at a path of its own: a link to sh, which is a shell the host starts, so that the shell that started is told from
// every shell the machine would start by itself.
func linkedShell(t *testing.T) string {
	t.Helper()
	sh, err := exec.LookPath("sh")
	require.NoError(t, err)
	link := filepath.Join(t.TempDir(), "chosen-shell")
	require.NoError(t, os.Symlink(sh, link))
	return link
}

// createOnBothLanes starts a terminal with command on the events lane and on the channel lane: the answers of both.
func createOnBothLanes(t *testing.T, fx *terminalFixture, command []string) map[string]*terminal.Session {
	t.Helper()
	events, err := fx.wrapper.CreateTerminal(fx.ctx(fx.page(1)), execsdk.SessionOptions{Command: command}, terminal.Launch{})
	require.NoError(t, err)
	channel, err := fx.wrapper.CreateTerminal(context.Background(), execsdk.SessionOptions{Command: command}, terminal.Launch{Channel: true})
	require.NoError(t, err)
	return map[string]*terminal.Session{"events": events, "channel": channel}
}

func TestTheDefaultShellSettingIsTheShellOfAnEmptyCommandOnBothLanes(t *testing.T) {
	fx := newTerminalFixture(t)
	chosen := linkedShell(t)
	fx.ctrl.settingsProvider = &defaultShellSetting{value: chosen}
	for lane, session := range createOnBothLanes(t, fx, nil) {
		assert.Equal(t, chosen, session.Shell.Path, "the %s lane did not start the default shell", lane)
		assert.Empty(t, session.Shell.Requested, "the %s lane says another shell than the one asked for started", lane)
	}
}

func TestAShellTheCallerNamesBeatsTheDefaultShellSetting(t *testing.T) {
	fx := newTerminalFixture(t)
	fx.ctrl.settingsProvider = &defaultShellSetting{value: linkedShell(t)}
	asked := shell(t)
	for lane, session := range createOnBothLanes(t, fx, asked) {
		assert.Equal(t, asked[0], session.Shell.Path, "the %s lane started the default shell over the one asked for", lane)
	}
}

func TestADefaultShellThatCannotStartLeavesTheTerminalToTheStatedOrder(t *testing.T) {
	notAShell := filepath.Join(t.TempDir(), "editor")
	require.NoError(t, os.WriteFile(notAShell, []byte("#!/bin/sh\n"), 0o755))
	cases := map[string]*defaultShellSetting{
		"a path that is not there":       {value: "/nowhere/zsh"},
		"a program that is not a shell":  {value: notAShell},
		"an empty value":                 {value: ""},
		"a setting the host cannot read": {err: assert.AnError},
	}
	for name, setting := range cases {
		t.Run(name, func(t *testing.T) {
			fx := newTerminalFixture(t)
			fx.ctrl.settingsProvider = setting
			for lane, session := range createOnBothLanes(t, fx, nil) {
				assert.NotEqual(t, setting.value, session.Shell.Path, "the %s lane started the setting", lane)
				assert.NotEmpty(t, session.Shell.Path, "the %s lane started no shell", lane)
			}
		})
	}
}

// An explicit program that is not a shell stays refused: only the setting's stale value is left to the order.
func TestAnExplicitProgramThatIsNotAShellIsStillRefusedWithADefaultShell(t *testing.T) {
	fx := newTerminalFixture(t)
	fx.ctrl.settingsProvider = &defaultShellSetting{value: linkedShell(t)}
	notAShell := filepath.Join(t.TempDir(), "editor")
	require.NoError(t, os.WriteFile(notAShell, []byte("#!/bin/sh\n"), 0o755))
	_, err := fx.wrapper.CreateTerminal(context.Background(), execsdk.SessionOptions{Command: []string{notAShell}}, terminal.Launch{Channel: true})
	require.ErrorIs(t, err, shellenv.ErrUnsupported)
}

func TestWithDefaultShellFillsOnlyAnEmptyCommandAndNeverKeepsTheArgumentsOfNoShell(t *testing.T) {
	setting := func() (string, error) { return linkedShell(t), nil }
	assert.Equal(t, []string{"/a/zsh", "-x"}, withDefaultShell([]string{"/a/zsh", "-x"}, setting))
	got := withDefaultShell([]string{"", "-c", "true"}, setting)
	require.Len(t, got, 1, "arguments that belong to no shell went to the default shell: %v", got)
	assert.NotEmpty(t, got[0])
}

func TestTheListOfShellsMarksTheDefaultShellOfTheSetting(t *testing.T) {
	fx := newTerminalFixture(t)
	chosen := linkedShell(t)
	fx.ctrl.settingsProvider = &defaultShellSetting{value: chosen}
	var marked []string
	for _, listed := range fx.wrapper.ListTerminalShells() {
		if listed.Default {
			marked = append(marked, listed.Path)
		}
	}
	assert.Equal(t, []string{chosen}, marked, "exactly the shell of the setting is the default, and it is listed even where no standard directory holds it")
}

func TestTheListOfShellsMarksTheShellThatStartsWhenTheSettingCannotStart(t *testing.T) {
	fx := newTerminalFixture(t)
	fx.ctrl.settingsProvider = &defaultShellSetting{value: "/nowhere/zsh"}
	session, err := fx.wrapper.CreateTerminal(context.Background(), execsdk.SessionOptions{}, terminal.Launch{Channel: true})
	require.NoError(t, err)
	listed := fx.wrapper.ListTerminalShells()
	var marked []string
	for _, entry := range listed {
		if entry.Default {
			marked = append(marked, entry.Path)
		}
	}
	require.Len(t, marked, 1, "one default in %v", listed)
	assert.Equal(t, realPathOf(t, session.Shell.Path), realPathOf(t, marked[0]), "the list marks a shell that is not the one an empty command starts")
}

// realPathOf is the file a path reaches: /bin and /usr/bin are one directory on many systems, and the shell is the same file by either.
func realPathOf(t *testing.T, path string) string {
	t.Helper()
	reached, err := filepath.EvalSymlinks(path)
	require.NoError(t, err)
	return reached
}
