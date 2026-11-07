package devoutputs

import (
	"golang.org/x/sys/unix"
	"os"
)

func renamePinnedNoReplace(source *os.File, sourceName string, destination *os.File, destinationName string) error {
	return unix.Renameat2(int(source.Fd()), sourceName, int(destination.Fd()), destinationName, unix.RENAME_NOREPLACE)
}
