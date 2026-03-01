package logs

import (
	"context"

	"github.com/omniviewdev/plugin-sdk/pkg/logs"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// LogsProvider is the engine's version-independent interface for log plugins.
// For v1, method signatures match SDK logs.Provider exactly (doc 20 §13.7).
// When v2 redesigns logs (context.Context, interfaces), this diverges.
type LogsProvider interface {
	GetSupportedResources(ctx *types.PluginContext) []logs.Handler
	CreateSession(ctx *types.PluginContext, opts logs.CreateSessionOptions) (*logs.LogSession, error)
	GetSession(ctx *types.PluginContext, sessionID string) (*logs.LogSession, error)
	ListSessions(ctx *types.PluginContext) ([]*logs.LogSession, error)
	CloseSession(ctx *types.PluginContext, sessionID string) error
	UpdateSessionOptions(ctx *types.PluginContext, sessionID string, opts logs.LogSessionOptions) (*logs.LogSession, error)
	Stream(ctx context.Context, in chan logs.StreamInput) (chan logs.StreamOutput, error)
}
