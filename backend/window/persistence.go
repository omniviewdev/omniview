package window

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// SessionFileName is the session file name inside the state root.
const SessionFileName = "windows.json"

// sessionSaveDelay debounces session writes so bursts of state saves and
// move/resize events produce one write.
const sessionSaveDelay = 500 * time.Millisecond

// corruptSessionSuffix is appended to a session file that failed to load.
const corruptSessionSuffix = ".bak"

// sessionFileMode keeps the session private to the user.
const sessionFileMode = 0o600

// Bounds is a window's OS frame in screen DIP.
type Bounds struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

// persistedWindow is one restorable non-main window.
type persistedWindow struct {
	Name   string  `json:"name"`
	Kind   Kind    `json:"kind"`
	Bounds *Bounds `json:"bounds,omitempty"`
}

// persistedSession is the content of windows.json.
type persistedSession struct {
	Windows []persistedWindow `json:"windows"`
	// States maps window name -> slot -> JSON.
	States map[string]map[string]string `json:"states"`
}

func emptySession() persistedSession {
	return persistedSession{Windows: []persistedWindow{}, States: map[string]map[string]string{}}
}

// validate rejects sessions that cannot be restored faithfully.
func (session persistedSession) validate() error {
	seen := make(map[string]struct{}, len(session.Windows))
	for _, window := range session.Windows {
		if window.Name == "" || window.Name == MainWindowName {
			return fmt.Errorf("window name %q is not restorable", window.Name)
		}
		if !window.Kind.isValid() {
			return fmt.Errorf("window %q: %w %q", window.Name, ErrInvalidKind, window.Kind)
		}
		if _, duplicate := seen[window.Name]; duplicate {
			return fmt.Errorf("window %q is listed twice", window.Name)
		}
		seen[window.Name] = struct{}{}
	}
	return nil
}

// loadSessionFile reads the session at path. A missing file yields an empty
// session. A file that cannot be decoded is moved aside to path+".bak" and an
// empty session is returned together with the error describing the corruption.
func loadSessionFile(path string) (persistedSession, error) {
	content, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return emptySession(), nil
	}
	if err != nil {
		return emptySession(), fmt.Errorf("read window session %s: %w", path, err)
	}

	session := emptySession()
	decodeErr := json.Unmarshal(content, &session)
	if decodeErr == nil {
		decodeErr = session.validate()
	}
	if decodeErr == nil {
		if session.Windows == nil {
			session.Windows = []persistedWindow{}
		}
		if session.States == nil {
			session.States = map[string]map[string]string{}
		}
		return session, nil
	}

	backupPath := path + corruptSessionSuffix
	if renameErr := os.Rename(path, backupPath); renameErr != nil {
		return emptySession(), fmt.Errorf(
			"corrupt window session %s (%w); backing it up failed: %w", path, decodeErr, renameErr,
		)
	}
	return emptySession(), fmt.Errorf(
		"corrupt window session %s moved to %s: %w", path, backupPath, decodeErr,
	)
}

// writeSessionFile atomically replaces path with the encoded session.
func writeSessionFile(path string, session persistedSession) error {
	content, err := json.MarshalIndent(session, "", "  ")
	if err != nil {
		return fmt.Errorf("encode window session: %w", err)
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary window session: %w", err)
	}
	temporaryPath := temporary.Name()
	writeErr := writeAndSync(temporary, content)
	if writeErr == nil {
		writeErr = os.Chmod(temporaryPath, sessionFileMode)
	}
	if writeErr == nil {
		writeErr = os.Rename(temporaryPath, path)
	}
	if writeErr != nil {
		if removeErr := os.Remove(temporaryPath); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			return fmt.Errorf("write window session %s: %w (cleanup: %w)", path, writeErr, removeErr)
		}
		return fmt.Errorf("write window session %s: %w", path, writeErr)
	}
	return nil
}

func writeAndSync(file *os.File, content []byte) error {
	_, writeErr := file.Write(content)
	if writeErr == nil {
		writeErr = file.Sync()
	}
	if closeErr := file.Close(); writeErr == nil {
		writeErr = closeErr
	}
	return writeErr
}

// sessionPersister debounces session writes and flushes on close.
type sessionPersister struct {
	path     string
	delay    time.Duration
	snapshot func() persistedSession
	onError  func(error)

	// timerMu guards timer and closed.
	timerMu sync.Mutex
	timer   *time.Timer
	closed  bool

	// writeMu serializes snapshot+write so a later write always carries a
	// later snapshot.
	writeMu sync.Mutex
}

func newSessionPersister(
	path string,
	delay time.Duration,
	snapshot func() persistedSession,
	onError func(error),
) *sessionPersister {
	return &sessionPersister{
		path:     path,
		delay:    delay,
		snapshot: snapshot,
		onError:  onError,
		timerMu:  sync.Mutex{},
		timer:    nil,
		closed:   false,
		writeMu:  sync.Mutex{},
	}
}

// schedule (re)arms the debounce timer. It is a no-op after close.
func (p *sessionPersister) schedule() {
	p.timerMu.Lock()
	defer p.timerMu.Unlock()
	if p.closed {
		return
	}
	if p.timer == nil {
		p.timer = time.AfterFunc(p.delay, p.flushFromTimer)
		return
	}
	p.timer.Reset(p.delay)
}

func (p *sessionPersister) flushFromTimer() {
	if err := p.flush(); err != nil {
		p.onError(err)
	}
}

func (p *sessionPersister) flush() error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	return writeSessionFile(p.path, p.snapshot())
}

// close stops the debounce timer and writes the current session once.
func (p *sessionPersister) close() error {
	p.timerMu.Lock()
	alreadyClosed := p.closed
	p.closed = true
	if p.timer != nil {
		p.timer.Stop()
	}
	p.timerMu.Unlock()
	if alreadyClosed {
		return nil
	}
	return p.flush()
}
