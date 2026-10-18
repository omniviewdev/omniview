package devbaseline

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows"
)

func independentFile(path string, expected os.FileInfo) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	var native windows.ByHandleFileInformation
	if err := windows.GetFileInformationByHandle(windows.Handle(file.Fd()), &native); err != nil {
		return err
	}
	if native.NumberOfLinks != 1 || !os.SameFile(expected, info) {
		return fmt.Errorf("baseline: hardlinked or changed source input is not allowed")
	}
	return nil
}

func finalize(stage, destination string) error {
	from, err := windows.UTF16PtrFromString(stage)
	if err != nil {
		return err
	}
	to, err := windows.UTF16PtrFromString(destination)
	if err != nil {
		return err
	}
	// No REPLACE_EXISTING: a competing initialized destination must win intact.
	return windows.MoveFileEx(from, to, windows.MOVEFILE_WRITE_THROUGH)
}

func syncDirectory(path string) error {
	// Windows does not expose POSIX directory fsync. Validate the directory here;
	// individual files are flushed and publication uses MOVEFILE_WRITE_THROUGH.
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("baseline: staging parent is not a directory")
	}
	return nil
}
