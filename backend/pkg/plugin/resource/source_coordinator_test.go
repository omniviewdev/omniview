package resource

import (
	"context"
	"io"
	"sync"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
)

type scriptedSourceStream struct {
	frames chan resourcev2.SourceFrame
	closed chan struct{}
	once   sync.Once
}

func (s *scriptedSourceStream) Recv() (resourcev2.SourceFrame, error) {
	select {
	case frame := <-s.frames:
		return frame, nil
	case <-s.closed:
		return resourcev2.SourceFrame{}, io.EOF
	}
}
func (s *scriptedSourceStream) Close() { s.once.Do(func() { close(s.closed) }) }

type scriptedSourceOpen struct {
	request resourcev2.SourceOpenRequest
	stream  *scriptedSourceStream
}

type scriptedSourceProvider struct {
	*mockProvider
	opens chan scriptedSourceOpen
}

func (p *scriptedSourceProvider) Features(context.Context) (resourcev2.FeatureSet, error) {
	return resourcev2.FeatureSet{Traits: []resourcev2.Feature{resourcev2.FeatureConnections, resourcev2.FeatureSourceSessions}}, nil
}
func (p *scriptedSourceProvider) OpenSourceStream(_ context.Context, request resourcev2.SourceOpenRequest) (resourcev2.SourceStream, error) {
	stream := &scriptedSourceStream{frames: make(chan resourcev2.SourceFrame, 16), closed: make(chan struct{})}
	p.opens <- scriptedSourceOpen{request: request, stream: stream}
	return stream, nil
}

func sourceTestFixture(t *testing.T) (*controller, *recordingEmitter, *scriptedSourceProvider, ResolvedTarget) {
	t.Helper()
	ctrl, events := newTestControllerWithEmitter(t)
	base := &mockProvider{
		CatalogFunc: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
			catalog := canonicalTestCatalog("p1", "native::Pod")
			catalog.Types[0].Capabilities = append(catalog.Types[0].Capabilities, resourcev2.Capability{Operation: resourcev2.OperationSourceUpdates, Scope: resourcev2.QueryScope{}, Guarantee: resourcev2.ContinuityBestEffort})
			return catalog, nil
		},
		StartConnectionFunc: func(_ context.Context, id string) (types.ConnectionStatus, error) {
			return types.ConnectionStatus{Connection: &types.Connection{ID: id}, Status: types.ConnectionStatusConnected}, nil
		},
	}
	provider := &scriptedSourceProvider{mockProvider: base, opens: make(chan scriptedSourceOpen, 16)}
	registerMockPlugin(ctrl, "p1", provider)
	_, err := ctrl.StartConnection(testInvocationContext(), "p1", "conn-1")
	require.NoError(t, err)
	return ctrl, events, provider, admittedReadTarget(t, ctrl, "p1", "conn-1", "native::Pod")
}

func sourceTestOpen(t *testing.T, ctrl *controller, target ResolvedTarget) HostSourceViewOpened {
	t.Helper()
	opened, err := ctrl.OpenSourceView(testInvocationContext(), "p1", HostSourceViewRequest{TargetID: target.TargetID, Target: target.Target, Updates: "ifSupported"})
	require.NoError(t, err)
	require.NoError(t, ctrl.SyncSourceView(testInvocationContext(), "p1", opened.ViewID))
	return opened
}
func sourceNextOpen(t *testing.T, provider *scriptedSourceProvider) scriptedSourceOpen {
	t.Helper()
	select {
	case open := <-provider.opens:
		return open
	case <-time.After(5 * time.Second):
		t.Fatal("source open timed out")
		return scriptedSourceOpen{}
	}
}
func sourceSend(stream *scriptedSourceStream, frame resourcev2.SourceFrame) { stream.frames <- frame }
func sourceBoundary(enumeration string) resourcev2.SourceFrame {
	return resourcev2.SourceFrame{SnapshotEnd: &resourcev2.SourceSnapshotEnd{Coverage: resourcev2.SourceCoverage{Enumeration: enumeration, Consistency: resourcev2.ConsistencyBestEffort}, Continuity: resourcev2.ContinuityBestEffort}}
}
func sourceTestRecord(target resourcev2.ReadTarget, id, incarnation string) resourcev2.Record {
	record := canonicalTestRecord(target.Provider, target.Authority, target.Type, id)
	if incarnation != "" {
		record.Reference.Incarnation = &incarnation
	}
	return record
}

func TestSourceCoordinatorSharesAndReleases(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	first := sourceTestOpen(t, ctrl, target)
	open := sourceNextOpen(t, provider)
	second := sourceTestOpen(t, ctrl, target)
	ctrl.sources.mu.Lock()
	require.Len(t, ctrl.sources.sessions, 1)
	ctrl.sources.mu.Unlock()
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", first.ViewID))
	select {
	case <-open.stream.closed:
		t.Fatal("shared stream closed with remaining view")
	default:
	}
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", second.ViewID))
	select {
	case <-open.stream.closed:
	case <-time.After(time.Second):
		t.Fatal("last release did not close stream")
	}
}

func TestSourceCoordinatorSyncWaitsForSnapshotBoundary(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	view := sourceTestOpen(t, ctrl, target)
	open := sourceNextOpen(t, provider)
	record := sourceTestRecord(target.Target, "pod", "")
	sourceSend(open.stream, resourcev2.SourceFrame{Begin: &resourcev2.SourceBegin{Mode: open.request.Mode}})
	sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: record}}}})
	require.Eventually(t, func() bool {
		states, err := ctrl.GetSourceStates(testInvocationContext(), "p1", target.Target.Route)
		return err == nil && states.Types[target.Target.Type].State == "snapshotting"
	}, 5*time.Second, time.Millisecond)
	require.Never(t, func() bool {
		for _, emitted := range events.EventsWithKey(view.Topic) {
			if len(emitted.Data) == 1 {
				if event, ok := emitted.Data[0].(HostSourceViewEvent); ok && event.Kind == "snapshotEnd" {
					return true
				}
			}
		}
		return false
	}, 100*time.Millisecond, time.Millisecond, "view must not complete before the source boundary")
	sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	snapshot := waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool {
		return event.Kind == "snapshot" && len(event.Records) == 1
	})
	end := waitSourceView(t, events, view.Topic, func(event HostSourceViewEvent) bool {
		return event.Kind == "snapshotEnd" && event.Status != nil && event.Status.State == "following"
	})
	require.Equal(t, record, snapshot.Records[0].Record)
	require.Equal(t, snapshot.ViewGeneration, end.ViewGeneration)
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
}

func TestSourceCoordinatorSnapshotAndRemove(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	view := sourceTestOpen(t, ctrl, target)
	open := sourceNextOpen(t, provider)
	record := sourceTestRecord(target.Target, "pod", "new")
	sourceSend(open.stream, resourcev2.SourceFrame{Begin: &resourcev2.SourceBegin{Mode: open.request.Mode}})
	sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: record}}}})
	sourceView, err := ctrl.sourceView(testInvocationContext(), "p1", view.ViewID, "resource.SyncSourceView")
	require.NoError(t, err)
	session := sourceView.session
	require.Eventually(t, func() bool {
		session.mu.Lock()
		defer session.mu.Unlock()
		return len(session.staging) == 1
	}, 5*time.Second, time.Millisecond)
	_, found := ctrl.registryStore.Get("p1", record.Reference, target.Target.Route)
	require.False(t, found, "staged records must not enter registry")
	sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool {
		return e.Kind == "snapshotEnd" && e.Status != nil && e.Status.State == "following"
	})
	_, found = ctrl.registryStore.Get("p1", record.Reference, target.Target.Route)
	require.True(t, found)
	old := record.Reference
	oldIncarnation := "old"
	old.Incarnation = &oldIncarnation
	sourceSend(open.stream, resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{Kind: resourcev2.SourceChangeRemove, Reference: &old}}}})
	updated := record
	updated.Body.Map = map[string]resourcev2.Value{"name": {Kind: "string", String: "changed"}}
	sourceSend(open.stream, resourcev2.SourceFrame{Changes: &resourcev2.SourceChanges{Changes: []resourcev2.SourceChange{{Kind: resourcev2.SourceChangeUpsert, Observation: &resourcev2.SourceObservation{Record: updated}}}}})
	waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool { return e.Kind == "changes" && len(e.Upserts) == 1 })
	_, found = ctrl.registryStore.Get("p1", record.Reference, target.Target.Route)
	require.True(t, found, "old incarnation remove must not delete current record")
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
}

func TestSourceCoordinatorRefreshRetirement(t *testing.T) {
	for _, enumeration := range []string{resourcev2.EnumerationExhausted, resourcev2.EnumerationPartial} {
		t.Run(enumeration, func(t *testing.T) {
			ctrl, events, provider, target := sourceTestFixture(t)
			view := sourceTestOpen(t, ctrl, target)
			first := sourceNextOpen(t, provider)
			record := sourceTestRecord(target.Target, "pod", "")
			sourceSend(first.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: record}}}})
			sourceSend(first.stream, sourceBoundary(resourcev2.EnumerationExhausted))
			waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool {
				return e.Kind == "snapshotEnd" && e.Status != nil && e.Status.State == "following"
			})
			require.NoError(t, ctrl.RefreshSourceView(testInvocationContext(), "p1", view.ViewID))
			second := sourceNextOpen(t, provider)
			sourceSend(second.stream, sourceBoundary(enumeration))
			require.Eventually(t, func() bool {
				states, err := ctrl.GetSourceStates(testInvocationContext(), "p1", target.Target.Route)
				status := states.Types[target.Target.Type]
				return err == nil && status.Coverage != nil && status.Coverage.Enumeration == enumeration && status.State == "following"
			}, 5*time.Second, time.Millisecond)
			_, found := ctrl.registryStore.Get("p1", record.Reference, target.Target.Route)
			require.Equal(t, enumeration == resourcev2.EnumerationPartial, found)
			require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
		})
	}
}

func TestSourceCoordinatorScopeKey(t *testing.T) {
	valuesA := []string{"a", "b"}
	valuesB := []string{"b", "a"}
	target := resourcev2.ReadTarget{Route: resourcev2.AccessRoute{Connection: "conn"}, Provider: "p", Authority: "a", Type: "t", Representation: "native", Scope: resourcev2.QueryScope{{Dimension: "node", Match: resourcev2.ScopeOneOf, Values: &valuesA}}}
	other := target
	other.Scope = resourcev2.QueryScope{{Dimension: "node", Match: resourcev2.ScopeOneOf, Values: &valuesB}}
	require.Equal(t, sourceKey("p", "owner", target, resourcev2.SourceModeSnapshot), sourceKey("p", "owner", other, resourcev2.SourceModeSnapshot))
	valuesC := []string{"c"}
	other.Scope = resourcev2.QueryScope{{Dimension: "node", Match: resourcev2.ScopeOneOf, Values: &valuesC}}
	require.NotEqual(t, sourceKey("p", "owner", target, resourcev2.SourceModeSnapshot), sourceKey("p", "owner", other, resourcev2.SourceModeSnapshot))
}

func TestSourceCoordinatorReopenLimit(t *testing.T) {
	ctrl, _, provider, target := sourceTestFixture(t)
	ticks := make(chan chan time.Time, 3)
	delays := make(chan time.Duration, 3)
	ctrl.sources.now = func() time.Time { return time.Unix(100, 0) }
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
		select {
		case delay := <-delays:
			require.Equal(t, expected, delay)
		case <-time.After(5 * time.Second):
			t.Fatal("missing reopen timer")
		}
		(<-ticks) <- time.Unix(100, 0)
		current = sourceNextOpen(t, provider)
	}
	sourceSend(current.stream, resourcev2.SourceFrame{Reset: &resourcev2.SourceReset{Reason: resourcev2.SourceResetContinuityLost}})
	require.Eventually(t, func() bool {
		states, err := ctrl.GetSourceStates(testInvocationContext(), "p1", target.Target.Route)
		status := states.Types[target.Target.Type]
		return err == nil && status.State == "failed" && status.Error != nil && status.Error.Code == "RESET_REQUIRED"
	}, 5*time.Second, time.Millisecond)
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", view.ViewID))
}

func TestSourceCoordinatorRouteInvalidationClosesView(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	view := sourceTestOpen(t, ctrl, target)
	open := sourceNextOpen(t, provider)
	record := sourceTestRecord(target.Target, "pod", "")
	sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: record}}}})
	sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool {
		return e.Kind == "snapshotEnd" && e.Status != nil && e.Status.State == "following"
	})
	ctrl.pluginsMu.Lock()
	if ctrl.plugins["p1"].sourceEpoch == nil {
		ctrl.plugins["p1"].sourceEpoch = make(map[string]uint64)
	}
	ctrl.plugins["p1"].sourceEpoch[target.Target.Route.Connection]++
	ctrl.pluginsMu.Unlock()
	ctrl.sources.invalidate("p1", target.Target.Route.Connection)
	select {
	case <-open.stream.closed:
	case <-time.After(time.Second):
		t.Fatal("route invalidation did not close stream")
	}
	waitSourceView(t, events, view.Topic, func(e HostSourceViewEvent) bool {
		return e.Kind == "reset" && e.Reset != nil && e.Reset.Reason == "closed"
	})
	ctrl.sources.mu.Lock()
	require.Empty(t, ctrl.sources.sessions)
	ctrl.sources.mu.Unlock()
}

func TestSourceCoordinatorSnapshotLimits(t *testing.T) {
	record := sourceTestRecord(resourcev2.ReadTarget{Provider: "p", Authority: "a", Type: "t"}, "new", "")
	frame := resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{{Record: record}}}}
	t.Run("members", func(t *testing.T) {
		staging := make(map[string]sourceMember, maxSourceSessionMembers)
		for i := range maxSourceSessionMembers {
			staging[time.Unix(int64(i), 0).String()] = sourceMember{size: 1}
		}
		session := &sourceSession{staging: staging}
		_, err := session.applyLocked(frame)
		require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	})
	t.Run("bytes", func(t *testing.T) {
		session := &sourceSession{staging: make(map[string]sourceMember), stagingBytes: maxSourceSessionBytes}
		_, err := session.applyLocked(frame)
		require.Equal(t, "RESOURCE_LIMIT", resourcev2.ErrorCode(err))
	})
}

type blockedSourceOpener struct {
	entered   chan struct{}
	cancelled chan struct{}
}

func (p *blockedSourceOpener) OpenSourceStream(ctx context.Context, _ resourcev2.SourceOpenRequest) (resourcev2.SourceStream, error) {
	close(p.entered)
	<-ctx.Done()
	close(p.cancelled)
	return nil, ctx.Err()
}

func TestSourceCoordinatorPendingOpenCancellation(t *testing.T) {
	opener := &blockedSourceOpener{entered: make(chan struct{}), cancelled: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	s := &sourceSession{
		coordinator: newSourceCoordinator(&controller{}), opener: opener, ctx: ctx, cancel: cancel,
		target: resourcev2.ReadTarget{}, mode: resourcev2.SourceModeSnapshot,
		members: make(map[string]sourceMember), views: make(map[string]*sourceView),
	}
	s.run()
	select {
	case <-opener.entered:
	case <-time.After(time.Second):
		t.Fatal("open did not start")
	}
	s.close()
	select {
	case <-opener.cancelled:
	case <-time.After(time.Second):
		t.Fatal("open context was not cancelled")
	}
}

func TestSourceViewOverflowResetsGeneration(t *testing.T) {
	emitter := newRecordingEmitter()
	ctrl := &controller{emitter: emitter}
	session := &sourceSession{coordinator: newSourceCoordinator(ctrl), pluginGeneration: &pluginState{generationID: "generation"}, members: make(map[string]sourceMember), hasSnapshot: true}
	view := newSourceView(session, "view", "owner", "target")
	view.generation = "old"
	view.synced = true
	for range sourceViewQueueItems {
		require.True(t, view.appendLocked(view.nextLocked("status")))
	}
	view.statusLocked()
	require.Eventually(t, func() bool {
		view.mu.Lock()
		defer view.mu.Unlock()
		return view.control != nil && view.control.Reset != nil && view.control.Reset.Reason == "overflow" && view.generation != "old"
	}, 5*time.Second, time.Millisecond)
	go view.emitLoop()
	reset := waitSourceView(t, emitter, "resource/source-view/view", func(event HostSourceViewEvent) bool {
		return event.Kind == "reset" && event.Reset != nil && event.Reset.Reason == "overflow"
	})
	end := waitSourceView(t, emitter, "resource/source-view/view", func(event HostSourceViewEvent) bool { return event.Kind == "snapshotEnd" })
	require.NotEqual(t, reset.ViewGeneration, end.ViewGeneration)
	require.Equal(t, "1", end.Sequence)
	view.close()
}

type blockedRecvStream struct {
	entered chan struct{}
	release chan struct{}
}

func (s *blockedRecvStream) Recv() (resourcev2.SourceFrame, error) {
	close(s.entered)
	<-s.release
	return resourcev2.SourceFrame{}, io.EOF
}
func (*blockedRecvStream) Close() {}

type blockedRecvOpener struct{ stream *blockedRecvStream }

func (p blockedRecvOpener) OpenSourceStream(context.Context, resourcev2.SourceOpenRequest) (resourcev2.SourceStream, error) {
	return p.stream, nil
}

func TestSourceCoordinatorCloseBoundedWhenRecvStalls(t *testing.T) {
	stream := &blockedRecvStream{entered: make(chan struct{}), release: make(chan struct{})}
	defer close(stream.release)
	ctx, cancel := context.WithCancel(context.Background())
	s := &sourceSession{coordinator: newSourceCoordinator(&controller{}), opener: blockedRecvOpener{stream}, ctx: ctx, cancel: cancel,
		mode: resourcev2.SourceModeSnapshot, members: make(map[string]sourceMember), views: make(map[string]*sourceView)}
	s.run()
	select {
	case <-stream.entered:
	case <-time.After(time.Second):
		t.Fatal("Recv did not start")
	}
	started := time.Now()
	s.close()
	require.Less(t, time.Since(started), sourceCloseJoinTimeout+time.Second)
}

type lateSourceStream struct {
	frame    chan resourcev2.SourceFrame
	returned chan struct{}
}

func (s *lateSourceStream) Recv() (resourcev2.SourceFrame, error) {
	frame := <-s.frame
	close(s.returned)
	return frame, nil
}
func (*lateSourceStream) Close() {}

type lateSourceOpener struct {
	streams chan resourcev2.SourceStream
	opened  chan struct{}
}

func (p *lateSourceOpener) OpenSourceStream(context.Context, resourcev2.SourceOpenRequest) (resourcev2.SourceStream, error) {
	stream := <-p.streams
	p.opened <- struct{}{}
	return stream, nil
}

func TestSourceCoordinatorDropsOldGeneration(t *testing.T) {
	old := &lateSourceStream{frame: make(chan resourcev2.SourceFrame, 1), returned: make(chan struct{})}
	current := &scriptedSourceStream{frames: make(chan resourcev2.SourceFrame, 1), closed: make(chan struct{})}
	opener := &lateSourceOpener{streams: make(chan resourcev2.SourceStream, 2), opened: make(chan struct{}, 2)}
	opener.streams <- old
	opener.streams <- current
	ctx, cancel := context.WithCancel(context.Background())
	s := &sourceSession{coordinator: newSourceCoordinator(&controller{}), opener: opener, ctx: ctx, cancel: cancel,
		mode: resourcev2.SourceModeSnapshotAndUpdates, members: make(map[string]sourceMember), views: make(map[string]*sourceView)}
	s.run()
	<-opener.opened
	require.Eventually(t, func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.stream == old
	}, time.Second, time.Millisecond)
	s.mu.Lock()
	oldDone := s.done
	s.mu.Unlock()
	s.refresh()
	<-opener.opened
	old.frame <- resourcev2.SourceFrame{Begin: &resourcev2.SourceBegin{Mode: resourcev2.SourceModeSnapshotAndUpdates}}
	select {
	case <-oldDone:
	case <-time.After(time.Second):
		t.Fatal("old generation did not exit")
	}
	s.mu.Lock()
	require.Equal(t, "opening", s.status.State, "stale begin must not change the new generation")
	s.mu.Unlock()
	s.close()
}

func TestSourceCoordinatorDifferentScopesOpenSeparateStreams(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
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
	provider := &scriptedSourceProvider{mockProvider: base, opens: make(chan scriptedSourceOpen, 2)}
	registerMockPlugin(ctrl, "p1", provider)
	ctx := testInvocationContext()
	_, err := ctrl.StartConnection(ctx, "p1", "conn-1")
	require.NoError(t, err)
	route := resourcev2.AccessRoute{Connection: "conn-1"}
	var views []HostSourceViewOpened
	for _, region := range []string{"east", "west"} {
		values := []string{region}
		scope := resourcev2.QueryScope{{Dimension: "region", Match: resourcev2.ScopeOneOf, Values: &values}}
		target, err := ctrl.ResolveTarget(ctx, "p1", ResolveTargetRequest{Route: route, Type: "native::Pod", Representation: "native", Scope: scope})
		require.NoError(t, err)
		views = append(views, sourceTestOpen(t, ctrl, target))
	}
	first, second := sourceNextOpen(t, provider), sourceNextOpen(t, provider)
	require.NotEqual(t, first.request.Target.Scope, second.request.Target.Scope)
	ctrl.sources.mu.Lock()
	require.Len(t, ctrl.sources.sessions, 2)
	ctrl.sources.mu.Unlock()
	for _, view := range views {
		require.NoError(t, ctrl.CloseSourceView(ctx, "p1", view.ViewID))
	}
}
