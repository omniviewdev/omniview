package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gofrs/flock"
	"github.com/omniviewdev/omniview/internal/instance"
	"golang.org/x/sys/windows"
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

func TestWindowsDeleteWithPinnedProfileIdentity(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "profile")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "data"), []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	handle, err := openProfileIdentity(root)
	if err != nil {
		t.Fatal(err)
	}
	defer handle.Close()
	info, err := handle.Stat()
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

func TestWindowsDeleteRejectsOpenDescendant(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "profile")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(root, "data")
	if err := os.WriteFile(data, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	name, err := windows.UTF16PtrFromString(data)
	if err != nil {
		t.Fatal(err)
	}
	handle, err := windows.CreateFile(name, windows.GENERIC_READ,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(handle)
	info, err := captureProfileIdentity(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := deleteInactiveProfile(root, info); err == nil {
		t.Fatal("deleted profile with an open descendant")
	}
	contents, err := os.ReadFile(data)
	if err != nil || string(contents) != "keep" {
		t.Fatalf("profile data changed: %q, %v", contents, err)
	}
}

func TestWindowsDeleteChannelDataDiscoveryAndGuard(t *testing.T) {
	home := t.TempDir()
	t.Setenv("USERPROFILE", home)
	root := filepath.Join(home, ".omniview")
	target := filepath.Join(home, ".omniview-nightly")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(target, 0700); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(target, "data")
	if err := os.WriteFile(data, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	s := &UpdateService{channel: "stable", root: root}
	defer s.ServiceShutdown()
	var identity string
	for _, option := range s.ListChannels().Options {
		if option.Channel == "nightly" {
			identity = option.StateIdentity
		}
	}
	if identity == "" {
		t.Fatal("missing discovered identity")
	}
	release, err := instance.LockSwitchProfile(context.Background(), target)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteChannelData("nightly", identity); err == nil {
		_ = release()
		t.Fatal("deleted profile while its guard was held")
	}
	if err := release(); err != nil {
		t.Fatal(err)
	}
	if contents, err := os.ReadFile(data); err != nil || string(contents) != "keep" {
		t.Fatalf("guarded profile data changed: %q, %v", contents, err)
	}
	if err := s.DeleteChannelData("nightly", identity); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(target); !os.IsNotExist(err) {
		t.Fatalf("profile remains: %v", err)
	}
}
