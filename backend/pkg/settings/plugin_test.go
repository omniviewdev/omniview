package settings

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

type uncertainPlugin struct{ value any }

func (p *uncertainPlugin) Snapshot(string) (pkgsettings.Category, error) {
	return pkgsettings.Category{
		ID: "plugin",
		Settings: map[string]pkgsettings.Setting{
			"raw.dotted.id": {ID: "raw.dotted.id", Type: pkgsettings.Text, Value: p.value},
		},
	}, nil
}
func (p *uncertainPlugin) ValidateSetting(string, string, any) (pkgsettings.ValidationResult, error) {
	return pkgsettings.ValidationResult{Valid: true}, nil
}
func (p *uncertainPlugin) CommitSettings(
	_ context.Context, _ string, values map[string]any, persist pkgsettings.PersistFunc,
) (pkgsettings.CommitResult, error) {
	if err := persist(values); err != nil {
		return pkgsettings.CommitResult{}, err
	}
	p.value = values["raw.dotted.id"]
	return pkgsettings.CommitResult{Committed: true, Uncertain: true}, nil
}
func TestPluginDurableUncertaintyKeepsRawIDs(t *testing.T) {
	store := openStore(t)
	s, err := Initialize(Options{Store: store, Categories: definitions()})
	require.NoError(t, err)
	s.AttachPlugins(&uncertainPlugin{})
	scope := Scope{Kind: "plugin", PluginID: "plugin.with.dots"}
	result, err := s.Commit(scope, map[string]any{"raw.dotted.id": "saved"})
	require.NoError(t, err)
	require.False(t, result.Applied)
	require.True(t, result.Uncertain)
	require.NotEmpty(t, result.Message)
	require.Equal(t, "saved", result.Snapshot.Categories["plugin"].Settings["raw.dotted.id"].Value)
	values, err := store.LoadPluginSettings(scope.PluginID)
	require.NoError(t, err)
	require.Equal(t, map[string]any{"raw.dotted.id": "saved"}, values)
}
