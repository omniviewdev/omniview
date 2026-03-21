package logs

import (
	"context"

	logssdk "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// ServiceWrapper is an explicit delegation wrapper around logs.Controller.
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
func (s *ServiceWrapper) GetSupportedResources(pluginID string) []logssdk.Handler {
	return s.Ctrl.GetSupportedResources(pluginID)
}
func (s *ServiceWrapper) CreateSession(plugin, connectionID string, opts logssdk.CreateSessionOptions) (*logssdk.LogSession, error) {
	return s.Ctrl.CreateSession(plugin, connectionID, opts)
}
func (s *ServiceWrapper) GetSession(sessionID string) (*logssdk.LogSession, error) {
	return s.Ctrl.GetSession(sessionID)
}
func (s *ServiceWrapper) ListSessions() ([]*logssdk.LogSession, error) {
	return s.Ctrl.ListSessions()
}
func (s *ServiceWrapper) CloseSession(sessionID string) error {
	return s.Ctrl.CloseSession(sessionID)
}
func (s *ServiceWrapper) SendCommand(sessionID string, cmd logssdk.LogStreamCommand) error {
	return s.Ctrl.SendCommand(sessionID, cmd)
}
func (s *ServiceWrapper) UpdateSessionOptions(sessionID string, opts logssdk.LogSessionOptions) (*logssdk.LogSession, error) {
	return s.Ctrl.UpdateSessionOptions(sessionID, opts)
}
func (s *ServiceWrapper) ListPlugins() ([]string, error) {
	return s.Ctrl.ListPlugins()
}
func (s *ServiceWrapper) HasPlugin(pluginID string) bool {
	return s.Ctrl.HasPlugin(pluginID)
}
