//go:build darwin || linux

package devworkspace

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devsession"
)

func feedbackShutdownChildren(t *testing.T, s *workspaceSupervisor) (*ownedChild, *ownedChild) {
	t.Helper()
	hostSource, err := s.workspace.RepositoryPath("omniview")
	if err != nil {
		t.Fatal(err)
	}
	children := map[string]*ownedChild{}
	for _, role := range []string{"host", "vite"} {
		child, err := startOwnedChild(context.Background(), hostSource, s.environment(), io.Discard, devsession.ProcessOwner{WorkspaceID: s.workspace.Manifest.WorkspaceID, Generation: s.generation, Role: role, Source: hostSource}, nil, "/bin/sleep", "300")
		if err != nil {
			t.Fatal(err)
		}
		stopTree := child.stopTree
		t.Cleanup(func() { child.stopTree = stopTree; _ = child.stop(context.Background()) })
		children[role] = child
	}
	s.children = children
	return children["host"], children["vite"]
}

func TestViteFeedbackUnfencedShutdownRetiresViteBeforeBackend(t *testing.T) {
	for _, refusal := range []bool{false, true} {
		t.Run(map[bool]string{false: "vite-retired", true: "vite-disposal-refused"}[refusal], func(t *testing.T) {
			_, s, _, path := feedbackWatchFixture(t)
			ctx := context.Background()
			change := WatchChange{Nodes: []string{"host-backend"}}
			if err := s.beginFeedback(ctx, change); err != nil {
				t.Fatal(err)
			}
			if err := s.commitFeedback(ctx, change); err != nil {
				t.Fatal(err)
			}
			host, vite := feedbackShutdownChildren(t, s)
			retained := s.feedback.file
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			runtime := filepath.Dir(path)
			if err := os.Chmod(runtime, 0755); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = os.Chmod(runtime, 0700) })
			// This is the POSIX consumer's actual leaf/context policy: directory
			// permissions alone do not stop it accepting released feedback.
			_, state, _, err := readFeedbackConsumer(s)
			if err != nil || state.Held == nil || *state.Held {
				t.Fatalf("fixture did not leave feedback enabled: %+v: %v", state, err)
			}
			unsafeBackendStop := make(chan struct{}, 1)
			stopHost := host.stopTree
			host.stopTree = func(force bool) error {
				_, state, _, readErr := readFeedbackConsumer(s)
				if readErr == nil && state.Held != nil && !*state.Held {
					select {
					case <-vite.done:
					default:
						select {
						case unsafeBackendStop <- struct{}{}:
						default:
						}
					}
				}
				return stopHost(force)
			}
			denied := errors.New("actual Vite group remains owned and alive")
			if refusal {
				vite.stopTree = func(bool) error { return denied }
			}
			stopErr := s.stopChildren(ctx)
			if stopErr == nil {
				t.Fatal("shutdown erased the feedback ownership-integrity failure")
			}
			select {
			case <-unsafeBackendStop:
				t.Error("actual backend disposal began with a live Vite process and released consumer state")
			default:
			}
			if refusal {
				if !errors.Is(stopErr, denied) {
					t.Errorf("Vite disposal refusal was lost: %v", stopErr)
				}
				select {
				case <-host.done:
					t.Error("backend was retired even though unfenced Vite could not be retired")
				default:
				}
				if _, err := retained.Stat(); err != nil || s.feedback.file != retained || s.children["host"] != host || s.ownedCleanupComplete {
					t.Errorf("unfenced Vite failure discarded backend/feedback ownership: %v", err)
				}
			} else {
				for _, child := range []*ownedChild{vite, host} {
					select {
					case <-child.done:
					default:
						t.Error("confirmed shutdown left an actual owned process running")
					}
				}
				if _, err := retained.Stat(); !errors.Is(err, os.ErrClosed) {
					t.Errorf("confirmed owned cleanup retained the actual feedback descriptor: %v", err)
				}
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Errorf("integrity cleanup repaired or overwrote rejected metadata: %q: %v", after, err)
			}
		})
	}
}

func assertFeedbackChildrenRetained(t *testing.T, s *workspaceSupervisor, retained *os.File, host, vite *ownedChild, stage string) {
	t.Helper()
	for _, child := range []*ownedChild{host, vite} {
		select {
		case <-child.done:
			t.Errorf("%s: actual owned %s exited without a durable feedback hold", stage, child.identity.Role)
		default:
		}
	}
	if _, err := retained.Stat(); err != nil || s.feedback.file != retained || s.children["host"] != host || s.children["vite"] != vite || s.ownedCleanupComplete {
		t.Errorf("%s: incomplete publication discarded actual feedback/process ownership: %v", stage, err)
	}
}

func TestViteFeedbackSyncFailureRetainsOwnerPublicationForDurableRetry(t *testing.T) {
	for _, publication := range []string{"shutdown-hold", "release"} {
		t.Run(publication, func(t *testing.T) {
			_, s, _, _ := feedbackWatchFixture(t)
			ctx := context.Background()
			change := WatchChange{Nodes: []string{"host-backend"}}
			if err := s.beginFeedback(ctx, change); err != nil {
				t.Fatal(err)
			}
			if publication == "shutdown-hold" {
				if err := s.commitFeedback(ctx, change); err != nil {
					t.Fatal(err)
				}
			}
			host, vite := feedbackShutdownChildren(t, s)
			retained := s.feedback.file
			syncFile := s.feedback.syncFile
			t.Cleanup(func() { s.feedback.syncFile = syncFile })
			syncFailure := errors.New("actual in-place publication could not be flushed")
			s.feedback.syncFile = func(*os.File) error { return syncFailure }
			if publication == "release" {
				if err := s.commitFeedback(ctx, change); !errors.Is(err, syncFailure) {
					t.Fatalf("release lost its real post-write flush failure: %v", err)
				}
				// Even an unsuccessful release must not leave valid false bytes
				// visible to a consumer while Go still owns a held obligation.
				assertFeedbackHeld(t, s, true, "failed release leaves consumer feedback held")
				assertFeedbackChildrenRetained(t, s, retained, host, vite, "failed release")
			} else {
				if err := s.stopChildren(ctx); !errors.Is(err, syncFailure) {
					t.Fatalf("hold lost its real post-write flush failure: %v", err)
				}
				// WriteAt and Truncate really changed the original inode before
				// the injected flush failure; this is not a mocked state echo.
				assertFeedbackHeld(t, s, true, "actual hold bytes written before failed flush")
				assertFeedbackChildrenRetained(t, s, retained, host, vite, "first failed hold")
			}
			if err := s.stopChildren(ctx); !errors.Is(err, syncFailure) {
				t.Errorf("owner-originated pending bytes became foreign/terminal metadata instead of retrying durable hold: %v", err)
			}
			assertFeedbackChildrenRetained(t, s, retained, host, vite, "retry while actual flush still fails")
			assertFeedbackHeld(t, s, true, "failed flush retry stays consumer-held")
			s.feedback.syncFile = syncFile
			if err := s.stopChildren(ctx); err != nil {
				t.Errorf("successful real flush could not discharge the retained publication: %v", err)
			}
			for _, child := range []*ownedChild{host, vite} {
				select {
				case <-child.done:
				default:
					t.Error("successful durable hold did not finish actual owned process cleanup")
				}
			}
			if _, err := retained.Stat(); !errors.Is(err, os.ErrClosed) {
				t.Errorf("successful durable retry did not close the original descriptor: %v", err)
			}
			assertFeedbackHeld(t, s, true, "confirmed cleanup leaves a durable held state")
		})
	}
}
