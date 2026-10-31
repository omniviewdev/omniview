package settings

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	logging "github.com/omniviewdev/plugin-sdk/log"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

func TestCommitPersistenceFailureDoesNotPublish(t *testing.T) {
	store := openTestStore(t)
	provider := newMockProvider(map[string]pkgsettings.Setting{
		"raw.dotted.id": {ID: "raw.dotted.id", Value: "old"},
	})
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok, "settings controller must expose its concrete implementation")
	ctrl.clients["fixture"] = provider
	ctrl.hydrated["fixture"] = true
	result, err := ctrl.CommitSettings(
		context.Background(), "fixture", map[string]any{"raw.dotted.id": "new"},
		func(map[string]any) error { return assert.AnError },
	)
	require.Error(t, err)
	assert.False(t, result.Committed)
	assert.Equal(t, "old", provider.settings["raw.dotted.id"].Value)
}

func TestSnapshotUsesSavedValuesAfterUncertainApply(t *testing.T) {
	store := openTestStore(t)
	provider := newMockProvider(map[string]pkgsettings.Setting{
		"raw.dotted.id": {ID: "raw.dotted.id", Value: "old", RequiresRestart: true},
		"token":         {ID: "token", Value: "private", Default: "private-default", Sensitive: true},
	})
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok, "settings controller must expose its concrete implementation")
	ctrl.clients["fixture"] = provider
	ctrl.hydratePlugin(context.Background(), "fixture", provider, ctrl.logger)
	provider.uncertain = true
	result, err := ctrl.CommitSettings(
		context.Background(), "fixture", map[string]any{"raw.dotted.id": "new"},
		func(values map[string]any) error {
			return store.PatchPluginSettings("fixture", values)
		},
	)
	require.NoError(t, err)
	require.True(t, result.Committed)
	require.True(t, result.Uncertain)
	assert.False(t, result.Applied)
	assert.Equal(t, "old", provider.settings["raw.dotted.id"].Value)
	snapshot, err := ctrl.Snapshot("fixture")
	require.NoError(t, err)
	assert.Equal(t, "plugin", snapshot.ID)
	assert.Equal(t, "new", snapshot.Settings["raw.dotted.id"].Value)
	assert.True(t, snapshot.Settings["raw.dotted.id"].PendingRestart)
	assert.Equal(t, "[REDACTED]", snapshot.Settings["token"].Value)
	assert.Equal(t, "[REDACTED]", snapshot.Settings["token"].Default)
}

func TestHydrationCapturesBaselineBeforeQueuedCommit(t *testing.T) {
	store := openTestStore(t)
	require.NoError(t, store.SavePluginSettings("fixture", map[string]any{"raw.dotted.id": 3}))
	provider := newMockProvider(map[string]pkgsettings.Setting{
		"raw.dotted.id": {ID: "raw.dotted.id", Value: 1, RequiresRestart: true},
	})
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok, "settings controller must expose its concrete implementation")
	ctrl.clients["fixture"] = provider
	done := make(chan commitOutcome, 1)
	ctrl.pendingChanges["fixture"] = []pendingChange{{
		settings: map[string]any{"raw.dotted.id": 4},
		persist:  func(values map[string]any) error { return store.PatchPluginSettings("fixture", values) },
		ctx:      context.Background(),
		done:     done,
	}}
	ctrl.hydratePlugin(context.Background(), "fixture", provider, ctrl.logger)
	outcome := <-done
	require.NoError(t, outcome.err)
	require.True(t, outcome.result.Applied)
	assert.EqualValues(t, 3, ctrl.baseline["fixture"]["raw.dotted.id"])
	snapshot, err := ctrl.Snapshot("fixture")
	require.NoError(t, err)
	assert.True(t, snapshot.Settings["raw.dotted.id"].PendingRestart)
	assert.EqualValues(t, 4, snapshot.Settings["raw.dotted.id"].Value)
}

func TestCanceledQueuedCommitDoesNotPersist(t *testing.T) {
	store := openTestStore(t)
	provider := newMockProvider(map[string]pkgsettings.Setting{
		"raw.dotted.id": {ID: "raw.dotted.id", Value: "old"},
	})
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok, "settings controller must expose its concrete implementation")
	ctrl.clients["fixture"] = provider
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result, err := ctrl.CommitSettings(
		ctx, "fixture", map[string]any{"raw.dotted.id": "new"},
		func(values map[string]any) error {
			return store.PatchPluginSettings("fixture", values)
		},
	)
	require.ErrorIs(t, err, context.Canceled)
	assert.False(t, result.Committed)
	assert.Empty(t, ctrl.pendingChanges["fixture"])
	values, err := store.LoadPluginSettings("fixture")
	require.NoError(t, err)
	assert.Empty(t, values)
}
