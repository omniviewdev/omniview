package instance

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// What an erased database file leaves is overwritten before it is removed.
func TestOverwriteAndRemoveZeroesTheFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "residue")
	writeFile(t, path, strings.Repeat(sentinel, 100))
	alias := filepath.Join(dir, "alias")
	if err := os.Link(path, alias); err != nil {
		t.Skipf("no hard links here: %v", err)
	}
	if err := overwriteAndRemove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatalf("file left: %v", err)
	}
	data, err := os.ReadFile(alias)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) != 100*len(sentinel) || strings.Trim(string(data), "\x00") != "" {
		t.Fatal("the bytes were not overwritten with zeros")
	}
	if goneErr := overwriteAndRemove(path); goneErr != nil {
		t.Fatalf("a file that is already gone is not an error: %v", goneErr)
	}
}

// An unfinished staging holds the plain copy of the database, pages and all: it is
// overwritten before the next attempt removes it.
func TestAnUnfinishedStagingLosesItsPlainDatabaseCopy(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	source := t.TempDir()
	target := filepath.Join(t.TempDir(), "target")
	if err := WriteSwitchSeed(target, source); err != nil {
		t.Fatal(err)
	}
	staging := filepath.Join(target, ".switch-seed-staging")
	writeFile(t, filepath.Join(staging, "settings.db"), strings.Repeat(sentinel, 100))
	alias := filepath.Join(t.TempDir(), "alias")
	if err := os.Link(filepath.Join(staging, "settings.db"), alias); err != nil {
		t.Skipf("no hard links here: %v", err)
	}
	if err := ApplySwitchSeed(target); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(alias)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), sentinel) {
		t.Fatal("the unfinished staging's database copy was removed without being overwritten")
	}
}

// A staging an earlier build left, with a manifest that names what this build does
// not carry, installs only what this build carries.
func TestAResumedStagingInstallsOnlyWhatIsAllowed(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	source := t.TempDir()
	target := filepath.Join(t.TempDir(), "target")
	if err := WriteSwitchSeed(target, source); err != nil {
		t.Fatal(err)
	}
	staging := filepath.Join(target, ".switch-seed-staging")
	writeFile(t, filepath.Join(staging, "plugin_state.json"), "[]")
	writeFile(t, filepath.Join(staging, "logs", "ui.log"), sentinel)
	writeFile(t, filepath.Join(staging, "settings.gob.bak"), sentinel)
	writeFile(t, filepath.Join(staging, ".entries.json"), `["plugin_state.json","logs","settings.gob.bak"]`)
	if err := ApplySwitchSeed(target); err != nil {
		t.Fatal(err)
	}
	if got := files(t, target); strings.Join(got, "\n") != "plugin_state.json" {
		t.Fatalf("the new profile holds %v", got)
	}
}
