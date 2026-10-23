package devworkspace

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func loadNativeSnapshotReceipt(w Workspace) (string, *nativeSnapshotReceipt, error) {
	vault, bundle, err := nativeSnapshotPaths(w)
	if err != nil {
		return "", nil, err
	}
	var receipt nativeSnapshotReceipt
	if err = readLaunchJSON(filepath.Join(vault, "receipt.json"), &receipt); err != nil {
		return "", nil, err
	}
	collection, err := generatedCollection(w)
	if err != nil {
		return "", nil, err
	}
	// Root/stateRoot are build provenance, not native storage namespace keys.
	// A03's current guarded manifest/profile authorizes the UUID-scoped callback.
	if receipt.SchemaVersion != 1 || receipt.WorkspaceID != w.Manifest.WorkspaceID || !filepath.IsAbs(receipt.Root) || filepath.Clean(receipt.Root) != receipt.Root || filepath.Dir(receipt.Root) != filepath.Join(collection, "workspaces") || len(receipt.Entries) == 0 {
		return "", nil, devcontract.Fail(4, "native_profile_conflict", "native bundle snapshot receipt differs from guarded workspace collection/UUID")
	}
	for path, entry := range receipt.Entries {
		if filepath.IsAbs(path) || filepath.Clean(path) != path || path == ".." || strings.HasPrefix(path, ".."+string(filepath.Separator)) || (entry.Kind != "file" && entry.Kind != "directory") {
			return "", nil, devcontract.Fail(4, "native_profile_conflict", "native snapshot inventory contains an invalid resource")
		}
	}
	return bundle, &receipt, nil
}

// Runs only after A03 committed removal. Each delete has durable intent: a
// missing path is accepted only when this receipt proves our interrupted delete.
func cleanupNativeSnapshot(w Workspace) error {
	bundle, receipt, err := loadNativeSnapshotReceipt(w)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	vault, _, _ := nativeSnapshotPaths(w)
	receiptPath := filepath.Join(vault, "receipt.json")
	children, err := os.ReadDir(vault)
	if err != nil {
		return err
	}
	for _, child := range children {
		if child.Name() != "Omniview.dev.app" && child.Name() != "receipt.json" {
			return devcontract.Fail(4, "native_profile_conflict", "native snapshot vault contains foreign resources")
		}
	}
	expected := make(map[string]nativeSnapshotEntry, len(receipt.Entries))
	for path, entry := range receipt.Entries {
		expected[path] = entry
	}
	if receipt.Cleanup != nil {
		cleanup := receipt.Cleanup
		if cleanup.Completed == nil {
			return devcontract.Fail(4, "native_profile_conflict", "native cleanup completion inventory is missing")
		}
		seen := map[string]bool{}
		for _, path := range cleanup.Plan {
			if _, ok := receipt.Entries[path]; !ok || seen[path] {
				return devcontract.Fail(4, "native_profile_conflict", "native cleanup plan changed")
			}
			seen[path] = true
		}
		if len(seen) != len(receipt.Entries) || (cleanup.Deleting != "" && !seen[cleanup.Deleting]) {
			return devcontract.Fail(4, "native_profile_conflict", "native cleanup plan differs from its snapshot")
		}
		for path, completed := range cleanup.Completed {
			if !completed || !seen[path] {
				return devcontract.Fail(4, "native_profile_conflict", "native cleanup completion is invalid")
			}
			if _, err = os.Lstat(filepath.Join(bundle, path)); !os.IsNotExist(err) {
				return devcontract.Fail(4, "native_profile_conflict", "removed native snapshot path was recreated")
			}
			delete(expected, path)
		}
		if cleanup.Deleting != "" {
			if _, err = os.Lstat(filepath.Join(bundle, cleanup.Deleting)); os.IsNotExist(err) {
				delete(expected, cleanup.Deleting)
			} else if err != nil {
				return err
			}
		}
	}
	actual, err := scanNativeSnapshot(bundle)
	if os.IsNotExist(err) && len(expected) == 0 {
		actual = map[string]nativeSnapshotEntry{}
		err = nil
	}
	if err != nil {
		return err
	}
	if !sameNativeSnapshot(actual, expected) {
		return devcontract.Fail(4, "native_profile_conflict", "native snapshot bytes changed before cleanup")
	}
	if receipt.Cleanup == nil {
		plan := make([]string, 0, len(receipt.Entries))
		for path := range receipt.Entries {
			plan = append(plan, path)
		}
		sort.Slice(plan, func(i, j int) bool {
			if plan[i] == "." {
				return false
			}
			if plan[j] == "." {
				return true
			}
			if len(plan[i]) == len(plan[j]) {
				return plan[i] > plan[j]
			}
			return len(plan[i]) > len(plan[j])
		})
		receipt.Cleanup = &generatedCleanup{Plan: plan, Completed: map[string]bool{}}
		if err = rawSaveLaunchJSON(receiptPath, receipt); err != nil {
			return err
		}
	}
	for _, relative := range receipt.Cleanup.Plan {
		if receipt.Cleanup.Completed[relative] {
			continue
		}
		path := filepath.Join(bundle, relative)
		if _, err = os.Lstat(path); os.IsNotExist(err) {
			if receipt.Cleanup.Deleting != relative {
				return devcontract.Fail(4, "native_profile_conflict", "native snapshot path vanished without deletion intent")
			}
		} else {
			if err != nil {
				return err
			}
			receipt.Cleanup.Deleting = relative
			if err = rawSaveLaunchJSON(receiptPath, receipt); err != nil {
				return err
			}
			if err = os.Remove(path); err != nil {
				return err
			}
		}
		receipt.Cleanup.Completed[relative] = true
		receipt.Cleanup.Deleting = ""
		if err = rawSaveLaunchJSON(receiptPath, receipt); err != nil {
			return err
		}
	}
	if err = os.Remove(receiptPath); err != nil {
		return err
	}
	return os.Remove(vault)
}
