package devworkspace

import (
	"context"
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
)

// renameOwnedRootPaths grants admission only after all ownership domains have
// validated their current bytes. Exact paths never grant neighbor admission.
func renameOwnedRootPaths(ctx context.Context, w Workspace) ([]string, error) {
	paths, err := devoutputs.ValidatedOwnedPaths(ctx, w.ResolvedWorkspace)
	if err != nil {
		return nil, err
	}
	j, err := loadLinkJournal(w)
	if os.IsNotExist(err) {
		return paths, nil
	}
	if err != nil {
		return nil, err
	}
	if err = checkLinkFiles(w.Root, j); err != nil {
		return nil, err
	}
	for _, file := range j.Files {
		// Restoring a preexisting aggregate would leave foreign root bytes at
		// the final strict gate. Refuse before recording lifecycle intent.
		if filepath.Dir(file.Path) == "." && file.OriginalExists {
			return nil, devcontract.Fail(4, "foreign_files", "rename cannot retain preexisting aggregate files at the workspace root")
		}
		paths = append(paths, filepath.Join(w.Root, file.Path))
	}
	return paths, nil
}

// Caller holds lifecycle then stopped-profile guards, matching Link/Unlink.
// No public manager operation recurses under those guards. The unlinking intent
// precedes restoration; every step accepts its own completed before-image.
// Delete the absolute-root link journal before the lifecycle root can move.
func teardownRenameLinks(ctx context.Context, w Workspace) error {
	j, err := loadLinkJournal(w)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if err = checkLinkFiles(w.Root, j); err != nil {
		return err
	}
	if j.Phase != "unlinking" {
		if err = ValidateRepositoryOutputs(ctx, w); err != nil {
			return err
		}
	}
	j.Phase = "unlinking"
	if err = saveLinkJournal(j); err != nil {
		return err
	}
	if err = restoreLinkFiles(w.Root, j); err != nil {
		return err
	}
	if err = RestoreRepositoryOutputs(ctx, w); err != nil {
		return err
	}
	return os.Remove(filepath.Join(w.Root, ".local/links.json"))
}
