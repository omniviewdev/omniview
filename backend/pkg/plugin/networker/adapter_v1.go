package networker

import (
	"github.com/omniviewdev/plugin-sdk/pkg/networker"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// AdapterV1 wraps SDK v1 networker.Provider as the engine canonical NetworkerProvider.
// For v1, all methods are direct delegation (types identical).
// When v2 ships and canonical types diverge, AdapterV1 translates v1 → canonical.
type AdapterV1 struct {
	inner networker.Provider
}

var _ NetworkerProvider = (*AdapterV1)(nil)

// NewAdapterV1 creates a new v1 adapter wrapping the given SDK networker provider.
func NewAdapterV1(inner networker.Provider) *AdapterV1 {
	return &AdapterV1{inner: inner}
}

func (a *AdapterV1) GetSupportedPortForwardTargets(ctx *types.PluginContext) []string {
	return a.inner.GetSupportedPortForwardTargets(ctx)
}

func (a *AdapterV1) GetPortForwardSession(ctx *types.PluginContext, sessionID string) (*networker.PortForwardSession, error) {
	return a.inner.GetPortForwardSession(ctx, sessionID)
}

func (a *AdapterV1) ListPortForwardSessions(ctx *types.PluginContext) ([]*networker.PortForwardSession, error) {
	return a.inner.ListPortForwardSessions(ctx)
}

func (a *AdapterV1) FindPortForwardSessions(ctx *types.PluginContext, req networker.FindPortForwardSessionRequest) ([]*networker.PortForwardSession, error) {
	return a.inner.FindPortForwardSessions(ctx, req)
}

func (a *AdapterV1) StartPortForwardSession(ctx *types.PluginContext, opts networker.PortForwardSessionOptions) (*networker.PortForwardSession, error) {
	return a.inner.StartPortForwardSession(ctx, opts)
}

func (a *AdapterV1) ClosePortForwardSession(ctx *types.PluginContext, sessionID string) (*networker.PortForwardSession, error) {
	return a.inner.ClosePortForwardSession(ctx, sessionID)
}
