package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"sort"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

type generatedCleanup struct {
	Plan      []string        `json:"plan"`
	Deleting  string          `json:"deleting,omitempty"`
	Completed map[string]bool `json:"completed"`
}

func generatedWritable(ledger generatedLedger) error {
	if ledger.Cleanup != nil {
		return devcontract.Fail(4, "generated_cleanup_pending", "owned generated cleanup must resume before building or launching")
	}
	return nil
}
func cleanupExpected(w Workspace, ledger generatedLedger) (map[string]generatedEntry, error) {
	expected := make(map[string]generatedEntry, len(ledger.Entries))
	for path, entry := range ledger.Entries {
		expected[path] = entry
	}
	if ledger.Cleanup == nil {
		return expected, nil
	}
	cleanup := ledger.Cleanup
	seen := map[string]bool{}
	if cleanup.Completed == nil {
		return nil, devcontract.Fail(4, "generated_conflict", "cleanup completion inventory is missing")
	}
	for _, path := range cleanup.Plan {
		if _, ok := ledger.Entries[path]; !ok || seen[path] {
			return nil, devcontract.Fail(4, "generated_conflict", "cleanup receipt contains an unrecorded/duplicate path")
		}
		seen[path] = true
	}
	if len(seen) != len(ledger.Entries) {
		return nil, devcontract.Fail(4, "generated_conflict", "cleanup receipt differs from owned output inventory")
	}
	if cleanup.Deleting != "" && !seen[cleanup.Deleting] {
		return nil, devcontract.Fail(4, "generated_conflict", "cleanup deletion intent is invalid")
	}
	for path, completed := range cleanup.Completed {
		if !completed || !seen[path] {
			return nil, devcontract.Fail(4, "generated_conflict", "cleanup completion receipt is invalid")
		}
		actual, err := generatedPath(w, path)
		if err != nil {
			return nil, err
		}
		if _, err = os.Lstat(actual); !os.IsNotExist(err) {
			return nil, devcontract.Fail(4, "generated_conflict", "previously removed generated path was recreated")
		}
		delete(expected, path)
	}
	if cleanup.Deleting != "" {
		actual, err := generatedPath(w, cleanup.Deleting)
		if err != nil {
			return nil, err
		}
		if _, err = os.Lstat(actual); os.IsNotExist(err) {
			delete(expected, cleanup.Deleting)
		} else if err != nil {
			return nil, err
		}
	}
	return expected, nil
}
func validateGeneratedLocked(w Workspace, ledger generatedLedger) error {
	if len(ledger.Pending) > 0 {
		return devcontract.Fail(4, "generated_pending", "interrupted generated build outputs require explicit ownership recovery")
	}
	expected, err := cleanupExpected(w, ledger)
	if err != nil {
		return err
	}
	for relative, entry := range expected {
		actual, err := generatedPath(w, relative)
		if err != nil {
			return err
		}
		if err = checkGeneratedEntry(actual, entry); err != nil {
			return err
		}
	}
	entries, err := os.ReadDir(filepath.Join(w.Root, ".local"))
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Name() == "ownership.json" || entry.Name() == "profile.json" {
			continue
		}
		if _, ok := expected[entry.Name()]; !ok {
			return devcontract.Fail(4, "generated_conflict", "local metadata contains an unrecorded resource: "+entry.Name())
		}
	}
	for relative, entry := range expected {
		if entry.Kind != "directory" {
			continue
		}
		parent := filepath.Dir(relative)
		if parent != "." {
			if ancestor, ok := expected[parent]; ok && ancestor.Kind == "directory" {
				continue
			}
		}
		actual, err := scanGenerated(w, relative)
		if err != nil {
			return err
		}
		if !sameGenerated(actual, selectedGenerated(expected, relative)) {
			return devcontract.Fail(4, "generated_conflict", "generated tree contains changed/unrecorded nested resources")
		}
	}
	return nil
}

// ValidateGenerated is the no-mutation ownership preflight used inside A03's
// guarded removal transaction before any irreversible native storage deletion.
func ValidateGenerated(_ context.Context, w Workspace) error {
	ledger, unlock, _, err := lockGenerated(w)
	if err != nil {
		return err
	}
	defer unlock()
	return validateGeneratedLocked(w, ledger)
}
func cleanGenerated(w Workspace) error {
	ledger, unlock, path, err := lockGenerated(w)
	if err != nil {
		return err
	}
	defer unlock()
	if err = validateGeneratedLocked(w, ledger); err != nil {
		return err
	}
	if ledger.Cleanup == nil {
		plan := make([]string, 0, len(ledger.Entries))
		for relative := range ledger.Entries {
			plan = append(plan, relative)
		}
		sort.Slice(plan, func(i, j int) bool {
			if len(plan[i]) == len(plan[j]) {
				return plan[i] < plan[j]
			}
			return len(plan[i]) > len(plan[j])
		})
		ledger.Cleanup = &generatedCleanup{Plan: plan, Completed: map[string]bool{}}
		if err = rawSaveLaunchJSON(path, ledger); err != nil {
			return err
		}
	}
	for _, relative := range ledger.Cleanup.Plan {
		if ledger.Cleanup.Completed[relative] {
			continue
		}
		actual, err := generatedPath(w, relative)
		if err != nil {
			return err
		}
		if _, err = os.Lstat(actual); os.IsNotExist(err) {
			if ledger.Cleanup.Deleting != relative {
				return devcontract.Fail(4, "generated_conflict", "generated path disappeared without recorded deletion intent")
			}
		} else {
			if err != nil {
				return err
			}
			if err = checkGeneratedEntry(actual, ledger.Entries[relative]); err != nil {
				return err
			}
			ledger.Cleanup.Deleting = relative
			if err = rawSaveLaunchJSON(path, ledger); err != nil {
				return err
			}
			if err = os.Remove(actual); err != nil {
				return err
			}
		}
		ledger.Cleanup.Completed[relative] = true
		ledger.Cleanup.Deleting = ""
		if err = rawSaveLaunchJSON(path, ledger); err != nil {
			return err
		}
	}
	if err = os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
