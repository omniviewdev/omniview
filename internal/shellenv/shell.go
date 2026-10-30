// Package shellenv shares login-shell selection between settings and terminals.
package shellenv

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// Default returns an installed shell, consulting the account when SHELL is absent.
func Default() string {
	if runtime.GOOS == "windows" {
		return "powershell.exe"
	}
	return detect(os.Getenv("SHELL"), accountShell, exec.LookPath)
}

func detect(environment string, account func() string, lookup func(string) (string, error)) string {
	candidates := []string{environment}
	if environment == "" {
		candidates = append(candidates, account())
	}
	candidates = append(candidates, "/bin/zsh", "/bin/bash", "/bin/sh")
	for _, candidate := range candidates {
		if candidate != "" {
			if path, err := lookup(candidate); err == nil {
				return path
			}
		}
	}
	return "/bin/sh"
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

// Resolve keeps explicit paths and arguments; unsupported shells return an error.
func Resolve(command []string) (string, []string, error) {
	var shell string
	var extra []string
	if len(command) > 0 && command[0] != "" {
		shell = command[0]
		extra = command[1:]
	} else {
		shell = Default()
	}
	path, err := exec.LookPath(shell)
	if err != nil {
		return "", nil, fmt.Errorf("shell executable unavailable: %w", err)
	}
	var args []string
	switch shellName(path) {
	case "zsh", "bash", "fish", "sh", "dash", "ksh", "nu", "xonsh":
		args = []string{"-i", "-l"}
	case "csh", "tcsh":
		// C shells require -l to be their only option.
		args = []string{"-l"}
	case "pwsh", "powershell", "pwsh.exe", "powershell.exe":
		args = []string{"-Login", "-NoLogo"}
	case "cmd.exe":
		if runtime.GOOS != "windows" {
			return "", nil, fmt.Errorf("unsupported terminal shell %q", shell)
		}
	default:
		return "", nil, fmt.Errorf("unsupported terminal shell %q", shell)
	}
	return path, append(args, extra...), nil
}

// shellName recognizes custom symlinks without replacing the selected executable.
func shellName(path string) string {
	if target, err := filepath.EvalSymlinks(path); err == nil {
		return filepath.Base(target)
	}
	return filepath.Base(path)
}
