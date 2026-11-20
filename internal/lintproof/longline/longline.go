// Package longline is a temporary file for the N24-L2 proof: two lines are longer than 120 characters.
package longline

import "os"

// Protect makes a file private and returns the error; this comment line is far longer than the 120 characters the lll linter allowed by default.
func Protect(name string) error {
	const mode = 0o600 // the mode is owner read and write only, and this trailing comment makes the code line longer than 120 characters, as lll would have flagged
	return os.Chmod(name, mode)
}
