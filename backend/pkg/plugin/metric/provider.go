package metric

import (
	"context"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// Provider is the host's metric utility boundary. Mixed resource/nonresource
// streams use the explicitly negotiated canonical resource lane.
type Provider interface {
	GetSupportedResources(ctx *types.PluginContext) (*metric.ProviderInfo, []metric.Handler)
	Query(ctx *types.PluginContext, req metric.QueryRequest) (*metric.QueryResponse, error)
	StreamResourceMetrics(ctx context.Context, in chan metric.StreamInput) (chan metric.StreamOutput, error)
}
