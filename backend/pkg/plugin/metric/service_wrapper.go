package metric

import (
	"context"
	"time"

	metricsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// ServiceWrapper is an explicit delegation wrapper around metric.Controller.
// Excluded: OnPluginInit, OnPluginStart, OnPluginStop, OnPluginShutdown,
//
//	OnPluginDestroy
type ServiceWrapper struct {
	Ctrl Controller
}

func (s *ServiceWrapper) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
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
func (s *ServiceWrapper) Query(pluginID, connectionID string, req metricsdk.QueryRequest) (*metricsdk.QueryResponse, error) {
	return s.Ctrl.Query(pluginID, connectionID, req)
}
func (s *ServiceWrapper) QueryAll(connectionID, resourceKey, resourceID, namespace string,
	resourceData map[string]interface{}, metricIDs []string,
	shape metricsdk.MetricShape, startTime, endTime time.Time, step time.Duration,
) (map[string]*metricsdk.QueryResponse, error) {
	return s.Ctrl.QueryAll(connectionID, resourceKey, resourceID, namespace, resourceData, metricIDs, shape, startTime, endTime, step)
}
func (s *ServiceWrapper) Subscribe(pluginID, connectionID string, req SubscribeRequest) (string, error) {
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
