package instance

import (
	"os"
	"path/filepath"
	"testing"
)

func TestApplySwitchSeed(t *testing.T) {
	source := t.TempDir()
	target := filepath.Join(t.TempDir(), "target")
	if err := os.Mkdir(filepath.Join(source, "settings"), 0751); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(source, "settings", "prefs"), []byte("prefs"), 0640); err != nil { t.Fatal(err) }
	if err := os.Symlink("settings/prefs", filepath.Join(source, "link")); err != nil { t.Fatal(err) }
	for _, name := range []string{"runtime", SwitchSeedFile, "update-checkpoints.json", "update-checkpoints.lock"} {
		if err := os.WriteFile(filepath.Join(source, name), []byte("excluded"), 0600); err != nil { t.Fatal(err) }
	}
	if err := WriteSwitchSeed(target, source); err != nil { t.Fatal(err) }
	staging := filepath.Join(target, ".switch-seed-staging")
	if err := os.Mkdir(staging, 0700); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(staging, "stale"), nil, 0600); err != nil { t.Fatal(err) }
	if err := ApplySwitchSeed(target); err != nil { t.Fatal(err) }
	data, err := os.ReadFile(filepath.Join(target, "settings", "prefs"))
	if err != nil || string(data) != "prefs" { t.Fatalf("copied contents %q: %v", data, err) }
	for path, mode := range map[string]os.FileMode{"settings": 0751, "settings/prefs": 0640} {
		info, err := os.Stat(filepath.Join(target, path))
		if err != nil || info.Mode().Perm() != mode { t.Fatalf("mode for %s: %v %v", path, info, err) }
	}
	link, err := os.Readlink(filepath.Join(target, "link"))
	if err != nil || link != "settings/prefs" { t.Fatalf("link %q: %v", link, err) }
	for _, name := range []string{"runtime", SwitchSeedFile, "update-checkpoints.json", "update-checkpoints.lock", ".switch-seed-staging"} {
		if _, err := os.Lstat(filepath.Join(target, name)); !os.IsNotExist(err) { t.Errorf("%s should be absent: %v", name, err) }
	}
	if err := ApplySwitchSeed(target); err != nil { t.Fatal(err) }
}

func TestApplySwitchSeedOverlapAndRetry(t *testing.T) {
	source := t.TempDir()
	target := filepath.Join(source, "target")
	if err := WriteSwitchSeed(target, source); err != nil { t.Fatal(err) }
	if err := ApplySwitchSeed(target); err == nil { t.Fatal("accepted overlapping roots") }
	if _, err := os.Stat(filepath.Join(target, SwitchSeedFile)); err != nil { t.Fatal(err) }
	other := t.TempDir()
	if err := WriteSwitchSeed(target, other); err != nil { t.Fatal(err) }
	if err := ApplySwitchSeed(target); err != nil { t.Fatal(err) }
}

func TestApplySwitchSeedRetriesMissingSource(t *testing.T) {
	base := t.TempDir()
	source := filepath.Join(base, "source")
	target := filepath.Join(base, "target")
	if err := WriteSwitchSeed(target, source); err != nil { t.Fatal(err) }
	if err := ApplySwitchSeed(target); err == nil { t.Fatal("accepted missing source") }
	if _, err := os.Stat(filepath.Join(target, SwitchSeedFile)); err != nil { t.Fatal(err) }
	if err := os.Mkdir(source, 0700); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(source, "data"), []byte("ok"), 0600); err != nil { t.Fatal(err) }
	if err := ApplySwitchSeed(target); err != nil { t.Fatal(err) }
	if data, err := os.ReadFile(filepath.Join(target, "data")); err != nil || string(data) != "ok" { t.Fatalf("retry data %q: %v", data, err) }
}
