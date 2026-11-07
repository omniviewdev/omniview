package metric

import (
	"context"
	"errors"
	"sync"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/transportjson"
	"github.com/wailsapp/wails/v3/pkg/application"

	metricsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// ServiceWrapper is an explicit delegation wrapper around metric.Controller.
// Excluded: OnPluginInit, OnPluginStart, OnPluginStop, OnPluginShutdown,
//
//	OnPluginDestroy
type ServiceWrapper struct {
	Ctrl       Controller
	Realm      *invocation.WindowRealm
	sessionsMu sync.Mutex
	sessions   map[uint]*metricFrontendSession
}

func (s *ServiceWrapper) realmContext(ctx context.Context) context.Context {
	if s.Realm == nil {
		return ctx
	}
	return s.Realm.Context(ctx)
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
	ctx context.Context,
	pluginID, connectionID string,
	encoded string,
) (*metricsdk.QueryResponse, error) {
	var req metricsdk.QueryRequest
	if err := transportjson.Decode(encoded, &req, pluginID, connectionID); err != nil {
		return nil, err
	}
	return s.Ctrl.Query(s.realmContext(ctx), pluginID, connectionID, req)
}
func (s *ServiceWrapper) QueryAll(ctx context.Context, connectionID, encoded string) (map[string]*metricsdk.QueryResponse, error) {
	var req metricsdk.QueryRequest
	if err := transportjson.Decode(encoded, &req, connectionID); err != nil {
		return nil, err
	}
	return s.Ctrl.QueryAll(s.realmContext(ctx), connectionID, req)
}
func (s *ServiceWrapper) Subscribe(ctx context.Context, pluginID, connectionID, encoded string) (string, error) {
	var req SubscribeRequest
	if err := transportjson.Decode(encoded, &req, pluginID, connectionID); err != nil {
		return "", err
	}
	return s.Ctrl.Subscribe(s.realmContext(ctx), pluginID, connectionID, req)
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
