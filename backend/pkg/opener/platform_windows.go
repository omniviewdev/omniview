//go:build windows

package opener

import "golang.org/x/sys/windows"

// platformOpen hands the address to the shell's `open` verb with ShellExecute, as Wails does (pkg/browser): the address is passed as a wide string, so a query
// with characters outside ASCII reaches the browser whole, and no command line is built from it.
func platformOpen(target string) error {
	verb, err := windows.UTF16PtrFromString("open")
	if err != nil {
		return err
	}
	file, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	return windows.ShellExecute(0, verb, file, nil, nil, windows.SW_SHOWNORMAL)
}
