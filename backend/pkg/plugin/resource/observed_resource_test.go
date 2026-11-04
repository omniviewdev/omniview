package resource

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func TestReadObservedResourcesUsesCompletedSourceWithoutGet(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	provider.GetFunc = func(context.Context, resourcev2.GetRequest) (resourcev2.Record, error) {
		t.Fatal("observed projection must never call upstream Get")
		return resourcev2.Record{}, errors.New("unexpected Get")
	}
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
	for _, observation := range observations {
		body, guard, err := ctrl.ReadObservedResource(testInvocationContext(), "p1", target.Target.Route, observation.Record.Reference)
		require.NoError(t, err)
		require.NoError(t, guard(testInvocationContext()))
		require.Equal(t, observation.Record.Body, *body)
		// Host extraction reads leaves and may replace its detached root. Neither
		// operation may modify the retained source observation.
		require.Equal(t, observation.Record.Reference.Address.ID, body.Map["name"].String)
		*body = resourcev2.Value{Kind: "null"}
		again, _, err := ctrl.ReadObservedResource(testInvocationContext(), "p1", target.Target.Route, observation.Record.Reference)
		require.NoError(t, err)
		require.Equal(t, observation.Record.Body, *again)
	}
	// A matching sidebar reuses the same source, without another acquisition.
	_, _, err := ctrl.ReadObservedResource(testInvocationContext(), "p1", target.Target.Route, observations[0].Record.Reference)
	require.NoError(t, err)
	require.Empty(t, provider.opens)
}

func TestReadObservedResourceRejectsStaleAndDeniedSnapshots(t *testing.T) {
	for _, failure := range []string{"missing", "incarnation", "route", "authority", "owner", "generation", "epoch", "representation", "opening", "snapshotting", "resetRequired", "failed", "closed", "denied", "scope-denied", "untrusted"} {
		t.Run(failure, func(t *testing.T) {
			ctrl, events, provider, target := sourceTestFixture(t)
			provider.GetFunc = func(context.Context, resourcev2.GetRequest) (resourcev2.Record, error) {
				t.Fatal("rejected observation must not fall back to Get")
				return resourcev2.Record{}, nil
			}
			view := sourceTestOpen(t, ctrl, target)
			defer ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID)
			open := sourceNextOpen(t, provider)
			record := sourceTestRecord(target.Target, "pod", "uid")
			sourceSend(open.stream, resourcev2.SourceFrame{Begin: &resourcev2.SourceBegin{Mode: open.request.Mode}})
			sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: record}}}})
			sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
			waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool { return event.Kind == "snapshotEnd" })
			ctrl.sources.mu.Lock()
			var session *sourceSession
			for _, candidate := range ctrl.sources.sessions {
				session = candidate
			}
			ctrl.sources.mu.Unlock()
			require.NotNil(t, session)
			boundary := ctrl.boundary
			defer func() { ctrl.boundary = boundary }()
			ctx := testInvocationContext()
			route := target.Target.Route
			ref := record.Reference
			session.mu.Lock()
			switch failure {
			case "missing":
				ref.Address.ID = "absent"
			case "incarnation":
				uid := "replacement"
				ref.Incarnation = &uid
			case "route":
				route.Connection = "other"
			case "authority":
				ref.Address.Authority += "-retired"
			case "owner":
				session.owner = "another-principal"
			case "generation":
				session.pluginGeneration = &pluginState{}
			case "epoch":
				session.ctx = context.WithValue(session.ctx, sourceEpochKey{}, sourceEpochSnapshot{Connection: route.Connection, Epoch: ^uint64(0)})
			case "representation":
				for key, member := range session.members {
					member.observation.Record.Representation.ID = "summary"
					session.members[key] = member
				}
			case "opening", "snapshotting", "resetRequired", "failed":
				session.status.State = failure
			case "closed":
				session.closed = true
			case "denied", "scope-denied":
				ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, target invocation.Target) error {
					require.Equal(t, "resource.Get", operation)
					if failure == "denied" || target.Scope["query-scope"] != "" {
						return errors.New("body access denied")
					}
					return nil
				}))
			case "untrusted":
				ctx = context.Background()
			}
			session.mu.Unlock()
			body, guard, err := ctrl.ReadObservedResource(ctx, "p1", route, ref)
			require.Error(t, err)
			if failure == "missing" || failure == "incarnation" || failure == "owner" || failure == "generation" || failure == "representation" || failure == "opening" || failure == "snapshotting" || failure == "resetRequired" || failure == "failed" || failure == "closed" {
				require.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(err), "missing source observations must retain a reviewed public classification")
			}
			require.Nil(t, body)
			require.Nil(t, guard)
			// Restore close eligibility for fixture cleanup.
			session.mu.Lock()
			session.closed = false
			session.mu.Unlock()
		})
	}
}

func TestObservedResourceGuardRejectsEqualReplacementAndReset(t *testing.T) {
	for _, change := range []string{"replacement", "reset", "denied", "delivery-canceled"} {
		t.Run(change, func(t *testing.T) {
			ctrl, events, provider, target := sourceTestFixture(t)
			view := sourceTestOpen(t, ctrl, target)
			defer ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID)
			open := sourceNextOpen(t, provider)
			record := sourceTestRecord(target.Target, "pod", "uid")
			sourceSend(open.stream, resourcev2.SourceFrame{Begin: &resourcev2.SourceBegin{Mode: open.request.Mode}})
			sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: record}}}})
			sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
			waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool { return event.Kind == "snapshotEnd" })
			acquisition, cancel := context.WithCancel(testInvocationContext())
			_, guard, err := ctrl.ReadObservedResource(acquisition, "p1", target.Target.Route, record.Reference)
			require.NoError(t, err)
			cancel()
			// A new delivery lifetime remains valid after acquisition ends.
			require.NoError(t, guard(testInvocationContext()))
			ctrl.sources.mu.Lock()
			var session *sourceSession
			for _, candidate := range ctrl.sources.sessions {
				session = candidate
			}
			ctrl.sources.mu.Unlock()
			require.NotNil(t, session)
			boundary := ctrl.boundary
			defer func() { ctrl.boundary = boundary }()
			delivery := testInvocationContext()
			session.mu.Lock()
			switch change {
			case "replacement":
				// Exercise the same immutable replacement construction used by
				// source updates, keeping reference and body exactly equal.
				member, key, err := makeSourceMember(resourcev2.SourceObservation{Record: record})
				require.NoError(t, err)
				session.members[key] = member
			case "reset":
				// A recovered snapshot can be byte-identical, but its source
				// generation must never validate an older cached projection.
				session.generation += "-reopened"
			case "denied":
				ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(invocation.Principal, string, invocation.Target) error {
					return errors.New("revoked body grant")
				}))
			case "delivery-canceled":
				var cancelDelivery context.CancelFunc
				delivery, cancelDelivery = context.WithCancel(delivery)
				cancelDelivery()
			}
			session.mu.Unlock()
			err = guard(delivery)
			require.Error(t, err)
			if change == "replacement" || change == "reset" {
				require.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(err))
			}
		})
	}
}

func TestReadObservedResourceUsesDeclaredModelAndPrefersDefault(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	catalog := provider.CatalogFunc
	modelRepresentation := canonicalTestRepresentation()
	modelRepresentation.ID = "declared-model"
	provider.CatalogFunc = func(ctx context.Context, request resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		result, err := catalog(ctx, request)
		result.Revision = "model-catalog"
		result.Types[0].DefaultRepresentation = target.Target.Representation
		result.Types[0].ModelRepresentation = modelRepresentation.ID
		result.Types[0].Representations = append(result.Types[0].Representations, modelRepresentation)
		return result, err
	}
	provider.GetFunc = func(context.Context, resourcev2.GetRequest) (resourcev2.Record, error) {
		t.Fatal("declared model projection must reuse its owner view")
		return resourcev2.Record{}, nil
	}
	modelTarget := target
	modelTarget.Target.Representation = modelRepresentation.ID
	modelView := sourceTestOpen(t, ctrl, modelTarget)
	defer ctrl.CloseSourceView(testInvocationContext(), "p1", modelView.ViewID)
	modelOpen := sourceNextOpen(t, provider)
	record := sourceTestRecord(target.Target, "pod", "uid")
	modelRecord := record
	modelRecord.Representation = modelRepresentation
	modelRecord.Body = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"name": {Kind: "string", String: "model-observation"}}}
	modelRecord.Coverage = resourcev2.Coverage{Kind: "partial", Paths: []string{"/omitted"}, Reason: "model omits private fields"}
	sourceSend(modelOpen.stream, resourcev2.SourceFrame{Begin: &resourcev2.SourceBegin{Mode: modelOpen.request.Mode}})
	sourceSend(modelOpen.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: modelRecord}}}})
	sourceSend(modelOpen.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	waitSourceView(t, events, modelView.Topic, func(event HostSourceViewEvent) bool { return event.Kind == "snapshotEnd" })
	body, modelGuard, err := ctrl.ReadObservedResource(testInvocationContext(), "p1", target.Target.Route, record.Reference)
	require.NoError(t, err)
	require.Equal(t, "model-observation", body.Map["name"].String)
	require.NotContains(t, body.Map, "omitted", "model omission must not be filled by another source or upstream read")
	require.NoError(t, modelGuard(testInvocationContext()))
	identityGuard, err := ctrl.GuardObservedReference(testInvocationContext(), "metric.Query", "p1", target.Target.Route, record.Reference)
	require.NoError(t, err)
	require.NoError(t, identityGuard(testInvocationContext()), "declared model observations also carry authoritative identity")

	defaultView := sourceTestOpen(t, ctrl, target)
	defaultOpen := sourceNextOpen(t, provider)
	sourceSend(defaultOpen.stream, resourcev2.SourceFrame{Begin: &resourcev2.SourceBegin{Mode: defaultOpen.request.Mode}})
	sourceSend(defaultOpen.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: record}}}})
	sourceSend(defaultOpen.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	waitSourceView(t, events, defaultView.Topic, func(event HostSourceViewEvent) bool { return event.Kind == "snapshotEnd" })
	for range 8 {
		body, guard, err := ctrl.ReadObservedResource(testInvocationContext(), "p1", target.Target.Route, record.Reference)
		require.NoError(t, err)
		require.Equal(t, record.Body, *body, "default representation preference must not depend on map iteration")
		require.NoError(t, guard(testInvocationContext()))
	}
	require.Equal(t, "UNAVAILABLE", resourcev2.ErrorCode(modelGuard(testInvocationContext())), "cached model projection must reset when preferred source changes")
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", defaultView.ViewID))
	body, _, err = ctrl.ReadObservedResource(testInvocationContext(), "p1", target.Target.Route, record.Reference)
	require.NoError(t, err)
	require.Equal(t, modelRecord.Body, *body)
	require.Empty(t, provider.opens)
}

func TestGuardObservedReferenceUsesCurrentSourceIdentityWithoutGet(t *testing.T) {
	for _, change := range []string{"body", "incarnation", "reset", "denied", "owner", "generation", "epoch", "route"} {
		t.Run(change, func(t *testing.T) {
			ctrl, events, provider, target := sourceTestFixture(t)
			provider.GetFunc = func(context.Context, resourcev2.GetRequest) (resourcev2.Record, error) {
				t.Fatal("identity admission must never call upstream Get")
				return resourcev2.Record{}, nil
			}
			view := sourceTestOpen(t, ctrl, target)
			defer ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID)
			open := sourceNextOpen(t, provider)
			first := sourceTestRecord(target.Target, "pod-01", "uid-01")
			second := sourceTestRecord(target.Target, "pod-02", "uid-02")
			sourceSend(open.stream, resourcev2.SourceFrame{Begin: &resourcev2.SourceBegin{Mode: open.request.Mode}})
			sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: first}, {Record: second}}}})
			sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
			waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool { return event.Kind == "snapshotEnd" })
			boundary := ctrl.boundary
			defer func() { ctrl.boundary = boundary }()
			denied := false
			ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, operation string, _ invocation.Target) error {
				require.Equal(t, "metric.Query", operation, "identity admission must not require resource.Get")
				if denied {
					return errors.New("metric grant revoked")
				}
				return nil
			}))
			forged := "validly-encoded-forged-uid"
			for _, incarnation := range []*string{nil, second.Reference.Incarnation, &forged} {
				altered := first.Reference
				altered.Incarnation = incarnation
				guard, err := ctrl.GuardObservedReference(testInvocationContext(), "metric.Query", "p1", target.Target.Route, altered)
				require.Error(t, err)
				require.Nil(t, guard)
			}
			missing := first.Reference
			missing.Address.ID = "unobserved-pod"
			unavailable, err := ctrl.GuardObservedReference(testInvocationContext(), "metric.Query", "p1", target.Target.Route, missing)
			require.Error(t, err)
			require.Nil(t, unavailable)
			acquisition, cancel := context.WithCancel(testInvocationContext())
			guard, err := ctrl.GuardObservedReference(acquisition, "metric.Query", "p1", target.Target.Route, first.Reference)
			require.NoError(t, err)
			cancel()
			require.NoError(t, guard(testInvocationContext()))
			sourceView, err := ctrl.sourceView(testInvocationContext(), "p1", view.ViewID, "metric.Query")
			require.NoError(t, err)
			session := sourceView.session
			switch change {
			case "body", "incarnation":
				updated := first
				updated.Body = resourcev2.Value{Kind: "map", Map: map[string]resourcev2.Value{"name": {Kind: "string", String: "changed"}}}
				if change == "incarnation" {
					value := "uid-replacement"
					updated.Reference.Incarnation = &value
				}
				sourceSend(open.stream, resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{Kind: resourcev2.SourceChangeUpsert, Observation: &resourcev2.SourceObservation{Record: updated}}}}})
				waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool { return event.Kind == "changes" && len(event.Upserts) == 1 })
			case "denied":
				denied = true
				next, err := ctrl.GuardObservedReference(testInvocationContext(), "metric.Query", "p1", target.Target.Route, first.Reference)
				require.Error(t, err)
				require.Nil(t, next)
			case "reset":
				// Close the real stream, then publish an identical replacement
				// snapshot. The prior delivery guard must retain its source fence.
				ctrl.boundary = boundary
				require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
				reopened := sourceTestOpen(t, ctrl, target)
				defer ctrl.CloseSourceView(testInvocationContext(), "p1", reopened.ViewID)
				replacement := sourceNextOpen(t, provider)
				sourceSend(replacement.stream, resourcev2.SourceFrame{Begin: &resourcev2.SourceBegin{Mode: replacement.request.Mode}})
				sourceSend(replacement.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: first}, {Record: second}}}})
				sourceSend(replacement.stream, sourceBoundary(resourcev2.EnumerationExhausted))
				waitSourceView(t, events, reopened.Topic, func(event HostSourceViewEvent) bool { return event.Kind == "snapshotEnd" })
			default:
				session.mu.Lock()
				switch change {
				case "owner":
					session.owner = "another-owner"
				case "generation":
					session.pluginGeneration = &pluginState{}
				case "epoch":
					session.ctx = context.WithValue(session.ctx, sourceEpochKey{}, sourceEpochSnapshot{Connection: target.Target.Route.Connection, Epoch: ^uint64(0)})
				case "route":
					session.target.Route.Connection = "another-connection"
				}
				session.mu.Unlock()
			}
			if change == "body" {
				require.NoError(t, guard(testInvocationContext()), "same incarnation body changes must not invalidate identity")
			} else {
				require.Error(t, guard(testInvocationContext()))
			}
			ctrl.boundary = boundary
		})
	}
}

func TestGuardObservedReferenceRejectsConflictingDefaultAndModelIncarnations(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	catalog := provider.CatalogFunc
	model := canonicalTestRepresentation()
	model.ID = "identity-model"
	provider.CatalogFunc = func(ctx context.Context, request resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		result, err := catalog(ctx, request)
		result.Revision = "identity-model-catalog"
		result.Types[0].ModelRepresentation = model.ID
		result.Types[0].Representations = append(result.Types[0].Representations, model)
		return result, err
	}
	provider.GetFunc = func(context.Context, resourcev2.GetRequest) (resourcev2.Record, error) {
		t.Fatal("conflicting identities must never fall back to Get")
		return resourcev2.Record{}, nil
	}
	oldView, err := ctrl.OpenSourceView(testInvocationContext(), "p1", HostSourceViewRequest{TargetID: target.TargetID, Target: target.Target, Updates: "none"})
	require.NoError(t, err)
	defer ctrl.CloseSourceView(testInvocationContext(), "p1", oldView.ViewID)
	require.NoError(t, ctrl.SyncSourceView(testInvocationContext(), "p1", oldView.ViewID))
	oldOpen := sourceNextOpen(t, provider)
	oldRecord := sourceTestRecord(target.Target, "pod-01", "old-uid")
	sourceSend(oldOpen.stream, resourcev2.SourceFrame{Begin: &resourcev2.SourceBegin{Mode: oldOpen.request.Mode}})
	sourceSend(oldOpen.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: oldRecord}}}})
	sourceSend(oldOpen.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	waitSourceView(t, events, oldView.Topic, func(event HostSourceViewEvent) bool {
		return event.Kind == "snapshotEnd" && event.Status != nil && event.Status.State == "finished"
	})
	retainedGuard, err := ctrl.GuardObservedReference(testInvocationContext(), "metric.Query", "p1", target.Target.Route, oldRecord.Reference)
	require.NoError(t, err)
	modelTarget := target
	modelTarget.Target.Representation = model.ID
	newView := sourceTestOpen(t, ctrl, modelTarget)
	defer ctrl.CloseSourceView(testInvocationContext(), "p1", newView.ViewID)
	newOpen := sourceNextOpen(t, provider)
	newRecord := sourceTestRecord(target.Target, "pod-01", "new-uid")
	newRecord.Representation = model
	sourceSend(newOpen.stream, resourcev2.SourceFrame{Begin: &resourcev2.SourceBegin{Mode: newOpen.request.Mode}})
	sourceSend(newOpen.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: newRecord}}}})
	sourceSend(newOpen.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	waitSourceView(t, events, newView.Topic, func(event HostSourceViewEvent) bool {
		return event.Kind == "snapshotEnd" && event.Status != nil && event.Status.State == "following"
	})
	for _, reference := range []resourcev2.ResourceReference{oldRecord.Reference, newRecord.Reference} {
		guard, err := ctrl.GuardObservedReference(testInvocationContext(), "metric.Query", "p1", target.Target.Route, reference)
		require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
		require.Nil(t, guard, "neither representation may win conflicting identity admission")
	}
	require.Error(t, retainedGuard(testInvocationContext()), "delivery must notice newly conflicting observations")
	body, _, err := ctrl.ReadObservedResource(testInvocationContext(), "p1", target.Target.Route, oldRecord.Reference)
	require.NoError(t, err, "projection selection semantics remain unchanged")
	require.Equal(t, oldRecord.Body, *body)
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", oldView.ViewID))
	guard, err := ctrl.GuardObservedReference(testInvocationContext(), "metric.Query", "p1", target.Target.Route, newRecord.Reference)
	require.NoError(t, err)
	require.NoError(t, guard(testInvocationContext()))
	guard, err = ctrl.GuardObservedReference(testInvocationContext(), "metric.Query", "p1", target.Target.Route, oldRecord.Reference)
	require.Error(t, err)
	require.Nil(t, guard)
}
