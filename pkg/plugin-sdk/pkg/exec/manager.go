package exec

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/google/uuid"
	"github.com/hashicorp/go-hclog"
	"github.com/omniviewdev/settings"
	"golang.org/x/term"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

const (
	DefaultOutputBufferSize = 1000000
	DefaultStreamBufferSize = 4096
	InitialRows             = 27
	InitialCols             = 72
	ResizeTimeout           = 500 * time.Millisecond
)

// Manager manages the lifecycle of the terminal sessions.
type Manager struct {
	log              hclog.Logger
	settingsProvider settings.Provider
	sessions         map[string]*Session
	handlers         map[string]Handler
	out              chan StreamOutput
	resize           chan StreamResize
	mux              sync.Mutex
}

var _ Provider = (*Manager)(nil)

// NewManager initializes a new Manager instance.
func NewManager(
	log hclog.Logger,
	sp settings.Provider,
	handlers map[string]Handler,
) *Manager {
	return &Manager{
		log:              hclog.Default().With("service", "ExecManager"),
		settingsProvider: sp,
		sessions:         make(map[string]*Session),
		handlers:         handlers,
		out:              make(chan StreamOutput, DefaultStreamBufferSize),
		resize:           make(chan StreamResize),
	}
}

func (m *Manager) GetSupportedResources(_ *types.PluginContext) []Handler {
	resources := make([]Handler, 0, len(m.handlers))
	for _, handler := range m.handlers {
		resources = append(resources, handler)
	}
	return resources
}

// Stream creates a new stream to multiplex sessions.
func (m *Manager) Stream(ctx context.Context, in chan StreamInput) (chan StreamOutput, error) {
	go func(in chan StreamInput) {
		for {
			select {
			case <-ctx.Done():
				// terminate all of the active sessions
				for _, session := range m.sessions {
					m.terminateSession(session)
				}
				return

			case input := <-in:
				logger := m.log.With("session", input.SessionID)
				logger.Debug("received stream input")

				session, exists := m.sessions[input.SessionID]
				if !exists {
					logger.Error("session not found")
					continue
				}

				if err := m.writeToSession(session, input.Data); err != nil {
					logger.Error("error writing to session", "error", err)
				}

			case resize := <-m.resize:
				logger := m.log.With("session", resize.SessionID)
				logger.Debug("received stream resize")

				session, exists := m.sessions[resize.SessionID]
				if !exists {
					logger.Error("session not found")
					continue
				}

				if session.ttyResize {
					err := pty.Setsize(
						session.pty,
						&pty.Winsize{Rows: resize.Rows, Cols: resize.Cols},
					)
					if err != nil {
						logger.Error("failed to set pty size", "error", err)
					}
				} else {
					select {
					case session.resize <- SessionResizeInput{Cols: int32(resize.Cols), Rows: int32(resize.Rows)}:
					case <-time.After(ResizeTimeout):
						logger.Error("timeout resizing session")
					}
				}
			}
		}
	}(in)

	return m.out, nil
}

// GetSession returns a session by ID.
func (m *Manager) GetSession(
	_ *types.PluginContext,
	sessionID string,
) (*Session, error) {
	m.mux.Lock()
	defer m.mux.Unlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		err := fmt.Errorf("session %s not found", sessionID)
		m.log.Error("session not found", "error", err)
		return nil, err
	}
	return session, nil
}

// ListSessions returns a list of details for all active sessions.
func (m *Manager) ListSessions(_ *types.PluginContext) ([]*Session, error) {
	m.mux.Lock()
	defer m.mux.Unlock()
	sessions := make([]*Session, 0, len(m.sessions))

	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}

	return sessions, nil
}

// CreateSession creates a new terminal session with a given command.
func (m *Manager) CreateSession(
	pluginctx *types.PluginContext,
	opts SessionOptions,
) (*Session, error) {
	logger := m.log.With(
		"resource", opts.ResourceKey,
		"params", opts.Params,
		"labels", opts.Labels,
	)

	// Check if the session handler is set
	handler, ok := m.handlers[opts.ResourcePlugin+"/"+opts.ResourceKey]
	if !ok {
		registeredHandlers := make([]string, 0, len(m.handlers))
		for k := range m.handlers {
			registeredHandlers = append(registeredHandlers, k)
		}
		msg := fmt.Sprintf(
			"session handler not set, available handlers: %v",
			registeredHandlers,
		)
		logger.Error(msg)
		return nil, errors.New(msg)
	}

	if opts.ID != "" && m.sessions[opts.ID] != nil {
		msg := fmt.Sprintf("session with ID %s already exists", opts.ID)
		logger.Error(msg)
		return nil, errors.New(msg)
	}
	if opts.ID == "" {
		opts.ID = uuid.NewString()
	}

	// set up the context the handler relies on
	ctx, cancel := context.WithCancel(context.Background())
	pluginctx.Context = ctx
	pluginctx.SetSettingsProvider(m.settingsProvider)

	resizeChan := make(chan SessionResizeInput)
	stopChan := make(chan error, 1)

	ptyFile, ttyFile, err := pty.Open()
	if err != nil {
		msg := fmt.Sprintf("failed to open pty: %v", err)
		logger.Error(msg)
		cancel()
		return nil, errors.New(msg)
	}

	// Set slave TTY to raw mode to disable local echo. This makes the PTY a
	// transparent byte pipe — only the remote side (e.g. bash in a K8s pod)
	// will echo input, preventing the double-echo bug.
	if _, err = term.MakeRaw(int(ttyFile.Fd())); err != nil {
		msg := fmt.Sprintf("failed to set tty to raw mode: %v", err)
		logger.Error(msg)
		cancel()
		return nil, errors.New(msg)
	}

	if err = pty.Setsize(ptyFile, &pty.Winsize{Rows: InitialRows, Cols: InitialCols}); err != nil {
		msg := fmt.Sprintf("failed to set initial pty size: %v", err)
		logger.Error(msg)
		cancel()
		return nil, errors.New(msg)
	}

	if err = handler.TTYHandler(pluginctx, opts, ttyFile, stopChan, resizeChan); err != nil {
		msg := fmt.Sprintf("failed to handle TTY: %v", err)
		logger.Error(msg)
		cancel()
		return nil, errors.New(msg)
	}

	session := &Session{
		ID:        opts.ID,
		ctx:       ctx,
		cancel:    cancel,
		stopChan:  stopChan,
		tty:       ttyFile,
		ttyResize: !handler.HandlesResize,
		pty:       ptyFile,
		resize:    resizeChan,
		buffer:    NewOutputBuffer(DefaultOutputBufferSize),
		Attached:  false,
		Labels:    opts.Labels,
		Params:    opts.Params,
		Command:   opts.Command,
		CreatedAt: time.Now(),
	}

	m.mux.Lock()
	m.sessions[opts.ID] = session
	m.mux.Unlock()

	logger.Debug("session created", "session", opts.ID)

	// start handling the output streams
	go m.handleStream(session)
	go m.handleSignals(session)

	return session, nil
}

func (m *Manager) handleSignals(session *Session) {
	logger := m.log.With("session", session.ID)

	for {
		select {
		case err := <-session.stopChan:
			logger.Debug("stop channel received, stopping read stream handling")

			m.mux.Lock()
			defer m.mux.Unlock()

			// cleanup
			session.pty.Close()
			session.tty.Close()
			delete(m.sessions, session.ID)

			// if the handler sent an error, emit a structured ERROR signal first
			if err != nil {
				var streamErr *StreamError
				var execErr *ExecError
				if errors.As(err, &execErr) {
					streamErr = &StreamError{
						Title:         execErr.Title,
						Message:       execErr.Message,
						Suggestion:    execErr.Suggestion,
						Retryable:     execErr.Retryable,
						RetryCommands: execErr.RetryCommands,
					}
				} else {
					streamErr = &StreamError{
						Title:      "Session failed",
						Message:    err.Error(),
						Suggestion: "The exec session terminated unexpectedly.",
						Retryable:  true,
					}
				}
				m.out <- StreamOutput{
					SessionID: session.ID,
					Target:    StreamTargetStdErr,
					Data:      []byte(err.Error()),
					Signal:    StreamSignalError,
					Error:     streamErr,
				}
			}

			// signal to ide we're done
			m.out <- StreamOutput{
				SessionID: session.ID,
				Target:    StreamTargetStdOut,
				Data:      []byte("\nSession closed\n"),
				Signal:    StreamSignalClose,
			}

			return
		case <-session.ctx.Done():
			logger.Debug("context cancelled, stopping read stream handling")

			m.mux.Lock()
			defer m.mux.Unlock()

			// cleanup
			session.pty.Close()
			session.tty.Close()
			delete(m.sessions, session.ID)

			// signal to ide we're done
			m.out <- StreamOutput{
				SessionID: session.ID,
				Target:    StreamTargetStdOut,
				Data:      []byte("Session terminated"),
				Signal:    StreamSignalClose,
			}

			return
		}
	}
}

func (m *Manager) handleStream(session *Session) {
	logger := m.log.With("session", session.ID)

	for {
		buf := make([]byte, DefaultStreamBufferSize)
		read, err := session.pty.Read(buf)
		if err != nil {
			if err != io.EOF {
				logger.Error("error reading from pty", "error", err)
				return
			}

			logger.Debug("EOF reached, terminating session")
			if session != nil && m.sessions[session.ID] != nil {
				session.cancel()
			}
			return
		}

		if read > 0 {
			target := StreamTargetStdOut
			m.out <- StreamOutput{
				SessionID: session.ID,
				Target:    target,
				Data:      buf[:read],
			}

			m.recordToBuffer(session, buf[:read])
		}
	}
}

func (m *Manager) recordToBuffer(
	session *Session,
	bytes []byte,
) {
	m.mux.Lock()
	defer m.mux.Unlock()

	session.RecordToBuffer(bytes)
}

// WriteToSession writes a string to the session's input.
func (m *Manager) writeToSession(session *Session, bytes []byte) error {
	if session == nil {
		return errors.New("session is nil")
	}

	m.mux.Lock()
	defer m.mux.Unlock()

	if _, err := session.Write(bytes); err != nil {
		msg := fmt.Sprintf("error writing to session %s: %v", session.ID, err)
		m.log.Error(msg)
		return errors.New(msg)
	}

	return nil
}

// AttachToSession marks a session as attached and returns its current output buffer.
func (m *Manager) AttachSession(
	_ *types.PluginContext,
	sessionID string,
) (*Session, []byte, error) {
	m.mux.Lock()
	defer m.mux.Unlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		msg := fmt.Sprintf("session %s not found", sessionID)
		m.log.Error(msg)
		return nil, nil, errors.New(msg)
	}

	session.Attached = true
	m.log.Debug("session attached", "session", sessionID)

	return session, session.buffer.GetAll(), nil
}

// DetachFromSession marks a session as not attached, stopping output broadcast.
func (m *Manager) DetachSession(_ *types.PluginContext, sessionID string) (*Session, error) {
	m.mux.Lock()
	defer m.mux.Unlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		msg := fmt.Sprintf("session %s not found", sessionID)
		m.log.Error(msg)
		return nil, errors.New(msg)
	}

	session.Attached = false
	m.log.Debug("session detached", "session", sessionID)
	return session, nil
}

// CloseSession cancels the session's context, effectively terminating
// its command, and removes it from the manager.
func (m *Manager) CloseSession(_ *types.PluginContext, sessionID string) error {
	m.mux.Lock()
	defer m.mux.Unlock()

	session, exists := m.sessions[sessionID]
	if !exists {
		msg := fmt.Sprintf("session %s not found", sessionID)
		m.log.Error(msg)
		return errors.New(msg)
	}

	m.terminateSession(session)
	return nil
}

func (m *Manager) terminateSession(session *Session) {
	session.cancel()
	m.log.Debug("session terminated", "session", session.ID)
}

// ResizeSession resizes a session.
func (m *Manager) ResizeSession(
	_ *types.PluginContext,
	sessionID string,
	rows, cols int32,
) error {
	m.resize <- StreamResize{
		SessionID: sessionID,
		Rows:      uint16(rows),
		Cols:      uint16(cols),
	}
	return nil
}
