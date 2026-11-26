package resource

import (
	"context"
	"fmt"
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

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/log/logtest"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// lastKnownTimers is the clock of the debounce in a test: it holds the writes that were armed and runs them when the test says
// the debounce is over, on the test's goroutine.
type lastKnownTimers struct {
	mu     sync.Mutex
	timers []*lastKnownTimer
}

type lastKnownTimer struct {
	delay   time.Duration
	run     func()
	stopped bool
}

func (k *lastKnownTimers) afterFunc(d time.Duration, f func()) func() bool {
	timer := &lastKnownTimer{delay: d, run: f}
	k.mu.Lock()
	k.timers = append(k.timers, timer)
	k.mu.Unlock()
	return func() bool {
		k.mu.Lock()
		defer k.mu.Unlock()
		was := !timer.stopped
		timer.stopped = true
		return was
	}
}

// armed lists the delays of the writes that are due, in the order they were armed.
func (k *lastKnownTimers) armed() []time.Duration {
	k.mu.Lock()
	defer k.mu.Unlock()
	var delays []time.Duration
	for _, timer := range k.timers {
		if !timer.stopped {
			delays = append(delays, timer.delay)
		}
	}
	return delays
}

// fire runs the writes that are due.
func (k *lastKnownTimers) fire() {
	k.mu.Lock()
	var due []*lastKnownTimer
	for _, timer := range k.timers {
		if !timer.stopped {
			timer.stopped = true
			due = append(due, timer)
		}
	}
	k.mu.Unlock()
	for _, timer := range due {
		timer.run()
	}
}

// newLastKnownController is a controller on svc whose debounce is lastKnownTimers, and whose copy is closed before svc is.
func newLastKnownController(t *testing.T, svc *appstate.Service) (*controller, *lastKnownTimers) {
	t.Helper()
	ctrl, ok := NewController(logging.NewNop(), nil, svc.PluginStore, nil).(*controller)
	require.True(t, ok)
	ctrl.emitter = newRecordingEmitter()
	timers := &lastKnownTimers{}
	ctrl.lastKnown.afterFunc = timers.afterFunc
	t.Cleanup(ctrl.actions.stopAll)
	t.Cleanup(ctrl.lastKnown.close)
	t.Cleanup(func() {
		ctrl.pluginsMu.Lock()
		defer ctrl.pluginsMu.Unlock()
		for _, state := range ctrl.plugins {
			state.cancel()
		}
	})
	return ctrl, timers
}

func lastKnownObserved() time.Time { return time.Date(2026, 11, 20, 9, 30, 0, 123, time.UTC) }

func currentEntry(value any, at time.Time) resourcev2.ConnectionMetadataEntry {
	return resourcev2.ConnectionMetadataEntry{State: metadataStateCurrent, Value: value, ObservedAt: &at}
}

func staleEntry(value any, at time.Time) resourcev2.ConnectionMetadataEntry {
	return resourcev2.ConnectionMetadataEntry{State: metadataStateStale, Value: value, ObservedAt: &at}
}

func unavailableEntry(code string) resourcev2.ConnectionMetadataEntry {
	return resourcev2.ConnectionMetadataEntry{State: metadataStateUnavailable, Error: &resourcev2.ConnectionMetadataError{Code: code, Message: "Not available."}}
}

// answerEvent is what a plugin publishes about an active connection: a snapshot at revision.
func answerEvent(connectionID, revision string, entries map[string]resourcev2.ConnectionMetadataEntry) resourcev2.ConnectionMetadataEvent {
	return resourcev2.ConnectionMetadataEvent{Snapshot: resourcev2.ConnectionMetadataSnapshot{
		ConnectionID: connectionID, Generation: "generation", Revision: revision, Active: true, Entries: entries,
	}}
}

// restartedEvent is what a plugin that has just started publishes about a connection nobody has connected: inactive, nothing observed.
func restartedEvent(connectionID, revision string) resourcev2.ConnectionMetadataEvent {
	return resourcev2.ConnectionMetadataEvent{Snapshot: resourcev2.ConnectionMetadataSnapshot{
		ConnectionID: connectionID, Revision: revision, Entries: map[string]resourcev2.ConnectionMetadataEntry{},
	}}
}

func versionAt(value string, at time.Time) map[string]resourcev2.ConnectionMetadataEntry {
	return map[string]resourcev2.ConnectionMetadataEntry{"kubernetes.server_version": currentEntry(value, at)}
}

func serverVersion(value string) map[string]resourcev2.ConnectionMetadataEntry {
	return versionAt(value, lastKnownObserved())
}

func lastKnownStorePath(svc *appstate.Service, pluginID string) string {
	return filepath.Join(svc.Root(), "plugins", pluginID, "store", lastKnownStoreName)
}

// keptEntries is what the controller keeps in memory for a connection.
func keptEntries(ctrl *controller, pluginID, connectionID string) map[string]lastKnownEntry {
	ctrl.lastKnown.mu.Lock()
	defer ctrl.lastKnown.mu.Unlock()
	p := ctrl.lastKnown.plugins[pluginID]
	if p == nil || p.conns[connectionID] == nil {
		return nil
	}
	return maps.Clone(p.conns[connectionID].entries)
}

// loggedLines is what a logger of ctrl's copy has written, one string for each record: its message and its fields.
func loggedLines(sink *logtest.RecordingSink) []string {
	var lines []string
	for _, record := range sink.Records() {
		var line strings.Builder
		line.WriteString(record.Message)
		for _, field := range record.Fields {
			fmt.Fprintf(&line, " %s=%v", field.Key, field.Value)
		}
		lines = append(lines, line.String())
	}
	return lines
}

func recordingLogger() (*logtest.RecordingSink, logging.Logger) {
	sink := &logtest.RecordingSink{}
	return sink, logging.New(logging.Config{Backend: logging.NewSinkBackend(sink)})
}

func TestConnectionMetadataLastKnownSurvivesRestart(t *testing.T) {
	cases := []struct {
		name    string
		restart func(t *testing.T, svc *appstate.Service, ctrl *controller) *controller
	}{
		{"the host restarts and reads the file", func(t *testing.T, svc *appstate.Service, _ *controller) *controller {
			next, _ := newLastKnownController(t, svc)
			return next
		}},
		{"the plugin unloads and loads again", func(t *testing.T, _ *appstate.Service, ctrl *controller) *controller {
			require.NoError(t, ctrl.OnPluginStop("p", defaultMeta()))
			return ctrl
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := appstate.NewTestService(t)
			ctrl, timers := newLastKnownController(t, svc)
			state := metadataTestState(ctrl, "p", &mockProvider{})
			_, err := ctrl.acceptMetadata("p", state, answerEvent("c", "5", serverVersion("v1.30.1")))
			require.NoError(t, err)
			require.Equal(t, []time.Duration{lastKnownDebounce}, timers.armed())
			timers.fire()
			stored, err := os.ReadFile(lastKnownStorePath(svc, "p"))
			require.NoError(t, err)
			require.JSONEq(t, `{"version":1,"connections":{"c":{"entries":{"kubernetes.server_version":`+
				`{"state":"stale","value":"v1.30.1","observedAt":"2026-11-20T09:30:00.000000123Z"}}}}}`, string(stored))

			next := tc.restart(t, svc, ctrl)
			// A plugin that has just started knows nothing of the connection, and the host shows what it last knew.
			got, err := next.acceptMetadata("p", metadataTestState(next, "p", &mockProvider{}), restartedEvent("c", "1"))
			require.NoError(t, err)
			require.False(t, got.Snapshot.Active)
			entry := got.Snapshot.Entries["kubernetes.server_version"]
			require.Equal(t, metadataStateStale, entry.State)
			require.Equal(t, "v1.30.1", entry.Value)
			require.True(t, lastKnownObserved().Equal(*entry.ObservedAt))
			require.Nil(t, entry.Error)

			// The plugin's own answer replaces it, and that answer is what the next start finds.
			fresh := time.Date(2026, 11, 25, 8, 0, 0, 0, time.UTC)
			got, err = next.acceptMetadata("p", next.plugins["p"], answerEvent("c", "2", versionAt("v1.31.0", fresh)))
			require.NoError(t, err)
			require.Equal(t, metadataStateCurrent, got.Snapshot.Entries["kubernetes.server_version"].State)
			kept := keptEntries(next, "p", "c")["kubernetes.server_version"]
			require.Equal(t, "v1.31.0", kept.value)
			require.True(t, fresh.Equal(kept.observedAt))
		})
	}
}

func TestLastKnownConnectionMergesAndServes(t *testing.T) {
	earlier := lastKnownObserved()
	later := earlier.Add(time.Hour)
	stamp := func(at time.Time) string { return at.UTC().Format(time.RFC3339Nano) }
	type shown struct {
		state string
		value any
		at    string
		code  string
	}
	cases := []struct {
		name     string
		snapshot resourcev2.ConnectionMetadataSnapshot
		served   map[string]shown
		kept     map[string]any
	}{
		{
			name: "a fresh answer replaces what was kept",
			snapshot: resourcev2.ConnectionMetadataSnapshot{Active: true, Entries: map[string]resourcev2.ConnectionMetadataEntry{
				"a": currentEntry("new", later), "b": currentEntry("same", earlier),
			}},
			served: map[string]shown{"a": {"current", "new", stamp(later), ""}, "b": {"current", "same", stamp(earlier), ""}},
			kept:   map[string]any{"a": "new", "b": "same"},
		},
		{
			name:     "a connection nobody connected is shown what was kept, stale",
			snapshot: resourcev2.ConnectionMetadataSnapshot{Entries: map[string]resourcev2.ConnectionMetadataEntry{}},
			served:   map[string]shown{"a": {"stale", "old", stamp(earlier), ""}, "b": {"stale", "same", stamp(earlier), ""}},
			kept:     map[string]any{"a": "old", "b": "same"},
		},
		{
			name:     "a refresh that is running keeps what was kept",
			snapshot: resourcev2.ConnectionMetadataSnapshot{Active: true, Refreshing: true, Entries: map[string]resourcev2.ConnectionMetadataEntry{"a": currentEntry("new", later)}},
			served:   map[string]shown{"a": {"current", "new", stamp(later), ""}, "b": {"stale", "same", stamp(earlier), ""}},
			kept:     map[string]any{"a": "new", "b": "same"},
		},
		{
			name: "a refresh that failed keeps what was kept",
			snapshot: resourcev2.ConnectionMetadataSnapshot{
				Active: true, LastRefreshError: &resourcev2.ConnectionMetadataError{Code: "X", Message: "Failed."},
				Entries: map[string]resourcev2.ConnectionMetadataEntry{"a": currentEntry("new", later)},
			},
			served: map[string]shown{"a": {"current", "new", stamp(later), ""}, "b": {"stale", "same", stamp(earlier), ""}},
			kept:   map[string]any{"a": "new", "b": "same"},
		},
		{
			name:     "a complete answer drops the keys it leaves out",
			snapshot: resourcev2.ConnectionMetadataSnapshot{Active: true, Entries: map[string]resourcev2.ConnectionMetadataEntry{"a": currentEntry("new", later)}},
			served:   map[string]shown{"a": {"current", "new", stamp(later), ""}},
			kept:     map[string]any{"a": "new"},
		},
		{
			name: "a key the plugin says is unavailable is shown stale with the plugin's error",
			snapshot: resourcev2.ConnectionMetadataSnapshot{Active: true, Entries: map[string]resourcev2.ConnectionMetadataEntry{
				"a": unavailableEntry("DENIED"), "b": currentEntry("same", earlier),
			}},
			served: map[string]shown{"a": {"stale", "old", stamp(earlier), "DENIED"}, "b": {"current", "same", stamp(earlier), ""}},
			kept:   map[string]any{"a": "old", "b": "same"},
		},
		{
			name: "a stale entry of the plugin's memory does not replace a later one",
			snapshot: resourcev2.ConnectionMetadataSnapshot{Generation: "g", Entries: map[string]resourcev2.ConnectionMetadataEntry{
				"a": staleEntry("older", earlier.Add(-time.Hour)), "b": staleEntry("later", later),
			}},
			served: map[string]shown{"a": {"stale", "older", stamp(earlier.Add(-time.Hour)), ""}, "b": {"stale", "later", stamp(later), ""}},
			kept:   map[string]any{"a": "old", "b": "later"},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			conn := newLastKnownConnection("c")
			var drops lastKnownDrops
			limits := lastKnownLimits{entries: lastKnownMaxEntries, valueBytes: lastKnownMaxValueBytes, pluginBytes: lastKnownMaxPluginBytes}
			// What an earlier run answered: two keys.
			mergeSnapshot(conn, resourcev2.ConnectionMetadataSnapshot{Active: true, Entries: map[string]resourcev2.ConnectionMetadataEntry{
				"a": currentEntry("old", earlier), "b": currentEntry("same", earlier),
			}}, limits, &drops)

			// The snapshot the SDK would publish: it names its connection and revision, and an active one has a generation.
			snapshot := tc.snapshot
			snapshot.ConnectionID, snapshot.Revision = "c", "1"
			if snapshot.Active {
				snapshot.Generation = "g"
			}
			mergeSnapshot(conn, snapshot, limits, &drops)

			served := conn.serve(snapshot)
			require.NoError(t, resourcev2.ValidateConnectionMetadataSnapshot(served), "what is served is valid by the SDK's own validation")
			got := map[string]shown{}
			for key, entry := range served.Entries {
				row := shown{state: entry.State, value: entry.Value, at: stamp(*entry.ObservedAt), code: ""}
				if entry.Error != nil {
					row.code = entry.Error.Code
				}
				got[key] = row
			}
			require.Equal(t, tc.served, got)
			kept := map[string]any{}
			for key, entry := range conn.entries {
				kept[key] = entry.value
			}
			require.Equal(t, tc.kept, kept)
			require.False(t, drops.any())
		})
	}
}

func TestConnectionMetadataLastKnownIsErasedWithTheConnectionAndThePlugin(t *testing.T) {
	cases := []struct {
		name  string
		erase func(t *testing.T, ctrl *controller)
		// wholePlugin is whether the other connection's entries go too.
		wholePlugin bool
	}{
		{"a tombstone", func(t *testing.T, ctrl *controller) {
			tombstone := restartedEvent("c1", "9")
			tombstone.Removed = true
			_, err := ctrl.acceptMetadata("p", ctrl.plugins["p"], tombstone)
			require.NoError(t, err)
		}, false},
		{"RemoveConnection", func(t *testing.T, ctrl *controller) {
			_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "p", types.Connection{ID: "c1", Name: "c1"}, nil)
			require.NoError(t, err)
			require.NoError(t, ctrl.RemoveConnection(testInvocationContext(), "p", "c1"))
		}, false},
		{"a listing of the plugin's connections that leaves it out", func(_ *testing.T, ctrl *controller) {
			ctrl.retainLastKnownMetadata("p", []types.Connection{{ID: "c2"}})
		}, false},
		{"the plugin's uninstall", func(t *testing.T, ctrl *controller) {
			require.NoError(t, ctrl.OnPluginUninstalled("p"))
		}, true},
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
			require.FileExists(t, lastKnownStorePath(svc, "p"))
			// A change that is still waiting for its write when the erasure comes must not bring the entries back.
			_, err := ctrl.acceptMetadata("p", state, answerEvent("c1", "6", versionAt("v1.30.2", lastKnownObserved().Add(time.Minute))))
			require.NoError(t, err)

			tc.erase(t, ctrl)
			timers.fire()

			require.Empty(t, keptEntries(ctrl, "p", "c1"))
			if tc.wholePlugin {
				require.NoFileExists(t, lastKnownStorePath(svc, "p"))
				require.Empty(t, keptEntries(ctrl, "p", "c2"))
				return
			}
			require.NotEmpty(t, keptEntries(ctrl, "p", "c2"), "only the connection that went is erased")
			stored, err := os.ReadFile(lastKnownStorePath(svc, "p"))
			require.NoError(t, err)
			require.NotContains(t, string(stored), `"c1"`)
			require.Contains(t, string(stored), `"c2"`)
		})
	}
}

func TestConnectionMetadataLastKnownIsBounded(t *testing.T) {
	at := func(minutes int) time.Time { return lastKnownObserved().Add(time.Duration(minutes) * time.Minute) }
	cases := []struct {
		name   string
		limits lastKnownLimits
		events []resourcev2.ConnectionMetadataEvent
		// kept is, for each connection, the keys that are kept.
		kept map[string][]string
		// logged is what the one line about what was left out says.
		logged string
		// refused is how many refusals the host still remembers at the end, so as not to report each again.
		refused int
	}{
		{
			name:   "the entries observed earliest go past the limit for a connection",
			limits: lastKnownLimits{entries: 2, valueBytes: 1 << 10, pluginBytes: 1 << 20},
			events: []resourcev2.ConnectionMetadataEvent{answerEvent("c", "1", map[string]resourcev2.ConnectionMetadataEntry{
				"a": currentEntry("1", at(1)), "b": currentEntry("2", at(2)), "c": currentEntry("3", at(3)), "d": currentEntry("4", at(4)),
			})},
			kept:   map[string][]string{"c": {"c", "d"}},
			logged: "evicted=2",
		},
		{
			name:   "a value past the limit is not kept, and nothing older stands in for it",
			limits: lastKnownLimits{entries: 8, valueBytes: 16, pluginBytes: 1 << 20},
			events: []resourcev2.ConnectionMetadataEvent{
				answerEvent("c", "1", map[string]resourcev2.ConnectionMetadataEntry{"small": currentEntry("1", at(1)), "big": currentEntry("short", at(1))}),
				answerEvent("c", "2", map[string]resourcev2.ConnectionMetadataEntry{
					"small": currentEntry("1", at(1)), "big": currentEntry(strings.Repeat("x", 64), at(2)),
				}),
				// The same observation again, as the plugin publishes it with each revision: no second line.
				answerEvent("c", "3", map[string]resourcev2.ConnectionMetadataEntry{
					"small": currentEntry("1", at(1)), "big": currentEntry(strings.Repeat("x", 64), at(2)),
				}),
			},
			kept:    map[string][]string{"c": {"small"}},
			logged:  "tooLarge=1",
			refused: 1,
		},
		{
			name:   "what was refused is forgotten when the plugin stops publishing the key",
			limits: lastKnownLimits{entries: 8, valueBytes: 16, pluginBytes: 1 << 20},
			events: []resourcev2.ConnectionMetadataEvent{
				answerEvent("c", "1", map[string]resourcev2.ConnectionMetadataEntry{
					"small": currentEntry("1", at(1)), "big": currentEntry(strings.Repeat("x", 64), at(2)),
				}),
				answerEvent("c", "2", map[string]resourcev2.ConnectionMetadataEntry{"small": currentEntry("1", at(1))}),
			},
			kept:   map[string][]string{"c": {"small"}},
			logged: "tooLarge=1",
		},
		{
			name:   "the connections observed earliest go past the limit for a plugin",
			limits: lastKnownLimits{entries: 8, valueBytes: 1 << 10, pluginBytes: 300},
			events: []resourcev2.ConnectionMetadataEvent{
				answerEvent("old", "1", map[string]resourcev2.ConnectionMetadataEntry{"a": currentEntry("1", at(1))}),
				answerEvent("new", "1", map[string]resourcev2.ConnectionMetadataEntry{"a": currentEntry("1", at(2))}),
				answerEvent("newest", "1", map[string]resourcev2.ConnectionMetadataEntry{"a": currentEntry("1", at(3))}),
			},
			kept:   map[string][]string{"new": {"a"}, "newest": {"a"}},
			logged: "evicted=1",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := appstate.NewTestService(t)
			ctrl, timers := newLastKnownController(t, svc)
			sink, logger := recordingLogger()
			ctrl.lastKnown.logger = logger
			ctrl.lastKnown.limits = tc.limits
			state := metadataTestState(ctrl, "p", &mockProvider{})
			for _, event := range tc.events {
				_, err := ctrl.acceptMetadata("p", state, event)
				require.NoError(t, err)
			}
			timers.fire()
			refused := 0
			for _, conn := range ctrl.lastKnown.plugins["p"].conns {
				refused += len(conn.refused)
			}
			require.Equal(t, tc.refused, refused)

			for _, id := range []string{"old", "new", "newest", "c"} {
				require.Equal(t, tc.kept[id], slices.Sorted(maps.Keys(keptEntries(ctrl, "p", id))), id)
			}
			stored, err := os.ReadFile(lastKnownStorePath(svc, "p"))
			require.NoError(t, err)
			require.LessOrEqual(t, len(stored), 1<<10, "what is written stays within what is kept")
			lines := loggedLines(sink)
			require.Len(t, lines, 1, "one line says what was left out")
			require.Contains(t, lines[0], tc.logged)
			require.NotContains(t, lines[0], "xxxx", "the line carries no value")
		})
	}
}

func TestConnectionMetadataLastKnownIgnoresRetiredEpochsAndOlderRevisions(t *testing.T) {
	later := lastKnownObserved().Add(time.Hour)
	cases := []struct {
		name string
		// late delivers an answer, observed later than the one that is kept, that must change nothing.
		late func(t *testing.T, ctrl *controller, state *pluginState, epoch uint64)
	}{
		{"an entry from a retired epoch", func(t *testing.T, ctrl *controller, state *pluginState, epoch uint64) {
			ctrl.retireMetadata("p", state)
			_, err := ctrl.admitMetadata("p", state, answerEvent("c", "7", versionAt("late", later)), true, epoch)
			require.ErrorIs(t, err, context.Canceled)
		}},
		{"an entry of a plugin generation that was replaced", func(t *testing.T, ctrl *controller, state *pluginState, epoch uint64) {
			metadataTestState(ctrl, "p", &mockProvider{})
			_, err := ctrl.admitMetadata("p", state, answerEvent("c", "7", versionAt("late", later)), false, epoch)
			require.ErrorIs(t, err, context.Canceled)
		}},
		{"an older revision of the same epoch", func(t *testing.T, ctrl *controller, state *pluginState, _ uint64) {
			got, err := ctrl.acceptMetadata("p", state, answerEvent("c", "4", versionAt("late", later)))
			require.NoError(t, err)
			require.Equal(t, "5", got.Revision, "the answer already admitted is the one that stands")
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := appstate.NewTestService(t)
			ctrl, _ := newLastKnownController(t, svc)
			state := metadataTestState(ctrl, "p", &mockProvider{})
			epoch := state.metadataEpoch
			_, err := ctrl.admitMetadata("p", state, answerEvent("c", "5", serverVersion("v1.30.1")), true, epoch)
			require.NoError(t, err)

			tc.late(t, ctrl, state, epoch)

			kept := keptEntries(ctrl, "p", "c")["kubernetes.server_version"]
			require.Equal(t, "v1.30.1", kept.value)
			require.True(t, lastKnownObserved().Equal(kept.observedAt))
		})
	}
}

func TestConnectionMetadataLastKnownIsNotWrittenWhenItLooksLikeACredential(t *testing.T) {
	svc := appstate.NewTestService(t)
	ctrl, timers := newLastKnownController(t, svc)
	sink, logger := recordingLogger()
	ctrl.lastKnown.logger = logger
	state := metadataTestState(ctrl, "p", &mockProvider{})
	// Facts a real plugin publishes are kept; what looks like a credential, by its shape or by a name it is under, is not.
	kept := map[string]any{
		"kubernetes.server_url":     "https://api.example.com:6443",
		"kubernetes.server_version": "v1.30.1-eks-3af4770",
		"aws.account_id":            "123456789012",
		"azure.subscription_id":     "6f1c1b4e-8a0d-4a9e-9d52-1c0f2f1d7a11",
		"kubernetes.unavailable_api_groups": map[string]any{"count": 1, "groups": []any{
			map[string]any{"groupVersion": "metrics.k8s.io/v1beta1", "reason": "the server is currently unable to handle the request"},
		}},
	}
	refused := map[string]any{
		"kubernetes.endpoint":       "https://admin:hunter2@api.example.com",
		"kubernetes.auth":           map[string]any{"header": "Authorization: Bearer abc123def456ghi789"},
		"kubernetes.login":          []any{"ok", map[string]any{"clientSecret": "opaque"}},
		"kubernetes.client_token":   "opaque",
		"kubernetes.release_status": "password=hunter3",
	}
	entries := map[string]resourcev2.ConnectionMetadataEntry{}
	for _, group := range []map[string]any{kept, refused} {
		for key, value := range group {
			entries[key] = currentEntry(value, lastKnownObserved())
		}
	}
	got, err := ctrl.acceptMetadata("p", state, answerEvent("c", "1", entries))
	require.NoError(t, err)
	// The window is shown what the plugin published; only the copy that outlives the run is held to the redaction.
	require.Len(t, got.Snapshot.Entries, len(entries))
	timers.fire()

	stored, err := os.ReadFile(lastKnownStorePath(svc, "p"))
	require.NoError(t, err)
	for key := range kept {
		require.Contains(t, string(stored), `"`+key+`"`)
	}
	for key := range refused {
		require.NotContains(t, string(stored), `"`+key+`"`)
	}
	for _, secret := range []string{"hunter2", "hunter3", "abc123def456ghi789", "opaque", "clientSecret", "sensitiveData"} {
		require.NotContains(t, string(stored), secret)
	}
	require.Equal(t, slices.Sorted(maps.Keys(kept)), slices.Sorted(maps.Keys(keptEntries(ctrl, "p", "c"))))
	lines := loggedLines(sink)
	require.Len(t, lines, 1)
	require.Contains(t, lines[0], "credentialShaped=5")
	for _, secret := range []string{"hunter2", "hunter3", "abc123def456ghi789", "opaque"} {
		require.NotContains(t, lines[0], secret)
	}
}

func TestConnectionMetadataLastKnownWritesAreCoalescedAndHoldNoLock(t *testing.T) {
	svc := appstate.NewTestService(t)
	ctrl, timers := newLastKnownController(t, svc)
	state := metadataTestState(ctrl, "p", &mockProvider{})
	answer := func(revision int) {
		at := lastKnownObserved().Add(time.Duration(revision) * time.Second)
		_, err := ctrl.acceptMetadata("p", state, answerEvent("c", strconv.Itoa(revision), versionAt("v1."+strconv.Itoa(revision), at)))
		require.NoError(t, err)
	}
	for revision := 1; revision <= 20; revision++ {
		answer(revision)
	}
	require.Equal(t, []time.Duration{lastKnownDebounce}, timers.armed(), "twenty answers wait for one write")
	require.NoFileExists(t, lastKnownStorePath(svc, "p"), "and nothing is written until the debounce is over")

	// The write is in the disk: the lookup of the store blocks, as a slow disk does.
	var blocking atomic.Bool
	entered, release := make(chan struct{}), make(chan struct{})
	// Registered after the controller's cleanups, so it runs before them: a failure below must not leave the write blocked.
	releaseWrite := sync.OnceFunc(func() { close(release) })
	t.Cleanup(releaseWrite)
	ctrl.lastKnown.storeFn = func(pluginID string) (*appstate.ScopedRoot, error) {
		if blocking.Load() {
			close(entered)
			<-release
		}
		return svc.PluginStore(pluginID)
	}
	blocking.Store(true)
	written := make(chan struct{})
	go func() {
		defer close(written)
		timers.fire()
	}()
	<-entered
	blocking.Store(false)

	// Nothing waits for it: an answer is admitted, and the copy is changed and read, while the write is in flight.
	done := make(chan struct{})
	go func() {
		defer close(done)
		answer(21)
		ctrl.lastKnown.warm("p").forget("other")
		assert.NotEmpty(t, keptEntries(ctrl, "p", "c"))
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("an admission waited for the disk")
	}
	releaseWrite()
	<-written

	// What changed during the write is one more write, which finds the file behind and brings it up to date.
	require.Equal(t, []time.Duration{lastKnownDebounce}, timers.armed())
	timers.fire()
	stored, err := os.ReadFile(lastKnownStorePath(svc, "p"))
	require.NoError(t, err)
	require.Contains(t, string(stored), `"v1.21"`)
	require.Empty(t, timers.armed())
}

func TestConnectionMetadataLastKnownIsWrittenAtShutdown(t *testing.T) {
	svc := appstate.NewTestService(t)
	ctrl, timers := newLastKnownController(t, svc)
	state := metadataTestState(ctrl, "p", &mockProvider{})
	_, err := ctrl.acceptMetadata("p", state, answerEvent("c", "1", serverVersion("v1.30.1")))
	require.NoError(t, err)
	require.Len(t, timers.armed(), 1)

	require.NoError(t, ctrl.ServiceShutdown())

	require.FileExists(t, lastKnownStorePath(svc, "p"))
	require.Empty(t, timers.armed(), "the timer that was waiting is cancelled")
}

func TestConnectionMetadataLastKnownStartsEmptyFromAFileItCannotRead(t *testing.T) {
	cases := map[string]string{
		"not JSON":                   `{"version":1,"connections":`,
		"a version it does not know": `{"version":2,"connections":{}}`,
		"a field it does not know":   `{"version":1,"connections":{},"extra":true}`,
		"more than one document":     `{"version":1,"connections":{}} {}`,
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			svc := appstate.NewTestService(t)
			root, err := svc.PluginStore("p")
			require.NoError(t, err)
			require.NoError(t, root.WriteFile(lastKnownStoreName, []byte(content), 0o600))
			ctrl, timers := newLastKnownController(t, svc)
			sink, logger := recordingLogger()
			ctrl.lastKnown.logger = logger
			state := metadataTestState(ctrl, "p", &mockProvider{})

			got, err := ctrl.acceptMetadata("p", state, restartedEvent("c", "1"))
			require.NoError(t, err)
			require.Empty(t, got.Snapshot.Entries)
			require.Len(t, loggedLines(sink), 1)

			_, err = ctrl.acceptMetadata("p", state, answerEvent("c", "2", serverVersion("v1.30.1")))
			require.NoError(t, err)
			timers.fire()
			stored, err := os.ReadFile(lastKnownStorePath(svc, "p"))
			require.NoError(t, err)
			require.Contains(t, string(stored), `"version":1`, "the next write replaces it")
		})
	}
}

func TestConnectionMetadataLastKnownConcurrentUse(t *testing.T) {
	svc := appstate.NewTestService(t)
	ctrl, _ := newLastKnownController(t, svc)
	// Real timers, so that the writes run on their own goroutines as they do in the host.
	ctrl.lastKnown.afterFunc = func(d time.Duration, f func()) func() bool { return time.AfterFunc(d, f).Stop }
	ctrl.lastKnown.debounce = time.Millisecond
	state := metadataTestState(ctrl, "p", &mockProvider{})
	known := ctrl.lastKnown.warm("p")

	var failures atomic.Int32
	var wg sync.WaitGroup
	for worker := range 4 {
		wg.Go(func() {
			id := "c" + strconv.Itoa(worker)
			for revision := 1; revision <= 50; revision++ {
				at := lastKnownObserved().Add(time.Duration(revision) * time.Second)
				if _, err := ctrl.acceptMetadata("p", state, answerEvent(id, strconv.Itoa(revision), versionAt("v"+strconv.Itoa(revision), at))); err != nil {
					failures.Add(1)
				}
				if revision%10 == 0 {
					known.forget("c" + strconv.Itoa((worker+1)%4))
				}
			}
		})
	}
	wg.Go(func() {
		for range 20 {
			ctrl.lastKnown.flush(known)
		}
	})
	wg.Wait()
	require.Zero(t, failures.Load())
	ctrl.lastKnown.shutdown()

	// What the file holds is what is kept.
	reloaded, _ := newLastKnownController(t, svc)
	reloaded.lastKnown.warm("p")
	for worker := range 4 {
		id := "c" + strconv.Itoa(worker)
		kept := keptEntries(ctrl, "p", id)
		stored := keptEntries(reloaded, "p", id)
		require.Len(t, stored, len(kept), id)
		for key, entry := range kept {
			require.Equal(t, entry.value, stored[key].value, id)
			require.True(t, entry.observedAt.Equal(stored[key].observedAt), id)
		}
	}
}

// startSDKHost is a host controller on svc in front of a real SDK controller, with one connection, "c1", whose metadata callback
// answers with update: the sequences of snapshots that the rules above are written for are the SDK's, not a test's.
func startSDKHost(t *testing.T, svc *appstate.Service, update func() resourcev2.ConnectionMetadataUpdate) *controller {
	t.Helper()
	provider, err := resourcev2.NewController(resourcev2.Config[struct{}]{
		Catalog: func(context.Context, resourcev2.CatalogRequest) (resourcev2.Catalog, error) {
			return resourcev2.Catalog{Provider: "sdk-fixture", Revision: "1", Types: []resourcev2.ResourceType{}, Coverage: resourcev2.Coverage{Kind: "complete"}}, nil
		},
		Lifecycle: &resourcev2.Lifecycle[struct{}]{
			LoadConnections: func(context.Context) ([]types.Connection, error) {
				return []types.Connection{{ID: "c1", Name: "c1"}}, nil
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
	return ctrl
}

// metadataEventually waits for what the host serves for "c1" to satisfy ok.
func metadataEventually(t *testing.T, ctrl *controller, ok func(*resourcev2.ConnectionMetadataSnapshot) bool) {
	t.Helper()
	require.Eventually(t, func() bool {
		got, err := ctrl.GetConnectionMetadata(testInvocationContext(), "p", "c1")
		return err == nil && got.Snapshot != nil && ok(got.Snapshot)
	}, 10*time.Second, 5*time.Millisecond)
}

func TestConnectionMetadataLastKnownWithTheSDKAcrossHostRestarts(t *testing.T) {
	svc := appstate.NewTestService(t)
	observation := func(value string, at time.Time) resourcev2.ConnectionMetadataObservation {
		return resourcev2.ConnectionMetadataObservation{State: "success", Value: value, ObservedAt: at}
	}
	state := func(entries map[string]resourcev2.ConnectionMetadataEntry, key string) string {
		return entries[key].State
	}

	// The first run: connect, answer, stop.
	firstAt := time.Now().UTC().Truncate(time.Millisecond)
	first := startSDKHost(t, svc, func() resourcev2.ConnectionMetadataUpdate {
		return resourcev2.ConnectionMetadataUpdate{Set: map[string]resourcev2.ConnectionMetadataObservation{
			"kubernetes.server_version":  observation("v1.30.1", firstAt),
			"kubernetes.server_platform": observation("linux/amd64", firstAt),
		}, Remove: nil}
	})
	_, err := first.StartConnection(testInvocationContext(), "p", "c1")
	require.NoError(t, err)
	metadataEventually(t, first, func(s *resourcev2.ConnectionMetadataSnapshot) bool {
		return s.Active && !s.Refreshing && state(s.Entries, "kubernetes.server_version") == metadataStateCurrent
	})
	_, err = first.StopConnection(testInvocationContext(), "p", "c1")
	require.NoError(t, err)
	metadataEventually(t, first, func(s *resourcev2.ConnectionMetadataSnapshot) bool {
		return !s.Active && state(s.Entries, "kubernetes.server_version") == metadataStateStale
	})
	require.NoError(t, first.ServiceShutdown())

	// The second run, another host on another SDK controller with nothing in memory, whose backend answers when the test lets it:
	// nobody has connected, and the connection still shows what it showed.
	secondAt := firstAt.Add(48 * time.Hour)
	gate := make(chan struct{})
	second := startSDKHost(t, svc, func() resourcev2.ConnectionMetadataUpdate {
		<-gate
		return resourcev2.ConnectionMetadataUpdate{Set: map[string]resourcev2.ConnectionMetadataObservation{
			"kubernetes.server_version": observation("v1.31.0", secondAt),
		}, Remove: nil}
	})
	// Registered after the host's cleanups, so it runs before them: a backend that waits must be let go before the host stops it.
	answer := sync.OnceFunc(func() { close(gate) })
	t.Cleanup(answer)
	showsWhatWasKnown := func(s *resourcev2.ConnectionMetadataSnapshot) bool {
		version, platform := s.Entries["kubernetes.server_version"], s.Entries["kubernetes.server_platform"]
		return version.State == metadataStateStale && version.Value == "v1.30.1" && version.ObservedAt.Equal(firstAt) &&
			platform.State == metadataStateStale && platform.Value == "linux/amd64"
	}
	metadataEventually(t, second, func(s *resourcev2.ConnectionMetadataSnapshot) bool { return !s.Active && showsWhatWasKnown(s) })

	// Connected, and until the backend answers, it still shows what was known: nothing blinks out for the length of the probe.
	_, err = second.StartConnection(testInvocationContext(), "p", "c1")
	require.NoError(t, err)
	metadataEventually(t, second, func(s *resourcev2.ConnectionMetadataSnapshot) bool {
		return s.Active && s.Refreshing && showsWhatWasKnown(s)
	})

	// Then the new answer replaces what was kept, and the key it leaves out is no longer a fact.
	answer()
	metadataEventually(t, second, func(s *resourcev2.ConnectionMetadataSnapshot) bool {
		version := s.Entries["kubernetes.server_version"]
		_, platform := s.Entries["kubernetes.server_platform"]
		return s.Active && !s.Refreshing && version.State == metadataStateCurrent && version.Value == "v1.31.0" && !platform
	})
	kept := keptEntries(second, "p", "c1")
	require.Len(t, kept, 1)
	require.Equal(t, "v1.31.0", kept["kubernetes.server_version"].value)
	require.True(t, secondAt.Equal(kept["kubernetes.server_version"].observedAt))
}

// LoadConnections hands the last-known copy the list the controller published as its own, and a start or a stop of a connection
// writes that list in place: the IDs are read under connsMu, which the race detector holds this test to.
func TestConnectionMetadataLastKnownReadsTheListedConnectionsUnderTheirLock(t *testing.T) {
	const connections, rounds = 4, 30
	listed := make([]types.Connection, connections)
	for i := range listed {
		listed[i] = listedConnection("c"+strconv.Itoa(i), "c"+strconv.Itoa(i), "https://prod")
	}
	h := newFailureHarness(t, listed...)
	h.ctrl.pluginsMu.Lock()
	h.ctrl.plugins[failurePlugin].features = resourcev2.FeatureSet{Traits: []resourcev2.Feature{resourcev2.FeatureConnectionMetadata}}
	h.ctrl.pluginsMu.Unlock()

	var wg sync.WaitGroup
	for _, connection := range listed {
		wg.Go(func() {
			for range rounds {
				_, _ = h.ctrl.StartConnection(testInvocationContext(), failurePlugin, connection.ID)
				_, _ = h.ctrl.StopConnection(testInvocationContext(), failurePlugin, connection.ID)
			}
		})
	}
	wg.Go(func() {
		for range rounds {
			_, _ = h.ctrl.LoadConnections(testInvocationContext(), failurePlugin)
		}
	})
	wg.Wait()
}
