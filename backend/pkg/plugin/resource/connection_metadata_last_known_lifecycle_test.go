package resource

import (
	"context"
	"errors"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// mergeSnapshot prepares snapshot as an admission does, and merges it into conn.
func mergeSnapshot(conn *lastKnownConnection, snapshot resourcev2.ConnectionMetadataSnapshot, limits lastKnownLimits, drops *lastKnownDrops) bool {
	store := &lastKnownMetadata{limits: limits}
	return conn.merge(snapshot, store.prepare(snapshot), limits, drops)
}

// startSDKProvider is a host controller on svc in front of a real SDK controller, with one connection, "c1", whose metadata callback
// answers with update. The provider is returned for what only the SDK can do: change the connection.
func startSDKProvider(t *testing.T, svc *appstate.Service, update func() resourcev2.ConnectionMetadataUpdate) (*controller, *resourcev2.Controller[struct{}]) {
	t.Helper()
	provider, err := resourcev2.NewController(resourcev2.Config[struct{}]{
		Catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
			return resourcev2.Catalog{Provider: "sdk-fixture", Revision: "1", Types: []resourcev2.ResourceType{}, Coverage: resourcev2.Coverage{Kind: "complete"}}, nil
		},
		Lifecycle: &resourcev2.Lifecycle[struct{}]{
			LoadConnections: func(context.Context) ([]types.Connection, error) {
				return []types.Connection{{ID: "c1", Name: "c1", Data: map[string]any{"server": "https://old.example.com"}}}, nil
			},
			CreateClient:  func(context.Context, types.Connection) (*struct{}, error) { return &struct{}{}, nil },
			DestroyClient: func(context.Context, *struct{}) error { return nil },
		},
		ConnectionMetadata: func(context.Context, types.Connection, *struct{}) (resourcev2.ConnectionMetadataUpdate, error) {
			return update(), nil
		},
	})
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, provider.Close()) })
	backend, err := plugintypes.ComposeNativeBackend(plugintypes.NativeProviders{Resource: provider})
	require.NoError(t, err)
	ctrl, _ := newLastKnownController(t, svc)
	ctrl.OnPluginInit("p", defaultMeta())
	require.NoError(t, ctrl.OnPluginStartWithoutAutoConnect("p", defaultMeta(), backend))
	t.Cleanup(func() { _ = ctrl.OnPluginStop("p", defaultMeta()) })
	return ctrl, provider
}

func TestConnectionMetadataLastKnownIsForgottenWhenTheSDKClearsAChangedConnection(t *testing.T) {
	svc := appstate.NewTestService(t)
	at := time.Now().UTC().Truncate(time.Millisecond)
	ctrl, provider := startSDKProvider(t, svc, func() resourcev2.ConnectionMetadataUpdate {
		return resourcev2.ConnectionMetadataUpdate{Set: map[string]resourcev2.ConnectionMetadataObservation{
			"kubernetes.server_version": {State: "success", Value: "v1.30.1", ObservedAt: at},
		}, Remove: nil}
	})
	_, err := ctrl.StartConnection(testInvocationContext(), "p", "c1")
	require.NoError(t, err)
	metadataEventually(t, ctrl, func(s *resourcev2.ConnectionMetadataSnapshot) bool {
		return s.Active && !s.Refreshing && s.Entries["kubernetes.server_version"].State == metadataStateCurrent
	})

	// A plain stop keeps what was answered, stale: that is the point of keeping it.
	_, err = ctrl.StopConnection(testInvocationContext(), "p", "c1")
	require.NoError(t, err)
	metadataEventually(t, ctrl, func(s *resourcev2.ConnectionMetadataSnapshot) bool {
		return !s.Active && s.Entries["kubernetes.server_version"].State == metadataStateStale
	})
	require.Len(t, keptEntries(ctrl, "p", "c1"), 1)

	// The connection is edited so that it points elsewhere. The SDK clears the facts of the old endpoint on purpose, and what the
	// host kept of them goes too, instead of being served for a connection that is no longer the one that answered.
	require.NoError(t, provider.ApplyConnections(context.Background(), []types.Connection{
		{ID: "c1", Name: "c1", Data: map[string]any{"server": "https://new.example.com"}},
	}))
	metadataEventually(t, ctrl, func(s *resourcev2.ConnectionMetadataSnapshot) bool { return !s.Active && len(s.Entries) == 0 })
	require.Empty(t, keptEntries(ctrl, "p", "c1"))
	ctrl.lastKnown.shutdown()
	require.NoFileExists(t, lastKnownStorePath(svc, "p"))
}

func TestConnectionMetadataLastKnownIsForgottenWithAProfileChange(t *testing.T) {
	cases := []struct {
		name string
		op   func(t *testing.T, ctrl *controller, state *pluginState)
	}{
		{"a save that changes nothing the SDK would clear", func(t *testing.T, ctrl *controller, _ *pluginState) {
			_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "p", types.Connection{ID: "c1", Name: "renamed"}, nil)
			require.NoError(t, err)
		}},
		{"a reset", func(t *testing.T, ctrl *controller, state *pluginState) {
			_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "p", types.Connection{ID: "c1", Name: "c1"}, nil)
			require.NoError(t, err)
			// Answered again after the save, so that the reset is what drops it.
			_, err = ctrl.acceptMetadata("p", state, answerEvent("c1", "6", versionAt("v1.30.2", lastKnownObserved().Add(time.Hour))))
			require.NoError(t, err)
			require.NotEmpty(t, keptEntries(ctrl, "p", "c1"))
			_, err = ctrl.ResetConnectionProfile(testInvocationContext(), "p", "c1")
			require.NoError(t, err)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := appstate.NewTestService(t)
			ctrl, timers := newLastKnownController(t, svc)
			state := metadataTestState(ctrl, "p", &metadataTestProvider{mockProvider: connectionOverlayTestProvider()})
			for _, id := range []string{"c1", "c2"} {
				_, err := ctrl.acceptMetadata("p", state, answerEvent(id, "5", serverVersion("v1.30.1")))
				require.NoError(t, err)
			}
			timers.fire()

			tc.op(t, ctrl, state)
			timers.fire()

			require.Empty(t, keptEntries(ctrl, "p", "c1"))
			require.NotEmpty(t, keptEntries(ctrl, "p", "c2"), "only the connection that changed is dropped")
			stored, err := os.ReadFile(lastKnownStorePath(svc, "p"))
			require.NoError(t, err)
			require.NotContains(t, string(stored), `"c1"`)
		})
	}
}

func TestConnectionMetadataLastKnownIsSettledWhenThePluginStops(t *testing.T) {
	svc := appstate.NewTestService(t)
	ctrl, timers := newLastKnownController(t, svc)
	state := metadataTestState(ctrl, "p", &mockProvider{})
	_, err := ctrl.acceptMetadata("p", state, answerEvent("c", "1", serverVersion("v1")))
	require.NoError(t, err)
	require.Len(t, timers.armed(), 1)
	require.NoFileExists(t, lastKnownStorePath(svc, "p"))

	require.NoError(t, ctrl.OnPluginStop("p", defaultMeta()))

	// What was pending is written before the stop returns, and the timer that waited for the debounce is gone.
	require.FileExists(t, lastKnownStorePath(svc, "p"))
	require.Empty(t, timers.armed())
	// Nothing is written afterwards: the stopped registration is refused, and no timer is left to fire.
	require.NoError(t, os.Remove(lastKnownStorePath(svc, "p")))
	_, err = ctrl.acceptMetadata("p", state, answerEvent("c", "2", serverVersion("v2")))
	require.ErrorIs(t, err, context.Canceled)
	timers.fire()
	require.NoFileExists(t, lastKnownStorePath(svc, "p"))
}

func TestConnectionMetadataLastKnownErasureKeepsTheEntryUntilTheFileIsGone(t *testing.T) {
	svc := appstate.NewTestService(t)
	ctrl, timers := newLastKnownController(t, svc)
	state := metadataTestState(ctrl, "p", &mockProvider{})
	_, err := ctrl.acceptMetadata("p", state, answerEvent("c1", "1", serverVersion("v1")))
	require.NoError(t, err)
	timers.fire()
	require.FileExists(t, lastKnownStorePath(svc, "p"))

	// The removal of the file is in flight when a reader warms the plugin.
	entered, release := make(chan struct{}), make(chan struct{})
	releaseRemoval := sync.OnceFunc(func() { close(release) })
	erasing := make(chan struct{})
	// Registered after the controller's cleanups, so it runs before them: the erasure that is blocked is let go, and ends, before the
	// state service closes under it.
	t.Cleanup(func() { releaseRemoval(); <-erasing })
	var blocking atomic.Bool
	blocking.Store(true)
	ctrl.lastKnown.storeFn = func(id string) (*appstate.ScopedRoot, error) {
		if blocking.CompareAndSwap(true, false) {
			close(entered)
			<-release
		}
		return svc.PluginStore(id)
	}
	erased := make(chan error, 1)
	go func() { defer close(erasing); erased <- ctrl.OnPluginUninstalled("p") }()
	<-entered
	known := ctrl.lastKnown.warm("p")
	ctrl.lastKnown.mu.Lock()
	gone, same := known.gone, ctrl.lastKnown.plugins["p"] == known
	ctrl.lastKnown.mu.Unlock()
	require.True(t, gone, "a reader finds the entry that is being erased, not a copy of the file that is about to go")
	require.True(t, same)
	require.Empty(t, keptEntries(ctrl, "p", "c1"))

	releaseRemoval()
	require.NoError(t, <-erased)
	require.NoFileExists(t, lastKnownStorePath(svc, "p"))
	ctrl.lastKnown.mu.Lock()
	_, present := ctrl.lastKnown.plugins["p"]
	ctrl.lastKnown.mu.Unlock()
	require.False(t, present, "and the entry goes once the file is gone")
}

func TestConnectionMetadataLastKnownARetiredRegistrationCannotBringAnUninstalledPluginBack(t *testing.T) {
	svc := appstate.NewTestService(t)
	ctrl, _ := newLastKnownController(t, svc)
	state := metadataTestState(ctrl, "p", &mockProvider{})
	_, err := ctrl.acceptMetadata("p", state, answerEvent("c", "1", serverVersion("v1")))
	require.NoError(t, err)
	require.NoError(t, ctrl.OnPluginStop("p", defaultMeta()))
	require.NoError(t, svc.Plugins().RemoveAll("p"))
	svc.ReleasePluginRoots("p")
	require.NoError(t, ctrl.OnPluginUninstalled("p"))

	_, err = ctrl.acceptMetadata("p", state, answerEvent("c", "2", serverVersion("late")))

	require.ErrorIs(t, err, context.Canceled)
	ctrl.lastKnown.mu.Lock()
	_, present := ctrl.lastKnown.plugins["p"]
	ctrl.lastKnown.mu.Unlock()
	require.False(t, present, "the refused admission read nothing and made no entry")
}

func TestConnectionMetadataLastKnownErasureDuringAWriteIsWrittenAtOnce(t *testing.T) {
	svc := appstate.NewTestService(t)
	ctrl, timers := newLastKnownController(t, svc)
	state := metadataTestState(ctrl, "p", &mockProvider{})
	for _, id := range []string{"c1", "c2"} {
		_, err := ctrl.acceptMetadata("p", state, answerEvent(id, "1", serverVersion("v1")))
		require.NoError(t, err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	releaseWrite := sync.OnceFunc(func() { close(release) })
	done := make(chan struct{})
	// Registered after the controller's cleanups, so it runs before them: the write that is blocked is let go, and ends, before the
	// state service closes under it.
	t.Cleanup(func() { releaseWrite(); <-done })
	var blocking atomic.Bool
	blocking.Store(true)
	ctrl.lastKnown.storeFn = func(id string) (*appstate.ScopedRoot, error) {
		if blocking.CompareAndSwap(true, false) {
			close(entered)
			<-release
		}
		return svc.PluginStore(id)
	}
	go func() { defer close(done); timers.fire() }()
	<-entered

	// A removal while the write is in flight is armed for the end of it, not for the end of a debounce.
	ctrl.lastKnown.warm("p").forget("c1")
	require.Equal(t, []time.Duration{0}, timers.armed())
	releaseWrite()
	<-done
	timers.fire()

	stored, err := os.ReadFile(lastKnownStorePath(svc, "p"))
	require.NoError(t, err)
	require.NotContains(t, string(stored), `"c1"`)
	require.Contains(t, string(stored), `"c2"`)
}

func TestConnectionMetadataLastKnownNeverOverwritesAFileItCouldNotRead(t *testing.T) {
	svc := appstate.NewTestService(t)
	first, timers := newLastKnownController(t, svc)
	state := metadataTestState(first, "p", &mockProvider{})
	for _, id := range []string{"c1", "c2", "c3"} {
		_, err := first.acceptMetadata("p", state, answerEvent(id, "1", serverVersion("v1")))
		require.NoError(t, err)
	}
	timers.fire()
	before, err := os.ReadFile(lastKnownStorePath(svc, "p"))
	require.NoError(t, err)

	next, nextTimers := newLastKnownController(t, svc)
	var calls atomic.Int32
	next.lastKnown.storeFn = func(id string) (*appstate.ScopedRoot, error) {
		if calls.Add(1) == 1 {
			return nil, errors.New("open store: too many open files")
		}
		return svc.PluginStore(id)
	}
	nextState := metadataTestState(next, "p", &mockProvider{})

	// The first read fails: nothing is kept for the plugin and nothing is written, so the file is not replaced by one that holds
	// only what this run saw.
	_, err = next.acceptMetadata("p", nextState, answerEvent("c4", "1", serverVersion("v2")))
	require.NoError(t, err)
	require.Empty(t, nextTimers.armed())
	nextTimers.fire()
	after, err := os.ReadFile(lastKnownStorePath(svc, "p"))
	require.NoError(t, err)
	require.Equal(t, string(before), string(after))

	// The next admission reads it, and what was kept comes back with what is new.
	_, err = next.acceptMetadata("p", nextState, answerEvent("c4", "2", serverVersion("v2")))
	require.NoError(t, err)
	nextTimers.fire()
	stored, err := os.ReadFile(lastKnownStorePath(svc, "p"))
	require.NoError(t, err)
	for _, id := range []string{"c1", "c2", "c3", "c4"} {
		require.Contains(t, string(stored), `"`+id+`"`)
	}
}

func TestConnectionMetadataLastKnownMovesAFileItCannotParseAsideAndSweepsLeftovers(t *testing.T) {
	svc := appstate.NewTestService(t)
	root, err := svc.PluginStore("p")
	require.NoError(t, err)
	corrupt := []byte(`{"version":2,"connections":{}}`)
	require.NoError(t, root.WriteFile(lastKnownStoreName, corrupt, 0o600))
	require.NoError(t, root.WriteFile(lastKnownStoreName+".0123.tmp", []byte("{"), 0o600))
	ctrl, _ := newLastKnownController(t, svc)

	ctrl.lastKnown.warm("p")

	directory := filepath.Dir(lastKnownStorePath(svc, "p"))
	entries, err := os.ReadDir(directory)
	require.NoError(t, err)
	require.Len(t, entries, 1, "the leftover of a cut-short write is gone, and the file is no longer where a write would replace it")
	name := entries[0].Name()
	require.True(t, appstate.IsQuarantineName(name), name)
	require.True(t, strings.HasPrefix(name, lastKnownStoreName+"."), name)
	moved, err := os.ReadFile(filepath.Join(directory, name))
	require.NoError(t, err)
	require.Equal(t, corrupt, moved, "the file is moved, never rewritten or copied")
}

func TestConnectionMetadataLastKnownQuitIsNotHeldByAHungDisk(t *testing.T) {
	svc := appstate.NewTestService(t)
	ctrl, _ := newLastKnownController(t, svc)
	state := metadataTestState(ctrl, "p", &mockProvider{})
	_, err := ctrl.acceptMetadata("p", state, answerEvent("c", "1", serverVersion("v1")))
	require.NoError(t, err)
	hung := make(chan struct{})
	// Registered after the controller's cleanups, so it runs before them: the write that hangs is let go before the copy closes.
	t.Cleanup(func() { close(hung) })
	ctrl.lastKnown.storeFn = func(id string) (*appstate.ScopedRoot, error) {
		<-hung
		return svc.PluginStore(id)
	}
	ctrl.lastKnown.quitWait = 20 * time.Millisecond

	quit := make(chan struct{})
	go func() { defer close(quit); ctrl.lastKnown.shutdown() }()

	select {
	case <-quit:
	case <-time.After(10 * time.Second):
		t.Fatal("the quit waited for a disk that hangs")
	}
}

func TestConnectionMetadataLastKnownKeepsNothingForAConnectionIDThatLooksLikeACredential(t *testing.T) {
	svc := appstate.NewTestService(t)
	ctrl, timers := newLastKnownController(t, svc)
	sink, logger := recordingLogger()
	ctrl.lastKnown.logger = logger
	state := metadataTestState(ctrl, "p", &mockProvider{})
	id := "postgres://user:hunter2@db.example.com/app"

	for revision := 1; revision <= 3; revision++ {
		at := lastKnownObserved().Add(time.Duration(revision) * time.Second)
		got, err := ctrl.acceptMetadata("p", state, answerEvent(id, strconv.Itoa(revision), versionAt("v1", at)))
		require.NoError(t, err)
		require.Len(t, got.Snapshot.Entries, 1, "the window is shown what the plugin published")
	}

	require.Empty(t, timers.armed())
	timers.fire()
	require.NoFileExists(t, lastKnownStorePath(svc, "p"))
	require.Empty(t, keptEntries(ctrl, "p", id))
	lines := loggedLines(sink)
	require.Len(t, lines, 1, "reported once")
	require.NotContains(t, lines[0], "hunter2")
}

func TestConnectionMetadataLastKnownRefusesAnObjectNamedForACredential(t *testing.T) {
	svc := appstate.NewTestService(t)
	ctrl, timers := newLastKnownController(t, svc)
	state := metadataTestState(ctrl, "p", &mockProvider{})
	kept := map[string]any{
		"kubernetes.labels": map[string]any{"name": "web", "key": "app", "value": "checkout"},
		"kubernetes.sizes":  []any{map[string]any{"name": "small", "value": 1}},
	}
	refused := map[string]any{
		"kubernetes.env":  []any{map[string]any{"name": "DB_PASSWORD", "value": "opaque"}},
		"kubernetes.vars": map[string]any{"nested": []any{map[string]any{"key": "api_key", "value": "opaque"}}},
	}
	entries := map[string]resourcev2.ConnectionMetadataEntry{}
	for _, group := range []map[string]any{kept, refused} {
		for key, value := range group {
			entries[key] = currentEntry(value, lastKnownObserved())
		}
	}
	_, err := ctrl.acceptMetadata("p", state, answerEvent("c", "1", entries))
	require.NoError(t, err)
	timers.fire()

	stored, err := os.ReadFile(lastKnownStorePath(svc, "p"))
	require.NoError(t, err)
	require.NotContains(t, string(stored), "opaque")
	require.Equal(t, slices.Sorted(maps.Keys(kept)), slices.Sorted(maps.Keys(keptEntries(ctrl, "p", "c"))))
}

func TestConnectionMetadataLastKnownPersistsAChangedValueObservedAtTheSameTime(t *testing.T) {
	cases := []struct {
		name  string
		value string
		armed int
	}{
		{"the same observation published again", "v1", 0},
		{"a changed value", "v2", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := appstate.NewTestService(t)
			ctrl, timers := newLastKnownController(t, svc)
			state := metadataTestState(ctrl, "p", &mockProvider{})
			_, err := ctrl.acceptMetadata("p", state, answerEvent("c", "1", serverVersion("v1")))
			require.NoError(t, err)
			timers.fire()

			_, err = ctrl.acceptMetadata("p", state, answerEvent("c", "2", serverVersion(tc.value)))
			require.NoError(t, err)
			require.Len(t, timers.armed(), tc.armed)
			timers.fire()

			require.Equal(t, tc.value, keptEntries(ctrl, "p", "c")["kubernetes.server_version"].value)
			stored, err := os.ReadFile(lastKnownStorePath(svc, "p"))
			require.NoError(t, err)
			require.Contains(t, string(stored), `"`+tc.value+`"`)
		})
	}
}

func TestConnectionMetadataLastKnownKeepsTheLargestFactTheKubernetesPluginPublishes(t *testing.T) {
	svc := appstate.NewTestService(t)
	ctrl, timers := newLastKnownController(t, svc)
	state := metadataTestState(ctrl, "p", &mockProvider{})
	groups := make([]any, 0, 32)
	for i := range 32 {
		groups = append(groups, map[string]any{
			"groupVersion": "group" + strconv.Itoa(i) + ".example.io/v1beta1",
			"reason":       strings.Repeat("the server is currently unable to handle the request; ", 6),
		})
	}
	fact := map[string]any{"count": 32, "groups": groups}
	_, err := ctrl.acceptMetadata("p", state, answerEvent("c", "1", map[string]resourcev2.ConnectionMetadataEntry{
		"kubernetes.unavailable_api_groups": currentEntry(fact, lastKnownObserved()),
	}))
	require.NoError(t, err)
	timers.fire()

	require.Contains(t, keptEntries(ctrl, "p", "c"), "kubernetes.unavailable_api_groups", "a fact of about 12 KiB is kept")
	stored, err := os.ReadFile(lastKnownStorePath(svc, "p"))
	require.NoError(t, err)
	require.Greater(t, len(stored), 8<<10)
}

func TestConnectionMetadataLastKnownServesWhatThePluginPublishedWhenTheKeptEntriesWouldNotFit(t *testing.T) {
	svc := appstate.NewTestService(t)
	ctrl, _ := newLastKnownController(t, svc)
	state := metadataTestState(ctrl, "p", &mockProvider{})
	_, err := ctrl.acceptMetadata("p", state, answerEvent("c", "5", serverVersion("v1.30.1")))
	require.NoError(t, err)

	// An acquisition is running (so the answer is not a complete one and the kept key stays) and the plugin already publishes as many
	// entries as the SDK admits: one more, the kept one, would make a snapshot the SDK itself would refuse.
	own := map[string]resourcev2.ConnectionMetadataEntry{}
	for i := range resourcev2.MaxConnectionMetadataEntries {
		own["own."+strconv.Itoa(i)] = currentEntry("v", lastKnownObserved().Add(-time.Hour))
	}
	event := answerEvent("c", "6", own)
	event.Snapshot.Refreshing = true
	got, err := ctrl.acceptMetadata("p", state, event)
	require.NoError(t, err)

	require.Len(t, got.Snapshot.Entries, resourcev2.MaxConnectionMetadataEntries)
	require.NotContains(t, got.Snapshot.Entries, "kubernetes.server_version")
	require.NoError(t, resourcev2.ValidateConnectionMetadataSnapshot(*got.Snapshot), "what is served is what the SDK admits")
	require.Contains(t, keptEntries(ctrl, "p", "c"), "kubernetes.server_version", "and what was kept is still kept")
}
