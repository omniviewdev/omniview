package appstate

import "golang.org/x/sys/unix"

func renameDirectoryAtNoReplace(oldfd int, oldpath string, newfd int, newpath string) error {
	// A trailing source slash normally follows a directory symlink on Darwin.
	// Reject that resolution rather than moving the symlink's target.
	return unix.RenameatxNp(oldfd, oldpath, newfd, newpath, unix.RENAME_EXCL|unix.RENAME_NOFOLLOW_ANY)
}
