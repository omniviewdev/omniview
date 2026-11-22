//go:build !windows && !darwin && !linux

package terminal

// processName is empty on a platform where the host has no cheap way to name a process group: the
// terminal is still known to be busy, the process is only not named.
func processName(int) string { return "" }
