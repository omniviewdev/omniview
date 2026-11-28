package plugin

import (
	"os"
	"runtime"
	"syscall"

	"golang.org/x/sys/unix"
)

func manifestChangeTime(info os.FileInfo) int64 {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st.Ctimespec.Nsec == 0 {
		return 0
	}
	return st.Ctimespec.Nano()
}

func manifestLocalStamp(f *os.File) bool {
	var fs unix.Statfs_t
	err := unix.Fstatfs(int(f.Fd()), &fs)
	runtime.KeepAlive(f)
	return err == nil && fs.Flags&unix.MNT_LOCAL != 0 && unix.ByteSliceToString(fs.Fstypename[:]) == "apfs"
}
