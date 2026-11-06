package grafana

import (
	"context"
	"os"
	"testing"

	hostactivity "github.com/omniviewdev/omniview/backend/pkg/activity"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	hostexec "github.com/omniviewdev/omniview/backend/pkg/plugin/exec"
	hostlifecycle "github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	hostlogs "github.com/omniviewdev/omniview/backend/pkg/plugin/logs"
	hostmetric "github.com/omniviewdev/omniview/backend/pkg/plugin/metric"
	hostnetworker "github.com/omniviewdev/omniview/backend/pkg/plugin/networker"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	hostsettings "github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	hosttools "github.com/omniviewdev/omniview/backend/pkg/plugin/tools"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	hostui "github.com/omniviewdev/omniview/backend/pkg/plugin/ui"
	settingsservice "github.com/omniviewdev/omniview/backend/pkg/settings"
	"github.com/omniviewdev/omniview/internal/appstate"
	coresettings "github.com/omniviewdev/omniview/internal/settings"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	logging "github.com/omniviewdev/plugin-sdk/log"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	lifecyclepb "github.com/omniviewdev/plugin-sdk/proto/v1/lifecycle"
	"github.com/stretchr/testify/require"
)

func TestGrafanaNativeLifecycleIdentityAndRetirement(t *testing.T) {
	dir := t.TempDir()
	entry := CatalogEntry(func() (*os.Root, error) { return os.OpenRoot(dir) })
	backend, err := entry.NewBackend(context.Background())
	require.NoError(t, err)
	defer backend.Stop()
	raw, err := backend.Dispense("lifecycle")
	require.NoError(t, err)
	lifecycle := raw.(*plugintypes.NativeLifecycle)
	info, err := lifecycle.GetInfo(context.Background())
	require.NoError(t, err)
	require.Equal(t, entry.Metadata.ID, info.PluginId)
	require.Equal(t, entry.Metadata.Version, info.Version)
	capabilities, err := lifecycle.GetCapabilities(context.Background())
	require.NoError(t, err)
	require.Equal(t, []string{"metric", "ui"}, capabilities.Capabilities)
	capabilities.Capabilities[0] = "caller-mutation"
	again, err := lifecycle.GetCapabilities(context.Background())
	require.NoError(t, err)
	require.Equal(t, "metric", again.Capabilities[0])
	health, err := lifecycle.HealthCheck(context.Background())
	require.NoError(t, err)
	require.Equal(t, lifecyclepb.ServingStatus_SERVING_STATUS_SERVING, health.Status)
	metric, err := backend.Dispense("metric")
	require.NoError(t, err)
	_, finite := metric.(sdkmetric.FiniteQueryProvider)
	require.True(t, finite)
	_, legacy := metric.(sdkmetric.Provider)
	require.False(t, legacy, "lifecycle registration must not add dummy legacy metric callbacks")
	require.NoError(t, backend.Stop())
	health, err = lifecycle.HealthCheck(context.Background())
	require.NoError(t, err)
	require.Equal(t, lifecyclepb.ServingStatus_SERVING_STATUS_NOT_SERVING, health.Status)
}

// The frontend activates the builtin with every production controller present.
// Declared capabilities, not missing-controller shortcuts, govern provider startup.
func TestGrafanaPluginServiceActivationWithHostActivities(t *testing.T) {
	roots := appstate.NewTestService(t)
	log := logging.NewNop()
	store, err := settingsstore.Open(roots.RootDir().ResolvePath("settings.db"))
	require.NoError(t, err)
	defer store.Close()
	core, err := settingsservice.Initialize(settingsservice.Options{Store: store, Categories: coresettings.Definitions(false)})
	require.NoError(t, err)
	settingsProvider := core.Provider()
	settings := hostsettings.NewController(log, store)
	core.AttachPlugins(settings)
	boundary := invocation.NewBoundary(nil)
	resources := resource.NewController(log, settingsProvider, roots.PluginStore, boundary)
	metrics := hostmetric.NewController(log, settingsProvider, resources)
	metrics.SetMetricStateRoot(roots.RootDir())
	dir := t.TempDir()
	catalog, err := plugin.NewCatalog([]plugin.CatalogEntry{CatalogEntry(func() (*os.Root, error) { return os.OpenRoot(dir) })})
	require.NoError(t, err)
	exec := hostexec.NewController(log, settingsProvider, resources)
	networker := hostnetworker.NewController(log, settingsProvider, resources)
	logs := hostlogs.NewController(log, settingsProvider, resources)
	tools := hosttools.NewController(log, boundary)
	managers := map[string]plugintypes.PluginManager{"ui": hostui.NewComponentManager(log)}
	manager := plugin.NewManager(log, roots.RootDir(), roots.Plugins(), resources, settings, exec, networker, logs, metrics, tools, managers, settingsProvider, nil, nil, catalog)
	defer manager.Shutdown()
	activities, err := hostactivity.NewService(roots.RootDir(), nil)
	require.NoError(t, err)
	plugin.ConfigureActivities(manager, resources, activities)
	require.NoError(t, manager.Initialize(context.Background()))
	service := &plugin.ServiceWrapper{Mgr: manager}
	info, err := service.LoadPlugin("grafana", nil)
	require.NoError(t, err)
	require.Equal(t, string(hostlifecycle.PhaseRunning), info.Phase)
	require.Equal(t, "builtin", info.Origin)
	require.False(t, settings.HasPlugin("grafana"), "undeclared settings provider must never be dispensed")
	connections, err := metrics.GetProviderConnections("grafana")
	require.NoError(t, err)
	require.Empty(t, connections)
	secret := "private-token"
	_, err = metrics.SaveProviderConnection("grafana", sdkmetric.ProviderConnectionInput{
		Connection: sdkmetric.ProviderConnection{ID: "configured", Name: "Configured", Kind: "prometheus", URL: "https://metrics.example.invalid", PublicConfig: map[string]string{"credentialKind": "prometheus-token"}},
		Credential: &secret,
	})
	require.NoError(t, err, "finite source configuration does not require a settings capability")
	_, err = service.ReloadPlugin("grafana")
	require.NoError(t, err, "reload must create a fresh native lifecycle and retire the previous provider")
	require.False(t, settings.HasPlugin("grafana"))
	connections, err = metrics.GetProviderConnections("grafana")
	require.NoError(t, err)
	require.Len(t, connections, 1)
	require.Equal(t, "configured", connections[0].ID)
	require.True(t, connections[0].HasCredentials)
}
