package appstate

import "golang.org/x/sys/unix"

func renameDirectoryAtNoReplace(oldfd int, oldpath string, newfd int, newpath string) error {
	return unix.Renameat2(oldfd, oldpath, newfd, newpath, unix.RENAME_NOREPLACE)
}
