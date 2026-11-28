package resource

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// Obtain the proof from the actual enveloped snapshot, not an invented source key or generation.
func openRootFixture(ctx context.Context, t *testing.T, ctrl *controller, events *recordingEmitter, provider *scriptedSourceProvider, target ResolvedTarget, updates, uid string) (ExtensionRootProof, HostSourceViewOpened, *scriptedSourceStream) {
	t.Helper()
	view, err := ctrl.OpenSourceView(ctx, "p1", HostSourceViewRequest{TargetID: target.TargetID, Target: target.Target, Updates: updates})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, ctrl.CloseSourceView(ctx, "p1", view.ViewID)) })
	require.NoError(t, ctrl.SyncSourceView(ctx, "p1", view.ViewID))
	stream := sourceNextOpen(t, provider).stream
	record := sourceTestRecord(target.Target, "same-name", uid)
	sourceSend(stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(record)}}}})
	boundary := sourceBoundary(resourcev2.EnumerationExhausted)
	if view.Mode == resourcev2.SourceModeSnapshot {
		boundary.SnapshotEnd.Continuity = resourcev2.ContinuityNotApplicable
	}
	sourceSend(stream, boundary)
	snapshot := waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool { return e.Kind == "snapshot" && len(e.Records) == 1 })
	waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool {
		return e.Kind == "snapshotEnd" && e.ViewGeneration == snapshot.ViewGeneration
	})
	row := snapshot.Records[0]
	generation := snapshot.ViewGeneration
	if view.Mode == resourcev2.SourceModeSnapshotAndUpdates {
		require.Len(t, snapshot.MemberRevisions, len(snapshot.Records))
		require.NotEmpty(t, snapshot.MemberRevisions[0])
		generation += ":" + snapshot.MemberRevisions[0]
	}
	return ExtensionRootProof{Owner: "p1", Connection: row.Route.Connection, Reference: row.Record.Reference, ViewID: view.ViewID,
		ViewGeneration: generation, RowKey: row.Key}, view, stream
}

func rootTestGet(request resourcev2.GetRequest) resourcev2.Record {
	a := request.Reference.Address
	r := canonicalTestRecord(a.Provider, a.Authority, a.Type, a.ID)
	r.Reference = copySourceReference(request.Reference)
	return r
}

func TestExtensionRootOwnsWindowRouteAndLiveMember(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	window := invocation.NewScope(invocation.TrustedUI)
	ctx := window.Context(context.Background())
	var gets atomic.Int32
	provider.GetFunc = func(ctx context.Context, request resourcev2.GetRequest) (resourcev2.Record, error) {
		actor, ok := invocation.FromContext(ctx)
		require.True(t, ok)
		require.Equal(t, window.Principal(), actor.Principal())
		require.Equal(t, "resource.Get", actor.Operation())
		require.Contains(t, actor.Target().Scope, "query-scope")
		gets.Add(1)
		return rootTestGet(request), nil
	}
	proof, view, _ := openRootFixture(ctx, t, ctrl, events, provider, target, "ifSupported", "same-uid")
	ref, route, guard, err := ctrl.AdmitExtensionRoot(ctx, "p1", proof)
	require.NoError(t, err)
	require.Equal(t, proof.Reference, ref)
	require.Equal(t, target.Target.Route, route)
	*ref.Incarnation = "caller-mutated-return-value"
	require.NoError(t, guard(ctx))
	require.EqualValues(t, 2, gets.Load(), "both dispatch and delivery require a fresh native Get")

	denied := func(caller context.Context, owner string, candidate ExtensionRootProof) {
		t.Helper()
		deniedRef, deniedRoute, deniedGuard, denial := ctrl.AdmitExtensionRoot(caller, owner, candidate)
		require.Error(t, denial)
		require.Zero(t, deniedRef)
		require.Zero(t, deniedRoute)
		require.Nil(t, deniedGuard)
	}
	foreign := invocation.NewScope(invocation.TrustedUI).Context(context.Background())
	denied(foreign, "p1", proof)
	require.Error(t, guard(foreign))
	denied(context.Background(), "p1", proof)
	denied(ctx, "peer", proof)
	for _, mutate := range []func(*ExtensionRootProof){
		func(p *ExtensionRootProof) { p.ViewGeneration += "retired" },
		func(p *ExtensionRootProof) { p.ViewID += "another" },
		func(p *ExtensionRootProof) { p.Owner = "peer" },
		func(p *ExtensionRootProof) { p.RowKey += "another" },
		func(p *ExtensionRootProof) { p.Reference.Incarnation = nil },
		func(p *ExtensionRootProof) { p.Reference.Address.ID += "another" },
		func(p *ExtensionRootProof) {
			p.Reference.Address.Scope = []resourcev2.ScopeEntry{{Dimension: "area", Value: "one"}}
		},
	} {
		candidate := proof
		mutate(&candidate)
		denied(ctx, "p1", candidate)
	}

	// Both view IDs, row keys and references are real, and the name and UID match. No field may be spliced across routes.
	otherTarget := admittedReadTarget(t, ctrl, "p1", "conn-2", target.Target.Type)
	other, _, _ := openRootFixture(ctx, t, ctrl, events, provider, otherTarget, "ifSupported", "same-uid")
	crossed := proof
	crossed.Connection = other.Connection
	denied(ctx, "p1", crossed)
	crossed.ViewID, crossed.ViewGeneration = other.ViewID, other.ViewGeneration
	denied(ctx, "p1", crossed)
	crossed.Reference = other.Reference
	denied(ctx, "p1", crossed)
	require.EqualValues(t, 2, gets.Load(), "no provider Get may run on unbound or replayed authority")
	actual, otherRoute, _, err := ctrl.AdmitExtensionRoot(ctx, "p1", other)
	require.NoError(t, err, "the second connection's own witnessed member must succeed")
	require.Equal(t, other.Reference, actual)
	require.Equal(t, otherTarget.Target.Route, otherRoute)

	require.NoError(t, ctrl.SyncSourceView(ctx, "p1", view.ViewID))
	require.Error(t, guard(ctx))
	denied(ctx, "p1", proof)
	require.EqualValues(t, 3, gets.Load())
}

func TestExtensionRootRequiresFollowingIncarnationAndCurrentGet(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	ctx := invocation.NewScope(invocation.TrustedUI).Context(context.Background())
	var deny atomic.Bool
	ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, op string, t invocation.Target) error {
		if _, derived := t.Scope["query-scope"]; op == "resource.Get" && derived && deny.Load() {
			return errors.New("denied")
		}
		return nil
	}))
	var calls int
	var answer func(resourcev2.GetRequest) (resourcev2.Record, error)
	provider.GetFunc = func(_ context.Context, request resourcev2.GetRequest) (resourcev2.Record, error) {
		calls++
		return answer(request)
	}
	refuse := func(proof ExtensionRootProof) {
		t.Helper()
		_, _, guard, err := ctrl.AdmitExtensionRoot(ctx, "p1", proof)
		require.Error(t, err)
		require.Nil(t, guard)
	}
	finished, _, _ := openRootFixture(ctx, t, ctrl, events, provider, target, "none", "uid-1")
	refuse(finished)
	missing, missingView, _ := openRootFixture(ctx, t, ctrl, events, provider, target, "ifSupported", "")
	refuse(missing)
	require.NoError(t, ctrl.CloseSourceView(ctx, "p1", missingView.ViewID))
	require.Zero(t, calls)
	proof, _, stream := openRootFixture(ctx, t, ctrl, events, provider, target, "ifSupported", "uid-1")
	answer = func(r resourcev2.GetRequest) (resourcev2.Record, error) { return rootTestGet(r), nil }
	_, _, guard, err := ctrl.AdmitExtensionRoot(ctx, "p1", proof)
	require.NoError(t, err)
	deny.Store(true)
	require.Error(t, guard(ctx), "an earlier Get permission cannot authorize delivery after revocation")
	require.Equal(t, 1, calls)
	deny.Store(false)
	answer = func(r resourcev2.GetRequest) (resourcev2.Record, error) {
		row := rootTestGet(r)
		uid := "same-name-replacement"
		row.Reference.Incarnation = &uid
		return row, nil
	}
	refuse(proof)
	require.Error(t, guard(ctx))
	answer = func(r resourcev2.GetRequest) (resourcev2.Record, error) {
		row := rootTestGet(r)
		row.Body.Map["large"] = resourcev2.Value{Kind: "string", String: strings.Repeat("x", maxEvidenceReplyBytes+1)}
		return row, nil
	}
	refuse(proof)
	answer = func(resourcev2.GetRequest) (resourcev2.Record, error) {
		return resourcev2.Record{}, errors.New("denied by provider")
	}
	refuse(proof)
	sourceSend(stream, resourcev2.SourceFrame{Failed: &resourcev2.SourceFailure{Code: "FORBIDDEN", Message: "failure"}})
	waitSourceView(t, events, "resource/source-view/"+proof.ViewID, func(e HostSourceViewEvent) bool { return e.Status != nil && e.Status.State == "failed" })
	before := calls
	refuse(proof)
	require.Error(t, guard(ctx))
	require.Equal(t, before, calls, "a retained failed source is not Get authority")
}

func TestExtensionRootPinsGetToWitnessedRouteBeforeDispatch(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	ctx := invocation.NewScope(invocation.TrustedUI).Context(context.Background())
	var retire, retired atomic.Bool
	ctrl.boundary = invocation.NewBoundary(invocation.AuthorizeFunc(func(_ invocation.Principal, op string, _ invocation.Target) error {
		if op == "resource.Get" && retire.CompareAndSwap(true, false) {
			ctrl.pluginsMu.Lock()
			generation := ctrl.plugins["p1"]
			if generation.sourceEpoch == nil {
				generation.sourceEpoch = make(map[string]uint64)
			}
			generation.sourceEpoch[target.Target.Route.Connection]++
			ctrl.pluginsMu.Unlock()
			retired.Store(true)
		}
		return nil
	}))
	proof, _, _ := openRootFixture(ctx, t, ctrl, events, provider, target, "ifSupported", "uid")
	var gets atomic.Int32
	provider.GetFunc = func(_ context.Context, request resourcev2.GetRequest) (resourcev2.Record, error) {
		gets.Add(1)
		return rootTestGet(request), nil
	}
	retire.Store(true)
	_, _, guard, err := ctrl.AdmitExtensionRoot(ctx, "p1", proof)
	require.True(t, retired.Load(), "replace the route after witness lookup but before Get dispatch")
	require.Error(t, err)
	require.Nil(t, guard)
	require.Zero(t, gets.Load(), "do not Get the same locator through a replacement route")
}

func TestExtensionRootRejectsSameWindowSameUIDReplayBeforeGet(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	ctx := invocation.NewScope(invocation.TrustedUI).Context(context.Background())
	proof, view, stream := openRootFixture(ctx, t, ctrl, events, provider, target, "ifSupported", "uid")
	var gets int
	provider.GetFunc = func(_ context.Context, request resourcev2.GetRequest) (resourcev2.Record, error) {
		gets++
		return rootTestGet(request), nil
	}
	observe := func(id string) HostSourceViewEvent {
		record := sourceTestRecord(target.Target, id, "uid")
		sourceSend(stream, resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{
			Kind: resourcev2.SourceChangeUpsert, Observation: &resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)},
		}}}})
		return waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool {
			return len(e.Upserts) == 1 && e.Upserts[0].Record.Reference.Address.ID == id
		})
	}
	observe("sibling")
	_, _, guard, err := ctrl.AdmitExtensionRoot(ctx, "p1", proof)
	require.NoError(t, err, "an unrelated update must leave this member's receipt valid")
	event := observe("same-name")
	require.Equal(t, proof.Reference, event.Upserts[0].Record.Reference)
	require.Equal(t, proof.RowKey, event.Upserts[0].Key)
	require.Error(t, guard(ctx))
	_, _, _, err = ctrl.AdmitExtensionRoot(ctx, "p1", proof)
	require.Error(t, err, "reject an old tuple even for a new read under the original window")
	require.Equal(t, 1, gets)
	require.Len(t, event.MemberRevisions, 1)
	replacement := proof
	replacement.ViewGeneration = event.ViewGeneration + ":" + event.MemberRevisions[0]
	require.NotEqual(t, proof.ViewGeneration, replacement.ViewGeneration)
	_, _, _, err = ctrl.AdmitExtensionRoot(ctx, "p1", replacement)
	require.NoError(t, err)
}

func TestExtensionRootFencesMemberChangedDuringGet(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	ctx := invocation.NewScope(invocation.TrustedUI).Context(context.Background())
	proof, view, stream := openRootFixture(ctx, t, ctrl, events, provider, target, "ifSupported", "uid")
	provider.GetFunc = func(_ context.Context, request resourcev2.GetRequest) (resourcev2.Record, error) {
		record := rootTestGet(request)
		next := rootTestGet(request)
		next.Body.Map["version"] = resourcev2.Value{Kind: "string", String: "next"}
		sourceSend(stream, resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{
			Kind: resourcev2.SourceChangeUpsert, Observation: &resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(next)},
		}}}})
		change := waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool {
			return e.Kind == "changes" || e.Status != nil && e.Status.State == "failed"
		})
		require.Equal(t, "changes", change.Kind)
		require.Len(t, change.Upserts, 1)
		require.Equal(t, proof.Reference, change.Upserts[0].Record.Reference)
		require.Equal(t, "next", change.Upserts[0].Record.Body.Map["version"].String)
		return record, nil
	}
	_, _, guard, err := ctrl.AdmitExtensionRoot(ctx, "p1", proof)
	require.Error(t, err)
	require.Nil(t, guard)
}

func TestExtensionRootWatchCancelsOnlyItsNativeDemand(t *testing.T) {
	for _, loss := range []string{"member", "removal", "failure", "resync", "close", "window"} {
		t.Run(loss, func(t *testing.T) {
			ctrl, events, provider, target := sourceTestFixture(t)
			window := invocation.NewScope(invocation.TrustedUI)
			ctx := window.Context(context.Background())
			proof, view, stream := openRootFixture(ctx, t, ctrl, events, provider, target, "ifSupported", "uid")
			retired, retire := context.WithCancel(ctx)
			defer retire()
			stopOld, err := ctrl.watchExtensionRoot(retired, "p1", proof, retire)
			require.NoError(t, err)
			stopOld()
			demand, cancel := context.WithCancel(ctx)
			defer cancel()
			stop, err := ctrl.watchExtensionRoot(demand, "p1", proof, cancel)
			require.NoError(t, err)
			defer stop()
			stopOld() // A late cleanup must not detach the next read.
			upsert := func(id, uid string) {
				record := sourceTestRecord(target.Target, id, uid)
				sourceSend(stream, resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{
					Kind: resourcev2.SourceChangeUpsert, Observation: &resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)},
				}}}})
				waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool {
					return len(e.Upserts) == 1 && e.Upserts[0].Record.Reference.Address.ID == id
				})
			}
			upsert("sibling", "other-uid")
			require.NoError(t, demand.Err(), "unrelated collection changes cannot cancel selected work")
			switch loss {
			case "member":
				upsert("same-name", "replacement-uid")
			case "removal":
				sourceSend(stream, resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{
					Kind: resourcev2.SourceChangeRemove, Reference: &proof.Reference,
				}}}})
				waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool { return len(e.Removes) == 1 })
			case "failure":
				sourceSend(stream, resourcev2.SourceFrame{Failed: &resourcev2.SourceFailure{Code: "FORBIDDEN", Message: "unavailable"}})
				waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool { return e.Status != nil && e.Status.State == "failed" })
			case "resync":
				require.NoError(t, ctrl.SyncSourceView(ctx, "p1", view.ViewID))
			case "close":
				require.NoError(t, ctrl.CloseSourceView(ctx, "p1", view.ViewID))
			case "window":
				ctrl.RetireSourceOwner(window.Principal().Owner())
			}
			require.ErrorIs(t, demand.Err(), context.Canceled)
			require.NoError(t, retired.Err(), "detaching a completed demand must remove its cancellation callback")
		})
	}
}
