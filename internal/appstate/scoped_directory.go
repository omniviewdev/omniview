package appstate

import (
	"crypto/rand"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// FilesystemIdentity identifies an owned filesystem object across process restarts.
// File retains the full Windows FILE_ID_128; Unix stores the inode in its low bytes.
type FilesystemIdentity struct {
	Volume uint64   `json:"volume"`
	File   [16]byte `json:"file"`
}

func openIdentityFile(root *os.Root, name string, flag int) (*os.File, os.FileInfo, error) {
	if err := validate(name); err != nil {
		return nil, nil, err
	}
	before, err := root.Lstat(name)
	if err != nil {
		return nil, nil, err
	}
	if before.Mode()&os.ModeSymlink != 0 {
		return nil, nil, fmt.Errorf("appstate: identity path %q is redirected", name)
	}
	file, err := root.OpenFile(name, flag, 0)
	if err != nil {
		return nil, nil, err
	}
	actual, err := file.Stat()
	if err != nil || !os.SameFile(before, actual) {
		file.Close()
		return nil, nil, errors.Join(err, fmt.Errorf("appstate: identity path %q changed while opening", name))
	}
	return file, actual, nil
}

// DirectoryIdentity reads the durable identity of a contained, non-redirected
// directory owned by the current OS user. The root itself may be inspected as ".".
func (s *ScopedRoot) DirectoryIdentity(name string) (FilesystemIdentity, error) {
	root, done := s.acquire()
	defer done()
	file, info, err := openIdentityFile(root, name, os.O_RDONLY)
	if err != nil {
		return FilesystemIdentity{}, err
	}
	defer file.Close()
	if !info.IsDir() {
		return FilesystemIdentity{}, fmt.Errorf("appstate: %q is not a directory", name)
	}
	return filesystemIdentity(file)
}

// OpenPrivateFile validates a contained regular file and its owner before the
// caller reads its contents. It returns identity proof for subsequent removal.
func (s *ScopedRoot) OpenPrivateFile(name string, flag int) (*os.File, FilesystemIdentity, error) {
	if flag != os.O_RDONLY && flag != os.O_RDWR {
		return nil, FilesystemIdentity{}, errors.New("appstate: private file open must not create or truncate")
	}
	root, done := s.acquire()
	defer done()
	file, info, err := openIdentityFile(root, name, flag)
	if err != nil {
		return nil, FilesystemIdentity{}, err
	}
	if !info.Mode().IsRegular() || (runtime.GOOS != "windows" && info.Mode().Perm()&0077 != 0) {
		file.Close()
		return nil, FilesystemIdentity{}, fmt.Errorf("appstate: %q is not a private regular file", name)
	}
	identity, err := filesystemIdentity(file)
	if err != nil {
		file.Close()
		return nil, FilesystemIdentity{}, err
	}
	return file, identity, nil
}

// RenameDirectoryNoReplace atomically moves a contained directory only when the
// destination does not exist. It never emulates exclusion with check-then-rename
// or copy/delete; unsupported filesystems and kernels return an error.
func (s *ScopedRoot) RenameDirectoryNoReplace(oldpath, newpath string) error {
	if err := validate(oldpath); err != nil {
		return err
	}
	if err := validate(newpath); err != nil {
		return err
	}
	if filepath.Clean(oldpath) == "." || filepath.Clean(newpath) == "." {
		return errors.New("appstate: refusing to rename a scope root")
	}
	root, done := s.acquire()
	defer done()
	info, err := root.Lstat(oldpath)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("appstate: rename source %q is not an ordinary directory", oldpath)
	}
	return s.relocating(oldpath, newpath, func() error { return renameDirectoryNoReplace(root, oldpath, newpath) })
}

// MkdirTemp creates a private, exclusive directory through the held root
// capability, without resolving an absolute pathname outside that capability.
func (s *ScopedRoot) MkdirTemp(prefix string) (string, error) {
	const privateDirectoryMode = 0o700
	if err := validate(prefix); err != nil {
		return "", err
	}
	if filepath.Base(prefix) != prefix || prefix == "." {
		return "", errors.New("appstate: temporary directory prefix must be one component")
	}
	root, done := s.acquire()
	defer done()
	for range 10 {
		name := prefix + rand.Text()
		if err := root.Mkdir(name, privateDirectoryMode); err == nil {
			return name, nil
		} else if !os.IsExist(err) {
			return "", err
		}
	}
	return "", errors.New("appstate: could not reserve an exclusive temporary directory")
}
