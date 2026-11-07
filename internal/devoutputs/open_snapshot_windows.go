package devoutputs

import (
	"golang.org/x/sys/windows"
	"os"
	"path/filepath"
)

func openSnapshotFile(path string) (*os.File, error) {
	parent, err := pinDirectory(filepath.Dir(path), "")
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	return openRelativeWindows(parent, filepath.Base(path), windows.FILE_READ_DATA|windows.FILE_READ_ATTRIBUTES, windows.FILE_NON_DIRECTORY_FILE)
}
