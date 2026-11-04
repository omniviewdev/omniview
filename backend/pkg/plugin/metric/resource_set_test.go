package metric

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
)

type setFixtureProvider struct {
	Provider
	calls          atomic.Int32
	mu             sync.Mutex
	requests       []sdk.ResourceSetQueryRequest
	started        chan struct{}
	finish         chan struct{}
	denyCatalog    bool
	rejectSelected bool
}

func (p *setFixtureProvider) QueryResources(ctx *sdk.QueryContext, req sdk.ResourceSetQueryRequest) (*sdk.ResourceSetQueryResponse, error) {
	p.calls.Add(1)
	p.mu.Lock()
	p.requests = append(p.requests, copyJSON(req))
	p.mu.Unlock()
	if p.started != nil {
		select {
		case p.started <- struct{}{}:
		default:
		}
	}
	if p.finish != nil {
		<-p.finish
	}
	// Fixture values are independent of request tokens. Same names in different
	// namespaces deliberately differ, detecting structural join mistakes.
	values := map[string]float64{"one/pod": 17, "two/pod": 43}
	out := &sdk.ResourceSetQueryResponse{}
	for _, r := range req.Resources {
		v, ok := values[r.ResourceNamespace+"/"+r.ResourceID]
		for _, id := range req.MetricIDs {
			if ok {
				out.Results = append(out.Results, sdk.ResourceMetricResult{ResourceToken: r.Token, MetricID: id, Status: sdk.MetricStatusOK, Value: &sdk.MetricResult{CurrentValue: &sdk.CurrentValue{MetricID: id, Value: v, Timestamp: time.Now()}}})
			}
		}
	}
	return out, nil
}
func (p *setFixtureProvider) GetMetricDefinitions(*sdk.QueryContext) ([]sdk.MetricDefinition, error) {
	return nil, nil
}
func (p *setFixtureProvider) GetProviderConnections(*sdk.QueryContext) ([]sdk.ProviderConnection, error) {
	return []sdk.ProviderConnection{{ID: "monitoring-a", PluginID: "metrics"}, {ID: "monitoring-b", PluginID: "metrics"}}, nil
}
func (p *setFixtureProvider) SaveProviderConnection(_ *sdk.QueryContext, in sdk.ProviderConnectionInput) (*sdk.ProviderConnection, error) {
	return &in.Connection, nil
}
func (p *setFixtureProvider) DeleteProviderConnection(*sdk.QueryContext, string) error { return nil }
func (p *setFixtureProvider) GetDataSources(_ *sdk.QueryContext, source sdk.MetricSourceReference) ([]sdk.MetricDataSource, error) {
	if p.denyCatalog && source.DatasourceUID == "" {
		return nil, errors.New("datasource list forbidden")
	}
	if p.rejectSelected && source.DatasourceUID != "" {
		return nil, errors.New("selected datasource denied")
	}
	return []sdk.MetricDataSource{{UID: "same-uid", Kind: "prometheus"}}, nil
}
func (p *setFixtureProvider) TestProviderConnection(*sdk.QueryContext, string) (*sdk.MetricValidationResult, error) {
	return &sdk.MetricValidationResult{Valid: true}, nil
}
func (p *setFixtureProvider) ValidateMetricDefinition(*sdk.QueryContext, sdk.MetricSourceReference, sdk.MetricDefinition) (*sdk.MetricValidationResult, error) {
	return &sdk.MetricValidationResult{Valid: true}, nil
}
func setFixtureController(t *testing.T) (*controller, *setFixtureProvider) {
	t.Helper()
	c := NewController(logging.NewNop(), nil, nil).(*controller)
	c.SetMetricStateRoot(appstate.NewTestService(t).RootDir())
	p := &setFixtureProvider{}
	c.clients["metrics"] = p
	scope := invocation.NewScope(invocation.TrustedUI)
	boundary := invocation.NewBoundary(nil)
	c.SetUIReferenceAdmitter(func(ctx context.Context, op, plugin string, route resourcev2.AccessRoute, ref resourcev2.ResourceReference) (context.Context, error) {
		return boundary.Admit(scope.Context(ctx), op, invocation.Target{Provider: plugin, Connection: route.Connection, ResourceType: ref.Address.Type})
	})
	c.SetResourceIdentityGuard(func(ctx context.Context, op, plugin string, route resourcev2.AccessRoute, ref resourcev2.ResourceReference) (func(context.Context) error, error) {
		authorize := func(current context.Context) error {
			_, err := boundary.Admit(scope.Context(current), op, invocation.Target{Provider: plugin, Connection: route.Connection, ResourceType: ref.Address.Type})
			return err
		}
		return authorize, authorize(ctx)
	})
	_, err := c.SaveMetricDefinition(sdk.MetricDefinition{ID: "cpu", Name: "CPU", ResourceKeys: []string{"pods"}, SupportedShapes: []sdk.MetricShape{sdk.ShapeCurrent}, Query: "global-expression", Revision: "ignored"})
	require.NoError(t, err)
	_, err = c.SaveMetricBinding(sdk.MetricBinding{ID: "binding-a", Signal: "metrics", ResourcePluginID: "owner", ResourceConnectionID: "cluster-a", Source: sdk.MetricSourceReference{PluginID: "metrics", ConnectionID: "monitoring-a", DatasourceUID: "same-uid", DatasourceKind: "prometheus"}, Policy: "replace", PublicScope: map[string]string{"cluster": "public-cluster"}})
	require.NoError(t, err)
	return c, p
}
func setResource(token, namespace, name string) sdk.MetricResource {
	return sdk.MetricResource{Token: token, ResourceKey: "pods", ResourceID: "untrusted-alias", ResourceNamespace: "wrong", Reference: &resourcev2.ResourceReference{Address: resourcev2.ResourceAddress{Provider: "owner", Authority: "host-authority", Type: "pods", ID: name, Scope: []resourcev2.ScopeEntry{{Dimension: "namespace", Value: namespace}}}}, Route: &resourcev2.AccessRoute{Connection: "cluster-a"}, PublicData: &resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"secret": {Kind: "string", String: "must-not-cross"}}}}
}
func setRequest(resources ...sdk.MetricResource) sdk.ResourceSetQueryRequest {
	return sdk.ResourceSetQueryRequest{ResourcePluginID: "owner", ResourceConnectionID: "cluster-a", MetricIDs: []string{"cpu"}, Shape: sdk.ShapeCurrent, Resources: resources}
}

func TestResourceSetIdentityGuardDenialPreventsProviderWork(t *testing.T) {
	c, p := setFixtureController(t)
	c.SetResourceIdentityGuard(func(context.Context, string, string, resourcev2.AccessRoute, resourcev2.ResourceReference) (func(context.Context) error, error) {
		return nil, resourcev2.NewError("FORBIDDEN", "Observed identity denied.")
	})
	_, err := c.QueryResources(context.Background(), setRequest(setResource("a", "one", "pod")))
	require.Equal(t, "FORBIDDEN", resourcev2.ErrorCode(err))
	require.Zero(t, p.calls.Load())
	c.SetResourceIdentityGuard(nil)
	_, err = c.QueryResources(context.Background(), setRequest(setResource("a", "one", "pod")))
	require.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(err))
	require.Zero(t, p.calls.Load())
}

func TestResourceSetIdentityGuardInvalidatesCachedDelivery(t *testing.T) {
	c, p := setFixtureController(t)
	var stale atomic.Bool
	c.SetResourceIdentityGuard(func(context.Context, string, string, resourcev2.AccessRoute, resourcev2.ResourceReference) (func(context.Context) error, error) {
		return func(ctx context.Context) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			if stale.Load() {
				return errors.New("observed identity changed")
			}
			return nil
		}, nil
	})
	req := setRequest(setResource("a", "one", "pod"))
	_, err := c.QueryResources(context.Background(), req)
	require.NoError(t, err)
	stale.Store(true)
	_, err = c.QueryResources(context.Background(), req)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	require.Equal(t, int32(1), p.calls.Load())
}

func TestResourceSetIdentityGuardInvalidatesSharedPublication(t *testing.T) {
	c, p := setFixtureController(t)
	p.started = make(chan struct{}, 1)
	p.finish = make(chan struct{})
	var stale atomic.Bool
	c.SetResourceIdentityGuard(func(context.Context, string, string, resourcev2.AccessRoute, resourcev2.ResourceReference) (func(context.Context) error, error) {
		return func(ctx context.Context) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			if stale.Load() {
				return errors.New("observed identity changed")
			}
			return nil
		}, nil
	})
	done := make(chan error, 1)
	go func() {
		_, err := c.QueryResources(context.Background(), setRequest(setResource("a", "one", "pod")))
		done <- err
	}()
	select {
	case <-p.started:
	case <-time.After(time.Second):
		close(p.finish)
		t.Fatal("provider did not start")
	}
	stale.Store(true)
	close(p.finish)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(<-done))
	require.Equal(t, int32(1), p.calls.Load())
}

func TestResourceSetAdmitsOwnerResolvesStoredSourceAndStripsPrivateData(t *testing.T) {
	c, p := setFixtureController(t)
	req := setRequest(setResource("a", "one", "pod"), setResource("b", "two", "pod"), setResource("missing", "three", "absent"))
	req.Source = sdk.MetricSourceReference{PluginID: "attacker", ConnectionID: "secret"}
	req.Definitions = []sdk.MetricDefinition{{ID: "cpu", Query: "attacker-query"}}
	req.PublicScope = map[string]string{"secret": "private"}
	out, err := c.QueryResources(context.Background(), req)
	require.NoError(t, err)
	require.Len(t, out.Results, 3)
	got := map[string]sdk.ResourceMetricResult{}
	for _, r := range out.Results {
		got[r.ResourceToken] = r
		require.Equal(t, "monitoring-a", r.Provenance.Source.ConnectionID)
		require.Equal(t, "binding-a", r.Provenance.BindingID)
	}
	require.Equal(t, 17.0, got["a"].Value.CurrentValue.Value)
	require.Equal(t, 43.0, got["b"].Value.CurrentValue.Value)
	require.Equal(t, sdk.MetricStatusMissing, got["missing"].Status)
	require.Nil(t, got["missing"].Value)
	p.mu.Lock()
	forwarded := p.requests[0]
	p.mu.Unlock()
	require.Equal(t, "metrics", forwarded.Source.PluginID)
	require.Equal(t, "global-expression", forwarded.Definitions[0].Query)
	require.Equal(t, map[string]string{"cluster": "public-cluster"}, forwarded.PublicScope)
	for _, r := range forwarded.Resources {
		require.Nil(t, r.PublicData)
		require.NotEqual(t, "untrusted-alias", r.ResourceID)
	}
	// A matching sidebar uses the same cached structural identity despite its token.
	sidebar := setRequest(setResource("sidebar-token", "one", "pod"))
	again, err := c.QueryResources(context.Background(), sidebar)
	require.NoError(t, err)
	require.Equal(t, int32(1), p.calls.Load())
	require.Equal(t, "sidebar-token", again.Results[0].ResourceToken)
}
func TestResourceSetDeniedResourceNeverReachesProvider(t *testing.T) {
	c, p := setFixtureController(t)
	c.SetUIReferenceAdmitter(func(ctx context.Context, _ string, _ string, _ resourcev2.AccessRoute, _ resourcev2.ResourceReference) (context.Context, error) {
		return ctx, errors.New("source denied")
	})
	_, err := c.QueryResources(context.Background(), setRequest(setResource("denied", "one", "pod")))
	require.ErrorContains(t, err, "source denied")
	require.Zero(t, p.calls.Load())
}
func TestResourceSetRejectsLateConnectionGeneration(t *testing.T) {
	c, p := setFixtureController(t)
	p.started = make(chan struct{}, 1)
	p.finish = make(chan struct{})
	done := make(chan error, 1)
	go func() {
		_, err := c.QueryResources(context.Background(), setRequest(setResource("a", "one", "pod")))
		done <- err
	}()
	select {
	case <-p.started:
	case <-time.After(time.Second):
		t.Fatal("provider did not start")
	}
	release := c.BeginConnectionChange("owner", "cluster-a")
	close(p.finish)
	release()
	select {
	case err := <-done:
		require.Error(t, err)
	case <-time.After(time.Second):
		t.Fatal("late query did not settle")
	}
}
func TestResourceSetBindingScopeInheritanceAndReset(t *testing.T) {
	c, _ := setFixtureController(t)
	bindings, err := c.GetMetricBindings("owner", "cluster-a")
	require.NoError(t, err)
	require.Len(t, bindings, 1)
	require.Error(t, c.DeleteMetricBinding("owner", "cluster-b", bindings[0].ID))
	override := "cluster-expression"
	bindings[0].Overrides = []sdk.MetricDefinitionOverride{{MetricID: "cpu", Query: &override, Revision: "override"}}
	_, err = c.SaveMetricBinding(bindings[0])
	require.NoError(t, err)
	req := setRequest(setResource("a", "one", "pod"))
	_, err = c.resolveMetricRequest(&req, bindings[0].ID)
	require.NoError(t, err)
	require.Equal(t, override, req.Definitions[0].Query)
	_, err = c.SaveMetricDefinition(sdk.MetricDefinition{ID: "cpu", Name: "CPU", ResourceKeys: []string{"pods"}, SupportedShapes: []sdk.MetricShape{sdk.ShapeCurrent}, Query: "new-global"})
	require.NoError(t, err)
	bindings[0].Overrides = nil
	_, err = c.SaveMetricBinding(bindings[0])
	require.NoError(t, err)
	req = setRequest(setResource("a", "one", "pod"))
	_, err = c.resolveMetricRequest(&req, bindings[0].ID)
	require.NoError(t, err)
	require.Equal(t, "new-global", req.Definitions[0].Query)
	other, err := c.GetMetricBindings("owner", "cluster-b")
	require.NoError(t, err)
	require.Empty(t, other)
	require.NoError(t, c.DeleteMetricBinding("owner", "cluster-a", bindings[0].ID))
	req = setRequest(setResource("a", "one", "pod"))
	_, err = c.resolveMetricRequest(&req, "")
	require.NoError(t, err)
	require.Equal(t, "native", req.Source.DatasourceKind)
}
func TestResourceSetSameDatasourceDifferentConnectionsRemainPartitioned(t *testing.T) {
	c, p := setFixtureController(t)
	_, err := c.QueryResources(context.Background(), setRequest(setResource("a", "one", "pod")))
	require.NoError(t, err)
	bindings, err := c.GetMetricBindings("owner", "cluster-a")
	require.NoError(t, err)
	bindings[0].Source.ConnectionID = "monitoring-b"
	_, err = c.SaveMetricBinding(bindings[0])
	require.NoError(t, err)
	out, err := c.QueryResources(context.Background(), setRequest(setResource("a", "one", "pod")))
	require.NoError(t, err)
	require.Equal(t, int32(2), p.calls.Load())
	require.Equal(t, "monitoring-b", out.Results[0].Provenance.Source.ConnectionID)
}
func TestResourceSetBoundedChunksNeverFallsBackToRows(t *testing.T) {
	c, p := setFixtureController(t)
	resources := make([]sdk.MetricResource, 130)
	for i := range resources {
		resources[i] = setResource(fmt.Sprint(i), "one", fmt.Sprintf("pod-%d", i))
	}
	out, err := c.QueryResources(context.Background(), setRequest(resources...))
	require.NoError(t, err)
	require.Len(t, out.Results, 130)
	require.Equal(t, int32(3), p.calls.Load())
}
func TestResourceSetPreviewExecutesDraftWithoutSavingBinding(t *testing.T) {
	c, p := setFixtureController(t)
	req := setRequest(setResource("preview", "two", "pod"))
	req.Source = sdk.MetricSourceReference{PluginID: "metrics", ConnectionID: "monitoring-b", DatasourceUID: "same-uid", DatasourceKind: "prometheus"}
	req.Definitions = []sdk.MetricDefinition{{ID: "cpu", Name: "CPU draft", ResourceKeys: []string{"pods"}, SupportedShapes: []sdk.MetricShape{sdk.ShapeCurrent}, Query: "draft-expression"}}
	out, err := c.PreviewMetricDefinition(context.Background(), req)
	require.NoError(t, err)
	require.Equal(t, 43.0, out.Results[0].Value.CurrentValue.Value)
	require.Equal(t, "monitoring-b", out.Results[0].Provenance.Source.ConnectionID)
	bindings, err := c.GetMetricBindings("owner", "cluster-a")
	require.NoError(t, err)
	require.Equal(t, "monitoring-a", bindings[0].Source.ConnectionID)
	p.mu.Lock()
	defer p.mu.Unlock()
	require.Equal(t, "draft-expression", p.requests[0].Definitions[0].Query)
}
func TestNormalizeResourceResultsRejectsCollisionsAndPreservesMissing(t *testing.T) {
	req := setRequest(sdk.MetricResource{Token: "a"})
	value := sdk.ResourceMetricResult{ResourceToken: "a", MetricID: "cpu", Status: sdk.MetricStatusMissing}
	_, err := normalizeResourceResults(req, &sdk.ResourceSetQueryResponse{Results: []sdk.ResourceMetricResult{value, value}})
	require.ErrorContains(t, err, "duplicate")
	out, err := normalizeResourceResults(req, &sdk.ResourceSetQueryResponse{})
	require.NoError(t, err)
	require.Equal(t, sdk.MetricStatusMissing, out.Results[0].Status)
	require.Nil(t, out.Results[0].Value)
}

func TestNormalizeResourceResultsPreservesOnlyDeclaredDimensionTuples(t *testing.T) {
	req := setRequest(sdk.MetricResource{Token: "a"})
	req.Definitions = []sdk.MetricDefinition{{ID: "cpu", Dimensions: []string{"container"}}}
	value := func(container string) sdk.ResourceMetricResult {
		return sdk.ResourceMetricResult{ResourceToken: "a", MetricID: "cpu", Status: sdk.MetricStatusOK, Dimensions: map[string]string{"container": container}, Value: &sdk.MetricResult{CurrentValue: &sdk.CurrentValue{MetricID: "cpu", Value: 1, Timestamp: time.Now()}}}
	}
	out, err := normalizeResourceResults(req, &sdk.ResourceSetQueryResponse{Results: []sdk.ResourceMetricResult{value("one"), value("two")}})
	require.NoError(t, err)
	require.Len(t, out.Results, 2)
	invalid := value("one")
	invalid.Dimensions["undeclared"] = "private"
	_, err = normalizeResourceResults(req, &sdk.ResourceSetQueryResponse{Results: []sdk.ResourceMetricResult{invalid}})
	require.ErrorContains(t, err, "undeclared")
}
func TestNormalizeResourceResultsRejectsFutureAndOutOfRangeSamples(t *testing.T) {
	now := time.Now()
	req := setRequest(sdk.MetricResource{Token: "a"})
	future := sdk.ResourceMetricResult{ResourceToken: "a", MetricID: "cpu", Status: sdk.MetricStatusOK, Value: &sdk.MetricResult{CurrentValue: &sdk.CurrentValue{MetricID: "cpu", Value: 1, Timestamp: now.Add(time.Hour)}}}
	_, err := normalizeResourceResults(req, &sdk.ResourceSetQueryResponse{Results: []sdk.ResourceMetricResult{future}})
	require.Error(t, err)
	req.Shape = sdk.ShapeTimeseries
	req.StartTime = now.Add(-time.Hour)
	req.EndTime = now.Add(-time.Minute)
	series := sdk.ResourceMetricResult{ResourceToken: "a", MetricID: "cpu", Status: sdk.MetricStatusOK, Value: &sdk.MetricResult{TimeSeries: &sdk.TimeSeries{MetricID: "cpu", DataPoints: []sdk.DataPoint{{Timestamp: now, Value: 1}}}}}
	_, err = normalizeResourceResults(req, &sdk.ResourceSetQueryResponse{Results: []sdk.ResourceMetricResult{series}})
	require.ErrorContains(t, err, "out-of-range")
}

func TestSelectedDatasourceDoesNotRequireCatalogListPrivilege(t *testing.T) {
	c, p := setFixtureController(t)
	p.denyCatalog = true
	_, err := c.GetDataSources("metrics", "monitoring-a")
	require.ErrorContains(t, err, "list forbidden")
	bindings, err := c.GetMetricBindings("owner", "cluster-a")
	require.NoError(t, err)
	_, err = c.SaveMetricBinding(bindings[0])
	require.NoError(t, err, "an exact query-capable datasource must not require catalog-list privilege")
	invalid := bindings[0]
	invalid.Source.DatasourceKind = "unsupported"
	_, err = c.SaveMetricBinding(invalid)
	require.ErrorContains(t, err, "incompatible kind")
	p.rejectSelected = true
	_, err = c.SaveMetricBinding(bindings[0])
	require.ErrorContains(t, err, "selected datasource denied")
}

func TestResourceSetMixedCacheDispatchesOnlyMissingResources(t *testing.T) {
	c, provider := setFixtureController(t)
	warm := make([]sdk.MetricResource, 64)
	combined := make([]sdk.MetricResource, 0, 128)
	expectedMissing := make(map[string]bool, 64)
	for i := range 128 {
		name := fmt.Sprintf("pod-%03d", i)
		resource := setResource(fmt.Sprintf("combined-%d", i), "one", name)
		if i < 64 {
			warm[i] = setResource(fmt.Sprintf("warm-%d", i), "one", name)
		} else {
			expectedMissing[name] = true
		}
		combined = append(combined, resource)
	}
	warmed, err := c.QueryResources(context.Background(), setRequest(warm...))
	require.NoError(t, err)
	require.Len(t, warmed.Results, 64)
	require.Equal(t, int32(1), provider.calls.Load())
	result, err := c.QueryResources(context.Background(), setRequest(combined...))
	require.NoError(t, err)
	require.Len(t, result.Results, 128)
	require.Equal(t, int32(2), provider.calls.Load(), "64 warm plus 64 new resources must dispatch only one new chunk")
	provider.mu.Lock()
	defer provider.mu.Unlock()
	require.Len(t, provider.requests, 2)
	require.Len(t, provider.requests[1].Resources, 64)
	for _, resource := range provider.requests[1].Resources {
		require.True(t, expectedMissing[resource.ResourceID], "fresh cached resource was dispatched again: %s", resource.ResourceID)
		delete(expectedMissing, resource.ResourceID)
	}
	require.Empty(t, expectedMissing)
	tokens := make(map[string]bool, 128)
	for _, metric := range result.Results {
		require.False(t, tokens[metric.ResourceToken], "merged result duplicated a resource")
		tokens[metric.ResourceToken] = true
		require.Equal(t, "monitoring-a", metric.Provenance.Source.ConnectionID)
	}
	for _, resource := range combined {
		require.True(t, tokens[resource.Token], "merged result lost a cached or new resource")
	}
}
