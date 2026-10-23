//go:build darwin || linux

package main

import (
	"fmt"
	"os"
	"testing"

	"golang.org/x/sys/unix"
)

func authorityFixtureIdentity(t *testing.T, file *os.File) map[string]string {
	t.Helper()
	var stat unix.Stat_t
	if err := unix.Fstat(int(file.Fd()), &stat); err != nil {
		t.Fatal(err)
	}
	return map[string]string{"volume": fmt.Sprint(uint64(stat.Dev)), "fileID": fmt.Sprintf("%032x", stat.Ino)}
}

func authorityFixturePublicPermissions(t *testing.T, path string) {
	t.Helper()
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
}
