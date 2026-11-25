//go:build !windows

package terminal

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// probeTimeout bounds the question to a bash of which version it is.
const probeTimeout = 2 * time.Second

// bashSkip says why the integration does not go into the bash at path, or nothing when it does: the script needs bash 4.1
// (a descriptor held in a variable), and macOS's system bash is 3.2.
func (m *Manager) bashSkip(path string) IntegrationReason {
	major, minor, err := m.bashVersion(path)
	switch {
	case err != nil:
		return SkipBashVersionUnknown
	case major < 4 || (major == 4 && minor < 1):
		return SkipBashTooOld
	}
	return ""
}

// probeBashVersion asks the bash at path which version it is. It runs the bash as a non-interactive shell with an
// environment of its own (so that no BASH_ENV of the user's runs), and reads two numbers.
func probeBashVersion(path string) (int, int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, path, "-c", `printf '%s.%s' "${BASH_VERSINFO[0]}" "${BASH_VERSINFO[1]}"`)
	cmd.Env = []string{"PATH=/usr/bin:/bin"}
	out, err := cmd.Output()
	if err != nil {
		return 0, 0, fmt.Errorf("asking bash for its version: %w", err)
	}
	majorText, minorText, ok := strings.Cut(strings.TrimSpace(string(out)), ".")
	if !ok {
		return 0, 0, fmt.Errorf("bash said %q for its version", out)
	}
	major, errMajor := strconv.Atoi(majorText)
	minor, errMinor := strconv.Atoi(minorText)
	if errMajor != nil || errMinor != nil {
		return 0, 0, fmt.Errorf("bash said %q for its version", out)
	}
	return major, minor, nil
}
