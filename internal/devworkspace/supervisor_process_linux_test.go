//go:build linux

package devworkspace

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"testing/fstest"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"golang.org/x/sys/unix"
)

func TestLinuxGroupMemberStat(t *testing.T) {
	for _, test := range []struct {
		name    string
		stat    string
		group   int
		live    bool
		invalid bool
	}{
		{name: "running", stat: "123 (worker) R 1 100 0", group: 100, live: true},
		{name: "uninterruptible writer", stat: "123 (worker) D 1 100 0", group: 100, live: true},
		{name: "stopped", stat: "123 (worker) T 1 100 0", group: 100, live: true},
		{name: "idle", stat: "123 (worker) I 1 100 0", group: 100, live: true},
		{name: "zombie", stat: "123 (worker) Z 1 100 0", group: 100},
		{name: "dead", stat: "123 (worker) X 1 100 0", group: 100},
		{name: "legacy dead", stat: "123 (worker) x 1 100 0", group: 100},
		{name: "parenthesized comm", stat: "123 (worker ) (with spaces\nand parens)) S 1 100 0", group: 100, live: true},
		{name: "kernel group", stat: "123 (worker) S 0 0 0", live: true},
		{name: "missing comm", stat: "123 worker S 1 100", invalid: true},
		{name: "missing pid delimiter", stat: "123(worker) S 1 100", invalid: true},
		{name: "missing state delimiter", stat: "123 (worker)S 1 100", invalid: true},
		{name: "missing group", stat: "123 (worker) S 1", invalid: true},
		{name: "wrong pid", stat: "124 (worker) S 1 100", invalid: true},
		{name: "malformed pid", stat: "pid (worker) S 1 100", invalid: true},
		{name: "malformed parent", stat: "123 (worker) S parent 100", invalid: true},
		{name: "negative parent", stat: "123 (worker) S -1 100", invalid: true},
		{name: "malformed group", stat: "123 (worker) S 1 group", invalid: true},
		{name: "negative group", stat: "123 (worker) S 1 -1", invalid: true},
		{name: "overflow group", stat: "123 (worker) S 1 9999999999999999999999999", invalid: true},
		{name: "malformed state", stat: "123 (worker) ZZ 1 100", invalid: true},
		{name: "unknown state", stat: "123 (worker) ? 1 100", invalid: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			group, live, err := parseLinuxGroupMember([]byte(test.stat), 123)
			if test.invalid {
				if err == nil {
					t.Fatal("malformed proc record could attest group disposal")
				}
				return
			}
			if err != nil || group != test.group || live != test.live {
				t.Fatalf("group=%d live=%t error=%v, want group=%d live=%t", group, live, err, test.group, test.live)
			}
		})
	}
}

type linuxProcReadFailure struct {
	fs.FS
	path string
	err  error
}

func (p linuxProcReadFailure) Open(name string) (fs.File, error) {
	if name == p.path {
		return nil, &fs.PathError{Op: "open", Path: name, Err: p.err}
	}
	return p.FS.Open(name)
}

const linuxUnfilteredProcMount = "42 23 0:5 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw\n"

func TestLinuxProcVisibility(t *testing.T) {
	for _, test := range []struct {
		name      string
		mountinfo string
		uncertain bool
	}{
		{name: "complete", mountinfo: linuxUnfilteredProcMount},
		{name: "explicit unfiltered", mountinfo: "42 23 0:5 / /proc rw - proc proc rw,hidepid=0\n"},
		{name: "pid subset", mountinfo: "42 23 0:5 / /proc rw - proc proc rw,subset=pid\n"},
		{name: "hidden processes", mountinfo: "42 23 0:5 / /proc rw - proc proc rw,hidepid=2\n", uncertain: true},
		{name: "ptrace filtered", mountinfo: "42 23 0:5 / /proc rw - proc proc rw,hidepid=ptraceable\n", uncertain: true},
		{name: "restricted despite group override", mountinfo: "42 23 0:5 / /proc rw - proc proc rw,hidepid=1,gid=1000\n", uncertain: true},
		{name: "non proc mount", mountinfo: "42 23 0:5 / /proc rw - tmpfs tmpfs rw\n", uncertain: true},
		{name: "partial bind", mountinfo: "42 23 0:5 /123 /proc rw - proc proc rw\n", uncertain: true},
		{name: "missing proc mount", mountinfo: "42 23 0:5 / /elsewhere rw - proc proc rw\n", uncertain: true},
		{name: "empty", uncertain: true},
		{name: "truncated", mountinfo: "42 23 0:5 / /proc rw - proc\n", uncertain: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			proc := fstest.MapFS{"self/mountinfo": &fstest.MapFile{Data: []byte(test.mountinfo)}}
			err := verifyLinuxProcView(proc)
			if (err != nil) != test.uncertain {
				t.Fatalf("visibility uncertainty=%t, error=%v", test.uncertain, err)
			}
		})
	}
}

func TestLinuxUnreapedGroupInspection(t *testing.T) {
	for _, test := range []struct {
		name       string
		leader     string
		member     string
		failedPath string
		readErr    error
		live       bool
		uncertain  bool
	}{
		{name: "only unreaped leader"},
		{name: "unrelated live process", member: "200 (other) R 1 200"},
		{name: "live owned writer", member: "200 (writer) D 100 100", live: true},
		{name: "stopped owned writer", member: "200 (writer) T 100 100", live: true},
		{name: "zombie descendant", member: "200 (writer) Z 1 100"},
		{name: "dead descendant", member: "200 (writer) X 1 100"},
		{name: "disappearing process", member: "200 (writer) R 1 100", failedPath: "200/stat", readErr: fs.ErrNotExist},
		{name: "disappearing task", member: "200 (writer) R 1 100", failedPath: "200/stat", readErr: unix.ESRCH},
		{name: "permission uncertainty", member: "200 (writer) R 1 100", failedPath: "200/stat", readErr: fs.ErrPermission, uncertain: true},
		{name: "query uncertainty", member: "200 (writer) R 1 100", failedPath: "200/stat", readErr: unix.EIO, uncertain: true},
		{name: "directory uncertainty", failedPath: ".", readErr: fs.ErrPermission, uncertain: true},
		{name: "mount query uncertainty", failedPath: "self/mountinfo", readErr: fs.ErrPermission, uncertain: true},
		{name: "malformed possible member", member: "200 (writer) D 1 ???", uncertain: true},
		{name: "missing pinned leader", failedPath: "100/stat", readErr: fs.ErrNotExist, uncertain: true},
		{name: "live leader", leader: "100 (leader) R 1 100", live: true},
		{name: "leader group changed", leader: "100 (leader) Z 1 99", uncertain: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			leader := test.leader
			if leader == "" {
				leader = "100 (leader) Z 1 100"
			}
			entries := fstest.MapFS{
				"100/stat":              &fstest.MapFile{Data: []byte(leader)},
				"sys/kernel/irrelevant": &fstest.MapFile{Data: []byte("not a process")},
				"self/mountinfo":        &fstest.MapFile{Data: []byte(linuxUnfilteredProcMount)},
			}
			if test.member != "" {
				entries["200/stat"] = &fstest.MapFile{Data: []byte(test.member)}
			}
			var proc fs.FS = entries
			if test.readErr != nil {
				proc = linuxProcReadFailure{FS: proc, path: test.failedPath, err: test.readErr}
			}
			live, err := inspectLinuxUnreapedGroup(proc, 100)
			if test.uncertain {
				if err == nil {
					t.Fatal("incomplete proc inspection attested group disposal")
				}
				return
			}
			if err != nil || live != test.live {
				t.Fatalf("live=%t error=%v, want live=%t", live, err, test.live)
			}
		})
	}
}

func TestLinuxUnreapedGroupProofIsBounded(t *testing.T) {
	proc := fstest.MapFS{
		"100/stat":       &fstest.MapFile{Data: []byte("100 (leader) Z 1 100")},
		"200/stat":       &fstest.MapFile{Data: []byte("200 (writer) D 1 100")},
		"self/mountinfo": &fstest.MapFile{Data: []byte(linuxUnfilteredProcMount)},
	}
	if err := waitLinuxUnreapedGroupExit(100, proc, 0); err == nil {
		t.Fatal("live uninterruptible writer was considered terminal")
	}
	proc["200/stat"].Data = []byte("200 (writer) Z 1 100")
	if err := waitLinuxUnreapedGroupExit(100, proc, 0); err != nil {
		t.Fatalf("dead descendant prevented proven disposal: %v", err)
	}
}

func TestLinuxOwnedChildFixture(t *testing.T) {
	mode := os.Getenv("OMNIVIEW_LINUX_OWNED_FIXTURE")
	if mode == "" {
		return
	}
	if mode == "descendant" {
		pidFile := os.Getenv("OMNIVIEW_LINUX_DESCENDANT_PID")
		if err := os.WriteFile(pidFile+".tmp", []byte(strconv.Itoa(os.Getpid())), 0600); err != nil {
			os.Exit(80)
		}
		if err := os.Rename(pidFile+".tmp", pidFile); err != nil {
			os.Exit(82)
		}
		for {
			time.Sleep(time.Hour)
		}
	}
	command := exec.Command(os.Args[0], "-test.run=^TestLinuxOwnedChildFixture$")
	command.Env = append(os.Environ(), "OMNIVIEW_LINUX_OWNED_FIXTURE=descendant")
	// Nil streams redirect the descendant to /dev/null. Cmd.Wait on its leader
	// therefore cannot accidentally join it through inherited stream pipes.
	if err := command.Start(); err != nil {
		os.Exit(81)
	}
	for {
		if _, err := os.Stat(os.Getenv("OMNIVIEW_LINUX_LEADER_EXIT")); err == nil {
			os.Exit(17)
		}
		time.Sleep(time.Millisecond)
	}
}

func linuxOwnedFixtureCommand(t *testing.T) (*exec.Cmd, devsession.ProcessOwner, string, string) {
	t.Helper()
	root := t.TempDir()
	pidFile := filepath.Join(root, "descendant.pid")
	exitFile := filepath.Join(root, "exit")
	command := exec.Command(os.Args[0], "-test.run=^TestLinuxOwnedChildFixture$")
	command.Dir = root
	command.Env = append(os.Environ(), "OMNIVIEW_LINUX_OWNED_FIXTURE=leader", "OMNIVIEW_LINUX_DESCENDANT_PID="+pidFile, "OMNIVIEW_LINUX_LEADER_EXIT="+exitFile)
	owner := devsession.ProcessOwner{WorkspaceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6", Generation: NewGeneration(), Role: "build", Source: root}
	return command, owner, pidFile, exitFile
}

func linuxFixtureDescendant(t *testing.T, pidFile string, owner devsession.ProcessOwner) devcontract.ProcessIdentity {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(pidFile)
		if err == nil {
			pid, err := strconv.Atoi(string(data))
			if err != nil {
				t.Fatal(err)
			}
			identity, err := devsession.CaptureProcess(pid, owner)
			if err != nil {
				t.Fatal(err)
			}
			return identity
		}
		if !errors.Is(err, os.ErrNotExist) {
			t.Fatal(err)
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("redirected-stream descendant did not start")
	return devcontract.ProcessIdentity{}
}

func TestLinuxOwnedChildFinishesOnlyAfterRedirectedDescendantExit(t *testing.T) {
	command, owner, pidFile, exitFile := linuxOwnedFixtureCommand(t)
	descendants := make(chan devcontract.ProcessIdentity, 1)
	finished := make(chan error, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	child, err := startOwnedChildCommand(ctx, command, owner, func() error {
		var descendant devcontract.ProcessIdentity
		select {
		case descendant = <-descendants:
		default:
			return errors.New("writer finished before its descendant was captured")
		}
		err := devsession.VerifyOwnedProcess(descendant, owner)
		if !errors.Is(err, devsession.ErrProcessGone) {
			err = fmt.Errorf("writer finished before redirected descendant exit: %v", err)
			finished <- err
			return err
		}
		finished <- nil
		return nil
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	defer child.stop(context.Background())
	descendants <- linuxFixtureDescendant(t, pidFile, owner)
	if err := os.WriteFile(exitFile, nil, 0600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-child.done:
	case <-ctx.Done():
		t.Fatal("owned subtree disposal did not finish")
	}
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal(err)
		}
	default:
		t.Fatalf("proven terminal writer was not finished: %v", child.failure())
	}
}

func TestLinuxUncertainGroupRetainsUnreapedCommand(t *testing.T) {
	command, owner, pidFile, exitFile := linuxOwnedFixtureCommand(t)
	prepareOwnedCommand(command)
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	// This retained Cmd is the sole process owner, including test cleanup.
	defer func() {
		if command.ProcessState != nil {
			return
		}
		_ = signalUnreapedGroup(command.Process.Pid, unix.SIGKILL)
		if err := waitUnreapedGroupExit(command.Process.Pid); err != nil {
			t.Errorf("test subtree disposal is unproven: %v", err)
			return
		}
		_ = command.Wait()
	}()
	identity, err := devsession.CaptureProcess(command.Process.Pid, owner)
	if err != nil {
		t.Fatal(err)
	}
	_ = linuxFixtureDescendant(t, pidFile, owner)
	if err := os.WriteFile(exitFile, nil, 0600); err != nil {
		t.Fatal(err)
	}
	child := &ownedChild{command: command, identity: identity}
	proc := linuxProcReadFailure{FS: os.DirFS("/proc"), path: ".", err: fs.ErrPermission}
	if err := waitLinuxOwnedCommand(child, proc); !errors.Is(err, errOwnedCommandUncertain) {
		t.Fatalf("unproven group disposal lost uncertainty: %v", err)
	}
	if command.ProcessState != nil {
		t.Fatal("uncertain group disposal reaped its PGID-pinning leader")
	}
	var information unix.Siginfo
	if err := unix.Waitid(unix.P_PID, identity.PID, &information, unix.WEXITED|unix.WNOWAIT|unix.WNOHANG, nil); err != nil {
		t.Fatalf("uncertain lifetime did not retain its actual child: %v", err)
	}
	err = waitLinuxOwnedCommand(child, os.DirFS("/proc"))
	var exit *exec.ExitError
	if !errors.As(err, &exit) || errors.Is(err, errOwnedCommandUncertain) || command.ProcessState == nil {
		t.Fatalf("retained command could not complete after inspection recovered: %v", err)
	}
}

func TestLinuxRedirectedDescendantPreventsGroupDisposal(t *testing.T) {
	command, owner, pidFile, exitFile := linuxOwnedFixtureCommand(t)
	prepareOwnedCommand(command)
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = signalUnreapedGroup(command.Process.Pid, unix.SIGKILL)
		if err := waitUnreapedGroupExit(command.Process.Pid); err != nil {
			t.Errorf("test subtree disposal is unproven: %v", err)
			return
		}
		_ = command.Wait()
	}()
	descendant := linuxFixtureDescendant(t, pidFile, owner)
	if err := os.WriteFile(exitFile, nil, 0600); err != nil {
		t.Fatal(err)
	}
	var information unix.Siginfo
	for {
		err := unix.Waitid(unix.P_PID, command.Process.Pid, &information, unix.WEXITED|unix.WNOWAIT, nil)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		break
	}
	if err := devsession.VerifyOwnedProcess(descendant, owner); err != nil {
		t.Fatalf("redirected descendant did not actually outlive its leader: %v", err)
	}
	if err := waitLinuxUnreapedGroupExit(command.Process.Pid, os.DirFS("/proc"), 0); err == nil {
		t.Fatal("actual live redirected descendant was considered disposed")
	}
	if command.ProcessState != nil {
		t.Fatal("live redirected descendant lost its PGID-pinning leader")
	}
}
