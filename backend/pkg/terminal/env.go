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

// terminalEnvironment is the environment a shell starts with: the user's LAUNCH environment, and the few
// variables the terminal sets on purpose, nothing else.
//
// The base is the environment the host was LAUNCHED with (shellenv.LaunchEnvironment, recorded before the
// host changed anything), not the one it restored from the user's login shell and not its live process
// environment, which holds whatever the host added after it launched (its profile's directories, its own
// flags, what a framework publishes). The shell is started as an interactive login shell (shellenv.Resolve):
// the user's startup files run once, on the environment a Terminal.app window starts from. (Started from the
// restored environment they ran on a PATH that /usr/libexec/path_helper had already put in order, and
// path_helper then moved the user's directories behind the system's.)
//
// Out of the launch environment come the variables that are the host's own or that describe the terminal
// the host was launched from, which is not this one (hostPrivate). What is added is what a terminal emulator
// tells its programs about itself, as VS Code and JetBrains do: TERM and COLORTERM for the emulator's
// capabilities, TERM_PROGRAM and TERM_PROGRAM_VERSION so that a shell can tell it runs in Omniview (VS Code
// sets TERM_PROGRAM=vscode, which its shell integration tests for), PWD, the directory the shell starts in
// as it was given and not as a symlink resolves it, and a UTF-8 locale when the user has set none. A locale
// the user chose is theirs and stays.
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

// hostPrivatePrefixes and hostPrivateNames are the variables of the launch environment that are not the
// user's and have no place in a terminal's:
//
//   - the host's own: OMNIVIEW_*, PLUGIN_*, GOWORK (the host keeps its plugin builds apart from the user's
//     Go workspace with GOWORK=off, which must not reach the user's go commands), and what a dev supervisor
//     hands the host (WAILS_*, which include the MCP bearer token, and FRONTEND_DEVSERVER_URL);
//   - what describes the terminal or multiplexer the host was launched from, which is not this terminal:
//     its size (COLUMNS, LINES), its multiplexer (TMUX, TMUX_PANE, STY) and its emulator (VTE_VERSION,
//     TERM_SESSION_ID, ITERM_*, LC_TERMINAL*, KITTY_*, WEZTERM_*, ALACRITTY_*, GHOSTTY_*, VSCODE_*,
//     TERMINAL_EMULATOR, WT_SESSION, WT_PROFILE_ID): a shell that finds ITERM_SESSION_ID loads iTerm's
//     integration and writes its escape sequences into this terminal.
//
// This list is not what keeps a variable the host added after launch out: the shell does not start from
// the process environment at all, so nothing the host sets after it launched is in it. It is what keeps out
// what the host was LAUNCHED with that is not the user's.
//
//nolint:gochecknoglobals // Fixed tables of names, read only.
var (
	hostPrivatePrefixes = []string{
		"OMNIVIEW_", "PLUGIN_", "WAILS_", "ITERM_", "KITTY_", "WEZTERM_", "ALACRITTY_", "GHOSTTY_", "VSCODE_", "LC_TERMINAL",
	}
	hostPrivateNames = map[string]bool{
		"GOWORK": true, "FRONTEND_DEVSERVER_URL": true,
		"COLUMNS": true, "LINES": true, "TMUX": true, "TMUX_PANE": true, "STY": true,
		"VTE_VERSION": true, "TERM_SESSION_ID": true, "TERMINAL_EMULATOR": true, "WT_SESSION": true, "WT_PROFILE_ID": true,
	}
)

func hostPrivate(key string) bool {
	if hostPrivateNames[key] {
		return true
	}
	for _, prefix := range hostPrivatePrefixes {
		if strings.HasPrefix(key, prefix) {
			return true
		}
	}
	return false
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

// The bounds of Launch.Env.
const (
	// MaxEnvName is the most bytes of a name.
	MaxEnvName = 256
	// MaxEnvValue is the most bytes of a value.
	MaxEnvValue = 32 << 10
	// MaxEnvEntries is the most names.
	MaxEnvEntries = 64
	// MaxEnvBytes is the most bytes of all names and values together.
	MaxEnvBytes = 256 << 10
)

func checkLaunchEnv(env map[string]string) error { return nil }
