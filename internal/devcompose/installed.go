package devcompose

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// This is a read-only projection of devworkspace's existing link journal, not
// another receipt or a second lifecycle. Unknown journal fields remain owned by
// that journal's writer. encoding/json accepts historical PascalCase keys too.
type installedJournal struct {
	SchemaVersion int                           `json:"schemaVersion"`
	WorkspaceID   string                        `json:"workspaceID"`
	Root          string                        `json:"root"`
	Phase         string                        `json:"phase"`
	Manifest      devcontract.WorkspaceManifest `json:"manifest"`
	Evidence      struct {
		Protocol   string   `json:"protocol"`
		Versions   []string `json:"versions"`
		AtomicDist bool     `json:"atomicDist"`
		Peers      bool     `json:"peers"`
		Runtime    bool     `json:"runtime"`
	} `json:"evidence"`
	Plan struct {
		Composition *Plan `json:"composition"`
	} `json:"plan"`
	Files []struct {
		Path        string `json:"path"`
		AppliedHash string `json:"appliedHash"`
		Pending     bool   `json:"pending"`
	} `json:"files"`
}

func Installed(w devcontract.ResolvedWorkspace, consumer string) (Plan, error) {
	var empty Plan
	if e := workspace(w); e != nil {
		return empty, e
	}
	path := filepath.Join(w.Root, ".local", "links.json")
	if e := exactPath(path); e != nil {
		return empty, e
	}
	raw, e := os.ReadFile(path)
	if e != nil {
		return empty, refusal("linked composition is unavailable; stop and link this workspace before starting consumers")
	}
	var journal installedJournal
	if json.Unmarshal(raw, &journal) != nil {
		return empty, refusal("invalid canonical links journal")
	}
	if journal.SchemaVersion != 2 || journal.Root != w.Root || journal.WorkspaceID != w.Manifest.WorkspaceID || journal.Phase != "linked" || journal.Plan.Composition == nil {
		return empty, refusal("canonical links journal is not a completed schema2 composition; stop and reconfigure")
	}
	if !reflect.DeepEqual(journal.Manifest, w.Manifest) {
		return empty, refusal("linked manifest no longer matches selected workspace")
	}
	proof := journal.Evidence
	if proof.Protocol != "workspace" || len(proof.Versions) != 1 || proof.Versions[0] != Version || !proof.AtomicDist || !proof.Peers || !proof.Runtime {
		return empty, refusal("linked composition lacks native12 workspace protocol evidence")
	}
	p := *journal.Plan.Composition
	if e = Validate(w, p); e != nil {
		return empty, e
	}
	if e = CheckInputs(p); e != nil {
		return empty, e
	}
	if e = exactPath(consumer); e != nil {
		return empty, e
	}
	selected := false
	for _, pkg := range p.Packages {
		if consumer == pkg.Path {
			selected = true
			break
		}
	}
	for _, root := range p.Roots {
		if consumer == root.Path {
			selected = true
			break
		}
	}
	if !selected {
		return empty, refusal("consumer is not an actual selected composition package/root")
	}
	generated := map[string]bool{"package.json": false, "pnpm-workspace.yaml": false, "pnpm-lock.yaml": false}
	seen := map[string]bool{}
	for _, file := range journal.Files {
		if file.Pending {
			return empty, refusal("canonical links journal has pending file outputs")
		}
		if filepath.IsAbs(file.Path) || filepath.Clean(file.Path) != file.Path || !within(w.Root, filepath.Join(w.Root, file.Path)) || seen[file.Path] {
			return empty, refusal("invalid or duplicate canonical links journal file path")
		}
		seen[file.Path] = true
		if _, ok := generated[file.Path]; !ok {
			continue
		}
		path := filepath.Join(w.Root, file.Path)
		if e = exactPath(path); e != nil {
			return empty, e
		}
		info, e := os.Lstat(path)
		if e != nil || !info.Mode().IsRegular() {
			return empty, refusal("generated composition file is unavailable")
		}
		raw, e := os.ReadFile(path)
		if e != nil || file.AppliedHash == "" || hash(raw) != file.AppliedHash {
			return empty, refusal("generated composition file changed; stop and reconfigure")
		}
		generated[file.Path] = true
	}
	for _, ok := range generated {
		if !ok {
			return empty, refusal("canonical links journal does not attest all generated composition files")
		}
	}
	return p, nil
}
