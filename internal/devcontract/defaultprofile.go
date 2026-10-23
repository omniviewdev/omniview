package devcontract

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/google/uuid"
)

type defaultProfileOwner struct {
	SchemaVersion int    `json:"schemaVersion"`
	WorkspaceID   string `json:"workspaceID"`
}

func defaultProfileBoundary(home, workspaceID string) (string, error) {
	id, err := uuid.Parse(workspaceID)
	if err != nil || id == uuid.Nil || id.String() != workspaceID {
		return "", Fail(2, "invalid_identity", "default profile requires a canonical nonzero workspace UUID")
	}
	if home == "" {
		home, err = os.UserHomeDir()
		if err != nil {
			return "", err
		}
	}
	profiles, err := CanonicalPath(filepath.Join(home, ".omniview-dev", "profiles"))
	if err != nil {
		return "", err
	}
	boundary := filepath.Join(profiles, workspaceID)
	canonical, err := CanonicalPath(boundary)
	if err != nil {
		return "", err
	}
	if canonical != boundary {
		return "", Fail(4, "foreign_profile", "default profile boundary cannot be redirected through a symlink")
	}
	return boundary, nil
}

// ValidateDefaultProfileOwnership reads the existing shared owner marker only.
// An absent profile/marker returns an os.IsNotExist-compatible error; callers
// deciding whether to purge may explicitly skip an absent profile. Writers must
// not treat absence as ownership or create children before Ensure succeeds.
func ValidateDefaultProfileOwnership(home, workspaceID string) error {
	profile, err := defaultProfileBoundary(home, workspaceID)
	if err != nil {
		return err
	}
	info, err := os.Lstat(profile)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return Fail(4, "foreign_profile", "default profile must be a real directory")
	}
	marker := filepath.Join(profile, ".workspace-owner.json")
	info, err = os.Lstat(marker)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return Fail(4, "foreign_profile", "default profile ownership marker must be a regular file without symlink redirection")
	}
	data, err := os.ReadFile(marker)
	if err != nil {
		return err
	}
	var owner defaultProfileOwner
	if err = json.Unmarshal(data, &owner); err != nil || owner.SchemaVersion != 1 || owner.WorkspaceID != workspaceID {
		return Fail(4, "foreign_profile", "default profile ownership marker does not match this workspace")
	}
	return nil
}

// EnsureDefaultProfileOwnership establishes the existing schema-1
// .workspace-owner.json contract. Caller MUST hold LockProfile's stable UUID
// guard; this helper deliberately acquires no nested flock. Only an absent or
// empty canonical default profile, or its matching existing marker, is accepted.
// State/runtime/webview children are never created here.
func EnsureDefaultProfileOwnership(home, workspaceID string) error {
	profile, err := defaultProfileBoundary(home, workspaceID)
	if err != nil {
		return err
	}
	if err = ValidateDefaultProfileOwnership(home, workspaceID); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	entries, err := os.ReadDir(profile)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if len(entries) != 0 {
		return Fail(4, "foreign_profile", "nonempty unmarked default profile cannot be claimed")
	}
	if err = os.MkdirAll(profile, 0700); err != nil {
		return err
	}
	canonical, err := CanonicalPath(profile)
	if err != nil {
		return err
	}
	if canonical != profile {
		return Fail(4, "foreign_profile", "default profile changed before ownership publication")
	}
	if err = os.Chmod(profile, 0700); err != nil {
		return err
	}
	encoded, err := json.Marshal(defaultProfileOwner{SchemaVersion: 1, WorkspaceID: workspaceID})
	if err != nil {
		return err
	}
	// Stage outside the UUID boundary: a crash before publication leaves that
	// profile empty/retryable, not nonempty-unmarked. Never adopt arbitrary old
	// staging files. Platform publication is exclusive and durable: Unix uses
	// link plus directory fsync; Windows uses a write-through nonreplacing move.
	file, err := os.CreateTemp(filepath.Dir(profile), ".workspace-owner-"+workspaceID+"-*")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if _, err = file.Write(append(encoded, '\n')); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = publishDefaultProfileOwner(name, filepath.Join(profile, ".workspace-owner.json")); err != nil {
		if os.IsExist(err) {
			return ValidateDefaultProfileOwnership(home, workspaceID)
		}
		return err
	}
	return ValidateDefaultProfileOwnership(home, workspaceID)
}
