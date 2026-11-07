package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devbaseline"
	"github.com/omniviewdev/omniview/internal/devworkspace"
	"github.com/omniviewdev/omniview/internal/instance"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	"github.com/stretchr/testify/require"
)

func TestWorkspaceStatusCLIReportsValidatedSeedScope(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("OMNIVIEW_WORKSPACE_FILE", "")
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	root := t.TempDir()
	repo := filepath.Join(t.TempDir(), "source")
	require.NoError(t, os.Mkdir(repo, 0700))
	for _, args := range [][]string{{"init", "-b", "main"}, {"-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = repo
		raw, err := cmd.CombinedOutput()
		require.NoError(t, err, "%s", raw)
	}
	invoke := func(args ...string) []byte {
		t.Helper()
		var out, diagnostics bytes.Buffer
		require.Equal(t, 0, run(args, &out, &diagnostics), "%s %s", &out, &diagnostics)
		return out.Bytes()
	}
	invoke("workspace", "init", "--root", root, "--source", "omniview="+repo, "--source-ref", "omniview=main", "--json")
	var workspace devworkspace.Workspace
	require.NoError(t, json.Unmarshal(invoke("workspace", "create", "seed-consumer", "--root", root, "--json"), &workspace))
	profile, err := instance.Resolve(instance.Options{Workspace: workspace.ManifestPath, Home: home, Channel: "local"})
	require.NoError(t, err)
	source, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	store, err := settingsstore.Open(filepath.Join(source, "settings.db"))
	require.NoError(t, err)
	require.NoError(t, store.SaveCategory("general", map[string]any{"language": "es", "token": "fixture-private-value"}))
	require.NoError(t, store.Close())
	_, err = devbaseline.Seed(context.Background(), devbaseline.SnapshotOptions{SourceRoot: source}, devbaseline.ImportOptions{Destination: profile, Home: home})
	require.NoError(t, err, "%#v", err)
	raw, err := os.ReadFile(filepath.Join(workspace.StateRoot, "baseline.json"))
	require.NoError(t, err)
	var baseline devbaseline.Baseline
	require.NoError(t, json.Unmarshal(raw, &baseline))
	normalized, err := json.Marshal(baseline)
	require.NoError(t, err)
	digest := sha256.Sum256(normalized)
	marker, err := json.Marshal(map[string]string{"source": source, "digest": hex.EncodeToString(digest[:])})
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Join(workspace.Root, ".local"), 0700))
	require.NoError(t, os.WriteFile(filepath.Join(workspace.Root, ".local", "baseline-seeded.json"), marker, 0600))
	output := invoke("workspace", "inspect", "--workspace", workspace.ManifestPath, "--json")
	var consumer struct {
		Seed devbaseline.Result `json:"seed"`
	}
	require.NoError(t, json.Unmarshal(output, &consumer))
	require.Equal(t, devbaseline.Policy, consumer.Seed.Policy)
	require.Contains(t, consumer.Seed.CopiedScope, "allowlisted-safe-preferences")
	require.Contains(t, consumer.Seed.Exclusions, "grafana-connections-and-credentials")
	require.Contains(t, consumer.Seed.Exclusions, "metric-bindings-and-configuration")
	require.NotContains(t, string(output), source)
	require.NotContains(t, string(output), "fixture-private-value")
	human := invoke("workspace", "inspect", "--workspace", workspace.ManifestPath)
	require.Contains(t, string(human), devbaseline.Policy)
	require.Contains(t, string(human), "metric-bindings-and-configuration")
	require.NoError(t, os.Remove(filepath.Join(workspace.StateRoot, "settings.db")))
	output = invoke("workspace", "inspect", "--workspace", workspace.ManifestPath, "--json")
	var unproven map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(output, &unproven))
	require.NotContains(t, unproven, "seed")
}
