//go:build linux || darwin

package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/gofrs/flock"
)

func TestDeleteChannelData(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	root := filepath.Join(home, ".omniview")
	target := filepath.Join(home, ".omniview-nightly")
	if err := os.Mkdir(root, 0700); err != nil { t.Fatal(err) }
	if err := os.Mkdir(target, 0700); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(target, "data"), []byte("data"), 0600); err != nil { t.Fatal(err) }
	s := &UpdateService{channel: "stable", root: root}
	if err := s.DeleteChannelData("../nightly"); err == nil { t.Fatal("accepted invalid channel") }
	if err := s.DeleteChannelData("stable"); err == nil { t.Fatal("deleted current channel") }
	s.switchTarget = "nightly"
	if err := s.DeleteChannelData("nightly"); err == nil { t.Fatal("deleted pending switch target") }
	s.switchTarget = ""
	lock := flock.New(filepath.Join(target, ".lock"))
	ok, err := lock.TryLock()
	if err != nil || !ok { t.Fatalf("lock profile: %v", err) }
	if err := s.DeleteChannelData("nightly"); err == nil { t.Fatal("deleted live profile") }
	if _, err := os.Stat(filepath.Join(target, "data")); err != nil { t.Fatal(err) }
	if err := lock.Unlock(); err != nil { t.Fatal(err) }
	if err := s.DeleteChannelData("nightly"); err != nil { t.Fatal(err) }
	if _, err := os.Lstat(target); !os.IsNotExist(err) { t.Fatalf("profile remains: %v", err) }
}

func TestDeleteChannelDataRejectsSymlinkAndOverlap(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	target := filepath.Join(home, ".omniview-nightly")
	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "keep"), []byte("keep"), 0600); err != nil { t.Fatal(err) }
	if err := os.Symlink(outside, target); err != nil { t.Fatal(err) }
	s := &UpdateService{channel: "stable", root: filepath.Join(home, ".omniview")}
	if err := s.DeleteChannelData("nightly"); err == nil { t.Fatal("accepted symlink") }
	if _, err := os.Stat(filepath.Join(outside, "keep")); err != nil { t.Fatal(err) }
	if err := os.Remove(target); err != nil { t.Fatal(err) }
	if err := os.Mkdir(target, 0700); err != nil { t.Fatal(err) }
	s.root = filepath.Join(target, "custom")
	if err := s.DeleteChannelData("nightly"); err == nil { t.Fatal("deleted overlapping profile") }
}

func TestDeleteInactiveProfileRejectsReplacement(t *testing.T) {
	parent := t.TempDir()
	path := filepath.Join(parent, "profile")
	if err := os.Mkdir(path, 0700); err != nil { t.Fatal(err) }
	info, err := os.Lstat(path)
	if err != nil { t.Fatal(err) }
	if err := os.Rename(path, filepath.Join(parent, "old")); err != nil { t.Fatal(err) }
	if err := os.Mkdir(path, 0700); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(path, "keep"), []byte("keep"), 0600); err != nil { t.Fatal(err) }
	if err := deleteInactiveProfile(path, info); err == nil { t.Fatal("accepted replacement") }
	if _, err := os.Stat(filepath.Join(path, "keep")); err != nil { t.Fatal(err) }
}

func TestDeleteChannelDataRejectsLockSymlink(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	target := filepath.Join(home, ".omniview-nightly")
	if err := os.Mkdir(target, 0700); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "lock")
	if err := os.WriteFile(outside, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(target, ".lock")); err != nil {
		t.Fatal(err)
	}
	s := &UpdateService{channel: "stable", root: filepath.Join(home, ".omniview")}
	if err := s.DeleteChannelData("nightly"); err == nil {
		t.Fatal("accepted symlink lock")
	}
	if data, err := os.ReadFile(outside); err != nil || string(data) != "keep" {
		t.Fatalf("outside file changed: %q, %v", data, err)
	}
}
