//go:build darwin

package terminal

import (
	"bytes"

	"golang.org/x/sys/unix"
)

// zombie is the P_stat of a process that has exited and has not been reaped yet.
const zombie = 5

// processName names the foreground process group the way the system does: the name of the executable
// of the process the group is named for (its leader), cut to 16 bytes by the kernel. The leader of a
// pipeline's group can exit while the group goes on; then the first live member names it. One sysctl,
// no process list, no polling.
func processName(pgid int) string {
	if proc, err := unix.SysctlKinfoProc("kern.proc.pid", pgid); err == nil && proc.Proc.P_stat != zombie {
		return commName(proc.Proc.P_comm[:])
	}
	members, err := unix.SysctlKinfoProcSlice("kern.proc.pgrp", pgid)
	if err != nil {
		return ""
	}
	for i := range members {
		if members[i].Proc.P_stat != zombie {
			return commName(members[i].Proc.P_comm[:])
		}
	}
	return ""
}

func commName(raw []byte) string {
	if end := bytes.IndexByte(raw, 0); end >= 0 {
		raw = raw[:end]
	}
	return string(raw)
}
