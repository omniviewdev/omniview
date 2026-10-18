//go:build darwin

package devworkspace

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devsession"
	"golang.org/x/sys/unix"
)

func TestDarwinOwnedCommandObservesAlreadyExitedLeader(t *testing.T) {
	for _, test := range []struct {
		name, script string
		exitCode     int
		brokenOutput bool
	}{
		{name: "success", script: "exit 0"},
		{name: "nonzero", script: "exit 17", exitCode: 17},
		{name: "output failure", script: "printf owned; exit 0", brokenOutput: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			command := exec.Command("/bin/sh", "-c", test.script)
			if test.brokenOutput {
				reader, writer := io.Pipe()
				if err := reader.Close(); err != nil {
					t.Fatal(err)
				}
				defer writer.Close()
				command.Stdout = writer
			}
			prepareOwnedCommand(command)
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			child := &ownedChild{command: command}
			child.identity.PID = command.Process.Pid
			defer func() {
				if command.ProcessState != nil {
					return
				}
				if err := signalUnreapedGroup(command.Process.Pid, unix.SIGKILL); err != nil {
					t.Error(err)
					return
				}
				if err := waitUnreapedGroupExit(command.Process.Pid); err != nil {
					t.Error(err)
					return
				}
				_ = command.Wait()
			}()
			// Keep the actual direct child unreaped: its PID/PGID cannot be reused.
			// Force the same genuine exit-before-kqueue-registration ordering as
			// a fast dependency command, without replacing any process observer.
			deadline := time.NewTimer(5 * time.Second)
			defer deadline.Stop()
			for {
				members, err := unix.SysctlKinfoProcSlice("kern.proc.pid", command.Process.Pid)
				if err != nil {
					t.Fatal(err)
				}
				if len(members) == 1 && int(members[0].Proc.P_pid) == command.Process.Pid && members[0].Proc.P_stat == 5 {
					break
				}
				select {
				case <-deadline.C:
					t.Fatal("actual owned leader did not exit before registration")
				case <-time.After(10 * time.Millisecond):
				}
			}
			err := waitOwnedCommand(child)
			if !child.disposed || command.ProcessState == nil {
				t.Fatalf("actual exited child lost empty-group/reap proof: %v", err)
			}
			if test.brokenOutput {
				if !errors.Is(err, io.ErrClosedPipe) {
					t.Fatalf("already-exited child lost its actual output error: %v", err)
				}
			} else if test.exitCode != 0 {
				var exit *exec.ExitError
				if !errors.As(err, &exit) || exit.ExitCode() != test.exitCode {
					t.Fatalf("already-exited child lost its actual exit status: %v", err)
				}
			} else if err != nil {
				t.Fatalf("successful already-exited child became an observation failure: %v", err)
			}
		})
	}
}

// SO_LINGER holds this exact child's kernel exit before SZOMB. Its userspace
// task is already inactive, so PROCARGS2 returns EINVAL while kinfo still
// exposes the same PID/start identity. Closing the peer releases actual exit.
func TestDarwinSupervisorExitFixture(t *testing.T) {
	address := os.Getenv("OMNIVIEW_DARWIN_EXIT_FIXTURE")
	if address == "" {
		return
	}
	port, err := strconv.Atoi(address)
	if err != nil {
		os.Exit(80)
	}
	socket, err := unix.Socket(unix.AF_INET, unix.SOCK_STREAM, 0)
	if err != nil {
		os.Exit(81)
	}
	if err = unix.SetsockoptInt(socket, unix.SOL_SOCKET, unix.SO_SNDBUF, 4096); err != nil {
		os.Exit(82)
	}
	if err = unix.Connect(socket, &unix.SockaddrInet4{Port: port, Addr: [4]byte{127, 0, 0, 1}}); err != nil {
		os.Exit(83)
	}
	if err = unix.SetsockoptTimeval(socket, unix.SOL_SOCKET, unix.SO_SNDTIMEO, &unix.Timeval{Usec: 100000}); err != nil {
		os.Exit(84)
	}
	buffer := make([]byte, 65536)
	for {
		_, err = unix.Write(socket, buffer)
		if errors.Is(err, unix.EAGAIN) {
			break
		}
		if err != nil {
			os.Exit(85)
		}
	}
	if err = unix.SetsockoptLinger(socket, unix.SOL_SOCKET, unix.SO_LINGER, &unix.Linger{Onoff: 1, Linger: 30}); err != nil {
		os.Exit(86)
	}
	if _, err = os.Stdout.WriteString("ready\n"); err != nil {
		os.Exit(87)
	}
	_, _ = io.Copy(io.Discard, os.Stdin)
	os.Exit(0)
}

func TestDarwinOwnedGroupExitFixture(t *testing.T) {
	pidFile := os.Getenv("OMNIVIEW_DARWIN_EXIT_GROUP_PID_FILE")
	if pidFile == "" {
		return
	}
	command := exec.Command(os.Args[0], "-test.run=^TestDarwinSupervisorExitFixture$")
	command.Env = os.Environ()
	command.Stdin, command.Stdout, command.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := command.Start(); err != nil {
		os.Exit(90)
	}
	if err := os.WriteFile(pidFile, []byte(strconv.Itoa(command.Process.Pid)), 0600); err != nil {
		os.Exit(91)
	}
	_, _ = io.Copy(io.Discard, os.Stdin)
	deadline := time.Now().Add(5 * time.Second)
	for {
		members, err := unix.SysctlKinfoProcSlice("kern.proc.pid", command.Process.Pid)
		_, argsErr := unix.SysctlRaw("kern.procargs2", command.Process.Pid)
		if err != nil {
			os.Exit(92)
		}
		if len(members) == 1 && members[0].Proc.P_stat != 5 && members[0].Proc.P_flag&0x2000 != 0 && errors.Is(argsErr, unix.EINVAL) {
			// Leave this exact descendant inside kernel exit while the retained
			// group leader becomes an unreaped zombie.
			os.Exit(17)
		}
		if !time.Now().Before(deadline) {
			os.Exit(93)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestDarwinOwnedGroupWaitsForExitingDescendant(t *testing.T) {
	listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	raw, err := listener.SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	var socketErr error
	if err = raw.Control(func(fd uintptr) { socketErr = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_RCVBUF, 1024) }); err != nil || socketErr != nil {
		t.Fatal(errors.Join(err, socketErr))
	}
	pidFile := filepath.Join(t.TempDir(), "descendant.pid")
	command := exec.Command(os.Args[0], "-test.run=^TestDarwinOwnedGroupExitFixture$")
	command.Env = append(os.Environ(), "OMNIVIEW_DARWIN_EXIT_GROUP_PID_FILE="+pidFile, "OMNIVIEW_DARWIN_EXIT_FIXTURE="+strconv.Itoa(listener.Addr().(*net.TCPAddr).Port))
	input, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer output.Close()
	command.Stderr = os.Stderr
	prepareOwnedCommand(command)
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	child := &ownedChild{command: command}
	child.identity.PID = command.Process.Pid
	var peer *net.TCPConn
	boundaryObserved := false
	var completed chan error
	waitFinished := false
	defer func() {
		_ = input.Close()
		if peer != nil {
			_ = peer.SetLinger(0)
			_ = peer.Close()
		}
		if completed != nil && !waitFinished {
			select {
			case waitErr := <-completed:
				t.Logf("retained observer completed during cleanup: %v", waitErr)
			case <-time.After(6 * time.Second):
				t.Errorf("cleanup unproven: retained observer still owns unreaped leader %d", command.Process.Pid)
				return
			}
		}
		if command.ProcessState != nil {
			t.Logf("cleanup proven by owned observer: leader %d reaped, disposed=%t", command.Process.Pid, child.disposed)
			return
		}
		var signalErr error
		if !boundaryObserved {
			signalErr = signalUnreapedGroup(command.Process.Pid, unix.SIGKILL)
		}
		// At the observed boundary every member has already entered exit. TCP
		// reset releases the descendant; retain the leader until emptiness is
		// independently proven, even when the production observer returned EPERM.
		if groupErr := waitUnreapedGroupExit(command.Process.Pid); groupErr != nil {
			t.Errorf("cleanup unproven; retained unreaped leader %d: %v", command.Process.Pid, errors.Join(signalErr, groupErr))
			return
		}
		waitErr := command.Wait()
		t.Logf("cleanup proven independently: group %d has no live members, retained leader reaped=%t, signal=%v, wait=%v", command.Process.Pid, command.ProcessState != nil, signalErr, waitErr)
	}()
	if err = listener.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	peer, err = listener.AcceptTCP()
	if err != nil {
		t.Fatal(err)
	}
	ready := make(chan error, 1)
	go func() {
		line, readErr := bufio.NewReader(output).ReadString('\n')
		if readErr == nil && line != "ready\n" {
			readErr = errors.New("unexpected linger fixture readiness")
		}
		ready <- readErr
	}()
	select {
	case err = <-ready:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("actual descendant did not fill its lingering TCP socket")
	}
	rawPID, err := os.ReadFile(pidFile)
	if err != nil {
		t.Fatal(err)
	}
	descendantPID, err := strconv.Atoi(string(rawPID))
	if err != nil {
		t.Fatal(err)
	}
	if err = input.Close(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		members, inspectErr := unix.SysctlKinfoProcSlice("kern.proc.pgrp", command.Process.Pid)
		if inspectErr != nil {
			t.Fatal(inspectErr)
		}
		leaderExited, descendantExiting := false, false
		for _, member := range members {
			switch int(member.Proc.P_pid) {
			case command.Process.Pid:
				leaderExited = member.Proc.P_stat == 5
			case descendantPID:
				_, argsErr := unix.SysctlRaw("kern.procargs2", descendantPID)
				descendantExiting = member.Proc.P_stat != 5 && member.Proc.P_flag&0x2000 != 0 && errors.Is(argsErr, unix.EINVAL)
			}
		}
		if len(members) == 2 && leaderExited && descendantExiting {
			boundaryObserved = true
			for _, member := range members {
				t.Logf("retained group boundary: pid=%d stat=%d flags=%#x", member.Proc.P_pid, member.Proc.P_stat, member.Proc.P_flag)
			}
			break
		}
		if !time.Now().Before(deadline) {
			t.Fatal("did not hold exact unreaped leader plus non-zombie P_WEXIT descendant")
		}
		time.Sleep(time.Millisecond)
	}
	completed = make(chan error, 1)
	go func() { completed <- waitOwnedCommand(child) }()
	select {
	case err = <-completed:
		waitFinished = true
		t.Errorf("owned observer returned before held descendant kernel exit: EPERM=%t disposed=%t reaped=%t err=%v", errors.Is(err, unix.EPERM), child.disposed, command.ProcessState != nil, err)
	case <-time.After(100 * time.Millisecond):
	}
	if err = peer.SetLinger(0); err != nil {
		t.Fatal(err)
	}
	if err = peer.Close(); err != nil {
		t.Fatal(err)
	}
	if waitFinished {
		return
	}
	select {
	case err = <-completed:
		waitFinished = true
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 17 || !child.disposed || command.ProcessState == nil {
			t.Fatalf("released exact group lost disposal/reap/exit proof: disposed=%t reaped=%t err=%v", child.disposed, command.ProcessState != nil, err)
		}
	case <-time.After(6 * time.Second):
		t.Fatal("released descendant did not complete retained group disposal")
	}
}

func TestDarwinDownWaitsForExactSupervisorKernelExit(t *testing.T) {
	manager, _ := fixtureManager(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	workspace, err := manager.Create(ctx, CreateOptions{Slug: "darwin-exit"})
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	raw, err := listener.SyscallConn()
	if err != nil {
		t.Fatal(err)
	}
	var socketErr error
	if err = raw.Control(func(fd uintptr) { socketErr = unix.SetsockoptInt(int(fd), unix.SOL_SOCKET, unix.SO_RCVBUF, 1024) }); err != nil || socketErr != nil {
		t.Fatal(errors.Join(err, socketErr))
	}
	command := exec.Command(os.Args[0], "-test.run=^TestDarwinSupervisorExitFixture$")
	command.Env = append(os.Environ(), "OMNIVIEW_DARWIN_EXIT_FIXTURE="+strconv.Itoa(listener.Addr().(*net.TCPAddr).Port))
	input, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	command.Stderr = os.Stderr
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	var peer *net.TCPConn
	defer func() {
		_ = input.Close()
		if peer != nil {
			_ = peer.SetLinger(0)
			_ = peer.Close()
		}
		_ = command.Process.Kill()
		_ = command.Wait()
	}()
	if err = listener.SetDeadline(time.Now().Add(5 * time.Second)); err != nil {
		t.Fatal(err)
	}
	peer, err = listener.AcceptTCP()
	if err != nil {
		t.Fatal(err)
	}
	if ready, err := bufio.NewReader(output).ReadString('\n'); err != nil || ready != "ready\n" {
		t.Fatalf("exit fixture did not become ready: %q %v", ready, err)
	}
	generation := NewGeneration()
	owner := devsession.ProcessOwner{WorkspaceID: workspace.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: workspace.Root}
	identity, err := devsession.CaptureProcess(command.Process.Pid, owner)
	if err != nil {
		t.Fatal(err)
	}
	token := []byte(strings.Repeat("s", 43))
	exiting := make(chan error, 1)
	server := httptest.NewServer(supervisorHandler(owner.WorkspaceID, generation, token, func(context.Context, string) (Status, error) {
		if err := input.Close(); err != nil {
			exiting <- err
			return Status{}, err
		}
		deadline := time.Now().Add(5 * time.Second)
		for {
			members, inspectErr := unix.SysctlKinfoProcSlice("kern.proc.pid", identity.PID)
			_, argsErr := unix.SysctlRaw("kern.procargs2", identity.PID)
			if inspectErr != nil {
				exiting <- inspectErr
				return Status{}, inspectErr
			}
			if len(members) == 1 && members[0].Proc.P_stat != 5 && members[0].Proc.P_flag&0x2000 != 0 && errors.Is(argsErr, unix.EINVAL) {
				exiting <- nil
				return Status{Workspace: workspace, Generation: generation, Phase: "stopped"}, nil
			}
			if !time.Now().Before(deadline) {
				err := errors.New("fixture did not hold the kernel P_WEXIT/PROCARGS2 EINVAL boundary")
				exiting <- err
				return Status{}, err
			}
			time.Sleep(time.Millisecond)
		}
	}))
	defer server.Close()
	record := supervisorRecord{WorkspaceID: owner.WorkspaceID, Generation: generation, Process: identity, Endpoint: server.URL + "/v1/supervisor", TokenFile: launchPath(workspace, "supervisor-"+generation+".secret")}
	if err = os.WriteFile(record.TokenFile, token, 0600); err != nil {
		t.Fatal(err)
	}
	stale := record
	stale.Process.StartIdentity += "-reused"
	if err = saveLaunchJSON(launchPath(workspace, "supervisor.json"), stale); err != nil {
		t.Fatal(err)
	}
	if _, err = manager.Down(ctx, workspace.Manifest.WorkspaceID); !errors.Is(err, devsession.ErrOwnership) {
		t.Fatalf("reused live supervisor was not refused: %v", err)
	}
	select {
	case <-exiting:
		t.Fatal("foreign identity reached the authenticated stop owner")
	default:
	}
	if err = devsession.VerifyOwnedProcess(identity, owner); err != nil {
		t.Fatalf("foreign refusal disrupted the exact live child: %v", err)
	}
	if err = saveLaunchJSON(launchPath(workspace, "supervisor.json"), record); err != nil {
		t.Fatal(err)
	}
	type result struct {
		status Status
		err    error
	}
	stopped := make(chan result, 1)
	go func() {
		status, err := manager.Down(ctx, workspace.Manifest.WorkspaceID)
		stopped <- result{status: status, err: err}
	}()
	select {
	case err = <-exiting:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	select {
	case result := <-stopped:
		t.Fatalf("down returned before exact supervisor kernel exit: phase=%s err=%v", result.status.Phase, result.err)
	case <-time.After(100 * time.Millisecond):
	}
	if err = peer.SetLinger(0); err != nil {
		t.Fatal(err)
	}
	if err = peer.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-stopped:
		if result.err != nil || result.status.Phase != "stopped" || result.status.Generation != generation {
			t.Fatalf("exact owner shutdown did not complete: %+v %v", result.status, result.err)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
}
