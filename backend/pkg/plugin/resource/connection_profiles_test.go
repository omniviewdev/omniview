package resource

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
)

func profileTestConnection(id, endpoint string) types.Connection {
	return types.Connection{ID: id, Name: id, Data: map[string]any{"endpoint": endpoint}}
}

func TestConnectionProfilesExplicitSaveRestartNativeDisableRestore(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	native := profileTestConnection("native/slash/雪", "fresh-native")
	provider := connectionOverlayTestProvider(native)
	registerMockPlugin(ctrl, "plugin", provider)
	effective, err := ctrl.replayConnectionProfiles(testInvocationContext(), "plugin", []types.Connection{native})
	require.NoError(t, err)
	require.Equal(t, "fresh-native", effective[0].Data["endpoint"])
	override := profileTestConnection(native.ID, "explicit-endpoint")
	result, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", override)
	require.NoError(t, err)
	require.True(t, result.Applied)
	require.Equal(t, "override", result.Profile.Source)
	require.True(t, result.Profile.Active)
	require.Equal(t, "explicit-endpoint", result.Profile.Connection.Data["endpoint"])

	// A new source generation starts with native facts, not cached effective data.
	restarted := connectionOverlayTestProvider(native)
	registerMockPlugin(ctrl, "plugin", restarted)
	effective, err = ctrl.replayConnectionProfiles(testInvocationContext(), "plugin", []types.Connection{native})
	require.NoError(t, err)
	require.Equal(t, "explicit-endpoint", effective[0].Data["endpoint"])
	require.NoError(t, ctrl.RemoveConnection(testInvocationContext(), "plugin", native.ID))
	profiles, err := ctrl.ListConnectionProfiles(testInvocationContext(), "plugin")
	require.NoError(t, err)
	require.Equal(t, "disabled", profiles[0].Source)
	require.False(t, profiles[0].Active)
	nativeSnapshot, err := restarted.NativeConnections(context.Background())
	require.NoError(t, err)
	require.Equal(t, "fresh-native", nativeSnapshot[0].Data["endpoint"], "disable must not mutate source configuration")
	result, err = ctrl.ResetConnectionProfile(testInvocationContext(), "plugin", native.ID)
	require.NoError(t, err)
	require.True(t, result.Applied)
	require.Equal(t, "native", result.Profile.Source)
	require.Equal(t, "fresh-native", result.Profile.Connection.Data["endpoint"])
}

func TestConnectionProfilesManualRemovalAndFreshNativePriority(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	native := profileTestConnection("matching", "current-source")
	provider := connectionOverlayTestProvider(native)
	registerMockPlugin(ctrl, "plugin", provider)
	root, err := ctrl.pluginStoreFn("plugin")
	require.NoError(t, err)
	old := profileTestConnection("matching", "stale-cache")
	candidate := profileTestConnection("review/雪", "inactive-cache")
	require.NoError(t, saveToLocalStore(root, map[string][]types.Connection{"plugin": {old, candidate}}))
	legacyBefore, err := root.ReadFile(storeName)
	require.NoError(t, err)
	_, err = ctrl.replayConnectionProfiles(testInvocationContext(), "plugin", []types.Connection{native})
	require.NoError(t, err)
	profiles, err := ctrl.ListConnectionProfiles(testInvocationContext(), "plugin")
	require.NoError(t, err)
	require.Len(t, profiles, 2)
	require.Equal(t, "native", profiles[0].Source)
	require.Equal(t, "current-source", profiles[0].Connection.Data["endpoint"])
	require.Equal(t, "review", profiles[1].Source)
	require.False(t, profiles[1].Active)
	effective, err := provider.ListConnections(context.Background())
	require.NoError(t, err)
	require.Len(t, effective, 1, "passive cache must never activate a source route")
	_, err = ctrl.ImportConnectionProfile(testInvocationContext(), "plugin", "matching")
	require.Error(t, err, "fresh native discovery cannot be overwritten by importing a stale cache")
	imported, err := ctrl.ImportConnectionProfile(testInvocationContext(), "plugin", candidate.ID)
	require.NoError(t, err)
	require.Equal(t, "manual", imported.Profile.Source)
	require.True(t, imported.Profile.Active)
	require.NoError(t, ctrl.RemoveConnection(testInvocationContext(), "plugin", candidate.ID))
	effective, err = provider.ListConnections(context.Background())
	require.NoError(t, err)
	require.Len(t, effective, 1)
	legacyAfter, err := root.ReadFile(storeName)
	require.NoError(t, err)
	require.Equal(t, legacyBefore, legacyAfter, "review/import must preserve original cache bytes")
	manual := profileTestConnection("owned", "manual-endpoint")
	_, err = ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", manual)
	require.NoError(t, err)
	reset, err := ctrl.ResetConnectionProfile(testInvocationContext(), "plugin", manual.ID)
	require.NoError(t, err)
	require.Equal(t, ConnectionProfile{ID: manual.ID, Source: "absent", Active: false}, reset.Profile)
}

func TestLegacyCacheStaysPassiveAcrossDiscoveryFailureAndRestart(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	root, err := ctrl.pluginStoreFn("plugin")
	require.NoError(t, err)
	candidate := profileTestConnection("legacy", "old-endpoint")
	require.NoError(t, saveToLocalStore(root, map[string][]types.Connection{"plugin": {candidate}}))
	before, err := root.ReadFile(storeName)
	require.NoError(t, err)
	failed := connectionOverlayTestProvider()
	failed.LoadConnectionsFunc = func(context.Context) ([]types.Connection, error) {
		return nil, errors.New("discovery unavailable")
	}
	registerMockPlugin(ctrl, "plugin", failed)
	ctrl.OnPluginInit("plugin", defaultMeta())
	_, err = ctrl.LoadConnections(testInvocationContext(), "plugin")
	require.Error(t, err)
	_, err = ctrl.GetConnection(testInvocationContext(), "plugin", candidate.ID)
	require.Error(t, err, "metric and native utility callbacks use this GetConnection boundary")
	require.Empty(t, ctrl.getConnections("plugin"))
	listed, err := ctrl.ListConnections(testInvocationContext(), "plugin")
	require.NoError(t, err)
	require.Empty(t, listed)
	profiles, err := ctrl.ListConnectionProfiles(testInvocationContext(), "plugin")
	require.NoError(t, err)
	require.Len(t, profiles, 1)
	require.Equal(t, "review", profiles[0].Source)
	require.False(t, profiles[0].Active)
	require.NoError(t, ctrl.OnPluginStop("plugin", defaultMeta()))
	ctrl.OnPluginInit("plugin", defaultMeta())
	after, err := root.ReadFile(storeName)
	require.NoError(t, err)
	require.Equal(t, before, after)
	provider := connectionOverlayTestProvider()
	registerMockPlugin(ctrl, "plugin", provider)
	imported, err := ctrl.ImportConnectionProfile(testInvocationContext(), "plugin", candidate.ID)
	require.NoError(t, err)
	require.True(t, imported.Applied)
	effective, err := provider.ListConnections(context.Background())
	require.NoError(t, err)
	require.Len(t, effective, 1)
	require.Equal(t, candidate.Data, effective[0].Data)
	current, err := ctrl.GetConnection(testInvocationContext(), "plugin", candidate.ID)
	require.NoError(t, err)
	require.Equal(t, candidate.Data, current.Data)
}

func TestLoadConnectionsReplacesRemovedSourceIDs(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	current := []types.Connection{profileTestConnection("removed", "old-endpoint")}
	provider := &mockProvider{LoadConnectionsFunc: func(context.Context) ([]types.Connection, error) {
		return current, nil
	}}
	registerMockPlugin(ctrl, "plugin", provider)
	_, err := ctrl.LoadConnections(testInvocationContext(), "plugin")
	require.NoError(t, err)
	current = []types.Connection{profileTestConnection("fresh", "new-endpoint")}
	_, err = ctrl.LoadConnections(testInvocationContext(), "plugin")
	require.NoError(t, err)
	_, err = ctrl.GetConnection(testInvocationContext(), "plugin", "removed")
	require.Error(t, err)
	listed, err := ctrl.ListConnections(testInvocationContext(), "plugin")
	require.NoError(t, err)
	require.Len(t, listed, 1)
	require.Equal(t, "fresh", listed[0].ID)
}

func TestConnectionWatchReplacesSnapshotWithoutReapplyingOverlay(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := connectionOverlayTestProvider()
	provider.ApplyConnectionOverlayFunc = func(context.Context, resourcev2.ConnectionOverlay) error {
		t.Error("watch snapshots must not reapply desired overlays")
		return errors.New("unexpected overlay replay")
	}
	provider.NativeConnectionsFunc = func(context.Context) ([]types.Connection, error) {
		t.Error("watch snapshots must not reload native configuration")
		return nil, errors.New("unexpected native reload")
	}
	provider.ListConnectionsFunc = func(context.Context) ([]types.Connection, error) {
		return []types.Connection{profileTestConnection("fresh", "new-endpoint")}, nil
	}
	provider.WatchConnectionsFunc = func(ctx context.Context, stream chan<- []types.Connection) error {
		stream <- []types.Connection{profileTestConnection("removed", "old-endpoint")}
		stream <- []types.Connection{profileTestConnection("fresh", "new-endpoint")}
		close(stream)
		<-ctx.Done()
		return ctx.Err()
	}
	registerMockPlugin(ctrl, "plugin", provider)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctrl.listenForConnectionEvents(ctx, "plugin", provider, ctrl.plugins["plugin"])
	listed, err := ctrl.ListConnections(testInvocationContext(), "plugin")
	require.NoError(t, err)
	require.Len(t, listed, 1)
	require.Equal(t, "fresh", listed[0].ID)
	_, err = ctrl.GetConnection(testInvocationContext(), "plugin", "removed")
	require.Error(t, err)
}

func TestConnectionProfilesPersistOnlyExplicitConfiguration(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	connection := profileTestConnection("opaque/id/雪", "endpoint")
	connection.LastRefresh = time.Now()
	connection.ExpiryTime = time.Hour
	connection.Client = make(chan struct{})
	connection.SetSensitiveData(map[string]any{"credential": "never-save"})
	state := emptyDesiredConnections()
	state.Profiles = append(state.Profiles, desiredConnectionProfile{Source: "manual", Configuration: profileConfig(connection)})
	data, err := encodeDesiredConnections(state)
	require.NoError(t, err)
	require.NotContains(t, string(data), "never-save")
	require.NotContains(t, string(data), "last_refresh")
	require.NotContains(t, string(data), "Client")
	require.NoError(t, writeDesiredConnections(store, data))
	loaded, err := readDesiredConnections(store)
	require.NoError(t, err)
	require.Equal(t, connection.ID, loaded.Profiles[0].Configuration.ID)
	require.Equal(t, "endpoint", loaded.overlay().Upserts[0].Data["endpoint"])
	require.Nil(t, loaded.overlay().Upserts[0].Client)
	require.Zero(t, loaded.overlay().Upserts[0].LastRefresh)
}

func TestConnectionProfileCommitRollsBackOnDiskFailure(t *testing.T) {
	for _, phase := range []string{"persist", "rollback"} {
		t.Run(phase, func(t *testing.T) {
			store, err := appstate.NewTestService(t).PluginStore("test")
			require.NoError(t, err)
			previous := emptyDesiredConnections()
			previous.Profiles = append(previous.Profiles, desiredConnectionProfile{Source: "manual", Configuration: profileConfig(profileTestConnection("id", "old"))})
			next := emptyDesiredConnections()
			next.Profiles = append(next.Profiles, desiredConnectionProfile{Source: "manual", Configuration: profileConfig(profileTestConnection("id", "new"))})
			before, err := encodeDesiredConnections(previous)
			require.NoError(t, err)
			require.NoError(t, writeDesiredConnections(store, before))
			provider := connectionOverlayTestProvider()
			applies := 0
			var active resourcev2.ConnectionOverlay
			provider.ApplyConnectionOverlayFunc = func(ctx context.Context, overlay resourcev2.ConnectionOverlay) error {
				applies++
				if phase == "rollback" && applies == 2 {
					return errors.New("private rollback detail")
				}
				active = overlay
				if applies == 1 {
					require.NoError(t, store.Remove(connectionProfileStoreName))
					require.NoError(t, store.MkdirAll(connectionProfileStoreName, 0o700))
				}
				return nil
			}
			provider.ListConnectionsFunc = func(context.Context) ([]types.Connection, error) { return active.Upserts, nil }
			_, err = applyDesiredConnections(context.Background(), provider, store, previous, next)
			require.Error(t, err)
			require.Equal(t, 2, applies)
			require.NotContains(t, err.Error(), "private")
			if phase == "rollback" {
				require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
				require.Contains(t, err.Error(), "actual source state is unknown")
			} else {
				require.Equal(t, "CONFLICT", resourcev2.ErrorCode(err))
				require.Equal(t, "old", active.Upserts[0].Data["endpoint"])
			}
		})
	}
}

func TestConnectionProfileSourceRejectionDoesNotPersist(t *testing.T) {
	store, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	provider := connectionOverlayTestProvider()
	provider.ApplyConnectionOverlayFunc = func(context.Context, resourcev2.ConnectionOverlay) error {
		return errors.New("private endpoint detail")
	}
	_, err = applyDesiredConnections(context.Background(), provider, store, emptyDesiredConnections(), emptyDesiredConnections())
	require.Error(t, err)
	require.Equal(t, "CONFLICT", resourcev2.ErrorCode(err))
	_, err = store.Stat(connectionProfileStoreName)
	require.True(t, os.IsNotExist(err))
}

func TestConnectionProfileStoreStrictAdmission(t *testing.T) {
	cases := []string{
		`{"version":1,"profiles":[],"disabledIDs":[],"extra":true}`,
		`{"version":1,"version":1,"profiles":[],"disabledIDs":[]}`,
		`{"version":1,"profiles":[],"disabledIDs":["same","same"]}`,
		`{"version":2,"profiles":[],"disabledIDs":[]}`,
		`{"version":1,"profiles":[{"source":"native","configuration":{"id":"x"}}],"disabledIDs":[]}`,
		`{"version":1,"profiles":[{"source":"manual","configuration":{"id":"x"}}],"disabledIDs":["x"]}`,
		`{"version":1,"profiles":[],"disabledIDs":[]}[]`,
		strings.Repeat("[", 66) + "0" + strings.Repeat("]", 66),
	}
	for _, data := range cases {
		store, err := appstate.NewTestService(t).PluginStore("test")
		require.NoError(t, err)
		require.NoError(t, store.WriteFile(connectionProfileStoreName, []byte(data), 0o600))
		_, err = readDesiredConnections(store)
		require.Error(t, err)
	}
}
