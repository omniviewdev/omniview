package instance

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestApplySwitchSeed(t *testing.T) {
	source := t.TempDir()
	target := filepath.Join(t.TempDir(), "target")
	if err := os.Mkdir(filepath.Join(source, "settings"), 0751); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "settings", "prefs"), []byte("prefs"), 0640); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("settings/prefs", filepath.Join(source, "link")); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"runtime", SwitchSeedFile, "update-checkpoints.json", "update-checkpoints.lock"} {
		if err := os.WriteFile(filepath.Join(source, name), []byte("excluded"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := WriteSwitchSeed(target, source); err != nil {
		t.Fatal(err)
	}
	staging := filepath.Join(target, ".switch-seed-staging")
	if err := os.Mkdir(staging, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(staging, "stale"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	if err := ApplySwitchSeed(target); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(target, "settings", "prefs"))
	if err != nil || string(data) != "prefs" {
		t.Fatalf("copied contents %q: %v", data, err)
	}
	for path, mode := range map[string]os.FileMode{"settings": 0751, "settings/prefs": 0640} {
		info, err := os.Stat(filepath.Join(target, path))
		if err != nil || info.Mode().Perm() != mode {
			t.Fatalf("mode for %s: %v %v", path, info, err)
		}
	}
	link, err := os.Readlink(filepath.Join(target, "link"))
	if err != nil || link != "settings/prefs" {
		t.Fatalf("link %q: %v", link, err)
	}
	for _, name := range []string{"runtime", SwitchSeedFile, "update-checkpoints.json", "update-checkpoints.lock", ".switch-seed-staging"} {
		if _, err := os.Lstat(filepath.Join(target, name)); !os.IsNotExist(err) {
			t.Errorf("%s should be absent: %v", name, err)
		}
	}
	if err := ApplySwitchSeed(target); err != nil {
		t.Fatal(err)
	}
}

func TestApplySwitchSeedOverlapAndRetry(t *testing.T) {
	source := t.TempDir()
	target := filepath.Join(source, "target")
	if err := WriteSwitchSeed(target, source); err != nil {
		t.Fatal(err)
	}
	if err := ApplySwitchSeed(target); err == nil {
		t.Fatal("accepted overlapping roots")
	}
	if _, err := os.Stat(filepath.Join(target, SwitchSeedFile)); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(target); err != nil {
		t.Fatal(err)
	}
	other := t.TempDir()
	if err := WriteSwitchSeed(target, other); err != nil {
		t.Fatal(err)
	}
	if err := ApplySwitchSeed(target); err != nil {
		t.Fatal(err)
	}
}

func TestApplySwitchSeedRetriesMissingSource(t *testing.T) {
	base := t.TempDir()
	source := filepath.Join(base, "source")
	target := filepath.Join(base, "target")
	if err := WriteSwitchSeed(target, source); err != nil {
		t.Fatal(err)
	}
	if err := ApplySwitchSeed(target); err == nil {
		t.Fatal("accepted missing source")
	}
	if _, err := os.Stat(filepath.Join(target, SwitchSeedFile)); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(source, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "data"), []byte("ok"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := ApplySwitchSeed(target); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(target, "data")); err != nil || string(data) != "ok" {
		t.Fatalf("retry data %q: %v", data, err)
	}
}

func TestSwitchSeedPartialInstallRetry(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	source := t.TempDir()
	target := filepath.Join(t.TempDir(), "target")
	for _, name := range []string{"a", "b"} {
		if err := os.Mkdir(filepath.Join(source, name), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(source, name, "data"), []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := WriteSwitchSeed(target, source); err != nil {
		t.Fatal(err)
	}
	staging := filepath.Join(target, ".switch-seed-staging")
	if err := os.Mkdir(staging, 0700); err != nil {
		t.Fatal(err)
	}
	if err := copySwitchEntry(filepath.Join(source, "a"), filepath.Join(target, "a")); err != nil {
		t.Fatal(err)
	}
	if err := copySwitchEntry(filepath.Join(source, "b"), filepath.Join(staging, "b")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(staging, ".entries.json"), []byte(`["a","b"]`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "b"), []byte("existing"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := ApplySwitchSeed(target); err == nil {
		t.Fatal("overwrote existing entry")
	}
	if err := os.Remove(filepath.Join(target, "b")); err != nil {
		t.Fatal(err)
	}
	if err := ApplySwitchSeed(target); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"a", "b"} {
		data, err := os.ReadFile(filepath.Join(target, name, "data"))
		if err != nil || string(data) != name {
			t.Fatalf("entry %s: %q: %v", name, data, err)
		}
	}
}

func TestSwitchSeedOwnership(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	root := filepath.Join(t.TempDir(), "target")
	release, err := LockSwitchProfile(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := LockSwitchProfile(context.Background(), root); err == nil {
		t.Fatal("second owner acquired guard")
	}
	if err := release(); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := WriteSwitchSeed(root, t.TempDir()); err == nil {
		t.Fatal("published seed into existing profile")
	}
}

func TestSwitchSeedRejectsInitializedTarget(t *testing.T) {
	source := t.TempDir()
	target := filepath.Join(t.TempDir(), "target")
	if err := WriteSwitchSeed(target, source); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(target, "settings.db")
	if err := os.WriteFile(path, []byte("existing"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := ApplySwitchSeed(target); err == nil {
		t.Fatal("accepted initialized target")
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != "existing" {
		t.Fatalf("target changed: %q: %v", data, err)
	}
}
