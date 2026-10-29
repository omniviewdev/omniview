package resource

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// ============================================================================
// StartConnectionWatch
// ============================================================================

func TestStartConnectionWatch_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{CatalogFunc: lifecycleTestCatalog("pods"), StartConnectionWatchFunc: func(_ context.Context, targets []resource.ReadTarget) error {
		require.NotEmpty(t, targets)
		assert.Equal(t, "conn-1", targets[0].Route.Connection)
		return nil
	}}
	registerMockPlugin(ctrl, "p1", mock)

	err := ctrl.StartConnectionWatch(testInvocationContext(), "p1", []resource.ReadTarget{admittedReadTarget(t, ctrl, "p1", "conn-1", "pods").Target})
	require.NoError(t, err)
}

func TestStartConnectionWatch_BatchesSameAdmittedRouteCatalog(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalogFor := lifecycleTestCatalog("pods")
	calls := 0
	provider := &mockProvider{
		CatalogFunc: func(ctx context.Context, request resource.CatalogRequest) (resource.Catalog, error) {
			catalog, err := catalogFor(ctx, request)
			catalog.Revision = request.Route.Connection
			return catalog, err
		},
		StartConnectionWatchFunc: func(ctx context.Context, targets []resource.ReadTarget) error {
			calls++
			require.Len(t, targets, 2)
			_, ok := resource.CatalogRevisionFromContext(ctx)
			require.True(t, ok)
			require.NoError(t, ctx.Err())
			return nil
		},
	}
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "pods").Target
	require.NoError(t, ctrl.StartConnectionWatch(testInvocationContext(), "p1", []resource.ReadTarget{target, target}))
	require.Equal(t, 1, calls)
}

func TestStartConnectionWatch_DoesNotMergeDistinctAcceptedRevisions(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalogFor := lifecycleTestCatalog("pods")
	revision := "initial"
	var observed []string
	provider := &mockProvider{
		CatalogFunc: func(ctx context.Context, request resource.CatalogRequest) (resource.Catalog, error) {
			catalog, err := catalogFor(ctx, request)
			catalog.Revision = revision
			revision += "/next"
			return catalog, err
		},
		StartConnectionWatchFunc: func(ctx context.Context, targets []resource.ReadTarget) error {
			require.Len(t, targets, 1)
			accepted, ok := resource.CatalogRevisionFromContext(ctx)
			require.True(t, ok)
			observed = append(observed, accepted)
			return nil
		},
	}
	registerMockPlugin(ctrl, "p1", provider)
	target := admittedReadTarget(t, ctrl, "p1", "conn-1", "pods").Target
	revision = "accepted"
	require.NoError(t, ctrl.StartConnectionWatch(testInvocationContext(), "p1", []resource.ReadTarget{target, target}))
	require.Len(t, observed, 2)
	require.NotEqual(t, observed[0], observed[1])
}

func TestStartConnectionWatch_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{CatalogFunc: lifecycleTestCatalog("pods"), StartConnectionWatchFunc: func(_ context.Context, _ []resource.ReadTarget) error {
		return errors.New("watch start failed")
	}}
	registerMockPlugin(ctrl, "p1", mock)

	err := ctrl.StartConnectionWatch(testInvocationContext(), "p1", []resource.ReadTarget{admittedReadTarget(t, ctrl, "p1", "conn-1", "pods").Target})
	assert.Error(t, err)
}

// ============================================================================
// StopConnectionWatch
// ============================================================================

func TestStopConnectionWatch_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: lifecycleTestCatalog("pods")})

	err := ctrl.StopConnectionWatch(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"})
	require.NoError(t, err)
}

func TestStopConnectionWatch_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{CatalogFunc: lifecycleTestCatalog("pods"), StopConnectionWatchFunc: func(_ context.Context, _ resource.AccessRoute) error {
		return errors.New("stop failed")
	}}
	registerMockPlugin(ctrl, "p1", mock)

	err := ctrl.StopConnectionWatch(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"})
	assert.Error(t, err)
}

// ============================================================================
// GetWatchState
// ============================================================================

func TestGetWatchState_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{CatalogFunc: lifecycleTestCatalog("pods"), GetWatchStateFunc: func(_ context.Context, route resource.AccessRoute) (*resource.WatchConnectionSummary, error) {
		return &resource.WatchConnectionSummary{
			Route:          route,
			Resources:      map[string]resource.WatchState{"pods": resource.WatchStateSynced},
			ResourceCounts: map[string]resource.Count{"pods": {Kind: "unknown"}},
			Scope:          resource.QueryScope{},
			Guarantee:      resource.BestEffortGuarantee,
		}, nil
	}}
	registerMockPlugin(ctrl, "p1", mock)

	ws, err := ctrl.GetWatchState(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"})
	require.NoError(t, err)
	assert.Equal(t, "conn-1", ws.Route.Connection)
	assert.Equal(t, resource.WatchStateSynced, ws.Resources["pods"])
	assert.Equal(t, resource.Count{Kind: "unknown"}, ws.ResourceCounts["pods"])
	assert.Equal(t, resource.BestEffortGuarantee, ws.Guarantee)
}

func TestGetWatchState_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{CatalogFunc: lifecycleTestCatalog("pods"), GetWatchStateFunc: func(_ context.Context, _ resource.AccessRoute) (*resource.WatchConnectionSummary, error) {
		return nil, errors.New("state error")
	}}
	registerMockPlugin(ctrl, "p1", mock)

	_, err := ctrl.GetWatchState(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"})
	assert.Error(t, err)
}

func TestGetWatchState_PreservesExactNativeCount(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	count := "9007199254740993"
	registerMockPlugin(ctrl, "p1", &mockProvider{
		CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
			catalog := canonicalTestCatalog("updates", "pods")
			catalog.Types[0].Capabilities = []resource.Capability{{Operation: resource.OperationUpdate, Scope: resource.QueryScope{}, Guarantee: resource.BestEffortGuarantee}}
			return catalog, nil
		},
		GetWatchStateFunc: func(_ context.Context, route resource.AccessRoute) (*resource.WatchConnectionSummary, error) {
			return &resource.WatchConnectionSummary{
				Route: route, Resources: map[string]resource.WatchState{"pods": resource.WatchStateSynced},
				ResourceCounts: map[string]resource.Count{"pods": {Kind: "exact", Value: &count}},
				Scope:          resource.QueryScope{}, Guarantee: resource.BestEffortGuarantee,
			}, nil
		},
	})
	state, err := ctrl.GetWatchState(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"})
	require.NoError(t, err)
	require.Equal(t, "exact", state.ResourceCounts["pods"].Kind)
	require.NotNil(t, state.ResourceCounts["pods"].Value)
	require.Equal(t, count, *state.ResourceCounts["pods"].Value)
}

// ============================================================================
// EnsureResourceWatch
// ============================================================================

func TestEnsureResourceWatch_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: lifecycleTestCatalog("pods")})

	err := ctrl.EnsureResourceWatch(testInvocationContext(), "p1", admittedReadTarget(t, ctrl, "p1", "conn-1", "pods").Target)
	require.NoError(t, err)
}

func TestEnsureResourceWatch_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{CatalogFunc: lifecycleTestCatalog("pods"), EnsureResourceWatchFunc: func(_ context.Context, _ resource.ReadTarget) error {
		return errors.New("ensure failed")
	}}
	registerMockPlugin(ctrl, "p1", mock)

	err := ctrl.EnsureResourceWatch(testInvocationContext(), "p1", admittedReadTarget(t, ctrl, "p1", "conn-1", "pods").Target)
	assert.Error(t, err)
}

// ============================================================================
// StopResourceWatch
// ============================================================================

func TestStopResourceWatch_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: lifecycleTestCatalog("pods")})

	err := ctrl.StopResourceWatch(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"}, "pods")
	require.NoError(t, err)
}

// ============================================================================
// RestartResourceWatch
// ============================================================================

func TestRestartResourceWatch_Success(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: lifecycleTestCatalog("pods")})

	err := ctrl.RestartResourceWatch(testInvocationContext(), "p1", admittedReadTarget(t, ctrl, "p1", "conn-1", "pods").Target)
	require.NoError(t, err)
}

// ============================================================================
// IsResourceWatchRunning
// ============================================================================

func TestIsResourceWatchRunning_True(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{CatalogFunc: lifecycleTestCatalog("pods"), IsResourceWatchRunningFunc: func(_ context.Context, _ resource.AccessRoute, _ string) (bool, error) {
		return true, nil
	}}
	registerMockPlugin(ctrl, "p1", mock)

	running, err := ctrl.IsResourceWatchRunning(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"}, "pods")
	require.NoError(t, err)
	assert.True(t, running)
}

func TestIsResourceWatchRunning_False(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: lifecycleTestCatalog("pods")})

	running, err := ctrl.IsResourceWatchRunning(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"}, "pods")
	require.NoError(t, err)
	assert.False(t, running)
}

func TestIsResourceWatchRunning_ProviderError(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	mock := &mockProvider{CatalogFunc: lifecycleTestCatalog("pods"), IsResourceWatchRunningFunc: func(_ context.Context, _ resource.AccessRoute, _ string) (bool, error) {
		return false, errors.New("check failed")
	}}
	registerMockPlugin(ctrl, "p1", mock)

	running, err := ctrl.IsResourceWatchRunning(testInvocationContext(), "p1", resource.AccessRoute{Connection: "conn-1"}, "pods")
	require.Error(t, err)
	assert.False(t, running)
}

func TestCatalogOnlyWatchOperationsAreExplicitlyUnsupported(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "catalog-only", &catalogOnlyProvider{CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
		catalog := canonicalTestCatalog("proof", "pods")
		catalog.Types[0].Capabilities = nil
		return catalog, nil
	}})
	target := admittedReadTarget(t, ctrl, "catalog-only", "explicit", "pods").Target
	for name, call := range map[string]func() error{
		"start": func() error {
			return ctrl.StartConnectionWatch(testInvocationContext(), "catalog-only", []resource.ReadTarget{target})
		},
		"stop": func() error { return ctrl.StopConnectionWatch(testInvocationContext(), "catalog-only", target.Route) },
		"state": func() error {
			_, err := ctrl.GetWatchState(testInvocationContext(), "catalog-only", target.Route)
			return err
		},
		"ensure": func() error { return ctrl.EnsureResourceWatch(testInvocationContext(), "catalog-only", target) },
		"stop-resource": func() error {
			return ctrl.StopResourceWatch(testInvocationContext(), "catalog-only", target.Route, target.Type)
		},
		"restart": func() error { return ctrl.RestartResourceWatch(testInvocationContext(), "catalog-only", target) },
		"running": func() error {
			_, err := ctrl.IsResourceWatchRunning(testInvocationContext(), "catalog-only", target.Route, target.Type)
			return err
		},
	} {
		t.Run(name, func(t *testing.T) { require.Equal(t, "UNSUPPORTED", requireAppError(t, call()).Code) })
	}
}

func TestGetWatchStateUsesNativeCatalogAdmissionWithoutGetPermission(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	called := make(chan struct{}, 1)
	provider := &mockProvider{
		CatalogFunc: func(context.Context, resource.CatalogRequest) (resource.Catalog, error) {
			catalog := canonicalTestCatalog("updates-only", "objects")
			catalog.Types[0].Capabilities = []resource.Capability{{Operation: resource.OperationUpdate, Scope: resource.QueryScope{}, Guarantee: resource.BestEffortGuarantee}}
			return catalog, nil
		},
		GetFunc: func(context.Context, resource.GetRequest) (resource.Record, error) {
			t.Error("watch state must not acquire Get")
			return resource.Record{}, errors.New("unexpected Get")
		},
		GetWatchStateFunc: func(_ context.Context, route resource.AccessRoute) (*resource.WatchConnectionSummary, error) {
			called <- struct{}{}
			return &resource.WatchConnectionSummary{Route: route, Resources: map[string]resource.WatchState{"objects": resource.WatchStateSynced}, ResourceCounts: map[string]resource.Count{"objects": {Kind: "unknown"}}, Scope: resource.QueryScope{}, Guarantee: resource.BestEffortGuarantee}, nil
		},
	}
	registerMockPlugin(ctrl, "updates", setupGRPCProvider(t, provider))
	summary, err := ctrl.GetWatchState(testInvocationContext(), "updates", resource.AccessRoute{Connection: "explicit"})
	require.NoError(t, err)
	require.Equal(t, resource.WatchStateSynced, summary.Resources["objects"])
	select {
	case <-called:
	default:
		t.Fatal("native state admission never reached provider")
	}
}
