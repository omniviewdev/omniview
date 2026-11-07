package devoutputs

import (
	"fmt"
	"os"
)

// pathConflict is filesystem substitution evidence, not an arbitrary I/O error.
// Inspection may aggregate this condition without mislabeling permission,
// cancellation, unsupported-operation or transport failures as ownership drift.
type pathConflict struct {
	Path, ActualKind, ExpectedKind, Reason string
}

func (e *pathConflict) Error() string { return fmt.Sprintf("%s: %s", e.Reason, e.Path) }
func fileKind(info os.FileInfo) string {
	if info == nil {
		return "absent"
	}
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		return "link"
	case info.IsDir():
		return "directory"
	case info.Mode().IsRegular():
		return "file"
	default:
		return "special"
	}
}
func changedPath(path string, before, after os.FileInfo, reason string) error {
	return &pathConflict{Path: path, ExpectedKind: fileKind(before), ActualKind: fileKind(after), Reason: reason}
}

func openObservedSnapshotFile(path string, observed os.FileInfo) (*os.File, error) {
	stream, err := openSnapshotFile(path)
	if err != nil {
		return nil, snapshotPathError(path, observed, err)
	}
	current, err := stream.Stat()
	if err != nil {
		stream.Close()
		return nil, err
	}
	if !current.Mode().IsRegular() || !os.SameFile(observed, current) || observed.Mode() != current.Mode() || observed.Size() != current.Size() || observed.ModTime() != current.ModTime() {
		stream.Close()
		return nil, changedPath(path, observed, current, "producer file was substituted before read")
	}
	return stream, nil
}

func snapshotPathError(path string, observed os.FileInfo, cause error) error {
	current, statErr := observeSnapshotPath(path)
	if os.IsNotExist(statErr) {
		return changedPath(path, observed, nil, "producer entry disappeared during observation")
	}
	if statErr == nil && (!os.SameFile(observed, current) || current.Mode() != observed.Mode()) {
		return changedPath(path, observed, current, "producer entry was substituted during observation")
	}
	return cause
}
