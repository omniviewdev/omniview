//go:build !linux && !darwin && !windows

package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestChannelDeletionUnavailable(t *testing.T) {
	path := t.TempDir()
	file := filepath.Join(path, "keep")
	if err := os.WriteFile(file, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := deleteInactiveProfile(path, info); err == nil {
		t.Fatal("deletion unexpectedly supported")
	}
	if _, err := os.Stat(file); err != nil {
		t.Fatal(err)
	}
	if status := profileLockStatus(path); status != "unknown" {
		t.Fatalf("lock status = %q", status)
	}
}
