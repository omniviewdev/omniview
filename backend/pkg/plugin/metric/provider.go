package metric

import (
	"context"

	"github.com/omniviewdev/plugin-sdk/pkg/metric"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// MetricProvider is the engine's version-independent interface for metric plugins.
// For v1, method signatures match SDK metric.Provider exactly (doc 20 §13.7).
// When v2 redesigns metric (context.Context, interfaces), this diverges.
type MetricProvider interface {
	GetSupportedResources(ctx *types.PluginContext) (*metric.ProviderInfo, []metric.Handler)
	Query(ctx *types.PluginContext, req metric.QueryRequest) (*metric.QueryResponse, error)
	StreamMetrics(ctx context.Context, in chan metric.StreamInput) (chan metric.StreamOutput, error)
}
