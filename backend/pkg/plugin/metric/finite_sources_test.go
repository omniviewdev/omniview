package metric

import (
	"context"
	"errors"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
)

func nextFiniteSnapshot(t *testing.T, events <-chan MetricsObservationSnapshot, accept func(MetricsObservationSnapshot) bool) MetricsObservationSnapshot {
	t.Helper()
	for {
		snapshot := finiteTestReceive(t, events)
		if accept(snapshot) {
			return snapshot
		}
	}
}
func TestFiniteRelativeRangeUsesOneAlignedImmutableDomain(t *testing.T) {
	now := time.Date(2026, 11, 5, 12, 34, 56, 789000000, time.FixedZone("offset", 3600))
	spec := finiteTestSpec("row", "pod-a", "cpu")
	spec.Shape = "range"
	spec.DurationMs = 3600000
	spec.StepMs = 15000
	first, err := resolveFiniteRange(spec, now)
	require.NoError(t, err)
	require.Zero(t, first.DurationMs)
	require.Equal(t, time.UTC, first.EndTime.Location())
	require.Zero(t, first.EndTime.UnixMilli()%int64(spec.StepMs))
	require.Equal(t, time.Hour, first.EndTime.Sub(first.StartTime))
	same, err := resolveFiniteRange(spec, first.EndTime.Add(time.Second))
	require.NoError(t, err)
	require.Equal(t, first, same)
	later, err := resolveFiniteRange(spec, first.EndTime.Add(15*time.Second))
	require.NoError(t, err)
	require.Equal(t, first.EndTime.Add(15*time.Second), later.EndTime)
	require.Equal(t, int64(3600000), spec.DurationMs)
	require.True(t, spec.StartTime.IsZero())
	require.True(t, spec.EndTime.IsZero())
	absolute, err := resolveFiniteRange(first, now.Add(24*time.Hour))
	require.NoError(t, err)
	require.Equal(t, first, absolute)
	c, _, ctx := finiteTestController(t)
	for _, mutate := range []func(*MetricsObservationSpec){
		func(s *MetricsObservationSpec) { s.DurationMs = -1 },
		func(s *MetricsObservationSpec) { s.DurationMs = int64(sdk.MaxFiniteRange/time.Millisecond) + 1 },
		func(s *MetricsObservationSpec) { s.Shape = "current" },
		func(s *MetricsObservationSpec) { s.StartTime = now },
		func(s *MetricsObservationSpec) { s.EndTime = now },
		func(s *MetricsObservationSpec) { s.StepMs = 0 },
		func(s *MetricsObservationSpec) { s.DurationMs = 0 },
	} {
		invalid := spec
		mutate(&invalid)
		_, _, err := c.admitFinite(ctx, invalid)
		require.Error(t, err)
	}
}

func TestFiniteRelativeObservationAdvancesDomainOnlyWithNewData(t *testing.T) {
	c, _, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	close(external.release)
	external.response = func(q sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse {
		value := 1.0
		return &sdk.ResourceMetricsResponse{Complete: true, Results: []sdk.ResourceMetricResult{{ResourceToken: q.Targets[0].Token, MetricID: "cpu", Status: "ok", Points: []sdk.ResourceMetricPoint{{Time: q.StartTime, Value: &value}}, IdentityScope: "name"}}}
	}
	source := finitePrivateSource("one")
	spec := finiteTestSpec("row", "pod-a", "cpu")
	spec.Source = &source
	spec.Shape = "range"
	spec.DurationMs = 1000
	spec.StepMs = 1
	events := make(chan MetricsObservationSnapshot, 32)
	opened, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "relative", Spec: spec}, func(snapshot MetricsObservationSnapshot) { events <- snapshot })
	require.NoError(t, err)
	require.Nil(t, opened.DomainStart)
	require.Nil(t, opened.DomainEnd)
	require.NoError(t, c.AttachMetricsObservation(ctx, "relative"))
	firstQuery := finiteTestReceive(t, external.calls)
	first := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
	require.Equal(t, firstQuery.StartTime, *first.DomainStart)
	require.Equal(t, firstQuery.EndTime, *first.DomainEnd)
	external.release = make(chan struct{})
	require.NoError(t, c.RefreshMetricsObservation(ctx, "relative"))
	secondQuery := finiteTestReceive(t, external.calls)
	updating := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && s.Fetching })
	require.Equal(t, *first.DomainStart, *updating.DomainStart)
	require.Equal(t, *first.DomainEnd, *updating.DomainEnd)
	require.True(t, secondQuery.EndTime.After(firstQuery.EndTime))
	close(external.release)
	second := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
	require.Equal(t, secondQuery.StartTime, *second.DomainStart)
	require.Equal(t, secondQuery.EndTime, *second.DomainEnd)
	require.Equal(t, *second.DomainStart, second.Data.Results[0].Points[0].Time)
	// A rejected response must not leave old data under the new moving domain.
	external.response = func(sdk.ResourceMetricsQuery) *sdk.ResourceMetricsResponse { return nil }
	require.NoError(t, c.RefreshMetricsObservation(ctx, "relative"))
	failed := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Error != "" && !s.Fetching })
	require.Nil(t, failed.Data)
	require.Nil(t, failed.DomainStart)
	require.Nil(t, failed.DomainEnd)
	require.NoError(t, c.CloseMetricsObservation(ctx, "relative"))
}

func TestFiniteUnrelatedOwnerAndSourceEditsPreserveFlightAndCache(t *testing.T) {
	c, _, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	one := finitePrivateSource("one")
	_, err := c.SaveMetricSourceDefaults(sdk.MetricSourceDefaults{Source: &one})
	require.NoError(t, err)
	spec := finiteTestSpec("row", "pod-a", "cpu")
	before, err := c.resolveFiniteSources(finiteCatalogSelection(spec), spec.MetricIDs, nil)
	require.NoError(t, err)
	result := finiteTestRead(c, ctx, spec)
	finiteTestReceive(t, external.calls)
	_, err = c.SaveMetricBinding(sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "other-cluster", Source: finitePrivateSource("two")})
	require.NoError(t, err)
	_, err = c.SaveProviderConnection("external", sdk.ProviderConnectionInput{Connection: sdk.ProviderConnection{ID: "two", Name: "Unrelated edit"}})
	require.NoError(t, err)
	after, err := c.resolveFiniteSources(finiteCatalogSelection(spec), spec.MetricIDs, nil)
	require.NoError(t, err)
	require.Equal(t, before[0].context.MappingRevision, after[0].context.MappingRevision)
	close(external.release)
	require.NoError(t, finiteTestReceive(t, result).err)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	require.Equal(t, int32(1), external.queries.Load())
	_, err = c.SaveMetricBinding(sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "third-cluster", Source: one})
	require.NoError(t, err)
	_, err = c.SaveProviderConnection("external", sdk.ProviderConnectionInput{Connection: sdk.ProviderConnection{ID: "two", Name: "Another unrelated edit"}})
	require.NoError(t, err)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	require.Equal(t, int32(1), external.queries.Load(), "unrelated edits must preserve an already completed cache entry")
	_, err = c.SaveMetricBinding(sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster", PublicScope: map[string]string{"cluster": "prod"}})
	require.NoError(t, err)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	require.Equal(t, int32(2), external.queries.Load())
	relevant, err := c.resolveFiniteSources(finiteCatalogSelection(spec), spec.MetricIDs, nil)
	require.NoError(t, err)
	require.NotEqual(t, before[0].context.MappingRevision, relevant[0].context.MappingRevision)
	_, err = c.SaveProviderConnection("external", sdk.ProviderConnectionInput{Connection: sdk.ProviderConnection{ID: "one", Name: "Selected credential rotation"}})
	require.NoError(t, err)
	sameMapping, err := c.resolveFiniteSources(finiteCatalogSelection(spec), spec.MetricIDs, nil)
	require.NoError(t, err)
	require.Equal(t, relevant[0].context.MappingRevision, sameMapping[0].context.MappingRevision)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	require.Equal(t, int32(3), external.queries.Load(), "selected transport edit must fence even unchanged public mappings")
}

func TestFiniteNativeCacheIgnoresUnusedExternalDefinitions(t *testing.T) {
	c, owner, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	close(owner.release)
	spec := finiteTestSpec("row", "pod-a", "cpu")
	before, err := c.resolveFiniteSources(finiteCatalogSelection(spec), spec.MetricIDs, nil)
	require.NoError(t, err)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	definitions, err := external.GetMetricDefinitions(nil)
	require.NoError(t, err)
	definitions[0].Query = "external-only-edit"
	_, err = c.SaveMetricDefinition(definitions[0])
	require.NoError(t, err)
	after, err := c.resolveFiniteSources(finiteCatalogSelection(spec), spec.MetricIDs, nil)
	require.NoError(t, err)
	require.Equal(t, before[0].context.MappingRevision, after[0].context.MappingRevision)
	require.Empty(t, after[0].context.Definitions)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	require.Equal(t, int32(1), owner.queries.Load())
}

func TestMetricViewSourceSelectionPersistsPrecedenceAndScopedCAS(t *testing.T) {
	c, _, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	close(external.release)
	one, two := finitePrivateSource("one"), finitePrivateSource("two")
	_, err := c.SaveMetricSourceDefaults(sdk.MetricSourceDefaults{Source: &one})
	require.NoError(t, err)
	_, err = c.SaveMetricBinding(sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster", Source: two, PublicScope: map[string]string{"cluster": "prod"}, Overrides: []sdk.MetricDefinitionOverride{{MetricID: "memory", Source: &one}}})
	require.NoError(t, err)
	selected, err := c.GetMetricViewSourceSelection("kubernetes", "cluster", "core::v1::Pod")
	require.NoError(t, err)
	require.Equal(t, "inherit", selected.Mode)
	selected.Mode = "external"
	selected.Source = &one
	saved, err := c.SaveMetricViewSourceSelection(selected)
	require.NoError(t, err)
	require.NotEmpty(t, saved.Revision)
	_, err = c.SaveMetricViewSourceSelection(selected)
	require.Error(t, err)
	spec := finiteTestSpec("row", "pod-a", "cpu", "memory")
	lanes, err := c.resolveFiniteSources(finiteCatalogSelection(spec), spec.MetricIDs, nil)
	require.NoError(t, err)
	require.Len(t, lanes, 1)
	require.Equal(t, one, lanes[0].source)
	require.Equal(t, map[string]string{"cluster": "prod"}, lanes[0].context.PublicScope)
	// Inline source has its own dependency set, not the saved view's revision.
	spec.Source = &two
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	saved.Mode = "native"
	saved.Source = nil
	saved, err = c.SaveMetricViewSourceSelection(saved)
	require.NoError(t, err)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	require.Equal(t, int32(1), external.queries.Load())
	spec.Source = nil
	lanes, err = c.resolveFiniteSources(finiteCatalogSelection(spec), spec.MetricIDs, nil)
	require.NoError(t, err)
	require.Len(t, lanes, 1)
	require.Equal(t, "metrics-server", lanes[0].source.DatasourceKind)
	require.Empty(t, lanes[0].context.PublicScope)
	require.Empty(t, lanes[0].context.Definitions)
	saved.Mode = "inherit"
	saved, err = c.SaveMetricViewSourceSelection(saved)
	require.NoError(t, err)
	lanes, err = c.resolveFiniteSources(finiteCatalogSelection(spec), spec.MetricIDs, nil)
	require.NoError(t, err)
	require.Len(t, lanes, 2)
	root := c.state().root
	c.SetMetricStateRoot(root)
	reloaded, err := c.GetMetricViewSourceSelection("kubernetes", "cluster", "core::v1::Pod")
	require.NoError(t, err)
	require.Equal(t, saved, reloaded)
	wrapper := &ServiceWrapper{Ctrl: c}
	_, err = wrapper.GetMetricViewSourceSelection(context.Background(), "kubernetes", "cluster", "core::v1::Pod")
	require.Error(t, err)
	_, err = wrapper.SaveMetricViewSourceSelection(context.Background(), saved)
	require.Error(t, err)
}

type finiteRecoveringPrivateProvider struct {
	*finitePrivateProvider
	unavailable atomic.Bool
}

func (p *finiteRecoveringPrivateProvider) GetResourceMetricsCatalog(pc *types.PluginContext, request sdk.ResourceMetricsCatalogRequest) (*sdk.ResourceMetricsCatalog, error) {
	if p.unavailable.Load() {
		return nil, errors.New("selected private source deleted")
	}
	return p.finiteTestProvider.GetResourceMetricsCatalog(pc, request)
}
func (p *finiteRecoveringPrivateProvider) DeleteProviderConnection(*types.PluginContext, string) error {
	p.unavailable.Store(true)
	return nil
}
func (p *finiteRecoveringPrivateProvider) SaveProviderConnection(_ *types.PluginContext, input sdk.ProviderConnectionInput) (*sdk.ProviderConnection, error) {
	p.unavailable.Store(false)
	return &input.Connection, nil
}
func TestFiniteObservationRecoversSelectedSourceWithoutReopening(t *testing.T) {
	c, owner, ctx := finiteTestController(t)
	private := addFinitePrivateProvider(t, c)
	close(private.release)
	provider := &finiteRecoveringPrivateProvider{finitePrivateProvider: private}
	c.clients["external"] = provider
	one := finitePrivateSource("one")
	spec := finiteTestSpec("row", "pod-a", "cpu")
	spec.Source = &one
	events := make(chan MetricsObservationSnapshot, 64)
	opened, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "recover", Spec: spec}, func(snapshot MetricsObservationSnapshot) { events <- snapshot })
	require.NoError(t, err)
	require.NoError(t, c.AttachMetricsObservation(ctx, "recover"))
	nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
	finiteTestReceive(t, private.calls)
	_, err = c.SaveMetricBinding(sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster", PublicScope: map[string]string{"cluster": "updated"}})
	require.NoError(t, err)
	rebound := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
	require.Equal(t, opened.Generation, rebound.Generation)
	require.Equal(t, map[string]string{"cluster": "updated"}, finiteTestReceive(t, private.calls).Context.PublicScope)
	require.NoError(t, c.DeleteProviderConnection("external", "one"))
	failed := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool {
		return s.Error == "selected private source deleted" && !s.Fetching
	})
	require.Nil(t, failed.Data)
	require.True(t, failed.Invalidated)
	_, err = c.SaveProviderConnection("external", sdk.ProviderConnectionInput{Connection: sdk.ProviderConnection{ID: "one"}})
	require.NoError(t, err)
	restored := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
	require.Equal(t, opened.Generation, restored.Generation)
	require.Equal(t, &one, restored.Data.Results[0].Source)
	require.Zero(t, owner.queries.Load(), "source deletion must never fall back to native")
	require.NoError(t, c.RefreshMetricsObservation(ctx, "recover"))
	require.NoError(t, c.CloseMetricsObservation(ctx, "recover"))
}

func TestFiniteUnrelatedDefinitionPreservesExternalCache(t *testing.T) {
	c, _, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	close(external.release)
	one := finitePrivateSource("one")
	spec := finiteTestSpec("row", "pod-a", "cpu")
	spec.Source = &one
	before, err := c.resolveFiniteSources(finiteCatalogSelection(spec), spec.MetricIDs, nil)
	require.NoError(t, err)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	_, err = c.SaveMetricDefinition(sdk.MetricDefinition{ID: "other-resource-cpu", Name: "Other resource CPU", ResourceKeys: []string{"k8s:/nodes"}, Unit: "cores", SupportedShapes: []string{"current"}, Query: "other-resource-query"})
	require.NoError(t, err)
	after, err := c.resolveFiniteSources(finiteCatalogSelection(spec), spec.MetricIDs, nil)
	require.NoError(t, err)
	require.Equal(t, before[0].context.MappingRevision, after[0].context.MappingRevision)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	require.Equal(t, int32(1), external.queries.Load())
}

type finiteCreatingPrivateProvider struct{ *finitePrivateProvider }

func (p *finiteCreatingPrivateProvider) SaveProviderConnection(_ *types.PluginContext, input sdk.ProviderConnectionInput) (*sdk.ProviderConnection, error) {
	if input.Connection.ID == "" {
		input.Connection.ID = "created-source"
	}
	return &input.Connection, nil
}
func TestFiniteCreatingAnotherSourcePreservesSelectedCache(t *testing.T) {
	c, _, ctx := finiteTestController(t)
	private := addFinitePrivateProvider(t, c)
	close(private.release)
	c.clients["external"] = &finiteCreatingPrivateProvider{finitePrivateProvider: private}
	one := finitePrivateSource("one")
	spec := finiteTestSpec("row", "pod-a", "cpu")
	spec.Source = &one
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	created, err := c.SaveProviderConnection("external", sdk.ProviderConnectionInput{Connection: sdk.ProviderConnection{Name: "New source"}})
	require.NoError(t, err)
	require.Equal(t, "created-source", created.ID)
	require.NoError(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
	require.Equal(t, int32(1), private.queries.Load())
}

func TestFiniteConfigurationHistoryRetainsUnresolvedReadFences(t *testing.T) {
	f := &finiteCoordinator{configurationSerial: 10, configurationVersions: map[finiteConfigurationKey]uint64{}, configurationBlocked: map[finiteConfigurationKey]int{}}
	_, serial, finish := f.beginConfigurationRead()
	require.Equal(t, uint64(10), serial)
	f.mu.Lock()
	for i := range 5000 {
		f.configurationVersions[finiteConfigurationKey{kind: "source", connection: strconv.Itoa(i)}] = 11
	}
	blocked := finiteConfigurationKey{kind: "source", connection: "blocked"}
	f.configurationVersions[blocked] = 11
	f.configurationBlocked[blocked] = 1
	f.configurationSerial = 12
	f.pruneConfigurationVersionsLocked()
	require.Len(t, f.configurationVersions, 5001, "unresolved dependency reads still need intervening change stamps")
	f.mu.Unlock()
	finish()
	require.Len(t, f.configurationVersions, 1)
	require.Equal(t, uint64(11), f.configurationVersions[blocked])
}

type finitePodOnlyPrivateCatalog struct{ *finitePrivateProvider }

func (p *finitePodOnlyPrivateCatalog) GetResourceMetricsCatalog(pc *types.PluginContext, request sdk.ResourceMetricsCatalogRequest) (*sdk.ResourceMetricsCatalog, error) {
	if request.ResourceKey == "k8s:/nodes" {
		return nil, errors.New("pod-only override must not select the node source")
	}
	return p.finiteTestProvider.GetResourceMetricsCatalog(pc, request)
}
func TestFiniteOwnerOverridesApplyOnlyToTheirResourceTypes(t *testing.T) {
	c, _, ctx := finiteTestController(t)
	private := addFinitePrivateProvider(t, c)
	c.clients["external"] = &finitePodOnlyPrivateCatalog{finitePrivateProvider: private}
	two := finitePrivateSource("two")
	_, err := c.SaveMetricBinding(sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster", Overrides: []sdk.MetricDefinitionOverride{{MetricID: "cpu", Source: &two}}})
	require.NoError(t, err)
	catalog, err := c.GetResourceMetricsCatalog(ctx, ResourceMetricsCatalogRequest{OwnerPluginID: "kubernetes", OwnerConnectionID: "cluster", ResourceKey: "k8s:/nodes"})
	require.NoError(t, err)
	require.Equal(t, "metrics-server", catalog.Source.DatasourceKind)
}

func TestMetricDeletedRecordsRejectStaleSaves(t *testing.T) {
	c, _, _ := finiteTestController(t)
	addFinitePrivateProvider(t, c)
	binding, err := c.SaveMetricBinding(sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster"})
	require.NoError(t, err)
	require.NoError(t, c.DeleteMetricBinding("kubernetes", "cluster", binding.ID))
	_, err = c.SaveMetricBinding(*binding)
	require.Error(t, err)
	bindings, err := c.GetMetricBindings("kubernetes", "cluster")
	require.NoError(t, err)
	require.Empty(t, bindings)
	definition, err := c.SaveMetricDefinition(sdk.MetricDefinition{ID: "custom", Name: "Custom", ResourceKeys: []string{"core::v1::Pod"}, Unit: "cores", SupportedShapes: []string{"current"}, Query: "custom-query"})
	require.NoError(t, err)
	require.NoError(t, c.DeleteMetricDefinition(definition.ID))
	_, err = c.SaveMetricDefinition(*definition)
	require.Error(t, err)
	definitions, err := c.GetMetricDefinitions()
	require.NoError(t, err)
	for _, item := range definitions {
		require.NotEqual(t, "custom", item.ID)
	}
}

type finiteDynamicPrivateCatalog struct{ *finitePrivateProvider }

func (p *finiteDynamicPrivateCatalog) GetResourceMetricsCatalog(_ *types.PluginContext, request sdk.ResourceMetricsCatalogRequest) (*sdk.ResourceMetricsCatalog, error) {
	catalog := &sdk.ResourceMetricsCatalog{Source: request.Source, MaxTargets: sdk.MaxFiniteTargets}
	for _, definition := range request.Context.Definitions {
		catalog.Metrics = append(catalog.Metrics, sdk.FiniteMetricDescriptor{ID: definition.ID, Name: definition.Name, ResourceKey: request.ResourceKey, Unit: definition.Unit, Shapes: definition.SupportedShapes})
	}
	return catalog, nil
}
func TestFiniteDeletedDefinitionCanRecoverWithoutReopening(t *testing.T) {
	c, owner, ctx := finiteTestController(t)
	private := addFinitePrivateProvider(t, c)
	close(private.release)
	c.clients["external"] = &finiteDynamicPrivateCatalog{finitePrivateProvider: private}
	definition, err := c.SaveMetricDefinition(sdk.MetricDefinition{ID: "custom", Name: "Custom", ResourceKeys: []string{"core::v1::Pod"}, Unit: "cores", SupportedShapes: []string{"current"}, Query: "custom-query"})
	require.NoError(t, err)
	one := finitePrivateSource("one")
	_, err = c.SaveMetricBinding(sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster", Overrides: []sdk.MetricDefinitionOverride{{MetricID: "custom", Source: &one}}})
	require.NoError(t, err)
	events := make(chan MetricsObservationSnapshot, 64)
	opened, err := c.OpenMetricsObservation(ctx, OpenMetricsObservationRequest{ClientToken: "definition-repair", Spec: finiteTestSpec("row", "pod-a", "custom")}, func(snapshot MetricsObservationSnapshot) { events <- snapshot })
	require.NoError(t, err)
	require.NoError(t, c.AttachMetricsObservation(ctx, "definition-repair"))
	nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
	require.NoError(t, c.DeleteMetricDefinition(definition.ID))
	nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool {
		return s.Data == nil && s.Error != "" && s.Error != "Metric source configuration changed." && !s.Fetching
	})
	definition.Revision = ""
	definition.Query = "restored-query"
	_, err = c.SaveMetricDefinition(*definition)
	require.NoError(t, err)
	restored := nextFiniteSnapshot(t, events, func(s MetricsObservationSnapshot) bool { return s.Data != nil && !s.Fetching })
	require.Equal(t, opened.Generation, restored.Generation)
	require.Equal(t, &one, restored.Data.Results[0].Source)
	require.Zero(t, owner.queries.Load(), "missing explicit mapping must not collect native fallback data")
	require.NoError(t, c.CloseMetricsObservation(ctx, "definition-repair"))
}
