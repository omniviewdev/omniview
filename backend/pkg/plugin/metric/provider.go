package metric

import (
	"context"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// Provider exposes common discovery only. Finite queries and genuine legacy
// query/stream operations are independently negotiated SDK capabilities.
type Provider interface {
	GetSupportedResources(ctx *types.PluginContext) (*metric.ProviderInfo, []metric.Handler)
}

func queryLegacyProvider(provider Provider, ctx *types.PluginContext, req metric.QueryRequest) (*metric.QueryResponse, error) {
	if req.HasResourceIntent() {
		canonical, ok := provider.(metric.ResourceQueryProvider)
		if !ok {
			return nil, resourcev2.NewError("UNSUPPORTED", "Resource metric provider unavailable.")
		}
		return canonical.QueryResource(ctx, req)
	}
	query, ok := provider.(interface {
		Query(*types.PluginContext, metric.QueryRequest) (*metric.QueryResponse, error)
	})
	if !ok {
		return nil, resourcev2.NewError("UNSUPPORTED", "Legacy metric querying is unavailable.")
	}
	return query.Query(ctx, req)
}

func streamLegacyProvider(provider Provider, ctx context.Context, input chan metric.StreamInput) (chan metric.StreamOutput, error) {
	stream, ok := provider.(metric.ResourceStreamProvider)
	if !ok {
		return nil, resourcev2.NewError("UNSUPPORTED", "Canonical metric streaming is unavailable.")
	}
	return stream.StreamResourceMetrics(ctx, input)
}
