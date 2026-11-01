package devworkspace

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestDiscoverCollectionsUsesRegisteredWorktreesWithoutSelectingProfile(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	_, err := m.Create(ctx, CreateOptions{Slug: "first"})
	require.NoError(t, err)
	second := filepath.Join(t.TempDir(), "second collection's root")
	_, err = Init(ctx, InitOptions{Root: second, Sources: []SourceSpec{{ID: "omniview", Path: filepath.Join(root, "omniview"), DefaultRef: "main"}}})
	require.NoError(t, err)
	other, err := Open(second, Options{Home: m.options.Home})
	require.NoError(t, err)
	_, err = other.Create(ctx, CreateOptions{Slug: "second"})
	require.NoError(t, err)
	// A worktree nested below another repository's collection is not membership.
	foreign := t.TempDir()
	foreignSource := fixtureRepo(t, t.TempDir(), "unrelated", "")
	_, err = Init(ctx, InitOptions{Root: foreign, Sources: []SourceSpec{{ID: "omniview", Path: foreignSource, DefaultRef: "main"}}})
	require.NoError(t, err)
	fixtureGit(t, filepath.Join(root, "omniview"), "worktree", "add", "--detach", filepath.Join(foreign, "unrelated-worktree"))
	// Ambient Git selectors cannot redirect discovery to an unrelated checkout.
	t.Setenv("GIT_DIR", filepath.Join(foreignSource, ".git"))
	found, err := DiscoverCollections(ctx, filepath.Join(root, "omniview"))
	require.NoError(t, err)
	want := []string{root, other.Root}
	sort.Strings(want)
	require.Equal(t, want, found)
	items, err := m.List(ctx)
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, "first", items[0].Manifest.Slug)
}

func TestDiscoverCollectionsRefusesRedirectedRegistryAndHonorsCancellation(t *testing.T) {
	m, root := fixtureManager(t)
	_, err := m.Create(context.Background(), CreateOptions{Slug: "feature"})
	require.NoError(t, err)
	marker := filepath.Join(root, ".omniview-dev", "repositories.json")
	backup := marker + ".saved"
	require.NoError(t, os.Rename(marker, backup))
	if err := os.Symlink(backup, marker); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	found, err := DiscoverCollections(context.Background(), filepath.Join(root, "omniview"))
	require.NoError(t, err)
	require.Empty(t, found)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = DiscoverCollections(ctx, filepath.Join(root, "omniview"))
	require.True(t, errors.Is(err, context.Canceled))
}

func TestRegistryAndCollectionsRejectExpiredContext(t *testing.T) {
	_, root := fixtureManager(t)
	ctx, cancel := context.WithDeadline(context.Background(), time.Unix(0, 0))
	defer cancel()
	_, err := LoadRegistry(ctx, root)
	require.ErrorIs(t, err, context.DeadlineExceeded)
	found, err := DiscoverCollections(ctx, filepath.Join(root, "omniview"))
	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.Nil(t, found)
	require.ErrorIs(t, validateSources(ctx, nil), context.DeadlineExceeded)
}
