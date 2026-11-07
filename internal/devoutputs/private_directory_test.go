package devoutputs

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestPrivateOutputDirectoryCreationRefusesExistingBoundary(t *testing.T) {
	root := privateOutputFixtureDirectory(t)
	parentIdentity, err := directoryIdentity(root)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "cache")
	if err = createPrivateOutputDirectory(path, parentIdentity); err != nil {
		t.Fatal(err)
	}
	if err = devsession.ValidatePrivateDirectory(path); err != nil {
		t.Fatal(err)
	}
	before, err := observeSnapshotPath(path)
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(path, "foreign-bytes")
	writeOutput(t, marker, "preserve exactly")
	if err = createPrivateOutputDirectory(path, parentIdentity); !os.IsExist(err) {
		t.Fatalf("existing root was not refused: %v", err)
	}
	after, err := observeSnapshotPath(path)
	if err != nil || !os.SameFile(before, after) {
		t.Fatal("existing root identity changed", err)
	}
	raw, err := os.ReadFile(marker)
	if err != nil || string(raw) != "preserve exactly" {
		t.Fatal("existing bytes changed", err)
	}
}
