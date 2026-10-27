package devworkspace

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// ProtocolEvidence reuses acceptance proof, not an attestation of installed
// dependencies. Link and build gates still check current source inputs.
func (m *Manager) ProtocolEvidence(ctx context.Context, name string) (LinkProtocolEvidence, error) {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return LinkProtocolEvidence{}, err
	}
	j, err := loadLinkJournal(w)
	if err != nil {
		return LinkProtocolEvidence{}, err
	}
	if err = j.Evidence.validateRoots(j.Plan.Roots); err != nil {
		return LinkProtocolEvidence{}, err
	}
	return j.Evidence, nil
}

// RecoverLinks preserves changed bytes before retiring the old graph. Unknown
// installer bytes are never adopted as a successful installation.
func (m *Manager) RecoverLinks(ctx context.Context, name string) (LinkReport, error) {
	w, unlock, err := m.linkWorkspace(ctx, name)
	if err != nil {
		return LinkReport{}, err
	}
	defer unlock()
	j, err := loadLinkJournal(w)
	if os.IsNotExist(err) {
		return LinkReport{WorkspaceID: w.Manifest.WorkspaceID, Phase: "unlinked"}, nil
	}
	if err != nil {
		return LinkReport{}, err
	}
	backupRoot := filepath.Join(m.Root, ".omniview-dev", "recovery", w.Manifest.WorkspaceID)
	canonical, err := devcontract.CanonicalPath(backupRoot)
	if err != nil {
		return LinkReport{}, err
	}
	if canonical != backupRoot {
		return LinkReport{}, devcontract.Fail(4, "foreign_recovery", "recovery directory cannot be redirected")
	}
	for i := range j.Files {
		e := &j.Files[i]
		current, snapshotErr := snapshotLinkFile(w.Root, filepath.Join(w.Root, e.Path))
		if snapshotErr != nil {
			return LinkReport{}, snapshotErr
		}
		if current.OriginalHash != e.AppliedHash && current.OriginalHash != e.OriginalHash {
			// Content-addressed receipts include path, absence and mode. Publishing
			// and syncing the receipt precedes every destructive restoration.
			key := linkHash([]byte(e.Path+"\x00"+current.OriginalHash), true)
			receipt := struct {
				linkFile
				Owned linkFile `json:"owned"`
			}{current, *e}
			if err = atomicOwnedJSON(filepath.Join(backupRoot, key+".json"), receipt, w.Manifest.WorkspaceID); err != nil {
				return LinkReport{}, err
			}
			if !e.OriginalExists && current.OriginalExists && e.Pending {
				// The synced receipt preserves unattested installer output.
				// Restore recorded absence; never accept these bytes as installed.
			} else if !e.OriginalExists || !current.OriginalExists {
				return LinkReport{}, devcontract.Fail(4, "link_merge_conflict", "edited generated or deleted dependency file requires reconciliation; active bytes and backup retained: "+e.Path)
			} else {
				merged, mergeErr := removeOwnedLinkDelta(ctx, e.Original, e.Applied, current.Original)
				if mergeErr != nil {
					return LinkReport{}, devcontract.Fail(4, "link_merge_conflict", "user edits overlap the owned dependency overlay; active bytes and backup retained: "+e.Path)
				}
				e.Original = merged
				e.OriginalHash = linkHash(merged, true)
				e.Mode = current.Mode
			}
		}
		e.Applied = current.Original
		e.AppliedHash = current.OriginalHash
		e.Pending = false
	}
	j.Phase = "unlinking"
	if err = saveLinkJournal(j); err != nil {
		return LinkReport{}, err
	}
	if err = restoreLinkFiles(w.Root, j); err != nil {
		return LinkReport{}, err
	}
	// Output ownership is validated by normal Unlink; do not claim recovered
	// installer bytes attest the installed composition.
	return LinkReport{WorkspaceID: j.WorkspaceID, Protocol: j.Evidence.Protocol, Phase: "unlinking"}, nil
}

// Merge current user changes onto the pre-overlay source. The applied overlay
// is the common ancestor, so only the journal-owned delta is removed.
func removeOwnedLinkDelta(ctx context.Context, original, applied, current []byte) ([]byte, error) {
	dir, err := os.MkdirTemp("", "omniview-link-merge-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	for name, data := range map[string][]byte{"current": current, "applied": applied, "original": original} {
		if err = os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
			return nil, err
		}
	}
	return exec.CommandContext(ctx, "git", "merge-file", "-p", "--", filepath.Join(dir, "current"), filepath.Join(dir, "applied"), filepath.Join(dir, "original")).Output()
}
