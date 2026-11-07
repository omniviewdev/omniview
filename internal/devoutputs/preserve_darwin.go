package devoutputs

import (
	"os"

	"golang.org/x/sys/unix"
)

func renamePinnedNoReplace(source *os.File, sourceName string, destination *os.File, destinationName string) error {
	return unix.RenameatxNp(int(source.Fd()), sourceName, int(destination.Fd()), destinationName, unix.RENAME_EXCL|unix.RENAME_NOFOLLOW_ANY)
}
