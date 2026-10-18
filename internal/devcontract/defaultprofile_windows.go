//go:build windows

package devcontract

import "golang.org/x/sys/windows"

func publishDefaultProfileOwner(source, destination string) error {
	from, err := windows.UTF16PtrFromString(source)
	if err != nil {
		return err
	}
	to, err := windows.UTF16PtrFromString(destination)
	if err != nil {
		return err
	}
	// The complete marker file was already synchronized. Match devsession's
	// Windows write-through publication, but omit REPLACE_EXISTING: another
	// owner at the destination must never be overwritten. A separate os.Open
	// directory Sync would FlushFileBuffers on a read-only handle and fail.
	return windows.MoveFileEx(from, to, windows.MOVEFILE_WRITE_THROUGH)
}
