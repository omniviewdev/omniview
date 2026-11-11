package resource

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSourceFailureBeforeSnapshotReachesViewAndReleasesStaging(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	view := sourceTestOpen(t, ctrl, target)
	open := sourceNextOpen(t, provider)
	record := sourceTestRecord(target.Target, "staged", "")
	sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(record)}}}})
	s, err := ctrl.sourceView(testInvocationContext(), "p1", view.ViewID, "resource.SyncSourceView")
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		s.session.mu.Lock()
		defer s.session.mu.Unlock()
		return len(s.session.staging) == 1
	}, time.Second, time.Millisecond)
	sourceSend(open.stream, resourcev2.SourceFrame{Failed: &resourcev2.SourceFailure{Code: "FORBIDDEN", Message: "denied"}})
	end := waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool {
		return e.Kind == "snapshotEnd" && e.Status != nil && e.Status.State == "failed"
	})
	require.Equal(t, "FORBIDDEN", end.Status.Error.Code)
	s.session.mu.Lock()
	require.Empty(t, s.session.staging)
	require.Zero(t, s.session.stagingBytes)
	s.session.mu.Unlock()
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
}

func TestSourceChangesLimitsAreAtomic(t *testing.T) {
	record := sourceTestRecord(resourcev2.ReadTarget{Provider: "p", Authority: "a", Type: "t"}, "new", "")
	frame := resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{Kind: resourcev2.SourceChangeUpsert, Observation: &resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)}}}}}
	t.Run("members", func(t *testing.T) {
		members := make(map[string]sourceMember, maxSourceSessionMembers)
		for i := range maxSourceSessionMembers {
			members[fmt.Sprint(i)] = sourceMember{size: 1}
		}
		s := &sourceSession{members: members, memberBytes: len(members)}
		_, err := s.applyLocked(frame)
		require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
		require.Len(t, s.members, maxSourceSessionMembers)
		require.Equal(t, maxSourceSessionMembers, s.memberBytes)
	})
	t.Run("bytes", func(t *testing.T) {
		s := &sourceSession{members: make(map[string]sourceMember), memberBytes: maxSourceSessionBytes}
		_, err := s.applyLocked(frame)
		require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
		require.Empty(t, s.members)
		require.Equal(t, maxSourceSessionBytes, s.memberBytes)
	})
}

func TestSourceUnqualifiedRemoveDeletesIncarnatedMember(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	view := sourceTestOpen(t, ctrl, target)
	open := sourceNextOpen(t, provider)
	record := sourceTestRecord(target.Target, "pod", "incarnation")
	sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(record)}}}})
	sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool { return e.Kind == "snapshotEnd" })
	ref := record.Reference
	ref.Incarnation = nil
	sourceSend(open.stream, resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{Kind: resourcev2.SourceChangeRemove, Reference: &ref}}}})
	waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool { return e.Kind == "changes" && len(e.Removes) == 1 })
	_, found := ctrl.registryStore.Get("p1", record.Reference, target.Target.Route)
	require.False(t, found)
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
}

func TestSourceReopenWindowExpires(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	now := time.Unix(100, 0)
	ticks := make(chan chan time.Time, 4)
	delays := make(chan time.Duration, 4)
	ctrl.sources.now = func() time.Time { return now }
	ctrl.sources.after = func(delay time.Duration) <-chan time.Time {
		ch := make(chan time.Time, 1)
		delays <- delay
		ticks <- ch
		return ch
	}
	view := sourceTestOpen(t, ctrl, target)
	current := sourceNextOpen(t, provider)
	for _, expected := range []time.Duration{time.Second, 5 * time.Second, 15 * time.Second} {
		sourceSend(current.stream, resourcev2.SourceFrame{Reset: &resourcev2.SourceReset{Reason: resourcev2.SourceResetContinuityLost}})
		require.Equal(t, expected, <-delays)
		(<-ticks) <- now
		current = sourceNextOpen(t, provider)
	}
	now = now.Add(sourceReopenWindow + time.Second)
	sourceSend(current.stream, resourcev2.SourceFrame{Reset: &resourcev2.SourceReset{Reason: resourcev2.SourceResetContinuityLost}})
	require.Equal(t, time.Second, <-delays)
	(<-ticks) <- now
	_ = sourceNextOpen(t, provider)
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
}

func TestSourceViewLimitReleasesReservation(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	ctrl.sources.mu.Lock()
	for i := range maxSourceViews {
		ctrl.sources.views[fmt.Sprint(i)] = nil
	}
	ctrl.sources.mu.Unlock()
	_, err := ctrl.OpenSourceView(testInvocationContext(), "p1", HostSourceViewRequest{TargetID: target.TargetID, Target: target.Target, Updates: "ifSupported"})
	require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	ctrl.sources.mu.Lock()
	require.Empty(t, ctrl.sources.sessions)
	ctrl.sources.mu.Unlock()
	_ = provider
}

func TestSourceViewOverflowResetsInline(t *testing.T) {
	s := &sourceSession{coordinator: newSourceCoordinator(&controller{}), pluginGeneration: &pluginState{generationID: "generation"}, members: make(map[string]sourceMember), hasSnapshot: true}
	v := newSourceView(s, "view", "owner", "target")
	v.generation, v.synced = "old", true
	for range sourceViewQueueItems {
		require.True(t, v.appendLocked(v.nextLocked("status")))
	}
	s.mu.Lock()
	v.statusLocked()
	v.mu.Lock()
	require.NotEqual(t, "old", v.generation)
	require.NotNil(t, v.control)
	require.Equal(t, "overflow", v.control.Reset.Reason)
	require.Empty(t, v.queue)
	require.Equal(t, uint64(1), v.sequence)
	v.mu.Unlock()
	s.mu.Unlock()
}

func TestSourceCatalogRevisionOnReopenAndRefresh(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	var revision atomic.Value
	revision.Store("r1")
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalog := canonicalTestCatalog("p1", "native::Pod")
		catalog.Revision = revision.Load().(string)
		catalog.Types[0].Capabilities = append(catalog.Types[0].Capabilities, resourcev2.Capability{Operation: resourcev2.OperationSourceUpdates, Scope: resourcev2.QueryScope{}, Guarantee: resourcev2.ContinuityBestEffort})
		return catalog, nil
	}
	view := sourceTestOpen(t, ctrl, target)
	first := sourceNextOpen(t, provider)
	_, catalog, err := ctrl.routeCatalog(testInvocationContext(), "p1", target.Target.Route)
	require.NoError(t, err)
	require.Equal(t, catalog.Revision, first.revision)
	revision.Store("r2")
	sourceSend(first.stream, resourcev2.SourceFrame{Reset: &resourcev2.SourceReset{Reason: resourcev2.SourceResetBindingChanged}})
	second := sourceNextOpen(t, provider)
	_, catalog, err = ctrl.routeCatalog(testInvocationContext(), "p1", target.Target.Route)
	require.NoError(t, err)
	require.Equal(t, catalog.Revision, second.revision)
	require.NotEqual(t, first.revision, second.revision)
	// A refresh retains the newly admitted binding.
	require.NoError(t, ctrl.RefreshSourceView(testInvocationContext(), "p1", view.ViewID))
	third := sourceNextOpen(t, provider)
	_, catalog, err = ctrl.routeCatalog(testInvocationContext(), "p1", target.Target.Route)
	require.NoError(t, err)
	require.Equal(t, catalog.Revision, third.revision)
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
}

func TestSourceBindingMismatchPreservesOtherSessions(t *testing.T) {
	for _, kind := range []string{"revision", "schema", "reset"} {
		t.Run(kind, func(t *testing.T) {
			ctrl, _, provider, target := sourceTestFixture(t)
			view := sourceTestOpen(t, ctrl, target)
			first := sourceNextOpen(t, provider)
			other, err := ctrl.OpenSourceView(testInvocationContext(), "p1", HostSourceViewRequest{TargetID: target.TargetID, Target: target.Target, Updates: "none"})
			require.NoError(t, err)
			second := sourceNextOpen(t, provider)
			record := sourceTestRecord(target.Target, "other", "")
			sourceSend(second.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: resourcev2.CompactSourceRecord(record)}}}})
			boundary := sourceBoundary(resourcev2.EnumerationExhausted)
			boundary.SnapshotEnd.Continuity = resourcev2.ContinuityNotApplicable
			sourceSend(second.stream, boundary)
			otherSession := retryTestSession(ctrl, other.ViewID)
			require.Eventually(t, func() bool {
				otherSession.mu.Lock()
				defer otherSession.mu.Unlock()
				return otherSession.status.State == "finished"
			}, 5*time.Second, time.Millisecond)
			session := retryTestSession(ctrl, view.ViewID)
			session.mu.Lock()
			epoch := session.ctx.Value(sourceBindingKey{}).(sourceBinding).Epoch
			generation := session.pluginGeneration
			session.mu.Unlock()
			if kind == "reset" {
				sourceSend(first.stream, resourcev2.SourceFrame{Reset: &resourcev2.SourceReset{Reason: resourcev2.SourceResetBindingChanged}})
			} else {
				bad := resourcev2.CompactSourceRecord(sourceTestRecord(target.Target, "pod", ""))
				if kind == "revision" {
					bad.Representation.Revision = "different"
				} else {
					revision := "different"
					bad.Representation.SchemaRevision = &revision
				}
				sourceSend(first.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: bad}}}})
			}
			require.Eventually(t, func() bool {
				session.mu.Lock()
				defer session.mu.Unlock()
				return session.status.State == "failed" && session.status.Error != nil && session.status.Error.Code == "RESET_REQUIRED"
			}, 5*time.Second, time.Millisecond)
			ctrl.pluginsMu.RLock()
			currentEpoch := generation.sourceEpoch[epoch.Connection]
			ctrl.pluginsMu.RUnlock()
			require.Equal(t, epoch.Epoch, currentEpoch)
			_, found := ctrl.registryStore.Get("p1", record.Reference, target.Target.Route)
			require.True(t, found)
			otherSession.mu.Lock()
			require.Equal(t, "finished", otherSession.status.State)
			otherSession.mu.Unlock()
			select {
			case <-provider.opens:
				t.Fatal("unchanged catalog caused another source open")
			default:
			}
			require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", other.ViewID))
			require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
		})
	}
}

func TestSourceAdmissionBindingMismatchRebinds(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	var revision atomic.Value
	revision.Store("r1")
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalog := canonicalTestCatalog("p1", "native::Pod")
		catalog.Revision = revision.Load().(string)
		catalog.Types[0].Capabilities = append(catalog.Types[0].Capabilities, resourcev2.Capability{Operation: resourcev2.OperationSourceUpdates, Scope: resourcev2.QueryScope{}, Guarantee: resourcev2.ContinuityBestEffort})
		return catalog, nil
	}
	view := sourceTestOpen(t, ctrl, target)
	first := sourceNextOpen(t, provider)
	sourceView, err := ctrl.sourceView(testInvocationContext(), "p1", view.ViewID, "resource.SyncSourceView")
	require.NoError(t, err)
	session := sourceView.session
	session.mu.Lock()
	oldEpoch := session.ctx.Value(sourceBindingKey{}).(sourceBinding).Epoch
	session.mu.Unlock()
	revision.Store("r2")
	require.NoError(t, ctrl.RefreshSourceView(testInvocationContext(), "p1", view.ViewID))
	second := sourceNextOpen(t, provider)
	_, catalog, err := ctrl.routeCatalog(testInvocationContext(), "p1", target.Target.Route)
	require.NoError(t, err)
	require.Equal(t, catalog.Revision, second.revision)
	require.NotEqual(t, first.revision, second.revision)
	require.NotEqual(t, first.request.Generation, second.request.Generation)
	session.mu.Lock()
	currentEpoch := session.ctx.Value(sourceBindingKey{}).(sourceBinding).Epoch
	session.mu.Unlock()
	require.Greater(t, currentEpoch.Epoch, oldEpoch.Epoch)
	sourceSend(second.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	require.Eventually(t, func() bool {
		session.mu.Lock()
		defer session.mu.Unlock()
		return session.status.State == "following"
	}, 5*time.Second, time.Millisecond)
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
}

func TestSourceOpenDuringBindingRecovery(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	view := sourceTestOpen(t, ctrl, target)
	first := sourceNextOpen(t, provider)
	sourceSend(first.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	session := retryTestSession(ctrl, view.ViewID)

	// Hold recovery before it can rekey the old session.
	session.mu.Lock()
	locked := true
	t.Cleanup(func() {
		if locked {
			session.mu.Unlock()
		}
	})
	ctrl.pluginsMu.Lock()
	err := ctrl.invalidateSourceRoutesLocked("p1", []string{target.Target.Route.Connection}, false)
	ctrl.pluginsMu.Unlock()
	require.NoError(t, err)
	current := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")

	const opens = 8
	results := make(chan error, opens)
	for range opens {
		go func() {
			_, err := ctrl.OpenSourceView(testInvocationContext(), "p1", HostSourceViewRequest{TargetID: current.TargetID, Target: current.Target, Updates: "ifSupported"})
			results <- err
		}()
	}
	for range opens {
		require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(<-results))
	}
	// A fresh snapshot-only request must not claim the source while an
	// updates session for the same logical target is being rebound.
	_, err = ctrl.OpenSourceView(testInvocationContext(), "p1", HostSourceViewRequest{TargetID: current.TargetID, Target: current.Target, Updates: "none"})
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	ctrl.sources.mu.Lock()
	require.Len(t, ctrl.sources.sessions, 1)
	ctrl.sources.mu.Unlock()
	select {
	case <-provider.opens:
		t.Fatal("open during recovery started a duplicate source")
	default:
	}
	session.mu.Unlock()
	locked = false
	second := sourceNextOpen(t, provider)
	sourceSend(second.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	require.Eventually(t, func() bool {
		session.mu.Lock()
		defer session.mu.Unlock()
		return session.status.State == "following"
	}, 5*time.Second, time.Millisecond)
	another := sourceTestOpen(t, ctrl, current)
	require.Same(t, session, retryTestSession(ctrl, another.ViewID))
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", another.ViewID))
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
}

func TestSourceOpenReportsFailedBindingRecovery(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	view := sourceTestOpen(t, ctrl, target)
	first := sourceNextOpen(t, provider)
	sourceSend(first.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	session := retryTestSession(ctrl, view.ViewID)

	entered := make(chan struct{})
	resume := make(chan struct{})
	var fail atomic.Bool
	catalog := provider.CatalogFunc
	provider.CatalogFunc = func(ctx context.Context, request resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		if fail.CompareAndSwap(true, false) {
			close(entered)
			<-resume
			return resourcev2.Catalog{}, resourcev2.NewError("FORBIDDEN", "Recovery denied.")
		}
		return catalog(ctx, request)
	}
	fail.Store(true)
	ctrl.pluginsMu.Lock()
	err := ctrl.invalidateSourceRoutesLocked("p1", []string{target.Target.Route.Connection}, false)
	ctrl.pluginsMu.Unlock()
	require.NoError(t, err)
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("binding recovery did not start")
	}
	current := admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	request := HostSourceViewRequest{TargetID: current.TargetID, Target: current.Target, Updates: "ifSupported"}
	_, err = ctrl.OpenSourceView(testInvocationContext(), "p1", request)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	require.Contains(t, err.Error(), "Source binding is being renewed.")
	close(resume)
	require.Eventually(t, func() bool {
		session.mu.Lock()
		defer session.mu.Unlock()
		return session.status.State == "failed" && session.status.Error != nil &&
			session.status.Error.Message == "Source session failed."
	}, 5*time.Second, time.Millisecond)
	for _, updates := range []string{"ifSupported", "none"} {
		request.Updates = updates
		opened, err := ctrl.OpenSourceView(testInvocationContext(), "p1", request)
		require.Empty(t, opened.ViewID)
		require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
		require.Contains(t, err.Error(), "Source session failed.")
	}
	select {
	case <-provider.opens:
		t.Fatal("failed binding recovery reopened the source")
	default:
	}
	// A later route epoch must not inherit the earlier recovery failure.
	session.mu.Lock()
	locked := true
	t.Cleanup(func() {
		if locked {
			session.mu.Unlock()
		}
	})
	ctrl.pluginsMu.Lock()
	err = ctrl.invalidateSourceRoutesLocked("p1", []string{target.Target.Route.Connection}, false)
	ctrl.pluginsMu.Unlock()
	require.NoError(t, err)
	current = admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
	request = HostSourceViewRequest{TargetID: current.TargetID, Target: current.Target, Updates: "ifSupported"}
	_, err = ctrl.OpenSourceView(testInvocationContext(), "p1", request)
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	require.Contains(t, err.Error(), "Source binding is being renewed.")
	session.mu.Unlock()
	locked = false
	second := sourceNextOpen(t, provider)
	sourceSend(second.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
}

func TestRecoveringSourceKeyPreservesSourceIdentity(t *testing.T) {
	target := resourcev2.ReadTarget{Route: resourcev2.AccessRoute{Connection: "route"}, Provider: "old", Authority: "old", Type: "type", Representation: "native"}
	key := recoveringSourceKey("plugin", "owner", target)
	changed := target
	changed.Provider, changed.Authority = "new", "new"
	require.Equal(t, key, recoveringSourceKey("plugin", "owner", changed))
	require.NotEqual(t, key, recoveringSourceKey("plugin", "other", changed))
	changed.Route.Connection = "other"
	require.NotEqual(t, key, recoveringSourceKey("plugin", "owner", changed))
	changed = target
	changed.Type = "other"
	require.NotEqual(t, key, recoveringSourceKey("plugin", "owner", changed))
	changed = target
	changed.Representation = "other"
	require.NotEqual(t, key, recoveringSourceKey("plugin", "owner", changed))
}

func TestSourceStartedRouteInvalidationRestartsView(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalog := canonicalTestCatalog("p1", "native::Pod")
		catalog.Types[0].AcquireOnConnect = true
		catalog.Types[0].DefaultRepresentation = catalog.Types[0].Representations[0].ID
		catalog.Types[0].Capabilities = append(catalog.Types[0].Capabilities, resourcev2.Capability{Operation: resourcev2.OperationSourceUpdates, Scope: resourcev2.QueryScope{}, Guarantee: resourcev2.ContinuityBestEffort})
		return catalog, nil
	}
	inventoryCtx, err := ctrl.admit(testInvocationContext(), "resource.OpenSourceView", readTarget("p1", target.Target))
	require.NoError(t, err)
	inventory, _, err := ctrl.sources.acquire(inventoryCtx, "p1", target.Target, "ifSupported", true)
	require.NoError(t, err)
	view := sourceTestOpen(t, ctrl, target)
	viewState, err := ctrl.sourceView(testInvocationContext(), "p1", view.ViewID, "resource.SyncSourceView")
	require.NoError(t, err)
	require.Same(t, inventory, viewState.session, "inventory and view must share the same owner and session")
	waitBoundary := func(stage, previousGeneration string) HostSourceViewEvent {
		t.Helper()
		var found HostSourceViewEvent
		if !assert.Eventually(t, func() bool {
			for _, emitted := range events.EventsWithKey(view.Topic) {
				if len(emitted.Data) != 1 {
					continue
				}
				event, ok := emitted.Data[0].(HostSourceViewEvent)
				if ok && event.Kind == "snapshotEnd" && event.ViewGeneration != previousGeneration && event.Status != nil && event.Status.State == "following" {
					found = event
					return true
				}
			}
			return false
		}, 10*time.Second, time.Millisecond, "%s boundary not received", stage) {
			states, err := ctrl.GetSourceStates(testInvocationContext(), "p1", target.Target.Route)
			t.Fatalf("%s boundary: events=%+v states=%+v error=%v", stage, events.EventsWithKey(view.Topic), states, err)
		}
		return found
	}
	first := sourceNextOpen(t, provider)
	sourceSend(first.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	before := waitBoundary("initial", "")
	ctrl.pluginsMu.Lock()
	err = ctrl.invalidateSourceRoutesLocked("p1", []string{target.Target.Route.Connection}, false)
	ctrl.pluginsMu.Unlock()
	require.NoError(t, err)
	second := sourceNextOpen(t, provider)
	sourceSend(second.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	waitBoundary("recovered", before.ViewGeneration)
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
	select {
	case <-second.stream.closed:
		t.Fatal("closing view retired connection inventory")
	default:
	}
	ctrl.sources.closeInventory("p1", target.Target.Route.Connection)
	select {
	case <-second.stream.closed:
	case <-time.After(time.Second):
		t.Fatal("inventory did not close")
	}
}

func TestSourceCloseInventoryUsesOneSharedDeadline(t *testing.T) {
	sc := newSourceCoordinator(&controller{})
	timers := make(chan time.Duration, 10)
	tick := make(chan time.Time, 1)
	sc.after = func(d time.Duration) <-chan time.Time { timers <- d; return tick }
	var blocked []chan struct{}
	for i := range 3 {
		ctx, cancel := context.WithCancel(context.Background())
		key := fmt.Sprint(i)
		done := make(chan struct{})
		blocked = append(blocked, done)
		sc.sessions[key] = &sourceSession{coordinator: sc, key: key, pluginID: "p1", target: resourcev2.ReadTarget{Route: resourcev2.AccessRoute{Connection: "conn"}}, ctx: ctx, cancel: cancel, inventory: true, done: done, views: make(map[string]*sourceView)}
	}
	defer func() {
		for _, done := range blocked {
			close(done)
		}
	}()
	finished := make(chan struct{})
	go func() { sc.closeInventory("p1", "conn"); close(finished) }()
	require.Equal(t, sourceCloseJoinTimeout, <-timers)
	require.Eventually(t, func() bool {
		sc.mu.Lock()
		defer sc.mu.Unlock()
		return len(sc.sessions) == 0
	}, time.Second, time.Millisecond)
	tick <- time.Now()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("close did not respect its shared deadline")
	}
	select {
	case d := <-timers:
		t.Fatalf("unexpected additional close deadline: %v", d)
	default:
	}
}

func TestSourceCancelledOpenReleasesReservation(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	first := sourceTestOpen(t, ctrl, target)
	open := sourceNextOpen(t, provider)
	view, err := ctrl.sourceView(testInvocationContext(), "p1", first.ViewID, "resource.SyncSourceView")
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(testInvocationContext())
	defer cancel()
	view.session.mu.Lock()
	result := make(chan error, 1)
	started := make(chan struct{})
	go func() {
		close(started)
		_, err := ctrl.OpenSourceView(ctx, "p1", HostSourceViewRequest{TargetID: target.TargetID, Target: target.Target, Updates: "ifSupported"})
		result <- err
	}()
	<-started
	cancel()
	view.session.mu.Unlock()
	require.ErrorIs(t, <-result, context.Canceled)
	view.session.mu.Lock()
	require.Zero(t, view.session.reservations)
	view.session.mu.Unlock()
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", first.ViewID))
	select {
	case <-open.stream.closed:
	case <-time.After(time.Second):
		t.Fatal("last view did not release the session")
	}
}

func sourceDirectTestSession(t *testing.T, opener resourcev2.SourceStreamOpener, mode string) *sourceSession {
	t.Helper()
	ctrl, _, _, target := sourceTestFixture(t)
	_, generation, ctx, cancel, _, _, err := ctrl.sources.prepare(testInvocationContext(), "p1", target.Target, "ifSupported")
	require.NoError(t, err)
	return &sourceSession{coordinator: ctrl.sources, pluginID: "p1", target: target.Target, pluginGeneration: generation, opener: opener, ctx: ctx, cancel: cancel, mode: mode, members: make(map[string]sourceMember), views: make(map[string]*sourceView)}
}

func TestSourceStateEventsAggregateAcrossScopes(t *testing.T) {
	ctrl, events := newTestControllerWithEmitter(t)
	base := &mockProvider{
		CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
			catalog := canonicalTestCatalog("p1", "native::Pod")
			catalog.Types[0].QueryDimensions = []resourcev2.Dimension{{Name: "region"}}
			scope := resourcev2.QueryScope{{Dimension: "region", Match: resourcev2.ScopeAny}}
			catalog.Types[0].Capabilities = []resourcev2.Capability{
				{Operation: resourcev2.OperationEnumerate, Scope: scope},
				{Operation: resourcev2.OperationSourceUpdates, Scope: scope, Guarantee: resourcev2.ContinuityBestEffort},
			}
			return catalog, nil
		},
		StartConnectionFunc: func(_ context.Context, id string) (types.ConnectionStatus, error) {
			return types.ConnectionStatus{Connection: &types.Connection{ID: id}, Status: types.ConnectionStatusConnected}, nil
		},
	}
	provider := &scriptedSourceProvider{mockProvider: base, opens: make(chan scriptedSourceOpen, 4)}
	registerMockPlugin(ctrl, "p1", provider)
	ctx := testInvocationContext()
	_, err := ctrl.StartConnection(ctx, "p1", "conn-1")
	require.NoError(t, err)
	route := resourcev2.AccessRoute{Connection: "conn-1"}
	resolve := func(scope resourcev2.QueryScope) ResolvedTarget {
		target, err := ctrl.ResolveTarget(ctx, "p1", ResolveTargetRequest{Route: route, Type: "native::Pod", Representation: "native", Scope: scope})
		require.NoError(t, err)
		return target
	}
	all := resolve(resourcev2.QueryScope{{Dimension: "region", Match: resourcev2.ScopeAny}})
	require.NoError(t, ctrl.sources.openInventory(ctx, "p1", all.Target))
	inventory := sourceNextOpen(t, provider)
	sourceSend(inventory.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	require.Eventually(t, func() bool {
		states, err := ctrl.GetSourceStates(ctx, "p1", route)
		return err == nil && states.Types["native::Pod"].State == "following"
	}, time.Second, time.Millisecond)
	values := []string{"east"}
	narrow := resolve(resourcev2.QueryScope{{Dimension: "region", Match: resourcev2.ScopeOneOf, Values: &values}})
	view := sourceTestOpen(t, ctrl, narrow)
	stream := sourceNextOpen(t, provider)
	topics := []string{"p1/conn-1/source/STATE", EventSourceState}
	assertState := func(start int, state string) {
		t.Helper()
		require.Eventually(t, func() bool {
			found := map[string]bool{}
			for _, emitted := range events.Events()[start:] {
				if len(emitted.Data) != 1 {
					continue
				}
				event, ok := emitted.Data[0].(HostSourceStateEvent)
				if !ok || event.Type != "native::Pod" {
					continue
				}
				for _, topic := range topics {
					if emitted.Key == topic && event.Status.State == state {
						found[topic] = true
					}
				}
			}
			return found[topics[0]] && found[topics[1]]
		}, time.Second, time.Millisecond)
	}
	assertState(0, "following")
	start := len(events.Events())
	sourceSend(stream.stream, resourcev2.SourceFrame{Failed: &resourcev2.SourceFailure{Code: "FORBIDDEN", Message: "denied"}})
	waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool {
		return e.Kind == "snapshotEnd" && e.Status != nil && e.Status.State == "failed"
	})
	require.NoError(t, ctrl.CloseSourceView(ctx, "p1", view.ViewID))
	states, err := ctrl.GetSourceStates(ctx, "p1", route)
	require.NoError(t, err)
	require.Equal(t, "following", states.Types["native::Pod"].State)
	for _, emitted := range events.Events()[start:] {
		if emitted.Key != topics[0] && emitted.Key != topics[1] {
			continue
		}
		if len(emitted.Data) != 1 {
			continue
		}
		event, ok := emitted.Data[0].(HostSourceStateEvent)
		if ok && event.Type == "native::Pod" {
			require.Equal(t, "following", event.Status.State)
		}
	}
	ctrl.sources.closeInventory("p1", route.Connection)
	assertState(start, "closed")
}

func TestSourceMemberMaterializesAdmittedRepresentation(t *testing.T) {
	record := canonicalTestRecord("provider", "authority", "native::Pod", "pod")
	observation := resourcev2.SourceObservation{
		Record:   resourcev2.CompactSourceRecord(record),
		Metadata: &resourcev2.ResourceMetadata{Labels: map[string]string{"app": "source"}},
	}
	member, _, err := makeSourceMember(observation, maxSourceSessionBytes)
	require.NoError(t, err)
	decoded, err := decodeSourceMember(member)
	require.NoError(t, err)
	session := &sourceSession{ctx: context.WithValue(context.Background(), sourceBindingKey{}, sourceBinding{Representation: record.Representation})}
	require.Equal(t, record, session.fullSourceRecord(decoded.Record))
	require.Equal(t, observation.Metadata, decoded.Metadata)
}
