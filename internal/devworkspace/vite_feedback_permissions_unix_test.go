//go:build !windows

package devworkspace

import (
	"os"
	"testing"
)

func tamperFeedbackPermissions(t *testing.T, path string) error {
	t.Helper()
	t.Cleanup(func() { _ = os.Chmod(path, 0600) })
	return os.Chmod(path, 0644)
}
