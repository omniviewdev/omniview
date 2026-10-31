package resource

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type metadataTestProvider struct {
	*mockProvider
	get     func(context.Context, string) (resourcev2.ConnectionMetadataSnapshot, error)
	refresh func(context.Context, string) (resourcev2.ConnectionMetadataSnapshot, error)
	watch   func(context.Context, resourcev2.ConnectionMetadataSink) error
}

func (p *metadataTestProvider) GetConnectionMetadata(ctx context.Context, id string) (resourcev2.ConnectionMetadataSnapshot, error) {
	return p.get(ctx, id)
}
func (p *metadataTestProvider) RefreshConnectionMetadata(ctx context.Context, id string) (resourcev2.ConnectionMetadataSnapshot, error) {
	return p.refresh(ctx, id)
}
func (p *metadataTestProvider) WatchConnectionMetadata(ctx context.Context, sink resourcev2.ConnectionMetadataSink) error {
	if p.watch != nil {
		return p.watch(ctx, sink)
	}
	<-ctx.Done()
	return ctx.Err()
}

func metadataTestState(ctrl *controller, pluginID string, provider ResourceProvider) *pluginState {
	registerMockPlugin(ctrl, pluginID, provider)
	state := ctrl.plugins[pluginID]
	state.features = resourcev2.FeatureSet{Traits: []resourcev2.Feature{resourcev2.FeatureConnectionMetadata}}
	state.metadataAvailable = true
	return state
}

func metadataTestEvent(connectionID, revision, value string) resourcev2.ConnectionMetadataEvent {
	observed := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)
	return resourcev2.ConnectionMetadataEvent{Snapshot: resourcev2.ConnectionMetadataSnapshot{
		ConnectionID: connectionID, Generation: "generation", Revision: revision, Active: true,
		Entries: map[string]resourcev2.ConnectionMetadataEntry{"server.version": {State: "current", Value: value, ObservedAt: &observed}},
	}}
}

func TestConnectionMetadataMirrorOrdersTombstonesAndGenerations(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	state := metadataTestState(ctrl, "p", &mockProvider{})
	_, err := ctrl.acceptMetadata("p", state, metadataTestEvent("c", "9", "old"))
	require.NoError(t, err)
	tombstone := metadataTestEvent("c", "10", "")
	tombstone.Removed = true
	removed, err := ctrl.acceptMetadata("p", state, tombstone)
	require.NoError(t, err)
	require.True(t, removed.Removed)
	require.Nil(t, removed.Snapshot)
	late, err := ctrl.acceptMetadata("p", state, metadataTestEvent("c", "9", "late"))
	require.NoError(t, err)
	require.True(t, late.Removed)
	require.Equal(t, "10", late.Revision)
	// Re-addition uses a new generation but the same revision high-water mark.
	newGeneration := metadataTestEvent("c", "11", "new")
	newGeneration.Snapshot.Generation = "next-generation"
	latest, err := ctrl.acceptMetadata("p", state, newGeneration)
	require.NoError(t, err)
	require.Equal(t, "next-generation", latest.Snapshot.Generation)
	require.Len(t, emitter.Events(), 3)
}

func TestConnectionMetadataMirrorOwnsValuesAndOpaqueIdentities(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	first := metadataTestState(ctrl, "a/b", &mockProvider{})
	second := metadataTestState(ctrl, "a", &mockProvider{})
	input := metadataTestEvent("c", "1", "original")
	got, err := ctrl.acceptMetadata("a/b", first, input)
	require.NoError(t, err)
	input.Snapshot.Entries["server.version"] = resourcev2.ConnectionMetadataEntry{State: "current", Value: "mutated-input"}
	got.Snapshot.Entries["server.version"] = resourcev2.ConnectionMetadataEntry{State: "current", Value: "mutated-result"}
	_, err = ctrl.acceptMetadata("a", second, metadataTestEvent("b/c", "1", "other"))
	require.NoError(t, err)
	retained, err := ctrl.acceptMetadata("a/b", first, metadataTestEvent("c", "1", "duplicate"))
	require.NoError(t, err)
	require.Equal(t, "original", retained.Snapshot.Entries["server.version"].Value)
	require.Equal(t, "other", second.metadata["b/c"].Snapshot.Entries["server.version"].Value)
}

func TestConnectionMetadataDelayedFetchCannotOverwriteEvent(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	entered, release := make(chan struct{}), make(chan struct{})
	provider := &metadataTestProvider{mockProvider: &mockProvider{}}
	provider.get = func(context.Context, string) (resourcev2.ConnectionMetadataSnapshot, error) {
		close(entered)
		<-release
		return metadataTestEvent("c", "1", "fetch").Snapshot, nil
	}
	state := metadataTestState(ctrl, "p", provider)
	result := make(chan HostConnectionMetadata, 1)
	errors := make(chan error, 1)
	go func() {
		value, err := ctrl.GetConnectionMetadata(testInvocationContext(), "p", "c")
		result <- value
		errors <- err
	}()
	<-entered
	_, err := ctrl.acceptMetadata("p", state, metadataTestEvent("c", "2", "event"))
	require.NoError(t, err)
	close(release)
	require.NoError(t, <-errors)
	require.Equal(t, "event", (<-result).Snapshot.Entries["server.version"].Value)
}

func TestConnectionMetadataRetiredRegistrationRejectsDelayedFetch(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	entered, release := make(chan struct{}), make(chan struct{})
	provider := &metadataTestProvider{mockProvider: &mockProvider{}}
	provider.get = func(context.Context, string) (resourcev2.ConnectionMetadataSnapshot, error) {
		close(entered)
		<-release
		return metadataTestEvent("c", "999", "retired").Snapshot, nil
	}
	old := metadataTestState(ctrl, "p", provider)
	done := make(chan error, 1)
	go func() { _, err := ctrl.GetConnectionMetadata(testInvocationContext(), "p", "c"); done <- err }()
	<-entered
	replacement := metadataTestState(ctrl, "p", &mockProvider{})
	_, err := ctrl.acceptMetadata("p", replacement, metadataTestEvent("c", "1", "replacement"))
	require.NoError(t, err)
	close(release)
	require.Error(t, <-done)
	require.Equal(t, "replacement", replacement.metadata["c"].Snapshot.Entries["server.version"].Value)
	require.Empty(t, old.metadata)
	require.Len(t, emitter.Events(), 1)
}

func TestConnectionMetadataDistinguishesUnsupportedEmptyMissingAndUnreachable(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "unsupported", &mockProvider{})
	ctrl.connections["unsupported"] = []types.Connection{{ID: "c"}}
	unsupported, err := ctrl.GetConnectionMetadata(testInvocationContext(), "unsupported", "c")
	require.NoError(t, err)
	require.False(t, unsupported.Supported)
	_, err = ctrl.GetConnectionMetadata(testInvocationContext(), "unsupported", "missing")
	require.Error(t, err)
	provider := &metadataTestProvider{mockProvider: &mockProvider{}}
	provider.get = func(_ context.Context, id string) (resourcev2.ConnectionMetadataSnapshot, error) {
		if id == "missing" {
			return resourcev2.ConnectionMetadataSnapshot{}, resourcev2.NewError("NOT_FOUND", "Unknown connection.")
		}
		return resourcev2.ConnectionMetadataSnapshot{ConnectionID: id, Revision: "1", Entries: map[string]resourcev2.ConnectionMetadataEntry{}}, nil
	}
	metadataTestState(ctrl, "supported", provider)
	empty, err := ctrl.GetConnectionMetadata(testInvocationContext(), "supported", "c")
	require.NoError(t, err)
	require.True(t, empty.Supported)
	require.NotNil(t, empty.Snapshot)
	require.Empty(t, empty.Snapshot.Entries)
	_, err = ctrl.GetConnectionMetadata(testInvocationContext(), "supported", "missing")
	require.Error(t, err)
	_, err = ctrl.GetConnectionMetadata(testInvocationContext(), "unreachable", "c")
	require.Error(t, err)
}

func TestConnectionMetadataRefreshUsesExplicitAcquisitionOnly(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	reads, refreshes := 0, 0
	provider := &metadataTestProvider{mockProvider: &mockProvider{}}
	provider.get = func(context.Context, string) (resourcev2.ConnectionMetadataSnapshot, error) {
		reads++
		return metadataTestEvent("c", "1", "read").Snapshot, nil
	}
	provider.refresh = func(context.Context, string) (resourcev2.ConnectionMetadataSnapshot, error) {
		refreshes++
		return metadataTestEvent("c", "2", "refresh").Snapshot, nil
	}
	metadataTestState(ctrl, "p", provider)
	_, err := ctrl.GetConnectionMetadata(testInvocationContext(), "p", "c")
	require.NoError(t, err)
	require.Equal(t, 0, refreshes)
	_, err = ctrl.RefreshConnectionMetadata(testInvocationContext(), "p", "c")
	require.NoError(t, err)
	require.Equal(t, 1, reads)
	require.Equal(t, 1, refreshes)
}

func TestConnectionMetadataStopRetainsSDKStateButRevokesTransport(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	state := metadataTestState(ctrl, "p", &mockProvider{})
	_, err := ctrl.acceptMetadata("p", state, metadataTestEvent("c", "1", "retained"))
	require.NoError(t, err)
	state.watchCancel()
	ctrl.retireMetadata("p", state)
	require.False(t, state.metadataAvailable)
	// Host cannot invent a stale SDK entry or a new revision when transport stops.
	require.Equal(t, "1", state.metadata["c"].Revision)
	require.Equal(t, "current", state.metadata["c"].Snapshot.Entries["server.version"].State)
	require.True(t, state.metadata["c"].Snapshot.Active)
	_, err = ctrl.acceptMetadata("p", state, metadataTestEvent("c", "2", "late"))
	require.ErrorIs(t, err, context.Canceled)
	require.Len(t, emitter.Events(), 2)
}

func TestConnectionMetadataInvalidResponseCannotPoisonHighWaterMark(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	state := metadataTestState(ctrl, "p", &mockProvider{})
	_, err := ctrl.acceptMetadata("p", state, metadataTestEvent("c", "not-a-revision", "bad"))
	require.Error(t, err)
	invalidJSON := metadataTestEvent("c", "100", "bad")
	invalidJSON.Snapshot.Entries["server.version"] = resourcev2.ConnectionMetadataEntry{State: "current", Value: make(chan int)}
	_, err = ctrl.acceptMetadata("p", state, invalidJSON)
	require.Error(t, err)
	require.Empty(t, state.metadata)
	valid, err := ctrl.acceptMetadata("p", state, metadataTestEvent("c", "1", "valid"))
	require.NoError(t, err)
	require.Equal(t, "1", valid.Revision)
	require.Len(t, emitter.Events(), 1)
}

func TestConnectionMetadataClonePreservesJSONNumbersAndNull(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	state := metadataTestState(ctrl, "p", &mockProvider{})
	event := metadataTestEvent("c", "1", "")
	entry := event.Snapshot.Entries["server.version"]
	entry.Value = map[string]any{"number": json.Number("1.25"), "null": nil}
	event.Snapshot.Entries["server.version"] = entry
	got, err := ctrl.acceptMetadata("p", state, event)
	require.NoError(t, err)
	value := got.Snapshot.Entries["server.version"].Value.(map[string]any)
	require.Equal(t, json.Number("1.25"), value["number"])
	require.Contains(t, value, "null")
	require.Nil(t, value["null"])
	value["number"] = json.Number("2.5")
	delete(value, "null")
	retained := state.metadata["c"].Snapshot.Entries["server.version"].Value.(map[string]any)
	require.Equal(t, json.Number("1.25"), retained["number"])
	require.Contains(t, retained, "null")
	require.Nil(t, retained["null"])
}

func TestConnectionMetadataUnaryFailurePreservesLiveWatch(t *testing.T) {
	for _, refresh := range []bool{false, true} {
		name := "get"
		if refresh {
			name = "refresh"
		}
		t.Run(name, func(t *testing.T) {
			ctrl, emitter := newTestControllerWithEmitter(t)
			watching := make(chan resourcev2.ConnectionMetadataSink, 1)
			provider := &metadataTestProvider{mockProvider: &mockProvider{}}
			failure := status.Error(codes.Unavailable, "connection metadata unavailable")
			fail := func(context.Context, string) (resourcev2.ConnectionMetadataSnapshot, error) {
				return resourcev2.ConnectionMetadataSnapshot{}, failure
			}
			provider.get, provider.refresh = fail, fail
			provider.watch = func(ctx context.Context, sink resourcev2.ConnectionMetadataSink) error {
				watching <- sink
				<-ctx.Done()
				return ctx.Err()
			}
			state := metadataTestState(ctrl, "p", provider)
			ctrl.startMetadata("p", state, provider)
			var sink resourcev2.ConnectionMetadataSink
			select {
			case sink = <-watching:
			case <-time.After(3 * time.Second):
				t.Fatal("metadata stream did not start")
			}
			for _, id := range []string{"a", "b"} {
				require.NoError(t, sink(metadataTestEvent(id, "1", "retained")))
			}
			ctrl.pluginsMu.RLock()
			epoch := state.metadataEpoch
			ctrl.pluginsMu.RUnlock()
			emitter.Reset()

			_, err := ctrl.connectionMetadata(testInvocationContext(), "p", "a", refresh)
			require.ErrorIs(t, err, failure)
			ctrl.pluginsMu.RLock()
			available, currentEpoch := state.metadataAvailable, state.metadataEpoch
			a, b := cloneMetadata(state.metadata["a"]), cloneMetadata(state.metadata["b"])
			ctrl.pluginsMu.RUnlock()
			require.True(t, available)
			require.Equal(t, epoch, currentEpoch)
			require.True(t, a.TransportAvailable)
			require.True(t, b.TransportAvailable)
			require.Equal(t, "retained", b.Snapshot.Entries["server.version"].Value)
			require.Empty(t, emitter.Events())

			require.NoError(t, sink(metadataTestEvent("a", "2", "updated")))
			ctrl.pluginsMu.RLock()
			available, currentEpoch = state.metadataAvailable, state.metadataEpoch
			a, b = cloneMetadata(state.metadata["a"]), cloneMetadata(state.metadata["b"])
			ctrl.pluginsMu.RUnlock()
			require.True(t, available)
			require.Equal(t, epoch, currentEpoch)
			require.Equal(t, "2", a.Revision)
			require.Equal(t, "updated", a.Snapshot.Entries["server.version"].Value)
			require.True(t, b.TransportAvailable)
			require.Equal(t, "1", b.Revision)
			require.Equal(t, "retained", b.Snapshot.Entries["server.version"].Value)
			require.Len(t, emitter.Events(), 1)
		})
	}
}

func TestConnectionMetadataWatchRetriesAndResynchronizesSameRevision(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	reconnected := make(chan resourcev2.ConnectionMetadataSink, 1)
	failed := make(chan resourcev2.ConnectionMetadataSink, 1)
	attempts := 0
	provider := &metadataTestProvider{mockProvider: &mockProvider{}}
	provider.watch = func(ctx context.Context, sink resourcev2.ConnectionMetadataSink) error {
		attempts++
		if attempts == 1 {
			failed <- sink
			if err := sink(metadataTestEvent("c", "1", "retained")); err != nil {
				return err
			}
			return context.DeadlineExceeded
		}
		reconnected <- sink
		<-ctx.Done()
		return ctx.Err()
	}
	state := metadataTestState(ctrl, "p", provider)
	state.metadataAvailable = false
	epoch := state.metadataEpoch
	ctrl.startMetadata("p", state, provider)
	var sink resourcev2.ConnectionMetadataSink
	select {
	case sink = <-reconnected:
	case <-time.After(3 * time.Second):
		t.Fatal("metadata stream did not reconnect")
	}
	ctrl.pluginsMu.RLock()
	available, connectionAvailable := state.metadataAvailable, state.metadata["c"].TransportAvailable
	currentEpoch := state.metadataEpoch
	ctrl.pluginsMu.RUnlock()
	require.Greater(t, currentEpoch, epoch)
	require.ErrorIs(t, (<-failed)(metadataTestEvent("c", "2", "late")), context.Canceled)
	require.False(t, available)
	require.False(t, connectionAvailable)
	require.NoError(t, sink(metadataTestEvent("c", "1", "retained")))
	ctrl.pluginsMu.RLock()
	available, connectionAvailable = state.metadataAvailable, state.metadata["c"].TransportAvailable
	revision := state.metadata["c"].Revision
	ctrl.pluginsMu.RUnlock()
	require.True(t, available)
	require.True(t, connectionAvailable)
	require.Equal(t, "1", revision)
}

func TestConnectionMetadataReadResynchronizesOnlyRequestedConnection(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	state := metadataTestState(ctrl, "p", &mockProvider{})
	for _, id := range []string{"a", "b"} {
		_, err := ctrl.acceptMetadata("p", state, metadataTestEvent(id, "1", "value"))
		require.NoError(t, err)
	}
	epoch := state.metadataEpoch
	ctrl.retireMetadata("p", state)
	_, err := ctrl.admitMetadata("p", state, metadataTestEvent("a", "1", "value"), false, epoch)
	require.ErrorIs(t, err, context.Canceled)
	got, err := ctrl.acceptMetadata("p", state, metadataTestEvent("a", "1", "value"))
	require.NoError(t, err)
	require.True(t, got.TransportAvailable)
	require.True(t, state.metadata["a"].TransportAvailable)
	require.False(t, state.metadata["b"].TransportAvailable)
	require.False(t, state.metadataAvailable)
}

type metadataReplacementProvider struct {
	*metadataTestProvider
	entered chan struct{}
	release chan struct{}
}

func (p *metadataReplacementProvider) Features(ctx context.Context) (resourcev2.FeatureSet, error) {
	close(p.entered)
	select {
	case <-p.release:
		return resourcev2.FeatureSet{Traits: []resourcev2.Feature{resourcev2.FeatureConnectionMetadata}}, nil
	case <-ctx.Done():
		return resourcev2.FeatureSet{}, ctx.Err()
	}
}

func TestConnectionMetadataReplacementRevokesOldTransportBeforeReadiness(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	old := metadataTestState(ctrl, "p", &mockProvider{})
	_, err := ctrl.acceptMetadata("p", old, metadataTestEvent("c", "1", "old"))
	require.NoError(t, err)
	emitter.Reset()
	next := &metadataReplacementProvider{
		metadataTestProvider: &metadataTestProvider{mockProvider: &mockProvider{}},
		entered:              make(chan struct{}),
		release:              make(chan struct{}),
	}
	done := make(chan error, 1)
	go func() {
		done <- ctrl.OnPluginStart("p", defaultMeta(), plugintypes.NewInProcessBackend(map[string]interface{}{"resource": next}))
	}()
	select {
	case <-next.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("replacement did not reach feature negotiation")
	}
	// The replacement is not ready, so only the retiring registration may emit.
	events := emitter.EventsWithKey(EventConnectionMetadata)
	require.Len(t, events, 1)
	retirement := events[0].Data[0].(HostConnectionMetadata)
	require.Equal(t, old.generationID, retirement.RegistrationID)
	require.False(t, retirement.TransportAvailable)
	require.Empty(t, retirement.ConnectionID)
	ctrl.pluginsMu.RLock()
	oldAvailable := old.metadata["c"].TransportAvailable
	ctrl.pluginsMu.RUnlock()
	require.False(t, oldAvailable)
	close(next.release)
	require.NoError(t, <-done)
}
