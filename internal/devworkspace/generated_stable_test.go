package devworkspace

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"golang.org/x/mod/modfile"
)

func TestStableNativeCapabilityPreservesAbsoluteReplacementAndAttestsChanges(t *testing.T) {
	w := generatedFixture(t)
	cap, err := prepareStableNativeTree(w, NewGeneration())
	if err != nil {
		t.Fatal(err)
	}
	replacement := filepath.Join(cap.Directory, "wails-v3-beta29-fixture")
	if err = os.Mkdir(replacement, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(cap.Directory, "host.mod")
	contents := []byte("module fixture.invalid/host\n\ngo 1.25\n\nreplace github.com/wailsapp/wails/v3 => " + strconv.Quote(replacement) + "\n")
	if err = os.WriteFile(path, contents, 0600); err != nil {
		t.Fatal(err)
	}
	if err = recordStableNativeTree(cap); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := modfile.Parse(path, data, nil)
	if err != nil || len(parsed.Replace) != 1 {
		t.Fatalf("invalid actual alternate module: %v", err)
	}
	if parsed.Replace[0].New.Path != replacement {
		t.Fatal("bootstrap replacement was rewritten to a nonexistent staging address")
	}
	if _, err = os.Stat(parsed.Replace[0].New.Path); err != nil {
		t.Fatalf("publication broke absolute replacement: %v", err)
	}
	next, err := prepareStableNativeTree(w, NewGeneration())
	if err != nil {
		t.Fatal(err)
	}
	if next.Directory != cap.Directory {
		t.Fatal("native cache address changed")
	}
	if err = os.WriteFile(filepath.Join(next.Directory, "host.sum"), []byte("controlled compiler sum output"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = recordStableNativeTree(next); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, []byte("foreign edit"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = prepareStableNativeTree(w, NewGeneration()); err == nil {
		t.Fatal("foreign native output edit was adopted")
	}
	if data, _ := os.ReadFile(path); string(data) != "foreign edit" {
		t.Fatal("foreign native output was changed")
	}
}
