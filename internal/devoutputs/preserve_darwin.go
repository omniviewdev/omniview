package devoutputs

import "golang.org/x/sys/unix"

func preserveRename(source, destination string) error {
	return unix.RenameatxNp(unix.AT_FDCWD, source, unix.AT_FDCWD, destination, unix.RENAME_EXCL|unix.RENAME_NOFOLLOW_ANY)
}
