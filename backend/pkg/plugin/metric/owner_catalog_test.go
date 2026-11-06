package metric

import (
	"context"
	"errors"
	"testing"

	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	sdk "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	"github.com/stretchr/testify/require"
)

type brokenOwnerCatalog struct{ *finiteTestProvider }

func (*brokenOwnerCatalog) GetMetricOwnerCatalog(*types.PluginContext) (*sdk.MetricOwnerCatalog, error) {
	return nil, errors.New("unrelated catalog unavailable")
}

type computeOwnerCatalog struct{ *finiteTestProvider }

func (p *computeOwnerCatalog) GetMetricOwnerCatalog(ctx *types.PluginContext) (*sdk.MetricOwnerCatalog, error) {
	catalog, err := p.finiteTestProvider.GetMetricOwnerCatalog(ctx)
	if err != nil {
		return nil, err
	}
	for i := range catalog.Definitions {
		catalog.Definitions[i].ResourceKeys = []string{"compute:/instances"}
	}
	return catalog, nil
}

func TestOwnerCatalogScopesAndNativeAuthority(t *testing.T) {
	c, owner, ctx := finiteTestController(t)
	addFinitePrivateProvider(t, c)
	delete(c.clients, "kubernetes")
	c.clients["compute"] = &computeOwnerCatalog{finiteTestProvider: owner}
	c.clients["unrelated"] = &brokenOwnerCatalog{finiteTestProvider: owner}
	close(owner.release)
	spec := finiteTestSpec("row", "instance", "cpu")
	spec.OwnerPluginID = "compute"
	spec.OwnerConnectionID = "account-a"
	spec.ResourceKey = "compute:/instances"
	spec.Targets[0].Reference.Address.Type = spec.ResourceKey
	spec.Targets[0].Reference.Address.Provider = "compute"
	spec.Targets[0].Route.Connection = "account-a"
	binding := sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "compute", ResourceConnectionID: "account-a"}
	for _, key := range []string{"region", "account", "project"} {
		binding.PublicScope = map[string]string{key: "public-value"}
		saved, err := c.SaveMetricBinding(ctx, binding)
		require.NoError(t, err)
		binding = *saved
	}
	for _, key := range []string{"password", "token", "undeclared"} {
		_, err := c.SaveMetricBinding(ctx, sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "compute", ResourceConnectionID: "account-a", PublicScope: map[string]string{key: "secret"}})
		require.Error(t, err)
	}
	native := sdk.MetricSourceRef{PluginID: "compute", ConnectionID: "account-a", Native: true}
	spec.Source = &native
	result := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.NoError(t, result.err)
	require.Equal(t, native, finiteTestReceive(t, owner.calls).Source)
	for _, forged := range []sdk.MetricSourceRef{
		{PluginID: "compute", ConnectionID: "account-b", Native: true},
		{PluginID: "unrelated", ConnectionID: "account-a", Native: true},
		{PluginID: "compute", ConnectionID: "account-a", Native: true, DatasourceKind: "prometheus"},
	} {
		spec.Source = &forged
		require.Error(t, finiteTestReceive(t, finiteTestRead(c, ctx, spec)).err)
		_, err := c.SaveMetricBinding(ctx, sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "compute", ResourceConnectionID: "account-a", Source: forged})
		require.Error(t, err)
	}
	_, err := c.SaveMetricSourceDefaults(ctx, sdk.MetricSourceDefaults{Source: &native})
	require.Error(t, err)
	_, err = (&ServiceWrapper{Ctrl: c}).GetMetricOwnerCatalog(context.Background(), "compute", "account-a")
	require.Error(t, err)
}

func TestSelectedExternalQueryIgnoresUnrelatedCatalogFailure(t *testing.T) {
	c, owner, ctx := finiteTestController(t)
	external := addFinitePrivateProvider(t, c)
	c.clients["unrelated"] = &brokenOwnerCatalog{finiteTestProvider: owner}
	close(external.release)
	source := finitePrivateSource("one")
	spec := finiteTestSpec("row", "object", "cpu")
	spec.Source = &source
	result := finiteTestReceive(t, finiteTestRead(c, ctx, spec))
	require.NoError(t, result.err)
	require.Equal(t, source, finiteTestReceive(t, external.calls).Source)
	undeclared := []sdk.MetricFieldBinding{{Field: "credential", Source: "scope", Label: "tenant"}}
	_, err := c.SaveMetricBinding(ctx, sdk.MetricBinding{Signal: "metrics", ResourcePluginID: spec.OwnerPluginID, ResourceConnectionID: spec.OwnerConnectionID, Overrides: []sdk.MetricDefinitionOverride{{MetricID: "cpu", FieldBindings: &undeclared}}})
	require.Error(t, err)
}

type admittedOwnerConnections struct {
	lookup func(context.Context) error
}

func (r admittedOwnerConnections) GetConnection(ctx context.Context, _, id string) (types.Connection, error) {
	if _, err := finiteIdentity(ctx); err != nil {
		return types.Connection{}, err
	}
	if r.lookup != nil {
		if err := r.lookup(ctx); err != nil {
			return types.Connection{}, err
		}
	}
	return types.Connection{ID: id}, nil
}

type admittedOwnerCatalog struct {
	*finiteTestProvider
	catalog func(context.Context) error
}

func (p *admittedOwnerCatalog) GetMetricOwnerCatalog(pc *types.PluginContext) (*sdk.MetricOwnerCatalog, error) {
	if _, err := finiteIdentity(pc.Context); err != nil {
		return nil, err
	}
	if p.catalog != nil {
		if err := p.catalog(pc.Context); err != nil {
			return nil, err
		}
	}
	return p.finiteTestProvider.GetMetricOwnerCatalog(pc)
}

func TestOwnerResolutionRetainsPrincipalThroughSavesAndRevisionGuards(t *testing.T) {
	c, owner, ctx := finiteTestController(t)
	c.SetMetricStateRoot(appstate.NewTestService(t).RootDir())
	c.resourceClient = admittedOwnerConnections{}
	c.clients["kubernetes"] = &admittedOwnerCatalog{finiteTestProvider: owner}
	_, err := c.SaveMetricBinding(ctx, sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster"})
	require.NoError(t, err)
	request := finiteCatalogSelection(finiteTestSpec("row", "pod", "cpu"))
	lanes, err := c.resolveFiniteSources(ctx, request, []string{"cpu"}, nil)
	require.NoError(t, err)
	f := c.finiteCoordinator()
	generation, serial, finish := f.beginConfigurationRead()
	defer finish()
	guard, err := f.fenceFiniteSources(ctx, request, lanes, generation, serial, nil)
	require.NoError(t, err)
	require.NoError(t, guard())
	_, err = c.resolveFiniteSources(context.Background(), request, nil, nil)
	require.Error(t, err, "resource admission must reject a missing principal")
}

func TestOwnerCatalogPropagatesCancellationToLookupAndCatalog(t *testing.T) {
	for _, stage := range []string{"lookup", "catalog"} {
		t.Run(stage, func(t *testing.T) {
			c, owner, base := finiteTestController(t)
			ctx, cancel := context.WithCancel(base)
			defer cancel()
			block := func(ctx context.Context) error {
				cancel()
				<-ctx.Done()
				return ctx.Err()
			}
			reader := admittedOwnerConnections{}
			provider := &admittedOwnerCatalog{finiteTestProvider: owner}
			if stage == "lookup" {
				reader.lookup = block
			} else {
				provider.catalog = block
			}
			c.resourceClient = reader
			c.clients["kubernetes"] = provider
			_, err := c.GetMetricOwnerCatalog(ctx, "kubernetes", "cluster")
			require.ErrorIs(t, err, context.Canceled)
		})
	}
}

func TestOwnerSettingsCatalogOverlaysProfileWithoutExpandingScope(t *testing.T) {
	c, owner, ctx := finiteTestController(t)
	c.SetMetricStateRoot(appstate.NewTestService(t).RootDir())
	c.resourceClient = admittedOwnerConnections{}
	c.clients["kubernetes"] = &admittedOwnerCatalog{finiteTestProvider: owner}
	c.clients["unrelated"] = &brokenOwnerCatalog{finiteTestProvider: owner}
	raw, err := c.rawMetricOwnerCatalog(ctx, "kubernetes", "cluster")
	require.NoError(t, err)
	definition := raw.Definitions[0]
	definition.Query = "profile-query"
	_, err = c.SaveMetricDefinition(ctx, "kubernetes", "cluster", definition)
	require.NoError(t, err)
	custom := definition
	custom.ID = "custom-profile"
	custom.FieldBindings = []sdk.MetricFieldBinding{{Field: "tenant", Source: "scope", Label: "undeclared"}}
	savedCustom, err := c.SaveMetricDefinition(ctx, "kubernetes", "cluster", custom)
	require.NoError(t, err)
	catalog, err := c.GetMetricOwnerCatalog(ctx, "kubernetes", "cluster")
	require.NoError(t, err)
	require.Equal(t, raw.ScopeFields, catalog.ScopeFields)
	found := map[string]sdk.MetricDefinition{}
	for _, definition := range catalog.Definitions {
		found[definition.ID] = definition
	}
	require.Equal(t, "profile-query", found[definition.ID].Query)
	require.Equal(t, *savedCustom, found[custom.ID])
	_, err = c.SaveMetricBinding(ctx, sdk.MetricBinding{Signal: "metrics", ResourcePluginID: "kubernetes", ResourceConnectionID: "cluster", PublicScope: map[string]string{"undeclared": "value"}})
	require.Error(t, err)
}

func TestSelectedSourceSavesRetainAdmissionAndCancellation(t *testing.T) {
	c, _, ctx := finiteTestController(t)
	c.SetMetricStateRoot(appstate.NewTestService(t).RootDir())
	c.resourceClient = admittedOwnerConnections{}
	source := sdk.MetricSourceRef{PluginID: "kubernetes", ConnectionID: "cluster", DatasourceKind: "prometheus", DatasourceUID: "metrics"}
	_, err := c.SaveMetricSourceDefaults(ctx, sdk.MetricSourceDefaults{Source: &source})
	require.NoError(t, err)
	_, err = c.SaveMetricViewSourceSelection(ctx, sdk.MetricViewSourceSelection{OwnerPluginID: "kubernetes", OwnerConnectionID: "cluster", ResourceKey: "core::v1::Pod", Mode: "external", Source: &source})
	require.NoError(t, err)
	cancelled, cancel := context.WithCancel(ctx)
	c.resourceClient = admittedOwnerConnections{lookup: func(ctx context.Context) error {
		cancel()
		<-ctx.Done()
		return ctx.Err()
	}}
	require.ErrorIs(t, c.validateSelectedMetricSource(cancelled, source), context.Canceled)
}

type selectedRevisionOwnerCatalog struct {
	*finiteTestProvider
}

func (p *selectedRevisionOwnerCatalog) GetMetricOwnerCatalog(pc *types.PluginContext) (*sdk.MetricOwnerCatalog, error) {
	if _, err := finiteIdentity(pc.Context); err != nil {
		return nil, err
	}
	if pc.Connection == nil || pc.Connection.ID != "cluster" {
		return nil, errors.New("owner metadata requires its selected connection")
	}
	catalog, err := p.finiteTestProvider.GetMetricOwnerCatalog(pc)
	if err != nil {
		return nil, err
	}
	for i := range catalog.Definitions {
		catalog.Definitions[i].Revision = "kubernetes-cadvisor-v1"
	}
	return catalog, nil
}

func TestSelectedOwnerDefinitionSaveUsesInheritedRevisionAndRestoresDefault(t *testing.T) {
	c, owner, ctx := finiteTestController(t)
	c.SetMetricStateRoot(appstate.NewTestService(t).RootDir())
	c.resourceClient = admittedOwnerConnections{}
	c.clients["kubernetes"] = &selectedRevisionOwnerCatalog{finiteTestProvider: owner}
	c.clients["unrelated"] = &brokenOwnerCatalog{finiteTestProvider: owner}
	catalog, err := c.GetMetricOwnerCatalog(ctx, "kubernetes", "cluster")
	require.NoError(t, err)
	inherited := catalog.Definitions[0]
	require.Equal(t, "kubernetes-cadvisor-v1", inherited.Revision)
	for _, change := range []func(*sdk.MetricDefinition){
		func(d *sdk.MetricDefinition) { d.Unit = "percent" },
		func(d *sdk.MetricDefinition) { d.Native = !d.Native },
		func(d *sdk.MetricDefinition) { d.ResourceKeys = []string{"other:/resource"} },
	} {
		draft := copyJSON(inherited)
		change(&draft)
		_, err := c.SaveMetricDefinition(ctx, "kubernetes", "cluster", draft)
		require.Error(t, err)
	}
	draft := copyJSON(inherited)
	draft.Query = "profile-six-minute-query"
	saved, err := c.SaveMetricDefinition(ctx, "kubernetes", "cluster", draft)
	require.NoError(t, err)
	require.NotEqual(t, inherited.Revision, saved.Revision)
	_, err = c.SaveMetricDefinition(ctx, "kubernetes", "cluster", draft)
	require.Equal(t, "CONFLICT", resourcev2.ErrorCode(err))
	profile, err := c.GetMetricDefinitions()
	require.NoError(t, err)
	require.Equal(t, []sdk.MetricDefinition{*saved}, profile)
	catalog, err = c.GetMetricOwnerCatalog(ctx, "kubernetes", "cluster")
	require.NoError(t, err)
	require.Equal(t, *saved, catalog.Definitions[0])
	require.NoError(t, c.DeleteMetricDefinition(saved.ID))
	profile, err = c.GetMetricDefinitions()
	require.NoError(t, err)
	require.Empty(t, profile)
	catalog, err = c.GetMetricOwnerCatalog(ctx, "kubernetes", "cluster")
	require.NoError(t, err)
	require.Equal(t, inherited, catalog.Definitions[0])
	_, err = c.SaveMetricDefinition(ctx, "kubernetes", "cluster", *saved)
	require.Equal(t, "CONFLICT", resourcev2.ErrorCode(err))
	_, err = c.SaveMetricDefinition(ctx, "kubernetes", "cluster", draft)
	require.NoError(t, err)
}
