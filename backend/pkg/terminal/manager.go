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
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/google/uuid"
	"golang.org/x/sys/unix"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/terminal/marks"
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
	// discardSweep and discardMax bound what the host reads and throws away at the drain cap, to count it.
	discardSweep = 100 * time.Millisecond
	discardMax   = 4 << 20
	// exitGrace is how long a shell may outlive the end of its pty before the host ends it.
	exitGrace = 2 * time.Second
	// killGrace is how long the host waits for a shell it killed to be reaped.
	killGrace = 2 * time.Second
	// closeWait is how long a close waits for the session to be gone: longer than HangupGrace, which
	// it has to cover.
	closeWait = 5 * time.Second
)

// errShuttingDown is why a terminal does not start once the host has begun to shut down.
var errShuttingDown = errors.New("the host is shutting down")

// Manager runs the local terminals. Its one lock guards the map of sessions and is never held across
// I/O: a session whose shell does not read costs its own input queue and nothing else.
type Manager struct {
	// base is the environment a shell starts from (shellenv.LaunchEnvironment), resolve picks the shell
	// (shellenv.Resolve) and probe says how the host's login-environment probe went (shellenv.Probe):
	// fields, so that a test can state a machine. Nothing else changes them.
	base    func() []string
	resolve func(command []string) (string, []string, error)
	probe   func() shellenv.ProbeResult

	// integrationOn says whether the user has the shell integration on (the setting `terminal.shellIntegration`):
	// SetIntegration sets it before sessions start, and it is on until then.
	integrationOn func() (bool, error)
	// bashVersion asks a bash which version it is (the integration needs 4.1 or later): a field, so that a test can state a machine.
	bashVersion func(path string) (major, minor int, err error)

	ctx  context.Context
	log  logging.Logger
	sink Sink
	// reported is whether the sink says itself when the transport took the output (DeliveryReporter); if
	// not, the return of Output is taken for it.
	reported bool
	// closing is set when the host shuts down: no terminal starts after it.
	closing atomic.Bool
	// launching counts the starts in progress. A shell that is starting is not in sessions yet, and a
	// shutdown waits for it, so that it ends with the others.
	launching sync.WaitGroup
	// flowStall is how long a pause on the transport's credit waits before the watchdog steps
	// (flowControl); a field so that a test can state it. SetFlowStall sets it before sessions start.
	flowStall time.Duration
	// replayBytes is how much of a terminal's output its replay ring keeps (ReplayBytes): a field, so that a test
	// can state it.
	replayBytes int
	// channel are the numbers of a channel terminal's ring and pacing (ChannelRingBytes and the others): a field, so
	// that a test can state them. Nothing else changes them, and a test sets them before it starts a terminal.
	channel channelLimits
	// tee is a seam of the tests. When it is set (before any terminal starts: nothing else sets it) it is given, in order and before
	// anything else of the host has seen them, the bytes of every read of a pty master with the id of the session: what the kernel gave
	// the host, which a test can hold the host's delivery to. It must not keep the slice it is given. It is nil in the host.
	tee func(id string, data []byte)
	// offsets is the sink as an OffsetSink when it is one: a terminal with a page key is delivered through it.
	offsets OffsetSink
	// detachments is the sink as a DetachmentSink when it is one: it is told when a page lost its terminal.
	detachments DetachmentSink

	mu       sync.RWMutex
	sessions map[string]*session
	starting map[string]struct{}
	// ended remembers the ids of the last sessions that ended, oldest first, endedMemory at most, so that an
	// acknowledgement that arrives after its session is gone is told from one for a session that never was.
	ended []string
	// tombs are the terminals with a page key that ended by themselves while no page was attached, oldest first,
	// TombstoneLimit at most: the page that comes back finds how they ended and what they wrote.
	tombs []*tombstone
	// tombTimer waits for the tombstone that expires first, to free it: nil when there is none, and once the host
	// shuts down.
	tombTimer timer
	// clock is the time that the leases and the tombstones are kept in: the wall clock, unless a test sets another
	// before it starts a terminal (clock.go).
	clock clock
}

// endedMemory is how many ended sessions' ids the manager remembers.
const endedMemory = 256

// rememberEnded notes that a session ended and forgets the oldest of the last endedMemory. The caller holds
// m.mu.
func (m *Manager) rememberEnded(id string) {
	m.ended = append(m.ended, id)
	if len(m.ended) > endedMemory {
		m.ended = slices.Delete(m.ended, 0, len(m.ended)-endedMemory)
	}
}

// SetIntegration sets how the manager asks whether the user has the shell integration on, once for every terminal that
// starts. It is called before any terminal starts.
func (m *Manager) SetIntegration(on func() (bool, error)) { m.integrationOn = on }

// NewManager makes a manager whose events go to sink. Its sessions end when ctx ends, the way a close
// ends them (Shutdown): the host's application context is cancelled first when it quits.
func NewManager(ctx context.Context, log logging.Logger, sink Sink) *Manager {
	_, reported := sink.(DeliveryReporter)
	offsets, _ := sink.(OffsetSink)
	detachments, _ := sink.(DetachmentSink)
	m := &Manager{
		base: shellenv.LaunchEnvironment, resolve: shellenv.Resolve, probe: shellenv.Probe, integrationOn: func() (bool, error) { return true, nil }, bashVersion: probeBashVersion,
		ctx: ctx, log: log.Named("TerminalManager"), sink: sink, reported: reported, closing: atomic.Bool{}, launching: sync.WaitGroup{}, flowStall: FlowStall,
		replayBytes: ReplayBytes, channel: defaultChannelLimits(), offsets: offsets, detachments: detachments,
		mu: sync.RWMutex{}, sessions: make(map[string]*session), starting: make(map[string]struct{}), ended: nil, tombs: nil, tombTimer: nil, clock: wallClock{},
	}
	go m.forwardSignals()
	go m.shutdownWhenDone()
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
	// pageKey is the key the terminal was opened with, empty when it has none: a terminal with a key outlives its
	// window. lease is how long it is kept once it is detached.
	pageKey string
	lease   time.Duration

	// nonce is the secret of the session's shell integration: the host keeps it (the scanner of step 4 believes the marks that
	// carry it) and it is in no answer, event, log or error. Zero when the shell has no integration.
	nonce marks.Nonce
	// injection is the host's directory and channel of the session's integration while they exist: the end of the session
	// removes what is left of it.
	injection *injection
	// reaped has the result of the shell's Wait, once: the reaper of the shell runs from its start.
	reaped <-chan error

	cmd    *exec.Cmd
	master *os.File
	cancel context.CancelFunc
	// outMu orders the output: the offset of a read, the replay ring and the credit counted for the read are one
	// step under it, and an attach takes its snapshot under it, so the snapshot and the events that follow it
	// meet at one offset.
	outMu sync.Mutex
	// emitMu orders the hand-over of a read to the sink with an attach, for a terminal that has a page key: the
	// reader holds it from the moment it numbers a read until the sink has the event, and an attach takes it
	// first, so that every read the replay holds is out before the attach answers, and none is numbered between
	// the snapshot and the answer. It is the outermost lock: before Manager.mu, mu and outMu.
	emitMu sync.Mutex
	ring   *replayRing
	queue  *inputQueue
	// flow is the credit that paces the session's output.
	flow *flowControl

	// ending is set as soon as the session is on its way out: it is no longer found, listed or written to.
	ending atomic.Bool
	// exited is closed when the shell has been reaped; status is read after it.
	exited chan struct{}
	status exitStatus
	// drainEnd is when the host stops reading the pty after the shell has exited, in Unix nanoseconds: set
	// before exited is closed.
	drainEnd atomic.Int64
	// capped and dropped are what the reader found at the drain cap. Only the reader goroutine writes them
	// and finish, which runs on it, reads them.
	capped  bool
	dropped int
	// done is closed when the session is gone: its CLOSE delivered and its resources released.
	done chan struct{}

	// mu guards what changes as pages come and go. The order of the locks is emitMu, Manager.mu, mu, outMu, flow.
	mu       sync.Mutex
	fate     fate
	attached bool
	// owner is the window the terminal belongs to: none while it is detached. detached says no page is attached
	// and the lease is running: leaseGen numbers the leases, so that a timer that fires for a lease that was
	// ended (an attach came first) finds it was, leaseTimer is the running one, leaseEnd is when it ends and
	// leaseLen is how long it is.
	owner      Owner
	detached   bool
	leaseGen   uint64
	leaseTimer timer
	leaseEnd   time.Time
	leaseLen   time.Duration
	// clock is the manager's: a lease runs on it.
	clock clock
	// attachment numbers the attachments of the terminal: 0 for the window that opened it, and one more for
	// every attach (Attached.Attachment).
	attachment uint64
	// channel is set for a terminal opened with Options.Channel: the capability that reaches it, who holds it and what the host
	// counted of its output (channel.go). A channel terminal has no owner, no window and no event of the events lane.
	channel *channelState
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

// decideReadFailure records that a read of the pty failed. A shell that was reaped before the reader got there has recorded its own
// exit (a fate with nothing in it): the pty failing was what killed it (the kernel hangs the shell up when the master closes),
// so the failure stands over that. A close the host asked for stands over it. (No failure exists before this one: settle is the first to record one.)
func (s *session) decideReadFailure(failure *Failure) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fate.set && s.fate.closedBy != "" {
		return
	}
	s.fate = fate{set: true, closedBy: "", failure: failure}
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
	s.startClose()
}

// startClose is what follows the decision that the host ends the shell: the session is on its way out, the
// pacing stops, and the shell is hung up.
func (s *session) startClose() {
	s.ending.Store(true)
	// A session whose client stopped taking its output is paused for credit. A dying shell has to be read
	// to finish exiting (on macOS a process cannot exit while the pty it holds has output nobody reads, and
	// the host closes the master only after the shell has exited), so the pacing stops for good.
	s.flow.release()
	go s.hangup(HangupGrace)
}

// hangup ends the shell the way closing a real terminal does. The foreground program and the shell get
// SIGHUP (the kernel sends it to both when the master of a pty closes; the host sends it itself so that
// the shell's own jobs are hung up too: an interactive bash or zsh that gets SIGHUP sends it on to its
// background jobs before it exits, so a job the user did not nohup or disown ends with its terminal, as in
// VS Code and in a terminal window that is closed). What ignored the hangup is killed once the grace has
// passed: the shell, and the foreground group THAT IS THERE THEN: a shell that ignores the hangup may have
// started something since, and the group the hangup found is gone.
func (s *session) hangup(grace time.Duration) {
	s.signalForeground(syscall.SIGHUP)
	_ = s.cmd.Process.Signal(syscall.SIGHUP)
	timer := time.NewTimer(grace)
	defer timer.Stop()
	select {
	case <-s.exited:
		return
	case <-timer.C:
	}
	s.signalForeground(syscall.SIGKILL)
	s.cancel()
}

// foreground is the pty's foreground process group, and whether the system said.
func (s *session) foreground() (int, bool) {
	group, err := foregroundGroup(s.master)
	return group, err == nil && group > 0
}

// signalForeground sends sig to the pty's foreground process group, read now, when that is a group of this
// session other than the shell's own (the shell is signalled through its handle).
func (s *session) signalForeground(sig syscall.Signal) {
	group, ok := s.foreground()
	if !ok {
		return
	}
	shellGroup, err := syscall.Getpgid(s.cmd.Process.Pid)
	if err != nil || group == shellGroup || !s.owns(group) {
		return
	}
	_ = syscall.Kill(-group, sig)
}

// owns reports whether a process group belongs to this session. The foreground group of the session's pty
// always does (the kernel lets only a session's own groups be the foreground of its terminal); this asks
// again, through the session id of the group's leader when the leader is still there, so that a group the
// session does not own is never signalled. The host's own group, and the groups 0 and 1, never are.
func (s *session) owns(group int) bool {
	if group <= 1 || group == syscall.Getpgrp() {
		return false
	}
	sid, err := unix.Getsid(group)
	switch {
	case err == nil:
		return sid == s.cmd.Process.Pid
	case errors.Is(err, syscall.ESRCH):
		// The leader is gone and the group lives on: it is the pty's foreground group.
		return true
	default:
		return false
	}
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
	if s == nil || s.ending.Load() || s.channel != nil {
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
		if !s.ending.Load() && s.channel == nil {
			sessions = append(sessions, s.snapshot())
		}
	}
	m.mu.RUnlock()
	m.log.Debugw(context.Background(), "listed sessions", "count", len(sessions))
	return sessions
}

// Start starts a shell on a pty of the size asked for and returns what the host knows about it. The
// session belongs to owner: it ends with it, or, when it was opened with a page key, is detached and kept
// for its lease (ReleaseOwned); a nil owner is none.
func (m *Manager) Start(opts Options, owner Owner) (Session, error) {
	if !m.admitLaunch() {
		return Session{}, startError(errShuttingDown)
	}
	defer m.launching.Done()
	cols, rows, err := resolveSize(opts.Cols, opts.Rows)
	if err != nil {
		return Session{}, err
	}
	lease, err := resolveKeep(opts)
	if err != nil {
		return Session{}, err
	}
	if err = checkLaunchEnv(opts.Env); err != nil {
		return Session{}, err
	}
	if opts.Channel && owner != nil {
		return Session{}, invalidError("a channel terminal belongs to no window: it takes no owner.")
	}
	secret, err := mintCapability(opts.Channel)
	if err != nil {
		return Session{}, startError(err)
	}
	id, err := m.reserve(opts.ID, owner)
	if err != nil {
		return Session{}, err
	}
	s, err := m.launch(id, opts, cols, rows, owner, lease, secret)
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
	// A channel terminal that no stream holds is on its lease from the moment it is made: a page that is gone before it
	// opens the stream leaves no shell behind.
	s.beginLease()
	go m.wait(s)
	go m.pump(s)
	if m.closing.Load() {
		// The host began to shut down while the shell started: it ends with the others.
		s.beginClose(ClosedByShutdown)
	}
	m.log.Debugw(context.Background(), "session started", "session", id, "shell", s.info.Shell.Path, "cols", cols, "rows", rows)
	// The capability is in this answer and in no other: it is not part of what the session says of itself.
	info := s.info
	info.Cap = secret.reveal()
	return info, nil
}

// reserve takes an id for a session that is about to start, so that two starts cannot share it.
func (m *Manager) reserve(requested string, owner Owner) (string, error) {
	if err := checkOwner(owner); err != nil {
		return "", err
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
	// A new terminal takes the id of one that ended and was kept: that one is superseded.
	m.dropTombstoneLocked(id)
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
func (m *Manager) launch(id string, opts Options, cols, rows uint16, owner Owner, lease time.Duration, secret capability) (*session, error) {
	path, args, err := m.resolve(opts.Command)
	if err != nil {
		return nil, shellError(err)
	}
	dir, err := startDirectory(opts.Cwd)
	if err != nil {
		return nil, err
	}
	env, err := instance.RestoreNativeChildEnvironment(m.base())
	if err != nil {
		return nil, startError(err)
	}
	env = withLaunchEnv(env, opts.Env)
	size := &pty.Winsize{Rows: rows, Cols: cols, X: 0, Y: 0}
	started, err := m.spawnIntegrated(id, path, args, dir, env, size)
	if err != nil {
		return nil, err
	}
	cmd, polled := started.cmd, started.master
	requested := requestedShell(opts.Command, path)
	abs, absErr := filepath.Abs(path)
	if absErr != nil {
		abs = path
	}
	s := &session{
		id: id, command: slices.Clone(opts.Command), labels: maps.Clone(opts.Labels), params: maps.Clone(opts.Params),
		pageKey: opts.PageKey, lease: lease, clock: m.clock,
		info: Session{
			ID: id, CreatedAt: time.Now(), PID: cmd.Process.Pid, Shell: Shell{Path: abs, Name: shellenv.Name(path), Requested: requested},
			Cwd: dir, Cols: int(cols), Rows: int(rows), Limits: m.limits(), Environment: environmentOf(m.probe()),
			Integration: started.fact, LeaseMs: int(lease / time.Millisecond), Cap: "",
		},
		nonce: started.nonce, injection: started.pending, reaped: started.reaped,
		cmd: cmd, master: polled, cancel: started.cancel, outMu: sync.Mutex{}, emitMu: sync.Mutex{},
		ring:  newReplayRing(m.ringLimit(opts), Size{Cols: int(cols), Rows: int(rows)}),
		queue: nil, flow: m.newCredit(id),
		ending: atomic.Bool{}, exited: make(chan struct{}), status: exitStatus{code: 0, signal: 0, coreDumped: false, err: nil},
		drainEnd: atomic.Int64{}, capped: false, dropped: 0, done: make(chan struct{}),
		mu: sync.Mutex{}, fate: fate{set: false, closedBy: "", failure: nil}, attached: false,
		owner: owner, detached: false, leaseGen: 0, leaseTimer: nil, leaseEnd: time.Time{}, leaseLen: 0, attachment: 0, channel: newChannelState(opts.Channel, secret),
	}
	s.queue = newInputQueue(ptyDevice{master: polled, applied: s.noteSize}, queueLimits{ops: MaxPendingOps, bytes: MaxPendingBytes, ahead: MaxSeqAhead, gapWait: GapWait})
	return s, nil
}

// process is a shell that was started on a pty: the host reaps it on its own goroutine from the moment it starts, so that
// the start of a shell with the integration can see it end.
type process struct {
	cmd    *exec.Cmd
	master *os.File
	cancel context.CancelFunc
	// reaped has the result of the shell's Wait, once.
	reaped chan error
}

// discard ends a shell that has already been reaped and lets its pty go.
func (p *process) discard() {
	p.cancel()
	_ = p.master.Close()
}

// launched is a shell that was started and what the host did around it.
type launched struct {
	*process
	// fact is what the create answer says of the integration.
	fact Integration
	// nonce is the session's, zero when the shell has no integration.
	nonce marks.Nonce
	// pending is the injection that still has a directory to remove when the session ends: nil when it has been removed
	// (the shell said it is ready, or there is none).
	pending *injection
}

// spawnIntegrated starts the shell with the integration the user's setting and the shell allow, and says what became of it.
// A shell that has the integration and ends before it says it is ready is started once more, without it: once, whatever
// happens to that one.
func (m *Manager) spawnIntegrated(id, path string, args []string, dir string, env []string, size *pty.Winsize) (launched, error) {
	on, settingErr := m.integrationOn()
	kind, fact := integrationPlan(on, path, args, env)
	if settingErr != nil {
		// Not a yes: the user's shell is left alone.
		m.log.Warnw(m.ctx, "the shell integration setting could not be read: the shell starts without it", "session", id)
		kind, fact = kindNone, skipped(SkipSettingUnreadable)
	}
	if kind == kindBash {
		if reason := m.bashSkip(path); reason != "" {
			kind, fact = kindNone, skipped(reason)
		}
	}
	var inj *injection
	if kind != kindNone {
		var err error
		if inj, err = prepareInjection(kind, env); err != nil {
			m.log.Warnw(m.ctx, "the shell integration could not be prepared: the shell starts without it", "session", id, "error", err.Error())
			fact = Integration{State: IntegrationFailed, Reason: FailSetup}
		}
	}
	first, err := m.spawn(id, path, args, dir, env, size, inj)
	if err != nil {
		inj.close()
		return launched{}, err
	}
	if inj == nil {
		return launched{process: first, fact: fact, nonce: marks.Nonce{}, pending: nil}, nil
	}
	result, _ := inj.await(m.ctx, first.reaped)
	switch result {
	case outcomeReady:
		// Every startup file has run: the directory has done its work.
		inj.close()
		return launched{process: first, fact: fact, nonce: inj.nonce, pending: nil}, nil
	case outcomeSlow:
		// Not ready and not gone: the host does not know whether the script ran, so it does not say `on`.
		fact = Integration{State: IntegrationUnconfirmed, Reason: NoReady}
		return launched{process: first, fact: fact, nonce: inj.nonce, pending: inj}, nil
	case outcomeGone:
	}
	first.discard()
	inj.close()
	m.log.Debugw(m.ctx, "the shell ended within moments of its start with the integration: started once more without it", "session", id)
	second, err := m.spawn(id, path, args, dir, env, size, nil)
	if err != nil {
		return launched{}, err
	}
	return launched{process: second, fact: Integration{State: IntegrationFailed, Reason: FailExitedEarly}, nonce: marks.Nonce{}, pending: nil}, nil
}

// spawn starts the shell on a pty of the given size, with the injection's variables and channel when it has one.
func (m *Manager) spawn(id, path string, args []string, dir string, env []string, size *pty.Winsize, inj *injection) (*process, error) {
	// The shell's context is not the host's: when the host's context ends the sessions are closed the way a
	// close does it (Shutdown), with a hangup the shell can pass on to its jobs. The context kills the shell
	// outright, and only at the end of the grace.
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Dir = dir
	cmd.Env = terminalEnvironment(env, path, dir, version.Version)
	if inj != nil && inj.args != nil {
		cmd.Args = append([]string{path}, inj.args...)
	}
	if inj != nil {
		cmd.Env = replaceEnvironment(cmd.Env, inj.env)
		cmd.ExtraFiles = []*os.File{inj.child}
	}

	// The size is set on the pty before the process starts, so the shell's first prompt is laid out for it.
	master, err := pty.StartWithSize(cmd, size)
	if inj != nil {
		// The shell has its end of the channel now; the host's copy is not its to keep.
		_ = inj.child.Close()
	}
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
	if utf8Err := utf8Input(polled); utf8Err != nil {
		m.log.Debugw(m.ctx, "could not mark the pty as UTF-8", "session", id, "error", utf8Err)
	}
	reaped := make(chan error, 1)
	go func() { reaped <- cmd.Wait() }()
	return &process{cmd: cmd, master: polled, cancel: cancel, reaped: reaped}, nil
}

// replaceEnvironment is env with the entries of set in place of the ones that have the same names.
func replaceEnvironment(env, set []string) []string {
	out := make([]string, 0, len(env)+len(set))
	for _, entry := range env {
		name, _, _ := strings.Cut(entry, "=")
		if !slices.ContainsFunc(set, func(replacement string) bool { return strings.HasPrefix(replacement, name+"=") }) {
			out = append(out, entry)
		}
	}
	return append(out, set...)
}

// withLaunchEnv is the environment a shell starts from with the caller's names set: a name already there takes the
// value given. It is the base of terminalEnvironment and of the shell integration, which hands a ZDOTDIR or an
// XDG_DATA_DIRS given here back to the shell as the user's.
func withLaunchEnv(env []string, extra map[string]string) []string {
	if len(extra) == 0 {
		return env
	}
	set := make([]string, 0, len(extra))
	for _, name := range slices.Sorted(maps.Keys(extra)) {
		set = append(set, name+"="+extra[name])
	}
	return replaceEnvironment(env, set)
}

// wait reaps the shell and tells the reader the shell is gone.
func (m *Manager) wait(s *session) {
	s.status = statusOf(<-s.reaped)
	if m.ctx.Err() != nil || m.closing.Load() {
		s.decide(fate{set: true, closedBy: ClosedByShutdown, failure: nil})
	} else {
		s.decide(fate{set: true, closedBy: "", failure: nil})
	}
	now := time.Now()
	s.drainEnd.Store(now.Add(drainCap).UnixNano())
	s.ending.Store(true)
	close(s.exited)
	// What the shell wrote before it exited is still in the pty: the reader gets drainWait to read it.
	_ = s.master.SetReadDeadline(now.Add(drainWait))
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
// two events: the caller decodes), and returns the error that ended it. It stops reading while the output
// it delivered is uncredited past the high mark (flowControl). Once the shell has exited it reads what is
// left for at most drainCap from the exit: a process that keeps the pty open and writing cannot keep the
// session alive.
func (m *Manager) read(s *session) error {
	buf := make([]byte, DefaultReadBufferSize)
	for {
		if s.channel != nil {
			m.waitChannelRoom(s)
		} else {
			s.flow.wait(s.exited)
		}
		var end time.Time
		if s.hasExited() {
			// The shell is gone: keep reading while bytes come, stop when none have for drainWait, and in
			// any case at the cap.
			end = time.Unix(0, s.drainEnd.Load())
			now := time.Now()
			if !now.Before(end) {
				s.capDrain()
				return os.ErrDeadlineExceeded
			}
			deadline := now.Add(drainWait)
			if deadline.After(end) {
				deadline = end
			}
			_ = s.master.SetReadDeadline(deadline)
		}
		n, err := s.master.Read(buf)
		if n > 0 {
			if m.tee != nil {
				m.tee(s.id, buf[:n])
			}
			// The event owns its bytes: the read buffer is reused.
			data := slices.Clone(buf[:n])
			m.deliver(s, data)
			if s.channel == nil && !m.reported {
				// A sink that returns when the transport has taken the bytes has delivered them.
				s.flow.delivered(n)
			}
		}
		if err != nil {
			if !end.IsZero() && errors.Is(err, os.ErrDeadlineExceeded) && !time.Now().Before(end) {
				s.capDrain()
			}
			return err
		}
	}
}

// capDrain is what the host does at the drain cap: it notes that it stopped reading with the pty still
// open, and reads what is there for a moment, to throw it away and count it.
func (s *session) capDrain() {
	s.capped = true
	buf := make([]byte, DefaultReadBufferSize)
	_ = s.master.SetReadDeadline(time.Now().Add(discardSweep))
	for s.dropped < discardMax {
		n, err := s.master.Read(buf)
		s.dropped += n
		if err != nil {
			return
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
	if s.capped {
		end.DrainCapped = true
		end.DroppedBytes = s.dropped
	}
	end.LastOffset = s.next()
	s.queue.close(apperror.SessionNotFound(s.id))
	// Closing the master wakes a write that is still blocked in the kernel.
	_ = s.master.Close()
	// What a page that comes back needs of a terminal that ended by itself is kept before its CLOSE goes out and
	// before its id is free.
	m.keepTombstone(s, end)
	if s.channel != nil {
		m.channelEnded(s, end)
	} else {
		m.sink.Closed(s.id, end)
	}
	m.mu.Lock()
	delete(m.sessions, s.id)
	if s.channel == nil {
		m.rememberEnded(s.id)
	}
	m.mu.Unlock()
	s.stopLease()
	s.cancel()
	s.injection.close()
	close(s.done)
	m.log.Debugw(context.Background(), "session terminated", "session", s.id, "reason", end.Reason)
}

// settle waits for the shell and decides how the session ended. A shell that outlives its pty, or a
// read that failed, ends the session: the shell is killed.
func (m *Manager) settle(s *session, readErr error) End {
	if !readEnded(readErr) {
		s.decideReadFailure(&Failure{Stage: StageRead, Message: readErr.Error()})
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
		return End{
			Reason: EndSignaled, ExitCode: nil, Signal: name, SignalNumber: int(status.signal), CoreDumped: status.coreDumped,
			ClosedBy: "", Failure: nil, DrainCapped: false, DroppedBytes: 0,
		}
	}
	code := status.code
	return End{
		Reason: EndExited, ExitCode: &code, Signal: "", SignalNumber: 0, CoreDumped: false,
		ClosedBy: "", Failure: nil, DrainCapped: false, DroppedBytes: 0,
	}
}

func endClosed(by ClosedBy) End {
	return End{
		Reason: EndClosed, ExitCode: nil, Signal: "", SignalNumber: 0, CoreDumped: false,
		ClosedBy: by, Failure: nil, DrainCapped: false, DroppedBytes: 0,
	}
}

func endFailed(stage FailureStage, message string) End {
	return End{
		Reason: EndFailed, ExitCode: nil, Signal: "", SignalNumber: 0, CoreDumped: false,
		ClosedBy: "", Failure: &Failure{Stage: stage, Message: message}, DrainCapped: false, DroppedBytes: 0,
	}
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

// Ack tells the host that the client has taken in n more bytes of the session's output. The first call
// makes the client's acknowledgements the only credit that paces the session (see flowControl): it reports
// what the client parsed, which is stronger than what the transport took, and a client that stops
// acknowledging pauses the shell at the high mark. A session that is ending, or that is one of the last
// endedMemory that ended, takes the acknowledgement and credits nothing: the client's last acknowledgement of
// a shell that exited races the CLOSE it is answering. An older session is not remembered and is not found,
// as one that never was.
func (m *Manager) Ack(sessionID string, n int) error {
	if n < 0 {
		return invalidError("bytes must not be negative.")
	}
	m.mu.RLock()
	s := m.sessions[sessionID]
	if s != nil && s.channel != nil {
		s = nil // a channel terminal is nobody's by its id: the call is told what an id that never was is told
	}
	ended := s == nil && slices.Contains(m.ended, sessionID)
	m.mu.RUnlock()
	switch {
	case s != nil && !s.ending.Load():
		s.flow.ack(n)
		return nil
	case s != nil || ended:
		return nil
	default:
		return apperror.SessionNotFound(sessionID)
	}
}

// SetFlowStall states how long a pause on the transport's credit waits before the watchdog steps; zero turns
// the watchdog off. The exec lane never calls it: a test does, before it starts a session.
func (m *Manager) SetFlowStall(stall time.Duration) { m.flowStall = stall }

// newCredit makes the credit of a session, whose watchdog warns in the log when it has to step.
func (m *Manager) newCredit(id string) *flowControl {
	return newFlowControl(m.flowStall, func(stepped int) {
		m.log.Warnw(m.ctx, "no credit came for a terminal's output: the transport did not take it for a while; stepping so that the terminal does not freeze",
			"session", id, "stepped", stepped, "ceiling", FlowStallCeilingBytes)
	})
}

// Delivered tells the host that the transport has taken n bytes of the session's output on their way to the
// client. A sink that implements DeliveryReporter calls it, possibly from another goroutine and later than
// Output returned; it credits the session unless the client has taken over the credit (Ack).
func (m *Manager) Delivered(sessionID string, n int) {
	m.mu.RLock()
	s := m.sessions[sessionID]
	m.mu.RUnlock()
	if s != nil && n > 0 {
		s.flow.delivered(n)
	}
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

// namesTheShellsDirectory says whether path, which exists and is the directory `info`, is where the shell is. Only Linux
// names a removed directory with a ` (deleted)` suffix, and a sibling may be literally named so: there the path is the
// shell's own only when it is the very inode the process's cwd link follows to (`live`). Elsewhere the system's answer
// is taken as it is: a live directory whose name ends so is a real one.
func namesTheShellsDirectory(path string, info os.FileInfo, goos string, live func() (os.FileInfo, error)) bool {
	if goos != "linux" || !strings.HasSuffix(path, " (deleted)") {
		return true
	}
	cwd, err := live()
	return err == nil && os.SameFile(cwd, info)
}

func (s *session) directory() (string, UnknownReason) {
	path, err := processCwd(s.cmd.Process.Pid)
	switch {
	case err == nil:
		// The system still names a directory that was removed under the shell (Linux reads `<path> (deleted)`), and a
		// terminal cannot start in it: a path that is not a directory now is not a fact worth passing on.
		info, statErr := os.Stat(path)
		if statErr != nil || !info.IsDir() {
			return "", ReasonQueryFailed
		}
		if !namesTheShellsDirectory(path, info, runtime.GOOS, func() (os.FileInfo, error) {
			return os.Stat("/proc/" + strconv.Itoa(s.cmd.Process.Pid) + "/cwd")
		}) {
			return "", ReasonQueryFailed
		}
		return path, ""
	case errors.Is(err, errors.ErrUnsupported):
		return "", ReasonUnsupported
	default:
		return "", ReasonQueryFailed
	}
}

// AttachSession marks a session as attached and returns its current output buffer. The caller renders
// the returned buffer; it is not also sent on the output stream, where any viewer already listening
// would print it twice. This matches plugin sessions, whose SDK manager only returns the buffer. An
// attach also forgets the credit debt: the client starts from the buffer, so what was in flight before it,
// and what was emitted while no client was listening, no longer holds the shell.
func (m *Manager) AttachSession(sessionID string) (*sdkexec.Session, []byte, error) {
	s, err := m.live(sessionID)
	if err != nil {
		return nil, nil, err
	}
	data := s.retained()
	s.flow.reset()
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
		if m.dropTombstone(sessionID) {
			// The page that has read how a terminal ended dismisses it.
			return nil
		}
		return err
	}
	s.beginClose(ClosedByRequest)
	m.awaitGone([]*session{s})
	return nil
}

// Shutdown ends every session the way a close does (SIGHUP to the foreground group and the shell, SIGKILL
// at the end of the grace for what ignored it), with ClosedByShutdown, so that the jobs of a shell that
// passes the hangup on end with their terminal, and returns when the sessions are gone or closeWait has
// passed. A shell that is still starting is waited for and ended with the others, and no terminal starts
// after it. The host's own context ending calls it, and so does its service shutdown, which Wails runs
// after cancelling that context.
func (m *Manager) Shutdown() {
	m.mu.Lock()
	m.closing.Store(true)
	// The host is quitting: no page comes back for the end of a terminal, and no timer is left to free it.
	m.tombs = nil
	m.armTombstoneTimerLocked(m.clock.Now())
	m.mu.Unlock()
	m.awaitLaunches()
	m.mu.RLock()
	sessions := make([]*session, 0, len(m.sessions))
	for _, s := range m.sessions {
		sessions = append(sessions, s)
	}
	m.mu.RUnlock()
	for _, s := range sessions {
		s.beginClose(ClosedByShutdown)
	}
	m.awaitGone(sessions)
}

// admitLaunch counts a start in progress, unless the host is shutting down: Shutdown waits for the starts it
// admitted before it began, because a shell that is starting is not in sessions yet.
func (m *Manager) admitLaunch() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closing.Load() || m.ctx.Err() != nil {
		return false
	}
	m.launching.Add(1)
	return true
}

// awaitLaunches waits, for at most closeWait, for the starts in progress to hand their sessions over.
func (m *Manager) awaitLaunches() {
	handed := make(chan struct{})
	go func() {
		m.launching.Wait()
		close(handed)
	}()
	deadline := time.NewTimer(closeWait)
	defer deadline.Stop()
	select {
	case <-handed:
	case <-deadline.C:
		m.log.Warnw(m.ctx, "a terminal was still starting when the host shut down")
	}
}

func (m *Manager) shutdownWhenDone() {
	<-m.ctx.Done()
	m.Shutdown()
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
