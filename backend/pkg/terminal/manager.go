package terminal

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"sync"
	"syscall"

	"github.com/creack/pty"  // Import the pty package for creating pseudo-terminal devices.
	"github.com/google/uuid" // UUID package for generating unique identifiers.

	// Wails runtime for backend-frontend communication.
	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/exec"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

const (
	DefaultLocalShell     = "/bin/zsh"
	DefaultReadBufferSize = 20480
	InitialRows           = 27
	InitialCols           = 72
)

// Manager manages terminal sessions, allowing creation, attachment, and more.
type Manager struct {
	log      *zap.SugaredLogger
	sessions map[string]*sdkexec.Session
	ptys     map[string]*os.File

	inMux     chan sdkexec.StreamInput
	outMux    chan sdkexec.StreamOutput
	resizeMux chan sdkexec.StreamResize
	mux       sync.RWMutex
}

// NewManager initializes a new Manager instance. Because we want to be a bit more
// latency sensitive with the local manager, we're going to directly return
// the channels for in and out that the exec controller will use.
func NewManager(
	log *zap.SugaredLogger,
) (*Manager, chan sdkexec.StreamInput, chan sdkexec.StreamOutput, chan sdkexec.StreamResize) {
	inMux := make(chan sdkexec.StreamInput)
	outMux := make(chan sdkexec.StreamOutput)
	resizeMux := make(chan sdkexec.StreamResize)

	return &Manager{
		log:       log.Named("TerminalManager"),
		sessions:  make(map[string]*sdkexec.Session),
		ptys:      make(map[string]*os.File),
		inMux:     inMux,
		outMux:    outMux,
		resizeMux: resizeMux,
	}, inMux, outMux, resizeMux
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
	m.mux.Lock()
	defer m.mux.Unlock()
	sessions := make([]*sdkexec.Session, 0, len(m.sessions))

	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}

	m.log.Debugw("listed sessions", "sessions", sessions)
	return sessions
}

// StartSession creates a new terminal session with a given command.
func (m *Manager) StartSession(
	pCtx *types.PluginContext,
	opts sdkexec.SessionOptions,
) (*sdkexec.Session, error) {
	logger := m.log.With("action", "StartSession")
	logger.Debugw("starting session", "options", opts, "context", pCtx)

	// Set up the command to run in a new pseudo-terminal.
	ctx, cancel := context.WithCancel(context.Background())

	// determine the default shell from the commands passed in, since we may want to add flags
	shell := DefaultLocalShell
	newopts := []string{}

	if len(opts.Command) > 0 {
		switch opts.Command[0] {
		// test for active shells
		case "zsh":
			shell = "zsh"
			newopts = []string{"--login", "-i"}
			newopts = append(newopts, opts.Command[1:]...)
		case "/bin/zsh":
			shell = "/bin/zsh"
			newopts = []string{"--login", "-i"}
			newopts = append(newopts, opts.Command[1:]...)
		case "bash":
			shell = "bash"
			newopts = []string{"--login"}
			newopts = append(newopts, opts.Command[1:]...)
		case "/bin/bash":
			shell = "/bin/bash"
			newopts = []string{"--login"}
			newopts = append(newopts, opts.Command[1:]...)
		case "sh":
			shell = "sh"
		case "/bin/sh":
			shell = "/bin/sh"
		}
	}

	// start default shell with commands appended to it
	//nolint:gosec // whole point is to get a local shell from the local IDE, so this is just
	// going to be exactly what the user wants
	cmd := exec.CommandContext(ctx, shell, newopts...)

	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, fmt.Sprintf("SHELL=%s", shell), "TERM=xterm-256color")

	if opts.Labels == nil {
		opts.Labels = make(map[string]string)
	}

	ptyFile, err := pty.Start(cmd)
	if err != nil {
		err = apperror.Wrap(err, apperror.TypeSessionFailed, 500, "Failed to start terminal")
		logger.Error(err)
		cancel()
		return nil, err
	}
	// set an initial size for the pty, otherwise we get really weird behavior
	if err = pty.Setsize(ptyFile, &pty.Winsize{Rows: InitialRows, Cols: InitialCols}); err != nil {
		err = apperror.Wrap(err, apperror.TypeSessionFailed, 500, "Failed to configure terminal size")
		cancel()
		return nil, err
	}

	// Generate a unique ID for the session.
	if opts.ID == "" {
		opts.ID = uuid.NewString()
	}

	session := sdkexec.NewSessionFromOpts(ctx, cancel, opts)
	session.SetPty(ptyFile)
	// TODO: separate stderr to the separate stream

	m.mux.Lock()
	logger.Debug("past lock")
	m.sessions[opts.ID] = session
	m.ptys[opts.ID] = ptyFile
	m.mux.Unlock()

	logger.Debugw("session started",
		"session", session,
		"command", session.Command,
	)

	// Start handling terminal output in a separate goroutine.
	go m.handleOutStream(ctx, opts.ID, ptyFile)
	go m.handleSignals(ctx, opts.ID, cmd)
	go m.handleWaitForCompletion(ctx, opts.ID, cmd)

	return session, nil
}

func (m *Manager) ResizeSession(sessionID string, rows, cols uint16) error {
	m.mux.RLock()
	defer m.mux.RUnlock()
	ptyFile, exists := m.ptys[sessionID]
	if !exists {
		err := apperror.SessionNotFound(sessionID)
		m.log.Error(err)
		return err
	}
	if err := pty.Setsize(ptyFile, &pty.Winsize{Rows: rows, Cols: cols}); err != nil {
		m.log.Errorw("error resizing pty", "session", sessionID, "error", err)
		return err
	}
	return nil
}

func (m *Manager) handleWaitForCompletion(_ context.Context, sessionID string, cmd *exec.Cmd) {
	if err := cmd.Wait(); err != nil {
		m.log.Errorw("error waiting for command", "session", sessionID, "error", err)
	}
	m.terminateSession(m.sessions[sessionID])
}

func (m *Manager) handleSignals(ctx context.Context, sessionID string, cmd *exec.Cmd) {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGTERM)
	signal.Notify(ch, syscall.SIGINT)
	signal.Notify(ch, syscall.SIGQUIT)

	defer func() { signal.Stop(ch); close(ch) }()

	for {
		select {
		case sig := <-ch:
			switch sig {
			case syscall.SIGTERM:
				m.log.Debug("SIGTERM received")
				cmd.Process.Signal(syscall.SIGTERM)
			case syscall.SIGINT:
				m.log.Debug("SIGINT received")
				cmd.Process.Signal(syscall.SIGINT)
			case syscall.SIGQUIT:
				m.log.Debug("SIGQUIT received")
				cmd.Process.Signal(syscall.SIGQUIT)
			}
		case <-ctx.Done():
			m.log.Debugw(
				"context cancelled, stopping signal handling",
				"session", sessionID,
			)

			// signal to ide we're done
			m.outMux <- sdkexec.StreamOutput{
				SessionID: sessionID,
				Target:    sdkexec.StreamTargetStdOut,
				Data:      []byte("Session terminated"),
				Signal:    sdkexec.StreamSignalClose,
			}

			return
		}
	}
}

func (m *Manager) handleOutStream(
	_ context.Context,
	sessionID string,
	stream io.Reader,
) {
	session, ok := m.sessions[sessionID]
	if !ok {
		m.log.Errorw("failed to write to session buffer: couldn't find session")
	}
	for {
		buf := make([]byte, DefaultReadBufferSize)
		read, err := stream.Read(buf)
		if err != nil {
			if err != io.EOF {
				m.log.Errorw(
					"error reading from stream",
					"session", sessionID,
					"error", err,
				)
			}

			if session != nil && m.sessions[session.ID] != nil {
				session.Close()
			}

			return
		}

		if len(buf) > 0 {
			m.outMux <- sdkexec.StreamOutput{
				SessionID: sessionID,
				Target:    sdkexec.StreamTargetStdOut,
				Data:      buf[:read],
			}

			session, ok := m.sessions[sessionID]
			if !ok {
				// soft error
				m.log.Errorw("failed to write to session buffer: couldn't find session")
				continue
			}

			session.RecordToBuffer(buf[:read])
		}
	}
}

// WriteToSession writes a string to the session's input.
func (m *Manager) writeToSession(sessionID string, bytes []byte) error {
	m.mux.RLock()
	defer m.mux.RUnlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		err := apperror.SessionNotFound(sessionID)
		m.log.Error(err)
		return err
	}

	if _, err := session.Write(bytes); err != nil {
		m.log.Errorw("error writing to session", "session", sessionID, "error", err)
		return err
	}

	return nil
}

// cleanPTYOutput removes the `%` symbol and its associated escape sequences.
func cleanPTYOutput(output string) string {
	// Define a regex pattern to match the escape sequence for `%`
	pattern := `\x1b\[1m\x1b\[7m%\x1b\[27m\x1b\[1m\x1b\[0m`
	re := regexp.MustCompile(pattern)
	return re.ReplaceAllString(output, "")
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
		m.log.Error(err)
		return nil, nil, err
	}

	// log the buffer data to see what's wrong
	data := session.GetBufferData()
	m.log.Debugf("session buffer data: %q", data)

	// pointer, no need to reassign
	session.Attached = true
	m.outMux <- sdkexec.StreamOutput{
		SessionID: sessionID,
		Target:    sdkexec.StreamTargetStdOut,
		Data:      data,
	}

	m.log.Debugw("session attached", "session", sessionID)
	return session, session.GetBufferData(), nil
}

// DetachFromSession marks a session as not attached, stopping output broadcast.
func (m *Manager) DetachSession(sessionID string) (*sdkexec.Session, error) {
	m.mux.Lock()
	defer m.mux.Unlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		err := apperror.SessionNotFound(sessionID)
		m.log.Error(err)
		return nil, err
	}

	session.Attached = false

	m.log.Debugw("session detached", "session", sessionID)
	return session, nil
}

// CloseSession cancels the session's context, effectively terminating
// its command, and removes it from the manager.
func (m *Manager) CloseSession(sessionID string) error {
	m.mux.Lock()
	defer m.mux.Unlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		err := apperror.SessionNotFound(sessionID)
		m.log.Error(err)
		return err
	}

	m.terminateSession(session)
	return nil
}

func (m *Manager) terminateSession(session *sdkexec.Session) {
	if session == nil {
		return
	}
	session.Close()
	delete(m.sessions, session.ID)
	m.log.Debugw("session terminated", "session", session.ID)
}
