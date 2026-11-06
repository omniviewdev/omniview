package metric

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
)

type finitePrivateProvider struct {
	*finiteTestProvider
	contextCheck func(*types.PluginContext, sdk.ResourceMetricsQuery)
}

func (p *finitePrivateProvider) QueryResources(pc *types.PluginContext, q sdk.ResourceMetricsQuery) (*sdk.ResourceMetricsResponse, error) {
	if p.contextCheck != nil {
		p.contextCheck(pc, q)
	}
	return p.finiteTestProvider.QueryResources(pc, q)
}
func (*finitePrivateProvider) GetProviderConnections(*types.PluginContext) ([]sdk.ProviderConnection, error) {
	return []sdk.ProviderConnection{{ID: "one", PluginID: "external"}, {ID: "two", PluginID: "external"}}, nil
}
func (*finitePrivateProvider) SaveProviderConnection(_ *types.PluginContext, input sdk.ProviderConnectionInput) (*sdk.ProviderConnection, error) {
	return &input.Connection, nil
}
func (*finitePrivateProvider) DeleteProviderConnection(*types.PluginContext, string) error {
	return nil
}
func (*finitePrivateProvider) GetDataSources(_ *types.PluginContext, source sdk.MetricSourceRef) ([]sdk.MetricDataSource, error) {
	if source.ConnectionID != "one" && source.ConnectionID != "two" {
		return nil, errors.New("unknown private connection")
	}
	return []sdk.MetricDataSource{{UID: "db", Name: "Database", Kind: "prometheus"}}, nil
}
func (*finitePrivateProvider) TestProviderConnection(*types.PluginContext, string) (*sdk.MetricValidationResult, error) {
	return &sdk.MetricValidationResult{Valid: true}, nil
}
func (*finitePrivateProvider) ValidateMetricDefinition(_ *types.PluginContext, source sdk.MetricSourceRef, _ sdk.MetricDefinition) (*sdk.MetricValidationResult, error) {
	return &sdk.MetricValidationResult{Valid: source.DatasourceKind == "prometheus"}, nil
}
func (*finitePrivateProvider) GetMetricDefinitions(*types.PluginContext) ([]sdk.MetricDefinition, error) {
	return []sdk.MetricDefinition{
		{ID: "cpu", Name: "CPU", ResourceKeys: []string{"core::v1::Pod"}, Unit: "cores", SupportedShapes: []string{"current", "range"}, Query: "cpu-default"},
		{ID: "memory", Name: "Memory", ResourceKeys: []string{"core::v1::Pod"}, Unit: "bytes", SupportedShapes: []string{"current", "range"}, Query: "memory-default"},
	}, nil
}
func finitePrivateSource(connection string) sdk.MetricSourceRef {
	return sdk.MetricSourceRef{PluginID: "external", ConnectionID: connection, DatasourceUID: "db", DatasourceKind: "prometheus"}
}
func addFinitePrivateProvider(t *testing.T, c *controller) *finitePrivateProvider {
	t.Helper()
	p := &finitePrivateProvider{finiteTestProvider: &finiteTestProvider{calls: make(chan sdk.ResourceMetricsQuery, 32), release: make(chan struct{}), cancelled: make(chan struct{}, 32), shapes: []string{"current", "range"}}}
	c.clients["external"] = p
	c.SetMetricStateRoot(appstate.NewTestService(t).RootDir())
	return p
}
func finiteCatalogSelection(spec MetricsObservationSpec) ResourceMetricsCatalogRequest {
	return ResourceMetricsCatalogRequest{OwnerPluginID: spec.OwnerPluginID, OwnerConnectionID: spec.OwnerConnectionID, ResourceKey: spec.ResourceKey, BindingID: spec.BindingID, Source: spec.Source}
}

func TestMetricConfigurationPersistsSparseOverridesAndResets(t *testing.T) {
	c, _, _ := finiteTestController(t)
	addFinitePrivateProvider(t, c)
	one, two := finitePrivateSource("one"), finitePrivateSource("two")
	defaults, err := c.SaveMetricSourceDefaults(sdk.MetricSourceDefaults{Source: &one})
	require.NoError(t, err)
	require.NotEmpty(t, defaults.Revision)
	query := "owner-cpu"
	binding, err := c.SaveMetricBinding(sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster", PublicScope: map[string]string{"cluster": "prod"}, Overrides: []sdk.MetricDefinitionOverride{{MetricID: "cpu", Query: &query}, {MetricID: "memory", Source: &two}}})
	require.NoError(t, err)
	request := finiteCatalogSelection(finiteTestSpec("row", "pod-a", "cpu", "memory"))
	lanes, err := c.resolveFiniteSources(request, []string{"cpu", "memory"}, nil)
	require.NoError(t, err)
	require.Len(t, lanes, 2)
	require.Equal(t, one, lanes[0].source)
	require.Equal(t, []string{"cpu"}, lanes[0].metrics)
	require.Equal(t, "owner-cpu", lanes[0].context.Definitions[0].Query)
	require.Equal(t, map[string]string{"cluster": "prod"}, lanes[0].context.PublicScope)
	oldRevision := lanes[0].context.MappingRevision
	binding.Overrides = nil
	saved, err := c.SaveMetricBinding(*binding)
	require.NoError(t, err)
	lanes, err = c.resolveFiniteSources(request, []string{"cpu", "memory"}, nil)
	require.NoError(t, err)
	require.Len(t, lanes, 1)
	require.Equal(t, "cpu-default", lanes[0].context.Definitions[0].Query)
	require.NotEqual(t, oldRevision, lanes[0].context.MappingRevision)
	_, err = c.SaveMetricBinding(*binding)
	require.Error(t, err, "stale binding revision must not overwrite reset")
	defaults, err = c.SaveMetricSourceDefaults(sdk.MetricSourceDefaults{Revision: defaults.Revision})
	require.NoError(t, err)
	require.Nil(t, defaults.Source)
	require.NoError(t, c.DeleteMetricBinding("kubernetes", "cluster", saved.ID))
	lanes, err = c.resolveFiniteSources(request, []string{"cpu"}, nil)
	require.NoError(t, err)
	require.Equal(t, "metrics-server", lanes[0].source.DatasourceKind)
	root := c.state().root
	c.SetMetricStateRoot(root)
	loaded, err := c.GetMetricSourceDefaults()
	require.NoError(t, err)
	require.Equal(t, defaults, loaded)
	bindings, err := c.GetMetricBindings("kubernetes", "cluster")
	require.NoError(t, err)
	require.Empty(t, bindings)
	require.NoError(t, c.DeleteMetricDefinition("cpu"))
	definitions, err := c.GetMetricDefinitions()
	require.NoError(t, err)
	for _, definition := range definitions {
		if definition.ID == "cpu" {
			require.Equal(t, "cpu-default", definition.Query)
		}
	}
}

func TestFiniteSelectedSourceDispatchesWithoutOwnerConnectionCredentials(t *testing.T) {
	c, owner, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	close(external.release)
	external.contextCheck = func(pc *types.PluginContext, q sdk.ResourceMetricsQuery) {
		require.NotNil(t, pc.Connection)
		require.Equal(t, "one", pc.Connection.ID)
		require.Equal(t, "kubernetes", q.Targets[0].Reference.Address.Provider)
		require.Equal(t, "cluster", q.Targets[0].Route.Connection)
		require.Empty(t, q.Targets[0].PublicData, "caller data must never become an owner observation")
	}
	source := finitePrivateSource("one")
	spec := finiteTestSpec("row", "pod-a", "cpu")
	spec.Source = &source
	spec.Targets[0].PublicData = map[string]string{"credential": "caller-forgery"}
	result := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.NoError(t, result.err)
	require.Equal(t, int32(0), owner.queries.Load())
	require.Equal(t, int32(1), external.queries.Load())
	require.Equal(t, &source, result.data.Results[0].Source)
	missing := source
	missing.PluginID = "missing"
	spec.Source = &missing
	result = finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.Error(t, result.err)
	require.Equal(t, int32(0), owner.queries.Load(), "explicit failures must never fall back to native")
}

func TestFiniteMixedSourceLanesPreserveRangeAndProvenance(t *testing.T) {
	c, _, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	close(external.release)
	one, two := finitePrivateSource("one"), finitePrivateSource("two")
	_, err := c.SaveMetricSourceDefaults(sdk.MetricSourceDefaults{Source: &one})
	require.NoError(t, err)
	_, err = c.SaveMetricBinding(sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster", Overrides: []sdk.MetricDefinitionOverride{{MetricID: "memory", Source: &two}}})
	require.NoError(t, err)
	external.response = func(q sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
		out := &sdk.ResourceMetricsResponse{Complete: true}
		value := 1.0
		for _, target := range q.Targets {
			for _, id := range q.MetricIDs {
				out.Results = append(out.Results, sdk.ResourceMetricResult{ResourceToken: target.Token, MetricID: id, Status: "ok", Points: []sdk.ResourceMetricPoint{{Time: q.StartTime, Value: &value}}, IdentityScope: "name"})
			}
		}
		return out
	}
	spec := finiteTestSpec("row", "pod-a", "cpu", "memory")
	spec.Shape = "range"
	spec.StartTime = time.Now().UTC().Add(-time.Minute)
	spec.EndTime = spec.StartTime.Add(time.Minute)
	spec.StepMs = 15000
	catalog, err := c.GetResourceMetricsCatalog(ctx, finiteCatalogSelection(spec))
	require.NoError(t, err)
	require.Len(t, catalog.Metrics, 2)
	sources := map[string]sdk.MetricSourceRef{}
	for _, descriptor := range catalog.Metrics {
		require.NotNil(t, descriptor.Source)
		sources[descriptor.ID] = *descriptor.Source
	}
	require.Equal(t, one, sources["cpu"])
	require.Equal(t, two, sources["memory"])
	result := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.NoError(t, result.err)
	require.Len(t, result.data.Results, 2)
	for _, sample := range result.data.Results {
		require.Equal(t, sources[sample.MetricID], *sample.Source)
		require.Equal(t, "row", sample.ResourceToken)
		require.Equal(t, spec.StartTime, sample.Points[0].Time)
	}
	override := spec
	override.Source = &two
	catalog, err = c.GetResourceMetricsCatalog(ctx, finiteCatalogSelection(override))
	require.NoError(t, err)
	for _, descriptor := range catalog.Metrics {
		require.Equal(t, &two, descriptor.Source)
	}
}

func TestFiniteSourceRetirementAndMappingSaveCancelPrivateWork(t *testing.T) {
	for _, change := range []string{"source", "mapping"} {
		t.Run(change, func(t *testing.T) {
			c, _, ctx := finiteTestController(t)
			external := addFinitePrivateProvider(t, c)
			source := finitePrivateSource("one")
			spec := finiteTestSpec("row", "pod-a", "cpu")
			spec.Source = &source
			result := finiteTestRead(c, ctx, spec)
			finiteTestReceive(t, external.calls)
			if change == "source" {
				release := c.BeginConnectionChange("external", "one")
				defer release()
			} else {
				definitions, err := external.GetMetricDefinitions(nil)
				require.NoError(t, err)
				definitions[0].Query = "changed"
				_, err = c.SaveMetricDefinition(definitions[0])
				require.NoError(t, err)
			}
			require.Error(t, finiteTestReceive(t, result).err)
			finiteTestReceive(t, external.cancelled)
		})
	}
}

func TestFiniteCachedProjectionStillChecksOriginalOwner(t *testing.T) {
	var deliveryChecks atomic.Int32
	c, _, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	close(external.release)
	var revoked atomic.Bool
	c.SetResourceIdentityGuard(func(context.Context, string, string, resourcev2.AccessRoute, resourcev2.ResourceReference) (func(context.Context) error, error) {
		return func(context.Context) error {
			if revoked.Load() && deliveryChecks.Add(1) >= 2 {
				return errors.New("owner observation retired before cache delivery")
			}
			return nil
		}, nil
	})
	source := finitePrivateSource("one")
	spec := finiteTestSpec("first", "pod-a", "cpu")
	spec.Source = &source
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	revoked.Store(true)
	spec.Targets[0].Token = "second"
	result := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.Error(t, result.err)
	require.Nil(t, result.data)
	require.Equal(t, int32(1), external.queries.Load())
}

func TestMetricConfigurationRejectsUnapprovedScopeAndAnonymousServices(t *testing.T) {
	c, _, _ := finiteTestController(t)
	addFinitePrivateProvider(t, c)
	_, err := c.SaveMetricBinding(sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster", PublicScope: map[string]string{"tenant": "secret"}})
	require.Error(t, err)
	wrapper := &ServiceWrapper{Ctrl: c}
	ctx := context.Background()
	_, err = wrapper.GetMetricSourceDefaults(ctx)
	require.Error(t, err)
	_, err = wrapper.SaveMetricSourceDefaults(ctx, sdk.MetricSourceDefaults{})
	require.Error(t, err)
	_, err = wrapper.GetProviderConnections(ctx, "external")
	require.Error(t, err)
	_, err = wrapper.SaveMetricDefinition(ctx, sdk.MetricDefinition{})
	require.Error(t, err)
	_, err = wrapper.SaveMetricBinding(ctx, sdk.MetricBinding{})
	require.Error(t, err)
	_, err = wrapper.GetResourceMetricsCatalog(ctx, ResourceMetricsCatalogRequest{})
	require.Error(t, err)
	_, err = wrapper.PreviewMetricDefinition(ctx, MetricsObservationSpec{}, sdk.MetricDefinition{})
	require.Error(t, err)
}

type finiteCatalogGateProvider struct {
	*finitePrivateProvider
	started        chan struct{}
	releaseCatalog chan struct{}
}

func (p *finiteCatalogGateProvider) GetResourceMetricsCatalog(pc *types.PluginContext, request sdk.ResourceMetricsCatalogRequest) (*sdk.ResourceMetricsCatalog, error) {
	close(p.started)
	// Simulate a provider that completes after cancellation instead of honoring it.
	<-p.releaseCatalog
	return p.finiteTestProvider.GetResourceMetricsCatalog(pc, request)
}
func TestFiniteConfigurationEditFencesLateCatalogResponse(t *testing.T) {
	c, _, ctx := finiteTestController(t)
	private := addFinitePrivateProvider(t, c)
	gate := &finiteCatalogGateProvider{finitePrivateProvider: private, started: make(chan struct{}), releaseCatalog: make(chan struct{})}
	c.clients["external"] = gate
	source := finitePrivateSource("one")
	spec := finiteTestSpec("row", "pod-a", "cpu")
	spec.Source = &source
	done := make(chan error, 1)
	go func() { _, err := c.GetResourceMetricsCatalog(ctx, finiteCatalogSelection(spec)); done <- err }()
	finiteTestReceive(t, gate.started)
	_, err := c.SaveProviderConnection("external", sdk.ProviderConnectionInput{Connection: sdk.ProviderConnection{ID: "one"}})
	require.NoError(t, err)
	close(gate.releaseCatalog)
	require.Error(t, finiteTestReceive(t, done), "late old catalog must not become current after a source edit")
	f := c.finiteCoordinator()
	f.mu.Lock()
	require.Empty(t, f.catalogs)
	f.mu.Unlock()
}

func TestFiniteMetricProjectionSubsetKeysShareOnlyCompatiblePairs(t *testing.T) {
	target := finiteTestSpec("row", "pod-a", "cpu", "memory").Targets[0]
	target.Token = finiteTargetKey(target)
	target.PublicData = map[string]string{"node": "node-a", "zone": "zone-a"}
	definitions := []sdk.MetricDefinition{
		{ID: "cpu", FieldBindings: []sdk.MetricFieldBinding{{Field: "node", ResourcePath: "/spec/nodeName"}}},
		{ID: "memory", FieldBindings: []sdk.MetricFieldBinding{{Field: "zone", ResourcePath: "/metadata/labels/zone"}}},
	}
	table := sdk.ResourceMetricsQuery{Targets: []sdk.ResourceMetricTarget{target}, MetricIDs: []string{"cpu", "memory"}, Context: sdk.MetricQueryContext{Definitions: definitions}}
	tablePairs, tableTargets, tableKeys := finiteWaiterPairs(table)
	sidebar := table
	sidebar.MetricIDs = []string{"cpu"}
	sidebar.Targets = append([]sdk.ResourceMetricTarget(nil), table.Targets...)
	sidebar.Targets[0].PublicData = map[string]string{"node": "node-a"}
	sidebarPairs, _, sidebarKeys := finiteWaiterPairs(sidebar)
	cpu := tableKeys[finitePair{target.Token, "cpu"}]
	require.True(t, tablePairs[cpu])
	require.True(t, sidebarPairs[cpu])
	require.Equal(t, cpu, sidebarKeys[finitePair{target.Token, "cpu"}])
	require.Equal(t, map[string]string{"node": "node-a"}, tableTargets[cpu.target].PublicData)
	sidebar.Targets[0].PublicData = map[string]string{"node": "node-b"}
	changed, _, _ := finiteWaiterPairs(sidebar)
	require.False(t, changed[cpu], "changed approved scalar must partition the affected metric pair")
}

func TestFiniteDefaultMappingsBatchTwentyFourTargetsTogether(t *testing.T) {
	c, _, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	close(external.release)
	source := finitePrivateSource("one")
	spec := finiteTestSpec("row", "pod-a", "cpu", "memory")
	spec.Source = &source
	spec.Targets = nil
	for i := range 24 {
		name := string(rune('a' + i))
		spec.Targets = append(spec.Targets, finiteTestSpec("row-"+name, "pod-"+name, "cpu", "memory").Targets[0])
	}
	result := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.NoError(t, result.err)
	require.Len(t, result.data.Results, 48)
	require.Equal(t, int32(1), external.queries.Load(), "host must preserve one vector batch, not one query per resource")
	query := finiteTestReceive(t, external.calls)
	require.Len(t, query.Targets, 24)
	require.Len(t, query.MetricIDs, 2)
}

func TestFinitePreviewUsesDraftAndOwnerScopeWithoutSaving(t *testing.T) {
	c, _, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	close(external.release)
	storedQuery := "saved-owner-query"
	_, err := c.SaveMetricBinding(sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster", PublicScope: map[string]string{"cluster": "prod"}, Overrides: []sdk.MetricDefinitionOverride{{MetricID: "cpu", Query: &storedQuery}}})
	require.NoError(t, err)
	definitions, err := external.GetMetricDefinitions(nil)
	require.NoError(t, err)
	draft := definitions[0]
	draft.Query = "draft-query"
	source := finitePrivateSource("one")
	spec := finiteTestSpec("preview", "pod-a", "cpu")
	spec.Source = &source
	_, err = c.PreviewMetricDefinition(ctx, spec, draft)
	require.NoError(t, err)
	query := finiteTestReceive(t, external.calls)
	require.Equal(t, "draft-query", query.Context.Definitions[0].Query)
	require.Equal(t, map[string]string{"cluster": "prod"}, query.Context.PublicScope)
	bindings, err := c.GetMetricBindings("kubernetes", "cluster")
	require.NoError(t, err)
	require.Equal(t, storedQuery, *bindings[0].Overrides[0].Query)
	native := sdk.MetricSourceRef{PluginID: spec.OwnerPluginID, ConnectionID: spec.OwnerConnectionID, DatasourceKind: "metrics-server"}
	spec.Source = &native
	_, err = c.PreviewMetricDefinition(ctx, spec, draft)
	require.Error(t, err)
	require.Equal(t, int32(1), external.queries.Load(), "native preview must not pretend to execute a custom mapping")
}

func TestFiniteMixedUnsupportedShapeFailsBeforeAnySampleQuery(t *testing.T) {
	c, owner, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	close(external.release)
	one := finitePrivateSource("one")
	native := sdk.MetricSourceRef{PluginID: "kubernetes", ConnectionID: "cluster", DatasourceKind: "metrics-server"}
	_, err := c.SaveMetricSourceDefaults(sdk.MetricSourceDefaults{Source: &one})
	require.NoError(t, err)
	_, err = c.SaveMetricBinding(sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster", Overrides: []sdk.MetricDefinitionOverride{{MetricID: "memory", Source: &native}}})
	require.NoError(t, err)
	spec := finiteTestSpec("row", "pod-a", "cpu", "memory")
	spec.Shape = "range"
	spec.StartTime = time.Now().UTC().Add(-time.Minute)
	spec.EndTime = spec.StartTime.Add(time.Minute)
	spec.StepMs = 15000
	result := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.Error(t, result.err)
	require.Equal(t, int32(0), external.queries.Load())
	require.Equal(t, int32(0), owner.queries.Load())
}

func TestFiniteNativeSourceDoesNotReadExternalMappingFields(t *testing.T) {
	c, owner, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	close(owner.release)
	definitions, err := external.GetMetricDefinitions(nil)
	require.NoError(t, err)
	definition := definitions[0]
	definition.FieldBindings = []sdk.MetricFieldBinding{{Field: "node", Label: "node", Source: "resource", ResourcePath: "/spec/nodeName", Required: true}}
	_, err = c.SaveMetricDefinition(definition)
	require.NoError(t, err)
	spec := finiteTestSpec("row", "pod-a", "cpu")
	spec.Source = &sdk.MetricSourceRef{PluginID: spec.OwnerPluginID, ConnectionID: spec.OwnerConnectionID, DatasourceKind: "metrics-server"}
	result := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.NoError(t, result.err)
	require.Equal(t, int32(1), owner.queries.Load())
	require.Equal(t, int32(0), external.queries.Load())
}

func TestFiniteMixedNativeAndExternalResultsKeepExactProvenance(t *testing.T) {
	c, owner, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	close(owner.release)
	close(external.release)
	source := finitePrivateSource("one")
	native := sdk.MetricSourceRef{PluginID: "kubernetes", ConnectionID: "cluster", DatasourceKind: "metrics-server"}
	_, err := c.SaveMetricBinding(sdk.MetricBinding{
		Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster",
		Source: source, PublicScope: map[string]string{"cluster": "prod"},
		Overrides: []sdk.MetricDefinitionOverride{{MetricID: "memory", Source: &native}},
	})
	require.NoError(t, err)
	spec := finiteTestSpec("row", "pod-a", "cpu", "memory")
	catalog, err := c.GetResourceMetricsCatalog(ctx, finiteCatalogSelection(spec))
	require.NoError(t, err)
	sources := map[string]sdk.MetricSourceRef{}
	for _, descriptor := range catalog.Metrics {
		require.NotNil(t, descriptor.Source)
		sources[descriptor.ID] = *descriptor.Source
	}
	require.Equal(t, source, sources["cpu"])
	require.Equal(t, native, sources["memory"])
	reply := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.NoError(t, reply.err)
	require.Len(t, reply.data.Results, 2)
	for _, result := range reply.data.Results {
		require.NotNil(t, result.Source)
		require.Equal(t, sources[result.MetricID], *result.Source)
	}
}
