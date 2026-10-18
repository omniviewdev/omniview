//go:build darwin || linux

package devsession

import (
	"fmt"
	"os"
	"syscall"
)

func checkPathOwner(info os.FileInfo) error {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Geteuid()) {
		return fmt.Errorf("%w: runtime path is not owned by the current user", ErrOwnership)
	}
	return nil
}

func restrictPrivatePath(path string, directory bool) error {
	info, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("%w: refusing runtime symlink", ErrOwnership)
	}
	if err := checkPathOwner(info); err != nil {
		return err
	}
	mode := os.FileMode(0600)
	if directory {
		mode = 0700
	}
	return os.Chmod(path, mode)
}

func openPrivateLockFile(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW, 0600)
}

func restrictPrivateLockFile(file *os.File) error {
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if err := checkPathOwner(info); err != nil {
		return err
	}
	return file.Chmod(0600)
}

func checkPrivatePath(_ string, info os.FileInfo) error {
	if err := checkPathOwner(info); err != nil {
		return err
	}
	if info.Mode().Perm()&0077 != 0 {
		return fmt.Errorf("%w: runtime file is accessible to other users", ErrOwnership)
	}
	return nil
}

func replacePrivateFile(source, destination string) error {
	return os.Rename(source, destination)
}

func syncPrivateDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
