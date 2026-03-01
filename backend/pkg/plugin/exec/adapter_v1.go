package exec

import (
	"context"

	"github.com/omniviewdev/plugin-sdk/pkg/exec"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// AdapterV1 wraps SDK v1 exec.Provider as the engine canonical ExecProvider.
// For v1, all methods are direct delegation (types identical).
// When v2 ships and canonical types diverge, AdapterV1 translates v1 → canonical.
type AdapterV1 struct {
	inner exec.Provider
}

var _ ExecProvider = (*AdapterV1)(nil)

// NewAdapterV1 creates a new v1 adapter wrapping the given SDK exec provider.
func NewAdapterV1(inner exec.Provider) *AdapterV1 {
	return &AdapterV1{inner: inner}
}

func (a *AdapterV1) GetSupportedResources(ctx *types.PluginContext) []exec.Handler {
	return a.inner.GetSupportedResources(ctx)
}

func (a *AdapterV1) GetSession(ctx *types.PluginContext, sessionID string) (*exec.Session, error) {
	return a.inner.GetSession(ctx, sessionID)
}

func (a *AdapterV1) ListSessions(ctx *types.PluginContext) ([]*exec.Session, error) {
	return a.inner.ListSessions(ctx)
}

func (a *AdapterV1) CreateSession(ctx *types.PluginContext, opts exec.SessionOptions) (*exec.Session, error) {
	return a.inner.CreateSession(ctx, opts)
}

func (a *AdapterV1) AttachSession(ctx *types.PluginContext, sessionID string) (*exec.Session, []byte, error) {
	return a.inner.AttachSession(ctx, sessionID)
}

func (a *AdapterV1) DetachSession(ctx *types.PluginContext, sessionID string) (*exec.Session, error) {
	return a.inner.DetachSession(ctx, sessionID)
}

func (a *AdapterV1) CloseSession(ctx *types.PluginContext, sessionID string) error {
	return a.inner.CloseSession(ctx, sessionID)
}

func (a *AdapterV1) ResizeSession(ctx *types.PluginContext, sessionID string, cols, rows int32) error {
	return a.inner.ResizeSession(ctx, sessionID, cols, rows)
}

func (a *AdapterV1) Stream(ctx context.Context, in chan exec.StreamInput) (chan exec.StreamOutput, error) {
	return a.inner.Stream(ctx, in)
}
