// Package shellenv shares login-shell selection between settings and terminals.
package shellenv

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// ErrUnavailable is why Resolve refuses when no shell can start; ErrUnsupported, why it refuses a
// program that is not a shell it can start. Both are wrapped, so errors.Is tells them apart and the
// text says what was tried.
var (
	ErrUnavailable = errors.New("shell executable unavailable")
	ErrUnsupported = errors.New("unsupported terminal shell")
)

// Attempt is one shell Resolve tried and why it did not start: where the path came from (the shell asked for,
// $SHELL, the account's shell, the fallback), the path as it was given, and the reason in a few words.
type Attempt struct {
	Source string `json:"source"`
	Path   string `json:"path"`
	Reason string `json:"reason"`
}

// UnavailableError is the refusal when no shell can start, with every attempt that was made, in the order it
// was made. It is ErrUnavailable for errors.Is; its text is the sentence the refusal always had, and the list
// is for a caller that draws one path to a line.
type UnavailableError struct {
	Tried []Attempt
}

func (e *UnavailableError) Error() string {
	parts := make([]string, 0, len(e.Tried))
	for _, attempt := range e.Tried {
		parts = append(parts, fmt.Sprintf("%s %s: %s", attempt.Source, strconv.Quote(attempt.Path), attempt.Reason))
	}
	return fmt.Sprintf("%s: tried %s", ErrUnavailable.Error(), strings.Join(parts, "; "))
}

func (e *UnavailableError) Unwrap() error { return ErrUnavailable }

// Default returns an installed shell, consulting the account when SHELL is absent.
func Default() string {
	if runtime.GOOS == "windows" {
		return "powershell.exe"
	}
	return detect(os.Getenv("SHELL"), accountShell, exec.LookPath)
}

// source is one place a shell can come from, in the order Resolve tries them.
type source struct {
	label string
	shell func() string
}

// sources is the stated order a shell is chosen in: the shell the caller asked for (the user's setting),
// then $SHELL, then the account's shell (the passwd entry; dscl on macOS), then /bin/bash, then /bin/sh.
// The account is asked only when the shells before it did not start: asking costs a process on macOS.
func sources(requested, environment string, account func() string) []source {
	if runtime.GOOS == "windows" {
		return []source{
			{label: "the shell asked for", shell: func() string { return requested }},
			{label: "the default", shell: func() string { return "powershell.exe" }},
		}
	}
	return []source{
		{label: "the shell asked for", shell: func() string { return requested }},
		{label: "$SHELL", shell: func() string { return environment }},
		{label: "the account's shell", shell: account},
		{label: "the fallback", shell: func() string { return "/bin/bash" }},
		{label: "the fallback", shell: func() string { return "/bin/sh" }},
	}
}

// choice is what choose found.
type choice struct {
	// path is the shell that resolves and is usable; empty when none does.
	path string
	// from is which source it came from: 0 is the shell the caller asked for.
	from int
	// tried says, for each shell before it, why it did not start.
	tried []Attempt
	// refused is set when the shell the caller asked for exists but is not a shell the host starts.
	refused bool
}

// choose walks the order and takes the first shell that resolves and that usable accepts. A shell the
// caller asked for that resolves but is not usable is refused, never replaced: a program that is not a
// shell does not become bash.
func choose(requested, environment string, account func() string, lookup func(string) (string, error), usable func(string) error) choice {
	var tried []Attempt
	for index, candidate := range sources(requested, environment, account) {
		shell := candidate.shell()
		if shell == "" {
			continue
		}
		path, lookErr := lookup(shell)
		if lookErr != nil {
			tried = append(tried, Attempt{Source: candidate.label, Path: shell, Reason: reason(lookErr)})
			continue
		}
		if useErr := usable(path); useErr != nil {
			if index == 0 {
				return choice{path: "", from: index, tried: tried, refused: true}
			}
			tried = append(tried, Attempt{Source: candidate.label, Path: shell, Reason: "not a shell the host starts"})
			continue
		}
		return choice{path: path, from: index, tried: tried, refused: false}
	}
	return choice{path: "", from: -1, tried: tried, refused: false}
}

// reason is why a shell did not resolve, in a few words.
func reason(err error) string {
	switch {
	case errors.Is(err, fs.ErrNotExist):
		return "not found"
	case errors.Is(err, fs.ErrPermission):
		return "not executable"
	default:
		return err.Error()
	}
}

func detect(environment string, account func() string, lookup func(string) (string, error)) string {
	found := choose("", environment, account, lookup, func(string) error { return nil })
	if found.path == "" {
		return "/bin/sh"
	}
	return found.path
}

func accountShell() string {
	account, err := user.Current()
	if err != nil {
		return ""
	}
	if runtime.GOOS == "darwin" {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "/usr/bin/dscl", ".", "-read", "/Users/"+account.Username, "UserShell")
		cmd.WaitDelay = time.Second
		output, err := cmd.Output()
		if err == nil {
			_, shell, ok := strings.Cut(strings.TrimSpace(string(output)), ": ")
			if ok {
				return shell
			}
		}
		return ""
	}
	data, err := os.ReadFile("/etc/passwd")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Split(line, ":")
		if len(fields) == 7 && fields[0] == account.Username {
			return fields[6]
		}
	}
	return ""
}

// Resolve chooses the shell to start and the arguments that make it an interactive login shell. command is
// what the caller asked for: its first element is the shell (the user's setting) and the rest follow the
// login flags. The order is stated: that shell when it exists and is executable, else $SHELL, else the
// account's shell, else /bin/bash, else /bin/sh; the caller reads which one started from the path it
// gets back, and the arguments of the caller go with the shell the caller asked for only. A program that
// exists but is not a shell the host starts is refused (ErrUnsupported), not replaced. When no shell can
// start the error is ErrUnavailable and names every path that was tried.
func Resolve(command []string) (string, []string, error) {
	var requested string
	var extra []string
	if len(command) > 0 && command[0] != "" {
		requested = command[0]
		extra = command[1:]
	}
	return resolve(requested, extra, os.Getenv("SHELL"), accountShell, exec.LookPath)
}

func resolve(requested string, extra []string, environment string, account func() string, lookup func(string) (string, error)) (string, []string, error) {
	found := choose(requested, environment, account, lookup, func(path string) error {
		_, err := loginArguments(path)
		return err
	})
	if found.refused {
		return "", nil, fmt.Errorf("%w %q", ErrUnsupported, requested)
	}
	if found.path == "" {
		return "", nil, &UnavailableError{Tried: found.tried}
	}
	args, _ := loginArguments(found.path)
	if found.from == 0 {
		args = append(args, extra...)
	}
	return found.path, args, nil
}

// Check is Resolve without the fallback: whether this one shell can start, and where it is. Settings
// validate the shell a user typed with it, so that a typo is refused and not replaced by another shell.
func Check(shell string) (string, error) {
	path, err := exec.LookPath(shell)
	if err != nil {
		return "", fmt.Errorf("%w: %w", ErrUnavailable, err)
	}
	if _, argsErr := loginArguments(path); argsErr != nil {
		return "", fmt.Errorf("%w %q", ErrUnsupported, shell)
	}
	return path, nil
}

// loginArguments are the arguments that make a shell interactive and login, or ErrUnsupported when the
// host does not start the program.
func loginArguments(path string) ([]string, error) {
	switch Name(path) {
	case "zsh", "bash", "fish", "sh", "dash", "ksh", "nu", "xonsh":
		return []string{"-i", "-l"}, nil
	case "csh", "tcsh":
		// C shells require -l to be their only option.
		return []string{"-l"}, nil
	case "pwsh", "powershell", "pwsh.exe", "powershell.exe":
		return []string{"-Login", "-NoLogo"}, nil
	case "cmd.exe":
		if runtime.GOOS == "windows" {
			return nil, nil
		}
	}
	return nil, ErrUnsupported
}

// Name is the shell's own name: the file a symlink points at, so a custom link to bash is bash. The
// selected executable is never replaced by it.
func Name(path string) string {
	if target, err := filepath.EvalSymlinks(path); err == nil {
		return filepath.Base(target)
	}
	return filepath.Base(path)
}
