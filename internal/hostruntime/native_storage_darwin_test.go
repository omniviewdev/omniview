//go:build darwin && !server

package hostruntime

import (
	"testing"
	"time"
)

func TestNativeStorageCompletionNeverBlocksNativeMainQueue(t *testing.T) {
	token := uintptr(nativeStorageSequence.Add(1))
	started := make(chan struct{})
	release := make(chan struct{})
	defer close(release)
	nativeStorageCallbacks.Store(token, func(error) { close(started); <-release })
	returned := make(chan struct{})
	go func() { completeNativeStorage(token); close(returned) }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("completion was not delivered")
	}
	select {
	case <-returned:
	case <-time.After(time.Second):
		t.Fatal("native completion blocked behind Go shutdown callback")
	}
	// A late/duplicate callback must not invoke the consumed completion again.
	completeNativeStorage(token)
}
