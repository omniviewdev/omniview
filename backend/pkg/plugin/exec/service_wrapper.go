package exec

import (
	"context"

	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// ServiceWrapper is an explicit delegation wrapper around exec.Controller.
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
func (s *ServiceWrapper) CreateSession(plugin, connectionID string, opts execsdk.SessionOptions) (*execsdk.Session, error) {
	return s.Ctrl.CreateSession(plugin, connectionID, opts)
}
func (s *ServiceWrapper) CreateTerminal(opts execsdk.SessionOptions) (*execsdk.Session, error) {
	return s.Ctrl.CreateTerminal(opts)
}
func (s *ServiceWrapper) ListSessions() ([]*execsdk.Session, error) {
	return s.Ctrl.ListSessions()
}
func (s *ServiceWrapper) GetSession(sessionID string) (*execsdk.Session, error) {
	return s.Ctrl.GetSession(sessionID)
}
func (s *ServiceWrapper) AttachSession(sessionID string) (*execsdk.Session, []byte, error) {
	return s.Ctrl.AttachSession(sessionID)
}
func (s *ServiceWrapper) DetachSession(sessionID string) (*execsdk.Session, error) {
	return s.Ctrl.DetachSession(sessionID)
}
func (s *ServiceWrapper) WriteSession(sessionID string, data []byte) error {
	return s.Ctrl.WriteSession(sessionID, data)
}
func (s *ServiceWrapper) CloseSession(sessionID string) error {
	return s.Ctrl.CloseSession(sessionID)
}
func (s *ServiceWrapper) ResizeSession(sessionID string, rows, cols uint16) error {
	return s.Ctrl.ResizeSession(sessionID, rows, cols)
}
func (s *ServiceWrapper) GetHandler(plugin, resource string) *execsdk.Handler {
	return s.Ctrl.GetHandler(plugin, resource)
}
func (s *ServiceWrapper) GetHandlers() map[string]map[string]execsdk.Handler {
	return s.Ctrl.GetHandlers()
}
func (s *ServiceWrapper) GetPluginHandlers(plugin string) map[string]execsdk.Handler {
	return s.Ctrl.GetPluginHandlers(plugin)
}
func (s *ServiceWrapper) ListPlugins() ([]string, error) {
	return s.Ctrl.ListPlugins()
}
func (s *ServiceWrapper) HasPlugin(pluginID string) bool {
	return s.Ctrl.HasPlugin(pluginID)
}
