package resource

import (
	"context"
	"io"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func epochTestCatalog(backing string) resourcev2.Catalog {
	catalog := canonicalTestCatalog("native", "objects")
	catalog.Types[0].NativeAuthorityHint = &resourcev2.NativeAuthorityHint{Scheme: "fixture/native-identity/v1", ID: backing, Continuity: resourcev2.ContinuityConnectionLocal}
	return catalog
}

func authorityDiskBytes(t *testing.T, ctrl *controller) []byte {
	t.Helper()
	root, err := ctrl.pluginStoreFn("p1")
	require.NoError(t, err)
	file, err := root.OpenFile(authorityStoreName, os.O_RDONLY, 0)
	require.NoError(t, err)
	defer file.Close()
	data, err := io.ReadAll(file)
	require.NoError(t, err)
	return data
}

func requireCurrentAuthoritySurvivesRestart(t *testing.T, ctrl *controller, route resourcev2.AccessRoute, catalog resourcev2.Catalog, authority string, disk []byte) {
	t.Helper()
	require.Equal(t, disk, authorityDiskBytes(t, ctrl), "stale catalog must not touch durable authority state")
	root, err := ctrl.pluginStoreFn("p1")
	require.NoError(t, err)
	restarted, err := NewAuthorityResolver(root)
	require.NoError(t, err)
	assignments, err := restarted.ObserveCatalog("p1", route.Connection, catalog)
	require.NoError(t, err)
	require.Equal(t, authority, assignments["objects"].Authority, "restart must retain the new backing authority")
}

func TestCapturedRouteCatalogEpochFencesAuthorityPersistence(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	oldCatalog, newCatalog := bindingTestCatalog(t, bindingTestEpoch(t), "observation", "A"), bindingTestCatalog(t, bindingTestEpoch(t), "observation", "B")
	var current atomic.Pointer[resourcev2.Catalog]
	current.Store(&oldCatalog)
	registerMockPlugin(ctrl, "p1", &catalogOnlyProvider{CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		return *current.Load(), nil
	}})
	ctx := testInvocationContext()
	route := resourcev2.AccessRoute{Connection: "route/opaque"}
	admission, staleCatalog, err := ctrl.routeCatalog(ctx, "p1", route)
	require.NoError(t, err)

	current.Store(&newCatalog)
	require.NoError(t, ctrl.invalidateProfileRoutes("p1", []string{route.Connection}))
	fresh, err := ctrl.ResolveTarget(ctx, "p1", ResolveTargetRequest{Route: route, Type: "objects", Representation: "native"})
	require.NoError(t, err)
	disk := authorityDiskBytes(t, ctrl)

	_, err = ctrl.resolveAuthority(ctx, "p1", route, staleCatalog, admission, "objects")
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	requireCurrentAuthoritySurvivesRestart(t, ctrl, route, newCatalog, fresh.Target.Authority, disk)
}

func TestResolveReferenceStaleCatalogCannotPolluteNewRouteAuthority(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	oldCatalog, newCatalog := bindingTestCatalog(t, bindingTestEpoch(t), "observation", "A"), bindingTestCatalog(t, bindingTestEpoch(t), "observation", "B")
	entered, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	var calls atomic.Int32
	registerMockPlugin(ctrl, "p1", &catalogOnlyProvider{CatalogFunc: func(ctx context.Context, _ resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		if calls.Add(1) == 1 {
			close(entered)
			select {
			case <-release:
				return oldCatalog, nil
			case <-ctx.Done():
				return resourcev2.Catalog{}, ctx.Err()
			}
		}
		return newCatalog, nil
	}})
	route := resourcev2.AccessRoute{Connection: "route/opaque"}
	input := ResolveReferenceRequest{Route: route, Type: "objects", Scope: []resourcev2.ScopeEntry{}, ID: "opaque/a::雪", Representation: "native"}
	type outcome struct {
		reference ResolvedReference
		err       error
	}
	finished := make(chan outcome, 1)
	go func() {
		reference, err := ctrl.ResolveReference(testInvocationContext(), "p1", input)
		finished <- outcome{reference, err}
	}()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("old acquisition did not reach the catalog barrier")
	}

	require.NoError(t, ctrl.invalidateProfileRoutes("p1", []string{route.Connection}))
	fresh, err := ctrl.ResolveReference(testInvocationContext(), "p1", input)
	require.NoError(t, err)
	disk := authorityDiskBytes(t, ctrl)
	releaseOnce.Do(func() { close(release) })
	select {
	case stale := <-finished:
		require.Equal(t, "RESET_REQUIRED", requireAppError(t, stale.err).Code)
		require.Empty(t, stale.reference.Reference.Address.Authority)
	case <-time.After(time.Second):
		t.Fatal("stale acquisition did not retire")
	}
	requireCurrentAuthoritySurvivesRestart(t, ctrl, route, newCatalog, fresh.Reference.Address.Authority, disk)
}
