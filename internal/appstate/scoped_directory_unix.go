//go:build darwin || linux

package appstate

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"runtime"

	"golang.org/x/sys/unix"
)

func filesystemIdentity(file *os.File) (FilesystemIdentity, error) {
	var stat unix.Stat_t
	err := unix.Fstat(int(file.Fd()), &stat)
	runtime.KeepAlive(file)
	if err != nil {
		return FilesystemIdentity{}, &os.PathError{Op: "fstat", Path: file.Name(), Err: err}
	}
	if stat.Uid != uint32(os.Geteuid()) {
		return FilesystemIdentity{}, &os.PathError{Op: "identity", Path: file.Name(), Err: os.ErrPermission}
	}
	identity := FilesystemIdentity{Volume: uint64(stat.Dev)}
	binary.LittleEndian.PutUint64(identity.File[:8], uint64(stat.Ino))
	return identity, nil
}

func renameDirectoryNoReplace(root *os.Root, oldpath, newpath string) error {
	oldpath = filepath.Clean(oldpath)
	newpath = filepath.Clean(newpath)
	oldParent, err := root.OpenFile(filepath.Dir(oldpath), os.O_RDONLY|unix.O_DIRECTORY, 0)
	if err != nil {
		return &os.LinkError{Op: "rename-noreplace", Old: oldpath, New: newpath, Err: err}
	}
	defer oldParent.Close()

	newParent, err := root.OpenFile(filepath.Dir(newpath), os.O_RDONLY|unix.O_DIRECTORY, 0)
	if err != nil {
		return &os.LinkError{Op: "rename-noreplace", Old: oldpath, New: newpath, Err: err}
	}
	defer newParent.Close()

	// Resolve only the leaves against the contained, opened parent handles.
	// The source slash requires an actual directory at the atomic rename,
	// including when another process replaces the source after validation.
	err = renameDirectoryAtNoReplace(int(oldParent.Fd()), filepath.Base(oldpath)+"/", int(newParent.Fd()), filepath.Base(newpath))
	if err != nil {
		return &os.LinkError{Op: "rename-noreplace", Old: oldpath, New: newpath, Err: err}
	}
	return nil
}
