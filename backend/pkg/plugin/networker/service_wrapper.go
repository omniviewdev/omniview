package networker

import (
	"context"

	networkersdk "github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// ServiceWrapper is an explicit delegation wrapper around networker.Controller.
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
func (s *ServiceWrapper) GetSupportedPortForwardTargets(pluginID string) ([]string, error) {
	return s.Ctrl.GetSupportedPortForwardTargets(pluginID)
}
func (s *ServiceWrapper) GetPortForwardSession(sessionID string) (*networkersdk.PortForwardSession, error) {
	return s.Ctrl.GetPortForwardSession(sessionID)
}
func (s *ServiceWrapper) ListPortForwardSessions(pluginID, connectionID string) ([]*networkersdk.PortForwardSession, error) {
	return s.Ctrl.ListPortForwardSessions(pluginID, connectionID)
}
func (s *ServiceWrapper) ListAllPortForwardSessions() ([]*networkersdk.PortForwardSession, error) {
	return s.Ctrl.ListAllPortForwardSessions()
}
func (s *ServiceWrapper) FindPortForwardSessions(pluginID, connectionID string, request networkersdk.FindPortForwardSessionRequest) ([]*networkersdk.PortForwardSession, error) {
	return s.Ctrl.FindPortForwardSessions(pluginID, connectionID, request)
}
func (s *ServiceWrapper) StartResourcePortForwardingSession(pluginID, connectionID string, opts networkersdk.PortForwardSessionOptions) (*networkersdk.PortForwardSession, error) {
	return s.Ctrl.StartResourcePortForwardingSession(pluginID, connectionID, opts)
}
func (s *ServiceWrapper) ClosePortForwardSession(sessionID string) (*networkersdk.PortForwardSession, error) {
	return s.Ctrl.ClosePortForwardSession(sessionID)
}
func (s *ServiceWrapper) ListPlugins() ([]string, error) {
	return s.Ctrl.ListPlugins()
}
func (s *ServiceWrapper) HasPlugin(pluginID string) bool {
	return s.Ctrl.HasPlugin(pluginID)
}
