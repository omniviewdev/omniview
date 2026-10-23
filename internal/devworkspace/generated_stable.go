package devworkspace

import (
	"os"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

// Effective module paths are passed to several producers. Keep their private
// final-directory capability stable while recording every owned output change.
// No arbitrary nonempty directory can be adopted.
func prepareStableHostModTree(w Workspace, generation string) (*GeneratedTree, error) {
	const relative = "toolsrc/hostmod"
	if generation == "" {
		return nil, devcontract.Fail(4, "generated_conflict", "stable host module output requires an owned generation")
	}
	ledger, unlock, path, err := lockGenerated(w)
	if err != nil {
		return nil, err
	}
	defer unlock()
	if err = generatedWritable(ledger); err != nil {
		return nil, err
	}
	if _, exists := ledger.Pending[relative]; exists {
		return nil, devcontract.Fail(4, "generated_pending", "host module output has an interrupted producer")
	}
	destination, err := generatedPath(w, filepath.FromSlash(relative))
	if err != nil {
		return nil, err
	}
	before, err := scanGenerated(w, filepath.FromSlash(relative))
	if err != nil {
		return nil, err
	}
	if !sameGenerated(before, selectedGenerated(ledger.Entries, filepath.FromSlash(relative))) {
		return nil, devcontract.Fail(4, "generated_conflict", "host module output contains changed or unrecorded bytes")
	}
	nonce := NewGeneration()
	pending := generatedPending{Generation: generation, Nonce: nonce, Stage: filepath.FromSlash(relative), Phase: "preparing-stable", Before: before}
	ledger.Pending[relative] = pending
	if err = rawSaveLaunchJSON(path, ledger); err != nil {
		return nil, err
	}
	for _, prefix := range []string{"toolsrc", filepath.FromSlash(relative)} {
		directory, err := generatedPath(w, prefix)
		if err != nil {
			return nil, err
		}
		entry, inspectErr := inspectGenerated(directory)
		if os.IsNotExist(inspectErr) {
			if err = os.Mkdir(directory, 0700); err != nil {
				return nil, err
			}
			ledger.Entries[prefix] = generatedEntry{Kind: "directory"}
			if err = rawSaveLaunchJSON(path, ledger); err != nil {
				return nil, err
			}
		} else if inspectErr != nil {
			return nil, inspectErr
		} else if entry.Kind != "directory" || entry != ledger.Entries[prefix] {
			return nil, devcontract.Fail(4, "generated_conflict", "host module output parent is not an owned directory")
		}
	}
	file, err := os.Open(destination)
	if err != nil {
		return nil, err
	}
	identity, err := generatedDirectoryIdentity(file)
	if err != nil {
		file.Close()
		return nil, err
	}
	pending.Phase = "prepared-stable"
	pending.StageIdentity = &identity
	ledger.Pending[relative] = pending
	if err = rawSaveLaunchJSON(path, ledger); err != nil {
		file.Close()
		return nil, err
	}
	return &GeneratedTree{Directory: destination, Destination: destination, workspace: w, relative: filepath.FromSlash(relative), generation: generation, nonce: nonce, before: before, stageFile: file, stageIdentity: identity}, nil
}

func recordStableHostModTree(prepared *GeneratedTree) error {
	if prepared == nil || prepared.stageFile == nil {
		return devcontract.Fail(4, "generated_conflict", "live stable host module output capability required")
	}
	defer prepared.stageFile.Close()
	ledger, unlock, path, err := lockGenerated(prepared.workspace)
	if err != nil {
		return err
	}
	defer unlock()
	if err = generatedWritable(ledger); err != nil {
		return err
	}
	pending, exists := ledger.Pending["toolsrc/hostmod"]
	if !exists || pending.Phase != "prepared-stable" || pending.Nonce != prepared.nonce || pending.Generation != prepared.generation || pending.StageIdentity == nil || *pending.StageIdentity != prepared.stageIdentity {
		return devcontract.Fail(4, "generated_conflict", "stable host module capability is stale")
	}
	if err = validatePreparedDirectory(prepared); err != nil {
		return err
	}
	after, err := scanGenerated(prepared.workspace, prepared.relative)
	if err != nil {
		return err
	}
	if err = validatePreparedDirectory(prepared); err != nil {
		return err
	}
	for relative := range selectedGenerated(ledger.Entries, prepared.relative) {
		delete(ledger.Entries, relative)
	}
	for relative, entry := range after {
		ledger.Entries[relative] = entry
	}
	delete(ledger.Pending, "toolsrc/hostmod")
	return rawSaveLaunchJSON(path, ledger)
}
