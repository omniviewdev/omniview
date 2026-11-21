package instance

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// The settings store logs a scrub that fails and still opens: only the marker, which
// the rebuilt file lacks, tells that the staged database was not rebuilt. A database
// that still holds the pages of deleted values must not be carried on that account.
func TestAStagedDatabaseThatCouldNotBeRebuiltIsNotCarried(t *testing.T) {
	if runtime.GOOS == "windows" || os.Geteuid() == 0 {
		t.Skip("needs a directory this user cannot write to")
	}
	staging := t.TempDir()
	dst := filepath.Join(staging, "settings.db")
	plantDatabase(t, dst)
	if err := markScrubOwed(dst); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(staging, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(staging, 0o700) })

	staged, err := scrubStagedDatabase(staging, dst)
	if err == nil || staged {
		t.Fatalf("a database that could not be rebuilt was accepted: staged %v, error %v", staged, err)
	}
}
