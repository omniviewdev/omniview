package mcprelay

import (
	"context"

	hostlogs "github.com/omniviewdev/omniview/backend/pkg/plugin/logs"
	hostmetric "github.com/omniviewdev/omniview/backend/pkg/plugin/metric"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graph"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// ResourceLogsReader consumes finite resource logs with the original invocation
// principal. The existing host logs controller implements this interface.
type ResourceLogsReader interface {
	ReadResourceLogs(context.Context, string, sdklogs.CreateSessionOptions) (*hostlogs.HeadlessResult, error)
}

// ResourceMetricsReader answers finite reference-bound metric queries with the
// original invocation principal. The host metric controller implements it.
type ResourceMetricsReader interface {
	ReadResourceMetrics(context.Context, string, sdkmetric.QueryRequest) (*sdkmetric.QueryResponse, error)
	GetProvidersForResource(string) []hostmetric.MetricProviderSummary
}

// ResourceGraphReader reads observed relationships with the original invocation
// principal. The host graph service implements it.
type ResourceGraphReader interface {
	GetRelated(
		ctx context.Context, pluginID string, reference resourcev2.ResourceReference,
		route resourcev2.AccessRoute, direction string, relationshipType *string,
	) ([]graph.GraphEdge, error)
}

// ResourceReaders are the optional host read lanes advertised beside the catalog.
type ResourceReaders struct {
	Logs    ResourceLogsReader
	Metrics ResourceMetricsReader
	Graph   ResourceGraphReader
}
