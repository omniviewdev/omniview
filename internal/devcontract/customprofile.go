package devcontract

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/gofrs/flock"
	"github.com/google/uuid"
	"github.com/omniviewdev/plugin-sdk/pkg/profilecontract"
)

func profileConflict(message string) error { return Fail(4, "conflicting_state_root", message) }
func overlaps(a, b string) bool            { return contained(a, b) || contained(b, a) }

// ProfilePathsOverlap compares canonical profile paths lexically and by existing
// directory identity. Endpoint-versus-ancestor checks in both directions detect
// filesystem case aliases without conflating distinct case-sensitive siblings.
// Missing endpoints are allowed; other filesystem errors fail closed. It reads
// only the endpoints and their ancestors, never directory descendants.
func ProfilePathsOverlap(a, b string) (bool, error) {
	if overlaps(a, b) {
		return true, nil
	}
	aInfo, err := os.Stat(a)
	if err != nil && !os.IsNotExist(err) {
		return false, err
	}
	bInfo, err := os.Stat(b)
	if err != nil && !os.IsNotExist(err) {
		return false, err
	}
	if aInfo != nil && bInfo != nil && os.SameFile(aInfo, bInfo) {
		return true, nil
	}
	if aInfo != nil {
		match, err := profileHasAncestor(b, aInfo)
		if match || err != nil {
			return match, err
		}
	}
	if bInfo != nil {
		return profileHasAncestor(a, bInfo)
	}
	return false, nil
}

func profileHasAncestor(path string, ancestor os.FileInfo) (bool, error) {
	for parent := filepath.Dir(path); ; parent = filepath.Dir(parent) {
		info, err := os.Stat(parent)
		if err != nil && !os.IsNotExist(err) {
			return false, err
		}
		if info != nil && os.SameFile(info, ancestor) {
			return true, nil
		}
		if filepath.Dir(parent) == parent {
			return false, nil
		}
	}
}

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

// profileReadError preserves host exit/error classes without exposing JSON data.
func profileReadError(err error) error {
	var protocolError *profilecontract.Error
	if errors.As(err, &protocolError) {
		code := 2
		if protocolError.Code == "conflicting_state_root" {
			code = 4
		}
		return Fail(code, protocolError.Code, protocolError.Message)
	}
	return err
}

func readProfileJSON(path string, value any) error {
	return profileReadError(profilecontract.ReadJSON(path, value))
}

func validateCustomRecord(record profilecontract.Record) error {
	return profileReadError(profilecontract.ValidateRecord(record))
}

func loadCustomProfiles(base string, optional bool) (profilecontract.Claims, error) {
	var registry profilecontract.Claims
	err := readProfileJSON(filepath.Join(base, "custom-profiles.json"), &registry)
	if os.IsNotExist(err) && optional {
		return profilecontract.Claims{SchemaVersion: 1}, nil
	}
	if err != nil {
		return registry, err
	}
	if err := profilecontract.ValidateClaims(registry); err != nil {
		return registry, profileReadError(err)
	}
	for i, a := range registry.Claims {
		for _, b := range registry.Claims[:i] {
			overlap, err := ProfilePathsOverlap(filepath.Dir(a.StateRoot), filepath.Dir(b.StateRoot))
			if err != nil {
				return registry, err
			}
			if overlap {
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
	var journal profilecontract.OwnershipJournal[WorkspaceManifest]
	err := readProfileJSON(filepath.Join(w.Root, ".local", "ownership.json"), &journal)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil {
		intent := profilecontract.ManifestIdentity{
			SchemaVersion: journal.Manifest.SchemaVersion,
			WorkspaceID:   journal.Manifest.WorkspaceID,
			Slug:          journal.Manifest.Slug,
		}
		intent.Profile.Kind = journal.Manifest.Profile.Kind
		oldRoot, err := journal.ValidateBoundary(w.Root, w.Manifest.WorkspaceID, intent)
		if err != nil {
			return nil, profileReadError(err)
		}
		if oldRoot != "" {
			if err := journal.Manifest.Validate(); err != nil {
				return nil, err
			}
			paths = append(paths, oldRoot)
		}
		for _, resource := range journal.Resources {
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

func validateCustomBoundary(w ResolvedWorkspace, record profilecontract.Record, home string) error {
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
		overlap, err := ProfilePathsOverlap(container, protected)
		if err != nil {
			return err
		}
		if overlap {
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
	var binding profilecontract.Record
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
	record := profilecontract.Record{SchemaVersion: 1, WorkspaceID: workspaceID, StateRoot: stateRoot}
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
	return validateCustomProfileOwner(record)
}

func validateCustomProfileOwner(record profilecontract.Record) error {
	err := validateExistingCustomProfileOwner(record)
	if os.IsNotExist(err) {
		return profileConflict("custom profile binding is missing its owner marker")
	}
	return err
}

// validateExistingCustomProfileOwner preserves missing-path errors so production
// can tolerate an incomplete disjoint reservation without weakening dev ownership.
func validateExistingCustomProfileOwner(record profilecontract.Record) error {
	var owner profilecontract.Record
	err := readProfileJSON(filepath.Join(filepath.Dir(record.StateRoot), ".omniview-profile.json"), &owner)
	if err != nil {
		return err
	}
	if owner != record {
		return profileConflict("custom profile owner marker disagrees with binding")
	}
	return nil
}

// ValidateProductionProfileIsolation rejects production state overlapping any
// durable custom development container, including reservations retained after
// rebinding. Claims remain authoritative without owner markers. Existing owner
// evidence must be valid even when disjoint; an absent disjoint marker is allowed.
// stateRoot must be canonical. This reads metadata only: it creates no locks or
// files, repairs nothing, and never scans directory descendants.
func ValidateProductionProfileIsolation(stateRoot, home string) error {
	canonical, err := CanonicalPath(stateRoot)
	if err != nil {
		return err
	}
	if canonical != stateRoot {
		return profileConflict("production state root must be canonical")
	}
	base, err := customProfileBase(home)
	if err != nil {
		return err
	}
	registry, err := loadCustomProfiles(base, true)
	if err != nil {
		return err
	}
	for _, claim := range registry.Claims {
		overlap, err := ProfilePathsOverlap(stateRoot, filepath.Dir(claim.StateRoot))
		if err != nil {
			return err
		}
		if overlap {
			return profileConflict("production state overlaps a custom development profile")
		}
		if err := validateExistingCustomProfileOwner(claim); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	// A missing registry or removed claim does not erase an external marker.
	// Check only the selected root and its ancestors; unrelated directories
	// are not searched, and any malformed or redirected evidence fails closed.
	for container := stateRoot; ; container = filepath.Dir(container) {
		var owner profilecontract.Record
		err := readProfileJSON(filepath.Join(container, ".omniview-profile.json"), &owner)
		if err == nil {
			return profileConflict("production state overlaps a marked development profile")
		}
		if !os.IsNotExist(err) {
			return err
		}
		if filepath.Dir(container) == container {
			break
		}
	}
	return nil
}

func resolveCustomProfile(w ResolvedWorkspace, home string) (string, bool, error) {
	state, present, err := ReadCustomProfileBinding(w.Root, w.Manifest.WorkspaceID, home)
	if err != nil || !present {
		return "", present, err
	}
	record := profilecontract.Record{SchemaVersion: 1, WorkspaceID: w.Manifest.WorkspaceID, StateRoot: state}
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
	return publishCustomProfileJSON(f.Name(), path)
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
	record := profilecontract.Record{SchemaVersion: 1, WorkspaceID: w.Manifest.WorkspaceID, StateRoot: path}
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
		overlap, err := ProfilePathsOverlap(container, filepath.Dir(claim.StateRoot))
		if err != nil {
			return result, err
		}
		if overlap {
			return result, profileConflict("custom profile overlaps an existing durable claim")
		}
	}
	var owner profilecontract.Record
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
