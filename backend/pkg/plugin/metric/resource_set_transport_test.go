package metric_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	hostmetric "github.com/omniviewdev/omniview/backend/pkg/plugin/metric"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/builtinplugins/grafana"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
)

// This is an actual HTTP transport smoke: the public host wrapper resolves a
// persisted binding and invokes the shipped provider against a served fixture.
// It intentionally does not substitute a frontend mock or an echo provider.
func TestResourceSetServedPrometheusRequestCounterSmoke(t *testing.T) {
	var expressions atomic.Int32
	var deny atomic.Bool
	var mu sync.Mutex
	queries := []string{}
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/query" {
			http.NotFound(w, r)
			return
		}
		expressions.Add(1)
		mu.Lock()
		queries = append(queries, r.URL.Query().Get("query"))
		mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer backend-only-fixture-secret" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if deny.Load() {
			http.Error(w, "denied", http.StatusForbidden)
			return
		}
		result := []any{}
		for _, cluster := range []string{"cluster-a", "cluster-b"} {
			for i := range 24 {
				namespace := "one"
				if i%2 == 1 {
					namespace = "two"
				}
				value := i + 1
				if cluster == "cluster-b" {
					value += 1000
				}
				result = append(result, map[string]any{"metric": map[string]string{"cluster": cluster, "namespace": namespace, "pod": fmt.Sprintf("pod-%02d", i/2)}, "value": []any{time.Now().Unix(), fmt.Sprint(value)}})
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": map[string]any{"resultType": "vector", "result": result}})
	}))
	defer endpoint.Close()
	private := t.TempDir()
	provider := grafana.NewProvider(func() (*os.Root, error) { return os.OpenRoot(private) })
	t.Cleanup(func() { _ = provider.Close() })
	backend, err := plugintypes.ComposeNativeBackend(plugintypes.NativeProviders{Metric: provider})
	require.NoError(t, err)
	ctrl := hostmetric.NewController(logging.NewNop(), nil, nil)
	ctrl.SetMetricStateRoot(appstate.NewTestService(t).RootDir())
	require.NoError(t, ctrl.OnPluginStart("grafana", config.PluginMeta{}, backend))
	scope := invocation.NewScope(invocation.TrustedUI)
	boundary := invocation.NewBoundary(nil)
	admit := func(ctx context.Context, op, plugin string, route resourcev2.AccessRoute, ref resourcev2.ResourceReference) (context.Context, error) {
		return boundary.Admit(scope.Context(ctx), op, invocation.Target{Provider: plugin, Connection: route.Connection, ResourceType: ref.Address.Type})
	}
	ctrl.SetUIReferenceAdmitter(admit)
	service := &hostmetric.ServiceWrapper{Ctrl: ctrl}
	secret := "backend-only-fixture-secret"
	input := sdk.ProviderConnectionInput{Connection: sdk.ProviderConnection{ID: "monitoring", Name: "Served fixture", PluginID: "grafana", Kind: "prometheus", URL: endpoint.URL, PublicConfig: map[string]string{"credentialKind": "prometheus-token", "allowInsecureHTTP": "true"}}, Credential: &secret}
	encoded, _ := json.Marshal(input)
	public, err := service.SaveProviderConnection("grafana", string(encoded))
	require.NoError(t, err)
	require.True(t, public.HasCredentials)
	publicJSON, _ := json.Marshal(public)
	require.NotContains(t, string(publicJSON), secret)
	binding := sdk.MetricBinding{ID: "cluster-binding", Signal: "metrics", ResourcePluginID: "owner", ResourceConnectionID: "cluster-source", Source: sdk.MetricSourceReference{PluginID: "grafana", ConnectionID: "monitoring", DatasourceUID: "direct", DatasourceKind: "prometheus"}, Policy: "replace", PublicScope: map[string]string{"cluster": "cluster-a"}}
	encoded, _ = json.Marshal(binding)
	_, err = service.SaveMetricBinding(string(encoded))
	require.NoError(t, err)
	req := sdk.ResourceSetQueryRequest{ResourcePluginID: "owner", ResourceConnectionID: "cluster-source", MetricIDs: []string{"cpu_usage", "memory_usage"}, Shape: sdk.ShapeCurrent}
	for i := range 24 {
		namespace := "one"
		if i%2 == 1 {
			namespace = "two"
		}
		name := fmt.Sprintf("pod-%02d", i/2)
		req.Resources = append(req.Resources, sdk.MetricResource{Token: fmt.Sprint(i), ResourceKey: "k8s:/pods", Reference: &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "owner", Authority: "fixture-authority", Type: "k8s:/pods", ID: name, Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: namespace}}}}, Route: &resourcev2.AccessRoute{Connection: "cluster-source"}})
	}
	encoded, _ = json.Marshal(req)
	out, err := service.QueryResources(context.Background(), string(encoded))
	require.NoError(t, err)
	require.Len(t, out.Results, 48)
	require.Equal(t, int32(2), expressions.Load(), "24 pods CPU + memory must issue two grouped expressions")
	for _, r := range out.Results {
		require.Equal(t, sdk.MetricStatusOK, r.Status)
		require.NotNil(t, r.Value)
		require.Equal(t, "monitoring", r.Provenance.Source.ConnectionID)
		require.Less(t, r.Value.CurrentValue.Value, 1000.0, "other cluster series must not cross-attribute")
	}
	sidebar := req
	sidebar.Resources = append([]sdk.MetricResource(nil), req.Resources[:1]...)
	sidebar.Resources[0].Token = "sidebar"
	encoded, _ = json.Marshal(sidebar)
	again, err := service.QueryResources(context.Background(), string(encoded))
	require.NoError(t, err)
	require.Len(t, again.Results, 2)
	require.Equal(t, int32(2), expressions.Load(), "matching sidebar must not issue another expression")
	require.Equal(t, "sidebar", again.Results[0].ResourceToken)
	mu.Lock()
	require.Len(t, queries, 2)
	require.True(t, strings.Contains(queries[0], "pod-00"))
	require.True(t, strings.Contains(queries[0], "namespace"))
	mu.Unlock()
	// A denied source never reaches the configured provider, even with warm cache.
	ctrl.SetUIReferenceAdmitter(func(ctx context.Context, _ string, _ string, _ resourcev2.AccessRoute, _ resourcev2.ResourceReference) (context.Context, error) {
		return ctx, fmt.Errorf("source access denied")
	})
	_, err = service.QueryResources(context.Background(), string(encoded))
	require.ErrorContains(t, err, "source access denied")
	require.Equal(t, int32(2), expressions.Load())
	// Provider denial remains a denied value-less result, never native fallback.
	ctrl.SetUIReferenceAdmitter(admit)
	deny.Store(true)
	req.MetricIDs = []string{"cpu_usage"}
	encoded, _ = json.Marshal(req)
	denied, err := service.QueryResources(context.Background(), string(encoded))
	require.NoError(t, err)
	require.Equal(t, int32(3), expressions.Load())
	for _, r := range denied.Results {
		require.Equal(t, sdk.MetricStatusDenied, r.Status)
		require.Nil(t, r.Value)
	}
}
