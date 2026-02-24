//go:build windows

package terminal

import (
	"fmt"
	"os"
	"sync"

	"go.uber.org/zap"

	sdkexec "github.com/omniviewdev/plugin-sdk/pkg/exec"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

var errUnsupported = fmt.Errorf("terminal sessions are not supported on Windows")

// Manager manages terminal sessions. On Windows, PTY-based sessions are not
// supported, so all operations return errors.
type Manager struct {
	log      *zap.SugaredLogger
	sessions map[string]*sdkexec.Session
	ptys     map[string]*os.File

	inMux     chan sdkexec.StreamInput
	outMux    chan sdkexec.StreamOutput
	resizeMux chan sdkexec.StreamResize
	mux       sync.RWMutex
}

func NewManager(
	log *zap.SugaredLogger,
) (*Manager, chan sdkexec.StreamInput, chan sdkexec.StreamOutput, chan sdkexec.StreamResize) {
	inMux := make(chan sdkexec.StreamInput)
	outMux := make(chan sdkexec.StreamOutput)
	resizeMux := make(chan sdkexec.StreamResize)

	return &Manager{
		log:       log,
		sessions:  make(map[string]*sdkexec.Session),
		ptys:      make(map[string]*os.File),
		inMux:     inMux,
		outMux:    outMux,
		resizeMux: resizeMux,
	}, inMux, outMux, resizeMux
}

func (m *Manager) GetSession(_ string) (*sdkexec.Session, error) {
	return nil, errUnsupported
}

func (m *Manager) ListSessions(_ *types.PluginContext) []*sdkexec.Session {
	return nil
}

func (m *Manager) StartSession(_ *types.PluginContext, _ sdkexec.SessionOptions) (*sdkexec.Session, error) {
	return nil, errUnsupported
}

func (m *Manager) ResizeSession(_ string, _, _ uint16) error {
	return errUnsupported
}

func (m *Manager) WriteSession(_ string, _ []byte) error {
	return errUnsupported
}

func (m *Manager) AttachSession(_ string) (*sdkexec.Session, []byte, error) {
	return nil, nil, errUnsupported
}

func (m *Manager) DetachSession(_ string) (*sdkexec.Session, error) {
	return nil, errUnsupported
}

func (m *Manager) CloseSession(_ string) error {
	return errUnsupported
}
