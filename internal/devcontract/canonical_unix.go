//go:build darwin || linux

package devcontract

import (
	"os"

	"golang.org/x/sys/unix"
)

// canonicalPlainPath observes each prefix afresh, without allocating a FileInfo
// or rebuilding prefix strings. Symlinks use filepath's complete resolver.
func canonicalPlainPath(absolute string) (bool, error) {
	var state unix.Stat_t
	for end := 1; end <= len(absolute); end++ {
		if end < len(absolute) && absolute[end] != '/' {
			continue
		}
		prefix := absolute[:end]
		if err := unix.Lstat(prefix, &state); err != nil {
			if os.IsNotExist(err) {
				// No descendant of a missing component can introduce a symlink.
				return true, nil
			}
			return false, &os.PathError{Op: "lstat", Path: prefix, Err: err}
		}
		if state.Mode&unix.S_IFMT == unix.S_IFLNK {
			return false, nil
		}
	}
	return true, nil
}
