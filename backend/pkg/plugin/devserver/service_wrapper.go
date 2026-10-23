package devserver

import (
	"context"
	"fmt"

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
	state, err := s.Mgr.StartDevServer(pluginID)
	if err != nil {
		return state, err
	}
	if state.RPCStatus == StageNotApplicable {
		reloader, ok := s.Mgr.pluginReloader.(interface {
			ReloadManagedPlugin(context.Context, string, string, string) error
		})
		if !ok {
			return state, fmt.Errorf("canonical plugin lifecycle start unavailable")
		}
		if err = reloader.ReloadManagedPlugin(s.Mgr.ctx, pluginID, state.DevPath, state.Generation); err != nil {
			return s.Mgr.GetDevServerState(pluginID), err
		}
	}
	return s.Mgr.GetDevServerState(pluginID), nil
}
func (s *ServiceWrapper) StartDevServerForPath(pluginID, devPath string) (DevServerState, error) {
	return s.Mgr.StartDevServerForPath(pluginID, devPath)
}
func (s *ServiceWrapper) StopDevServer(pluginID string) error {
	if stopper, ok := s.Mgr.pluginReloader.(interface{ StopDevPlugin(string) error }); ok {
		return stopper.StopDevPlugin(pluginID)
	}
	return fmt.Errorf("canonical plugin lifecycle stop unavailable")
}
func (s *ServiceWrapper) RestartDevServer(pluginID string) (DevServerState, error) {
	if err := s.StopDevServer(pluginID); err != nil {
		return DevServerState{}, err
	}
	return s.StartDevServer(pluginID)
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
