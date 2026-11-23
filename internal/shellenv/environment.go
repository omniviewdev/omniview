package shellenv

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"
)

const environmentMarker = "\x00OMNIVIEW_LOGIN_ENV\x00"

// ProbeState says how the host's own resolution of the user's login environment went.
type ProbeState string

const (
	// ProbeNotRun: it did not run. This platform does not need it, or Restore was never called.
	ProbeNotRun ProbeState = "not-run"
	// ProbeOK: the host process holds the user's login environment.
	ProbeOK ProbeState = "ok"
	// ProbeFailed: the login shell could not be asked (an error, a timeout, too much output). The host's
	// own environment is the one it was launched with, so the tools the host starts may lack the user's
	// PATH. A terminal is not affected: its shell computes the user's environment itself.
	ProbeFailed ProbeState = "failed"
)

// ProbeResult is what the host knows about its own login-environment probe.
type ProbeResult struct {
	State ProbeState `json:"state"`
	// Message says why it failed, in the words of Restore; never the shell's own output, which can hold
	// credentials.
	Message string `json:"message,omitempty"`
}

type processState struct {
	mu          sync.Mutex
	environment []string
	probe       ProbeResult
}

// state is what this process knows about its own start: the environment it was launched with, and how the
// login-environment probe went. Both are recorded once, by Restore, before anything else starts.
//
//nolint:gochecknoglobals // A fact about this process, recorded once at start.
var state = processState{mu: sync.Mutex{}, environment: nil, probe: ProbeResult{State: ProbeNotRun, Message: ""}}

// RememberLaunchEnvironment records the environment the host was launched with. main calls it before
// anything of the host (its profile, its runtime directories, a framework) adds to the process environment,
// so that a terminal starts from what the user's environment was and not from what the host made of it.
// Restore records it too, when nothing did: the first record wins.
func RememberLaunchEnvironment() { remember(os.Environ()) }

func remember(environment []string) {
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.environment == nil {
		state.environment = slices.Clone(environment)
	}
}

func recordProbe(err error) {
	state.mu.Lock()
	defer state.mu.Unlock()
	if err == nil {
		state.probe = ProbeResult{State: ProbeOK, Message: ""}
		return
	}
	state.probe = ProbeResult{State: ProbeFailed, Message: err.Error()}
}

// LaunchEnvironment is the environment the host was launched with, as Restore found it, before it imported
// the login environment into the process: launchd's minimal one for an app started from the Dock or
// Finder, the caller's for one started from a terminal. A terminal's shell starts from it, as a login
// shell, and computes the user's environment itself, once, as Terminal.app's does. Starting it from the
// restored environment instead runs the user's profile on a PATH that /usr/libexec/path_helper has
// already put in order, and path_helper then moves the user's directories behind the system's. If
// Restore never ran, it is the environment of the process now.
func LaunchEnvironment() []string {
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.environment == nil {
		return os.Environ()
	}
	return slices.Clone(state.environment)
}

// Probe says how the host's own login-environment probe went at start. A failure is recorded here and
// stated in the answer of every terminal that starts; it is never swallowed.
func Probe() ProbeResult {
	state.mu.Lock()
	defer state.mu.Unlock()
	return state.probe
}

// Restore imports the interactive login environment before any tools start.
// Runtime identity and filesystem isolation always remain owned by the host.
// It first remembers the environment the host was launched with (LaunchEnvironment) and records how the
// probe went (Probe).
func Restore(ctx context.Context) error {
	base := os.Environ()
	remember(base)
	if runtime.GOOS != "darwin" {
		return nil
	}
	environment, err := Capture(ctx, base)
	if err != nil {
		recordProbe(err)
		return err
	}
	for _, entry := range environment {
		key, value, _ := strings.Cut(entry, "=")
		if err := os.Setenv(key, value); err != nil {
			publishErr := fmt.Errorf("publish login environment: %w", err)
			recordProbe(publishErr)
			return publishErr
		}
	}
	recordProbe(nil)
	return nil
}

// Capture resolves the login environment without publishing it. The deadline also
// bounds shells whose startup files wait for user input or leave child pipes open.
func Capture(ctx context.Context, base []string) ([]string, error) {
	var requested string
	for _, entry := range base {
		if value, ok := strings.CutPrefix(entry, "SHELL="); ok {
			requested = value
		}
	}
	selected := detect(requested, accountShell, exec.LookPath)
	shell, args, err := Resolve([]string{selected})
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	// External commands avoid differences between shell builtin implementations.
	command := "/usr/bin/printf '\\0OMNIVIEW_LOGIN_ENV\\0'; /usr/bin/env -0"
	var input string
	switch Name(shell) {
	case "csh", "tcsh":
		// -l cannot be combined with -c. Read the command from standard input.
		input = command + "\nexit\n"
	case "nu":
		command = "^/usr/bin/printf '\\0OMNIVIEW_LOGIN_ENV\\0'; ^/usr/bin/env -0"
		args = append(args, "-c", command)
	case "xonsh":
		command = "import os; os.write(1, b'\\x00OMNIVIEW_LOGIN_ENV\\x00'); os.execv('/usr/bin/env', ['env', '-0'])"
		args = append(args, "-c", command)
	case "pwsh", "powershell", "pwsh.exe", "powershell.exe":
		command = "& /usr/bin/printf '\\0OMNIVIEW_LOGIN_ENV\\0'; & /usr/bin/env '-0'"
		args = append(args, "-Command", command)
	default:
		args = append(args, "-c", command)
	}
	cmd := exec.CommandContext(ctx, shell, args...)
	if input != "" {
		cmd.Stdin = strings.NewReader(input)
	}
	cmd.Env = base
	cmd.WaitDelay = time.Second
	var output boundedOutput
	cmd.Stdout = &output
	// Startup output can contain credentials. Never include it in errors or logs.
	if err := cmd.Run(); err != nil {
		return nil, errors.New("login environment resolution failed or timed out")
	}
	index := bytes.LastIndex(output.data, []byte(environmentMarker))
	if index < 0 || output.overflow {
		return nil, errors.New("invalid or oversized login environment")
	}
	return merge(base, strings.Split(string(output.data[index+len(environmentMarker):]), "\x00")), nil
}

type boundedOutput struct {
	data     []byte
	overflow bool
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	const maximum = 4 << 20
	if len(p) > maximum-len(b.data) {
		b.overflow = true
		return len(p), nil
	}
	b.data = append(b.data, p...)
	return len(p), nil
}

func protected(key string) bool {
	return strings.HasPrefix(key, "OMNIVIEW_") || strings.HasPrefix(key, "XDG_") ||
		strings.HasPrefix(key, "PLUGIN_") || key == "HOME" || key == "GOWORK" ||
		key == "TMPDIR" || key == "TMP" || key == "TEMP" || key == "SHELL" ||
		key == "PWD" || key == "SHLVL" || key == "_"
}

func merge(base, login []string) []string {
	values := make(map[string]string, len(base)+len(login))
	for _, entry := range base {
		key, value, ok := strings.Cut(entry, "=")
		if ok {
			values[key] = value
		}
	}
	for _, entry := range login {
		key, value, ok := strings.Cut(entry, "=")
		if ok && key != "" && !protected(key) {
			values[key] = value
		}
	}
	result := make([]string, 0, len(values))
	for key, value := range values {
		result = append(result, key+"="+value)
	}
	return result
}
