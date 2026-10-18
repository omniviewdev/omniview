//go:build darwin

package devsession

import (
	"bytes"
	"errors"
	"fmt"
	"path/filepath"
	"strconv"
	"unsafe"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"golang.org/x/sys/unix"
)

func darwinStartIdentity(pid int) (string, error) {
	data, err := unix.SysctlRaw("kern.proc.pid", pid)
	if err != nil {
		if errors.Is(err, unix.ESRCH) {
			return "", ErrProcessGone
		}
		return "", fmt.Errorf("inspect process start: %w", err)
	}
	if len(data) == 0 {
		return "", ErrProcessGone
	}
	if len(data) != unix.SizeofKinfoProc {
		return "", fmt.Errorf("%w: unexpected Darwin process structure", ErrUnsupportedIdentity)
	}
	info := (*unix.KinfoProc)(unsafe.Pointer(&data[0]))
	if int(info.Proc.P_pid) != pid || info.Proc.P_stat == 5 {
		return "", ErrProcessGone
	}
	start := info.Proc.P_starttime
	if start.Sec <= 0 {
		return "", fmt.Errorf("%w: Darwin start time unavailable", ErrUnsupportedIdentity)
	}
	return "darwin:" + strconv.FormatInt(start.Sec, 10) + ":" + strconv.FormatInt(int64(start.Usec), 10), nil
}

func inspectProcess(pid int) (string, string, error) {
	before, err := darwinStartIdentity(pid)
	if err != nil {
		return "", "", err
	}
	// KERN_PROCARGS2 begins with argc (int32), then the kernel's executable
	// path. Never substitute p_comm, argv[0], ps output or a filename match.
	args, err := unix.SysctlRaw("kern.procargs2", pid)
	if err != nil {
		return "", "", darwinExecutableInspectionError(pid, before, err)
	}
	if len(args) < 5 {
		return "", "", fmt.Errorf("%w: Darwin executable path unavailable", ErrUnsupportedIdentity)
	}
	end := bytes.IndexByte(args[4:], 0)
	if end <= 0 {
		return "", "", fmt.Errorf("%w: malformed Darwin executable path", ErrUnsupportedIdentity)
	}
	executable := string(args[4 : 4+end])
	if !filepath.IsAbs(executable) {
		return "", "", fmt.Errorf("%w: Darwin executable path is not absolute", ErrUnsupportedIdentity)
	}
	after, err := darwinStartIdentity(pid)
	if err != nil {
		return "", "", err
	}
	if before != after {
		return "", "", fmt.Errorf("%w: process changed during inspection", ErrOwnership)
	}
	return before, filepath.Clean(executable), nil
}

func darwinExecutableInspectionError(pid int, before string, queryErr error) error {
	if errors.Is(queryErr, unix.ESRCH) {
		return ErrProcessGone
	}
	// A process can exit after the first kinfo sample but before PROCARGS2,
	// which Darwin may report as EINVAL. The errno alone is never exit proof.
	after, err := darwinStartIdentity(pid)
	if errors.Is(err, ErrProcessGone) {
		return ErrProcessGone
	}
	if err == nil && after != before {
		return fmt.Errorf("%w: process changed during executable inspection", ErrOwnership)
	}
	// Preserve live/unknown inspection failures, especially permission refusal.
	return fmt.Errorf("inspect process executable: %w", queryErr)
}

func terminateExactProcess(devcontract.ProcessIdentity) error {
	return fmt.Errorf("%w: Darwin has no supported PID-stable detached signal handle; supervisor-owned lifecycle required", ErrUnsupportedIdentity)
}
