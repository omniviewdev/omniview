package metric

import (
	"context"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// AdapterV1 delegates the unchanged utility cohort and explicitly selects the
// canonical resource stream extension; it never falls back to native Struct.
type AdapterV1 struct {
	inner metric.Provider
}

var _ Provider = (*AdapterV1)(nil)

// NewAdapterV1 creates a new v1 adapter wrapping the given SDK metric provider.
func NewAdapterV1(inner metric.Provider) *AdapterV1 {
	return &AdapterV1{inner: inner}
}

func (a *AdapterV1) GetSupportedResources(ctx *types.PluginContext) (*metric.ProviderInfo, []metric.Handler) {
	return a.inner.GetSupportedResources(ctx)
}

func (a *AdapterV1) Query(ctx *types.PluginContext, req metric.QueryRequest) (*metric.QueryResponse, error) {
	return a.inner.Query(ctx, req)
}

func (a *AdapterV1) StreamResourceMetrics(ctx context.Context, in chan metric.StreamInput) (chan metric.StreamOutput, error) {
	provider, ok := a.inner.(metric.ResourceStreamProvider)
	if !ok {
		return nil, resourcev2.NewError("UNSUPPORTED", "Canonical metric streaming is unavailable.")
	}
	return provider.StreamResourceMetrics(ctx, in)
}
