package devoutputs

import (
	"os"
	"runtime"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

// FILE_RENAME_INFORMATION; ReplaceIfExists deliberately remains false.
type outputRenameInformation struct {
	ReplaceIfExists byte
	RootDirectory   windows.Handle
	FileNameLength  uint32
	FileName        [1]uint16
}

func renamePinnedNoReplace(source *os.File, sourceName string, destination *os.File, destinationName string) error {
	file, err := openRelativeWindows(source, sourceName, windows.DELETE|windows.FILE_READ_ATTRIBUTES, 0)
	if err != nil {
		return err
	}
	defer file.Close()
	const offset = int(unsafe.Offsetof(outputRenameInformation{}.FileName)) / 2
	const minimum = int(unsafe.Sizeof(outputRenameInformation{})) / 2
	buffer := make([]uint16, offset, offset+len(destinationName)+minimum)
	for _, r := range destinationName {
		buffer = utf16.AppendRune(buffer, r)
	}
	length := uint32((len(buffer) - offset) * 2)
	if len(buffer) < minimum {
		buffer = buffer[:minimum]
	}
	info := (*outputRenameInformation)(unsafe.Pointer(&buffer[0]))
	info.RootDirectory = windows.Handle(destination.Fd())
	info.FileNameLength = length
	err = windows.NtSetInformationFile(windows.Handle(file.Fd()), &windows.IO_STATUS_BLOCK{}, (*byte)(unsafe.Pointer(&buffer[0])), uint32(len(buffer)*2), windows.FileRenameInformation)
	runtime.KeepAlive(file)
	runtime.KeepAlive(destination)
	if status, ok := err.(windows.NTStatus); ok {
		return status.Errno()
	}
	return err
}
