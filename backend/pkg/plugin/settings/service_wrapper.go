package settings

import (
	"context"

	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// ServiceWrapper is an explicit delegation wrapper around settings.Controller.
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
func (s *ServiceWrapper) ListPlugins() ([]string, error) {
	return s.Ctrl.ListPlugins()
}
func (s *ServiceWrapper) HasPlugin(pluginID string) bool {
	return s.Ctrl.HasPlugin(pluginID)
}
func (s *ServiceWrapper) Values() map[string]any {
	return s.Ctrl.Values()
}
func (s *ServiceWrapper) PluginValues(plugin string) map[string]any {
	return s.Ctrl.PluginValues(plugin)
}
func (s *ServiceWrapper) ListSettings(plugin string) map[string]pkgsettings.Setting {
	return s.Ctrl.ListSettings(plugin)
}
func (s *ServiceWrapper) GetSetting(plugin, id string) (pkgsettings.Setting, error) {
	return s.Ctrl.GetSetting(plugin, id)
}
func (s *ServiceWrapper) SetSetting(plugin, id string, value any) error {
	return s.Ctrl.SetSetting(plugin, id, value)
}
func (s *ServiceWrapper) SetSettings(plugin string, settingsMap map[string]any) error {
	return s.Ctrl.SetSettings(plugin, settingsMap)
}
