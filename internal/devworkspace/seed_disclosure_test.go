package devworkspace

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devbaseline"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	"github.com/stretchr/testify/require"
)

func TestSeedDisclosureRequiresPublishedImportEvidenceOnResume(t *testing.T) {
	s := supervisorEdgeFixture(t)
	source, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	store, err := settingsstore.Open(filepath.Join(source, "settings.db"))
	require.NoError(t, err)
	require.NoError(t, store.SaveCategory("appearance", map[string]any{"theme": "void"}))
	require.NoError(t, store.Close())
	s.options.BaselineSource = source
	err = s.seed(context.Background())
	require.NoError(t, err, "%#v", err)
	require.NotNil(t, s.status.Seed)
	require.Equal(t, devbaseline.Policy, s.status.Seed.Policy)
	require.Contains(t, s.status.Seed.Exclusions, "metric-bindings-and-configuration")
	s.status.Seed = nil
	require.NoError(t, s.seed(context.Background()))
	require.NotNil(t, s.status.Seed)
	status, err := s.manager.Status(context.Background(), s.workspace.Manifest.Slug)
	require.NoError(t, err)
	require.NotNil(t, status.Seed)
	encoded, err := json.Marshal(status)
	require.NoError(t, err)
	var consumer struct {
		Seed struct {
			Policy      string   `json:"policy"`
			CopiedScope []string `json:"copiedScope"`
			Exclusions  []string `json:"exclusions"`
		} `json:"seed"`
	}
	require.NoError(t, json.Unmarshal(encoded, &consumer))
	require.Equal(t, devbaseline.Policy, consumer.Seed.Policy)
	require.Contains(t, consumer.Seed.CopiedScope, "allowlisted-safe-preferences")
	require.Contains(t, consumer.Seed.Exclusions, "grafana-connections-and-credentials")
	require.NoError(t, os.Remove(filepath.Join(s.workspace.StateRoot, "settings.db")))
	require.Error(t, s.seed(context.Background()))
	require.Nil(t, s.status.Seed)
	status, err = s.manager.Status(context.Background(), s.workspace.Manifest.Slug)
	require.NoError(t, err)
	require.Nil(t, status.Seed)
}

func TestSeedIntentRecoveryRejectsReceiptWithoutCopiedPreferences(t *testing.T) {
	s := supervisorEdgeFixture(t)
	source, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	store, err := settingsstore.Open(filepath.Join(source, "settings.db"))
	require.NoError(t, err)
	require.NoError(t, store.SaveCategory("general", map[string]any{"language": "es"}))
	require.NoError(t, store.Close())
	s.options.BaselineSource = source
	err = s.seed(context.Background())
	require.NoError(t, err, "%#v", err)
	require.NoError(t, os.Remove(launchPath(s.workspace, "baseline-seeded.json")))
	store, err = settingsstore.Open(filepath.Join(s.workspace.StateRoot, "settings.db"))
	require.NoError(t, err)
	require.NoError(t, store.SaveCategory("general", map[string]any{"language": "en"}))
	require.NoError(t, store.Close())
	require.Error(t, s.seed(context.Background()))
	require.Nil(t, s.status.Seed)
	_, err = os.Lstat(launchPath(s.workspace, "baseline-seeded.json"))
	require.True(t, os.IsNotExist(err))
}
