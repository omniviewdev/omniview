package appstate

import (
	"os"
	"path/filepath"
	"testing"
)

// NewTestService creates a Service backed by a temporary directory for use in tests.
// The service is automatically cleaned up when the test finishes.
func NewTestService(t testing.TB) *Service {
	t.Helper()
	dir := t.TempDir()
	svc, err := New(WithRoot(dir), WithFlock(false))
	if err != nil {
		t.Fatalf("appstate.NewTestService: %v", err)
	}
	t.Cleanup(func() {
		if closeErr := svc.Close(); closeErr != nil {
			t.Errorf("appstate.NewTestService cleanup: %v", closeErr)
		}
	})
	return svc
}

// SkipIfOpenRootBlocksRename skips a test that renames or deletes a plugin
// directory while a cached store or data root is open inside it, on a platform
// that refuses to. It probes instead of assuming: Go opens a top-level os.Root
// on Windows without FILE_SHARE_DELETE (syscall_windows.go, Open), so there the
// rename or removal may fail while a root is held, and what the probe saw is in
// the skip message. On Unix the probe succeeds and the test runs.
func SkipIfOpenRootBlocksRename(t testing.TB) {
	t.Helper()
	base := t.TempDir()
	held := filepath.Join(base, "plugin", "store")
	if err := os.MkdirAll(held, 0o700); err != nil {
		t.Fatalf("appstate.SkipIfOpenRootBlocksRename: %v", err)
	}
	root, err := os.OpenRoot(held)
	if err != nil {
		t.Fatalf("appstate.SkipIfOpenRootBlocksRename: %v", err)
	}
	defer root.Close()
	// What an uninstall does to the directory that holds a root: stage it by
	// rename, then delete the staged tree.
	staged := filepath.Join(base, "staged")
	if err = os.Rename(filepath.Join(base, "plugin"), staged); err != nil {
		t.Skipf("this OS refuses to rename a directory that holds an open os.Root: %v", err)
	}
	if err = os.RemoveAll(staged); err != nil {
		t.Skipf("this OS refuses to delete a directory that holds an open os.Root: %v", err)
	}
}
