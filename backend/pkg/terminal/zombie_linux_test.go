//go:build linux

package terminal

import (
	"bytes"
	"os"
	"strconv"
)

// exitedUnreaped reports whether pid has exited and nobody has reaped it: /proc says state Z.
func exitedUnreaped(pid int) bool {
	stat, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return false
	}
	// The state is the field after the command name, which is in parentheses and may hold anything.
	end := bytes.LastIndexByte(stat, ')')
	return end >= 0 && end+2 < len(stat) && stat[end+2] == 'Z'
}
