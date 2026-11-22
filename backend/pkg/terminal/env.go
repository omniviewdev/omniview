package terminal

import (
	"os/exec"
	"runtime"
	"strings"

	"github.com/omniviewdev/omniview/internal/shellenv"
)

// EnvironmentLaunch is the source of every terminal's environment: the environment the host was launched
// with. The shell is started from it as a login shell and computes the user's environment itself, once,
// as the login shell of Terminal.app does.
const EnvironmentLaunch = "launch"

// Environment says where a shell's environment came from.
type Environment struct {
	// Source is where it comes from: EnvironmentLaunch.
	Source string `json:"source"`
	// Probe says how the host's own resolution of the user's login environment went at start. It does not
	// affect this terminal, whose shell computes the user's environment itself; it says whether the tools
	// the host starts (plugins) have the user's PATH.
	Probe Probe `json:"probe"`
}

// Probe is how the host's resolution of the login environment went (shellenv.Probe).
type Probe struct {
	// State is "ok" (the host process holds the login environment), "failed" (it could not be resolved:
	// Message says why) or "not-run" (this platform does not need it).
	State   string `json:"state"`
	Message string `json:"message,omitempty"`
}

func environmentOf(probe shellenv.ProbeResult) Environment {
	return Environment{Source: EnvironmentLaunch, Probe: Probe{State: string(probe.State), Message: probe.Message}}
}

// terminalEnvironment is the environment a shell starts with. The base is the environment the host was
// LAUNCHED with (shellenv.LaunchEnvironment), not the one it restored from the user's login shell, and the
// shell is started as an interactive login shell (shellenv.Resolve): the user's startup files run once,
// on the environment a Terminal.app window starts from. (Started from the restored environment they ran
// on a PATH that /usr/libexec/path_helper had already put in order, and path_helper then moved the user's
// directories behind the system's.)
//
// What is taken out: the host's own variables and those of the terminal the host was launched from
// (hostPrivate). What is added is what a terminal emulator tells its programs about itself, as VS Code and
// JetBrains do: TERM and COLORTERM for the emulator's capabilities, TERM_PROGRAM and TERM_PROGRAM_VERSION
// so that a shell can tell it runs in Omniview (VS Code sets TERM_PROGRAM=vscode, which its shell
// integration tests for), PWD, the directory the shell starts in as it was given and not as a symlink
// resolves it, and a UTF-8 locale when the user has set none. A locale the user chose is theirs and stays.
func terminalEnvironment(base []string, shellPath, dir, version string) []string {
	own := map[string]bool{"SHELL": true, "PWD": true, "TERM": true, "COLORTERM": true, "TERM_PROGRAM": true, "TERM_PROGRAM_VERSION": true}
	environment := make([]string, 0, len(base)+len(own)+1)
	localeSet := false
	for _, entry := range base {
		key, value, _ := strings.Cut(entry, "=")
		if own[key] || hostPrivate(key) {
			continue
		}
		if (key == "LANG" || key == "LC_ALL" || key == "LC_CTYPE") && value != "" {
			localeSet = true
		}
		environment = append(environment, entry)
	}
	environment = append(environment,
		"SHELL="+shellPath,
		"PWD="+dir,
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"TERM_PROGRAM=Omniview",
		"TERM_PROGRAM_VERSION="+version,
	)
	if !localeSet {
		environment = append(environment, "LANG="+defaultLocale())
	}
	return environment
}

// hostPrivate reports whether a variable belongs to the host, or to the terminal or multiplexer the host
// was launched from, and has no place in the environment of a new terminal. OMNIVIEW_*, PLUGIN_* and
// GOWORK are the host's: its own configuration, and the GOWORK=off it keeps its plugin builds apart from
// the user's Go workspace with (a login shell sets the user's own GOWORK again from their startup files).
// COLUMNS and LINES are the size of the launching terminal; TMUX, TMUX_PANE and STY name its multiplexer;
// VTE_VERSION and TERM_SESSION_ID name its emulator. None describes this terminal.
func hostPrivate(key string) bool {
	switch key {
	case "GOWORK", "COLUMNS", "LINES", "TMUX", "TMUX_PANE", "STY", "VTE_VERSION", "TERM_SESSION_ID":
		return true
	}
	return strings.HasPrefix(key, "OMNIVIEW_") || strings.HasPrefix(key, "PLUGIN_")
}

// defaultLocale is a UTF-8 locale every installation of the platform has: macOS ships en_US.UTF-8, and
// C.UTF-8 is in glibc since 2.35 and in Debian and Ubuntu before it.
func defaultLocale() string {
	if runtime.GOOS == "darwin" {
		return "en_US.UTF-8"
	}
	return "C.UTF-8"
}

// requestedShell names the shell the caller asked for when another one started in its place (it is not
// installed or not executable, so shellenv.Resolve took the next of its order), and is empty when the
// shell that started is the one asked for.
func requestedShell(command []string, started string) string {
	if len(command) == 0 || command[0] == "" {
		return ""
	}
	if found, err := exec.LookPath(command[0]); err == nil && found == started {
		return ""
	}
	return command[0]
}
