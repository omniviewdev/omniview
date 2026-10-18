package devworkspace

import (
	"context"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// ReconcileGeneratedRoot follows an A03-validated completed UUID rename. It
// neither adopts a second live root nor reacquires bytes changed by an editor.
func ReconcileGeneratedRoot(w Workspace) error {
	lockPath, err := GeneratedLockPath(w, "generated")
	if err != nil {
		return err
	}
	lock, err := devsession.AcquirePrivateLock(context.Background(), filepath.Dir(lockPath), filepath.Base(lockPath))
	if err != nil {
		return err
	}
	defer lock.Unlock()
	collection, err := generatedCollection(w)
	if err != nil {
		return err
	}
	path := filepath.Join(collection, ".omniview-dev", "generated", w.Manifest.WorkspaceID+".json")
	var ledger generatedLedger
	if err = readLaunchJSON(path, &ledger); os.IsNotExist(err) {
		return nil
	} else if err != nil {
		return err
	}
	if ledger.SchemaVersion != 1 || ledger.WorkspaceID != w.Manifest.WorkspaceID || ledger.Entries == nil || ledger.Pending == nil {
		return devcontract.Fail(4, "generated_conflict", "generated ledger identity is invalid")
	}
	if ledger.Root == w.Root {
		return nil
	}
	if len(ledger.Pending) > 0 || filepath.Dir(ledger.Root) != filepath.Join(collection, "workspaces") {
		return devcontract.Fail(4, "generated_conflict", "generated root cannot be relocated from a pending or foreign owner")
	}
	if _, err = os.Lstat(ledger.Root); !os.IsNotExist(err) {
		return devcontract.Fail(4, "generated_conflict", "previous generated workspace root still exists")
	}
	for relative, entry := range ledger.Entries {
		current, err := generatedPath(w, relative)
		if err != nil {
			return err
		}
		if err = checkGeneratedEntry(current, entry); err != nil {
			return err
		}
	}
	ledger.Root = w.Root
	return rawSaveLaunchJSON(path, ledger)
}

func (m *Manager) RollbackWorkspace(ctx context.Context, name string) error {
	w, err := m.Inspect(ctx, name)
	if err != nil {
		return m.Rollback(ctx, name)
	}
	unlock, err := withWorkspaceOperation(ctx, w)
	if err != nil {
		return err
	}
	defer unlock()
	if err = RequireStopped(ctx, w.ResolvedWorkspace); err != nil {
		return err
	}
	if _, err = m.Unlink(ctx, name); err != nil {
		return err
	}
	if err = CleanGenerated(w); err != nil {
		return err
	}
	return m.Rollback(ctx, name)
}
