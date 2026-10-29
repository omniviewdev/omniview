package devworkspace

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestUpstreamConfigurationRejectsWholeEditBeforeMutation(t *testing.T) {
	m, w, _, _ := upstreamFixture(t)
	before, err := os.ReadFile(w.ManifestPath)
	require.NoError(t, err)
	display := "must not persist"
	_, err = m.Reconfigure(context.Background(), w.Manifest.Slug, EditOptions{
		DisplayName: &display, Upstreams: map[string]string{"omniview": "missing/main"},
	})
	require.Error(t, err)
	after, err := os.ReadFile(w.ManifestPath)
	require.NoError(t, err)
	require.Equal(t, before, after)
	current, err := m.Inspect(context.Background(), w.Manifest.WorkspaceID)
	require.NoError(t, err)
	require.Equal(t, w.Manifest.DisplayName, current.Manifest.DisplayName)
}

func TestUpstreamConfigurationPersistsWithoutChangingSelection(t *testing.T) {
	m, w, _, _ := upstreamFixture(t)
	old := w.Manifest.Repositories[0]
	configured, err := m.ConfigureUpstreams(
		context.Background(), w.Manifest.Slug, map[string]string{old.ID: "origin/main"},
	)
	require.NoError(t, err)
	require.Equal(t, old.BaseRef, configured.Manifest.Repositories[0].BaseRef)
	require.Equal(t, old.BaseCommit, configured.Manifest.Repositories[0].BaseCommit)
	require.Equal(t, "origin", configured.Manifest.Repositories[0].Upstream.Remote)
	require.Equal(t, "refs/heads/main", configured.Manifest.Repositories[0].Upstream.Branch)
}
