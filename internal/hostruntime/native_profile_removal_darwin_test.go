//go:build darwin && !server

package hostruntime

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestInheritedNativeGuardRetainsParentLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "guard")
	parent, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer parent.Close()
	if err := unix.Flock(int(parent.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	defer unix.Flock(int(parent.Fd()), unix.LOCK_UN)
	duplicate, err := unix.Dup(int(parent.Fd()))
	if err != nil {
		t.Fatal(err)
	}
	child, err := retainInheritedNativeGuard(duplicate, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := child.Close(); err != nil {
		t.Fatal(err)
	}
	contender, err := os.OpenFile(path, os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer contender.Close()
	if err := unix.Flock(int(contender.Fd()), unix.LOCK_EX|unix.LOCK_NB); !errors.Is(err, unix.EWOULDBLOCK) {
		t.Fatalf("parent lock released by inherited close: %v", err)
	}
}

func TestInheritedNativeGuardRejectsForeignInodeAndIndependentHeldLock(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "guard")
	parent, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer parent.Close()
	if err := unix.Flock(int(parent.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	defer unix.Flock(int(parent.Fd()), unix.LOCK_UN)
	independent, err := unix.Open(path, unix.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if file, err := retainInheritedNativeGuard(independent, path); err == nil {
		file.Close()
		t.Fatal("independent descriptor bypassed held lock")
	}
	foreign := filepath.Join(root, "foreign")
	foreignFD, err := unix.Open(foreign, unix.O_CREAT|unix.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if file, err := retainInheritedNativeGuard(foreignFD, path); err == nil {
		file.Close()
		t.Fatal("foreign inode accepted")
	}
}

func TestNativeRemovalRejectsRedirectedDefaultStateBeforeLockCreation(t *testing.T) {
	home := t.TempDir()
	id := "d7a1e535-613b-462d-bcaa-5c1aacdff121"
	profile := filepath.Join(home, ".omniview-dev", "profiles", id)
	if err := os.MkdirAll(profile, 0700); err != nil {
		t.Fatal(err)
	}
	foreign := t.TempDir()
	if err := os.Symlink(foreign, filepath.Join(profile, "state")); err != nil {
		t.Fatal(err)
	}
	unlock, err := nativeRemovalStateGuards(home, id, foreign, nil)
	if err == nil {
		unlock()
		t.Fatal("redirected default state accepted")
	}
	if _, err := os.Lstat(filepath.Join(foreign, ".lock")); !os.IsNotExist(err) {
		t.Fatalf("foreign state touched before refusal: %v", err)
	}
}
