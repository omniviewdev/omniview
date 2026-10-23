package devworkspace

import (
	"os"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

type generatedFileIdentity struct {
	Device string `json:"device"`
	FileID string `json:"fileID"`
}

func validatePreparedDirectory(prepared *GeneratedTree) error {
	if prepared.stageFile == nil {
		return devcontract.Fail(4, "generated_conflict", "prepared staging handle is unavailable")
	}
	opened, err := prepared.stageFile.Stat()
	if err != nil {
		return err
	}
	current, err := os.Lstat(prepared.Directory)
	if err != nil {
		return err
	}
	if !current.IsDir() || !os.SameFile(opened, current) {
		return devcontract.Fail(4, "generated_conflict", "prepared staging directory was replaced")
	}
	actual, err := generatedDirectoryIdentity(prepared.stageFile)
	if err != nil {
		return err
	}
	if actual != prepared.stageIdentity {
		return devcontract.Fail(4, "generated_conflict", "prepared staging directory identity changed")
	}
	return nil
}
func validatePublishedDirectory(path string, expected *generatedFileIdentity) error {
	if expected == nil {
		return devcontract.Fail(4, "generated_conflict", "publication lacks retained staging identity")
	}
	before, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if !before.IsDir() {
		return devcontract.Fail(4, "generated_conflict", "publication is not its prepared directory")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return err
	}
	if !os.SameFile(before, opened) {
		return devcontract.Fail(4, "generated_conflict", "publication directory changed during inspection")
	}
	actual, err := generatedDirectoryIdentity(file)
	if err != nil {
		return err
	}
	if actual != *expected {
		return devcontract.Fail(4, "generated_conflict", "publication directory is not the attested staging inode")
	}
	return nil
}
