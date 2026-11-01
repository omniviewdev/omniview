package categories

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"math"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/omniviewdev/plugin-sdk/settings"
)

var goVersionOutput = regexp.MustCompile(`^go version (go[0-9]+\.[0-9]+(?:\.[0-9]+)?(?:[a-z]+[0-9]+)?) [a-z0-9]+/[a-z0-9]+\s*$`)

// cappedOutput drains output without retaining unbounded or potentially sensitive bytes.
type cappedOutput struct {
	data     []byte
	overflow bool
}

func (w *cappedOutput) Write(p []byte) (int, error) {
	n := len(p)
	if len(p) > 256-len(w.data) {
		w.overflow = true
	}
	if remaining := 256 - len(w.data); remaining > 0 {
		if len(p) > remaining {
			p = p[:remaining]
		}
		w.data = append(w.data, p...)
	}
	return n, nil
}

func validateGoExecutable(value any) settings.ValidationResult {
	fail := func(code, message string) settings.ValidationResult {
		return settings.ValidationResult{Code: code, Message: message}
	}
	path, ok := value.(string)
	if !ok {
		return fail("type", "Select a Go executable path.")
	}
	if path == "" {
		return settings.ValidationResult{Valid: true, Code: "automatic", Message: "Automatic discovery enabled. Go will be located in PATH or common installation folders when needed."}
	}
	info, err := os.Stat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return fail("not_file", "Select an existing Go executable file.")
	}
	if err != nil {
		return fail("unreadable", "Could not access the selected file. Check its permissions.")
	}
	if !info.Mode().IsRegular() {
		return fail("not_file", "Select an existing Go executable file.")
	}
	if runtime.GOOS != "windows" && info.Mode().Perm()&0111 == 0 {
		return fail("not_executable", "Selected file is not executable. Select the Go binary or fix its permissions.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "version")
	cmd.WaitDelay = 100 * time.Millisecond
	cmd.Env = append(os.Environ(), "GOTOOLCHAIN=local", "GOWORK=off")
	output := &cappedOutput{}
	cmd.Stdout = output
	cmd.Stderr = io.Discard
	err = cmd.Run()
	if ctx.Err() != nil {
		return fail("timeout", "Go version check timed out after five seconds. Select a working Go installation.")
	}
	if err != nil {
		return fail("execution", "Could not run Go version check. Select a working Go executable.")
	}
	matches := goVersionOutput.FindStringSubmatch(string(output.data))
	if len(matches) != 2 || output.overflow {
		return fail("unexpected_output", "Selected executable did not return a recognized Go version.")
	}
	return settings.ValidationResult{Valid: true, Code: "go_version", Message: "Go executable verified: " + strings.TrimPrefix(matches[1], "go") + "."}
}

// validatePprofPort accepts JSON numbers without truncating fractional ports.
func validatePprofPort(value any) settings.ValidationResult {
	var port float64
	switch v := value.(type) {
	case int:
		port = float64(v)
	case float64:
		port = v
	default:
		return settings.ValidationResult{
			Valid: false, Code: "port_type", Message: "Enter a whole-number port from 0 to 65535.",
		}
	}
	if math.IsNaN(port) || math.IsInf(port, 0) || math.Trunc(port) != port || port < 0 || port > 65535 {
		return settings.ValidationResult{
			Valid: false, Code: "port_range", Message: "Enter a whole-number port from 0 to 65535.",
		}
	}
	return settings.ValidationResult{Valid: true, Code: "port", Message: "Port is valid."}
}
