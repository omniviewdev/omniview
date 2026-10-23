package devworkspace

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStableHostModCapabilityRefusesChangedOutputsWithoutRepair(t *testing.T) {
	w := generatedFixture(t)
	prepared, err := prepareStableHostModTree(w, NewGeneration())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(prepared.Directory, "host.mod")
	if err := os.WriteFile(path, []byte("module fixture.invalid/host\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := recordStableHostModTree(prepared); err != nil {
		t.Fatal(err)
	}
	next, err := prepareStableHostModTree(w, NewGeneration())
	if err != nil {
		t.Fatal(err)
	}
	if next.Directory != prepared.Directory {
		t.Fatal("stable module address changed")
	}
	if err := os.WriteFile(filepath.Join(next.Directory, "host.sum"), []byte("controlled compiler sum output"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := recordStableHostModTree(next); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("foreign edit"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := prepareStableHostModTree(w, NewGeneration()); err == nil {
		t.Fatal("foreign output edit was adopted")
	}
	if data, _ := os.ReadFile(path); string(data) != "foreign edit" {
		t.Fatal("foreign output was changed")
	}
}
