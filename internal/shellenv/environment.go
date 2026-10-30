package shellenv

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

const environmentMarker = "\x00OMNIVIEW_LOGIN_ENV\x00"

// Restore imports the interactive login environment before any tools start.
// Runtime identity and filesystem isolation always remain owned by the host.
func Restore(ctx context.Context) error {
	if runtime.GOOS != "darwin" {
		return nil
	}
	base := os.Environ()
	environment, err := Capture(ctx, base)
	if err != nil {
		return err
	}
	for _, entry := range environment {
		key, value, _ := strings.Cut(entry, "=")
		if err := os.Setenv(key, value); err != nil {
			return fmt.Errorf("publish login environment: %w", err)
		}
	}
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
	switch shellName(shell) {
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
