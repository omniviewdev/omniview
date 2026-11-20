// Package finding is a temporary file for the N24-L2 proof: it ignores an error.
package finding

import "os"

// Protect makes a file private and ignores the error.
func Protect(name string) {
	os.Chmod(name, 0o600)
}
