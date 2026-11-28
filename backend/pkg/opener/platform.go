package opener

import (
	"os/exec"
	"runtime"
)

// command is the platform's opener for an address, as a program and its arguments: the address is one element of the array, never a part of a command line a shell reads.
// A seam of the tests, which put a program of their own on the path.
func command(target string) *exec.Cmd {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", target)
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", target)
	default:
		return exec.Command("xdg-open", target)
	}
}

// platformOpen starts the opener and does not wait for the browser.
func platformOpen(target string) error {
	cmd := command(target)
	if err := cmd.Start(); err != nil {
		return err
	}
	go func() { _ = cmd.Wait() }()
	return nil
}
