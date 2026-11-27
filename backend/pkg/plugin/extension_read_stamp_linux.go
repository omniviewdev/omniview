package plugin

import (
	"math"
	"os"
	"runtime"
	"syscall"

	"golang.org/x/sys/unix"
)

func manifestChangeTime(info os.FileInfo) int64 {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st.Ctim.Nsec == 0 {
		return 0
	}
	return st.Ctim.Nano()
}

func manifestLocalStamp(f *os.File) bool {
	var fs unix.Statfs_t
	err := unix.Fstatfs(int(f.Fd()), &fs)
	runtime.KeepAlive(f)
	if err != nil {
		return false
	}
	// Linux exposes a 32-bit superblock magic through a potentially signed, native-width field.
	type superblockMagic int64
	switch superblockMagic(fs.Type) & math.MaxUint32 {
	case unix.EXT4_SUPER_MAGIC, unix.XFS_SUPER_MAGIC, unix.BTRFS_SUPER_MAGIC, unix.TMPFS_MAGIC:
		return true
	}
	return false
}
