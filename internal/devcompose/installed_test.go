package devcompose

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestInstalledRefusesTamperedOrIncompleteCanonicalAuthority(t *testing.T) {
	for _, kind := range []string{"root", "uuid", "legacy", "pending", "file-edit", "missing-lock", "evidence"} {
		t.Run(kind, func(t *testing.T) {
			w, roots := fixture(t)
			p, err := New(w, roots, nil)
			if err != nil {
				t.Fatal(err)
			}
			files := []map[string]any{}
			for _, f := range p.Files {
				put(t, w.Root, filepath.Base(f.Path), string(f.Data))
				files = append(files, map[string]any{"path": filepath.Base(f.Path), "appliedHash": hash(f.Data)})
			}
			journal := map[string]any{"schemaVersion": 2, "workspaceID": w.Manifest.WorkspaceID, "root": w.Root, "phase": "linked", "manifest": w.Manifest, "evidence": map[string]any{"protocol": "workspace", "versions": []string{Version}, "atomicDist": true, "peers": true, "runtime": true}, "plan": map[string]any{"composition": p}, "files": files}
			switch kind {
			case "root":
				journal["root"] = filepath.Dir(w.Root)
			case "uuid":
				journal["workspaceID"] = "22222222-2222-4222-8222-222222222222"
			case "legacy":
				journal["schemaVersion"] = 1
			case "pending":
				files[0]["pending"] = true
			case "file-edit":
				put(t, w.Root, "package.json", `{"private":true,"edited":true}`)
			case "missing-lock":
				journal["files"] = files[:2]
			case "evidence":
				journal["evidence"] = map[string]any{"protocol": "link", "versions": []string{"10.34.7"}, "atomicDist": true, "peers": true, "runtime": true}
			}
			raw, _ := json.Marshal(journal)
			put(t, w.Root, ".local/links.json", string(raw))
			if _, err = Installed(w, roots[0].Path); err == nil {
				t.Fatal("unattested installation accepted")
			}
		})
	}
}
func TestValidateRemainsUsableForStoppedRecoveryAfterSourceEdit(t *testing.T) {
	w, roots := fixture(t)
	p, err := New(w, roots, nil)
	if err != nil {
		t.Fatal(err)
	}
	put(t, w.Root, "plugin-a/ui/package.json", `{"name":"plugin-ui","private":true,"peerDependencies":{"react":"^18"}}`)
	if err = Validate(w, p); err != nil {
		t.Fatalf("topology validation blocked safe stopped recovery: %v", err)
	}
	if err = CheckInputs(p); err == nil {
		t.Fatal("edited manifests authorized a live consumer")
	}
}
