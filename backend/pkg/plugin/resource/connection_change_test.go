package resource

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
)

func profileFenceFixture(t *testing.T) (*controller, *mockProvider, ResolvedReference) {
	t.Helper()
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := connectionOverlayTestProvider(profileTestConnection("route", "A"))
	provider.CatalogFunc = lifecycleTestCatalog("objects")
	registerMockPlugin(ctrl, "plugin", provider)
	_, err := ctrl.replayConnectionProfiles(testInvocationContext(), "plugin", []types.Connection{profileTestConnection("route", "A")})
	require.NoError(t, err)
	ref, err := ctrl.ResolveReference(testInvocationContext(), "plugin", ResolveReferenceRequest{Route: resourcev2.AccessRoute{Connection: "route"}, Type: "objects", Scope: []resourcev2.ScopeEntry{}, ID: "record", Representation: "native"})
	require.NoError(t, err)
	return ctrl, provider, ref
}

func fenceGet(ref ResolvedReference) HostGetRequest {
	return HostGetRequest{TargetID: ref.TargetID, Request: resourcev2.GetRequest{Route: ref.Route, Reference: ref.Reference, Representation: ref.Representation}}
}

func waitProfileFence(t *testing.T, done <-chan error) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(3 * time.Second):
		t.Fatal("profile fence operation did not settle")
		return nil
	}
}

func TestProfileChangeBlocksNewReadsAndRetiresInFlightGetAndCatalog(t *testing.T) {
	ctrl, provider, ref := profileFenceFixture(t)
	getEntered, getResume := make(chan struct{}), make(chan struct{})
	catalogEntered, catalogResume := make(chan struct{}), make(chan struct{})
	applyEntered, applyResume := make(chan struct{}), make(chan struct{})
	var getRelease, catalogRelease, applyRelease sync.Once
	t.Cleanup(func() {
		getRelease.Do(func() { close(getResume) })
		catalogRelease.Do(func() { close(catalogResume) })
		applyRelease.Do(func() { close(applyResume) })
	})
	var reads, catalogues, hookBegin, hookEnd atomic.Int32
	provider.GetFunc = func(_ context.Context, request resourcev2.GetRequest) (resourcev2.Record, error) {
		reads.Add(1)
		close(getEntered)
		<-getResume
		row := canonicalTestRecord(ref.Reference.Address.Provider, request.Reference.Address.Authority, "objects", "record")
		row.Body.Map["endpoint"] = resourcev2.Value{Kind: "string", String: "A"}
		return row, nil
	}
	oldGet := make(chan error, 1)
	go func() { _, err := ctrl.Get(testInvocationContext(), "plugin", fenceGet(ref)); oldGet <- err }()
	<-getEntered
	var blockCatalog atomic.Bool
	blockCatalog.Store(true)
	provider.CatalogFunc = func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
		catalogues.Add(1)
		if blockCatalog.Load() {
			close(catalogEntered)
			<-catalogResume
		}
		return canonicalTestCatalog(ref.Reference.Address.Provider, "objects"), nil
	}
	oldCatalog := make(chan error, 1)
	go func() {
		_, err := ctrl.ResolveReference(testInvocationContext(), "plugin", ResolveReferenceRequest{Route: ref.Route, Type: "objects", Scope: []resourcev2.ScopeEntry{}, ID: "record", Representation: "native"})
		oldCatalog <- err
	}()
	<-catalogEntered
	ctrl.SetConnectionChangeHook(func(plugin, route string) func() {
		require.Equal(t, "plugin", plugin)
		require.Equal(t, "route", route)
		// This read lock would deadlock if the external hook ran under the writer.
		ctrl.pluginsMu.RLock()
		require.True(t, ctrl.plugins[plugin].sourceChanging[route])
		require.Greater(t, ctrl.plugins[plugin].sourceEpoch[route], uint64(0))
		ctrl.pluginsMu.RUnlock()
		hookBegin.Add(1)
		return func() {
			root, err := ctrl.pluginStoreFn(plugin)
			require.NoError(t, err)
			state, err := readDesiredConnections(root)
			require.NoError(t, err)
			require.Equal(t, "B", state.Profiles[0].Configuration.Data["endpoint"])
			hookEnd.Add(1)
		}
	})
	provider.ApplyConnectionOverlayFunc = func(_ context.Context, overlay resourcev2.ConnectionOverlay) error {
		close(applyEntered)
		<-applyResume
		provider.connectionOverlayMu.Lock()
		provider.connectionOverlay = overlay
		provider.connectionOverlayMu.Unlock()
		return nil
	}
	change := make(chan error, 1)
	go func() {
		result, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", profileTestConnection("route", "B"))
		if err == nil && !result.Applied {
			err = errors.New("successful save was not applied")
		}
		change <- err
	}()
	<-applyEntered
	beforeCatalogues := catalogues.Load()
	_, err := ctrl.Get(testInvocationContext(), "plugin", fenceGet(ref))
	require.Equal(t, "UNAVAILABLE", requireAppError(t, err).Code)
	_, err = ctrl.ResolveReference(testInvocationContext(), "plugin", ResolveReferenceRequest{Route: ref.Route, Type: "objects", Scope: []resourcev2.ScopeEntry{}, ID: "record", Representation: "native"})
	require.Equal(t, "UNAVAILABLE", requireAppError(t, err).Code)
	require.Equal(t, int32(1), reads.Load())
	require.Equal(t, beforeCatalogues, catalogues.Load())
	blockCatalog.Store(false)
	catalogRelease.Do(func() { close(catalogResume) })
	getRelease.Do(func() { close(getResume) })
	require.Equal(t, "RESET_REQUIRED", requireAppError(t, waitProfileFence(t, oldGet)).Code)
	require.Equal(t, "RESET_REQUIRED", requireAppError(t, waitProfileFence(t, oldCatalog)).Code)
	_, found := ctrl.registryStore.Get("plugin", ref.Reference, ref.Route)
	require.False(t, found)
	require.Equal(t, int32(1), hookBegin.Load())
	require.Equal(t, int32(0), hookEnd.Load())
	applyRelease.Do(func() { close(applyResume) })
	require.NoError(t, waitProfileFence(t, change))
	require.Equal(t, int32(1), hookEnd.Load())
	_, err = ctrl.Get(testInvocationContext(), "plugin", fenceGet(ref))
	require.Equal(t, "RESET_REQUIRED", requireAppError(t, err).Code)
	require.Equal(t, int32(1), reads.Load(), "old authority must not dispatch against B")
}

func TestProfileRollbackKeepsFenceAndNeverResurrectsOldAuthority(t *testing.T) {
	ctrl, provider, ref := profileFenceFixture(t)
	root, err := ctrl.pluginStoreFn("plugin")
	require.NoError(t, err)
	rollbackEntered, rollbackResume := make(chan struct{}), make(chan struct{})
	var rollbackRelease sync.Once
	t.Cleanup(func() { rollbackRelease.Do(func() { close(rollbackResume) }) })
	var applies, released atomic.Int32
	ctrl.SetConnectionChangeHook(func(string, string) func() { return func() { released.Add(1) } })
	provider.ApplyConnectionOverlayFunc = func(_ context.Context, overlay resourcev2.ConnectionOverlay) error {
		n := applies.Add(1)
		if n == 1 {
			require.NoError(t, root.MkdirAll(connectionProfileStoreName, 0o700))
		} else {
			close(rollbackEntered)
			<-rollbackResume
		}
		provider.connectionOverlayMu.Lock()
		provider.connectionOverlay = overlay
		provider.connectionOverlayMu.Unlock()
		return nil
	}
	change := make(chan error, 1)
	go func() {
		_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", profileTestConnection("route", "B"))
		change <- err
	}()
	<-rollbackEntered
	_, err = ctrl.Get(testInvocationContext(), "plugin", fenceGet(ref))
	require.Equal(t, "UNAVAILABLE", requireAppError(t, err).Code)
	require.Zero(t, released.Load(), "rollback must retain the metric/source fence")
	rollbackRelease.Do(func() { close(rollbackResume) })
	require.Equal(t, "CONFLICT", requireAppError(t, waitProfileFence(t, change)).Code)
	require.Equal(t, int32(1), released.Load())
	current, err := provider.ListConnections(context.Background())
	require.NoError(t, err)
	require.Equal(t, "A", current[0].Data["endpoint"])
	fresh, err := ctrl.ResolveReference(testInvocationContext(), "plugin", ResolveReferenceRequest{Route: ref.Route, Type: "objects", Scope: []resourcev2.ScopeEntry{}, ID: "record", Representation: "native"})
	require.NoError(t, err)
	require.NotEqual(t, ref.Reference.Address.Authority, fresh.Reference.Address.Authority)
}

func TestDisplayOnlyProfileRenamePreservesAuthorityAndSourceEpoch(t *testing.T) {
	ctrl, provider, ref := profileFenceFixture(t)
	var began, ended atomic.Int32
	ctrl.SetConnectionChangeHook(func(string, string) func() { began.Add(1); return func() { ended.Add(1) } })
	ctrl.pluginsMu.RLock()
	before := ctrl.plugins["plugin"].sourceEpoch["route"]
	ctrl.pluginsMu.RUnlock()
	connection := profileTestConnection("route", "A")
	connection.Name = "new display name"
	result, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection)
	require.NoError(t, err)
	require.True(t, result.Applied)
	ctrl.pluginsMu.RLock()
	after := ctrl.plugins["plugin"].sourceEpoch["route"]
	ctrl.pluginsMu.RUnlock()
	require.Equal(t, before, after)
	fresh, err := ctrl.ResolveReference(testInvocationContext(), "plugin", ResolveReferenceRequest{Route: ref.Route, Type: "objects", Scope: []resourcev2.ScopeEntry{}, ID: "record", Representation: "native"})
	require.NoError(t, err)
	require.Equal(t, ref.Reference.Address.Authority, fresh.Reference.Address.Authority)
	actual, err := provider.ListConnections(context.Background())
	require.NoError(t, err)
	require.Equal(t, "new display name", actual[0].Name)
	require.Equal(t, int32(1), began.Load())
	require.Equal(t, int32(1), ended.Load())
}

func TestDiscoveryAndOverlayReplayKeepOuterConfigurationFence(t *testing.T) {
	ctrl, provider, ref := profileFenceFixture(t)
	loadEntered, loadResume := make(chan struct{}), make(chan struct{})
	overlayEntered, overlayResume := make(chan struct{}), make(chan struct{})
	var loadRelease, overlayRelease sync.Once
	t.Cleanup(func() {
		loadRelease.Do(func() { close(loadResume) })
		overlayRelease.Do(func() { close(overlayResume) })
	})
	var sourceMu sync.Mutex
	source := profileTestConnection("route", "A")
	provider.NativeConnectionsFunc = func(context.Context) ([]types.Connection, error) {
		sourceMu.Lock()
		defer sourceMu.Unlock()
		return []types.Connection{source}, nil
	}
	provider.LoadConnectionsFunc = func(context.Context) ([]types.Connection, error) {
		close(loadEntered)
		<-loadResume
		sourceMu.Lock()
		defer sourceMu.Unlock()
		source = profileTestConnection("route", "B")
		return []types.Connection{source}, nil
	}
	provider.ApplyConnectionOverlayFunc = func(_ context.Context, overlay resourcev2.ConnectionOverlay) error {
		close(overlayEntered)
		<-overlayResume
		provider.connectionOverlayMu.Lock()
		provider.connectionOverlay = overlay
		provider.connectionOverlayMu.Unlock()
		return nil
	}
	var began, ended, reads atomic.Int32
	ctrl.SetConnectionChangeHook(func(string, string) func() { began.Add(1); return func() { ended.Add(1) } })
	provider.GetFunc = func(context.Context, resourcev2.GetRequest) (resourcev2.Record, error) {
		reads.Add(1)
		return resourcev2.Record{}, errors.New("must not dispatch")
	}
	done := make(chan error, 1)
	go func() {
		connections, err := ctrl.LoadConnections(testInvocationContext(), "plugin")
		if err == nil && (len(connections) != 1 || connections[0].Data["endpoint"] != "B") {
			err = errors.New("wrong effective source")
		}
		done <- err
	}()
	<-loadEntered
	_, err := ctrl.Get(testInvocationContext(), "plugin", fenceGet(ref))
	require.Equal(t, "UNAVAILABLE", requireAppError(t, err).Code)
	loadRelease.Do(func() { close(loadResume) })
	<-overlayEntered
	require.Equal(t, int32(1), began.Load())
	require.Zero(t, ended.Load())
	_, err = ctrl.Get(testInvocationContext(), "plugin", fenceGet(ref))
	require.Equal(t, "UNAVAILABLE", requireAppError(t, err).Code)
	overlayRelease.Do(func() { close(overlayResume) })
	require.NoError(t, waitProfileFence(t, done))
	require.Zero(t, reads.Load())
	require.Equal(t, int32(1), ended.Load())
}

func TestStopCannotOverlapProfileMutationOrReleaseItsMetricFence(t *testing.T) {
	ctrl, provider, _ := profileFenceFixture(t)
	applyEntered, applyResume := make(chan struct{}), make(chan struct{})
	var applyRelease sync.Once
	t.Cleanup(func() { applyRelease.Do(func() { close(applyResume) }) })
	provider.ApplyConnectionOverlayFunc = func(_ context.Context, overlay resourcev2.ConnectionOverlay) error {
		close(applyEntered)
		<-applyResume
		provider.connectionOverlayMu.Lock()
		provider.connectionOverlay = overlay
		provider.connectionOverlayMu.Unlock()
		return nil
	}
	stopEntered := make(chan struct{})
	provider.StopConnectionFunc = func(context.Context, string) (types.Connection, error) {
		close(stopEntered)
		return profileTestConnection("route", "B"), nil
	}
	var blocked atomic.Int32
	ctrl.SetConnectionChangeHook(func(string, string) func() { blocked.Add(1); return func() { blocked.Add(-1) } })
	saveDone := make(chan error, 1)
	go func() {
		_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", profileTestConnection("route", "B"))
		saveDone <- err
	}()
	<-applyEntered
	stopDone, stopRequested := make(chan error, 1), make(chan struct{})
	go func() {
		close(stopRequested)
		_, err := ctrl.StopConnection(testInvocationContext(), "plugin", "route")
		stopDone <- err
	}()
	<-stopRequested
	select {
	case <-stopEntered:
		t.Fatal("Stop bypassed the configuration transaction")
	case <-time.After(25 * time.Millisecond):
	}
	require.Equal(t, int32(1), blocked.Load())
	applyRelease.Do(func() { close(applyResume) })
	require.NoError(t, waitProfileFence(t, saveDone))
	require.NoError(t, waitProfileFence(t, stopDone))
	require.Zero(t, blocked.Load())
}

func TestQueuedConnectionSnapshotCannotResurrectDisabledNativeProfile(t *testing.T) {
	ctrl, emitter := newTestControllerWithEmitter(t)
	old := profileTestConnection("removed", "old-endpoint")
	old.Lifecycle.AutoConnect = &types.ConnectionAutoConnect{Enabled: true, Triggers: []types.ConnectionAutoConnectTrigger{types.ConnectionAutoConnectTriggerConnectionDiscovered}, Retry: types.ConnectionAutoConnectRetryNone}
	provider := connectionOverlayTestProvider(old)
	registerMockPlugin(ctrl, "plugin", provider)
	_, err := ctrl.replayConnectionProfiles(testInvocationContext(), "plugin", []types.Connection{old})
	require.NoError(t, err)
	require.NoError(t, ctrl.RemoveConnection(testInvocationContext(), "plugin", old.ID))
	provider.WatchConnectionsFunc = func(ctx context.Context, stream chan<- []types.Connection) error {
		stream <- []types.Connection{old}
		close(stream)
		<-ctx.Done()
		return ctx.Err()
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctrl.listenForConnectionEvents(ctx, "plugin", provider, ctrl.plugins["plugin"])
	listed, err := ctrl.ListConnections(testInvocationContext(), "plugin")
	require.NoError(t, err)
	require.Empty(t, listed)
	_, err = ctrl.GetConnection(testInvocationContext(), "plugin", old.ID)
	require.Error(t, err)
	ctrl.autoConnectMu.Lock()
	require.Empty(t, ctrl.autoConnectAttempts)
	ctrl.autoConnectMu.Unlock()
	require.Len(t, emitter.EventsWithKey("plugin/connection/sync"), 1)
}

func TestLoadPublishesBeforeReleasingSerializedConfigurationTransaction(t *testing.T) {
	ctrl, provider, _ := profileFenceFixture(t)
	provider.LoadConnectionsFunc = func(context.Context) ([]types.Connection, error) {
		return []types.Connection{profileTestConnection("route", "A")}, nil
	}
	releasing, resume := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(resume) }) })
	var hooks atomic.Int32
	ctrl.SetConnectionChangeHook(func(string, string) func() {
		if hooks.Add(1) != 1 {
			return nil
		}
		return func() {
			// Publication must already be complete while both source/metric
			// fences and profilesMu are held, not after helper return.
			ctrl.connsMu.RLock()
			require.Len(t, ctrl.connections["plugin"], 1)
			ctrl.connsMu.RUnlock()
			close(releasing)
			<-resume
		}
	})
	loaded := make(chan error, 1)
	go func() { _, err := ctrl.LoadConnections(testInvocationContext(), "plugin"); loaded <- err }()
	<-releasing
	removed, requested := make(chan error, 1), make(chan struct{})
	go func() { close(requested); removed <- ctrl.RemoveConnection(testInvocationContext(), "plugin", "route") }()
	<-requested
	select {
	case err := <-removed:
		t.Fatalf("mutation bypassed held Load transaction: %v", err)
	case <-time.After(25 * time.Millisecond):
	}
	releaseOnce.Do(func() { close(resume) })
	require.NoError(t, waitProfileFence(t, loaded))
	require.NoError(t, waitProfileFence(t, removed))
	listed, err := ctrl.ListConnections(testInvocationContext(), "plugin")
	require.NoError(t, err)
	require.Empty(t, listed)
	profiles, err := ctrl.ListConnectionProfiles(testInvocationContext(), "plugin")
	require.NoError(t, err)
	require.Equal(t, "disabled", profiles[0].Source)
}

func TestRetiredConnectionListenerCannotBorrowReplacementGeneration(t *testing.T) {
	for _, phase := range []string{"queued-before-fetch", "inflight-fetch"} {
		t.Run(phase, func(t *testing.T) {
			ctrl, emitter := newTestControllerWithEmitter(t)
			old := connectionOverlayTestProvider(profileTestConnection("route", "A"))
			registerMockPlugin(ctrl, "plugin", old)
			generationA := ctrl.plugins["plugin"]
			signal, entered, resume := make(chan struct{}), make(chan struct{}), make(chan struct{})
			var resumeOnce sync.Once
			t.Cleanup(func() { resumeOnce.Do(func() { close(resume) }); generationA.watchCancel() })
			var reads atomic.Int32
			old.ListConnectionsFunc = func(context.Context) ([]types.Connection, error) {
				reads.Add(1)
				close(entered)
				<-resume
				return []types.Connection{profileTestConnection("route", "A")}, nil
			}
			old.WatchConnectionsFunc = func(ctx context.Context, stream chan<- []types.Connection) error {
				<-signal
				stream <- []types.Connection{profileTestConnection("route", "A")}
				close(stream)
				<-ctx.Done()
				return ctx.Err()
			}
			done := make(chan error, 1)
			go func() { ctrl.listenForConnectionEvents(generationA.ctx, "plugin", old, generationA); done <- nil }()
			if phase == "inflight-fetch" {
				close(signal)
				<-entered
			}
			ctxB, cancelB := context.WithCancel(context.Background())
			defer cancelB()
			generationB := &pluginState{provider: connectionOverlayTestProvider(profileTestConnection("route", "B")), ctx: ctxB, watchCancel: cancelB, generationID: "replacement-B"}
			// Match actual replacement ordering: publish B before canceling A.
			ctrl.pluginsMu.Lock()
			ctrl.plugins["plugin"] = generationB
			ctrl.pluginsMu.Unlock()
			ctrl.connsMu.Lock()
			ctrl.connections["plugin"] = []types.Connection{profileTestConnection("route", "B")}
			ctrl.connsMu.Unlock()
			require.NoError(t, generationA.ctx.Err(), "old cancellation must not be the fence")
			if phase == "queued-before-fetch" {
				close(signal)
			}
			resumeOnce.Do(func() { close(resume) })
			require.NoError(t, waitProfileFence(t, done))
			if phase == "queued-before-fetch" {
				require.Zero(t, reads.Load())
			} else {
				require.Equal(t, int32(1), reads.Load())
			}
			listed, err := ctrl.ListConnections(testInvocationContext(), "plugin")
			require.NoError(t, err)
			require.Equal(t, "B", listed[0].Data["endpoint"])
			require.Empty(t, emitter.EventsWithKey("plugin/connection/sync"))
			ctrl.autoConnectMu.Lock()
			require.Empty(t, ctrl.autoConnectAttempts)
			ctrl.autoConnectMu.Unlock()
		})
	}
}
