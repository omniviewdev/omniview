package appstate

import (
	"os"
	"runtime"
	"strings"
	"testing"
)

func TestQuarantineKeepsModeAndNeverOverwrites(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows reports mode 0666 for a writable file: Unix permission bits")
	}
	root, err := newScopedRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	var names []string
	for _, content := range []string{"one", "two", "three"} {
		if err := root.WriteFile("state.json", []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
		moved, err := root.Quarantine("state.json")
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(moved, "state.json.invalid.") || !IsQuarantineName(moved) {
			t.Fatalf("unexpected quarantine name %q", moved)
		}
		if _, err := root.Stat("state.json"); !os.IsNotExist(err) {
			t.Fatal("original still present")
		}
		names = append(names, moved)
	}
	for i, content := range []string{"one", "two", "three"} {
		data, err := root.ReadFile(names[i])
		if err != nil || string(data) != content {
			t.Fatalf("%s: %q, %v", names[i], data, err)
		}
		info, err := root.Stat(names[i])
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatalf("%s mode: %v, %v", names[i], info, err)
		}
	}
}

func TestQuarantineMissingFileFails(t *testing.T) {
	root, err := newScopedRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if _, err := root.Quarantine("absent.json"); err == nil {
		t.Fatal("quarantining a missing file succeeded")
	}
	if IsQuarantineName("activities.json") || !IsQuarantineName("a.json.invalid.1700000000.2") {
		t.Fatal("IsQuarantineName misclassifies")
	}
}
