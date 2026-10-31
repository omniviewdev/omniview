package logs

import (
	"context"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

// AdapterV1 wraps SDK v1 logs.Provider as the engine canonical Provider.
// For v1, all methods are direct delegation (types identical).
// When v2 ships and canonical types diverge, AdapterV1 translates v1 → canonical.
type AdapterV1 struct {
	inner logs.Provider
}

var _ Provider = (*AdapterV1)(nil)

// NewAdapterV1 creates a new v1 adapter wrapping the given SDK logs provider.
func NewAdapterV1(inner logs.Provider) *AdapterV1 {
	return &AdapterV1{inner: inner}
}

func (a *AdapterV1) GetSupportedResources(ctx *types.PluginContext) []logs.Handler {
	return a.inner.GetSupportedResources(ctx)
}

func (a *AdapterV1) CreateSession(ctx *types.PluginContext, opts logs.CreateSessionOptions) (*logs.LogSession, error) {
	return a.inner.CreateSession(ctx, opts)
}

// CreateResourceSession preserves the resource-only lane without legacy fallback.
func (a *AdapterV1) CreateResourceSession(ctx *types.PluginContext, opts logs.CreateSessionOptions) (*logs.LogSession, error) {
	provider, ok := a.inner.(logs.ResourceSessionProvider)
	if !ok {
		return nil, resourcev2.NewError("UNSUPPORTED", "Resource logs provider unavailable.")
	}
	return provider.CreateResourceSession(ctx, opts)
}

func (a *AdapterV1) GetSession(ctx *types.PluginContext, sessionID string) (*logs.LogSession, error) {
	return a.inner.GetSession(ctx, sessionID)
}

func (a *AdapterV1) ListSessions(ctx *types.PluginContext) ([]*logs.LogSession, error) {
	return a.inner.ListSessions(ctx)
}

func (a *AdapterV1) CloseSession(ctx *types.PluginContext, sessionID string) error {
	return a.inner.CloseSession(ctx, sessionID)
}

func (a *AdapterV1) UpdateSessionOptions(
	ctx *types.PluginContext,
	sessionID string,
	opts logs.LogSessionOptions,
) (*logs.LogSession, error) {
	return a.inner.UpdateSessionOptions(ctx, sessionID, opts)
}

func (a *AdapterV1) Stream(ctx context.Context, in chan logs.StreamInput) (chan logs.StreamOutput, error) {
	return a.inner.Stream(ctx, in)
}
