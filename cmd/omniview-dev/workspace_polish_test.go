package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devbaseline"
	"github.com/omniviewdev/omniview/internal/devworkspace"
	"github.com/omniviewdev/omniview/internal/instance"
	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	"github.com/stretchr/testify/require"
)

func TestCollectionCommandsAdvertiseNoTarget(t *testing.T) {
	for _, verb := range []string{"init", "list", "collections"} {
		t.Run(verb, func(t *testing.T) {
			var out, diagnostics bytes.Buffer
			require.Zero(t, run([]string{"workspace", verb, "--help"}, &out, &diagnostics))
			require.NotContains(t, out.String(), "[NAME]")
			require.Contains(t, out.String(), "workspace "+verb+" [flags]")
			require.Equal(t, 2, run([]string{"workspace", verb, "unexpected"}, &out, &diagnostics))
		})
	}
}

func TestStoppedSeededResumeDisclosesValidatedImport(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, "config"))
	t.Setenv("XDG_DATA_HOME", filepath.Join(home, "data"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(home, "cache"))
	t.Setenv("KUBECONFIG", filepath.Join(home, "absent-kube"))
	t.Setenv("AWS_CONFIG_FILE", filepath.Join(home, "absent-aws"))
	t.Setenv("AWS_SHARED_CREDENTIALS_FILE", filepath.Join(home, "absent-credentials"))
	t.Setenv("OMNIVIEW_WORKSPACE", "")
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	root := t.TempDir()
	source := t.TempDir()
	for _, args := range [][]string{{"init", "-b", "main"}, {"-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = source
		raw, err := cmd.CombinedOutput()
		require.NoError(t, err, "%s", raw)
	}
	invoke := func(args ...string) []byte {
		t.Helper()
		var out, diagnostics bytes.Buffer
		if binary := os.Getenv("OMNIVIEW_POLISH_SMOKE_BINARY"); binary != "" {
			cmd := exec.Command(binary, args...)
			cmd.Stdout, cmd.Stderr = &out, &diagnostics
			require.NoError(t, cmd.Run(), "%s", diagnostics.String())
		} else {
			require.Zero(t, run(args, &out, &diagnostics), "%s", diagnostics.String())
		}
		return out.Bytes()
	}
	invoke("workspace", "init", "--root", root, "--source", "omniview="+source, "--source-ref", "omniview=main", "--json")
	var w devworkspace.Workspace
	require.NoError(t, json.Unmarshal(invoke("workspace", "create", "seeded", "--root", root, "--json"), &w))
	seed, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	store, err := settingsstore.Open(filepath.Join(seed, "settings.db"))
	require.NoError(t, err)
	require.NoError(t, store.SaveCategory("appearance", map[string]any{"theme": "void"}))
	require.NoError(t, store.Close())
	profile, err := instance.Resolve(instance.Options{Workspace: w.ManifestPath, StateRoot: w.StateRoot, Home: home, Channel: "local"})
	require.NoError(t, err)
	_, err = devbaseline.Seed(context.Background(), devbaseline.SnapshotOptions{SourceRoot: seed}, devbaseline.ImportOptions{Destination: profile, Home: home})
	require.NoError(t, err)
	raw, err := os.ReadFile(filepath.Join(w.StateRoot, "baseline.json"))
	require.NoError(t, err)
	var receipt devbaseline.Baseline
	require.NoError(t, json.Unmarshal(raw, &receipt))
	normalized, err := json.Marshal(receipt)
	require.NoError(t, err)
	marker, err := json.Marshal(map[string]string{"source": seed, "digest": fmt.Sprintf("%x", sha256.Sum256(normalized))})
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Join(w.Root, ".local"), 0700))
	require.NoError(t, os.WriteFile(filepath.Join(w.Root, ".local", "baseline-seeded.json"), marker, 0600))
	var inspected, resumed struct {
		Seed *devbaseline.Result `json:"seed"`
	}
	require.NoError(t, json.Unmarshal(invoke("workspace", "inspect", "seeded", "--root", root, "--json"), &inspected))
	require.NotNil(t, inspected.Seed)
	output := invoke("workspace", "resume", "seeded", "--root", root, "--json")
	require.NoError(t, json.Unmarshal(output, &resumed))
	require.Equal(t, inspected.Seed, resumed.Seed)
	require.Equal(t, devbaseline.Policy, resumed.Seed.Policy)
	require.Contains(t, resumed.Seed.CopiedScope, "allowlisted-safe-preferences")
	require.Contains(t, resumed.Seed.Exclusions, "grafana-connections-and-credentials")
	require.False(t, strings.Contains(string(output), seed))
	require.NoError(t, os.Remove(filepath.Join(w.StateRoot, "settings.db")))
	var invalid struct {
		Seed *devbaseline.Result `json:"seed"`
	}
	require.NoError(t, json.Unmarshal(invoke("workspace", "resume", "seeded", "--root", root, "--json"), &invalid))
	require.Nil(t, invalid.Seed)
}
