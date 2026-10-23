package hostmodtest

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestPrivateCacheCleanupMakesDirectoriesWritableWithoutFollowingAliases(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix mode/symlink boundary")
	}
	cache, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	module := filepath.Join(cache, "downloaded-module")
	Write(t, filepath.Join(module, "go.mod"), "module example.com/downloaded\n")
	if err := os.Chmod(module, 0555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(module, 0755) })
	outside := t.TempDir()
	if err := os.Chmod(outside, 0555); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(outside, 0755) })
	if err := os.Symlink(outside, filepath.Join(cache, "outside-cache")); err != nil {
		t.Fatal(err)
	}
	if err := writableCacheDirectories(cache); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(module); err != nil || info.Mode().Perm()&0700 != 0700 {
		t.Fatalf("private module directory not restored: %v", err)
	}
	if info, err := os.Stat(outside); err != nil || info.Mode().Perm() != 0555 {
		t.Fatalf("foreign symlink target mode changed: %v", err)
	}
	if info, err := os.Stat(filepath.Join(module, "go.mod")); err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("module file mode changed: %v", err)
	}
}
