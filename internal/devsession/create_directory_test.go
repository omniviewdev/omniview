package devsession

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestCreatePrivateDirectoryAtProtectsNewLeafAndRetainsExistingObject(t *testing.T) {
	root, err := EnsurePrivateDirectory(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	parent, err := os.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer parent.Close()
	child, err := CreatePrivateDirectoryAt(parent, "new-cache")
	if err != nil {
		t.Fatal(err)
	}
	defer child.Close()
	before, err := child.Stat()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "new-cache")
	if err = ValidatePrivateDirectory(path); err != nil {
		t.Fatal("created leaf is not private", err)
	}
	marker := filepath.Join(path, "retained")
	if err = WritePrivateFile(marker, []byte("retained bytes")); err != nil {
		t.Fatal(err)
	}
	duplicate, err := CreatePrivateDirectoryAt(parent, "new-cache")
	if duplicate != nil {
		duplicate.Close()
		t.Fatal("existing object returned as a new directory")
	}
	if !os.IsExist(err) {
		t.Fatalf("existing child was not refused: %v", err)
	}
	after, err := os.Stat(path)
	if err != nil || !os.SameFile(before, after) {
		t.Fatal("existing object was replaced", err)
	}
	raw, err := os.ReadFile(marker)
	if err != nil || string(raw) != "retained bytes" {
		t.Fatal("existing bytes changed", err)
	}
}

func TestCreatePrivateDirectoryAtRejectsNonLeafNames(t *testing.T) {
	root := t.TempDir()
	parent, err := os.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer parent.Close()
	for _, name := range []string{"", ".", "..", "a/b", "a\\b", "stream:other"} {
		file, err := CreatePrivateDirectoryAt(parent, name)
		if file != nil {
			file.Close()
			t.Fatalf("invalid name created a directory: %q", name)
		}
		if !errors.Is(err, ErrOwnership) {
			t.Fatalf("invalid name was not refused: %q %v", name, err)
		}
	}
	entries, err := os.ReadDir(root)
	if err != nil || len(entries) != 0 {
		t.Fatal("invalid name created filesystem state", err)
	}
}
