//go:build !windows

package terminal

import (
	"context"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/google/uuid"
	"golang.org/x/sys/unix"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/omniviewdev/omniview/internal/shellenv"
	"github.com/omniviewdev/omniview/internal/version"
	logging "github.com/omniviewdev/plugin-sdk/log"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

const (
	// DefaultReadBufferSize is the size of one read of a shell's output: one event is at most this big.
	DefaultReadBufferSize = 20480

	// drainWait is how long the master is still read once the shell has exited, counted from the last
	// byte: what the shell wrote before it exited is delivered, then the session ends.
	drainWait = time.Second
	// exitGrace is how long a shell may outlive the end of its pty before the host ends it.
	exitGrace = 2 * time.Second
	// killGrace is how long the host waits for a shell it killed to be reaped.
	killGrace = 2 * time.Second
	// closeWait is how long a close waits for the session to be gone: longer than HangupGrace, which
	// it has to cover.
	closeWait = 5 * time.Second
)

// Manager runs the local terminals. Its one lock guards the map of sessions and is never held across
// I/O: a session whose shell does not read costs its own input queue and nothing else.
type Manager struct {
	ctx  context.Context
	log  logging.Logger
	sink Sink

	mu       sync.RWMutex
	sessions map[string]*session
	starting map[string]struct{}
}

// NewManager makes a manager whose sessions end when ctx ends and whose events go to sink.
func NewManager(ctx context.Context, log logging.Logger, sink Sink) *Manager {
	m := &Manager{
		ctx: ctx, log: log.Named("TerminalManager"), sink: sink,
		mu: sync.RWMutex{}, sessions: make(map[string]*session), starting: make(map[string]struct{}),
	}
	go m.forwardSignals()
	return m
}

// fate is what decides how a session is told to have ended: the first of the shell's own end, a
// request of the host and a failure of the pty settles it, and a later one changes nothing.
type fate struct {
	set      bool
	closedBy ClosedBy
	failure  *Failure
}

// exitStatus is what the system said when the shell was reaped.
type exitStatus struct {
	code       int
	signal     syscall.Signal
	coreDumped bool
	err        error
}

type session struct {
	id      string
	info    Session
	command []string
	labels  map[string]string
	params  map[string]string
	owner   Owner

	cmd    *exec.Cmd
	master *os.File
	cancel context.CancelFunc
	buffer *sdkexec.OutputBuffer
	queue  *inputQueue
	// flow is nil unless the session was started with flow control.
	flow *flowControl

	// ending is set as soon as the session is on its way out: it is no longer found, listed or written to.
	ending atomic.Bool
	// exited is closed when the shell has been reaped; status is read after it.
	exited chan struct{}
	status exitStatus
	// done is closed when the session is gone: its CLOSE delivered and its resources released.
	done chan struct{}

	mu       sync.Mutex
	fate     fate
	attached bool
}

func (s *session) decide(f fate) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fate.set {
		return false
	}
	s.fate = f
	return true
}

func (s *session) settled() fate {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.fate
}

// beginClose ends the shell at the host's request, unless it had already ended by itself: then its own
// end stands. The end is a hangup first, as when a real terminal closes (hangup).
func (s *session) beginClose(by ClosedBy) {
	if !s.decide(fate{set: true, closedBy: by, failure: nil}) {
		return
	}
	s.ending.Store(true)
	go s.hangup(HangupGrace)
}

// hangup ends the shell the way closing a real terminal does. The foreground program and the shell get
// SIGHUP (the kernel sends it to both when the master of a pty closes; the host sends it itself so that
// the shell's own jobs are hung up too: an interactive bash or zsh that gets SIGHUP sends it on to its
// background jobs before it exits, so a job the user did not nohup or disown ends with its terminal, as in
// VS Code and in a terminal window that is closed). What ignored the hangup is killed once the grace
// has passed: the foreground group and the shell with SIGKILL.
func (s *session) hangup(grace time.Duration) {
	shell, group, known := s.groups()
	if known && group != shell {
		_ = syscall.Kill(-group, syscall.SIGHUP)
	}
	_ = s.cmd.Process.Signal(syscall.SIGHUP)
	timer := time.NewTimer(grace)
	defer timer.Stop()
	select {
	case <-s.exited:
		return
	case <-timer.C:
	}
	if known && group != shell {
		_ = syscall.Kill(-group, syscall.SIGKILL)
	}
	s.cancel()
}

func (s *session) awaitExit(wait time.Duration) bool {
	select {
	case <-s.exited:
		return true
	case <-time.After(wait):
		return false
	}
}

func (s *session) hasExited() bool {
	select {
	case <-s.exited:
		return true
	default:
		return false
	}
}

// snapshot is the session as the exec lane's other callers know it.
func (s *session) snapshot() *sdkexec.Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	return &sdkexec.Session{
		ID: s.id, Command: slices.Clone(s.command), Labels: nonNil(s.labels), Params: nonNil(s.params),
		Attached: s.attached, CreatedAt: s.info.CreatedAt,
	}
}

// nonNil is a copy of m that is a map even when m is none, so that a session is listed with {} and not null.
func nonNil(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return maps.Clone(m)
}

// live returns a session that is running: one that is ending is not found.
func (m *Manager) live(id string) (*session, error) {
	m.mu.RLock()
	s := m.sessions[id]
	m.mu.RUnlock()
	if s == nil || s.ending.Load() {
		return nil, apperror.SessionNotFound(id)
	}
	return s, nil
}

// GetSession returns a running session by its ID.
func (m *Manager) GetSession(sessionID string) (*sdkexec.Session, error) {
	s, err := m.live(sessionID)
	if err != nil {
		return nil, err
	}
	return s.snapshot(), nil
}

// ListSessions returns the running sessions.
func (m *Manager) ListSessions() []*sdkexec.Session {
	m.mu.RLock()
	sessions := make([]*sdkexec.Session, 0, len(m.sessions))
	for _, s := range m.sessions {
		if !s.ending.Load() {
			sessions = append(sessions, s.snapshot())
		}
	}
	m.mu.RUnlock()
	m.log.Debugw(context.Background(), "listed sessions", "count", len(sessions))
	return sessions
}

// Start starts a shell on a pty of the size asked for and returns what the host knows about it. The
// session belongs to owner and ends with it (CloseOwned); a nil owner is none.
func (m *Manager) Start(opts Options, owner Owner) (Session, error) {
	cols, rows, err := resolveSize(opts.Cols, opts.Rows)
	if err != nil {
		return Session{}, err
	}
	id, err := m.reserve(opts.ID, owner)
	if err != nil {
		return Session{}, err
	}
	s, err := m.launch(id, opts, cols, rows, owner)
	if err != nil {
		m.mu.Lock()
		delete(m.starting, id)
		m.mu.Unlock()
		return Session{}, err
	}
	m.mu.Lock()
	delete(m.starting, id)
	m.sessions[id] = s
	m.mu.Unlock()
	go m.wait(s)
	go m.pump(s)
	m.log.Debugw(context.Background(), "session started", "session", id, "shell", s.info.Shell.Path, "cols", cols, "rows", rows)
	return s.info, nil
}

// reserve takes an id for a session that is about to start, so that two starts cannot share it.
func (m *Manager) reserve(requested string, owner Owner) (string, error) {
	if owner != nil && !reflect.TypeOf(owner).Comparable() {
		return "", invalidError("the owner of a terminal must be comparable.")
	}
	if len(requested) > maxIDLength {
		return "", invalidError(fmt.Sprintf("id must be at most %d bytes; got %d.", maxIDLength, len(requested)))
	}
	id := requested
	if id == "" {
		id = uuid.NewString()
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, taken := m.sessions[id]; taken {
		return "", IDInUse(id)
	}
	if _, taken := m.starting[id]; taken {
		return "", IDInUse(id)
	}
	m.starting[id] = struct{}{}
	return id, nil
}

// startDirectory is where a shell starts: the directory the caller named, which has to be an absolute
// path to a directory that exists, or the user's home.
func startDirectory(requested string) (string, error) {
	if requested == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", startError(fmt.Errorf("cannot determine the terminal's home directory: %w", err))
		}
		return home, nil
	}
	if !filepath.IsAbs(requested) {
		return "", invalidError("cwd must be an absolute path; got " + strconv.Quote(requested) + ".")
	}
	info, err := os.Stat(requested)
	if err != nil || !info.IsDir() {
		return "", invalidError("cwd must be a directory that exists; " + strconv.Quote(requested) + " is not one.")
	}
	return filepath.Clean(requested), nil
}

// launch starts the process on a pty that already has its size.
func (m *Manager) launch(id string, opts Options, cols, rows uint16, owner Owner) (*session, error) {
	path, args, err := shellenv.Resolve(opts.Command)
	if err != nil {
		return nil, shellError(err)
	}
	dir, err := startDirectory(opts.Cwd)
	if err != nil {
		return nil, err
	}
	env, err := instance.RestoreNativeChildEnvironment(os.Environ())
	if err != nil {
		return nil, startError(err)
	}
	ctx, cancel := context.WithCancel(m.ctx)
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Dir = dir
	cmd.Env = terminalEnvironment(env, path, version.Version)

	// The size is set on the pty before the process starts, so the shell's first prompt is laid out for it.
	master, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: rows, Cols: cols, X: 0, Y: 0})
	if err != nil {
		cancel()
		return nil, startError(err)
	}
	polled, err := pollable(master)
	if err != nil {
		cancel()
		_ = master.Close()
		_ = cmd.Wait()
		return nil, startError(err)
	}
	abs, absErr := filepath.Abs(path)
	if absErr != nil {
		abs = path
	}
	var flow *flowControl
	if opts.Flow {
		flow = newFlowControl()
	}
	s := &session{
		id: id, command: slices.Clone(opts.Command), labels: maps.Clone(opts.Labels), params: maps.Clone(opts.Params), owner: owner,
		info: Session{
			ID: id, CreatedAt: time.Now(), PID: cmd.Process.Pid, Shell: Shell{Path: abs, Name: shellenv.Name(path)},
			Cwd: dir, Cols: int(cols), Rows: int(rows), Flow: opts.Flow, Limits: defaultLimits(),
		},
		cmd: cmd, master: polled, cancel: cancel, buffer: sdkexec.NewDefaultOutputBuffer(), queue: nil, flow: flow,
		ending: atomic.Bool{}, exited: make(chan struct{}), status: exitStatus{code: 0, signal: 0, coreDumped: false, err: nil}, done: make(chan struct{}),
		mu: sync.Mutex{}, fate: fate{set: false, closedBy: "", failure: nil}, attached: false,
	}
	s.queue = newInputQueue(ptyDevice{master: polled}, queueLimits{ops: MaxPendingOps, bytes: MaxPendingBytes, ahead: MaxSeqAhead, gapWait: GapWait})
	return s, nil
}

// wait reaps the shell and tells the reader the shell is gone.
func (m *Manager) wait(s *session) {
	s.status = statusOf(s.cmd.Wait())
	if m.ctx.Err() != nil {
		s.decide(fate{set: true, closedBy: ClosedByShutdown, failure: nil})
	} else {
		s.decide(fate{set: true, closedBy: "", failure: nil})
	}
	s.ending.Store(true)
	close(s.exited)
	// What the shell wrote before it exited is still in the pty: the reader gets drainWait to read it.
	_ = s.master.SetReadDeadline(time.Now().Add(drainWait))
}

func statusOf(err error) exitStatus {
	none := exitStatus{code: 0, signal: 0, coreDumped: false, err: nil}
	if err == nil {
		return none
	}
	var exit *exec.ExitError
	if !errors.As(err, &exit) {
		none.err = err
		return none
	}
	if status, ok := exit.Sys().(syscall.WaitStatus); ok && status.Signaled() {
		return exitStatus{code: 0, signal: status.Signal(), coreDumped: status.CoreDump(), err: nil}
	}
	return exitStatus{code: exit.ExitCode(), signal: 0, coreDumped: false, err: nil}
}

// pump reads the shell's output until the pty ends, then settles how the session ended.
func (m *Manager) pump(s *session) {
	m.finish(s, m.read(s))
}

// read delivers the shell's output, in order and untouched (a multi-byte character may be cut between
// two events: the caller decodes), and returns the error that ended it. With flow control it stops reading
// while the caller has not acknowledged what it was given.
func (m *Manager) read(s *session) error {
	buf := make([]byte, DefaultReadBufferSize)
	for {
		if s.flow != nil {
			s.flow.wait(s.exited)
		}
		if s.hasExited() {
			// The shell is gone: keep reading while bytes come, stop when none have for drainWait.
			_ = s.master.SetReadDeadline(time.Now().Add(drainWait))
		}
		n, err := s.master.Read(buf)
		if n > 0 {
			// The event owns its bytes: the read buffer is reused.
			data := slices.Clone(buf[:n])
			if s.flow != nil {
				s.flow.sent(n)
			}
			m.sink.Output(s.id, data)
			s.buffer.Append(data)
		}
		if err != nil {
			return err
		}
	}
}

// readEnded reports whether a read error is the ordinary end of a pty's output: end of file on macOS,
// input/output error on Linux, and the deadline the host sets once the shell has exited.
func readEnded(err error) bool {
	return errors.Is(err, io.EOF) || errors.Is(err, syscall.EIO) || errors.Is(err, os.ErrDeadlineExceeded)
}

// finish ends a session whose output has ended: it waits for the shell, closes the input, delivers the
// one CLOSE after the last output, and lets the id go.
func (m *Manager) finish(s *session, readErr error) {
	s.ending.Store(true)
	end := m.settle(s, readErr)
	s.queue.close(apperror.SessionNotFound(s.id))
	// Closing the master wakes a write that is still blocked in the kernel.
	_ = s.master.Close()
	m.sink.Closed(s.id, end)
	m.mu.Lock()
	delete(m.sessions, s.id)
	m.mu.Unlock()
	s.cancel()
	close(s.done)
	m.log.Debugw(context.Background(), "session terminated", "session", s.id, "reason", end.Reason)
}

// settle waits for the shell and decides how the session ended. A shell that outlives its pty, or a
// read that failed, ends the session: the shell is killed.
func (m *Manager) settle(s *session, readErr error) End {
	if !readEnded(readErr) {
		s.decide(fate{set: true, closedBy: "", failure: &Failure{Stage: StageRead, Message: readErr.Error()}})
	}
	exited := s.awaitExit(exitGrace)
	if !exited {
		s.decide(fate{set: true, closedBy: "", failure: &Failure{Stage: StagePty, Message: "the pty closed while the shell was still running"}})
	}
	if !exited || s.settled().failure != nil {
		s.cancel()
		exited = s.awaitExit(killGrace)
	}
	f := s.settled()
	switch {
	case f.closedBy != "":
		return endClosed(f.closedBy)
	case f.failure != nil:
		return endFailed(f.failure.Stage, f.failure.Message)
	case !exited:
		return endFailed(StageWait, "the shell did not exit after it was killed")
	}
	return endOfStatus(s.status)
}

func endOfStatus(status exitStatus) End {
	switch {
	case status.err != nil:
		return endFailed(StageWait, status.err.Error())
	case status.signal != 0:
		name := unix.SignalName(status.signal)
		if name == "" {
			name = "SIG" + strconv.Itoa(int(status.signal))
		}
		return End{Reason: EndSignaled, ExitCode: nil, Signal: name, SignalNumber: int(status.signal), CoreDumped: status.coreDumped, ClosedBy: "", Failure: nil}
	}
	code := status.code
	return End{Reason: EndExited, ExitCode: &code, Signal: "", SignalNumber: 0, CoreDumped: false, ClosedBy: "", Failure: nil}
}

func endClosed(by ClosedBy) End {
	return End{Reason: EndClosed, ExitCode: nil, Signal: "", SignalNumber: 0, CoreDumped: false, ClosedBy: by, Failure: nil}
}

func endFailed(stage FailureStage, message string) End {
	return End{Reason: EndFailed, ExitCode: nil, Signal: "", SignalNumber: 0, CoreDumped: false, ClosedBy: "", Failure: &Failure{Stage: stage, Message: message}}
}

// Write applies input to a session's shell. seq is the caller's sequence number, or zero (see
// inputQueue). It returns when the input has been written.
func (m *Manager) Write(sessionID string, seq uint64, data []byte) error {
	s, err := m.live(sessionID)
	if err != nil {
		return err
	}
	return s.queue.write(seq, data)
}

// Resize sets the size of a session's terminal, in the order of the session's other input.
func (m *Manager) Resize(sessionID string, seq uint64, rows, cols int) error {
	r, c, err := checkSize(rows, cols)
	if err != nil {
		return err
	}
	s, err := m.live(sessionID)
	if err != nil {
		return err
	}
	return s.queue.resize(seq, r, c)
}

// Ack tells the host that the caller has taken in n more bytes of the session's output. It matters to a
// session started with flow control, whose reading it paces; for any other it changes nothing.
func (m *Manager) Ack(sessionID string, n int) error {
	if n < 0 {
		return invalidError("bytes must not be negative.")
	}
	s, err := m.live(sessionID)
	if err != nil {
		return err
	}
	if s.flow != nil {
		s.flow.ack(n)
	}
	return nil
}

// Busy says whether a program other than the shell holds the terminal's foreground: the foreground
// process group of the pty (TIOCGPGRP on its master) against the shell's own. A background job does
// not hold it. Nothing polls: the answer is read when it is asked for.
func (m *Manager) Busy(sessionID string) (Foreground, error) {
	s, err := m.live(sessionID)
	if err != nil {
		return Foreground{}, err
	}
	shell, group, known := s.groups()
	if s.ending.Load() {
		// The session ended while it was asked: the descriptor is closed, or about to be.
		return Foreground{}, apperror.SessionNotFound(sessionID)
	}
	if !known {
		return UnknownForeground(ReasonQueryFailed), nil
	}
	return foregroundOf(shell, group), nil
}

// groups reads the shell's process group and the pty's foreground group. It reports false when the
// system would not say either.
func (s *session) groups() (int, int, bool) {
	foreground, groupErr := foregroundGroup(s.master)
	shell, shellErr := syscall.Getpgid(s.cmd.Process.Pid)
	return shell, foreground, groupErr == nil && shellErr == nil && foreground > 0
}

// foregroundOf compares the foreground group with the shell's.
func foregroundOf(shellGroup, foreground int) Foreground {
	if foreground == shellGroup {
		return Foreground{State: StateIdle, Name: "", PGID: 0, Reason: ""}
	}
	return Foreground{State: StateBusy, Name: processName(foreground), PGID: foreground, Reason: ""}
}

// Cwd says which directory the shell is in now: its own current working directory, read from the system
// when asked (`/proc/<pid>/cwd` on Linux, proc_info on macOS), so that a new terminal can open here and a
// tab can show it. Nothing polls.
func (m *Manager) Cwd(sessionID string) (Directory, error) {
	s, err := m.live(sessionID)
	if err != nil {
		return Directory{}, err
	}
	path, reason := s.directory()
	if s.ending.Load() {
		return Directory{}, apperror.SessionNotFound(sessionID)
	}
	return Directory{Path: path, Reason: reason}, nil
}

func (s *session) directory() (string, UnknownReason) {
	path, err := processCwd(s.cmd.Process.Pid)
	switch {
	case err == nil:
		return path, ""
	case errors.Is(err, errors.ErrUnsupported):
		return "", ReasonUnsupported
	default:
		return "", ReasonQueryFailed
	}
}

// AttachSession marks a session as attached and returns its current output buffer. The caller renders
// the returned buffer; it is not also sent on the output stream, where any viewer already listening
// would print it twice. This matches plugin sessions, whose SDK manager only returns the buffer.
func (m *Manager) AttachSession(sessionID string) (*sdkexec.Session, []byte, error) {
	s, err := m.live(sessionID)
	if err != nil {
		return nil, nil, err
	}
	data := s.buffer.GetAll()
	s.mu.Lock()
	s.attached = true
	s.mu.Unlock()
	m.log.Debugw(context.Background(), "session attached", "session", sessionID, "bufferSize", len(data))
	return s.snapshot(), data, nil
}

// DetachSession marks a session as not attached.
func (m *Manager) DetachSession(sessionID string) (*sdkexec.Session, error) {
	s, err := m.live(sessionID)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.attached = false
	s.mu.Unlock()
	m.log.Debugw(context.Background(), "session detached", "session", sessionID)
	return s.snapshot(), nil
}

// CloseSession ends a session at its caller's request. When it returns the session is gone: the shell
// is reaped, no event follows the CLOSE and the id is free.
func (m *Manager) CloseSession(sessionID string) error {
	s, err := m.live(sessionID)
	if err != nil {
		return err
	}
	s.beginClose(ClosedByRequest)
	m.awaitGone([]*session{s})
	return nil
}

// CloseOwned ends every running session of owner, as the owner's window going away does, and returns
// how many it ended. When it returns they are gone.
func (m *Manager) CloseOwned(owner Owner, by ClosedBy) int {
	if owner == nil || !reflect.TypeOf(owner).Comparable() {
		return 0
	}
	var owned []*session
	m.mu.RLock()
	for _, s := range m.sessions {
		if s.owner == owner && !s.ending.Load() {
			owned = append(owned, s)
		}
	}
	m.mu.RUnlock()
	for _, s := range owned {
		s.beginClose(by)
	}
	m.awaitGone(owned)
	return len(owned)
}

// awaitGone waits, for at most closeWait in all, until the sessions are gone.
func (m *Manager) awaitGone(sessions []*session) {
	deadline := time.NewTimer(closeWait)
	defer deadline.Stop()
	for _, s := range sessions {
		select {
		case <-s.done:
		case <-deadline.C:
			m.log.Warnw(m.ctx, "a terminal session was still ending after a close", "session", s.id)
			return
		}
	}
}

// forwardSignals listens for host-process signals once and forwards them to all active terminal child
// processes. Runs for the lifetime of the Manager.
func (m *Manager) forwardSignals() {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGTERM, syscall.SIGINT, syscall.SIGQUIT)
	defer signal.Stop(ch)

	for {
		select {
		case sig := <-ch:
			m.mu.RLock()
			for id, s := range m.sessions {
				if s.cmd.Process == nil {
					continue
				}
				if err := s.cmd.Process.Signal(sig); err != nil {
					m.log.Debugw(m.ctx, "failed to forward signal", "signal", sig, "session", id, "error", err)
				}
			}
			m.mu.RUnlock()
		case <-m.ctx.Done():
			return
		}
	}
}
