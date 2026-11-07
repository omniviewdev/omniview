//go:build darwin || linux

package devsession

import (
	"os"
	"runtime"

	"golang.org/x/sys/unix"
)

func createPrivateDirectoryAt(parent *os.File, name string) (*os.File, error) {
	err := unix.Mkdirat(int(parent.Fd()), name, 0700)
	runtime.KeepAlive(parent)
	if err != nil {
		return nil, &os.PathError{Op: "mkdir", Path: name, Err: err}
	}
	fd, err := unix.Openat(int(parent.Fd()), name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	runtime.KeepAlive(parent)
	if err != nil {
		return nil, &os.PathError{Op: "open", Path: name, Err: err}
	}
	return os.NewFile(uintptr(fd), name), nil
}
