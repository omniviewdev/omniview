package devserver

import (
	"context"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// ServiceWrapper exposes only frontend-safe methods of devserver.DevServerManager.
// The DevServerManager implements ServiceStartup/ServiceShutdown directly,
// but registering it raw causes service/model shadowing. This wrapper separates
// the service identity from the model type.
type ServiceWrapper struct {
	Mgr *DevServerManager
}

func (s *ServiceWrapper) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return s.Mgr.ServiceStartup(ctx, options)
}
func (s *ServiceWrapper) ServiceShutdown() error {
	return s.Mgr.ServiceShutdown()
}
func (s *ServiceWrapper) StartDevServer(pluginID string) (DevServerState, error) {
	return s.Mgr.StartDevServer(pluginID)
}
func (s *ServiceWrapper) StartDevServerForPath(pluginID, devPath string) (DevServerState, error) {
	return s.Mgr.StartDevServerForPath(pluginID, devPath)
}
func (s *ServiceWrapper) StopDevServer(pluginID string) error {
	return s.Mgr.StopDevServer(pluginID)
}
func (s *ServiceWrapper) RestartDevServer(pluginID string) (DevServerState, error) {
	return s.Mgr.RestartDevServer(pluginID)
}
func (s *ServiceWrapper) RebuildPlugin(pluginID string) error {
	return s.Mgr.RebuildPlugin(pluginID)
}
func (s *ServiceWrapper) GetDevServerState(pluginID string) DevServerState {
	return s.Mgr.GetDevServerState(pluginID)
}
func (s *ServiceWrapper) ListDevServerStates() []DevServerState {
	return s.Mgr.ListDevServerStates()
}
func (s *ServiceWrapper) GetDevServerLogs(pluginID string, count int) []LogEntry {
	return s.Mgr.GetDevServerLogs(pluginID, count)
}
func (s *ServiceWrapper) IsManaged(pluginID string) bool {
	return s.Mgr.IsManaged(pluginID)
}
func (s *ServiceWrapper) GetExternalPluginInfo(pluginID string) *DevInfoFile {
	return s.Mgr.GetExternalPluginInfo(pluginID)
}
