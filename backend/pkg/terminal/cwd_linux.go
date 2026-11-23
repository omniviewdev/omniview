//go:build linux

package terminal

import (
	"os"
	"strconv"
)

// processCwd reads a process's current working directory from /proc/<pid>/cwd: one readlink, no
// process list, no polling.
func processCwd(pid int) (string, error) {
	return os.Readlink("/proc/" + strconv.Itoa(pid) + "/cwd")
}
