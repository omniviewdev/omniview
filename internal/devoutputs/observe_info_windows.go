package devoutputs

import "os"

// Windows pathname FileInfo may load its file ID lazily in os.SameFile. Capture
// handle-derived metadata now, before queuing the observation, so a subsequent
// pathname replacement cannot redefine the identity we compare before reading.
func stableSnapshotInfo(path string, observed os.FileInfo) (os.FileInfo, error) {
	if !observed.Mode().IsRegular() {
		return observed, nil
	}
	stream, err := openSnapshotFile(path)
	if err != nil {
		return nil, snapshotPathError(path, observed, err)
	}
	defer stream.Close()
	current, err := stream.Stat()
	if err != nil {
		return nil, err
	}
	if !current.Mode().IsRegular() || current.Mode() != observed.Mode() || current.Size() != observed.Size() || current.ModTime() != observed.ModTime() {
		return nil, changedPath(path, observed, current, "producer metadata changed while capturing identity")
	}
	return current, nil
}
