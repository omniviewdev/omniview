package exec

import (
	"github.com/omniviewdev/omniview/internal/shellenv"
)

// settingDefaultShell is the id of the setting that names the shell a terminal starts when the caller names none.
const settingDefaultShell = "terminal.defaultShell"

// withDefaultShell is command with the default shell of the setting as the shell the caller asked for, when the caller named none. The default
// is the "requested" source of shellenv's order, so it is tried first and the order follows when it cannot start. A value that is empty, that
// cannot be read or that the host does not start (a shell uninstalled since it was chosen: Settings refuses a typo when it is typed, not later)
// leaves the command alone and the stated order chooses. A shell the caller named is never replaced, and what follows an empty first element is
// the arguments of no shell, so none goes to the default.
func withDefaultShell(command []string, setting func() (string, error)) []string {
	if len(command) > 0 && command[0] != "" {
		return command
	}
	value, err := setting()
	if err != nil || value == "" {
		return command
	}
	if _, checkErr := shellenv.Check(value); checkErr != nil {
		return command
	}
	return []string{value}
}

// defaultShellSetting reads terminal.defaultShell; no settings to ask is no default.
func (c *controller) defaultShellSetting() (string, error) {
	if c.settingsProvider == nil {
		return "", nil
	}
	return c.settingsProvider.GetString(settingDefaultShell)
}

// ListTerminalShells says which shells of this machine a terminal can be started with, and which one an empty command starts: the same choice
// CreateTerminal makes, so that what the list marks is what starts.
func (c *controller) ListTerminalShells() []shellenv.Shell {
	chosen := withDefaultShell(nil, c.defaultShellSetting)
	if len(chosen) == 0 {
		return shellenv.List(shellenv.Default())
	}
	return shellenv.List(chosen[0])
}
