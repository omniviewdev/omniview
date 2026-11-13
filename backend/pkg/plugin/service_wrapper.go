package plugin

import (
	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// ServiceWrapper exposes only the frontend-safe methods of plugin.Manager.
// Internal methods (SetDevServerChecker, SetPluginLogManager, HandlePluginCrash,
// Initialize, Run, Shutdown) are excluded to avoid binding warnings from
// interface/function-type parameters.
type ServiceWrapper struct {
	Mgr Manager
}

func (s *ServiceWrapper) SetPluginEnabled(id string, enabled bool) (plugintypes.PluginInfo, error) {
	return s.Mgr.SetPluginEnabled(id, enabled)
}
func (s *ServiceWrapper) InstallInDevMode() (*config.PluginMeta, error) {
	return s.Mgr.InstallInDevMode()
}
func (s *ServiceWrapper) InstallDevPluginFromPath(path string) (plugintypes.PluginInfo, error) {
	return s.Mgr.InstallDevPluginFromPath(path)
}
func (s *ServiceWrapper) UnlinkDevPlugin(id string) (plugintypes.PluginInfo, error) {
	return s.Mgr.UnlinkDevPlugin(id)
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
func (s *ServiceWrapper) LoadPlugin(id string, opts *LoadPluginOptions) (plugintypes.PluginInfo, error) {
	return s.Mgr.LoadPlugin(id, opts)
}
func (s *ServiceWrapper) ReloadPlugin(id string) (plugintypes.PluginInfo, error) {
	return s.Mgr.ReloadPlugin(id)
}
func (s *ServiceWrapper) RetryFailedPlugin(id string) (plugintypes.PluginInfo, error) {
	return s.Mgr.RetryFailedPlugin(id)
}
func (s *ServiceWrapper) UninstallPlugin(id string) (plugintypes.PluginInfo, error) {
	return s.Mgr.UninstallPlugin(id)
}
func (s *ServiceWrapper) GetPlugin(id string) (plugintypes.PluginInfo, error) {
	return s.Mgr.GetPlugin(id)
}
func (s *ServiceWrapper) ListPlugins() []plugintypes.PluginInfo {
	return s.Mgr.ListPlugins()
}
func (s *ServiceWrapper) GetPluginMeta(id string) (config.PluginMeta, error) {
	return s.Mgr.GetPluginMeta(id)
}
func (s *ServiceWrapper) ListPluginMetas() []config.PluginMeta {
	return s.Mgr.ListPluginMetas()
}
func (s *ServiceWrapper) GetPluginProfilingStatuses() []PluginProfilingStatus {
	return s.Mgr.GetPluginProfilingStatuses()
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
func (s *ServiceWrapper) GetPluginReleaseState(pluginID string) (PluginReleaseState, error) {
	return s.Mgr.GetPluginReleaseState(pluginID)
}
func (s *ServiceWrapper) GetPluginChannelVersions(pluginID, channel string) ([]registry.VersionInfo, error) {
	return s.Mgr.GetPluginChannelVersions(pluginID, channel)
}
func (s *ServiceWrapper) InstallPluginChannelVersion(pluginID, channel, version string) (*config.PluginMeta, error) {
	return s.Mgr.InstallPluginChannelVersion(pluginID, channel, version)
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
