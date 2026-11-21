package store

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// zeroChunkBytes is how much of a file one write of zeros covers.
const zeroChunkBytes = 64 << 10

// errNotRegular reports a file that is not a plain file: zeroAndRemove will not
// write through a link, or to a device, that a name in the directory points at.
var errNotRegular = errors.New("not a regular file")

// zeroAndRemove overwrites the file at path with zeros, flushes them, and removes
// the file. Removing alone leaves the bytes in the disk blocks the file frees. A
// file that is not there is not an error.
//
// This wipes the blocks the file system gave the file, in place. A file system
// that never writes in place (APFS, ZFS, btrfs, ReFS), an SSD that remaps its
// blocks, a snapshot and a backup keep older blocks that no application can reach.
func zeroAndRemove(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%w: %s", errNotRegular, info.Mode().Type())
	}
	if err = overwriteWithZeros(path, info.Size()); err != nil {
		return err
	}
	if err = os.Remove(path); err != nil {
		return err
	}
	return syncDir(filepath.Dir(path))
}

// overwriteWithZeros writes size bytes of zeros over the start of the file and
// flushes them to the disk.
func overwriteWithZeros(path string, size int64) error {
	file, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return err
	}
	zeros := make([]byte, min(size, zeroChunkBytes))
	for written := int64(0); written < size; {
		chunk := min(int64(len(zeros)), size-written)
		if _, err = file.WriteAt(zeros[:chunk], written); err != nil {
			_ = file.Close()
			return err
		}
		written += chunk
	}
	if err = file.Sync(); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}

// pathExists reports whether anything is named path. Only a missing path is "no":
// any other failure to look (a permission error, an I/O error) is returned, so
// that nothing goes on as if the path were absent when it could not be inspected.
func pathExists(path string) (bool, error) {
	_, err := os.Lstat(path)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	return false, err
}
