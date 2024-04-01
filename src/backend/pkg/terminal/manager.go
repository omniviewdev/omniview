package terminal

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
			ID: id,
			Command: fmt.Sprintf(
				"%s %s",
				session.cmd.Path,
				strings.Join(session.cmd.Args[1:], " "),
			),
			Attached: session.attached,
			Labels:   session.labels,
		})
	}
	tm.log.Debugw("listed sessions", "sessions", sessions)
	return sessions
}

// StartSession creates a new terminal session with a given command.
func (tm *TerminalManager) StartSession(
	command []string,
	opts TerminalSessionOptions,
) (string, error) {
	tm.log.Debugw("starting session", "command", command, "options", opts)

	// Set up the command to run in a new pseudo-terminal.
	ctx, cancel := context.WithCancel(context.Background())

	// start default shell with commands appended to it
	cmd := exec.CommandContext(ctx, "zsh", command...)
	cmd.Env = os.Environ()
	cmd.Env = append(cmd.Env, "TERM=xterm-256color")

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
	if opts.ID == "" {
		opts.ID = uuid.NewString()
	}

	session := &TerminalSession{
		ID:       opts.ID,
		cmd:      cmd,
		ptyFile:  ptyFile,
		ctx:      ctx,
		cancel:   cancel,
		buffer:   NewOutputBuffer(1000000),
		attached: false,
		labels:   opts.Labels,
	}

	tm.mux.Lock()
	tm.sessions[opts.ID] = session
	tm.mux.Unlock()

	tm.log.Debugw("session started", "session", opts.ID, "command", command)

	// Start handling terminal output in a separate goroutine.
	go tm.handleIO(opts.ID)

	return opts.ID, nil
}

// handleIO reads output from the session's pty and stores it in the output buffer.
// If the session is attached, it also broadcasts the output to the frontend.
func (tm *TerminalManager) handleIO(sessionID string) {
	tm.log.Debugw("handling io for session", "session", sessionID)

	tm.mux.Lock()
	session, ok := tm.sessions[sessionID]
	tm.mux.Unlock()

	eventKey := "core/terminal/" + sessionID

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

// SetTTYSize sets the terminal size for a session.
func (tm *TerminalManager) SetTTYSize(sessionID string, rows, cols uint16) error {
	tm.mux.Lock()
	defer tm.mux.Unlock()
	session, exists := tm.sessions[sessionID]
	if !exists {
		err := fmt.Errorf("session %s not found", sessionID)
		tm.log.Error(err)
		return err
	}
	if err := pty.Setsize(session.ptyFile, &pty.Winsize{Rows: rows, Cols: cols}); err != nil {
		err = fmt.Errorf("failed to set terminal size: %w", err)
		tm.log.Error(err)
		return err
	}
	return nil
}
