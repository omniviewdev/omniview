package devworkspace

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcompose"
)

func supervisorCompositionFixture(t *testing.T, w Workspace, roots ...string) devcompose.Plan {
	t.Helper()
	selected := make([]devcompose.Root, 0, len(roots))
	for _, root := range roots {
		selected = append(selected, devcompose.Root{Path: root, Version: "12.14.0"})
	}
	plan, err := devcompose.New(w.ResolvedWorkspace, selected, nil)
	if err != nil {
		t.Fatal(err)
	}
	var files []map[string]any
	for _, file := range plan.Files {
		path := file.Path
		if !filepath.IsAbs(path) {
			path = filepath.Join(w.Root, path)
		}
		if err = os.WriteFile(path, file.Data, 0600); err != nil {
			t.Fatal(err)
		}
		relative, err := filepath.Rel(w.Root, path)
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(file.Data)
		files = append(files, map[string]any{"path": filepath.ToSlash(relative), "appliedHash": hex.EncodeToString(digest[:]), "pending": false})
	}
	receipt, err := json.Marshal(map[string]any{"schemaVersion": 2, "workspaceID": w.Manifest.WorkspaceID, "root": w.Root, "phase": "linked", "manifest": w.Manifest, "evidence": map[string]any{"protocol": "workspace", "versions": []string{"12.14.0"}, "atomicDist": true, "peers": true, "runtime": true}, "plan": map[string]any{"composition": plan}, "files": files})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(w.Root, ".local", "links.json"), receipt, 0600); err != nil {
		t.Fatal(err)
	}
	return plan
}
