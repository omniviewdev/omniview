package plugin_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	hostplugin "github.com/omniviewdev/omniview/backend/pkg/plugin"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	hostmetric "github.com/omniviewdev/omniview/backend/pkg/plugin/metric"
	hostsettings "github.com/omniviewdev/omniview/backend/pkg/plugin/settings"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/builtinplugins/grafana"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	sdksettings "github.com/omniviewdev/plugin-sdk/pkg/v1/settings"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
	"github.com/stretchr/testify/require"
)

func TestMetricOnlyNativeCatalogLoadsWithRealSettingsController(t *testing.T) {
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/query" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"status": "success", "data": map[string]any{"resultType": "vector", "result": []any{
				map[string]any{"metric": map[string]string{"cluster": "cluster-a", "namespace": "ns", "pod": "pod"}, "value": []any{time.Now().Unix(), "1750"}},
			}},
		}))
	}))
	defer endpoint.Close()
	roots := appstate.NewTestService(t)
	logger := logging.NewNop()
	preferences := hostsettings.NewController(logger, nil)
	metrics := hostmetric.NewController(logger, nil, nil)
	metrics.SetMetricStateRoot(roots.RootDir())
	private := t.TempDir()
	catalog, err := hostplugin.NewCatalog([]hostplugin.CatalogEntry{grafana.CatalogEntry(func() (*os.Root, error) { return os.OpenRoot(private) })})
	require.NoError(t, err)
	manager := hostplugin.NewManager(logger, roots.RootDir(), roots.Plugins(), nil, preferences, nil, nil, nil, metrics, nil, nil, nil, nil, nil, catalog)
	require.NoError(t, manager.Initialize(context.Background()))
	_, err = manager.LoadPlugin("grafana", nil)
	require.NoError(t, err, "metric-only native composition must not dispense undeclared settings")
	t.Cleanup(func() { require.NoError(t, manager.UnloadPlugin("grafana")) })
	info, err := manager.GetPlugin("grafana")
	require.NoError(t, err)
	require.Equal(t, string(lifecycle.PhaseRunning), info.Phase)
	require.False(t, preferences.HasPlugin("grafana"))
	providers := metrics.GetProviders()
	require.Len(t, providers, 1)
	require.Equal(t, "grafana", providers[0].PluginID)
	source := sdkmetric.MetricSourceReference{PluginID: "grafana", ConnectionID: "monitoring", DatasourceUID: "direct", DatasourceKind: "prometheus"}
	_, err = metrics.SaveProviderConnection("grafana", sdkmetric.ProviderConnectionInput{Connection: sdkmetric.ProviderConnection{
		ID: "monitoring", Name: "Production catalog fixture", Kind: "prometheus", URL: endpoint.URL,
		PublicConfig: map[string]string{"credentialKind": "prometheus-token", "allowInsecureHTTP": "true"},
	}})
	require.NoError(t, err)
	_, err = metrics.SaveMetricBinding(sdkmetric.MetricBinding{ID: "cluster", Signal: "metrics", ResourcePluginID: "owner", ResourceConnectionID: "cluster", Source: source, Policy: "replace", PublicScope: map[string]string{"cluster": "cluster-a"}})
	require.NoError(t, err)
	scope := invocation.NewScope(invocation.TrustedUI)
	boundary := invocation.NewBoundary(nil)
	metrics.SetUIReferenceAdmitter(func(ctx context.Context, operation, owner string, route resourcev2.AccessRoute, ref resourcev2.ResourceReference) (context.Context, error) {
		return boundary.Admit(scope.Context(ctx), operation, invocation.Target{Provider: owner, Connection: route.Connection, ResourceType: ref.Address.Type})
	})
	response, err := metrics.QueryResources(context.Background(), sdkmetric.ResourceSetQueryRequest{
		ResourcePluginID: "owner", ResourceConnectionID: "cluster", MetricIDs: []string{"cpu_usage"}, Shape: sdkmetric.ShapeCurrent,
		Resources: []sdkmetric.MetricResource{{Token: "pod", ResourceKey: "k8s:/pods", Reference: &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{
			Provider: "owner", Authority: "fixture-authority", Type: "k8s:/pods", ID: "pod", Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "ns"}},
		}}, Route: &resourcev2.AccessRoute{Connection: "cluster"}}},
	})
	require.NoError(t, err)
	require.Len(t, response.Results, 1)
	require.Equal(t, sdkmetric.MetricStatusOK, response.Results[0].Status)
	require.Equal(t, 1750.0, response.Results[0].Value.CurrentValue.Value)
	require.Equal(t, source, response.Results[0].Provenance.Source)
}

// The displayed provider name consumes a real persisted setting during metric
// discovery, making pre-consumer hydration observable without startup counters.
type configuredCatalogMetric struct {
	sdkmetric.Provider
	preferences pkgsettings.Provider
}

func (m configuredCatalogMetric) GetSupportedResources(ctx *sdktypes.PluginContext) (*sdkmetric.ProviderInfo, []sdkmetric.Handler) {
	info, handlers := m.Provider.GetSupportedResources(ctx)
	configured := *info
	enabled, err := m.preferences.GetBool("features.enabled")
	if err == nil && enabled {
		configured.Name = "Persisted feature enabled"
	} else {
		configured.Name = "Default feature disabled"
	}
	return &configured, handlers
}

func TestNegotiatedNativeSettingsHydrateBeforeMetricDiscovery(t *testing.T) {
	roots := appstate.NewTestService(t)
	store, err := settingsstore.Open(filepath.Join(t.TempDir(), "settings.db"))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, store.Close()) })
	require.NoError(t, store.SavePluginSettings("configured", map[string]any{"features.enabled": true}))
	logger := logging.NewNop()
	preferences := hostsettings.NewController(logger, store)
	metrics := hostmetric.NewController(logger, nil, nil)
	private := t.TempDir()
	entry := hostplugin.CatalogEntry{Metadata: config.PluginMeta{ID: "configured", Name: "Configured metrics", Version: "1.0.0", Capabilities: []string{"metric", "settings"}}, NewBackend: func(context.Context) (plugintypes.PluginBackend, error) {
		settings := pkgsettings.NewProvider(pkgsettings.ProviderOpts{PluginID: "configured", PluginSettings: []pkgsettings.Category{{ID: "plugin", Settings: map[string]pkgsettings.Setting{
			"features.enabled": {ID: "features.enabled", Type: pkgsettings.Toggle, Value: false, Default: false},
		}}}})
		settingsTransport := sdksettings.NewProviderWrapper(settings)
		require.Contains(t, settingsTransport.ListSettings(), "features.enabled", "fixture must expose the SDK plugin-scoped schema")
		provider := grafana.NewProvider(func() (*os.Root, error) { return os.OpenRoot(private) })
		return plugintypes.ComposeNativeBackend(plugintypes.NativeProviders{Metric: configuredCatalogMetric{Provider: provider, preferences: settings}, Settings: settingsTransport, Shutdown: provider.Close})
	}}
	catalog, err := hostplugin.NewCatalog([]hostplugin.CatalogEntry{entry})
	require.NoError(t, err)
	manager := hostplugin.NewManager(logger, roots.RootDir(), roots.Plugins(), nil, preferences, nil, nil, nil, metrics, nil, nil, nil, nil, nil, catalog)
	require.NoError(t, manager.Initialize(context.Background()))
	_, err = manager.LoadPlugin("configured", nil)
	require.NoError(t, err)
	require.True(t, preferences.HasPlugin("configured"))
	providers := metrics.GetProviders()
	require.Len(t, providers, 1)
	require.Equal(t, "Persisted feature enabled", providers[0].Name)
	err = manager.UnloadPlugin("configured")
	require.NoError(t, err)
	require.False(t, preferences.HasPlugin("configured"), "settings cleanup still retires negotiated clients")
	require.Empty(t, metrics.GetProviders())
}

type unavailableCatalogSettings struct{ plugintypes.PluginBackend }

func (b unavailableCatalogSettings) Dispense(capability string) (any, error) {
	if capability == "settings" {
		return nil, errors.New("settings transport unavailable")
	}
	return b.PluginBackend.Dispense(capability)
}
func (b unavailableCatalogSettings) DetectCapabilities() ([]string, error) {
	return b.PluginBackend.(plugintypes.CapabilityDetector).DetectCapabilities()
}

func TestDeclaredNativeSettingsFailureFailsActivationAndReleasesBackend(t *testing.T) {
	roots := appstate.NewTestService(t)
	logger := logging.NewNop()
	preferences := hostsettings.NewController(logger, nil)
	metrics := hostmetric.NewController(logger, nil, nil)
	private := t.TempDir()
	var provider *grafana.Provider
	entry := hostplugin.CatalogEntry{Metadata: config.PluginMeta{ID: "broken-settings", Version: "1.0.0", Capabilities: []string{"metric", "settings"}}, NewBackend: func(context.Context) (plugintypes.PluginBackend, error) {
		provider = grafana.NewProvider(func() (*os.Root, error) { return os.OpenRoot(private) })
		backend, err := plugintypes.ComposeNativeBackend(plugintypes.NativeProviders{Metric: provider, Settings: sdksettings.NewProviderWrapper(pkgsettings.NewProvider(pkgsettings.ProviderOpts{})), Shutdown: provider.Close})
		if err != nil {
			return nil, err
		}
		return unavailableCatalogSettings{PluginBackend: backend}, nil
	}}
	catalog, err := hostplugin.NewCatalog([]hostplugin.CatalogEntry{entry})
	require.NoError(t, err)
	manager := hostplugin.NewManager(logger, roots.RootDir(), roots.Plugins(), nil, preferences, nil, nil, nil, metrics, nil, nil, nil, nil, nil, catalog)
	require.NoError(t, manager.Initialize(context.Background()))
	_, err = manager.LoadPlugin("broken-settings", nil)
	require.ErrorContains(t, err, "settings transport unavailable")
	info, err := manager.GetPlugin("broken-settings")
	require.NoError(t, err)
	require.Equal(t, string(lifecycle.PhaseFailed), info.Phase)
	require.False(t, preferences.HasPlugin("broken-settings"))
	require.Empty(t, metrics.GetProviders(), "consumers must not start after settings startup fails")
	require.NotNil(t, provider)
	_, err = provider.GetProviderConnections(&sdkmetric.QueryContext{Context: context.Background()})
	require.ErrorContains(t, err, "stopped", "activation rollback must release the actual native provider")
}
