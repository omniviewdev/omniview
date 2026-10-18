package devserver

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcompose"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

// The runtime adapter consumes a completed receipt, never an installer mock or
// mere node_modules presence. The transaction owner is exercised independently.
func installedCompositionFixture(t *testing.T, workspace devcontract.ResolvedWorkspace) {
	t.Helper()
	var roots []devcompose.Root
	for _, repository := range workspace.Manifest.Repositories {
		directory := filepath.Join(workspace.Root, repository.Directory)
		if repository.ID != "omniview" {
			directory = filepath.Join(directory, "ui")
		}
		require.NoError(t, os.MkdirAll(directory, 0700))
		manifest := `{"name":"` + repository.ID + `-fixture","private":true,"packageManager":"pnpm@12.14.0"}`
		require.NoError(t, os.WriteFile(filepath.Join(directory, "package.json"), []byte(manifest), 0600))
		roots = append(roots, devcompose.Root{Path: directory, Version: "12.14.0"})
	}
	plan, err := devcompose.New(workspace, roots, nil)
	require.NoError(t, err)
	files := make([]map[string]any, 0, len(plan.Files))
	for _, file := range plan.Files {
		path := file.Path
		if !filepath.IsAbs(path) {
			path = filepath.Join(workspace.Root, path)
		}
		require.NoError(t, os.WriteFile(path, file.Data, 0600))
		relative, err := filepath.Rel(workspace.Root, path)
		require.NoError(t, err)
		digest := sha256.Sum256(file.Data)
		files = append(files, map[string]any{"path": filepath.ToSlash(relative), "appliedHash": hex.EncodeToString(digest[:]), "pending": false})
	}
	receipt, err := json.Marshal(map[string]any{"schemaVersion": 2, "workspaceID": workspace.Manifest.WorkspaceID, "root": workspace.Root, "phase": "linked", "manifest": workspace.Manifest, "evidence": map[string]any{"protocol": "workspace", "versions": []string{"12.14.0"}, "atomicDist": true, "peers": true, "runtime": true}, "plan": map[string]any{"composition": plan}, "files": files})
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Join(workspace.Root, ".local"), 0700))
	require.NoError(t, os.WriteFile(filepath.Join(workspace.Root, ".local", "links.json"), receipt, 0600))
}
