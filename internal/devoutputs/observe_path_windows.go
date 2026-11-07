package devoutputs

import (
	"os"
	"path/filepath"
)

// The metadata handle is the initial observation. No preceding pathname Lstat
// is treated as an identity authority: Windows may resolve its file ID lazily.
// Both attributes and stable identity come from this same opened object.
func observeSnapshotPath(path string) (os.FileInfo, error) {
	file, err := openSnapshotObservation(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return file.Stat()
}

func openSnapshotObservation(path string) (*os.File, error) {
	parent, err := pinDirectory(filepath.Dir(path), "")
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	return openRelativeWindowsMetadata(parent, filepath.Base(path))
}
