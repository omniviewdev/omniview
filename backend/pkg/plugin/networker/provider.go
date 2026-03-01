package networker

import (
	"github.com/omniviewdev/plugin-sdk/pkg/networker"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// NetworkerProvider is the engine's version-independent interface for networker plugins.
// For v1, method signatures match SDK networker.Provider exactly (doc 20 §13.7).
// When v2 redesigns networker (context.Context, interfaces), this diverges.
type NetworkerProvider interface {
	GetSupportedPortForwardTargets(ctx *types.PluginContext) []string
	GetPortForwardSession(ctx *types.PluginContext, sessionID string) (*networker.PortForwardSession, error)
	ListPortForwardSessions(ctx *types.PluginContext) ([]*networker.PortForwardSession, error)
	FindPortForwardSessions(ctx *types.PluginContext, req networker.FindPortForwardSessionRequest) ([]*networker.PortForwardSession, error)
	StartPortForwardSession(ctx *types.PluginContext, opts networker.PortForwardSessionOptions) (*networker.PortForwardSession, error)
	ClosePortForwardSession(ctx *types.PluginContext, sessionID string) (*networker.PortForwardSession, error)
}
