package extensionpolicy

import (
	"unsafe"

	"golang.org/x/sys/unix"
)

func safeFilesystem(fd int) bool {
	var fs unix.Statfs_t
	if unix.Fstatfs(fd, &fs) != nil || fs.Flags&unix.MNT_LOCAL == 0 {
		return false
	}
	// Unlike POSIX ACL masks on Linux, Darwin extended allow entries can
	// grant access not reflected in st_mode. Refuse an extended ACL instead
	// of guessing about identity groups or inheritance. fgetattrlist(2)
	// returns an attrreference to a kauth_filesec with a 44-byte header.
	request := unix.Attrlist{Bitmapcount: unix.ATTR_BIT_MAP_COUNT, Commonattr: unix.ATTR_CMN_EXTENDED_SECURITY}
	var result struct {
		size, offset, length uint32
		header               [44]byte
	}
	_, _, errno := unix.Syscall6(unix.SYS_FGETATTRLIST, uintptr(fd), uintptr(unsafe.Pointer(&request)),
		uintptr(unsafe.Pointer(&result)), unsafe.Sizeof(result), unix.FSOPT_REPORT_FULLSIZE, 0)
	return errno == 0 && result.size <= uint32(unsafe.Sizeof(result)) &&
		(result.length == 0 || result.offset == 8 && result.length == uint32(len(result.header)))
}

func exchangeAt(fd int, a, b string) error {
	return unix.RenameatxNp(fd, a, fd, b, unix.RENAME_SWAP|unix.RENAME_NOFOLLOW_ANY)
}
