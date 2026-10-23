//go:build windows

package devcontract

import "golang.org/x/sys/windows"

func publishCustomProfileJSON(source, destination string) error {
	from, err := windows.UTF16PtrFromString(source)
	if err != nil {
		return err
	}
	to, err := windows.UTF16PtrFromString(destination)
	if err != nil {
		return err
	}
	// The temporary file is already synchronized. Write-through replacement
	// preserves metadata updates without syncing a read-only directory handle.
	return windows.MoveFileEx(from, to, windows.MOVEFILE_REPLACE_EXISTING|windows.MOVEFILE_WRITE_THROUGH)
}
