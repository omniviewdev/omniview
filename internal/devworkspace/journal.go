package devworkspace

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/gofrs/flock"
	"github.com/omniviewdev/omniview/internal/devcontract"
)

type resource struct {
	Repository devcontract.Repository `json:"repository"`
	CommonDir  string                 `json:"commonDir"`
	Path       string                 `json:"path"`
	GitDir     string                 `json:"gitDir,omitempty"`
	Marker     string                 `json:"marker"`
	Removed    bool                   `json:"removed"`
	// RefTarget is persisted before an owned fast-forward, so a crash between
	// advancing HEAD and advancing its marker can be resumed without guessing.
	RefTarget string `json:"refTarget,omitempty"`
}

type journal struct {
	SchemaVersion        int                           `json:"schemaVersion"`
	WorkspaceID          string                        `json:"workspaceID"`
	Root                 string                        `json:"root"`
	Phase                string                        `json:"phase"`
	RenameTo             string                        `json:"renameTo,omitempty"`
	StageRoot            string                        `json:"stageRoot,omitempty"`
	StagingVersion       int                           `json:"stagingVersion,omitempty"`
	Retired              bool                          `json:"retired"`
	Rollback             bool                          `json:"rollback"`
	SelectedStateRoot    string                        `json:"selectedStateRoot,omitempty"`
	ProfileBindingSHA256 string                        `json:"profileBindingSHA256,omitempty"`
	Manifest             devcontract.WorkspaceManifest `json:"manifest"`
	Resources            []resource                    `json:"resources"`
	DeleteBranches       bool                          `json:"deleteBranches"`
	PurgeState           bool                          `json:"purgeState"`
}

func newJournal(root string, manifest devcontract.WorkspaceManifest, reg Registry) *journal {
	j := &journal{SchemaVersion: 1, StagingVersion: 1, WorkspaceID: manifest.WorkspaceID, Root: root, Phase: "create", Manifest: manifest}
	for _, repo := range manifest.Repositories {
		for _, source := range reg.Repositories {
			if source.ID == repo.ID {
				j.Resources = append(j.Resources, makeResource(root, manifest.WorkspaceID, repo, source))
			}
		}
	}
	return j
}

func makeResource(root, id string, repo devcontract.Repository, source Source) resource {
	return resource{Repository: repo, CommonDir: source.CommonDir, Path: filepath.Join(root, repo.Directory), Marker: "refs/omniview-dev/workspaces/" + id + "/" + repo.ID}
}

func atomicJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".write-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(append(data, '\n')); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return err
	}
	// Persist the rename, not merely the temporary file's contents.
	d, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

func saveJournal(root string, j *journal) error {
	return atomicOwnedJSON(filepath.Join(root, ".local", "ownership.json"), j, j.WorkspaceID)
}

func loadJournal(root string) (*journal, error) {
	var j journal
	path := filepath.Join(root, ".local", "ownership.json")
	canonical, err := devcontract.CanonicalPath(path)
	if err != nil {
		return nil, err
	}
	if canonical != path {
		return nil, devcontract.Fail(4, "foreign_workspace", "ownership journal cannot be redirected through symlinks")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, devcontract.Fail(4, "foreign_workspace", "workspace has no local ownership journal")
	}
	if err = json.Unmarshal(data, &j); err != nil || j.SchemaVersion != 1 || (j.Root != root && !(j.Phase == "rename" && j.RenameTo == root) && !(j.Phase == "create" && j.StageRoot == root) && !(j.Phase == "retire" && retiredRoot(&j) == root)) || j.WorkspaceID != j.Manifest.WorkspaceID {
		return nil, devcontract.Fail(4, "invalid_journal", "workspace ownership journal does not match this location")
	}
	if err = j.Manifest.Validate(); err != nil {
		return nil, err
	}
	if !filepath.IsAbs(j.Root) || filepath.Dir(j.Root) != filepath.Dir(root) || (j.RenameTo != "" && (filepath.Dir(j.RenameTo) != filepath.Dir(root) || filepath.Base(j.RenameTo) != j.Manifest.Slug)) {
		return nil, devcontract.Fail(4, "invalid_journal", "workspace rename intent leaves its registered collection")
	}
	if j.StageRoot != "" && (filepath.Dir(j.StageRoot) != filepath.Dir(j.Root) || filepath.Base(j.StageRoot) != ".create-"+j.WorkspaceID) {
		return nil, devcontract.Fail(4, "invalid_journal", "create staging intent is not an owned sibling directory")
	}
	seen := map[string]bool{}
	for _, r := range j.Resources {
		if !safeID(r.Repository.ID) || seen[r.Repository.ID] || r.Path != filepath.Join(j.Root, r.Repository.Directory) || !inside(j.Root, r.Path) || r.Marker != "refs/omniview-dev/workspaces/"+j.WorkspaceID+"/"+r.Repository.ID || !filepath.IsAbs(r.CommonDir) {
			return nil, devcontract.Fail(4, "invalid_journal", "invalid owned resource")
		}
		seen[r.Repository.ID] = true
	}
	return &j, nil
}

// StagingVersion 1 reserves these exact names in the durable ownership journal
// before publication. Partial contents do not revoke that reservation; arbitrary
// .write-* files and symlinks are never inferred to belong to the lifecycle.
func ownedStagingPath(path, id string) string {
	return filepath.Join(filepath.Dir(path), "."+filepath.Base(path)+".write-"+id)
}

func removeReservedFile(path string) error {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return devcontract.Fail(4, "foreign_staging", "reserved staging path is not an owned regular file")
	}
	return os.Remove(path)
}

func atomicOwnedJSON(path string, value any, id string) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	parent, err := devcontract.CanonicalPath(filepath.Dir(path))
	if err != nil {
		return err
	}
	if parent != filepath.Dir(path) {
		return devcontract.Fail(4, "foreign_staging", "owned write directory cannot be redirected through a symlink")
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	stage := ownedStagingPath(path, id)
	if err = removeReservedFile(stage); err != nil {
		return err
	}
	f, err := os.OpenFile(stage, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer os.Remove(stage)
	if _, err = f.Write(append(data, '\n')); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(stage, path); err != nil {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}

func syncDirectory(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func recoverOwnedStaging(root string, j *journal) error {
	if j.StagingVersion != 1 {
		return nil
	}
	for _, path := range []string{filepath.Join(root, "workspace.json"), filepath.Join(root, ".local", "ownership.json")} {
		parent, err := devcontract.CanonicalPath(filepath.Dir(path))
		if err != nil {
			return err
		}
		if parent != filepath.Dir(path) {
			return devcontract.Fail(4, "foreign_staging", "owned staging directory cannot be redirected through a symlink")
		}
		if err := removeReservedFile(ownedStagingPath(path, j.WorkspaceID)); err != nil {
			return err
		}
	}
	return nil
}

func retiredRoot(j *journal) string {
	return filepath.Join(filepath.Dir(j.Root), ".retired-"+j.WorkspaceID)
}

func lockRoot(root string) (func(), error) {
	dir := filepath.Join(root, ".omniview-dev")
	canonical, err := devcontract.CanonicalPath(dir)
	if err != nil {
		return nil, err
	}
	if canonical != dir {
		return nil, devcontract.Fail(4, "foreign_registry", "registry directory cannot be a symlink")
	}
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	return tryLock(filepath.Join(dir, "lifecycle.lock"))
}

func tryLock(path string) (func(), error) {
	f := flock.New(path)
	ok, err := f.TryLock()
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, devcontract.Fail(4, "workspace_busy", "workspace or profile is in use by another process")
	}
	return func() { _ = f.Unlock() }, nil
}

func inside(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	return err == nil && rel != "." && rel != ".." && !filepath.IsAbs(rel) && len(rel) > 0 && !(len(rel) > 3 && rel[:3] == ".."+string(filepath.Separator))
}
