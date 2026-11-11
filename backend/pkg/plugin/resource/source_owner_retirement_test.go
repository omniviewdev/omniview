package resource

import (
	"context"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/invocation"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

func TestSourceOwnerRetirementReleasesOnlyOwnedInterests(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	owner := invocation.NewScope(invocation.TrustedUI)
	other := invocation.NewScope(invocation.TrustedUI)
	ctx, cancel := context.WithCancel(owner.Context(context.Background()))
	defer cancel()
	otherCtx := other.Context(context.Background())
	request := HostSourceViewRequest{TargetID: target.TargetID, Target: target.Target, Updates: "ifSupported"}
	view, err := ctrl.OpenSourceView(ctx, "p1", request)
	require.NoError(t, err)
	require.NoError(t, ctrl.SyncSourceView(ctx, "p1", view.ViewID))
	open := sourceNextOpen(t, provider)
	otherView, err := ctrl.OpenSourceView(otherCtx, "p1", request)
	require.NoError(t, err)
	// Independent interests share this owner and must retire with its views.
	interestCtx, err := ctrl.admit(ctx, "resource.OpenSourceView", readTarget("p1", target.Target))
	require.NoError(t, err)
	_, err = ctrl.sources.acquire(interestCtx, "p1", target.Target, "ifSupported")
	require.NoError(t, err)
	require.NoError(t, ctrl.SyncSourceView(otherCtx, "p1", otherView.ViewID))
	otherOpen := sourceNextOpen(t, provider)

	record := sourceTestRecord(target.Target, "owned", "")
	otherRecord := sourceTestRecord(target.Target, "other", "")
	for _, item := range []struct {
		open   scriptedSourceOpen
		view   HostSourceViewOpened
		record resourcev2.Record
	}{{open, view, record}, {otherOpen, otherView, otherRecord}} {
		sourceSend(item.open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(item.record)}}}})
		sourceSend(item.open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
		waitSourceView(t, events, item.view.Topic, func(e HostSourceViewEvent) bool {
			return e.Kind == "snapshotEnd" && e.Status != nil && e.Status.State == "following"
		})
	}
	// Request completion must not substitute for native window retirement.
	cancel()
	ctrl.sources.mu.Lock()
	session := ctrl.sources.views[view.ViewID].session
	ctrl.sources.mu.Unlock()
	require.NoError(t, session.ctx.Err())
	// A browser owner cannot close another owner's view.
	require.NoError(t, ctrl.CloseSourceView(otherCtx, "p1", view.ViewID))
	ctrl.RetireSourceOwner("")
	ctrl.RetireSourceOwner("unknown-owner")
	ctrl.RetireSourceOwner(owner.Principal().Owner())
	ctrl.RetireSourceOwner(owner.Principal().Owner())
	select {
	case <-open.stream.closed:
	case <-time.After(time.Second):
		t.Fatal("retired owner stream still open")
	}
	select {
	case <-otherOpen.stream.closed:
		t.Fatal("retirement closed another owner's stream")
	default:
	}
	ctrl.sources.mu.Lock()
	require.NotContains(t, ctrl.sources.views, view.ViewID)
	require.Contains(t, ctrl.sources.views, otherView.ViewID)
	require.Len(t, ctrl.sources.sessions, 1)
	ctrl.sources.mu.Unlock()
	session.mu.Lock()
	require.True(t, session.closed)
	require.Empty(t, session.views)
	require.Empty(t, session.members)
	require.Empty(t, session.staging)
	require.Zero(t, session.memberBytes)
	require.Zero(t, session.stagingBytes)
	session.mu.Unlock()
	// Retained source blobs include any in-flight view snapshot references.
	require.Eventually(t, func() bool {
		session.memberLedger.mu.Lock()
		defer session.memberLedger.mu.Unlock()
		return session.memberLedger.used == 0
	}, time.Second, time.Millisecond)
	_, err = ctrl.OpenSourceView(owner.Context(context.Background()), "p1", request)
	require.Equal(t, "NOT_FOUND", resourcev2.ErrorCode(err))
	require.NoError(t, ctrl.SyncSourceView(otherCtx, "p1", otherView.ViewID))
	sourceSend(otherOpen.stream, resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{
		Kind: resourcev2.SourceChangeUpsert, Observation: &resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(otherRecord)},
	}}}})
	waitSourceView(t, events, otherView.Topic, func(e HostSourceViewEvent) bool {
		return e.Kind == "changes" && len(e.Upserts) == 1
	})
	ctrl.RetireSourceOwner(other.Principal().Owner())
}

func TestSourceOwnerRetirementReclaimsBoundedViewSlots(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	owner := invocation.NewScope(invocation.TrustedUI)
	ctx := owner.Context(context.Background())
	request := HostSourceViewRequest{TargetID: target.TargetID, Target: target.Target, Updates: "ifSupported"}
	for range maxSourceViews {
		_, err := ctrl.OpenSourceView(ctx, "p1", request)
		require.NoError(t, err)
	}
	open := sourceNextOpen(t, provider)
	_, err := ctrl.OpenSourceView(ctx, "p1", request)
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	ctrl.RetireSourceOwner(owner.Principal().Owner())
	ctrl.sources.mu.Lock()
	require.Empty(t, ctrl.sources.views)
	require.Empty(t, ctrl.sources.sessions)
	ctrl.sources.mu.Unlock()
	select {
	case <-open.stream.closed:
	case <-time.After(time.Second):
		t.Fatal("retired owner stream still open")
	}
	other := invocation.NewScope(invocation.TrustedUI)
	_, err = ctrl.OpenSourceView(other.Context(context.Background()), "p1", request)
	require.NoError(t, err, "native retirement must reclaim slots without browser cleanup")
	_ = sourceNextOpen(t, provider)
	ctrl.RetireSourceOwner(other.Principal().Owner())
}

func TestSourceOwnerRetirementFencesReservedSession(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	owner := invocation.NewScope(invocation.TrustedUI)
	ctx, err := ctrl.admit(owner.Context(context.Background()), "resource.OpenSourceView", readTarget("p1", target.Target))
	require.NoError(t, err)
	interest, err := ctrl.sources.acquire(ctx, "p1", target.Target, "ifSupported")
	require.NoError(t, err)
	_ = sourceNextOpen(t, provider)
	ctrl.RetireSourceOwner(owner.Principal().Owner())
	require.Error(t, interest.session.ctx.Err())
	_, err = ctrl.sources.acquire(ctx, "p1", target.Target, "ifSupported")
	require.Equal(t, "NOT_FOUND", resourcev2.ErrorCode(err))
	ctrl.sources.mu.Lock()
	require.Empty(t, ctrl.sources.sessions)
	require.Empty(t, ctrl.sources.views)
	ctrl.sources.mu.Unlock()
}
