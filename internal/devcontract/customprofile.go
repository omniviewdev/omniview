package devcontract

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/gofrs/flock"
	"github.com/google/uuid"
)

// customProfile is machine-local ownership metadata, never portable manifest intent.
// The same record is used for a binding, its container marker, and a global claim.
type customProfile struct {
	SchemaVersion int    `json:"schemaVersion"`
	WorkspaceID   string `json:"workspaceID"`
	StateRoot     string `json:"stateRoot"`
}

type customProfiles struct {
	SchemaVersion int             `json:"schemaVersion"`
	Claims        []customProfile `json:"claims"`
}

func profileConflict(message string) error { return Fail(4, "conflicting_state_root", message) }
func overlaps(a, b string) bool            { return contained(a, b) || contained(b, a) }

func customProfileBase(home string) (string, error) {
	if home == "" {
		var err error
		home, err = os.UserHomeDir()
		if err != nil {
			return "", err
		}
	}
	return CanonicalPath(filepath.Join(home, ".omniview-dev"))
}

// readProfileJSON refuses metadata redirected through symlinks. A missing file is
// distinguished from malformed, foreign, or inaccessible metadata by callers.
func readProfileJSON(path string, value any) error {
	canonical, err := CanonicalPath(path)
	if os.IsNotExist(err) {
		return profileConflict("profile ownership metadata contains a dangling symlink")
	}
	if err != nil {
		return err
	}
	if canonical != path {
		return profileConflict("profile ownership metadata cannot be redirected through symlinks")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return profileConflict("profile ownership metadata must be a regular file")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err = json.Unmarshal(data, value); err != nil {
		return Fail(2, "invalid_profile_binding", "invalid machine-local profile metadata")
	}
	return nil
}

func validateCustomRecord(record customProfile) error {
	id, err := uuid.Parse(record.WorkspaceID)
	if record.SchemaVersion != 1 || err != nil || id == uuid.Nil || id.String() != record.WorkspaceID || !filepath.IsAbs(record.StateRoot) || filepath.Clean(record.StateRoot) != record.StateRoot || filepath.Base(record.StateRoot) != "state" {
		return Fail(2, "invalid_profile_binding", "invalid machine-local profile identity or state path")
	}
	canonical, err := CanonicalPath(record.StateRoot)
	if err != nil {
		return err
	}
	if canonical != record.StateRoot {
		return profileConflict("custom state container cannot be redirected through symlinks")
	}
	container := filepath.Dir(record.StateRoot)
	canonical, err = CanonicalPath(container)
	if err != nil {
		return err
	}
	if canonical != container {
		return profileConflict("custom profile container cannot be redirected through symlinks")
	}
	return nil
}

func loadCustomProfiles(base string, optional bool) (customProfiles, error) {
	var registry customProfiles
	err := readProfileJSON(filepath.Join(base, "custom-profiles.json"), &registry)
	if os.IsNotExist(err) && optional {
		return customProfiles{SchemaVersion: 1}, nil
	}
	if err != nil {
		return registry, err
	}
	if registry.SchemaVersion != 1 {
		return registry, Fail(2, "invalid_profile_binding", "unsupported custom profile claims schema")
	}
	seen := make(map[string]bool, len(registry.Claims))
	for _, claim := range registry.Claims {
		if err := validateCustomRecord(claim); err != nil {
			return registry, err
		}
		if seen[claim.StateRoot] {
			return registry, profileConflict("duplicate custom profile claim")
		}
		seen[claim.StateRoot] = true
	}
	for i, a := range registry.Claims {
		for _, b := range registry.Claims[:i] {
			if overlaps(filepath.Dir(a.StateRoot), filepath.Dir(b.StateRoot)) {
				return registry, profileConflict("custom profile claim containers overlap")
			}
		}
	}
	return registry, nil
}

// customProtectedPaths reads only native-independent path/ownership metadata.
// A grandparent is a collection only with the actual registered layout and a
// valid source registry; ordinary enclosing temporary/user directories are not.
func customProtectedPaths(w ResolvedWorkspace, home string) ([]string, error) {
	paths := []string{w.Root, filepath.Join(home, ".omniview"), filepath.Join(home, ".omniview-nightly"), filepath.Join(home, ".omniview-dev", "profiles")}
	for _, repo := range w.Manifest.Repositories {
		paths = append(paths, filepath.Join(w.Root, repo.Directory))
	}
	collection := filepath.Dir(filepath.Dir(w.Root))
	if filepath.Base(filepath.Dir(w.Root)) == "workspaces" {
		var registry struct {
			SchemaVersion int `json:"schemaVersion"`
			Repositories  []struct {
				ID        string `json:"id"`
				CommonDir string `json:"commonDir"`
				Worktree  string `json:"worktree"`
			} `json:"repositories"`
		}
		err := readProfileJSON(filepath.Join(collection, ".omniview-dev", "repositories.json"), &registry)
		if err != nil && !os.IsNotExist(err) {
			return nil, err
		}
		if err == nil {
			if registry.SchemaVersion != 1 || len(registry.Repositories) == 0 {
				return nil, Fail(2, "invalid_registry", "invalid registered source boundary metadata")
			}
			paths = append(paths, collection)
			for _, source := range registry.Repositories {
				if !safeID(source.ID) || !filepath.IsAbs(source.CommonDir) || (source.Worktree != "" && !filepath.IsAbs(source.Worktree)) {
					return nil, Fail(2, "invalid_registry", "invalid registered source paths")
				}
				paths = append(paths, source.CommonDir)
				if source.Worktree != "" {
					paths = append(paths, source.Worktree)
				}
			}
		}
	}
	var journal struct {
		SchemaVersion int               `json:"schemaVersion"`
		WorkspaceID   string            `json:"workspaceID"`
		Root          string            `json:"root"`
		Phase         string            `json:"phase"`
		RenameTo      string            `json:"renameTo"`
		Manifest      WorkspaceManifest `json:"manifest"`
		Resources     []struct {
			CommonDir string `json:"commonDir"`
		} `json:"resources"`
	}
	err := readProfileJSON(filepath.Join(w.Root, ".local", "ownership.json"), &journal)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil {
		if journal.SchemaVersion != 1 || journal.WorkspaceID != w.Manifest.WorkspaceID {
			return nil, profileConflict("workspace ownership boundary disagrees with selected workspace")
		}
		if journal.Root != w.Root {
			// A rename publishes the directory move before Git repair and
			// journal rewrite. Preserve that exact recoverable sibling intent.
			validRename := journal.Phase == "rename" && journal.RenameTo == w.Root &&
				filepath.IsAbs(journal.Root) && filepath.Clean(journal.Root) == journal.Root &&
				filepath.Dir(journal.Root) == filepath.Dir(w.Root) &&
				journal.Manifest.WorkspaceID == w.Manifest.WorkspaceID &&
				journal.Manifest.Slug == filepath.Base(w.Root)
			if !validRename {
				return nil, profileConflict("workspace ownership boundary disagrees with selected workspace")
			}
			if err := journal.Manifest.Validate(); err != nil {
				return nil, err
			}
			paths = append(paths, journal.Root)
		}
		for _, resource := range journal.Resources {
			if !filepath.IsAbs(resource.CommonDir) {
				return nil, Fail(2, "invalid_journal", "invalid registered source common directory")
			}
			paths = append(paths, resource.CommonDir)
		}
	}
	for i, path := range paths {
		canonical, err := CanonicalPath(path)
		if err != nil {
			return nil, err
		}
		paths[i] = canonical
	}
	return paths, nil
}

func validateCustomBoundary(w ResolvedWorkspace, record customProfile, home string) error {
	if err := validateCustomRecord(record); err != nil {
		return err
	}
	if record.WorkspaceID != w.Manifest.WorkspaceID {
		return profileConflict("custom profile belongs to another workspace")
	}
	paths, err := customProtectedPaths(w, home)
	if err != nil {
		return err
	}
	container := filepath.Dir(record.StateRoot)
	for _, protected := range paths {
		if overlaps(container, protected) {
			return profileConflict("custom profile overlaps protected application or source storage")
		}
	}
	return nil
}

// ReadCustomProfileBinding validates only the machine-local binding and its
// durable claim/owner. Lifecycle cleanup supplies the UUID from its ownership
// receipt, so this reader deliberately does not require a manifest or journal.
// It creates nothing, and a missing binding is reported separately from invalid
// or incomplete ownership. Root must be the canonical workspace/retirement path.
func ReadCustomProfileBinding(root, workspaceID, home string) (string, bool, error) {
	id, err := uuid.Parse(workspaceID)
	if err != nil || id == uuid.Nil || id.String() != workspaceID {
		return "", false, Fail(2, "invalid_identity", "binding reader requires a canonical workspace UUID")
	}
	var binding customProfile
	err = readProfileJSON(filepath.Join(root, ".local", "profile.json"), &binding)
	if os.IsNotExist(err) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	if err = validateCustomRecord(binding); err != nil {
		return "", false, err
	}
	if binding.WorkspaceID != workspaceID {
		return "", false, profileConflict("custom profile belongs to another workspace")
	}
	if err = ValidateCustomProfileClaim(binding.StateRoot, workspaceID, home); err != nil {
		return "", false, err
	}
	return binding.StateRoot, true, nil
}

// ValidateCustomProfileClaim validates the durable reservation and external owner
// for a state root retained in a lifecycle receipt after local binding removal.
// It deliberately reads no workspace files and creates no state or metadata.
func ValidateCustomProfileClaim(stateRoot, workspaceID, home string) error {
	record := customProfile{SchemaVersion: 1, WorkspaceID: workspaceID, StateRoot: stateRoot}
	if err := validateCustomRecord(record); err != nil {
		return err
	}
	base, err := customProfileBase(home)
	if err != nil {
		return err
	}
	registry, err := loadCustomProfiles(base, false)
	if os.IsNotExist(err) {
		return profileConflict("custom profile binding is missing its durable claim registry")
	}
	if err != nil {
		return err
	}
	found := false
	for _, claim := range registry.Claims {
		if claim == record {
			found = true
		}
	}
	if !found {
		return profileConflict("custom profile binding has no matching durable claim")
	}
	var owner customProfile
	err = readProfileJSON(filepath.Join(filepath.Dir(stateRoot), ".omniview-profile.json"), &owner)
	if os.IsNotExist(err) {
		return profileConflict("custom profile binding is missing its owner marker")
	}
	if err != nil {
		return err
	}
	if owner != record {
		return profileConflict("custom profile owner marker disagrees with binding")
	}
	return nil
}

func resolveCustomProfile(w ResolvedWorkspace, home string) (string, bool, error) {
	state, present, err := ReadCustomProfileBinding(w.Root, w.Manifest.WorkspaceID, home)
	if err != nil || !present {
		return "", present, err
	}
	record := customProfile{SchemaVersion: 1, WorkspaceID: w.Manifest.WorkspaceID, StateRoot: state}
	if err = validateCustomBoundary(w, record, home); err != nil {
		return "", false, err
	}
	return state, true, nil
}

func writeProfileJSON(path string, value any) error {
	canonical, err := CanonicalPath(path)
	if err != nil {
		return err
	}
	if canonical != path {
		return profileConflict("profile metadata destination cannot be redirected")
	}
	if info, e := os.Lstat(path); e == nil && !info.Mode().IsRegular() {
		return profileConflict("profile metadata destination must be a regular file")
	} else if e != nil && !os.IsNotExist(e) {
		return e
	}
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".profile-write-")
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
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func lockCustomPath(path string) (func() error, error) {
	canonical, err := CanonicalPath(path)
	if err != nil {
		return nil, err
	}
	if canonical != path {
		return nil, profileConflict("profile lock cannot be redirected through symlinks")
	}
	if info, e := os.Lstat(path); e == nil && !info.Mode().IsRegular() {
		return nil, profileConflict("profile lock must be a regular file")
	} else if e != nil && !os.IsNotExist(e) {
		return nil, e
	}
	lock := flock.New(path)
	ok, err := lock.TryLock()
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, Fail(4, "profile_busy", "profile is in use by another process")
	}
	return lock.Unlock, nil
}

// SetCustomProfile persistently binds a stopped workspace to an owned custom
// container. It never creates state: baseline publication may atomically create
// that directory later. Claims and owner markers survive rebinding, so old state
// cannot silently become another workspace's profile. Retrying the same request
// resumes a durable claim interrupted before marker or binding publication.
func SetCustomProfile(ctx context.Context, w ResolvedWorkspace, path, home string) (ResolvedWorkspace, error) {
	var result ResolvedWorkspace
	if err := ctx.Err(); err != nil {
		return result, err
	}
	if err := w.Manifest.Validate(); err != nil {
		return result, err
	}
	if home == "" {
		var err error
		home, err = os.UserHomeDir()
		if err != nil {
			return result, err
		}
	}
	canonicalHome, err := CanonicalPath(home)
	if err != nil {
		return result, err
	}
	home = canonicalHome
	release, err := LockProfile(ctx, home, w.Manifest.WorkspaceID)
	if err != nil {
		return result, err
	}
	defer release()
	base, err := customProfileBase(home)
	if err != nil {
		return result, err
	}
	releaseGlobal, err := lockCustomPath(filepath.Join(base, "custom-profiles.lock"))
	if err != nil {
		return result, err
	}
	defer releaseGlobal()
	current, err := ResolveWorkspace(ResolveOptions{Explicit: w.ManifestPath, Home: home})
	if err != nil {
		return result, err
	}
	if current.Manifest.WorkspaceID != w.Manifest.WorkspaceID || current.Root != w.Root || current.StateRoot != w.StateRoot {
		return result, profileConflict("workspace profile changed before binding")
	}
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || filepath.Base(path) != "state" {
		return result, Fail(2, "invalid_state_root", "custom state root must be an absolute canonical state child")
	}
	record := customProfile{SchemaVersion: 1, WorkspaceID: w.Manifest.WorkspaceID, StateRoot: path}
	if err = validateCustomBoundary(current, record, home); err != nil {
		return result, err
	}
	registry, err := loadCustomProfiles(base, true)
	if err != nil {
		return result, err
	}
	claimed := false
	container := filepath.Dir(path)
	for _, claim := range registry.Claims {
		if claim == record {
			claimed = true
			continue
		}
		if overlaps(container, filepath.Dir(claim.StateRoot)) {
			return result, profileConflict("custom profile overlaps an existing durable claim")
		}
	}
	var owner customProfile
	ownerPath := filepath.Join(container, ".omniview-profile.json")
	ownerErr := readProfileJSON(ownerPath, &owner)
	if ownerErr != nil && !os.IsNotExist(ownerErr) {
		return result, ownerErr
	}
	if ownerErr == nil && (owner != record || !claimed) {
		return result, profileConflict("custom profile has a foreign or unregistered owner")
	}
	if !claimed {
		entries, e := os.ReadDir(container)
		if e != nil && !os.IsNotExist(e) {
			return result, e
		}
		if len(entries) != 0 {
			return result, profileConflict("new custom profile container must be absent or empty")
		}
	}
	// Hold both current and requested existing root flocks, without creating a
	// missing state root or changing the lock order used by startup/baselines.
	for i, root := range []string{current.StateRoot, path} {
		if i == 1 && root == current.StateRoot {
			continue
		}
		info, e := os.Lstat(root)
		if os.IsNotExist(e) {
			continue
		}
		if e != nil {
			return result, e
		}
		if !info.IsDir() {
			return result, profileConflict("profile state must be a real directory")
		}
		unlock, e := lockCustomPath(filepath.Join(root, ".lock"))
		if e != nil {
			return result, e
		}
		defer unlock()
	}
	if err = ctx.Err(); err != nil {
		return result, err
	}
	if !claimed {
		registry.Claims = append(registry.Claims, record)
		if err = writeProfileJSON(filepath.Join(base, "custom-profiles.json"), registry); err != nil {
			return result, err
		}
	}
	if err = os.MkdirAll(container, 0700); err != nil {
		return result, err
	}
	if ownerErr != nil {
		if err = writeProfileJSON(ownerPath, record); err != nil {
			return result, err
		}
	}
	if err = writeProfileJSON(filepath.Join(current.Root, ".local", "profile.json"), record); err != nil {
		return result, err
	}
	return ResolveWorkspace(ResolveOptions{Explicit: current.ManifestPath, Home: home, StateRoot: path})
}
