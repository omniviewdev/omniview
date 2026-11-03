package resource

import (
	"fmt"
	"sync"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/require"
)

type pausedSnapshotEmitter struct {
	EventEmitter
	once    sync.Once
	entered chan struct{}
	release chan struct{}
}

func (e *pausedSnapshotEmitter) Emit(key string, data ...any) {
	if len(data) == 1 {
		if state, ok := data[0].(HostSourceStateEvent); ok && state.Status.State == "following" {
			e.once.Do(func() {
				close(e.entered)
				<-e.release
			})
		}
	}
	e.EventEmitter.Emit(key, data...)
}

func TestSourceSnapshotEndDoesNotBlockOtherSessionOpen(t *testing.T) {
	ctrl, events, provider, target := sourceTestFixture(t)
	request := HostSourceViewRequest{TargetID: target.TargetID, Target: target.Target, Updates: "none"}
	other, err := ctrl.OpenSourceView(testInvocationContext(), "p1", request)
	require.NoError(t, err)
	sourceNextOpen(t, provider)
	view := sourceTestOpen(t, ctrl, target)
	open := sourceNextOpen(t, provider)

	emitter := &pausedSnapshotEmitter{EventEmitter: events, entered: make(chan struct{}), release: make(chan struct{})}
	ctrl.emitter = emitter
	var unblock sync.Once
	defer unblock.Do(func() { close(emitter.release) })
	sourceSend(open.stream, resourcev2.SourceFrame{Begin: &resourcev2.SourceBegin{Mode: open.request.Mode}})
	for batch := range 16 {
		observations := make([]resourcev2.SourceObservation, 256)
		for i := range observations {
			observations[i].Record = resourcev2.CompactSourceRecord(sourceTestRecord(target.Target, fmt.Sprintf("pod-%d", batch*256+i), ""))
		}
		sourceSend(open.stream, resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: observations}})
	}
	sourceSend(open.stream, sourceBoundary(resourcev2.EnumerationExhausted))
	select {
	case <-emitter.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("snapshot boundary did not reach publication")
	}

	ctrl.sources.mu.Lock()
	v := ctrl.sources.views[view.ViewID]
	ctrl.sources.mu.Unlock()
	started := make(chan struct{})
	released := make(chan struct{})
	go func() {
		close(started)
		ctrl.sources.release(v.session, v)
		close(released)
	}()
	<-started
	// Let release contend with the snapshot boundary before opening another view.
	time.Sleep(50 * time.Millisecond)
	type openResult struct {
		view HostSourceViewOpened
		err  error
	}
	opened := make(chan openResult, 1)
	go func() {
		view, err := ctrl.OpenSourceView(testInvocationContext(), "p1", request)
		opened <- openResult{view: view, err: err}
	}()
	var second HostSourceViewOpened
	select {
	case result := <-opened:
		require.NoError(t, result.err)
		second = result.view
	case <-time.After(5 * time.Second):
		t.Error("opening another session blocked behind snapshot publication")
	}
	unblock.Do(func() { close(emitter.release) })
	select {
	case <-released:
	case <-time.After(5 * time.Second):
		t.Fatal("release did not complete")
	}
	if second.ViewID != "" {
		require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", second.ViewID))
	}
	require.NoError(t, ctrl.CloseSourceView(testInvocationContext(), "p1", other.ViewID))
}
