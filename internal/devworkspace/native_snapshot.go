package devworkspace

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"sort"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

type nativeSnapshotEntry struct {
	Kind   string `json:"kind"`
	SHA256 string `json:"sha256,omitempty"`
	Mode   uint32 `json:"mode"`
}
type nativeSnapshotReceipt struct {
	SchemaVersion int                            `json:"schemaVersion"`
	WorkspaceID   string                         `json:"workspaceID"`
	Root          string                         `json:"root"`
	StateRoot     string                         `json:"stateRoot"`
	Entries       map[string]nativeSnapshotEntry `json:"entries"`
	Cleanup       *generatedCleanup              `json:"cleanup,omitempty"`
}

func nativeSnapshotPaths(w Workspace) (string, string, error) {
	collection, err := generatedCollection(w)
	if err != nil {
		return "", "", err
	}
	vault := filepath.Join(collection, ".omniview-dev", "native-removal", w.Manifest.WorkspaceID)
	canonical, err := devcontract.CanonicalPath(vault)
	if err != nil {
		return "", "", err
	}
	if canonical != vault {
		return "", "", devcontract.Fail(4, "native_profile_conflict", "native removal snapshot path is redirected")
	}
	return vault, filepath.Join(vault, "Omniview.dev.app"), nil
}
func scanNativeSnapshot(root string) (map[string]nativeSnapshotEntry, error) {
	entries := map[string]nativeSnapshotEntry{}
	err := filepath.WalkDir(root, func(path string, item os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		entry := nativeSnapshotEntry{Mode: uint32(info.Mode().Perm())}
		if info.IsDir() {
			entry.Kind = "directory"
		} else if info.Mode().IsRegular() {
			entry.Kind = "file"
			file, err := os.Open(path)
			if err != nil {
				return err
			}
			hash := sha256.New()
			_, err = io.Copy(hash, file)
			opened, statErr := file.Stat()
			file.Close()
			if err != nil {
				return err
			}
			if statErr != nil {
				return statErr
			}
			current, err := os.Lstat(path)
			if err != nil {
				return err
			}
			if !os.SameFile(info, opened) || !os.SameFile(opened, current) || opened.Size() != current.Size() || opened.ModTime() != current.ModTime() {
				return devcontract.Fail(4, "native_profile_conflict", "native bundle changed during verification")
			}
			entry.SHA256 = hex.EncodeToString(hash.Sum(nil))
		} else {
			return devcontract.Fail(4, "native_profile_conflict", "native bundle contains nonregular resources")
		}
		entries[relative] = entry
		return nil
	})
	return entries, err
}
func sameNativeSnapshot(a, b map[string]nativeSnapshotEntry) bool {
	if len(a) != len(b) {
		return false
	}
	for path, entry := range a {
		if b[path] != entry {
			return false
		}
	}
	return true
}
func readNativeSnapshot(w Workspace) (string, *nativeSnapshotReceipt, error) {
	bundle, receipt, err := loadNativeSnapshotReceipt(w)
	if err != nil {
		return "", nil, err
	}
	if receipt.Cleanup != nil {
		return "", nil, devcontract.Fail(4, "native_profile_conflict", "committed native snapshot cleanup must resume")
	}
	actual, err := scanNativeSnapshot(bundle)
	if err != nil {
		return "", nil, err
	}
	if !sameNativeSnapshot(actual, receipt.Entries) {
		return "", nil, devcontract.Fail(4, "native_profile_conflict", "native bundle snapshot changed")
	}
	if err = verifyNativeBundleIdentity(bundle, w); err != nil {
		return "", nil, err
	}
	return bundle, receipt, nil
}
func prepareNativeSnapshot(w Workspace) (string, error) {
	if bundle, _, err := readNativeSnapshot(w); err == nil {
		return filepath.Join(bundle, "Contents", "MacOS", "Omniview"), nil
	} else if !os.IsNotExist(err) {
		return "", err
	}
	var use nativeProfileUse
	if err := readLaunchJSON(launchPath(w, "native-profile.json"), &use); os.IsNotExist(err) {
		return "", nil
	} else if err != nil {
		return "", err
	}
	expectedBinary := filepath.Join("bin", "native", "Omniview.dev.app", "Contents", "MacOS", "Omniview")
	if use.WorkspaceID != w.Manifest.WorkspaceID || use.Generation == "" || use.Binary != expectedBinary {
		return "", devcontract.Fail(4, "native_profile_conflict", "native use receipt does not select the owned original bundle")
	}
	relative := filepath.Join("bin", "native", "Omniview.dev.app")
	source := launchPath(w, relative)
	ledger, unlock, _, err := lockGenerated(w)
	if err != nil {
		return "", err
	}
	owned := selectedGenerated(ledger.Entries, relative)
	actual, err := scanGenerated(w, relative)
	if err == nil && !sameGenerated(actual, owned) {
		err = devcontract.Fail(4, "native_profile_conflict", "native bundle is not unchanged owned build output")
	}
	unlock()
	if err != nil {
		return "", err
	}
	expected, err := scanNativeSnapshot(source)
	if err != nil {
		return "", err
	}
	if err = verifyNativeBundleIdentity(source, w); err != nil {
		return "", err
	}
	vault, bundle, err := nativeSnapshotPaths(w)
	if err != nil {
		return "", err
	}
	if err = privateGeneratedDirectory(vault); err != nil {
		return "", err
	}
	existing, err := os.ReadDir(vault)
	if err != nil {
		return "", err
	}
	if len(existing) != 0 {
		return "", devcontract.Fail(4, "native_profile_conflict", "native removal snapshot has incomplete or foreign resources")
	}
	stage, err := os.MkdirTemp(vault, ".bundle-stage-")
	if err != nil {
		return "", err
	}
	// Copy exactly the ledger-proven original bundle, not a naked executable or
	// newly named wrapper: WebKit storage namespace includes CFBundleIdentifier.
	paths := make([]string, 0, len(expected))
	for path := range expected {
		paths = append(paths, path)
	}
	sort.Slice(paths, func(i, j int) bool {
		if len(paths[i]) == len(paths[j]) {
			return paths[i] < paths[j]
		}
		return len(paths[i]) < len(paths[j])
	})
	for _, relative := range paths {
		entry := expected[relative]
		destination := filepath.Join(stage, relative)
		origin := filepath.Join(source, relative)
		if entry.Kind == "directory" {
			if relative != "." {
				err = os.Mkdir(destination, 0700)
			}
			if err != nil {
				return "", err
			}
			continue
		}
		input, err := os.Open(origin)
		if err != nil {
			return "", err
		}
		output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			input.Close()
			return "", err
		}
		hash := sha256.New()
		_, copyErr := io.Copy(io.MultiWriter(output, hash), input)
		input.Close()
		if copyErr == nil {
			copyErr = output.Chmod(os.FileMode(entry.Mode))
		}
		if copyErr == nil {
			copyErr = output.Sync()
		}
		closeErr := output.Close()
		if copyErr != nil {
			return "", copyErr
		}
		if closeErr != nil {
			return "", closeErr
		}
		if hex.EncodeToString(hash.Sum(nil)) != entry.SHA256 {
			return "", devcontract.Fail(4, "native_profile_conflict", "native bundle bytes changed while snapshotting")
		}
	}
	for i := len(paths) - 1; i >= 0; i-- {
		relative := paths[i]
		entry := expected[relative]
		if entry.Kind == "directory" {
			if err = os.Chmod(filepath.Join(stage, relative), os.FileMode(entry.Mode)); err != nil {
				return "", err
			}
		}
	}
	staged, err := scanNativeSnapshot(stage)
	if err != nil {
		return "", err
	}
	if !sameNativeSnapshot(staged, expected) {
		return "", devcontract.Fail(4, "native_profile_conflict", "native snapshot does not preserve original bundle")
	}
	current, err := scanGenerated(w, relative)
	if err != nil {
		return "", err
	}
	if !sameGenerated(current, owned) {
		return "", devcontract.Fail(4, "native_profile_conflict", "native source bundle changed before snapshot publication")
	}
	if err = os.Rename(stage, bundle); err != nil {
		return "", err
	}
	receipt := nativeSnapshotReceipt{SchemaVersion: 1, WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, StateRoot: w.StateRoot, Entries: expected}
	if err = rawSaveLaunchJSON(filepath.Join(vault, "receipt.json"), receipt); err != nil {
		return "", err
	}
	return filepath.Join(bundle, "Contents", "MacOS", "Omniview"), nil
}
