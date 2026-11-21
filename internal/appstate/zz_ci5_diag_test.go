package appstate

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCI5Diag(t *testing.T) {
	dir := t.TempDir()
	r, err := newScopedRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	mk := func(id string) {
		_ = os.MkdirAll(filepath.Join(dir, id), 0o755)
		_ = os.WriteFile(filepath.Join(dir, id, "plugin.yaml"), []byte("id: x\n"), 0o644)
	}
	// 1 plain os.Rename of dir into stage
	mk("a")
	_ = os.Mkdir(filepath.Join(dir, "stagea"), 0o700)
	t.Logf("D1 os.Rename a -> stagea/plugin: %v", os.Rename(filepath.Join(dir, "a"), filepath.Join(dir, "stagea", "plugin")))
	// 2 native rename, nothing open
	mk("b")
	stage, _ := r.MkdirTemp(".uninstall-b-")
	t.Logf("D2 native rename b -> stage/plugin: %v", r.RenameDirectoryNoReplace("b", filepath.Join(stage, "plugin")))
	// 3 native rename, sibling rename in same parent
	mk("c")
	t.Logf("D3 native rename c -> c2 (same parent): %v", r.RenameDirectoryNoReplace("c", "c2"))
	// 4 after DirectoryIdentity calls
	mk("d")
	_, e1 := r.DirectoryIdentity("d")
	stage4, _ := r.MkdirTemp(".uninstall-d-")
	_, e2 := r.DirectoryIdentity(stage4)
	t.Logf("D4 identity d: %v stage: %v rename: %v", e1, e2, r.RenameDirectoryNoReplace("d", filepath.Join(stage4, "plugin")))
	// 5 rename while a file inside is open for read via os.Open
	mk("e")
	f, _ := os.Open(filepath.Join(dir, "e", "plugin.yaml"))
	stage5, _ := r.MkdirTemp(".uninstall-e-")
	t.Logf("D5 native rename e (file open) : %v", r.RenameDirectoryNoReplace("e", filepath.Join(stage5, "plugin")))
	f.Close()
	// 6 native rename into stage opened by root.Open handle held
	mk("g")
	stage6, _ := r.MkdirTemp(".uninstall-g-")
	t.Logf("D6 os.Rename g -> stage6/plugin: %v", os.Rename(filepath.Join(dir, "g"), filepath.Join(dir, stage6, "plugin")))
	// 7 native rename of a dir that holds an open os.Root in a subdirectory
	mk("h")
	_ = os.MkdirAll(filepath.Join(dir, "h", "store"), 0o700)
	held, _ := os.OpenRoot(filepath.Join(dir, "h", "store"))
	stage7, _ := r.MkdirTemp(".uninstall-h-")
	t.Logf("D7 native rename h (root open in h/store): %v", r.RenameDirectoryNoReplace("h", filepath.Join(stage7, "plugin")))
	held.Close()
	// 8 os.Rename of a dir while a file inside is open via os.Open
	mk("i")
	f2, _ := os.Open(filepath.Join(dir, "i", "plugin.yaml"))
	t.Logf("D8 os.Rename i (file open): %v", os.Rename(filepath.Join(dir, "i"), filepath.Join(dir, "i2")))
	f2.Close()
}
