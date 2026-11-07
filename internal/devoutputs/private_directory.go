package devoutputs

import (
	"fmt"
	"path/filepath"

	"github.com/omniviewdev/omniview/internal/devsession"
)

// Only absent, already-selected cache roots reach this exclusive constructor.
// Privacy is established at creation; an existing root is never chmod/chowned.
func createPrivateOutputDirectory(path, expectedParent string) error {
	if expectedParent == "" {
		return fmt.Errorf("private output parent has no verified identity")
	}
	parentPath := filepath.Dir(path)
	parent, err := pinDirectory(parentPath, expectedParent)
	if err != nil {
		return err
	}
	defer parent.Close()
	created, err := devsession.CreatePrivateDirectoryAt(parent, filepath.Base(path))
	if err != nil {
		return err
	}
	defer created.Close()
	createdIdentity, err := directoryHandleIdentity(created)
	if err != nil {
		return err
	}
	parentIdentity, err := directoryIdentity(parentPath)
	if err != nil {
		return err
	}
	if parentIdentity != expectedParent {
		return fmt.Errorf("private output parent changed during allocation")
	}
	if _, err = cleanPath(path); err != nil {
		return err
	}
	currentIdentity, err := directoryIdentity(path)
	if err != nil {
		return err
	}
	if currentIdentity != createdIdentity {
		return fmt.Errorf("private output directory changed during allocation")
	}
	return devsession.ValidatePrivateDirectory(path)
}
