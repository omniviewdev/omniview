package exec

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

type nativeTerminalLauncher interface {
	Supported() bool
	Launch(context.Context, string, *execsdk.NativeCommand) error
}

// macNativeTerminal owns all platform syntax. Frontend input is never command
// source. The injected functions let tests use disposable fixtures, not apps.
type macNativeTerminal struct {
	platform           string
	tempRoot           string
	lookPath           func(string) (string, error)
	resolveApplication func(context.Context, string) (string, error)
	runScript          func(context.Context, string) (string, error)
}

func (m macNativeTerminal) Supported() bool {
	platform := m.platform
	if platform == "" {
		platform = runtime.GOOS
	}
	return platform == "darwin"
}

func nativeApplicationID(application string) (string, error) {
	switch application {
	case "terminal":
		return "com.apple.Terminal", nil
	case "iterm2":
		return "com.googlecode.iterm2", nil
	default:
		return "", resourcev2.NewError("INVALID_REQUEST", "Choose Terminal or iTerm2 in Settings > Terminal.")
	}
}

func (m macNativeTerminal) Launch(ctx context.Context, application string, command *execsdk.NativeCommand) error {
	if !m.Supported() {
		return resourcev2.NewError("UNSUPPORTED", "External resource shells are supported only on macOS.")
	}
	if err := execsdk.ValidateNativeCommand(command); err != nil {
		return err
	}
	bundleID, err := nativeApplicationID(application)
	if err != nil {
		return err
	}
	lookup := m.lookPath
	if lookup == nil {
		// main restores shellenv's login environment before controllers start.
		// Use that GUI-safe PATH; never ask an interactive shell to resolve a plan.
		lookup = exec.LookPath
	}
	executable, err := lookup(command.Executable)
	if err != nil {
		return resourcev2.NewError("UNAVAILABLE", "The required local CLI is unavailable. Install the plugin's CLI and ensure it is on your login PATH, then restart Omniview.")
	}
	executable, err = filepath.Abs(executable)
	if err != nil {
		return resourcev2.NewError("UNAVAILABLE", "Cannot resolve the local CLI path. Check your login PATH and retry.")
	}
	if command.Cwd != "" {
		info, statErr := os.Stat(command.Cwd)
		if !filepath.IsAbs(command.Cwd) || statErr != nil || !info.IsDir() {
			return resourcev2.NewError("UNAVAILABLE", "The plugin's local working directory is unavailable. Check its configuration and retry.")
		}
	}
	run := m.runScript
	if run == nil {
		run = runNativeAppleScript
	}
	// NSWorkspace resolves the allowlisted bundle without sending Apple Events.
	// AppleScript's `path to application id` can hang even for installed apps.
	resolve := m.resolveApplication
	if resolve == nil {
		resolve = nativeApplicationPath
	}
	applicationPath, err := resolve(ctx, bundleID)
	if err != nil {
		return nativeAutomationError(ctx, err, true)
	}
	directory, err := os.MkdirTemp(m.tempRoot, "omniview-native-")
	if err != nil {
		return resourcev2.NewError("UNAVAILABLE", "Cannot create a private native launch file. Check your temporary directory permissions.")
	}
	path := filepath.Join(directory, "launch.sh")
	launched := false
	defer func() {
		if !launched {
			_ = os.RemoveAll(directory)
		}
	}()
	// Directory mode is 0700, file mode is 0600. /bin/sh reads it directly.
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return resourcev2.NewError("UNAVAILABLE", "Cannot create a private native launch file. Check your temporary directory permissions.")
	}
	_, writeErr := file.WriteString(nativeLaunchScript(directory, executable, command))
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		return resourcev2.NewError("UNAVAILABLE", "Cannot write the native launch file. Check available disk space and retry.")
	}
	if _, err := run(ctx, nativeAppleScript(application, applicationPath, path)); err != nil {
		return nativeAutomationError(ctx, err, false)
	}
	launched = true
	return nil
}

func posixQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func nativeLaunchScript(directory, executable string, command *execsdk.NativeCommand) string {
	var script strings.Builder
	script.WriteString("#!/bin/sh\n# Remove the private plan before starting the resource process.\n/bin/rm -f -- \"$0\" || exit 1\n/bin/rmdir -- ")
	script.WriteString(posixQuote(directory))
	script.WriteString(" || exit 1\n")
	if command.Cwd != "" {
		script.WriteString("cd ")
		script.WriteString(posixQuote(command.Cwd))
		script.WriteString(" || exit 1\n")
	}
	script.WriteString("exec /usr/bin/env --")
	// Preserve GUI-resolved CLI helper discovery without persisting the inherited
	// environment, which may contain secrets. Explicit plan PATH takes priority.
	if _, ok := command.Env["PATH"]; !ok {
		script.WriteByte(' ')
		script.WriteString(posixQuote("PATH=" + os.Getenv("PATH")))
	}
	keys := make([]string, 0, len(command.Env))
	for key := range command.Env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		script.WriteByte(' ')
		script.WriteString(posixQuote(key + "=" + command.Env[key]))
	}
	script.WriteByte(' ')
	script.WriteString(posixQuote(executable))
	for _, arg := range command.Args {
		script.WriteByte(' ')
		script.WriteString(posixQuote(arg))
	}
	script.WriteByte('\n')
	return script.String()
}

// AppleScript backslash escapes avoid embedding literal newlines or quotes in
// source. Shell quoting is a separate layer and must happen before this step.
func appleScriptString(value string) string {
	replacer := strings.NewReplacer("\\", "\\\\", "\"", "\\\"", "\r", "\\r", "\n", "\\n", "\t", "\\t")
	return "\"" + replacer.Replace(value) + "\""
}

func nativeAppleScript(application, applicationPath, path string) string {
	command := appleScriptString("/bin/sh " + posixQuote(path))
	target := "tell application " + appleScriptString(applicationPath)
	if application == "iterm2" {
		return target + "\nactivate\ncreate window with default profile command " + command + "\nend tell"
	}
	// Terminal's do script without an `in` target always creates a new window.
	// Never write text to a selected tab or an existing interactive session.
	return target + "\nactivate\ndo script " + command + "\nend tell"
}

type nativeScriptFailure struct {
	denied bool
}

func (nativeScriptFailure) Error() string { return "native terminal automation failed" }

func nativeAutomationError(ctx context.Context, err error, findingApp bool) error {
	if ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) {
		return resourcev2.NewError("UNAVAILABLE", "Native terminal launch timed out. Check macOS Automation prompts and retry.")
	}
	var failure nativeScriptFailure
	if errors.As(err, &failure) && failure.denied {
		return resourcev2.NewError("FORBIDDEN", "macOS denied Automation access. Allow Omniview to control the selected terminal in System Settings > Privacy & Security > Automation, then retry.")
	}
	if findingApp {
		return resourcev2.NewError("UNAVAILABLE", "The selected terminal application is unavailable. Install it or choose Terminal in Settings > Terminal.")
	}
	return resourcev2.NewError("UNAVAILABLE", "Cannot open a fresh native terminal window. Check the selected application and macOS Automation permissions, then retry.")
}

// nativeApplicationPath uses the system app registry rather than Apple Events,
// Spotlight indexing, guessed installation paths, or a Swift runtime dependency.
func nativeApplicationPath(ctx context.Context, bundleID string) (string, error) {
	if bundleID != "com.apple.Terminal" && bundleID != "com.googlecode.iterm2" {
		return "", nativeScriptFailure{}
	}
	script := "ObjC.import('AppKit');\n" +
		"const appURL = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(" + strconv.Quote(bundleID) + ");\n" +
		"if (appURL.isNil()) { throw new Error('Application unavailable'); }\n" +
		"ObjC.unwrap(appURL.path);"
	output, err := runNativeScript(ctx, "JavaScript", script)
	if err != nil {
		return "", err
	}
	path := strings.TrimSuffix(output, "\n")
	info, err := os.Stat(path)
	if err != nil || !filepath.IsAbs(path) || !info.IsDir() {
		return "", nativeScriptFailure{}
	}
	return path, nil
}

func runNativeAppleScript(ctx context.Context, script string) (string, error) {
	return runNativeScript(ctx, "AppleScript", script)
}

// Discard bounded diagnostics after detecting the known Automation denial.
// Diagnostics may contain command details and must never become a path or error.
func runNativeScript(ctx context.Context, language, script string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "/usr/bin/osascript", "-l", language, "-")
	cmd.Stdin = strings.NewReader(script)
	cmd.WaitDelay = time.Second
	var output, diagnostics nativeScriptOutput
	cmd.Stdout = &output
	cmd.Stderr = &diagnostics
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", nativeScriptFailure{denied: strings.Contains(diagnostics.text.String(), "-1743") || strings.Contains(diagnostics.text.String(), "not authorized")}
	}
	return output.text.String(), nil
}

type nativeScriptOutput struct {
	text strings.Builder
}

func (o *nativeScriptOutput) Write(data []byte) (int, error) {
	const maximum = 16 << 10
	if remaining := maximum - o.text.Len(); remaining > 0 {
		_, _ = o.text.Write(data[:min(len(data), remaining)])
	}
	return len(data), nil
}
