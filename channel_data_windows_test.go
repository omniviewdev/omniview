package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gofrs/flock"
)

func TestWindowsDeleteRejectsActiveProfile(t *testing.T) {
	root := t.TempDir()
	lock := flock.New(filepath.Join(root, ".lock"))
	ok, err := lock.TryLock()
	if err != nil || !ok {
		t.Fatalf("acquire profile lock: %v", err)
	}
	defer lock.Unlock()
	data := filepath.Join(root, "data")
	if err := os.WriteFile(data, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(root)
	if err != nil {
		t.Fatal(err)
	}
	if status := profileLockStatus(root); status != "unknown" {
		t.Fatalf("profile status = %q", status)
	}
	if err := deleteInactiveProfile(root, info); err == nil {
		t.Fatal("deleted active profile")
	}
	if _, err := os.Stat(data); err != nil {
		t.Fatal(err)
	}
}

func TestWindowsDeleteReportsQuarantineOnCleanupFailure(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "profile")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "data"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(root)
	if err != nil {
		t.Fatal(err)
	}
	var isolated string
	err = deleteInactiveProfileWithRemove(root, info, func(path string) error {
		isolated = path
		return errors.New("cleanup denied")
	})
	if err == nil || isolated == "" || !strings.Contains(err.Error(), isolated) || !strings.Contains(err.Error(), "cleanup denied") {
		t.Fatalf("cleanup error = %v, isolated = %q", err, isolated)
	}
	if _, err := os.Stat(filepath.Join(isolated, "data")); err != nil {
		t.Fatal(err)
	}
}

func TestWindowsDeleteRejectsReplacedProfile(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "profile")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	info, err := captureProfileIdentity(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(root, filepath.Join(parent, "original")); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(root, "replacement-data")
	if err := os.WriteFile(data, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := deleteInactiveProfile(root, info); err == nil {
		t.Fatal("accepted replacement")
	}
	if _, err := os.Stat(data); err != nil {
		t.Fatalf("replacement data was removed: %v", err)
	}
}

func TestWindowsDeleteInactiveProfile(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "profile")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "data"), []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Lstat(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := deleteInactiveProfile(root, info); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(root); !os.IsNotExist(err) {
		t.Fatalf("profile remains: %v", err)
	}
}
