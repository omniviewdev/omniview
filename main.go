package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	execsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	logssdk "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	metricsdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	networkersdk "github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	sdkresource "github.com/omniviewdev/plugin-sdk/pkg/v1/resource"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
	"github.com/wailsapp/wails/v3/pkg/application"

	"go.uber.org/zap"

	"github.com/omniviewdev/omniview/backend/diagnostics"
	"github.com/omniviewdev/omniview/backend/menus"
	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/data"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/exec"
	pluginlogs "github.com/omniviewdev/omniview/backend/pkg/plugin/logs"
	pluginmetric "github.com/omniviewdev/omniview/backend/pkg/plugin/metric"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/networker"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/pluginlog"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/registry"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/ui"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/utils"
	"github.com/omniviewdev/omniview/backend/window"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
	"github.com/omniviewdev/omniview/internal/telemetry"
	"github.com/omniviewdev/omniview/internal/version"
)

const (
	DefaultWebviewWidth  = 1920
	DefaultWebviewHeight = 1080
	MinWebviewWidth      = 1280
	MinWebviewHeight     = 800
)

//go:embed all:dist
var assets embed.FS

//go:embed build/appicon.png
var icon []byte

// pluginRefAdapter adapts plugin.Manager to devserver.PluginRef.
type pluginRefAdapter struct{ mgr plugin.Manager }

func (a *pluginRefAdapter) GetDevPluginInfo(pluginID string) (bool, string, error) {
	info, err := a.mgr.GetPlugin(pluginID)
	if err != nil {
		return false, "", err
	}
	return info.DevMode, info.DevPath, nil
}

// pluginReloaderAdapter adapts plugin.Manager to devserver.PluginReloader.
type pluginReloaderAdapter struct{ mgr plugin.Manager }

func (a *pluginReloaderAdapter) ReloadPlugin(id string) error {
	_, err := a.mgr.ReloadPlugin(id)
	return err
}

// PluginManagerService exposes only the frontend-safe methods of plugin.Manager.
// Internal methods (SetDevServerChecker, SetPluginLogManager, HandlePluginCrash,
// Initialize, Run, Shutdown) are excluded to avoid binding warnings from
// interface/function-type parameters.
type PluginManagerService struct {
	mgr plugin.Manager
}

func (s *PluginManagerService) InstallInDevMode() (*config.PluginMeta, error) {
	return s.mgr.InstallInDevMode()
}
func (s *PluginManagerService) InstallFromPathPrompt() (*config.PluginMeta, error) {
	return s.mgr.InstallFromPathPrompt()
}
func (s *PluginManagerService) InstallPluginFromPath(path string) (*config.PluginMeta, error) {
	return s.mgr.InstallPluginFromPath(path)
}
func (s *PluginManagerService) InstallPluginVersion(pluginID, version string) (*config.PluginMeta, error) {
	return s.mgr.InstallPluginVersion(pluginID, version)
}
func (s *PluginManagerService) LoadPlugin(id string, opts *plugin.LoadPluginOptions) (sdktypes.PluginInfo, error) {
	return s.mgr.LoadPlugin(id, opts)
}
func (s *PluginManagerService) ReloadPlugin(id string) (sdktypes.PluginInfo, error) {
	return s.mgr.ReloadPlugin(id)
}
func (s *PluginManagerService) RetryFailedPlugin(id string) (sdktypes.PluginInfo, error) {
	return s.mgr.RetryFailedPlugin(id)
}
func (s *PluginManagerService) UninstallPlugin(id string) (sdktypes.PluginInfo, error) {
	return s.mgr.UninstallPlugin(id)
}
func (s *PluginManagerService) GetPlugin(id string) (sdktypes.PluginInfo, error) {
	return s.mgr.GetPlugin(id)
}
func (s *PluginManagerService) ListPlugins() []sdktypes.PluginInfo {
	return s.mgr.ListPlugins()
}
func (s *PluginManagerService) GetPluginMeta(id string) (config.PluginMeta, error) {
	return s.mgr.GetPluginMeta(id)
}
func (s *PluginManagerService) ListPluginMetas() []config.PluginMeta {
	return s.mgr.ListPluginMetas()
}
func (s *PluginManagerService) ListAvailablePlugins() ([]registry.AvailablePlugin, error) {
	return s.mgr.ListAvailablePlugins()
}
func (s *PluginManagerService) SearchPlugins(query, category, sort string) ([]registry.AvailablePlugin, error) {
	return s.mgr.SearchPlugins(query, category, sort)
}
func (s *PluginManagerService) GetPluginReadme(pluginID string) (string, error) {
	return s.mgr.GetPluginReadme(pluginID)
}
func (s *PluginManagerService) GetPluginVersions(pluginID string) ([]registry.VersionInfo, error) {
	return s.mgr.GetPluginVersions(pluginID)
}
func (s *PluginManagerService) GetPluginReviews(pluginID string, page int) ([]registry.Review, error) {
	return s.mgr.GetPluginReviews(pluginID, page)
}
func (s *PluginManagerService) GetPluginDownloadStats(pluginID string) (*registry.DownloadStats, error) {
	return s.mgr.GetPluginDownloadStats(pluginID)
}
func (s *PluginManagerService) GetPluginReleaseHistory(pluginID string) ([]registry.VersionInfo, error) {
	return s.mgr.GetPluginReleaseHistory(pluginID)
}

// PluginLogService exposes only frontend-safe methods of pluginlog.Manager.
// Excludes OnEmit (EmitFunc type), Stream (io.Writer), Close, LogDir.
type PluginLogService struct {
	mgr *pluginlog.Manager
}

func (s *PluginLogService) GetLogs(pluginID string, count int) []pluginlog.LogEntry {
	return s.mgr.GetLogs(pluginID, count)
}
func (s *PluginLogService) ListStreams() []string {
	return s.mgr.ListStreams()
}
func (s *PluginLogService) SearchLogs(pluginID, pattern string) ([]pluginlog.LogEntry, error) {
	return s.mgr.SearchLogs(pluginID, pattern)
}
func (s *PluginLogService) Subscribe(pluginID string) int {
	return s.mgr.Subscribe(pluginID)
}
func (s *PluginLogService) Unsubscribe(pluginID string) int {
	return s.mgr.Unsubscribe(pluginID)
}

// DevServerService exposes only frontend-safe methods of devserver.DevServerManager.
// The DevServerManager implements ServiceStartup/ServiceShutdown directly,
// but registering it raw causes service/model shadowing. This wrapper separates
// the service identity from the model type.
type DevServerService struct {
	mgr *devserver.DevServerManager
}

func (s *DevServerService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return s.mgr.ServiceStartup(ctx, options)
}
func (s *DevServerService) ServiceShutdown() error {
	return s.mgr.ServiceShutdown()
}
func (s *DevServerService) StartDevServer(pluginID string) (devserver.DevServerState, error) {
	return s.mgr.StartDevServer(pluginID)
}
func (s *DevServerService) StartDevServerForPath(pluginID, devPath string) (devserver.DevServerState, error) {
	return s.mgr.StartDevServerForPath(pluginID, devPath)
}
func (s *DevServerService) StopDevServer(pluginID string) error {
	return s.mgr.StopDevServer(pluginID)
}
func (s *DevServerService) RestartDevServer(pluginID string) (devserver.DevServerState, error) {
	return s.mgr.RestartDevServer(pluginID)
}
func (s *DevServerService) RebuildPlugin(pluginID string) error {
	return s.mgr.RebuildPlugin(pluginID)
}
func (s *DevServerService) GetDevServerState(pluginID string) devserver.DevServerState {
	return s.mgr.GetDevServerState(pluginID)
}
func (s *DevServerService) ListDevServerStates() []devserver.DevServerState {
	return s.mgr.ListDevServerStates()
}
func (s *DevServerService) GetDevServerLogs(pluginID string, count int) []devserver.LogEntry {
	return s.mgr.GetDevServerLogs(pluginID, count)
}
func (s *DevServerService) IsManaged(pluginID string) bool {
	return s.mgr.IsManaged(pluginID)
}
func (s *DevServerService) GetExternalPluginInfo(pluginID string) *devserver.DevInfoFile {
	return s.mgr.GetExternalPluginInfo(pluginID)
}

// ---------------------------------------------------------------------------
// ResourceControllerService — explicit delegation (no interface embedding).
// Excluded: OnPluginInit, OnPluginStart, OnPluginStop, OnPluginShutdown,
//           OnPluginDestroy, Run, SetCrashCallback, Graph, HasPlugin
// ---------------------------------------------------------------------------

type ResourceControllerService struct {
	ctrl resource.Controller
}

func (s *ResourceControllerService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if ss, ok := s.ctrl.(interface {
		ServiceStartup(context.Context, application.ServiceOptions) error
	}); ok {
		return ss.ServiceStartup(ctx, options)
	}
	return nil
}

func (s *ResourceControllerService) ServiceShutdown() error {
	if ss, ok := s.ctrl.(interface{ ServiceShutdown() error }); ok {
		return ss.ServiceShutdown()
	}
	return nil
}

// CRUD
func (s *ResourceControllerService) Get(pluginID, connectionID, key string, input sdkresource.GetInput) (*sdkresource.GetResult, error) {
	return s.ctrl.Get(pluginID, connectionID, key, input)
}
func (s *ResourceControllerService) List(pluginID, connectionID, key string, input sdkresource.ListInput) (*sdkresource.ListResult, error) {
	return s.ctrl.List(pluginID, connectionID, key, input)
}
func (s *ResourceControllerService) Find(pluginID, connectionID, key string, input sdkresource.FindInput) (*sdkresource.FindResult, error) {
	return s.ctrl.Find(pluginID, connectionID, key, input)
}
func (s *ResourceControllerService) Create(pluginID, connectionID, key string, input sdkresource.CreateInput) (*sdkresource.CreateResult, error) {
	return s.ctrl.Create(pluginID, connectionID, key, input)
}
func (s *ResourceControllerService) Update(pluginID, connectionID, key string, input sdkresource.UpdateInput) (*sdkresource.UpdateResult, error) {
	return s.ctrl.Update(pluginID, connectionID, key, input)
}
func (s *ResourceControllerService) Delete(pluginID, connectionID, key string, input sdkresource.DeleteInput) (*sdkresource.DeleteResult, error) {
	return s.ctrl.Delete(pluginID, connectionID, key, input)
}

// Connection lifecycle
func (s *ResourceControllerService) StartConnection(pluginID, connectionID string) (sdktypes.ConnectionStatus, error) {
	return s.ctrl.StartConnection(pluginID, connectionID)
}
func (s *ResourceControllerService) StopConnection(pluginID, connectionID string) (sdktypes.Connection, error) {
	return s.ctrl.StopConnection(pluginID, connectionID)
}
func (s *ResourceControllerService) CheckConnection(pluginID, connectionID string) (sdktypes.ConnectionStatus, error) {
	return s.ctrl.CheckConnection(pluginID, connectionID)
}
func (s *ResourceControllerService) LoadConnections(pluginID string) ([]sdktypes.Connection, error) {
	return s.ctrl.LoadConnections(pluginID)
}
func (s *ResourceControllerService) ListConnections(pluginID string) ([]sdktypes.Connection, error) {
	return s.ctrl.ListConnections(pluginID)
}
func (s *ResourceControllerService) ListAllConnections() (map[string][]sdktypes.Connection, error) {
	return s.ctrl.ListAllConnections()
}
func (s *ResourceControllerService) GetAllConnectionStates() (map[string][]resource.ConnectionState, error) {
	return s.ctrl.GetAllConnectionStates()
}
func (s *ResourceControllerService) GetConnection(pluginID, connectionID string) (sdktypes.Connection, error) {
	return s.ctrl.GetConnection(pluginID, connectionID)
}
func (s *ResourceControllerService) GetConnectionNamespaces(pluginID, connectionID string) ([]string, error) {
	return s.ctrl.GetConnectionNamespaces(pluginID, connectionID)
}
func (s *ResourceControllerService) AddConnection(pluginID string, connection sdktypes.Connection) error {
	return s.ctrl.AddConnection(pluginID, connection)
}
func (s *ResourceControllerService) UpdateConnection(pluginID string, connection sdktypes.Connection) (sdktypes.Connection, error) {
	return s.ctrl.UpdateConnection(pluginID, connection)
}
func (s *ResourceControllerService) RemoveConnection(pluginID, connectionID string) error {
	return s.ctrl.RemoveConnection(pluginID, connectionID)
}

// Watch lifecycle
func (s *ResourceControllerService) StartConnectionWatch(pluginID, connectionID string) error {
	return s.ctrl.StartConnectionWatch(pluginID, connectionID)
}
func (s *ResourceControllerService) StopConnectionWatch(pluginID, connectionID string) error {
	return s.ctrl.StopConnectionWatch(pluginID, connectionID)
}
func (s *ResourceControllerService) GetWatchState(pluginID, connectionID string) (*sdkresource.WatchConnectionSummary, error) {
	return s.ctrl.GetWatchState(pluginID, connectionID)
}
func (s *ResourceControllerService) EnsureResourceWatch(pluginID, connectionID, resourceKey string) error {
	return s.ctrl.EnsureResourceWatch(pluginID, connectionID, resourceKey)
}
func (s *ResourceControllerService) StopResourceWatch(pluginID, connectionID, resourceKey string) error {
	return s.ctrl.StopResourceWatch(pluginID, connectionID, resourceKey)
}
func (s *ResourceControllerService) RestartResourceWatch(pluginID, connectionID, resourceKey string) error {
	return s.ctrl.RestartResourceWatch(pluginID, connectionID, resourceKey)
}
func (s *ResourceControllerService) IsResourceWatchRunning(pluginID, connectionID, resourceKey string) (bool, error) {
	return s.ctrl.IsResourceWatchRunning(pluginID, connectionID, resourceKey)
}

// Subscriptions
func (s *ResourceControllerService) SubscribeResource(pluginID, connectionID, resourceKey string) error {
	return s.ctrl.SubscribeResource(pluginID, connectionID, resourceKey)
}
func (s *ResourceControllerService) UnsubscribeResource(pluginID, connectionID, resourceKey string) error {
	return s.ctrl.UnsubscribeResource(pluginID, connectionID, resourceKey)
}

// Type metadata
func (s *ResourceControllerService) GetResourceGroups(pluginID, connectionID string) map[string]sdkresource.ResourceGroup {
	return s.ctrl.GetResourceGroups(pluginID, connectionID)
}
func (s *ResourceControllerService) GetResourceGroup(pluginID, groupID string) (sdkresource.ResourceGroup, error) {
	return s.ctrl.GetResourceGroup(pluginID, groupID)
}
func (s *ResourceControllerService) GetResourceTypes(pluginID, connectionID string) map[string]sdkresource.ResourceMeta {
	return s.ctrl.GetResourceTypes(pluginID, connectionID)
}
func (s *ResourceControllerService) GetResourceType(pluginID, typeID string) (*sdkresource.ResourceMeta, error) {
	return s.ctrl.GetResourceType(pluginID, typeID)
}
func (s *ResourceControllerService) HasResourceType(pluginID, typeID string) bool {
	return s.ctrl.HasResourceType(pluginID, typeID)
}
func (s *ResourceControllerService) GetResourceDefinition(pluginID, typeID string) (sdkresource.ResourceDefinition, error) {
	return s.ctrl.GetResourceDefinition(pluginID, typeID)
}
func (s *ResourceControllerService) GetResourceCapabilities(pluginID, key string) (*sdkresource.ResourceCapabilities, error) {
	return s.ctrl.GetResourceCapabilities(pluginID, key)
}
func (s *ResourceControllerService) GetFilterFields(pluginID, connectionID, key string) ([]sdkresource.FilterField, error) {
	return s.ctrl.GetFilterFields(pluginID, connectionID, key)
}
func (s *ResourceControllerService) GetResourceSchema(pluginID, connectionID, key string) (json.RawMessage, error) {
	return s.ctrl.GetResourceSchema(pluginID, connectionID, key)
}

// Actions
func (s *ResourceControllerService) GetActions(pluginID, connectionID, key string) ([]sdkresource.ActionDescriptor, error) {
	return s.ctrl.GetActions(pluginID, connectionID, key)
}
func (s *ResourceControllerService) ExecuteAction(pluginID, connectionID, key, actionID string, input sdkresource.ActionInput) (*sdkresource.ActionResult, error) {
	return s.ctrl.ExecuteAction(pluginID, connectionID, key, actionID, input)
}
func (s *ResourceControllerService) StreamAction(pluginID, connectionID, key, actionID string, input sdkresource.ActionInput) (string, error) {
	return s.ctrl.StreamAction(pluginID, connectionID, key, actionID, input)
}

// Editor schemas
func (s *ResourceControllerService) GetEditorSchemas(pluginID, connectionID string) ([]sdkresource.EditorSchema, error) {
	return s.ctrl.GetEditorSchemas(pluginID, connectionID)
}

// Relationships
func (s *ResourceControllerService) GetRelationships(pluginID, key string) ([]sdkresource.RelationshipDescriptor, error) {
	return s.ctrl.GetRelationships(pluginID, key)
}
func (s *ResourceControllerService) ResolveRelationships(pluginID, connectionID, key, id, namespace string) ([]sdkresource.ResolvedRelationship, error) {
	return s.ctrl.ResolveRelationships(pluginID, connectionID, key, id, namespace)
}

// Health
func (s *ResourceControllerService) GetHealth(pluginID, connectionID, key string, data json.RawMessage) (*sdkresource.ResourceHealth, error) {
	return s.ctrl.GetHealth(pluginID, connectionID, key, data)
}
func (s *ResourceControllerService) GetResourceEvents(pluginID, connectionID, key, id, namespace string, limit int32) ([]sdkresource.ResourceEvent, error) {
	return s.ctrl.GetResourceEvents(pluginID, connectionID, key, id, namespace, limit)
}

// ListPlugins
func (s *ResourceControllerService) ListPlugins() ([]string, error) {
	return s.ctrl.ListPlugins()
}

// HasPlugin
func (s *ResourceControllerService) HasPlugin(pluginID string) bool {
	return s.ctrl.HasPlugin(pluginID)
}

// ---------------------------------------------------------------------------
// SettingsControllerService — explicit delegation.
// Excluded: OnPluginInit, OnPluginStart, OnPluginStop, OnPluginShutdown,
//           OnPluginDestroy, ServiceStartup, ServiceShutdown
// ---------------------------------------------------------------------------

type SettingsControllerService struct {
	ctrl settings.Controller
}

func (s *SettingsControllerService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if ss, ok := s.ctrl.(interface {
		ServiceStartup(context.Context, application.ServiceOptions) error
	}); ok {
		return ss.ServiceStartup(ctx, options)
	}
	return nil
}
func (s *SettingsControllerService) ServiceShutdown() error {
	if ss, ok := s.ctrl.(interface{ ServiceShutdown() error }); ok {
		return ss.ServiceShutdown()
	}
	return nil
}
func (s *SettingsControllerService) ListPlugins() ([]string, error) {
	return s.ctrl.ListPlugins()
}
func (s *SettingsControllerService) HasPlugin(pluginID string) bool {
	return s.ctrl.HasPlugin(pluginID)
}
func (s *SettingsControllerService) Values() map[string]any {
	return s.ctrl.Values()
}
func (s *SettingsControllerService) PluginValues(plugin string) map[string]any {
	return s.ctrl.PluginValues(plugin)
}
func (s *SettingsControllerService) ListSettings(plugin string) map[string]pkgsettings.Setting {
	return s.ctrl.ListSettings(plugin)
}
func (s *SettingsControllerService) GetSetting(plugin, id string) (pkgsettings.Setting, error) {
	return s.ctrl.GetSetting(plugin, id)
}
func (s *SettingsControllerService) SetSetting(plugin, id string, value any) error {
	return s.ctrl.SetSetting(plugin, id, value)
}
func (s *SettingsControllerService) SetSettings(plugin string, settingsMap map[string]any) error {
	return s.ctrl.SetSettings(plugin, settingsMap)
}

// ---------------------------------------------------------------------------
// ExecControllerService — explicit delegation.
// Excluded: OnPluginInit, OnPluginStart, OnPluginStop, OnPluginShutdown,
//           OnPluginDestroy, ServiceStartup, ServiceShutdown
// ---------------------------------------------------------------------------

type ExecControllerService struct {
	ctrl exec.Controller
}

func (s *ExecControllerService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if ss, ok := s.ctrl.(interface {
		ServiceStartup(context.Context, application.ServiceOptions) error
	}); ok {
		return ss.ServiceStartup(ctx, options)
	}
	return nil
}
func (s *ExecControllerService) ServiceShutdown() error {
	if ss, ok := s.ctrl.(interface{ ServiceShutdown() error }); ok {
		return ss.ServiceShutdown()
	}
	return nil
}
func (s *ExecControllerService) CreateSession(plugin, connectionID string, opts execsdk.SessionOptions) (*execsdk.Session, error) {
	return s.ctrl.CreateSession(plugin, connectionID, opts)
}
func (s *ExecControllerService) CreateTerminal(opts execsdk.SessionOptions) (*execsdk.Session, error) {
	return s.ctrl.CreateTerminal(opts)
}
func (s *ExecControllerService) ListSessions() ([]*execsdk.Session, error) {
	return s.ctrl.ListSessions()
}
func (s *ExecControllerService) GetSession(sessionID string) (*execsdk.Session, error) {
	return s.ctrl.GetSession(sessionID)
}
func (s *ExecControllerService) AttachSession(sessionID string) (*execsdk.Session, []byte, error) {
	return s.ctrl.AttachSession(sessionID)
}
func (s *ExecControllerService) DetachSession(sessionID string) (*execsdk.Session, error) {
	return s.ctrl.DetachSession(sessionID)
}
func (s *ExecControllerService) WriteSession(sessionID string, data []byte) error {
	return s.ctrl.WriteSession(sessionID, data)
}
func (s *ExecControllerService) CloseSession(sessionID string) error {
	return s.ctrl.CloseSession(sessionID)
}
func (s *ExecControllerService) ResizeSession(sessionID string, rows, cols uint16) error {
	return s.ctrl.ResizeSession(sessionID, rows, cols)
}
func (s *ExecControllerService) GetHandler(plugin, resource string) *execsdk.Handler {
	return s.ctrl.GetHandler(plugin, resource)
}
func (s *ExecControllerService) GetHandlers() map[string]map[string]execsdk.Handler {
	return s.ctrl.GetHandlers()
}
func (s *ExecControllerService) GetPluginHandlers(plugin string) map[string]execsdk.Handler {
	return s.ctrl.GetPluginHandlers(plugin)
}
func (s *ExecControllerService) ListPlugins() ([]string, error) {
	return s.ctrl.ListPlugins()
}
func (s *ExecControllerService) HasPlugin(pluginID string) bool {
	return s.ctrl.HasPlugin(pluginID)
}

// ---------------------------------------------------------------------------
// LogsControllerService — explicit delegation.
// Excluded: OnPluginInit, OnPluginStart, OnPluginStop, OnPluginShutdown,
//           OnPluginDestroy, ServiceStartup, ServiceShutdown
// ---------------------------------------------------------------------------

type LogsControllerService struct {
	ctrl pluginlogs.Controller
}

func (s *LogsControllerService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if ss, ok := s.ctrl.(interface {
		ServiceStartup(context.Context, application.ServiceOptions) error
	}); ok {
		return ss.ServiceStartup(ctx, options)
	}
	return nil
}
func (s *LogsControllerService) ServiceShutdown() error {
	if ss, ok := s.ctrl.(interface{ ServiceShutdown() error }); ok {
		return ss.ServiceShutdown()
	}
	return nil
}
func (s *LogsControllerService) GetSupportedResources(pluginID string) []logssdk.Handler {
	return s.ctrl.GetSupportedResources(pluginID)
}
func (s *LogsControllerService) CreateSession(plugin, connectionID string, opts logssdk.CreateSessionOptions) (*logssdk.LogSession, error) {
	return s.ctrl.CreateSession(plugin, connectionID, opts)
}
func (s *LogsControllerService) GetSession(sessionID string) (*logssdk.LogSession, error) {
	return s.ctrl.GetSession(sessionID)
}
func (s *LogsControllerService) ListSessions() ([]*logssdk.LogSession, error) {
	return s.ctrl.ListSessions()
}
func (s *LogsControllerService) CloseSession(sessionID string) error {
	return s.ctrl.CloseSession(sessionID)
}
func (s *LogsControllerService) SendCommand(sessionID string, cmd logssdk.LogStreamCommand) error {
	return s.ctrl.SendCommand(sessionID, cmd)
}
func (s *LogsControllerService) UpdateSessionOptions(sessionID string, opts logssdk.LogSessionOptions) (*logssdk.LogSession, error) {
	return s.ctrl.UpdateSessionOptions(sessionID, opts)
}
func (s *LogsControllerService) ListPlugins() ([]string, error) {
	return s.ctrl.ListPlugins()
}
func (s *LogsControllerService) HasPlugin(pluginID string) bool {
	return s.ctrl.HasPlugin(pluginID)
}

// ---------------------------------------------------------------------------
// MetricControllerService — explicit delegation.
// Excluded: OnPluginInit, OnPluginStart, OnPluginStop, OnPluginShutdown,
//           OnPluginDestroy, ServiceStartup, ServiceShutdown
// ---------------------------------------------------------------------------

type MetricControllerService struct {
	ctrl pluginmetric.Controller
}

func (s *MetricControllerService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if ss, ok := s.ctrl.(interface {
		ServiceStartup(context.Context, application.ServiceOptions) error
	}); ok {
		return ss.ServiceStartup(ctx, options)
	}
	return nil
}
func (s *MetricControllerService) ServiceShutdown() error {
	if ss, ok := s.ctrl.(interface{ ServiceShutdown() error }); ok {
		return ss.ServiceShutdown()
	}
	return nil
}
func (s *MetricControllerService) GetProviders() []pluginmetric.MetricProviderSummary {
	return s.ctrl.GetProviders()
}
func (s *MetricControllerService) GetProvidersForResource(resourceKey string) []pluginmetric.MetricProviderSummary {
	return s.ctrl.GetProvidersForResource(resourceKey)
}
func (s *MetricControllerService) Query(pluginID, connectionID string, req metricsdk.QueryRequest) (*metricsdk.QueryResponse, error) {
	return s.ctrl.Query(pluginID, connectionID, req)
}
func (s *MetricControllerService) QueryAll(connectionID, resourceKey, resourceID, namespace string,
	resourceData map[string]interface{}, metricIDs []string,
	shape metricsdk.MetricShape, startTime, endTime time.Time, step time.Duration,
) (map[string]*metricsdk.QueryResponse, error) {
	return s.ctrl.QueryAll(connectionID, resourceKey, resourceID, namespace, resourceData, metricIDs, shape, startTime, endTime, step)
}
func (s *MetricControllerService) Subscribe(pluginID, connectionID string, req pluginmetric.SubscribeRequest) (string, error) {
	return s.ctrl.Subscribe(pluginID, connectionID, req)
}
func (s *MetricControllerService) Unsubscribe(subscriptionID string) error {
	return s.ctrl.Unsubscribe(subscriptionID)
}
func (s *MetricControllerService) ListPlugins() ([]string, error) {
	return s.ctrl.ListPlugins()
}
func (s *MetricControllerService) HasPlugin(pluginID string) bool {
	return s.ctrl.HasPlugin(pluginID)
}

// ---------------------------------------------------------------------------
// NetworkerControllerService — explicit delegation.
// Excluded: OnPluginInit, OnPluginStart, OnPluginStop, OnPluginShutdown,
//           OnPluginDestroy, ServiceStartup, ServiceShutdown
// ---------------------------------------------------------------------------

type NetworkerControllerService struct {
	ctrl networker.Controller
}

func (s *NetworkerControllerService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if ss, ok := s.ctrl.(interface {
		ServiceStartup(context.Context, application.ServiceOptions) error
	}); ok {
		return ss.ServiceStartup(ctx, options)
	}
	return nil
}
func (s *NetworkerControllerService) ServiceShutdown() error {
	if ss, ok := s.ctrl.(interface{ ServiceShutdown() error }); ok {
		return ss.ServiceShutdown()
	}
	return nil
}
func (s *NetworkerControllerService) GetSupportedPortForwardTargets(pluginID string) ([]string, error) {
	return s.ctrl.GetSupportedPortForwardTargets(pluginID)
}
func (s *NetworkerControllerService) GetPortForwardSession(sessionID string) (*networkersdk.PortForwardSession, error) {
	return s.ctrl.GetPortForwardSession(sessionID)
}
func (s *NetworkerControllerService) ListPortForwardSessions(pluginID, connectionID string) ([]*networkersdk.PortForwardSession, error) {
	return s.ctrl.ListPortForwardSessions(pluginID, connectionID)
}
func (s *NetworkerControllerService) ListAllPortForwardSessions() ([]*networkersdk.PortForwardSession, error) {
	return s.ctrl.ListAllPortForwardSessions()
}
func (s *NetworkerControllerService) FindPortForwardSessions(pluginID, connectionID string, request networkersdk.FindPortForwardSessionRequest) ([]*networkersdk.PortForwardSession, error) {
	return s.ctrl.FindPortForwardSessions(pluginID, connectionID, request)
}
func (s *NetworkerControllerService) StartResourcePortForwardingSession(pluginID, connectionID string, opts networkersdk.PortForwardSessionOptions) (*networkersdk.PortForwardSession, error) {
	return s.ctrl.StartResourcePortForwardingSession(pluginID, connectionID, opts)
}
func (s *NetworkerControllerService) ClosePortForwardSession(sessionID string) (*networkersdk.PortForwardSession, error) {
	return s.ctrl.ClosePortForwardSession(sessionID)
}
func (s *NetworkerControllerService) ListPlugins() ([]string, error) {
	return s.ctrl.ListPlugins()
}
func (s *NetworkerControllerService) HasPlugin(pluginID string) bool {
	return s.ctrl.HasPlugin(pluginID)
}

// ---------------------------------------------------------------------------
// DataControllerService — explicit delegation.
// Excluded: ServiceStartup, ServiceShutdown (data.Controller has no plugin
// lifecycle methods since it doesn't embed types.Controller).
// ---------------------------------------------------------------------------

type DataControllerService struct {
	ctrl data.Controller
}

func (s *DataControllerService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if ss, ok := s.ctrl.(interface {
		ServiceStartup(context.Context, application.ServiceOptions) error
	}); ok {
		return ss.ServiceStartup(ctx, options)
	}
	return nil
}
func (s *DataControllerService) ServiceShutdown() error {
	if ss, ok := s.ctrl.(interface{ ServiceShutdown() error }); ok {
		return ss.ServiceShutdown()
	}
	return nil
}
func (s *DataControllerService) Get(pluginID, key string) (any, error) {
	return s.ctrl.Get(pluginID, key)
}
func (s *DataControllerService) Set(pluginID, key string, value any) error {
	return s.ctrl.Set(pluginID, key, value)
}
func (s *DataControllerService) Delete(pluginID, key string) error {
	return s.ctrl.Delete(pluginID, key)
}
func (s *DataControllerService) Keys(pluginID string) ([]string, error) {
	return s.ctrl.Keys(pluginID)
}

// ---------------------------------------------------------------------------
// SettingsProviderService — explicit delegation.
// Excluded: Initialize, RegisterChangeHandler, RegisterSetting,
//           RegisterSettings (internal-only methods).
// ---------------------------------------------------------------------------

type SettingsProviderService struct {
	provider pkgsettings.Provider
}

func (s *SettingsProviderService) LoadSettings() error {
	return s.provider.LoadSettings()
}
func (s *SettingsProviderService) SaveSettings() error {
	return s.provider.SaveSettings()
}
func (s *SettingsProviderService) ListSettings() pkgsettings.Store {
	return s.provider.ListSettings()
}
func (s *SettingsProviderService) Values() map[string]any {
	return s.provider.Values()
}
func (s *SettingsProviderService) GetSetting(id string) (pkgsettings.Setting, error) {
	return s.provider.GetSetting(id)
}
func (s *SettingsProviderService) GetSettingValue(id string) (any, error) {
	return s.provider.GetSettingValue(id)
}
func (s *SettingsProviderService) SetSetting(id string, value any) error {
	return s.provider.SetSetting(id, value)
}
func (s *SettingsProviderService) SetSettings(settingsMap map[string]any) error {
	return s.provider.SetSettings(settingsMap)
}
func (s *SettingsProviderService) ResetSetting(id string) error {
	return s.provider.ResetSetting(id)
}
func (s *SettingsProviderService) GetCategories() []pkgsettings.Category {
	return s.provider.GetCategories()
}
func (s *SettingsProviderService) GetCategory(id string) (pkgsettings.Category, error) {
	return s.provider.GetCategory(id)
}
func (s *SettingsProviderService) GetCategoryValues(id string) (map[string]interface{}, error) {
	return s.provider.GetCategoryValues(id)
}
func (s *SettingsProviderService) GetString(id string) (string, error) {
	return s.provider.GetString(id)
}
func (s *SettingsProviderService) GetStringSlice(id string) ([]string, error) {
	return s.provider.GetStringSlice(id)
}
func (s *SettingsProviderService) GetInt(id string) (int, error) {
	return s.provider.GetInt(id)
}
func (s *SettingsProviderService) GetIntSlice(id string) ([]int, error) {
	return s.provider.GetIntSlice(id)
}
func (s *SettingsProviderService) GetFloat(id string) (float64, error) {
	return s.provider.GetFloat(id)
}
func (s *SettingsProviderService) GetFloatSlice(id string) ([]float64, error) {
	return s.provider.GetFloatSlice(id)
}
func (s *SettingsProviderService) GetBool(id string) (bool, error) {
	return s.provider.GetBool(id)
}

// BootstrapService wraps the startup/shutdown logic that was previously in the
// Wails v2 OnStartup/OnShutdown closures. It implements ServiceStartup and
// ServiceShutdown so the Wails v3 runtime calls it automatically.
type BootstrapService struct {
	log                  logging.Logger
	settingsProvider     pkgsettings.Provider
	telemetrySvc         *telemetry.Service
	pluginManager        plugin.Manager
	pluginRegistryClient *registry.Client
}

func (b *BootstrapService) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	// Initialize the settings
	if err := b.settingsProvider.Initialize(
		ctx,
		coresettings.General,
		coresettings.Appearance,
		coresettings.Terminal,
		coresettings.Editor,
		coresettings.Developer,
		coresettings.Telemetry,
	); err != nil {
		b.log.Errorw(ctx, "error while initializing settings system", "error", err)
	}

	// Wire telemetry settings hot-toggle: when any setting in the
	// "telemetry" category changes, rebuild TelemetryConfig and apply.
	telemetryFromSettings := func(vals map[string]any) telemetry.TelemetryConfig {
		cfg := b.telemetrySvc.Config()
		if v, ok := vals["enabled"].(bool); ok {
			cfg.Enabled = v
		}
		if v, ok := vals["traces"].(bool); ok {
			cfg.Traces = v
		}
		if v, ok := vals["metrics"].(bool); ok {
			cfg.Metrics = v
		}
		if v, ok := vals["logs_ship"].(bool); ok {
			cfg.LogsShip = v
		}
		if v, ok := vals["logs_ship_level"].(string); ok {
			cfg.LogsShipLevel = v
		}
		if v, ok := vals["profiling"].(bool); ok {
			cfg.Profiling = v
		}
		if v, ok := vals["endpoint_otlp"].(string); ok {
			cfg.OTLPEndpoint = v
		}
		if v, ok := vals["endpoint_pyroscope"].(string); ok {
			cfg.PyroscopeEndpoint = v
		}
		if v, ok := vals["auth_header"].(string); ok {
			cfg.AuthHeader = v
		}
		if v, ok := vals["auth_value"].(string); ok {
			cfg.AuthValue = v
		}
		return cfg
	}

	b.settingsProvider.RegisterChangeHandler("telemetry", func(vals map[string]any) {
		cfg := telemetryFromSettings(vals)
		if err := b.telemetrySvc.ApplyConfig(ctx, cfg); err != nil {
			b.log.Errorw(ctx, "failed to apply telemetry config change", "error", err)
		} else {
			b.log.Infow(ctx, "telemetry config updated from settings")
		}
	})

	// Apply the persisted telemetry settings immediately so telemetry
	// activates on startup (the change handler only fires on changes).
	if vals, err := b.settingsProvider.GetCategoryValues("telemetry"); err == nil {
		cfg := telemetryFromSettings(vals)
		if err := b.telemetrySvc.ApplyConfig(ctx, cfg); err != nil {
			b.log.Errorw(ctx, "failed to apply initial telemetry config", "error", err)
		} else {
			b.log.Infow(ctx, "telemetry initialized from persisted settings", "enabled", cfg.Enabled)
		}
	}

	// Apply user-configured marketplace URL to the registry client.
	if marketplaceURL, err := b.settingsProvider.GetString("developer.marketplace_url"); err == nil && marketplaceURL != "" {
		b.pluginRegistryClient.SetBaseURL(marketplaceURL)
		safeHost := marketplaceURL
		if u, parseErr := url.Parse(marketplaceURL); parseErr == nil {
			safeHost = u.Host
		}
		b.log.Infow(ctx, "using custom marketplace URL", "host", safeHost)
	}

	// Controllers now implement ServiceStartup/ServiceShutdown and are
	// registered as Wails v3 services, so Wails calls their lifecycle
	// methods automatically.

	// Initialize the plugin system
	if err := b.pluginManager.Initialize(ctx); err != nil {
		b.log.Errorw(ctx, "error while initializing plugin system", "error", err)
	}
	b.pluginManager.Run(ctx)

	return nil
}

func (b *BootstrapService) ServiceShutdown() error {
	// DevServerManager and controllers have their own ServiceShutdown
	// called by Wails v3 automatically.
	b.pluginManager.Shutdown()
	_ = b.telemetrySvc.Shutdown(context.Background())
	return nil
}

//nolint:funlen // main function is expected to be long
func main() {
	// Bootstrap telemetry (tracing, metrics, log shipping, profiling).
	telemetryCfg := telemetry.DefaultConfig(version.IsDevelopment())
	telemetrySvc := telemetry.New(
		telemetryCfg,
		version.Version,
		version.GitCommit,
		version.BuildDate,
		version.IsDevelopment(),
	)
	if err := telemetrySvc.Init(context.Background()); err != nil {
		fmt.Fprintf(os.Stderr, "telemetry init failed, continuing without telemetry: %v\n", err)
	}
	zapLogger := telemetrySvc.ZapLogger()
	if zapLogger == nil {
		zapLogger, _ = zap.NewProduction()
	}
	log := logging.New(logging.Config{
		Name:    "omniview",
		Backend: telemetry.NewZapBackend(zapLogger),
		Level:   logging.NewLevelController(logging.LevelDebug),
	})

	diagnosticsClient := diagnostics.NewDiagnosticsClient(version.IsDevelopment())

	settingsProvider := pkgsettings.NewProvider(pkgsettings.ProviderOpts{
		Logger: zapLogger.Sugar(),
	})

	// Create our plugin system managers
	uiManager := ui.NewComponentManager(log)

	managers := map[string]types.PluginManager{
		"ui": uiManager,
	}

	utilsClient := utils.NewClient()

	// Setup the plugin systems
	resourceController := resource.NewController(log, settingsProvider)

	settingsController := settings.NewController(log, settingsProvider)

	execController := exec.NewController(log, settingsProvider, resourceController)

	networkerController := networker.NewController(log, settingsProvider, resourceController)

	logsController := pluginlogs.NewController(log, settingsProvider, resourceController)

	metricController := pluginmetric.NewController(log, settingsProvider, resourceController)

	dataController := data.NewController(log)

	// Initialize per-plugin log manager for capturing plugin process stderr.
	// Created here so it can be bound to Wails for UI access.
	home, _ := os.UserHomeDir()
	pluginLogManager, pluginLogErr := pluginlog.NewManager(
		filepath.Join(home, ".omniview", "logs"),
		pluginlog.DefaultRotation(),
	)
	if pluginLogErr != nil {
		log.Warnw(context.Background(), "failed to initialize plugin log manager", "error", pluginLogErr)
	}

	pluginRegistryClient := registry.NewClient("")
	pluginManager := plugin.NewManager(
		log,
		resourceController,
		settingsController,
		execController,
		networkerController,
		logsController,
		metricController,
		managers,
		settingsProvider,
		pluginRegistryClient,
		func() plugin.TelemetryEnvConfig {
			cfg := telemetrySvc.Config()
			return plugin.TelemetryEnvConfig{
				Enabled:           cfg.Enabled,
				OTLPEndpoint:      cfg.OTLPEndpoint,
				Profiling:         cfg.Profiling,
				PyroscopeEndpoint: cfg.PyroscopeEndpoint,
			}
		},
	)

	// Wire crash recovery: when a plugin crash is detected by the resource
	// controller's event listeners, the manager will attempt to reload it.
	resourceController.SetCrashCallback(pluginManager.HandlePluginCrash)

	devServerManager := devserver.NewDevServerManager(
		log,
		&pluginRefAdapter{mgr: pluginManager},
		&pluginReloaderAdapter{mgr: pluginManager},
		settingsProvider,
	)

	// Wire the dev server checker into the plugin manager so the old watcher
	// skips plugins managed by DevServerManager.
	pluginManager.SetDevServerChecker(devServerManager)
	pluginManager.SetDevServerManager(devServerManager)

	if pluginLogManager != nil {
		pluginManager.SetPluginLogManager(pluginLogManager)
	}

	// Create the AppService
	appService := NewAppService()

	// Create the bootstrap service that wraps startup/shutdown logic
	bootstrapService := &BootstrapService{
		log:                  log,
		settingsProvider:     settingsProvider,
		telemetrySvc:         telemetrySvc,
		pluginManager:        pluginManager,
		pluginRegistryClient: pluginRegistryClient,
	}

	// Set up plugin asset handler middleware
	pluginAssetHandler := NewPluginAssetHandler(log)

	// Wrap the plugin manager interface in a concrete struct for v3 service
	// registration (NewService requires a concrete pointer type).
	pluginManagerSvc := &PluginManagerService{mgr: pluginManager}

	// Build the service list. All concrete pointer types use NewService directly.
	// BootstrapService is registered first so startup logic runs before other
	// services that might depend on initialized controllers. It has no
	// frontend-facing methods — only ServiceStartup/ServiceShutdown.
	// Service registration order matters: Wails calls ServiceStartup in order.
	// Controllers must be initialized (receive ctx + app) BEFORE the bootstrap
	// service, because bootstrap calls pluginManager.Initialize() which triggers
	// OnPluginStart on all controllers — they need ctx for gRPC streams.
	services := []application.Service{
		// 1. Controllers — need ctx before plugin loading
		application.NewService(&ResourceControllerService{ctrl: resourceController}),
		application.NewService(&SettingsControllerService{ctrl: settingsController}),
		application.NewService(&ExecControllerService{ctrl: execController}),
		application.NewService(&NetworkerControllerService{ctrl: networkerController}),
		application.NewService(&LogsControllerService{ctrl: logsController}),
		application.NewService(&MetricControllerService{ctrl: metricController}),
		application.NewService(&DataControllerService{ctrl: dataController}),
		application.NewService(ui.NewServiceWrapper(uiManager)),
		application.NewService(utilsClient),
		application.NewService(&DevServerService{mgr: devServerManager}),
		// 2. Bootstrap — initializes settings, telemetry, loads plugins
		application.NewService(bootstrapService),
		// 3. Frontend-facing services (no startup order dependency)
		application.NewService(appService),
		application.NewService(diagnosticsClient),
		application.NewService(telemetry.NewTelemetryBinding(telemetrySvc)),
		application.NewService(&SettingsProviderService{provider: settingsProvider}),
		application.NewService(pluginManagerSvc),
	}

	if pluginLogManager != nil {
		services = append(services, application.NewService(&PluginLogService{mgr: pluginLogManager}))
	}

	// Create the Wails v3 application
	app := application.New(application.Options{
		Name:        "Omniview",
		Description: fmt.Sprintf("Omniview %s", version.Version),
		Icon:        icon,
		Services:    services,
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(assets),
			Middleware: pluginAssetHandler.Middleware,
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		Linux: application.LinuxOptions{
			ProgramName: "Omniview",
		},
	})

	// Create the main window
	mainWindow := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      "main",
		Title:     "Omniview",
		Width:     DefaultWebviewWidth,
		Height:    DefaultWebviewHeight,
		MinWidth:  MinWebviewWidth,
		MinHeight: MinWebviewHeight,
		//nolint:gomnd // #0D1117 dark theme background
		BackgroundColour: application.NewRGBA(13, 17, 23, 255),
		Mac: application.MacWindow{
			TitleBar:   application.MacTitleBarHiddenInset,
			Appearance: application.NSAppearanceNameDarkAqua,
			Backdrop:   application.MacBackdropTranslucent,
		},
	})

	// Set up menus
	menus.SetupAppMenu(app, mainWindow)

	// Set up window manager (registers hide-on-close hook, etc.)
	_ = window.NewManager(app, mainWindow)

	// Run the application
	if err := app.Run(); err != nil {
		log.Fatalw(context.Background(), "wails app exited with error", "error", err)
	}
}
