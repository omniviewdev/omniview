package metric_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
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
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
)

type supplementConnectionReader struct{ connection sdktypes.Connection }

func (r supplementConnectionReader) GetConnection(_ context.Context, owner, connection string) (sdktypes.Connection, error) {
	if owner != "kubernetes" || connection != r.connection.ID {
		return sdktypes.Connection{}, errors.New("native connection not selected")
	}
	return r.connection, nil
}

type nativeSupplementFixture struct {
	calls    atomic.Int32
	queryErr error
}

func (*nativeSupplementFixture) GetSupportedResources(*sdktypes.PluginContext) (*sdk.ProviderInfo, []sdk.Handler) {
	return &sdk.ProviderInfo{ID: "native-fixture", Name: "Native node and pod observations"}, []sdk.Handler{
		{Resource: "k8s:/nodes", Metrics: []sdk.MetricDescriptor{{ID: "cpu_usage", Unit: sdk.UnitMillicores}, {ID: "cpu_capacity", Unit: sdk.UnitMillicores}, {ID: "memory_usage", Unit: sdk.UnitBytes}, {ID: "memory_capacity", Unit: sdk.UnitBytes}}},
		{Resource: "k8s:/pods", Metrics: []sdk.MetricDescriptor{{ID: "cpu_usage", Unit: sdk.UnitMillicores}, {ID: "memory_usage", Unit: sdk.UnitBytes}}},
	}
}
func (*nativeSupplementFixture) Query(*sdktypes.PluginContext, sdk.QueryRequest) (*sdk.QueryResponse, error) {
	return nil, resourcev2.NewError("UNSUPPORTED", "Fixture observations use finite queries.")
}
func (*nativeSupplementFixture) StreamMetrics(context.Context, chan sdk.StreamInput) (chan sdk.StreamOutput, error) {
	return nil, resourcev2.NewError("UNSUPPORTED", "Fixture observations use finite queries.")
}
func (p *nativeSupplementFixture) QueryResources(ctx *sdk.QueryContext, req sdk.ResourceSetQueryRequest) (*sdk.ResourceSetQueryResponse, error) {
	if ctx.Connection == nil || ctx.Connection.ID != "cluster-source" || req.Source.ConnectionID != ctx.Connection.ID {
		return nil, errors.New("native query did not lease its resource-owner connection")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	p.calls.Add(1)
	if p.queryErr != nil {
		return nil, p.queryErr
	}
	observations := map[string]map[string]float64{
		"k8s:/nodes/node-one": {"cpu_usage": 550, "cpu_capacity": 8000, "memory_usage": 134217728, "memory_capacity": 17179869184},
		"k8s:/pods/pod-one":   {"cpu_usage": 125, "memory_usage": 33554432},
	}
	out := &sdk.ResourceSetQueryResponse{}
	for _, resource := range req.Resources {
		if resource.Reference == nil || resource.Reference.Address.Provider != "kubernetes" || resource.Reference.Address.ID != resource.ResourceID {
			return nil, errors.New("native query lost canonical owner identity")
		}
		values, known := observations[resource.ResourceKey+"/"+resource.ResourceID]
		if !known {
			return nil, errors.New("native fixture resource is unknown")
		}
		for _, id := range req.MetricIDs {
			result := sdk.ResourceMetricResult{ResourceToken: resource.Token, MetricID: id, Status: sdk.MetricStatusUnsupported}
			if value, ok := values[id]; ok {
				result.Status = sdk.MetricStatusOK
				result.Value = &sdk.MetricResult{CurrentValue: &sdk.CurrentValue{MetricID: id, Value: value, Timestamp: time.Now()}}
			}
			out.Results = append(out.Results, result)
		}
	}
	return out, nil
}

func TestServiceWrapperSupplementPreservesNativeNodeMetricsOutsideGrafanaApplicability(t *testing.T) {
	var expressions atomic.Int32
	var deny atomic.Bool
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		expressions.Add(1)
		if deny.Load() {
			http.Error(w, "datasource denied", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "success", "data": map[string]any{"resultType": "vector", "result": []any{
			map[string]any{"metric": map[string]string{"cluster": "fixture-cluster", "namespace": "ns", "pod": "pod-one"}, "value": []any{time.Now().Unix(), "42"}},
		}}})
	}))
	defer endpoint.Close()
	roots := appstate.NewTestService(t)
	controller := hostmetric.NewController(logging.NewNop(), nil, supplementConnectionReader{connection: sdktypes.Connection{ID: "cluster-source"}})
	controller.SetMetricStateRoot(roots.RootDir())
	native := &nativeSupplementFixture{}
	nativeBackend, err := plugintypes.ComposeNativeBackend(plugintypes.NativeProviders{Metric: native})
	require.NoError(t, err)
	require.NoError(t, controller.OnPluginStart("kubernetes", config.PluginMeta{}, nativeBackend))
	private := t.TempDir()
	provider := grafana.NewProvider(func() (*os.Root, error) { return os.OpenRoot(private) })
	t.Cleanup(func() { _ = provider.Close() })
	backend, err := plugintypes.ComposeNativeBackend(plugintypes.NativeProviders{Metric: provider})
	require.NoError(t, err)
	require.NoError(t, controller.OnPluginStart("grafana", config.PluginMeta{}, backend))
	scope := invocation.NewScope(invocation.TrustedUI)
	boundary := invocation.NewBoundary(nil)
	controller.SetUIReferenceAdmitter(func(ctx context.Context, op, owner string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) (context.Context, error) {
		return boundary.Admit(scope.Context(ctx), op, invocation.Target{Provider: owner, Connection: route.Connection, ResourceType: reference.Address.Type})
	})
	controller.SetResourceIdentityGuard(func(ctx context.Context, op, owner string, route resourcev2.AccessRoute, reference resourcev2.ResourceReference) (func(context.Context) error, error) {
		authorize := func(current context.Context) error {
			_, err := boundary.Admit(scope.Context(current), op, invocation.Target{Provider: owner, Connection: route.Connection, ResourceType: reference.Address.Type})
			return err
		}
		return authorize, authorize(ctx)
	})
	service := &hostmetric.ServiceWrapper{Ctrl: controller}
	connection := sdk.ProviderConnectionInput{Connection: sdk.ProviderConnection{ID: "monitoring", Name: "Supplemental Grafana", Kind: "prometheus", URL: endpoint.URL, PublicConfig: map[string]string{"credentialKind": "prometheus-token", "allowInsecureHTTP": "true"}}}
	encoded, err := json.Marshal(connection)
	require.NoError(t, err)
	_, err = service.SaveProviderConnection("grafana", string(encoded))
	require.NoError(t, err)
	binding := sdk.MetricBinding{ID: "supplement", Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster-source", Source: sdk.MetricSourceReference{PluginID: "grafana", ConnectionID: "monitoring", DatasourceUID: "direct", DatasourceKind: "prometheus"}, Policy: "supplement", PublicScope: map[string]string{"cluster": "fixture-cluster"}}
	encoded, err = json.Marshal(binding)
	require.NoError(t, err)
	_, err = service.SaveMetricBinding(string(encoded))
	require.NoError(t, err)
	node := sdk.MetricResource{Token: "node", ResourceKey: "k8s:/nodes", Reference: &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "fixture-authority", Type: "k8s:/nodes", ID: "node-one", Scope: []resourcev2.ScopeEntry{}}}, Route: &resourcev2.AccessRoute{Connection: "cluster-source"}}
	request := sdk.ResourceSetQueryRequest{ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster-source", Resources: []sdk.MetricResource{node}, MetricIDs: []string{"cpu_usage", "cpu_capacity", "memory_usage", "memory_capacity"}, Shape: sdk.ShapeCurrent}
	encoded, err = json.Marshal(request)
	require.NoError(t, err)
	result, err := service.QueryResources(context.Background(), string(encoded))
	require.NoError(t, err)
	require.Len(t, result.Results, 4)
	require.Equal(t, int32(1), native.calls.Load())
	require.Zero(t, expressions.Load(), "pod-only shipped Grafana mappings must not be validated or queried for a Node")
	expected := map[string]float64{"cpu_usage": 550, "cpu_capacity": 8000, "memory_usage": 134217728, "memory_capacity": 17179869184}
	for _, metric := range result.Results {
		require.Equal(t, sdk.MetricStatusOK, metric.Status)
		require.True(t, metric.Provenance.Native)
		require.Equal(t, "cluster-source", metric.Provenance.Source.ConnectionID)
		require.Equal(t, expected[metric.MetricID], metric.Value.CurrentValue.Value)
		delete(expected, metric.MetricID)
	}
	require.Empty(t, expected)
	// A mixed request supplements only the applicable pod; native Node values
	// remain present and no Node can be attributed to a pod exporter series.
	pod := sdk.MetricResource{Token: "pod", ResourceKey: "k8s:/pods", Reference: &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "kubernetes", Authority: "fixture-authority", Type: "k8s:/pods", ID: "pod-one", Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: "ns"}}}}, Route: &resourcev2.AccessRoute{Connection: "cluster-source"}}
	request.Resources = []sdk.MetricResource{node, pod}
	request.MetricIDs = []string{"cpu_usage", "memory_usage"}
	encoded, err = json.Marshal(request)
	require.NoError(t, err)
	mixed, err := service.QueryResources(context.Background(), string(encoded))
	require.NoError(t, err)
	require.Len(t, mixed.Results, 6)
	require.Equal(t, int32(2), expressions.Load())
	for _, metric := range mixed.Results {
		if !metric.Provenance.Native {
			require.Equal(t, "pod", metric.ResourceToken)
			require.Equal(t, 42.0, metric.Value.CurrentValue.Value)
		}
	}
	// Applicable external denial must remain visible alongside native data. It
	// cannot be converted into native success or trigger a silent provider fallback.
	deny.Store(true)
	request.Resources = []sdk.MetricResource{pod}
	request.MetricIDs = []string{"cpu_usage"}
	encoded, err = json.Marshal(request)
	require.NoError(t, err)
	denied, err := service.QueryResources(context.Background(), string(encoded))
	require.NoError(t, err)
	require.Len(t, denied.Results, 2)
	for _, metric := range denied.Results {
		if metric.Provenance.Native {
			require.Equal(t, sdk.MetricStatusOK, metric.Status)
		} else {
			require.Equal(t, sdk.MetricStatusDenied, metric.Status)
			require.Nil(t, metric.Value)
		}
	}
	require.Equal(t, int32(3), expressions.Load())
	// Missing finite native capability produces explicit statuses, not a veto
	// over the applicable external lane.
	deny.Store(false)
	native.queryErr = resourcev2.NewError("UNSUPPORTED", "Finite resource metric queries are unavailable.")
	request.MetricIDs = []string{"cpu_usage", "cpu_capacity"}
	encoded, err = json.Marshal(request)
	require.NoError(t, err)
	unsupported, err := service.QueryResources(context.Background(), string(encoded))
	require.NoError(t, err)
	require.Len(t, unsupported.Results, 3)
	for _, metric := range unsupported.Results {
		if metric.Provenance.Native {
			require.Equal(t, sdk.MetricStatusUnsupported, metric.Status)
			require.Equal(t, "pod", metric.ResourceToken)
			require.Contains(t, request.MetricIDs, metric.MetricID)
			require.Nil(t, metric.Value)
		} else {
			require.Equal(t, sdk.MetricStatusOK, metric.Status)
			require.Equal(t, 42.0, metric.Value.CurrentValue.Value)
		}
	}
	for index, failure := range []error{resourcev2.NewError("FORBIDDEN", "Native denied."), errors.New("UNSUPPORTED: arbitrary provider failure")} {
		native.queryErr = failure
		request.MetricIDs = [][]string{{"cpu_usage", "memory_capacity"}, {"cpu_usage", "memory_usage", "cpu_capacity"}}[index]
		encoded, err = json.Marshal(request)
		require.NoError(t, err)
		before := expressions.Load()
		_, err = service.QueryResources(context.Background(), string(encoded))
		require.Error(t, err)
		require.Equal(t, before, expressions.Load(), "native denial and arbitrary errors must not be swallowed")
	}
	native.queryErr = nil
	// Source denial still prevents both lanes from executing.
	beforeNative := native.calls.Load()
	beforeExternal := expressions.Load()
	controller.SetUIReferenceAdmitter(func(ctx context.Context, _ string, _ string, _ resourcev2.AccessRoute, _ resourcev2.ResourceReference) (context.Context, error) {
		return ctx, resourcev2.NewError("FORBIDDEN", "Source denied.")
	})
	_, err = service.QueryResources(context.Background(), string(encoded))
	require.Error(t, err)
	require.Equal(t, beforeNative, native.calls.Load())
	require.Equal(t, beforeExternal, expressions.Load())
}
