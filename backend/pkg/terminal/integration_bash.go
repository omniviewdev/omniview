//go:build !windows

package terminal

import "errors"

// probeBashVersion asks the bash at path which version it is.
func probeBashVersion(string) (int, int, error) { return 0, 0, errors.New("not implemented") }
