//go:build linux

package terminal

import (
	"os"
	"strconv"
	"strings"
)

// processName names the foreground process group the way the kernel does: the name in
// /proc/<pgid>/comm, the executable's name cut to 15 bytes, of the process the group is named for (its
// leader). It is empty when the leader has gone while the group goes on: the group is still busy, it
// is only not named. One file read, no process list, no polling.
func processName(pgid int) string {
	raw, err := os.ReadFile("/proc/" + strconv.Itoa(pgid) + "/comm")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}
