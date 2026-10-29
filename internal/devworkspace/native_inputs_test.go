package devworkspace

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

// Exercise the watch transaction's host consumer, not just affected's node list.
// A refusal at the host boundary proves selection without inventing a successful
// native build or readiness observation.
func TestNativeContentChangesReachOwnedHostRebuild(t *testing.T) {
	for _, extension := range []string{".go", ".c", ".h", ".m", ".mm", ".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx", ".f", ".F", ".for", ".f90", ".s", ".S", ".sx", ".swig", ".swigcxx", ".syso"} {
		t.Run(extension, func(t *testing.T) {
			g, _, hooks, _ := feedbackWatchFixture(t)
			path := filepath.Join(g.workspace.Root, "host", "internal", "native", "bridge"+extension)
			// Keep the failed transaction's graph for the next source mutation.
			// Each step must retry the host with the latest source state.
			for _, operation := range []string{"add", "edit", "remove"} {
				want := operation + " native input\n"
				if operation == "remove" {
					if err := os.Remove(path); err != nil {
						t.Fatal(err)
					}
				} else {
					writeGraphFixture(t, path, want)
				}
				refused := errors.New("native host consumer refused publication")
				calls := 0
				hooks.HostRebuildAndWait = func(context.Context, HostBuildRequest) (map[string]bool, error) {
					calls++
					raw, err := os.ReadFile(path)
					if operation == "remove" {
						if !os.IsNotExist(err) {
							t.Fatalf("host did not consume removal: %v", err)
						}
					} else if err != nil || string(raw) != want {
						t.Fatalf("host consumed stale input: %q, %v", raw, err)
					}
					return nil, refused
				}
				if err := g.rebuildChange(context.Background(), []string{path}, hooks); !errors.Is(err, refused) {
					t.Fatalf("native %s did not reach refusing host consumer: %v", operation, err)
				}
				if calls != 1 {
					t.Fatalf("host consumer called %d times", calls)
				}
			}
		})
	}
}

func TestLiveFrontendContentChangesDoNotReplaceHost(t *testing.T) {
	for _, extension := range []string{".js", ".tsx", ".css"} {
		t.Run(extension, func(t *testing.T) {
			g, _, hooks, _ := feedbackWatchFixture(t)
			path := filepath.Join(g.workspace.Root, "host", "ui", "native-control"+extension)
			writeGraphFixture(t, path, "changed frontend input\n")
			hooks.HostRebuildAndWait = func(context.Context, HostBuildRequest) (map[string]bool, error) {
				t.Error("live frontend change reached native host replacement")
				return nil, errors.New("unexpected native build")
			}
			if err := g.rebuildChange(context.Background(), []string{path}, hooks); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestNativeContentInvalidatesBootstrapReuseButTimestampDoesNot(t *testing.T) {
	for _, extension := range []string{".c", ".h", ".m", ".mm", ".s", ".S"} {
		t.Run(extension, func(t *testing.T) {
			f := newReuseFixture(t)
			path := filepath.Join(f.g.workspace.Root, "host", "internal", "native", "bridge"+extension)
			writeGraphFixture(t, path, "original native input\n")
			fixtureGit(t, filepath.Join(f.g.workspace.Root, "host"), "add", "internal/native")
			fixtureGit(t, filepath.Join(f.g.workspace.Root, "host"), "commit", "-m", "native input")
			f.bootstrap(t)
			stamp := time.Unix(1234567890, 0)
			if err := os.Chtimes(path, stamp, stamp); err != nil {
				t.Fatal(err)
			}
			if built := f.bootstrap(t); len(built) != 0 {
				t.Fatalf("timestamp-only change invalidated content reuse: %v", built)
			}
			for _, operation := range []string{"edit", "remove", "add"} {
				if operation == "remove" {
					if err := os.Remove(path); err != nil {
						t.Fatal(err)
					}
				} else {
					writeGraphFixture(t, path, operation+" native input\n")
				}
				if built := f.bootstrap(t); !slices.Contains(built, "bindings") {
					t.Fatalf("native %s reused stale Go producer: %v", operation, built)
				}
				if built := f.bootstrap(t); len(built) != 0 {
					t.Fatalf("unchanged native %s rebuilt: %v", operation, built)
				}
			}
		})
	}
}
