package settings

import (
	"context"
	"encoding/json"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"

	internaltypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

// reloadBackend supplies the replacement settings capability to OnPluginStart.
// Other backend operations are outside the controller's settings lifecycle.
type reloadBackend struct {
	internaltypes.PluginBackend
	provider *reloadPrivacyProvider
}

func (b reloadBackend) Dispense(string) (interface{}, error) { return b.provider, nil }
func (b reloadBackend) NegotiatedVersion() int               { return 1 }

type reloadPrivacyProvider struct {
	*mockSettingsProvider
	persisted chan struct{}
	release   <-chan struct{}
}

func (p *reloadPrivacyProvider) CommitSettings(
	ctx context.Context,
	_ map[string]any,
	persist pkgsettings.PersistFunc,
) (pkgsettings.CommitResult, error) {
	// The replacement plugin normalizes its old public value to a new secret.
	normalized := map[string]any{"credential": "replacement-private-value"}
	if err := persist(normalized); err != nil {
		return pkgsettings.CommitResult{}, err
	}
	close(p.persisted)
	select {
	case <-p.release:
	case <-ctx.Done():
		return pkgsettings.CommitResult{}, ctx.Err()
	}
	return p.mockSettingsProvider.CommitSettings(ctx, normalized, nil)
}

func TestSnapshotDuringReloadNeverUsesOldPublicSchemaForNewSecret(t *testing.T) {
	store := openTestStore(t)
	require.NoError(t, store.SavePluginSettings("fixture", map[string]any{"credential": "old-public-value"}))
	ctrl, ok := NewController(logging.NewNop(), store).(*controller)
	require.True(t, ok)
	ctrl.schemaCache["fixture"] = map[string]pkgsettings.Setting{
		"credential": {ID: "credential", Type: pkgsettings.Text, RequiresRestart: true},
	}
	ctrl.baseline["fixture"] = map[string]any{"credential": "old-public-value"}
	before, err := ctrl.Snapshot("fixture")
	require.NoError(t, err)
	require.Equal(t, "old-public-value", before.Settings["credential"].Value)
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	replacement := &reloadPrivacyProvider{
		mockSettingsProvider: newMockProvider(map[string]pkgsettings.Setting{
			"credential": {
				ID: "credential", Type: pkgsettings.Text, Sensitive: true, Default: "replacement-private-default",
			},
		}),
		persisted: make(chan struct{}), release: release,
	}
	done := make(chan error, 1)
	go func() {
		done <- ctrl.OnPluginStart("fixture", pluginMeta("fixture"), reloadBackend{provider: replacement})
	}()
	<-replacement.persisted
	// Hydration has committed the replacement's secret, but has not yet published
	// its authoritative schema. The public snapshot must classify it as unknown.
	during, err := ctrl.Snapshot("fixture")
	require.NoError(t, err)
	require.True(t, during.Settings["credential"].Sensitive)
	require.Equal(t, "[REDACTED]", during.Settings["credential"].Value)
	require.False(t, during.Settings["credential"].PendingRestart)
	encoded, err := json.Marshal(during)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "replacement-private")
	saved, err := store.LoadPluginSettings("fixture")
	require.NoError(t, err)
	require.Equal(t, "replacement-private-value", saved["credential"])
	unblock()
	require.NoError(t, <-done)
	after, err := ctrl.Snapshot("fixture")
	require.NoError(t, err)
	require.True(t, after.Settings["credential"].Sensitive)
	require.Equal(t, "[REDACTED]", after.Settings["credential"].Value)
}
