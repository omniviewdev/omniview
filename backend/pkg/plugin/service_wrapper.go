package plugin

import (
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
)

// ServiceWrapper exposes only the frontend-safe methods of plugin.Manager.
// Internal methods (SetDevServerChecker, SetPluginLogManager, HandlePluginCrash,
// Initialize, Run, Shutdown) are excluded to avoid binding warnings from
// interface/function-type parameters.
type ServiceWrapper struct {
	Mgr Manager
}

func (s *ServiceWrapper) InstallInDevMode() (*config.PluginMeta, error) {
	return s.Mgr.InstallInDevMode()
}
func (s *ServiceWrapper) InstallFromPathPrompt() (*config.PluginMeta, error) {
	return s.Mgr.InstallFromPathPrompt()
}
func (s *ServiceWrapper) InstallPluginFromPath(path string) (*config.PluginMeta, error) {
	return s.Mgr.InstallPluginFromPath(path)
}
func (s *ServiceWrapper) InstallPluginVersion(pluginID, version string) (*config.PluginMeta, error) {
	return s.Mgr.InstallPluginVersion(pluginID, version)
}
func (s *ServiceWrapper) LoadPlugin(id string, opts *LoadPluginOptions) (sdktypes.PluginInfo, error) {
	return s.Mgr.LoadPlugin(id, opts)
}
func (s *ServiceWrapper) ReloadPlugin(id string) (sdktypes.PluginInfo, error) {
	return s.Mgr.ReloadPlugin(id)
}
func (s *ServiceWrapper) RetryFailedPlugin(id string) (sdktypes.PluginInfo, error) {
	return s.Mgr.RetryFailedPlugin(id)
}
func (s *ServiceWrapper) UninstallPlugin(id string) (sdktypes.PluginInfo, error) {
	return s.Mgr.UninstallPlugin(id)
}
func (s *ServiceWrapper) GetPlugin(id string) (sdktypes.PluginInfo, error) {
	return s.Mgr.GetPlugin(id)
}
func (s *ServiceWrapper) ListPlugins() []sdktypes.PluginInfo {
	return s.Mgr.ListPlugins()
}
func (s *ServiceWrapper) GetPluginMeta(id string) (config.PluginMeta, error) {
	return s.Mgr.GetPluginMeta(id)
}
func (s *ServiceWrapper) ListPluginMetas() []config.PluginMeta {
	return s.Mgr.ListPluginMetas()
}
func (s *ServiceWrapper) ListAvailablePlugins() ([]registry.AvailablePlugin, error) {
	return s.Mgr.ListAvailablePlugins()
}
func (s *ServiceWrapper) SearchPlugins(query, category, sort string) ([]registry.AvailablePlugin, error) {
	return s.Mgr.SearchPlugins(query, category, sort)
}
func (s *ServiceWrapper) GetPluginReadme(pluginID string) (string, error) {
	return s.Mgr.GetPluginReadme(pluginID)
}
func (s *ServiceWrapper) GetPluginVersions(pluginID string) ([]registry.VersionInfo, error) {
	return s.Mgr.GetPluginVersions(pluginID)
}
func (s *ServiceWrapper) GetPluginReviews(pluginID string, page int) ([]registry.Review, error) {
	return s.Mgr.GetPluginReviews(pluginID, page)
}
func (s *ServiceWrapper) GetPluginDownloadStats(pluginID string) (*registry.DownloadStats, error) {
	return s.Mgr.GetPluginDownloadStats(pluginID)
}
func (s *ServiceWrapper) GetPluginReleaseHistory(pluginID string) ([]registry.VersionInfo, error) {
	return s.Mgr.GetPluginReleaseHistory(pluginID)
}
