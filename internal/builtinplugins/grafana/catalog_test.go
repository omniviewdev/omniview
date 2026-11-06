package grafana

import (
	"context"
	"os"
	"testing"

	hostactivity "github.com/omniviewdev/omniview/backend/pkg/activity"
	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/backend/pkg/plugin"
	hostlifecycle "github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	hostmetric "github.com/omniviewdev/omniview/backend/pkg/plugin/metric"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
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

// The production frontend uses ServiceWrapper.LoadPlugin with the host activity
// service configured. A catalog-factory-only test misses that lifecycle boundary.
func TestGrafanaPluginServiceActivationWithHostActivities(t *testing.T) {
	roots := appstate.NewTestService(t)
	log := logging.NewNop()
	resources := resource.NewController(log, nil, roots.PluginStore, invocation.NewBoundary(nil))
	metrics := hostmetric.NewController(log, nil, resources)
	metrics.SetMetricStateRoot(roots.RootDir())
	dir := t.TempDir()
	catalog, err := plugin.NewCatalog([]plugin.CatalogEntry{CatalogEntry(func() (*os.Root, error) { return os.OpenRoot(dir) })})
	require.NoError(t, err)
	manager := plugin.NewManager(log, roots.RootDir(), roots.Plugins(), resources, nil, nil, nil, nil, metrics, nil, nil, nil, nil, nil, catalog)
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
	connections, err := metrics.GetProviderConnections("grafana")
	require.NoError(t, err)
	require.Empty(t, connections)
	_, err = service.ReloadPlugin("grafana")
	require.NoError(t, err, "reload must create a fresh native lifecycle and retire the previous provider")
}
