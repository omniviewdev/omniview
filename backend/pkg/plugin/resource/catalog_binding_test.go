package resource

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
)

// Override mock framing so these tests exercise exact SDK tokens, including
// deliberately invalid revisions, without a fixture repairing the input.
type bindingTestProvider struct {
	*mockProvider
	catalog func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error)
}

func (p *bindingTestProvider) Catalog(ctx context.Context, request resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
	return p.catalog(ctx, request)
}

func bindingTestEpoch(t *testing.T) string {
	t.Helper()
	epoch, err := resourcev2.NewCatalogBindingEpoch()
	require.NoError(t, err)
	return epoch
}

func bindingTestCatalog(t *testing.T, epoch, revision, hint string) resourcev2.Catalog {
	t.Helper()
	catalog := epochTestCatalog(hint)
	var err error
	catalog.Revision, err = resourcev2.BindCatalogRevision(epoch, revision)
	require.NoError(t, err)
	return catalog
}

type bindingInventoryProvider struct {
	*bindingTestProvider
	status types.ConnectionStatus
}

func (p *bindingInventoryProvider) GetConnectionStatus(context.Context, string) (types.ConnectionStatus, error) {
	return p.status, nil
}

func TestCatalogBindingConnectPreservesConfiguredInventory(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	ctx := testInvocationContext()
	connection := types.Connection{ID: "binding-route", Name: "Configured cluster"}
	catalog := bindingTestCatalog(t, bindingTestEpoch(t), "native", "hintA")
	provider := &bindingInventoryProvider{
		bindingTestProvider: &bindingTestProvider{
			mockProvider: &mockProvider{},
			catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
				return catalog, nil
			},
		},
		status: types.ConnectionStatus{Status: types.ConnectionStatusDisconnected},
	}
	provider.LoadConnectionsFunc = func(context.Context) ([]types.Connection, error) {
		return []types.Connection{connection}, nil
	}
	provider.GetWatchStateFunc = func(_ context.Context, route resourcev2.AccessRoute) (*resourcev2.WatchConnectionSummary, error) {
		return &resourcev2.WatchConnectionSummary{
			Route: route, Resources: map[string]resourcev2.WatchState{},
			ResourceCounts: map[string]resourcev2.Count{}, Scope: resourcev2.QueryScope{},
			Guarantee: resourcev2.BestEffortGuarantee,
		}, nil
	}
	provider.StartConnectionFunc = func(context.Context, string) (types.ConnectionStatus, error) {
		catalog = bindingTestCatalog(t, bindingTestEpoch(t), "native", "hintB")
		provider.status = types.ConnectionStatus{Status: types.ConnectionStatusConnected, Connection: &connection}
		return provider.status, nil
	}
	registerMockPlugin(ctrl, "p1", provider)
	_, err := ctrl.LoadConnections(ctx, "p1")
	require.NoError(t, err)
	states, err := ctrl.GetAllConnectionStates(ctx)
	require.NoError(t, err)
	require.Len(t, states["p1"], 1)
	require.Equal(t, types.ConnectionStatusDisconnected, states["p1"][0].Readiness)
	old, err := ctrl.ResolveTarget(ctx, "p1", bindingTestRequest())
	require.NoError(t, err)

	status, err := ctrl.StartConnection(ctx, "p1", connection.ID)
	require.NoError(t, err)
	require.Equal(t, types.ConnectionStatusConnected, status.Status)
	require.NotZero(t, ctrl.plugins["p1"].sourceEpoch[connection.ID], "Connect bootstrap must exercise native binding retirement")
	configured, err := ctrl.GetConnection(ctx, "p1", connection.ID)
	require.NoError(t, err)
	require.Equal(t, connection.Name, configured.Name)
	all, err := ctrl.ListAllConnections(ctx)
	require.NoError(t, err)
	require.Len(t, all["p1"], 1)
	states, err = ctrl.GetAllConnectionStates(ctx)
	require.NoError(t, err)
	require.Len(t, states["p1"], 1)
	require.Equal(t, connection.Name, states["p1"][0].Connection.Name)
	require.Equal(t, types.ConnectionStatusConnected, states["p1"][0].Readiness)
	fresh, err := ctrl.ResolveTarget(ctx, "p1", bindingTestRequest())
	require.NoError(t, err)
	require.NotEqual(t, old.Target.Authority, fresh.Target.Authority, "configured metadata must not preserve retired authority")

	provider.status = types.ConnectionStatus{Status: types.ConnectionStatusDisconnected}
	states, err = ctrl.GetAllConnectionStates(ctx)
	require.NoError(t, err)
	require.Len(t, states["p1"], 1)
	require.Equal(t, types.ConnectionStatusDisconnected, states["p1"][0].Readiness)
}

func bindingTestRequest() ResolveTargetRequest {
	return ResolveTargetRequest{Route: resourcev2.AccessRoute{Connection: "binding-route"}, Type: "objects", Representation: "native"}
}

func TestCatalogBindingMetadataChurnPreservesAuthority(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	epoch := bindingTestEpoch(t)
	catalog := bindingTestCatalog(t, epoch, "native-1", "hintA")
	registerMockPlugin(ctrl, "p1", &bindingTestProvider{mockProvider: &mockProvider{}, catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }})
	request := bindingTestRequest()
	first, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	disk := authorityDiskBytes(t, ctrl)
	catalog = bindingTestCatalog(t, epoch, "native-2-CRD-added", "hintA")
	other := catalog.Types[0]
	other.Type = "new-crd"
	catalog.Types = append(catalog.Types, other)
	second, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	require.Equal(t, first.Target.Authority, second.Target.Authority)
	require.NotEqual(t, first.CatalogRevision, second.CatalogRevision)
	require.Equal(t, uint64(0), ctrl.plugins["p1"].sourceEpoch[request.Route.Connection])
	// Removing the CRD still must not retire the existing type.
	catalog = bindingTestCatalog(t, epoch, "native-3-CRD-removed", "hintA")
	third, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	require.Equal(t, first.Target.Authority, third.Target.Authority)
	requireCurrentAuthoritySurvivesRestart(t, ctrl, request.Route, catalog, third.Target.Authority, authorityDiskBytes(t, ctrl))
	require.NotEmpty(t, disk)
}

func TestCatalogBindingAppliedBeforeGetRejectsOldAuthority(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalog := bindingTestCatalog(t, bindingTestEpoch(t), "native", "hintA")
	var gets atomic.Int32
	provider := &bindingTestProvider{mockProvider: &mockProvider{GetFunc: func(context.Context, resourcev2.GetRequest) (resourcev2.Record, error) {
		gets.Add(1)
		t.Fatal("old authority must not reach native Get after source replacement")
		return resourcev2.Record{}, nil
	}}, catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }}
	registerMockPlugin(ctrl, "p1", provider)
	request := bindingTestRequest()
	old, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	// Native B is already active, but the host has not observed B yet.
	catalog = bindingTestCatalog(t, bindingTestEpoch(t), "native", "hintA")
	_, err = ctrl.Get(testInvocationContext(), "p1", HostGetRequest{TargetID: old.TargetID, Request: resourcev2.GetRequest{
		Route: request.Route, Representation: "native", Reference: canonicalTestRecord(old.Target.Provider, old.Target.Authority, request.Type, "id").Reference,
	}})
	require.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code)
	require.Zero(t, gets.Load())
	require.Empty(t, ctrl.registryStore.ScanByResourceKey("p1", request.Route.Connection, request.Type))
	fresh, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	require.NotEqual(t, old.Target.Authority, fresh.Target.Authority)
}

func TestCatalogBindingBlockedOldCatalogCannotRevertNewBinding(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	a := bindingTestCatalog(t, bindingTestEpoch(t), "nativeA", "hintA")
	b := bindingTestCatalog(t, bindingTestEpoch(t), "nativeB", "hintA")
	var current atomic.Pointer[resourcev2.Catalog]
	current.Store(&a)
	entered, release := make(chan struct{}), make(chan struct{})
	var unblock sync.Once
	defer unblock.Do(func() { close(release) })
	var block atomic.Bool
	registerMockPlugin(ctrl, "p1", &bindingTestProvider{mockProvider: &mockProvider{}, catalog: func(ctx context.Context, _ resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		captured := *current.Load()
		if block.CompareAndSwap(true, false) {
			close(entered)
			select {
			case <-release:
			case <-ctx.Done():
				return resourcev2.Catalog{}, ctx.Err()
			}
		}
		return captured, nil
	}})
	request := bindingTestRequest()
	_, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	block.Store(true)
	finished := make(chan error, 1)
	go func() { _, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request); finished <- err }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("catalog did not block")
	}
	current.Store(&b)
	_, err = ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code)
	fresh, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	disk := authorityDiskBytes(t, ctrl)
	unblock.Do(func() { close(release) })
	select {
	case err := <-finished:
		require.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code)
	case <-time.After(time.Second):
		t.Fatal("stale catalog did not return")
	}
	binding, err := resourcev2.CatalogBindingEpoch(b.Revision)
	require.NoError(t, err)
	require.Equal(t, binding, ctrl.plugins["p1"].catalogBindings[request.Route.Connection].active)
	requireCurrentAuthoritySurvivesRestart(t, ctrl, request.Route, b, fresh.Target.Authority, disk)
}

func TestCatalogBindingUniqueReturnAndRetiredEpochRejection(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	a := bindingTestCatalog(t, bindingTestEpoch(t), "nativeA", "hintA")
	catalog := a
	registerMockPlugin(ctrl, "p1", &bindingTestProvider{mockProvider: &mockProvider{}, catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }})
	request := bindingTestRequest()
	first, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	authorities := []string{first.Target.Authority}
	for _, native := range []string{"nativeB", "nativeA"} {
		catalog = bindingTestCatalog(t, bindingTestEpoch(t), native, "hintA")
		_, err = ctrl.ResolveTarget(testInvocationContext(), "p1", request)
		require.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code)
		fresh, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request)
		require.NoError(t, err)
		for _, previous := range authorities {
			require.NotEqual(t, previous, fresh.Target.Authority)
		}
		authorities = append(authorities, fresh.Target.Authority)
	}
	current := catalog
	disk := authorityDiskBytes(t, ctrl)
	catalog = a
	_, err = ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code)
	requireCurrentAuthoritySurvivesRestart(t, ctrl, request.Route, current, authorities[2], disk)
}

func TestCatalogBindingInvalidRevisionFailsClosed(t *testing.T) {
	for _, revision := range []string{"", "native-revision", "ovc1.invalid.invalid"} {
		t.Run(fmt.Sprintf("revision=%q", revision), func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			catalog := epochTestCatalog("hintA")
			catalog.Revision = revision
			registerMockPlugin(ctrl, "p1", &bindingTestProvider{mockProvider: &mockProvider{}, catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }})
			route := bindingTestRequest().Route
			generation := ctrl.plugins["p1"]
			err := ctrl.observeCatalogBinding(testInvocationContext(), "p1", route, catalog, catalogAdmission{generation: generation, epoch: sourceEpochSnapshot{Connection: route.Connection}})
			require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
			require.Empty(t, generation.catalogBindings)
			require.Empty(t, ctrl.finite.authorities)
		})
	}
}

func TestCatalogBindingRetiredProofLimitNeverEvicts(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalog := bindingTestCatalog(t, bindingTestEpoch(t), "nativeA", "hintA")
	registerMockPlugin(ctrl, "p1", &bindingTestProvider{mockProvider: &mockProvider{}, catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }})
	request := bindingTestRequest()
	_, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	generation := ctrl.plugins["p1"]
	state := generation.catalogBindings[request.Route.Connection]
	state.retired = make(map[string]struct{}, maxAuthorityBindings-1)
	for i := range maxAuthorityBindings - 1 {
		state.retired[fmt.Sprintf("retired-%d", i)] = struct{}{}
	}
	generation.catalogBindings[request.Route.Connection] = state
	disk := authorityDiskBytes(t, ctrl)
	catalog = bindingTestCatalog(t, bindingTestEpoch(t), "nativeB", "hintA")
	_, err = ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.Equal(t, "RESOURCE_LIMIT", requireAppError(t, err).Code)
	after := generation.catalogBindings[request.Route.Connection]
	require.Equal(t, state.active, after.active)
	require.Len(t, after.retired, maxAuthorityBindings-1)
	require.Equal(t, disk, authorityDiskBytes(t, ctrl))
	require.Zero(t, generation.sourceEpoch[request.Route.Connection])
}

func TestCatalogBindingExplicitAdmissionEpochRejectsLateObservation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	a := bindingTestCatalog(t, bindingTestEpoch(t), "nativeA", "hintA")
	catalog := a
	registerMockPlugin(ctrl, "p1", &bindingTestProvider{mockProvider: &mockProvider{}, catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }})
	request := bindingTestRequest()
	_, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	admission, stale, err := ctrl.routeCatalog(testInvocationContext(), "p1", request.Route)
	require.NoError(t, err)
	catalog = bindingTestCatalog(t, bindingTestEpoch(t), "nativeB", "hintA")
	_, err = ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code)
	fresh, err := ctrl.ResolveTarget(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	disk := authorityDiskBytes(t, ctrl)
	// This caller has no sourceEpochKey: only the explicit captured admission
	// can prevent an observation from reacquiring the current route epoch.
	err = ctrl.observeCatalogBinding(testInvocationContext(), "p1", request.Route, stale, admission)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	requireCurrentAuthoritySurvivesRestart(t, ctrl, request.Route, catalog, fresh.Target.Authority, disk)
}

func TestCatalogBindingChangingSourceRejectsObservation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalog := bindingTestCatalog(t, bindingTestEpoch(t), "nativeA", "hintA")
	registerMockPlugin(ctrl, "p1", &bindingTestProvider{mockProvider: &mockProvider{}, catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }})
	request := bindingTestRequest()
	generation := ctrl.plugins["p1"]
	generation.sourceChanging = map[string]bool{request.Route.Connection: true}
	err := ctrl.observeCatalogBinding(testInvocationContext(), "p1", request.Route, catalog, catalogAdmission{generation: generation, epoch: sourceEpochSnapshot{Connection: request.Route.Connection}})
	require.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(err))
	require.Empty(t, generation.catalogBindings)
	require.Empty(t, ctrl.finite.authorities)
	require.Empty(t, generation.sourceEpoch)
}

func TestCatalogBindingRestartRetiresUnprovenPersistedAuthorities(t *testing.T) {
	for _, continuity := range []string{"unknown", resourcev2.ContinuityConnectionLocal, resourcev2.ContinuityStableNative} {
		t.Run(continuity, func(t *testing.T) {
			before, _ := newTestControllerWithEmitter(t)
			catalog := bindingTestCatalog(t, bindingTestEpoch(t), "nativeA", "hintA")
			if continuity == "unknown" {
				catalog.Types[0].NativeAuthorityHint = nil
			} else {
				catalog.Types[0].NativeAuthorityHint.Continuity = continuity
			}
			absent := catalog.Types[0]
			absent.Type = "absent-after-restart"
			catalog.Types = append(catalog.Types, absent)
			provider := &bindingTestProvider{mockProvider: &mockProvider{}, catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil }}
			registerMockPlugin(before, "p1", provider)
			request := bindingTestRequest()
			old, err := before.ResolveTarget(testInvocationContext(), "p1", request)
			require.NoError(t, err)
			missingRequest := request
			missingRequest.Type = absent.Type
			missing, err := before.ResolveTarget(testInvocationContext(), "p1", missingRequest)
			require.NoError(t, err)

			// A new controller uses the actual prior authority store, but no
			// source binding admission state survives the process restart.
			after, _ := newTestControllerWithEmitter(t)
			after.pluginStoreFn = before.pluginStoreFn
			catalog.Types = catalog.Types[:1]
			if continuity == "unknown" {
				// Actual source B replaced A while the host was stopped.
				catalog.Revision, err = resourcev2.BindCatalogRevision(bindingTestEpoch(t), "nativeB")
				require.NoError(t, err)
			}
			var gets atomic.Int32
			provider.mockProvider.GetFunc = func(context.Context, resourcev2.GetRequest) (resourcev2.Record, error) {
				gets.Add(1)
				return resourcev2.Record{}, nil
			}
			registerMockPlugin(after, "p1", provider)
			_, err = after.Get(testInvocationContext(), "p1", HostGetRequest{TargetID: old.TargetID, Request: resourcev2.GetRequest{
				Route: request.Route, Representation: "native", Reference: canonicalTestRecord(old.Target.Provider, old.Target.Authority, request.Type, "id").Reference,
			}})
			require.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code)
			require.Zero(t, gets.Load())
			require.Empty(t, after.registryStore.ScanByResourceKey("p1", request.Route.Connection, request.Type))
			resolver := after.finite.authorities["p1"]
			require.NotNil(t, resolver)
			require.False(t, resolver.Matches("p1", request.Route.Connection, old.Target.Provider, absent.Type, missing.Target.Authority), "restart must retire even types absent from the new catalog")
			fresh, err := after.ResolveTarget(testInvocationContext(), "p1", request)
			require.NoError(t, err)
			require.NotEqual(t, old.Target.Authority, fresh.Target.Authority, "neither unchanged connectionLocal nor a provider stableNative claim proves restart continuity")
			require.Equal(t, resourcev2.ContinuityConnectionLocal, fresh.Authority.Continuity)
		})
	}
}
