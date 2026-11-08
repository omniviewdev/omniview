package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIncrementPersistsAndReadsBack(t *testing.T) {
	path := filepath.Join(t.TempDir(), "counter")
	for _, want := range []string{"1", "2", "3"} {
		file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
		if err != nil {
			t.Fatal(err)
		}
		got, err := increment(file)
		closeErr := file.Close()
		if err != nil {
			t.Fatal(err)
		}
		if closeErr != nil {
			t.Fatal(closeErr)
		}
		if got != want {
			t.Fatalf("counter = %q, want %q", got, want)
		}
	}
}

func TestIncrementRejectsCorruptState(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "counter")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := file.WriteAt([]byte("not a counter"), 0); err != nil {
		t.Fatal(err)
	}
	if _, err := increment(file); err == nil {
		t.Fatal("corrupt state accepted")
	}
}
