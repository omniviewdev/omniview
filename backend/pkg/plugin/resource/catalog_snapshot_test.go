package resource

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func TestObservedProjectionCatalogSnapshotBoundsRouteRPCs(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	view := sourceTestOpen(t, ctrl, target)
	defer ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID)
	open := sourceNextOpen(t, provider)
	observations := make([]resourcev2.SourceObservation, 24)
	for i := range observations {
		observations[i].Record = sourceTestRecord(target.Target, fmt.Sprintf("pod-%d", i), "uid")
	}
	sourceSend(open.stream, resourcev2.SourceFrame{Begin: &resourcev2.SourceBegin{Mode: open.request.Mode}})
	sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: observations}})
	sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool { return event.Kind == "snapshotEnd" })
	catalog := provider.CatalogFunc
	var catalogs, gets, bodyAdmissions atomic.Int32
	provider.CatalogFunc = func(ctx context.Context, request resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalogs.Add(1)
		return catalog(ctx, request)
	}
	provider.GetFunc = func(context.Context, resourcev2.GetRequest) (resourcev2.Record, error) {
		gets.Add(1)
		return resourcev2.Record{}, errors.New("projection must not fetch upstream bodies")
	}
	originalBoundary := ctrl.boundary
	defer func() { ctrl.boundary = originalBoundary }()
	var deny atomic.Bool
	ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, target invocation.Target) error {
		if operation == "resource.Get" {
			bodyAdmissions.Add(1)
			require.NotEmpty(t, target.Object)
			if deny.Load() {
				return errors.New("revoked source body grant")
			}
		}
		return nil
	}))
	ctx := WithCatalogSnapshotCache(testInvocationContext())
	require.Same(t, ctx, WithCatalogSnapshotCache(ctx))
	guards := make([]func(context.Context) error, 0, len(observations))
	for _, observation := range observations {
		admitted, err := ctrl.AdmitReference(ctx, "metric.Query", "p1", target.Target.Route, observation.Record.Reference)
		require.NoError(t, err)
		body, guard, err := ctrl.ReadObservedResource(admitted, "p1", target.Target.Route, observation.Record.Reference)
		require.NoError(t, err)
		require.Equal(t, observation.Record.Reference.Address.ID, body.Map["name"].String)
		require.NoError(t, guard(ctx))
		_, err = ctrl.AdmitReference(ctx, "metric.Query", "p1", target.Target.Route, observation.Record.Reference)
		require.NoError(t, err)
		guards = append(guards, guard)
	}
	require.EqualValues(t, 1, catalogs.Load(), "24 custom projections and admission/publication must share one route catalog")
	require.GreaterOrEqual(t, bodyAdmissions.Load(), int32(48), "catalog reuse must not reuse per-reference grants")
	// A later cache delivery gets a new immutable scope, not the old catalog.
	delivery := WithCatalogSnapshotCache(testInvocationContext())
	for _, guard := range guards {
		require.NoError(t, guard(delivery))
	}
	require.EqualValues(t, 2, catalogs.Load(), "24 cached projection deliveries need only one fresh route catalog")
	require.Zero(t, gets.Load())
	deny.Store(true)
	require.Error(t, guards[0](delivery), "same-scope catalog hit must still reauthorize Get")
}

func TestCatalogSnapshotDoesNotBlessRetiredSourceEpoch(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	ctx := WithCatalogSnapshotCache(testInvocationContext())
	ctx, err := ctrl.admit(ctx, "resource.Catalog", invocation.Target{Provider: "p1", Connection: target.Target.Route.Connection})
	require.NoError(t, err)
	_, generation, acquisition, cleanup, err := ctrl.operationGeneration(ctx, "p1", target.Target.Route)
	require.NoError(t, err)
	defer cleanup()
	_, err = ctrl.catalogSnapshot(acquisition, "p1", provider, generation, target.Target.Route)
	require.NoError(t, err)
	ctrl.pluginsMu.Lock()
	if generation.sourceEpoch == nil {
		generation.sourceEpoch = make(map[string]uint64)
	}
	generation.sourceEpoch[target.Target.Route.Connection]++
	ctrl.pluginsMu.Unlock()
	_, err = ctrl.catalogSnapshot(acquisition, "p1", provider, generation, target.Target.Route)
	require.Error(t, err, "a cache hit must validate the original source epoch")
}

func TestCanonicalMetricAdmissionSharesCatalogPerDelivery(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	catalog := provider.CatalogFunc
	var catalogs, gets atomic.Int32
	provider.CatalogFunc = func(ctx context.Context, request resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalogs.Add(1)
		return catalog(ctx, request)
	}
	provider.GetFunc = func(context.Context, resourcev2.GetRequest) (resourcev2.Record, error) {
		gets.Add(1)
		return resourcev2.Record{}, errors.New("canonical mapping does not read bodies")
	}
	for _, delivery := range []string{"cold", "cache-hit"} {
		t.Run(delivery, func(t *testing.T) {
			ctx := WithCatalogSnapshotCache(testInvocationContext())
			before := catalogs.Load()
			for i := range 24 {
				ref := sourceTestRecord(target.Target, fmt.Sprintf("pod-%d", i), "uid").Reference
				_, err := ctrl.AdmitReference(ctx, "metric.Query", "p1", target.Target.Route, ref)
				require.NoError(t, err)
				// Final per-reference delivery admission shares metadata, never
				// authorization, with this request's initial admission.
				_, err = ctrl.AdmitReference(ctx, "metric.Query", "p1", target.Target.Route, ref)
				require.NoError(t, err)
			}
			require.EqualValues(t, 1, catalogs.Load()-before)
			require.Zero(t, gets.Load())
		})
	}
}
