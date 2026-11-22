//go:build darwin

package terminal

import (
	"bytes"
	"errors"
	"runtime"
	"syscall"
	"unsafe"
)

const (
	// sysProcInfo is SYS_proc_info of <sys/syscall.h>, the system call that libproc's proc_pidinfo makes.
	// It is called directly to keep this package free of cgo; the number has not changed since macOS 10.5.
	sysProcInfo = 336
	// procInfoCallPidinfo and procPidVnodePathInfo are PROC_INFO_CALL_PIDINFO and PROC_PIDVNODEPATHINFO of
	// <sys/proc_info.h>.
	procInfoCallPidinfo  = 2
	procPidVnodePathInfo = 9
	// A proc_vnodepathinfo is two vnode_info_path, the current and the root directory; a vnode_info_path is
	// a 152-byte vnode_info followed by a MAXPATHLEN (1,024) byte path.
	vnodeInfoSize     = 152
	vnodePathLen      = 1024
	vnodePathInfoSize = 2 * (vnodeInfoSize + vnodePathLen)
)

// processCwd reads a process's current working directory the way proc_pidinfo(PROC_PIDVNODEPATHINFO)
// does, through the proc_info system call that libproc wraps: one call, no process list, no polling,
// no cgo.
func processCwd(pid int) (string, error) {
	buf := make([]byte, vnodePathInfoSize)
	n, _, errno := syscall.Syscall6(sysProcInfo, procInfoCallPidinfo, uintptr(pid), procPidVnodePathInfo, 0,
		uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	runtime.KeepAlive(buf)
	if errno != 0 {
		return "", errno
	}
	if int(n) < vnodeInfoSize+1 {
		return "", errors.New("the system gave a short answer")
	}
	path := buf[vnodeInfoSize : vnodeInfoSize+vnodePathLen]
	if end := bytes.IndexByte(path, 0); end >= 0 {
		path = path[:end]
	}
	if len(path) == 0 {
		return "", errors.New("the system gave no directory")
	}
	return string(path), nil
}
