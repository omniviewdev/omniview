package resource

import (
	"context"
	"sync"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func admissionTestCatalog(t *testing.T, backing string) resourcev2.Catalog {
	t.Helper()
	catalog := canonicalTestCatalog("native", "objects")
	catalog.Types = append(catalog.Types, canonicalTestCatalog("native", "peers").Types[0])
	for i := range catalog.Types {
		catalog.Types[i].DefaultRepresentation = "native"
		catalog.Types[i].NativeAuthorityHint = &resourcev2.NativeAuthorityHint{Scheme: "fixture/native-identity/v1", ID: backing + "/" + catalog.Types[i].Type, Continuity: resourcev2.ContinuityConnectionLocal}
	}
	var err error
	catalog.Revision, err = resourcev2.BindCatalogRevision(bindingTestEpoch(t), backing)
	require.NoError(t, err)
	return catalog
}

func TestConnectionAdmissionPinsCompleteCatalogWithoutRelationships(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalog := admissionTestCatalog(t, "accepted")
	catalogCalls, declarationCalls := 0, 0
	registerMockPlugin(ctrl, "p1", &mockProvider{
		CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
			catalogCalls++
			return catalog, nil
		},
		GetRelationshipsFunc: func(context.Context, resourcev2.AccessRoute, string) ([]resourcev2.RelationshipDescriptor, error) {
			declarationCalls++
			return nil, resourcev2.NewError("UNAVAILABLE", "unrequested")
		},
	})
	route := resourcev2.AccessRoute{Connection: "opaque/route"}
	admission, observed, err := ctrl.admitConnectionCatalog(testInvocationContext(), "p1", route)
	require.NoError(t, err)
	require.Equal(t, catalog.Revision, observed.Revision)
	require.Equal(t, 1, catalogCalls)
	require.Zero(t, declarationCalls)
	for _, descriptor := range catalog.Types {
		authority, err := ctrl.resolveAuthority(testInvocationContext(), "p1", route, observed, admission, descriptor.Type)
		require.NoError(t, err)
		require.NotEmpty(t, authority.Authority)
	}
}

func TestConnectionAdmissionReacquiresOnlyItsNativeRetirement(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalog := admissionTestCatalog(t, "before")
	calls := 0
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		calls++
		return catalog, nil
	}})
	route := resourcev2.AccessRoute{Connection: "opaque/route"}
	before, oldCatalog, err := ctrl.admitConnectionCatalog(testInvocationContext(), "p1", route)
	require.NoError(t, err)
	old, err := ctrl.resolveAuthority(testInvocationContext(), "p1", route, oldCatalog, before, "objects")
	require.NoError(t, err)
	catalog = admissionTestCatalog(t, "after")
	after, currentCatalog, err := ctrl.admitConnectionCatalog(testInvocationContext(), "p1", route)
	require.NoError(t, err)
	current, err := ctrl.resolveAuthority(testInvocationContext(), "p1", route, currentCatalog, after, "objects")
	require.NoError(t, err)
	require.Greater(t, after.epoch.Epoch, before.epoch.Epoch)
	require.NotEqual(t, old.Authority, current.Authority)
	require.Equal(t, 3, calls, "one bounded reacquisition, no optional declaration or inventory work")
	require.False(t, ctrl.finite.authorities["p1"].Matches("p1", route.Connection, oldCatalog.Provider, "objects", old.Authority))
}

func TestConnectionAdmissionReacquisitionCannotCrossProfileReset(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalog := admissionTestCatalog(t, "before")
	calls := 0
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		calls++
		return catalog, nil
	}})
	route := resourcev2.AccessRoute{Connection: "opaque/route"}
	_, _, err := ctrl.admitConnectionCatalog(testInvocationContext(), "p1", route)
	require.NoError(t, err)
	_, generation, ctx, cleanup, err := ctrl.operationGeneration(testInvocationContext(), "p1", route)
	require.NoError(t, err)
	defer cleanup()
	admission := captureCatalogAdmission(ctx, generation)
	catalog = admissionTestCatalog(t, "after")
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(ctrl.observeCatalogBinding(ctx, "p1", route, catalog, admission)))
	expected := catalogAdmission{generation: generation, epoch: sourceEpochSnapshot{Connection: route.Connection, Epoch: admission.epoch.Epoch + 1}}
	ctrl.pluginsMu.Lock()
	err = ctrl.invalidateSourceRoutesLocked("p1", []string{route.Connection}, false)
	ctrl.pluginsMu.Unlock()
	require.NoError(t, err)
	before := calls
	_, _, err = ctrl.admitConnectionCatalogCurrent(ctx, "p1", route, false, &expected)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	require.Equal(t, before, calls, "stale expected epoch must fail before another catalog call")
	fresh, _, err := ctrl.admitConnectionCatalog(testInvocationContext(), "p1", route)
	require.NoError(t, err)
	require.Greater(t, fresh.epoch.Epoch, expected.epoch.Epoch)
}

func TestBlockedConnectionAdmissionCannotRetireReplacement(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	before, after := admissionTestCatalog(t, "before"), admissionTestCatalog(t, "after")
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	defer once.Do(func() { close(release) })
	var mu sync.Mutex
	calls := 0
	registerMockPlugin(ctrl, "p1", &mockProvider{CatalogFunc: func(ctx context.Context, _ resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		mu.Lock()
		calls++
		first := calls == 1
		mu.Unlock()
		if first {
			close(entered)
			select {
			case <-release:
			case <-ctx.Done():
				return resourcev2.Catalog{}, ctx.Err()
			}
			return before, nil
		}
		return after, nil
	}})
	route := resourcev2.AccessRoute{Connection: "opaque/route"}
	done := make(chan error, 1)
	go func() { _, _, err := ctrl.admitConnectionCatalog(testInvocationContext(), "p1", route); done <- err }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("required catalog barrier not reached")
	}
	require.NoError(t, ctrl.invalidateProfileRoutes("p1", []string{route.Connection}))
	admission, catalog, err := ctrl.admitConnectionCatalog(testInvocationContext(), "p1", route)
	require.NoError(t, err)
	current, err := ctrl.resolveAuthority(testInvocationContext(), "p1", route, catalog, admission, "objects")
	require.NoError(t, err)
	disk := authorityDiskBytes(t, ctrl)
	once.Do(func() { close(release) })
	select {
	case err := <-done:
		require.Error(t, err)
	case <-time.After(time.Second):
		t.Fatal("stale admission did not return")
	}
	requireCurrentAuthoritySurvivesRestart(t, ctrl, route, catalog, current.Authority, disk)
}
