package devoutputs

import (
	"io"
	"os"

	"github.com/omniviewdev/omniview/internal/devsession"
)

func readJournalBytes(path string) ([]byte, error) {
	observed, err := observeSnapshotPath(path)
	if err != nil {
		return nil, err
	}
	return readObservedJournalBytes(path, observed)
}

// observed must originate from the initial filesystem observation, which is a
// handle-derived observation on Windows, never a later rebase of pathname info.
func readObservedJournalBytes(path string, observed os.FileInfo) ([]byte, error) {
	if err := devsession.ValidatePrivateFile(path); err != nil {
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
	after, err := observeSnapshotPath(path)
	if err != nil {
		return nil, snapshotPathError(path, observed, err)
	}
	if !after.Mode().IsRegular() || !os.SameFile(observed, after) || observed.Mode() != after.Mode() || observed.Size() != after.Size() || observed.ModTime() != after.ModTime() {
		return nil, changedPath(path, observed, after, "ownership journal changed during observation")
	}
	return raw, nil
}
