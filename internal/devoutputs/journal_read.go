package devoutputs

import (
	"github.com/omniviewdev/omniview/internal/devsession"
	"io"
	"os"
)

func readJournalBytes(path string) ([]byte, error) {
	if err := devsession.ValidatePrivateFile(path); err != nil {
		return nil, err
	}
	observed, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	observed, err = stableSnapshotInfo(path, observed)
	if err != nil {
		return nil, err
	}
	stream, err := openObservedSnapshotFile(path, observed)
	if err != nil {
		return nil, err
	}
	raw, readErr := io.ReadAll(stream)
	closeErr := stream.Close()
	if readErr != nil {
		return nil, readErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	after, err := os.Lstat(path)
	if err != nil {
		return nil, snapshotPathError(path, observed, err)
	}
	if !after.Mode().IsRegular() || !os.SameFile(observed, after) || observed.Mode() != after.Mode() || observed.Size() != after.Size() || observed.ModTime() != after.ModTime() {
		return nil, changedPath(path, observed, after, "ownership journal changed during observation")
	}
	return raw, nil
}
