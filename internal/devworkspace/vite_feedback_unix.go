//go:build darwin || linux

package devworkspace

import (
	"fmt"
	"os"
	"runtime"
	"strconv"

	"golang.org/x/sys/unix"
)

func createFeedbackFile(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR|unix.O_NOFOLLOW, 0600)
}

func openFeedbackAuthorityFile(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
}

func feedbackFileIdentity(file *os.File) (viteFeedbackFileIdentity, error) {
	var stat unix.Stat_t
	err := unix.Fstat(int(file.Fd()), &stat)
	runtime.KeepAlive(file)
	if err != nil {
		return viteFeedbackFileIdentity{}, err
	}
	if stat.Mode&unix.S_IFMT != unix.S_IFREG || stat.Uid != uint32(os.Geteuid()) || stat.Mode&0777 != 0600 {
		return viteFeedbackFileIdentity{}, feedbackConflict("feedback handle is not a private current-user regular file")
	}
	return viteFeedbackFileIdentity{Volume: strconv.FormatUint(uint64(stat.Dev), 10), FileID: fmt.Sprintf("%032x", uint64(stat.Ino))}, nil
}

func syncFeedbackParent(path string) error { return syncDirectory(path) }
