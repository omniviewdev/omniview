//go:build !windows

package devworkspace

import (
	"context"
	"io"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestHashUntrackedFIFODoesNotOpenPipe(t *testing.T) {
	root := t.TempDir()
	if err := syscall.Mkfifo(filepath.Join(root, "pipe"), 0600); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		done <- hashUntrackedPath(context.Background(), io.Discard, root, "pipe")
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("untracked FIFO blocked checkout inspection")
	}
}
