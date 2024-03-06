package services

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"

	"github.com/creack/pty"                    // Import the pty package for creating pseudo-terminal devices.
	"github.com/google/uuid"                   // UUID package for generating unique identifiers.
	"github.com/wailsapp/wails/v2/pkg/runtime" // Wails runtime for backend-frontend communication.
	"go.uber.org/zap"
)

// OutputBuffer stores terminal output lines, providing a fixed-size cyclic buffer.
type OutputBuffer struct {
	buf      []byte     // The buffer.
	capacity int        // maximum number of bytes to store.
	lock     sync.Mutex // Protect concurrent access to lines.
}

// NewOutputBuffer initializes an OutputBuffer with a specified capacity.
func NewOutputBuffer(capacity int) *OutputBuffer {
	return &OutputBuffer{
		buf:      make([]byte, 0, capacity),
		capacity: capacity,
	}
}

// Append adds a line to the buffer, managing overflow by removing the oldest line.
func (b *OutputBuffer) Append(data []byte) {
	b.lock.Lock()
	defer b.lock.Unlock()
	// If the new data will exceed the buffer's capacity, remove the oldest data to make room.
	if len(b.buf)+len(data) > b.capacity {
		b.buf = b.buf[len(data):]
	}
	b.buf = append(b.buf, data...)
}

// GetAll retrieves a copy of all stored lines in the buffer.
func (b *OutputBuffer) GetAll() []byte {
	b.lock.Lock()
	defer b.lock.Unlock()
	return append([]byte(nil), b.buf...) // Return a copy to avoid external modifications.
}

// TerminalSession represents an individual terminal session.
type TerminalSession struct {
	cmd      *exec.Cmd          // The command being run in this session.
	ptyFile  *os.File           // File descriptor for the pseudo-terminal device.
	buffer   *OutputBuffer      // Stores session output for retrieval upon reattachment.
	labels   map[string]string  // Labels for the session.
	ctx      context.Context    // Context to control the lifetime of the session.
	cancel   context.CancelFunc // Function to cancel the context, terminating the session.
	ID       string
	attached bool // Indicates if the session is currently broadcasting output.
}

// TerminalSessionOptions contains options for creating a new terminal session.
type TerminalSessionOptions struct {
	// Labels are arbitrary key-value pairs for the session that can be used to filter sessions, or
	// to provide additional information about the session.
	Labels map[string]string `json:"labels"`
	// Kubeconfig is the path to the kubeconfig file.
	Kubeconfig string `json:"kubeconfig"`
	// Context is the name of the context to use.
	Context string `json:"context"`
}

// TerminalSessionDetails contains details about a terminal session.
type TerminalSessionDetails struct {
	// Labels are key-value pairs for the session.
	Labels map[string]string `json:"labels"`
	// ID is the unique identifier for the session.
	ID string `json:"id"`
	// Command is the command being run in the session.
	Command string `json:"command"`
	// Attached indicates if the session is currently broadcasting output.
	Attached bool `json:"attached"`
}

// TerminalManager manages terminal sessions, allowing creation, attachment, and more.
type TerminalManager struct {
	wailsCtx context.Context             // Wails context for sending events to the frontend.
	log      *zap.SugaredLogger          // Logger for the terminal manager.
	sessions map[string]*TerminalSession // Maps session IDs to TerminalSession instances.
	mux      sync.Mutex                  // Protects access to the sessions map.
}

// NewTerminalManager initializes a new TerminalManager instance.
func NewTerminalManager(log *zap.SugaredLogger) *TerminalManager {
	return &TerminalManager{
		log:      log.With("service", "TerminalManager"),
		sessions: make(map[string]*TerminalSession),
	}
}

// Run starts the TerminalManager, allowing it to handle terminal sessions.
func (tm *TerminalManager) Run(ctx context.Context) {
	// for now, just set the context. eventually we'll use the context channel to listen for updates
	// and do management
	tm.wailsCtx = ctx
}

// ListSessions returns a list of details for all active sessions.
func (tm *TerminalManager) ListSessions() []TerminalSessionDetails {
	tm.mux.Lock()
	defer tm.mux.Unlock()
	sessions := make([]TerminalSessionDetails, 0, len(tm.sessions))

	for id, session := range tm.sessions {
		sessions = append(sessions, TerminalSessionDetails{
			ID:       id,
			Command:  fmt.Sprintf("%s %s", session.cmd.Path, strings.Join(session.cmd.Args[1:], " ")),
			Attached: session.attached,
			Labels:   session.labels,
		})
	}
	tm.log.Debugw("listed sessions", "sessions", sessions)
	return sessions
}

// StartSession creates a new terminal session with a given command.
func (tm *TerminalManager) StartSession(command []string, opts TerminalSessionOptions) (string, error) {
	tm.log.Debugw("starting session", "command", command, "options", opts)

	// Set up the command to run in a new pseudo-terminal.
	ctx, cancel := context.WithCancel(context.Background())

	// start default shell with commands appended to it
	cmd := exec.CommandContext(ctx, "zsh", command...)
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	if opts.Labels == nil {
		opts.Labels = make(map[string]string)
	}

	if opts.Kubeconfig != "" {
		cmd.Env = append(cmd.Env, fmt.Sprintf("KUBECONFIG=%s", opts.Kubeconfig))
		opts.Labels["kubeconfig"] = opts.Kubeconfig
	}
	if opts.Context != "" {
		cmd.Env = append(cmd.Env, fmt.Sprintf("KUBECONTEXT=%s", opts.Context))
		opts.Labels["context"] = opts.Context
	}

	ptyFile, err := pty.Start(cmd)
	if err != nil {
		err = fmt.Errorf("failed to start pty in terminal manager: %w", err)
		tm.log.Error(err)
		cancel()
		return "", err
	}

	// Generate a unique ID for the session.
	sessionID := uuid.NewString()
	session := &TerminalSession{
		ID:       sessionID,
		cmd:      cmd,
		ptyFile:  ptyFile,
		ctx:      ctx,
		cancel:   cancel,
		buffer:   NewOutputBuffer(1000000),
		attached: false,
		labels:   opts.Labels,
	}

	tm.mux.Lock()
	tm.sessions[sessionID] = session
	tm.mux.Unlock()

	tm.log.Debugw("session started", "session", sessionID, "command", command)

	// Start handling terminal output in a separate goroutine.
	go tm.handleIO(sessionID)

	return sessionID, nil
}

// handleIO reads output from the session's pty and stores it in the output buffer.
// If the session is attached, it also broadcasts the output to the frontend.
func (tm *TerminalManager) handleIO(sessionID string) {
	tm.log.Debugw("handling io for session", "session", sessionID)

	tm.mux.Lock()
	session, ok := tm.sessions[sessionID]
	tm.mux.Unlock()

	eventKey := fmt.Sprintf("terminal::%s", sessionID)

	if !ok {
		tm.log.Errorw("session not found", "session", sessionID)
		return
	}

	tm.log.Debugw("starting io handling for session", "session", sessionID)
	for {
		buf := make([]byte, 20480)
		n, err := session.ptyFile.Read(buf)
		if err != nil {
			if !errors.Is(err, io.EOF) {
				tm.log.Errorw("read error in terminal session", "session", sessionID, "error", err)
				runtime.LogErrorf(tm.wailsCtx, "read error: %s", err)
				continue
			}

			// If the session has been terminated, remove it from the manager and stop handling IO.
			// in this goroutine.
			tm.mux.Lock()
			delete(tm.sessions, sessionID)
			tm.mux.Unlock()
			tm.log.Debugw("session terminated", "session", sessionID)

			break
		}

		session.buffer.Append(buf[:n])
		if session.attached {
			// Broadcast output to the frontend.
			runtime.EventsEmit(tm.wailsCtx, eventKey, buf[:n])
		}
	}
}

// WriteToSession writes a string to the session's input.
func (tm *TerminalManager) WriteToSession(sessionID string, input string) error {
	tm.mux.Lock()
	session, exists := tm.sessions[sessionID]
	tm.mux.Unlock()

	if !exists {
		err := fmt.Errorf("session %s not found", sessionID)
		tm.log.Error(err)
		return err
	}
	_, err := session.ptyFile.Write([]byte(input))
	return err
}

// AttachToSession marks a session as attached and returns its current output buffer.
func (tm *TerminalManager) AttachToSession(sessionID string) ([]byte, error) {
	tm.mux.Lock()
	defer tm.mux.Unlock()

	session, exists := tm.sessions[sessionID]
	if !exists {
		err := fmt.Errorf("session %s not found", sessionID)
		tm.log.Error(err)
		return nil, err
	}

	session.attached = true
	tm.log.Debugw("session attached", "session", sessionID)
	return session.buffer.GetAll(), nil
}

// DetachFromSession marks a session as not attached, stopping output broadcast.
func (tm *TerminalManager) DetachFromSession(sessionID string) error {
	tm.mux.Lock()
	defer tm.mux.Unlock()

	session, exists := tm.sessions[sessionID]
	if !exists {
		err := fmt.Errorf("session %s not found", sessionID)
		tm.log.Error(err)
		return err
	}

	session.attached = false
	tm.log.Debugw("session detached", "session", sessionID)
	return nil
}

// TerminateSession cancels the session's context, effectively terminating
// its command, and removes it from the manager.
func (tm *TerminalManager) TerminateSession(sessionID string) error {
	tm.mux.Lock()
	defer tm.mux.Unlock()

	session, exists := tm.sessions[sessionID]
	if !exists {
		err := fmt.Errorf("session %s not found", sessionID)
		tm.log.Error(err)
		return err
	}

	session.cancel()               // Terminates the command by canceling its context.
	delete(tm.sessions, sessionID) // Removes the session from management.
	tm.log.Debugw("session terminated", "session", sessionID)
	return nil
}
