package terminal

import (
	"runtime"
	"strings"
)

// terminalEnvironment is the environment a shell starts with. The base is the host's, which on macOS
// already holds the user's login environment (shellenv.Restore imports it at start, so a host launched
// from the Dock or Finder, which gets launchd's minimal PATH, is no different from one launched from a
// terminal), and the shell itself is started as an interactive login shell (shellenv.Resolve), which
// runs the user's startup files on top. What is added is what a terminal emulator tells its programs
// about itself, as VS Code and JetBrains do: TERM and COLORTERM for the emulator's capabilities,
// TERM_PROGRAM and TERM_PROGRAM_VERSION so a shell can tell it runs in Omniview (VS Code sets
// TERM_PROGRAM=vscode, which its shell integration scripts test for), and a UTF-8 locale when the user
// has set none. A locale the user chose is theirs and stays.
func terminalEnvironment(base []string, shellPath, version string) []string {
	own := map[string]bool{"SHELL": true, "TERM": true, "COLORTERM": true, "TERM_PROGRAM": true, "TERM_PROGRAM_VERSION": true}
	environment := make([]string, 0, len(base)+len(own)+1)
	localeSet := false
	for _, entry := range base {
		key, value, _ := strings.Cut(entry, "=")
		if own[key] {
			continue
		}
		if (key == "LANG" || key == "LC_ALL" || key == "LC_CTYPE") && value != "" {
			localeSet = true
		}
		environment = append(environment, entry)
	}
	environment = append(environment,
		"SHELL="+shellPath,
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

// defaultLocale is a UTF-8 locale every installation of the platform has: macOS ships en_US.UTF-8,
// and C.UTF-8 is in glibc since 2.35 and in Debian and Ubuntu before it.
func defaultLocale() string {
	if runtime.GOOS == "darwin" {
		return "en_US.UTF-8"
	}
	return "C.UTF-8"
}
