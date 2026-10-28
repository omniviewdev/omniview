//go:build linux

package devworkspace

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

func detachSupervisor(command *exec.Cmd) { command.SysProcAttr = &syscall.SysProcAttr{Setsid: true} }
func prepareOwnedCommand(command *exec.Cmd) {
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}
func attachOwnedCommand(child *ownedChild) error {
	child.stopTree = func(force bool) error {
		child.mu.Lock()
		defer child.mu.Unlock()
		if child.command.ProcessState != nil {
			return nil
		}
		signal := unix.SIGTERM
		if force {
			signal = unix.SIGKILL
		}
		err := unix.Kill(-child.command.Process.Pid, signal)
		if errors.Is(err, unix.ESRCH) {
			return nil
		}
		return err
	}
	return nil
}
func waitOwnedCommand(child *ownedChild) error {
	return waitLinuxOwnedCommand(child, os.DirFS("/proc"))
}

func waitLinuxOwnedCommand(child *ownedChild, proc fs.FS) error {
	var information unix.Siginfo
	for {
		err := unix.Waitid(unix.P_PID, child.command.Process.Pid, &information, unix.WEXITED|unix.WNOWAIT, nil)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		if err != nil {
			return errors.Join(errOwnedCommandUncertain, fmt.Errorf("observe owned-child exit: %w", err))
		}
		break
	}
	child.mu.Lock()
	defer child.mu.Unlock()
	if err := signalUnreapedGroup(child.command.Process.Pid, unix.SIGKILL); err != nil {
		return errors.Join(errOwnedCommandUncertain, fmt.Errorf("terminate unreaped owned group: %w", err))
	}
	if err := waitLinuxUnreapedGroupExit(child.command.Process.Pid, proc, 5*time.Second); err != nil {
		// The unreaped leader pins this exact PGID. Keep both its Cmd and the
		// writer lifetime pending when descendants might still produce output.
		return errors.Join(errOwnedCommandUncertain, err)
	}
	waitErr := child.command.Wait()
	child.disposed = child.command.ProcessState != nil
	return waitErr
}

func signalUnreapedGroup(pgid int, signal syscall.Signal) error {
	err := unix.Kill(-pgid, signal)
	if errors.Is(err, unix.ESRCH) {
		return nil
	}
	return err
}

func waitUnreapedGroupExit(pgid int) error {
	return waitLinuxUnreapedGroupExit(pgid, os.DirFS("/proc"), 5*time.Second)
}

func waitLinuxUnreapedGroupExit(pgid int, proc fs.FS, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		live, err := inspectLinuxUnreapedGroup(proc, pgid)
		if err != nil {
			return fmt.Errorf("observe unreaped owned group exit: %w", err)
		}
		if !live {
			return nil
		}
		if !time.Now().Before(deadline) {
			return fmt.Errorf("owned group still has live members after termination")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func inspectLinuxUnreapedGroup(proc fs.FS, pgid int) (bool, error) {
	if err := verifyLinuxProcView(proc); err != nil {
		return false, err
	}
	entries, err := fs.ReadDir(proc, ".")
	if err != nil {
		return false, err
	}
	leader := false
	live := false
	for _, entry := range entries {
		name := entry.Name()
		if name == "" || strings.IndexFunc(name, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
			continue
		}
		pid, err := strconv.Atoi(name)
		if err != nil || pid <= 0 {
			return false, fmt.Errorf("invalid proc process directory %q", name)
		}
		data, err := fs.ReadFile(proc, name+"/stat")
		if errors.Is(err, fs.ErrNotExist) || errors.Is(err, unix.ESRCH) {
			// Tasks can disappear between directory enumeration and stat.
			continue
		}
		if err != nil {
			return false, fmt.Errorf("inspect proc process %d: %w", pid, err)
		}
		group, memberLive, err := parseLinuxGroupMember(data, pid)
		if err != nil {
			return false, err
		}
		if pid == pgid {
			if group != pgid {
				return false, fmt.Errorf("retained owned group leader changed process groups")
			}
			leader = true
		}
		if group == pgid && memberLive {
			live = true
		}
	}
	if !leader {
		// An empty or restricted proc view is not evidence of disposal: this
		// exact leader must remain visible until our Cmd is finally reaped.
		return false, fmt.Errorf("retained owned group leader is absent from procfs")
	}
	return live, nil
}

func parseLinuxGroupMember(data []byte, pid int) (int, bool, error) {
	malformed := func() (int, bool, error) {
		return 0, false, fmt.Errorf("malformed proc stat for process %d", pid)
	}
	// As in devsession's Linux identity parser, comm may contain spaces,
	// newlines and parentheses; only its last ')' ends the second field.
	open := bytes.IndexByte(data, '(')
	end := bytes.LastIndexByte(data, ')')
	if open < 1 || data[open-1] != ' ' || end <= open || end+1 >= len(data) || data[end+1] != ' ' {
		return malformed()
	}
	recordPID, err := strconv.Atoi(string(bytes.TrimSpace(data[:open])))
	if err != nil || recordPID != pid {
		return malformed()
	}
	fields := bytes.Fields(data[end+1:])
	if len(fields) < 3 || len(fields[0]) != 1 || !strings.ContainsRune("RSDZTtXxKWPI", rune(fields[0][0])) {
		return malformed()
	}
	parent, err := strconv.Atoi(string(fields[1]))
	if err != nil || parent < 0 {
		return malformed()
	}
	group, err := strconv.Atoi(string(fields[2]))
	if err != nil || group < 0 {
		return malformed()
	}
	state := fields[0][0]
	return group, state != 'Z' && state != 'X' && state != 'x', nil
}

func verifyLinuxProcView(proc fs.FS) error {
	data, err := fs.ReadFile(proc, "self/mountinfo")
	if err != nil {
		return fmt.Errorf("inspect proc mount visibility: %w", err)
	}
	found := false
	for _, line := range bytes.Split(data, []byte{'\n'}) {
		if len(line) == 0 {
			continue
		}
		fields := bytes.Fields(line)
		separator := 6
		for separator < len(fields) && !bytes.Equal(fields[separator], []byte("-")) {
			separator++
		}
		if separator+3 >= len(fields) {
			return fmt.Errorf("malformed proc mountinfo")
		}
		if !bytes.Equal(fields[4], []byte("/proc")) {
			continue
		}
		if !bytes.Equal(fields[3], []byte("/")) || !bytes.Equal(fields[separator+1], []byte("proc")) {
			return fmt.Errorf("proc mount does not expose the complete process view")
		}
		for _, option := range bytes.Split(fields[separator+3], []byte{','}) {
			if bytes.HasPrefix(option, []byte("hidepid=")) && !bytes.Equal(option, []byte("hidepid=0")) && !bytes.Equal(option, []byte("hidepid=off")) {
				return fmt.Errorf("filtered proc mount cannot prove owned group disposal")
			}
		}
		found = true
	}
	if !found {
		return fmt.Errorf("complete proc mount is absent from mountinfo")
	}
	return nil
}
