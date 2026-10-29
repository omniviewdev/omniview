package resource

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func bootstrapTestCatalog(backing string) resourcev2.Catalog {
	catalog := canonicalTestCatalog("native", "objects")
	catalog.Revision = backing
	catalog.Types = append(catalog.Types, canonicalTestCatalog("native", "peers").Types[0])
	for i := range catalog.Types {
		catalog.Types[i].DefaultRepresentation = "native"
		catalog.Types[i].NativeAuthorityHint = &resourcev2.NativeAuthorityHint{Scheme: "fixture/graph-backing/v1", ID: backing + "/" + catalog.Types[i].Type, Continuity: resourcev2.ContinuityConnectionLocal}
	}
	return catalog
}

func bootstrapTestBoundCatalog(t *testing.T, backing string) resourcev2.Catalog {
	t.Helper()
	catalog := bootstrapTestCatalog(backing)
	var err error
	catalog.Revision, err = resourcev2.BindCatalogRevision(bindingTestEpoch(t), catalog.Revision)
	require.NoError(t, err)
	return catalog
}

func bootstrapTestDeclaration(label string) resourcev2.RelationshipDescriptor {
	return resourcev2.RelationshipDescriptor{Type: resourcev2.RelUses, TargetType: "peers", TargetScope: []resourcev2.ScopeEntry{}, Label: label, Extractor: &resourcev2.RelationshipExtractor{Method: "fieldPath", FieldPath: "spec.peer"}}
}

func TestRelationshipBootstrapPinsOneCompleteCatalog(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalog := bootstrapTestCatalog("accepted")
	catalogCalls, declarationCalls := 0, 0
	var accepted string
	registerMockPlugin(ctrl, "p1", &mockProvider{
		CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
			catalogCalls++
			return catalog, nil
		},
		GetRelationshipsFunc: func(ctx context.Context, _ resourcev2.AccessRoute, _ string) ([]resourcev2.RelationshipDescriptor, error) {
			declarationCalls++
			revision, ok := resourcev2.CatalogRevisionFromContext(ctx)
			require.True(t, ok)
			if declarationCalls == 1 {
				accepted = revision
			}
			require.Equal(t, accepted, revision)
			return []resourcev2.RelationshipDescriptor{}, nil
		},
	})
	ctrl.bootstrapRelationships(testInvocationContext(), "p1", resourcev2.AccessRoute{Connection: "route/opaque"})
	require.Equal(t, 1, catalogCalls)
	require.Equal(t, len(catalog.Types), declarationCalls)
}

func TestRelationshipBootstrapReacquiresAfterNativeBindingRetirement(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalog := bootstrapTestBoundCatalog(t, "before")
	catalogCalls := 0
	route := resourcev2.AccessRoute{Connection: "route/opaque"}
	registerMockPlugin(ctrl, "p1", &mockProvider{
		CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
			catalogCalls++
			return catalog, nil
		},
		GetRelationshipsFunc: func(_ context.Context, _ resourcev2.AccessRoute, resourceType string) ([]resourcev2.RelationshipDescriptor, error) {
			if resourceType == "objects" {
				return []resourcev2.RelationshipDescriptor{bootstrapTestDeclaration("current")}, nil
			}
			return []resourcev2.RelationshipDescriptor{}, nil
		},
	})
	ctrl.bootstrapRelationships(testInvocationContext(), "p1", route)
	_, before, ok := ctrl.graph.GetBoundDeclarations("p1", route, "objects")
	require.True(t, ok)
	catalog = bootstrapTestBoundCatalog(t, "after")
	ctrl.bootstrapRelationships(testInvocationContext(), "p1", route)
	declarations, after, ok := ctrl.graph.GetBoundDeclarations("p1", route, "objects")
	require.True(t, ok, "binding retirement must not discard the replacement bootstrap")
	require.Len(t, declarations, 1)
	require.Greater(t, after.SourceEpoch, before.SourceEpoch)
	require.NotEqual(t, before.Source.Target.Authority, after.Source.Target.Authority)
	require.NoError(t, ctrl.graph.CheckComplete("p1", route))
	require.Equal(t, 3, catalogCalls, "one bounded reacquisition, no inventory scan")
}

func TestRelationshipReacquisitionCannotCrossInterveningProfileReset(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalog := bootstrapTestBoundCatalog(t, "before")
	catalogCalls := 0
	route := resourcev2.AccessRoute{Connection: "route/opaque"}
	registerMockPlugin(ctrl, "p1", &mockProvider{
		CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
			catalogCalls++
			return catalog, nil
		},
		GetRelationshipsFunc: func(context.Context, resourcev2.AccessRoute, string) ([]resourcev2.RelationshipDescriptor, error) {
			return []resourcev2.RelationshipDescriptor{}, nil
		},
	})
	ctx := testInvocationContext()
	ctrl.bootstrapRelationships(ctx, "p1", route)
	_, generation, operationCtx, cleanup, err := ctrl.operationGeneration(ctx, "p1", route)
	require.NoError(t, err)
	defer cleanup()
	admission := captureCatalogAdmission(operationCtx, generation)
	catalog = bootstrapTestBoundCatalog(t, "after")
	err = ctrl.observeCatalogBinding(operationCtx, "p1", route, catalog, admission)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	// Capture the precise epoch accepted by the retirement check, then force a
	// profile reset before the replacement operation acquires its source lock.
	expected := catalogAdmission{generation: generation, epoch: sourceEpochSnapshot{Connection: route.Connection, Epoch: admission.epoch.Epoch + 1}}
	ctrl.pluginsMu.Lock()
	checkedEpoch := generation.sourceEpoch[route.Connection]
	err = ctrl.invalidateSourceRoutesLocked("p1", []string{route.Connection}, false)
	ctrl.pluginsMu.Unlock()
	require.Equal(t, expected.epoch.Epoch, checkedEpoch)
	require.NoError(t, err)
	callsBefore := catalogCalls
	ctrl.bootstrapRelationshipsCurrent(operationCtx, "p1", route, false, &expected)
	require.Equal(t, callsBefore, catalogCalls, "retired bootstrap must not acquire a post-reset catalog")
	_, _, ok := ctrl.graph.GetBoundDeclarations("p1", route, "objects")
	require.False(t, ok, "retired bootstrap must not publish post-reset declarations")
	// A separately initiated bootstrap still owns the new profile epoch.
	ctrl.bootstrapRelationships(ctx, "p1", route)
	_, _, ok = ctrl.graph.GetBoundDeclarations("p1", route, "objects")
	require.True(t, ok)
}

func TestBlockedBootstrapCannotPublishAfterProfileEpochReset(t *testing.T) {
	for _, oldEmpty := range []bool{false, true} {
		name := "old-rules"
		if oldEmpty {
			name = "old-empty-rules"
		}
		t.Run(name, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			oldCatalog, newCatalog := bootstrapTestCatalog("A"), bootstrapTestCatalog("B")
			var current atomic.Pointer[resourcev2.Catalog]
			current.Store(&oldCatalog)
			entered, release := make(chan struct{}), make(chan struct{})
			var releaseOnce sync.Once
			defer releaseOnce.Do(func() { close(release) })
			var calls atomic.Int32
			provider := &mockProvider{
				CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
					return *current.Load(), nil
				},
				GetRelationshipsFunc: func(ctx context.Context, _ resourcev2.AccessRoute, resourceType string) ([]resourcev2.RelationshipDescriptor, error) {
					if resourceType != "objects" {
						return []resourcev2.RelationshipDescriptor{}, nil
					}
					if calls.Add(1) == 1 {
						close(entered)
						select {
						case <-release:
						case <-ctx.Done():
							return nil, ctx.Err()
						}
						if oldEmpty {
							return []resourcev2.RelationshipDescriptor{}, nil
						}
						return []resourcev2.RelationshipDescriptor{bootstrapTestDeclaration("old")}, nil
					}
					return []resourcev2.RelationshipDescriptor{bootstrapTestDeclaration("new")}, nil
				},
			}
			registerMockPlugin(ctrl, "p1", provider)
			route := resourcev2.AccessRoute{Connection: "route/opaque"}
			finished := make(chan struct{})
			go func() { defer close(finished); ctrl.bootstrapRelationships(testInvocationContext(), "p1", route) }()
			select {
			case <-entered:
			case <-time.After(time.Second):
				t.Fatal("old bootstrap did not reach declaration barrier")
			}

			require.NoError(t, ctrl.invalidateProfileRoutes("p1", []string{route.Connection}))
			current.Store(&newCatalog)
			ctrl.bootstrapRelationships(testInvocationContext(), "p1", route)
			declarations, bindings, ok := ctrl.graph.GetBoundDeclarations("p1", route, "objects")
			require.True(t, ok)
			require.Len(t, declarations, 1)
			require.Equal(t, "new", declarations[0].Label)
			require.Equal(t, uint64(1), bindings.SourceEpoch)
			require.NotEqual(t, bindings.Source.Target.Authority, bindings.Targets[0].Target.Authority, "target authority must not be copied from source")
			require.NoError(t, ctrl.graph.CheckComplete("p1", route))

			releaseOnce.Do(func() { close(release) })
			select {
			case <-finished:
			case <-time.After(time.Second):
				t.Fatal("old bootstrap did not retire")
			}
			after, afterBindings, ok := ctrl.graph.GetBoundDeclarations("p1", route, "objects")
			require.True(t, ok)
			require.Equal(t, declarations, after)
			require.Equal(t, bindings, afterBindings)
			require.NoError(t, ctrl.graph.CheckComplete("p1", route), "stale failure must not poison newer coverage either")
		})
	}
}

func TestProfileResetRetiresRouteDeclarationsAndCoverage(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	catalog := bootstrapTestCatalog("A")
	registerMockPlugin(ctrl, "p1", &mockProvider{
		CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) { return catalog, nil },
		GetRelationshipsFunc: func(_ context.Context, _ resourcev2.AccessRoute, resourceType string) ([]resourcev2.RelationshipDescriptor, error) {
			if resourceType == "objects" {
				return []resourcev2.RelationshipDescriptor{bootstrapTestDeclaration("current")}, nil
			}
			return []resourcev2.RelationshipDescriptor{}, nil
		},
	})
	route := resourcev2.AccessRoute{Connection: "route/opaque"}
	ctrl.bootstrapRelationships(testInvocationContext(), "p1", route)
	_, _, ok := ctrl.graph.GetBoundDeclarations("p1", route, "objects")
	require.True(t, ok)
	ctrl.graph.RecordDeclarationError("p1", route, "objects", resourcev2.NewError("FORBIDDEN", "blocked"))
	require.Error(t, ctrl.graph.CheckComplete("p1", route))
	require.NoError(t, ctrl.invalidateProfileRoutes("p1", []string{route.Connection}))
	_, _, ok = ctrl.graph.GetBoundDeclarations("p1", route, "objects")
	require.False(t, ok)
	require.NoError(t, ctrl.graph.CheckComplete("p1", route))
}
