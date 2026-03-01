package metric

import (
	"context"

	"github.com/omniviewdev/plugin-sdk/pkg/metric"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// AdapterV1 wraps SDK v1 metric.Provider as the engine canonical MetricProvider.
// For v1, all methods are direct delegation (types identical).
// When v2 ships and canonical types diverge, AdapterV1 translates v1 → canonical.
type AdapterV1 struct {
	inner metric.Provider
}

var _ MetricProvider = (*AdapterV1)(nil)

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

func (a *AdapterV1) StreamMetrics(ctx context.Context, in chan metric.StreamInput) (chan metric.StreamOutput, error) {
	return a.inner.StreamMetrics(ctx, in)
}
