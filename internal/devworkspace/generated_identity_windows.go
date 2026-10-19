//go:build windows

package devworkspace

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

func generatedDirectoryIdentity(file *os.File) (generatedFileIdentity, error) {
	var info windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(file.Fd()), &info); err != nil {
		return generatedFileIdentity{}, err
	}
	if info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 {
		return generatedFileIdentity{}, fmt.Errorf("generated staging is not a directory")
	}
	id := uint64(info.FileIndexHigh)<<32 | uint64(info.FileIndexLow)
	return generatedFileIdentity{Device: fmt.Sprint(info.VolumeSerialNumber), FileID: fmt.Sprint(id)}, nil
}
