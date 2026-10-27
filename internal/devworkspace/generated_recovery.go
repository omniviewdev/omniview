package devworkspace

import (
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// preserveGeneratedEdits only releases recorded regular-file edits for rebuild.
// New paths, symlinks and interrupted compiler output remain ownership conflicts.
func preserveGeneratedEdits(w Workspace, backupRoot string) error {
	if err := ResumeGeneratedPublication(w); err != nil {
		return err
	}
	ledger, unlock, path, err := lockGenerated(w)
	if err != nil {
		return err
	}
	defer unlock()
	for relative, expected := range ledger.Entries {
		actual, err := generatedPath(w, relative)
		if err != nil {
			return err
		}
		current, err := inspectGenerated(actual)
		if os.IsNotExist(err) {
			return devcontract.Fail(4, "generated_conflict", "recorded generated path was deleted: "+relative)
		}
		if err != nil {
			return err
		}
		if current == expected {
			continue
		}
		if current.Kind != "file" || expected.Kind != "file" {
			return devcontract.Fail(4, "generated_conflict", "changed generated path is not a recorded regular file: "+relative)
		}
		data, err := os.ReadFile(actual)
		if err != nil {
			return err
		}
		if digestGenerated(data) != current.SHA256 {
			return devcontract.Fail(4, "generated_conflict", "generated file changed during recovery: "+relative)
		}
		info, err := os.Stat(actual)
		if err != nil {
			return err
		}
		backup := linkFile{Path: relative, Original: data, OriginalExists: true, OriginalHash: current.SHA256, Mode: info.Mode().Perm()}
		key := digestGenerated([]byte(relative + "\x00" + current.SHA256))
		if err = atomicOwnedJSON(filepath.Join(backupRoot, key+".json"), backup, w.Manifest.WorkspaceID); err != nil {
			return err
		}
		// This records ownership only, never build success or dependency freshness.
		ledger.Entries[relative] = current
	}
	return rawSaveLaunchJSON(path, ledger)
}
