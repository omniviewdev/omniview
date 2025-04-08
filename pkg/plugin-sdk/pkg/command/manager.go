package command

import (
	"errors"

	"github.com/hashicorp/go-hclog"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/settings"
)

var (
	// ErrHandlerNotFound is returned when a handler is not found.
	ErrHandlerNotFound = errors.New("handler not found")
	// ErrHandlerTimeout is returned when a handler times out.
	ErrHandlerTimeout = errors.New("handler timeout")
)

// Manager manages the lifecycle of the terminal sessions.
type Manager struct {
	log              hclog.Logger
	settingsProvider settings.Provider
	handlers         map[string]Handler
}

var _ Provider = (*Manager)(nil)

// NewManager initializes a new Manager instance.
func NewManager(
	log hclog.Logger,
	sp settings.Provider,
	handlers map[string]Handler,
) *Manager {
	return &Manager{
		log:              hclog.Default().With("service", "CommandManager"),
		settingsProvider: sp,
		handlers:         handlers,
	}
}

func (m *Manager) Call(
	ctx *types.PluginContext,
	target string,
	payload []byte,
) ([]byte, error) {
	handler, ok := m.handlers[target]
	if !ok {
		return nil, ErrHandlerNotFound
	}
	return handler(ctx, payload)
}
