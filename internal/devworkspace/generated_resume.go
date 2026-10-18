package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func remapGenerated(entries map[string]generatedEntry, from, to string) map[string]generatedEntry {
	result := make(map[string]generatedEntry, len(entries))
	for relative, entry := range entries {
		result[to+strings.TrimPrefix(relative, from)] = entry
	}
	return result
}

// ResumeGeneratedPublication only resumes bytes already attested by the
// completed producer capability. A process killed during compilation has no
// finalized output proof; it remains a precise ownership conflict, never an
// excuse to adopt/delete unknown files or PID-kill a surviving compiler.
func ResumeGeneratedPublication(w Workspace) error {
	ledger, unlock, path, err := lockGenerated(w)
	if err != nil {
		return err
	}
	defer unlock()
	if err = generatedWritable(ledger); err != nil {
		return err
	}
	for relative, pending := range ledger.Pending {
		if pending.Phase != "publishing" || pending.After == nil {
			return devcontract.Fail(4, "generated_pending", "interrupted compiler output is not attested; inspect the recorded staging path and surviving owned processes before recovery")
		}
		final, err := scanGenerated(w, relative)
		if err != nil {
			return err
		}
		stage, err := scanGenerated(w, pending.Stage)
		if err != nil {
			return err
		}
		backupRelative := ".generated-old-" + pending.Nonce
		backup, err := scanGenerated(w, backupRelative)
		if err != nil {
			return err
		}
		expectedStage := remapGenerated(pending.After, relative, pending.Stage)
		expectedBackup := remapGenerated(pending.Before, relative, backupRelative)
		if len(stage) > 0 && !sameGenerated(stage, expectedStage) {
			return devcontract.Fail(4, "generated_conflict", "pending publication staging bytes changed")
		}
		if len(backup) > 0 && !sameGenerated(backup, expectedBackup) {
			return devcontract.Fail(4, "generated_conflict", "pending publication backup bytes changed")
		}
		destination, _ := generatedPath(w, relative)
		stagePath, _ := generatedPath(w, pending.Stage)
		backupPath, _ := generatedPath(w, backupRelative)
		if pending.StageIdentity == nil {
			return devcontract.Fail(4, "generated_conflict", "pending publication lost its staging identity")
		}
		if len(stage) > 0 {
			if err = validatePublishedDirectory(stagePath, pending.StageIdentity); err != nil {
				return err
			}
		}
		if sameGenerated(final, pending.After) {
			if err = validatePublishedDirectory(destination, pending.StageIdentity); err != nil {
				return err
			}
		}
		if !sameGenerated(final, pending.After) {
			if len(stage) == 0 {
				return devcontract.Fail(4, "generated_conflict", "pending publication has no intact new output")
			}
			if len(final) > 0 {
				if !sameGenerated(final, pending.Before) || len(backup) > 0 {
					return devcontract.Fail(4, "generated_conflict", "pending publication destination changed")
				}
				if err = os.Rename(destination, backupPath); err != nil {
					return err
				}
				backup = expectedBackup
			}
			parents := []string{}
			for parent := filepath.Dir(relative); parent != "."; parent = filepath.Dir(parent) {
				parents = append(parents, parent)
			}
			for i := len(parents) - 1; i >= 0; i-- {
				parent := parents[i]
				parentPath, _ := generatedPath(w, parent)
				entry, statErr := inspectGenerated(parentPath)
				if os.IsNotExist(statErr) {
					if err = os.Mkdir(parentPath, 0700); err != nil {
						return err
					}
					ledger.Entries[parent] = generatedEntry{Kind: "directory"}
					if err = rawSaveLaunchJSON(path, ledger); err != nil {
						return err
					}
				} else if statErr != nil {
					return statErr
				} else if entry != ledger.Entries[parent] {
					return devcontract.Fail(4, "generated_conflict", "pending publication parent ownership changed")
				}
			}
			if err = os.Rename(stagePath, destination); err != nil {
				return err
			}
		} else if len(stage) > 0 {
			return devcontract.Fail(4, "generated_conflict", "pending publication has two competing new output trees")
		}
		if err = validatePublishedDirectory(destination, pending.StageIdentity); err != nil {
			return err
		}
		for key := range selectedGenerated(ledger.Entries, relative) {
			delete(ledger.Entries, key)
		}
		for key, entry := range pending.After {
			ledger.Entries[key] = entry
		}
		for key, entry := range backup {
			ledger.Entries[key] = entry
		}
		delete(ledger.Pending, relative)
		if err = rawSaveLaunchJSON(path, ledger); err != nil {
			return err
		}
		if len(backup) > 0 {
			if err = removeGeneratedSnapshot(backupPath, backupRelative, backup); err != nil {
				return err
			}
			for key := range backup {
				delete(ledger.Entries, key)
			}
			if err = rawSaveLaunchJSON(path, ledger); err != nil {
				return err
			}
		}
	}
	return nil
}

func (m *Manager) ResumeWorkspace(ctx context.Context, name string) (Workspace, error) {
	root, err := m.workspaceRoot(name)
	if err != nil {
		return Workspace{}, err
	}
	journal, err := loadJournal(root)
	if err != nil {
		return Workspace{}, err
	}
	selected := Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: root, Manifest: journal.Manifest}}
	unlock, err := withWorkspaceOperation(ctx, selected)
	if err != nil {
		return Workspace{}, err
	}
	defer unlock()
	resumed, err := m.Resume(ctx, name)
	if err != nil {
		return resumed, err
	}
	if err = RequireStopped(ctx, resumed.ResolvedWorkspace); err != nil {
		return resumed, err
	}
	if err = ReconcileGeneratedRoot(resumed); err != nil {
		return resumed, err
	}
	if err = ResumeGeneratedPublication(resumed); err != nil {
		return resumed, err
	}
	return resumed, nil
}
