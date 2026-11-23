//go:build windows

package terminal

import (
	"context"
	"net/http"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	logging "github.com/omniviewdev/plugin-sdk/log"
	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
)

// Manager manages terminal sessions. The host has no ConPTY backend, so no session can exist on
// Windows and every call that would reach one answers the typed `unsupported` error. Nothing about
// a pty (its size, its foreground, its directory, how its shell ended) can be said of a session that
// cannot start.
type Manager struct{}

// NewManager returns a manager that starts nothing.
func NewManager(_ context.Context, _ logging.Logger, _ Sink) *Manager { return &Manager{} }

// unsupportedError is what a build that cannot run local terminals answers with.
func unsupportedError() error {
	return coded(apperror.WrapWithDetail(ErrUnsupported, TypeUnsupported, http.StatusNotImplemented,
		"Terminals are not supported", "Local terminal sessions are not supported on Windows."),
		"UNSUPPORTED")
}

// GetSession is not supported.
func (m *Manager) GetSession(_ string) (*sdkexec.Session, error) { return nil, unsupportedError() }

// ListSessions lists nothing: no session can exist.
func (m *Manager) ListSessions() []*sdkexec.Session { return nil }

// Start is not supported.
func (m *Manager) Start(_ Options, _ Owner) (Session, error) { return Session{}, unsupportedError() }

// Write is not supported.
func (m *Manager) Write(_ string, _ uint64, _ []byte) error { return unsupportedError() }

// Resize is not supported.
func (m *Manager) Resize(_ string, _ uint64, _, _ int) error { return unsupportedError() }

// Ack is not supported.
func (m *Manager) Ack(_ string, _ int) error { return unsupportedError() }

// Delivered credits nothing: no session can exist.
func (m *Manager) Delivered(_ string, _ int) {}

// Busy answers unknown, the third state: a ConPTY has no foreground process group, so whether
// something other than the shell holds a Windows terminal cannot be read from the system. (The shell's
// child processes can be listed, but a child that is a background job looks the same as the program
// in the foreground, so even a backend with ConPTY would have to say unknown whenever the shell has
// a child, and idle only when it has none.)
func (m *Manager) Busy(_ string) (Foreground, error) {
	return UnknownForeground(ReasonUnsupported), nil
}

// Cwd answers unknown: a ConPTY session would need the shell's directory from its process, which the
// host has no cheap way to read (it would be a query of the process's PEB), and no session can start.
func (m *Manager) Cwd(_ string) (Directory, error) {
	return Directory{Path: "", Reason: ReasonUnsupported}, nil
}

// AttachSession is not supported.
func (m *Manager) AttachSession(_ string) (*sdkexec.Session, []byte, error) {
	return nil, nil, unsupportedError()
}

// DetachSession is not supported.
func (m *Manager) DetachSession(_ string) (*sdkexec.Session, error) { return nil, unsupportedError() }

// CloseSession is not supported.
func (m *Manager) CloseSession(_ string) error { return unsupportedError() }

// CloseOwned ends nothing: no session can exist.
func (m *Manager) CloseOwned(_ Owner, _ ClosedBy) int { return 0 }

// Shutdown ends nothing: no session can exist.
func (m *Manager) Shutdown() {}

// SetFlowStall does nothing: no session can exist.
func (m *Manager) SetFlowStall(_ time.Duration) {}
