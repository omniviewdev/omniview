//go:build darwin || linux

package devworkspace

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestViteFeedbackAuthorityRejectsFIFOWithoutWaitingForWriter(t *testing.T) {
	for _, operation := range []string{"state-read", "path-revalidation"} {
		t.Run(operation, func(t *testing.T) {
			_, s, _, path := feedbackWatchFixture(t)
			if err := s.beginFeedback(context.Background(), WatchChange{Nodes: []string{"host-backend"}}); err != nil {
				t.Fatal(err)
			}
			identity, err := feedbackFileIdentity(s.feedback.file)
			if err != nil {
				t.Fatal(err)
			}
			executable, err := canonicalFeedbackExecutable()
			if err != nil {
				t.Fatal(err)
			}
			config := s.feedback.context
			config.Authority = &viteFeedbackAuthority{Executable: executable, Identity: identity}
			encoded, err := json.Marshal(config)
			if err != nil {
				t.Fatal(err)
			}
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.Rename(path, path+".owned"); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = os.Remove(path); _ = os.Rename(path+".owned", path) })
			if err := unix.Mkfifo(path, 0600); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() {
				if operation == "path-revalidation" {
					done <- verifyFeedbackAuthorityPath(path, identity)
					return
				}
				held, err := ReadViteFeedbackContext(string(encoded))
				if !held {
					done <- fmt.Errorf("FIFO yielded released authority: %v", err)
					return
				}
				done <- err
			}()
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("authority accepted a FIFO in place of its private regular inode")
				}
			case <-time.After(time.Second):
				// Unblock the real FIFO open so the failing baseline leaves no
				// reader goroutine behind. This is not the behavior under test.
				peer, err := os.OpenFile(path, os.O_RDWR|unix.O_NONBLOCK, 0)
				if err != nil {
					t.Fatal(err)
				}
				defer peer.Close()
				<-done
				t.Fatal("authority blocked on an actual FIFO with no writer")
			}
			info, err := os.Lstat(path)
			if err != nil || info.Mode()&os.ModeNamedPipe == 0 {
				t.Fatalf("authority changed foreign FIFO metadata: %v", err)
			}
			after, err := os.ReadFile(path + ".owned")
			if err != nil || !bytes.Equal(after, original) {
				t.Fatalf("authority changed the retained original file: %q: %v", after, err)
			}
		})
	}
}
