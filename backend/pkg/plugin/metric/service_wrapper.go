package metric

import (
	"context"
	"errors"

	"github.com/omniviewdev/omniview/backend/pkg/transportjson"
	"github.com/wailsapp/wails/v3/pkg/application"

	metricsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// ServiceWrapper is an explicit delegation wrapper around metric.Controller.
// Excluded: OnPluginInit, OnPluginStart, OnPluginStop, OnPluginShutdown,
//
//	OnPluginDestroy
type ServiceWrapper struct {
	Ctrl Controller
}

func (s *ServiceWrapper) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if s.Ctrl == nil {
		return errors.New("metric: ServiceWrapper.Ctrl is nil")
	}
	if ss, ok := s.Ctrl.(interface {
		ServiceStartup(context.Context, application.ServiceOptions) error
	}); ok {
		return ss.ServiceStartup(ctx, options)
	}
	return nil
}
func (s *ServiceWrapper) ServiceShutdown() error {
	if ss, ok := s.Ctrl.(interface{ ServiceShutdown() error }); ok {
		return ss.ServiceShutdown()
	}
	return nil
}
func (s *ServiceWrapper) GetProviders() []MetricProviderSummary {
	return s.Ctrl.GetProviders()
}
func (s *ServiceWrapper) GetProvidersForResource(resourceKey string) []MetricProviderSummary {
	return s.Ctrl.GetProvidersForResource(resourceKey)
}
func (s *ServiceWrapper) Query(
	pluginID, connectionID string,
	encoded string,
) (*metricsdk.QueryResponse, error) {
	var req metricsdk.QueryRequest
	if err := transportjson.Decode(encoded, &req, pluginID, connectionID); err != nil {
		return nil, err
	}
	return s.Ctrl.Query(pluginID, connectionID, req)
}
func (s *ServiceWrapper) QueryAll(connectionID, encoded string) (map[string]*metricsdk.QueryResponse, error) {
	var req metricsdk.QueryRequest
	if err := transportjson.Decode(encoded, &req, connectionID); err != nil {
		return nil, err
	}
	return s.Ctrl.QueryAll(connectionID, req)
}
func (s *ServiceWrapper) Subscribe(pluginID, connectionID, encoded string) (string, error) {
	var req SubscribeRequest
	if err := transportjson.Decode(encoded, &req, pluginID, connectionID); err != nil {
		return "", err
	}
	return s.Ctrl.Subscribe(pluginID, connectionID, req)
}
func (s *ServiceWrapper) Unsubscribe(subscriptionID string) error {
	return s.Ctrl.Unsubscribe(subscriptionID)
}
func (s *ServiceWrapper) ListPlugins() ([]string, error) {
	return s.Ctrl.ListPlugins()
}
func (s *ServiceWrapper) HasPlugin(pluginID string) bool {
	return s.Ctrl.HasPlugin(pluginID)
}

// QueryResources uses Wails' injected call context so cancellation releases one
// consumer, rather than cancelling work still used by another subscriber.
func (s *ServiceWrapper) QueryResources(ctx context.Context, encoded string) (*metricsdk.ResourceSetQueryResponse, error) {
	var req metricsdk.ResourceSetQueryRequest
	if err := transportjson.Decode(encoded, &req); err != nil {
		return nil, err
	}
	return s.Ctrl.QueryResources(ctx, req)
}
func (s *ServiceWrapper) GetMetricBindings(pluginID, connectionID string) ([]metricsdk.MetricBinding, error) {
	return s.Ctrl.GetMetricBindings(pluginID, connectionID)
}
func (s *ServiceWrapper) SaveMetricBinding(encoded string) (*metricsdk.MetricBinding, error) {
	var req metricsdk.MetricBinding
	if err := transportjson.Decode(encoded, &req); err != nil {
		return nil, err
	}
	return s.Ctrl.SaveMetricBinding(req)
}
func (s *ServiceWrapper) DeleteMetricBinding(pluginID, connectionID, bindingID string) error {
	return s.Ctrl.DeleteMetricBinding(pluginID, connectionID, bindingID)
}
func (s *ServiceWrapper) GetMetricDefinitions() ([]metricsdk.MetricDefinition, error) {
	return s.Ctrl.GetMetricDefinitions()
}
func (s *ServiceWrapper) SaveMetricDefinition(encoded string) (*metricsdk.MetricDefinition, error) {
	var req metricsdk.MetricDefinition
	if err := transportjson.Decode(encoded, &req); err != nil {
		return nil, err
	}
	return s.Ctrl.SaveMetricDefinition(req)
}
func (s *ServiceWrapper) DeleteMetricDefinition(id string) error {
	return s.Ctrl.DeleteMetricDefinition(id)
}
func (s *ServiceWrapper) GetProviderConnections(pluginID string) ([]metricsdk.ProviderConnection, error) {
	return s.Ctrl.GetProviderConnections(pluginID)
}
func (s *ServiceWrapper) SaveProviderConnection(pluginID, encoded string) (*metricsdk.ProviderConnection, error) {
	var req metricsdk.ProviderConnectionInput
	if err := transportjson.Decode(encoded, &req, pluginID); err != nil {
		return nil, err
	}
	return s.Ctrl.SaveProviderConnection(pluginID, req)
}
func (s *ServiceWrapper) DeleteProviderConnection(pluginID, id string) error {
	return s.Ctrl.DeleteProviderConnection(pluginID, id)
}
func (s *ServiceWrapper) GetDataSources(pluginID, connectionID string) ([]metricsdk.MetricDataSource, error) {
	return s.Ctrl.GetDataSources(pluginID, connectionID)
}
func (s *ServiceWrapper) TestProviderConnection(pluginID, connectionID string) (*metricsdk.MetricValidationResult, error) {
	return s.Ctrl.TestProviderConnection(pluginID, connectionID)
}

// This validates the definition schema/compiler, not sample query execution.
// QueryResources is the admitted sample validation path.
func (s *ServiceWrapper) ValidateMetricDefinition(pluginID, connectionID, datasourceUID, encoded string) (*metricsdk.MetricValidationResult, error) {
	var req metricsdk.MetricDefinition
	if err := transportjson.Decode(encoded, &req, pluginID, connectionID, datasourceUID); err != nil {
		return nil, err
	}
	return s.Ctrl.ValidateMetricDefinition(pluginID, connectionID, datasourceUID, req)
}

func (s *ServiceWrapper) PreviewMetricDefinition(ctx context.Context, encoded string) (*metricsdk.ResourceSetQueryResponse, error) {
	var req metricsdk.ResourceSetQueryRequest
	if err := transportjson.Decode(encoded, &req); err != nil {
		return nil, err
	}
	return s.Ctrl.PreviewMetricDefinition(ctx, req)
}
func (s *ServiceWrapper) DiscoverMetricLabels(pluginID, connectionID, datasourceUID, encoded string) (*metricsdk.MetricDiscoveryResult, error) {
	var req metricsdk.MetricDiscoveryRequest
	if err := transportjson.Decode(encoded, &req, pluginID, connectionID, datasourceUID); err != nil {
		return nil, err
	}
	return s.Ctrl.DiscoverMetricLabels(pluginID, connectionID, datasourceUID, req)
}
