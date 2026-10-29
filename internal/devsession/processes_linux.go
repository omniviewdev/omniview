//go:build linux

package devsession

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"golang.org/x/sys/unix"
)

var linuxBoot struct {
	sync.Once
	id  string
	err error
}

func linuxStartIdentity(pid int) (string, error) {
	data, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		if errors.Is(err, os.ErrNotExist) || errors.Is(err, unix.ESRCH) {
			return "", ErrProcessGone
		}
		return "", fmt.Errorf("inspect process start: %w", err)
	}
	// comm is parenthesized and may itself contain spaces or parentheses.
	end := bytes.LastIndexByte(data, ')')
	if end < 0 {
		return "", fmt.Errorf("%w: malformed proc stat", ErrUnsupportedIdentity)
	}
	fields := bytes.Fields(data[end+1:])
	if len(fields) <= 19 {
		return "", fmt.Errorf("%w: incomplete proc stat", ErrUnsupportedIdentity)
	}
	if bytes.Equal(fields[0], []byte("Z")) || bytes.Equal(fields[0], []byte("X")) {
		return "", ErrProcessGone
	}
	if _, err := strconv.ParseUint(string(fields[19]), 10, 64); err != nil {
		return "", fmt.Errorf("%w: malformed process start", ErrUnsupportedIdentity)
	}
	linuxBoot.Do(func() {
		data, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
		linuxBoot.err = err
		linuxBoot.id = strings.TrimSpace(string(data))
	})
	if linuxBoot.err != nil || linuxBoot.id == "" {
		return "", fmt.Errorf("%w: Linux boot identity unavailable", ErrUnsupportedIdentity)
	}
	return "linux:" + linuxBoot.id + ":" + string(fields[19]), nil
}

func inspectProcess(pid int) (string, string, error) {
	before, err := linuxStartIdentity(pid)
	if err != nil {
		return "", "", err
	}
	executable, err := os.Readlink("/proc/" + strconv.Itoa(pid) + "/exe")
	if err != nil {
		if errors.Is(err, os.ErrNotExist) || errors.Is(err, unix.ESRCH) {
			return "", "", ErrProcessGone
		}
		return "", "", fmt.Errorf("inspect process executable: %w", err)
	}
	after, err := linuxStartIdentity(pid)
	if err != nil {
		return "", "", err
	}
	if before != after {
		return "", "", fmt.Errorf("%w: process changed during inspection", ErrOwnership)
	}
	return before, executable, nil
}

func terminateExactProcess(record devcontract.ProcessIdentity) error {
	// Pin the process before re-verifying. A later PID reuse cannot retarget fd.
	fd, err := unix.PidfdOpen(record.PID, 0)
	if err != nil {
		if errors.Is(err, unix.ESRCH) {
			return nil
		}
		if errors.Is(err, unix.ENOSYS) || errors.Is(err, unix.EINVAL) {
			return fmt.Errorf("%w: Linux pidfd unavailable", ErrUnsupportedIdentity)
		}
		return fmt.Errorf("open owned process handle: %w", err)
	}
	defer unix.Close(fd)
	if err := VerifyOwnedProcess(record, ownerOf(record)); err != nil {
		if errors.Is(err, ErrProcessGone) {
			return nil
		}
		return err
	}
	if err := unix.PidfdSendSignal(fd, unix.SIGTERM, nil, 0); err != nil {
		if errors.Is(err, unix.ESRCH) {
			return nil
		}
		return fmt.Errorf("terminate owned process: %w", err)
	}
	return nil
}
