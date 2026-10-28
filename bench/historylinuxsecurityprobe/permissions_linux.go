//go:build linux

package main

import (
	"os"
	"syscall"
)

func setPrivateUmask() { syscall.Umask(0077) }
func owned(info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && stat.Uid == uint32(os.Geteuid())
}
