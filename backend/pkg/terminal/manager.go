//go:build !windows

package terminal

import (
	"context"
	"io"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"  // Import the pty package for creating pseudo-terminal devices.
	"github.com/google/uuid" // UUID package for generating unique identifiers.

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/internal/instance"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

const (
	DefaultLocalShell     = "/bin/zsh"
	DefaultReadBufferSize = 20480
	InitialRows           = 27
	InitialCols           = 72

	loginFlag = "--login"
)

// Manager manages terminal sessions, allowing creation, attachment, and more.
type Manager struct {
	ctx      context.Context
	log      logging.Logger
	sessions map[string]*sdkexec.Session
	ptys     map[string]*os.File
	cmds     map[string]*exec.Cmd
	cancels  map[string]context.CancelFunc
	buffers  map[string]*sdkexec.OutputBuffer

	inMux     chan sdkexec.StreamInput
	outMux    chan sdkexec.StreamOutput
	resizeMux chan sdkexec.StreamResize
	mux       sync.RWMutex
}

// NewManager initializes a new Manager instance. Because we want to be a bit more
// latency sensitive with the local manager, we're going to directly return
// the channels for in and out that the exec controller will use.
func NewManager(
	ctx context.Context,
	log logging.Logger,
) (*Manager, chan sdkexec.StreamInput, chan sdkexec.StreamOutput, chan sdkexec.StreamResize) {
	inMux := make(chan sdkexec.StreamInput)
	outMux := make(chan sdkexec.StreamOutput)
	resizeMux := make(chan sdkexec.StreamResize)

	mgr := &Manager{
		mux:       sync.RWMutex{},
		ctx:       ctx,
		log:       log.Named("TerminalManager"),
		sessions:  make(map[string]*sdkexec.Session),
		ptys:      make(map[string]*os.File),
		cmds:      make(map[string]*exec.Cmd),
		cancels:   make(map[string]context.CancelFunc),
		buffers:   make(map[string]*sdkexec.OutputBuffer),
		inMux:     inMux,
		outMux:    outMux,
		resizeMux: resizeMux,
	}

	go mgr.forwardSignals()

	return mgr, inMux, outMux, resizeMux
}

// GetSession returns a session by its ID.
func (m *Manager) GetSession(sessionID string) (*sdkexec.Session, error) {
	m.mux.RLock()
	defer m.mux.RUnlock()
	session, exists := m.sessions[sessionID]
	if !exists {
		return nil, apperror.SessionNotFound(sessionID)
	}
	return session, nil
}

// ListSessions returns a list of details for all active sessions.
func (m *Manager) ListSessions(_ *types.PluginContext) []*sdkexec.Session {
	m.mux.RLock()
	defer m.mux.RUnlock()
	sessions := make([]*sdkexec.Session, 0, len(m.sessions))

	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}

	m.log.Debugw(context.Background(), "listed sessions", "count", len(sessions))
	return sessions
}

// resolveShell determines the shell to run from the requested command, adding login flags
// for shells that support them. Unknown commands fall back to DefaultLocalShell with no args.
func resolveShell(command []string) (string, []string) {
	shell := DefaultLocalShell
	newopts := []string{}

	if len(command) > 0 {
		switch command[0] {
		// test for active shells
		case "zsh", "/bin/zsh":
			shell = command[0]
			newopts = []string{loginFlag, "-i"}
			newopts = append(newopts, command[1:]...)
		case "bash", "/bin/bash":
			shell = command[0]
			newopts = []string{loginFlag}
			newopts = append(newopts, command[1:]...)
		case "sh", "/bin/sh":
			shell = command[0]
		}
	}

	return shell, newopts
}

// StartSession creates a new terminal session with a given command.
func (m *Manager) StartSession(
	_ *types.PluginContext,
	opts sdkexec.SessionOptions,
) (*sdkexec.Session, error) {
	logger := m.log.With(logging.Any("action", "StartSession"))
	logger.Debugw(context.Background(), "starting session", "command", opts.Command, "tty", opts.TTY)

	// Derive from manager context so shutdown cascades to all sessions.
	ctx, cancel := context.WithCancel(m.ctx)

	shell, newopts := resolveShell(opts.Command)

	// start default shell with commands appended to it. The whole point is to get a local
	// shell from the local IDE, so this is going to be exactly what the user wants.
	cmd := exec.CommandContext(ctx, shell, newopts...)

	childEnvironment, err := instance.RestoreNativeChildEnvironment(os.Environ())
	if err != nil {
		cancel()
		return nil, err
	}
	cmd.Env = childEnvironment
	cmd.Env = append(cmd.Env, "SHELL="+shell, "TERM=xterm-256color")

	if opts.Labels == nil {
		opts.Labels = make(map[string]string)
	}

	// Start with an initial size so the pty never runs unsized (which renders badly)
	// and there is no failure path between starting the process and tracking it.
	ptyFile, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: InitialRows, Cols: InitialCols, X: 0, Y: 0})
	if err != nil {
		err = apperror.Wrap(err, apperror.TypeSessionFailed, http.StatusInternalServerError, "Failed to start terminal")
		logger.Errorw(ctx, "failed to start terminal", "error", err)
		cancel()
		return nil, err
	}

	// Generate a unique ID for the session.
	if opts.ID == "" {
		opts.ID = uuid.NewString()
	}

	session := &sdkexec.Session{
		ID:        opts.ID,
		Command:   opts.Command,
		Labels:    opts.Labels,
		Params:    opts.Params,
		Attached:  false,
		CreatedAt: time.Now(),
	}

	m.mux.Lock()
	m.sessions[opts.ID] = session
	m.ptys[opts.ID] = ptyFile
	m.cmds[opts.ID] = cmd
	m.cancels[opts.ID] = cancel
	m.buffers[opts.ID] = sdkexec.NewDefaultOutputBuffer()
	m.mux.Unlock()

	logger.Debugw(ctx, "session started",
		"session", session,
		"command", session.Command,
	)

	// Start handling terminal output in a separate goroutine.
	go m.handleOutStream(ctx, opts.ID, ptyFile)
	go m.handleSessionClose(ctx, opts.ID)
	go m.handleWaitForCompletion(ctx, opts.ID, cmd)

	return session, nil
}

func (m *Manager) ResizeSession(sessionID string, rows, cols uint16) error {
	m.mux.RLock()
	defer m.mux.RUnlock()
	ptyFile, exists := m.ptys[sessionID]
	if !exists {
		err := apperror.SessionNotFound(sessionID)
		m.log.Errorw(context.Background(), "session not found", "error", err)
		return err
	}
	if err := pty.Setsize(ptyFile, &pty.Winsize{Rows: rows, Cols: cols, X: 0, Y: 0}); err != nil {
		m.log.Errorw(context.Background(), "error resizing pty", "session", sessionID, "error", err)
		return err
	}
	return nil
}

func (m *Manager) handleWaitForCompletion(_ context.Context, sessionID string, cmd *exec.Cmd) {
	if err := cmd.Wait(); err != nil {
		m.log.Errorw(context.Background(), "error waiting for command", "session", sessionID, "error", err)
	}
	m.terminateSession(sessionID)
}

// forwardSignals listens for host-process signals once and forwards them to
// all active terminal child processes. Runs for the lifetime of the Manager.
func (m *Manager) forwardSignals() {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGTERM, syscall.SIGINT, syscall.SIGQUIT)
	defer signal.Stop(ch)

	for {
		select {
		case sig := <-ch:
			m.mux.RLock()
			for sid, cmd := range m.cmds {
				if cmd.Process != nil {
					if err := cmd.Process.Signal(sig); err != nil {
						m.log.Debugw(context.Background(), "failed to forward signal",
							"signal", sig, "session", sid, "error", err)
					}
				}
			}
			m.mux.RUnlock()
		case <-m.ctx.Done():
			return
		}
	}
}

// handleSessionClose waits for a session's context to be cancelled and emits
// a CLOSE signal to the frontend.
func (m *Manager) handleSessionClose(ctx context.Context, sessionID string) {
	<-ctx.Done()
	m.outMux <- sdkexec.StreamOutput{
		SessionID: sessionID,
		Target:    sdkexec.StreamTargetStdOut,
		Data:      []byte("Session terminated"),
		Signal:    sdkexec.StreamSignalClose,
		Error:     nil,
	}
}

func (m *Manager) handleOutStream(
	_ context.Context,
	sessionID string,
	stream io.Reader,
) {
	for {
		buf := make([]byte, DefaultReadBufferSize)
		read, err := stream.Read(buf)
		if err != nil {
			if err != io.EOF {
				m.log.Errorw(context.Background(),
					"error reading from stream",
					"session", sessionID,
					"error", err,
				)
			}

			m.mux.RLock()
			_, exists := m.sessions[sessionID]
			m.mux.RUnlock()
			if exists {
				m.terminateSession(sessionID)
			}

			return
		}

		if len(buf) > 0 {
			m.outMux <- sdkexec.StreamOutput{
				SessionID: sessionID,
				Target:    sdkexec.StreamTargetStdOut,
				Data:      buf[:read],
				Signal:    sdkexec.StreamSignalNone,
				Error:     nil,
			}

			m.mux.RLock()
			buffer, ok := m.buffers[sessionID]
			m.mux.RUnlock()
			if !ok {
				// soft error
				m.log.Errorw(context.Background(), "failed to write to session buffer: couldn't find session")
				continue
			}

			buffer.Append(buf[:read])
		}
	}
}

// WriteToSession writes a string to the session's input.
func (m *Manager) writeToSession(sessionID string, bytes []byte) error {
	m.mux.RLock()
	defer m.mux.RUnlock()

	ptyFile, exists := m.ptys[sessionID]
	if !exists {
		err := apperror.SessionNotFound(sessionID)
		m.log.Errorw(context.Background(), "session not found", "error", err)
		return err
	}

	if _, err := ptyFile.Write(bytes); err != nil {
		m.log.Errorw(context.Background(), "error writing to session", "session", sessionID, "error", err)
		return err
	}

	return nil
}

// WriteSession writes data to the session's input.
func (m *Manager) WriteSession(sessionID string, input []byte) error {
	return m.writeToSession(sessionID, input)
}

// AttachToSession marks a session as attached and returns its current output buffer.
func (m *Manager) AttachSession(sessionID string) (*sdkexec.Session, []byte, error) {
	m.mux.Lock()
	defer m.mux.Unlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		err := apperror.SessionNotFound(sessionID)
		m.log.Errorw(context.Background(), "session not found", "error", err)
		return nil, nil, err
	}

	buffer := m.buffers[sessionID]
	var data []byte
	if buffer != nil {
		data = buffer.GetAll()
	}
	m.log.Debugw(context.Background(), "session buffer loaded", "session", sessionID, "bufferSize", len(data))

	// pointer, no need to reassign
	session.Attached = true
	m.outMux <- sdkexec.StreamOutput{
		SessionID: sessionID,
		Target:    sdkexec.StreamTargetStdOut,
		Data:      data,
		Signal:    sdkexec.StreamSignalNone,
		Error:     nil,
	}

	m.log.Debugw(context.Background(), "session attached", "session", sessionID)
	return session, data, nil
}

// DetachFromSession marks a session as not attached, stopping output broadcast.
func (m *Manager) DetachSession(sessionID string) (*sdkexec.Session, error) {
	m.mux.Lock()
	defer m.mux.Unlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		err := apperror.SessionNotFound(sessionID)
		m.log.Errorw(context.Background(), "session not found", "error", err)
		return nil, err
	}

	session.Attached = false

	m.log.Debugw(context.Background(), "session detached", "session", sessionID)
	return session, nil
}

// CloseSession cancels the session's context, effectively terminating
// its command, and removes it from the manager.
func (m *Manager) CloseSession(sessionID string) error {
	m.mux.Lock()
	defer m.mux.Unlock()

	_, exists := m.sessions[sessionID]
	if !exists {
		err := apperror.SessionNotFound(sessionID)
		m.log.Errorw(context.Background(), "session not found", "error", err)
		return err
	}

	m.terminateSessionLocked(sessionID)
	return nil
}

// terminateSession acquires the lock and terminates the session.
func (m *Manager) terminateSession(sessionID string) {
	m.mux.Lock()
	defer m.mux.Unlock()
	m.terminateSessionLocked(sessionID)
}

// terminateSessionLocked terminates a session. Caller must hold m.mux.
func (m *Manager) terminateSessionLocked(sessionID string) {
	if cancel, ok := m.cancels[sessionID]; ok {
		cancel()
	}
	if ptyFile, ok := m.ptys[sessionID]; ok {
		ptyFile.Close()
	}
	delete(m.sessions, sessionID)
	delete(m.ptys, sessionID)
	delete(m.cmds, sessionID)
	delete(m.cancels, sessionID)
	delete(m.buffers, sessionID)
	m.log.Debugw(context.Background(), "session terminated", "session", sessionID)
}
