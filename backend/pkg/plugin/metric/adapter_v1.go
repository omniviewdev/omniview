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
	if req.HasResourceIntent() {
		provider, ok := a.inner.(metric.ResourceQueryProvider)
		if !ok {
			return nil, resourcev2.NewError("UNSUPPORTED", "Resource metric provider unavailable.")
		}
		return provider.QueryResource(ctx, req)
	}
	return a.inner.Query(ctx, req)
}

func (a *AdapterV1) StreamResourceMetrics(ctx context.Context, in chan metric.StreamInput) (chan metric.StreamOutput, error) {
	provider, ok := a.inner.(metric.ResourceStreamProvider)
	if !ok {
		return nil, resourcev2.NewError("UNSUPPORTED", "Canonical metric streaming is unavailable.")
	}
	return provider.StreamResourceMetrics(ctx, in)
}

func (a *AdapterV1) QueryResources(ctx *metric.QueryContext, req metric.ResourceSetQueryRequest) (*metric.ResourceSetQueryResponse, error) {
	p, ok := a.inner.(metric.ResourceSetProvider)
	if !ok {
		return nil, resourcev2.NewError("UNSUPPORTED", "Finite resource metric queries are unavailable.")
	}
	return p.QueryResources(ctx, req)
}
func (a *AdapterV1) GetMetricDefinitions(ctx *metric.QueryContext) ([]metric.MetricDefinition, error) {
	p, ok := a.inner.(metric.MetricCatalogProvider)
	if !ok {
		return nil, nil
	}
	return p.GetMetricDefinitions(ctx)
}
func (a *AdapterV1) configuration() (metric.ProviderConfiguration, error) {
	p, ok := a.inner.(metric.ProviderConfiguration)
	if !ok {
		return nil, resourcev2.NewError("UNSUPPORTED", "Metric provider configuration is unavailable.")
	}
	return p, nil
}
func (a *AdapterV1) GetProviderConnections(ctx *metric.QueryContext) ([]metric.ProviderConnection, error) {
	p, e := a.configuration()
	if e != nil {
		return nil, e
	}
	return p.GetProviderConnections(ctx)
}
func (a *AdapterV1) SaveProviderConnection(ctx *metric.QueryContext, input metric.ProviderConnectionInput) (*metric.ProviderConnection, error) {
	p, e := a.configuration()
	if e != nil {
		return nil, e
	}
	return p.SaveProviderConnection(ctx, input)
}
func (a *AdapterV1) DeleteProviderConnection(ctx *metric.QueryContext, id string) error {
	p, e := a.configuration()
	if e != nil {
		return e
	}
	return p.DeleteProviderConnection(ctx, id)
}
func (a *AdapterV1) GetDataSources(ctx *metric.QueryContext, source metric.MetricSourceReference) ([]metric.MetricDataSource, error) {
	p, e := a.configuration()
	if e != nil {
		return nil, e
	}
	return p.GetDataSources(ctx, source)
}
func (a *AdapterV1) TestProviderConnection(ctx *metric.QueryContext, id string) (*metric.MetricValidationResult, error) {
	p, e := a.configuration()
	if e != nil {
		return nil, e
	}
	return p.TestProviderConnection(ctx, id)
}
func (a *AdapterV1) ValidateMetricDefinition(ctx *metric.QueryContext, source metric.MetricSourceReference, d metric.MetricDefinition) (*metric.MetricValidationResult, error) {
	p, e := a.configuration()
	if e != nil {
		return nil, e
	}
	return p.ValidateMetricDefinition(ctx, source, d)
}

func (a *AdapterV1) DiscoverMetricLabels(ctx *metric.QueryContext, req metric.MetricDiscoveryRequest) (*metric.MetricDiscoveryResult, error) {
	p, ok := a.inner.(metric.MetricDiscoveryProvider)
	if !ok {
		return nil, resourcev2.NewError("UNSUPPORTED", "Metric label discovery is unavailable.")
	}
	return p.DiscoverMetricLabels(ctx, req)
}
