package devworkspace

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

func TestPortPolicyDefaultExplicitSelectionAndImmutableOptionMaps(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	reg, err := LoadRegistry(ctx, root)
	require.NoError(t, err)
	policy := devcontract.PortPolicy{Policy: "strict", Overrides: map[string]int{"browser": 18711, "plugin-vite:kubernetes": 18712}}
	planned, err := m.plan(ctx, reg, CreateOptions{Slug: "planned-policy", Ports: &policy})
	require.NoError(t, err)
	policy.Overrides["browser"] = 18799
	require.Equal(t, 18711, planned.Ports.Overrides["browser"], "manifest planning must copy caller-owned overrides")
	w, err := m.Create(ctx, CreateOptions{Slug: "port-policy"})
	require.NoError(t, err)
	require.Equal(t, "sticky", w.Manifest.Ports.Policy)
	require.Empty(t, w.Manifest.Ports.Overrides)
	w, err = m.Edit(ctx, "port-policy", EditOptions{Ports: new(devcontract.PortPolicy{Policy: "strict", Overrides: map[string]int{"browser": 18721, "vite": 18722}})})
	require.NoError(t, err)
	require.Equal(t, "strict", w.Manifest.Ports.Policy)
	require.Equal(t, 18721, w.Manifest.Ports.Overrides["browser"])
	name := "Unrelated edit"
	w, err = m.Edit(ctx, "port-policy", EditOptions{DisplayName: &name})
	require.NoError(t, err)
	require.Equal(t, "strict", w.Manifest.Ports.Policy)
	require.Equal(t, 18722, w.Manifest.Ports.Overrides["vite"])
}

func TestInvalidPortPolicyHasNoWorkspaceOrGitEffects(t *testing.T) {
	m, root := fixtureManager(t)
	ctx := context.Background()
	source := filepath.Join(root, "omniview")
	before := fixtureGit(t, source, "worktree", "list", "--porcelain")
	_, err := m.Create(ctx, CreateOptions{Slug: "invalid-ports", Ports: new(devcontract.PortPolicy{Policy: "strict", Overrides: map[string]int{"browser": 18731, "vite": 18731}})})
	require.Error(t, err)
	require.NoDirExists(t, filepath.Join(root, "workspaces", "invalid-ports"))
	require.Equal(t, before, fixtureGit(t, source, "worktree", "list", "--porcelain"))
	w, err := m.Create(ctx, CreateOptions{Slug: "unchanged-policy"})
	require.NoError(t, err)
	before = fixtureGit(t, source, "worktree", "list", "--porcelain")
	_, err = m.Edit(ctx, "unchanged-policy", EditOptions{Ports: new(devcontract.PortPolicy{Policy: "invalid", Overrides: map[string]int{}}), AddRepositories: []string{"ui"}})
	require.Error(t, err)
	require.NoDirExists(t, filepath.Join(w.Root, "ui"))
	require.Equal(t, before, fixtureGit(t, source, "worktree", "list", "--porcelain"))
	current, err := m.Inspect(ctx, "unchanged-policy")
	require.NoError(t, err)
	require.Equal(t, "sticky", current.Manifest.Ports.Policy)
	require.Empty(t, current.Manifest.Ports.Overrides)
	require.Equal(t, "complete", current.Phase)
}
