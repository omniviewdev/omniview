package devworkspace

import (
	"context"
	"errors"
	"os"
	"path/filepath"
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
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	binary, err := os.ReadFile(executable)
	if err != nil {
		t.Fatal(err)
	}
	for _, extension := range []string{".c", ".h", ".m", ".mm", ".s", ".S"} {
		for _, operation := range []string{"add", "edit", "remove"} {
			t.Run(extension+"/"+operation, func(t *testing.T) {
				g, node, supervisor, published := newHostReuseFixture(t, binary)
				path := filepath.Join(g.workspace.Root, "host", "internal", "native", "bridge"+extension)
				if operation != "add" {
					writeGraphFixture(t, path, "original native input\n")
					fixtureGit(t, node.Directory, "add", "internal/native")
					fixtureGit(t, node.Directory, "commit", "-m", "native input")
				}
				ctx := context.Background()
				inputs, err := g.nodeInputs(ctx, node)
				if err != nil {
					t.Fatal(err)
				}
				outputs, err := g.outputDigest(ctx, node)
				if err != nil {
					t.Fatal(err)
				}
				if err = g.setBuildReuse(g.loadBuildReuse(), node.ID, buildReuseRecord{Inputs: inputs, Outputs: outputs}); err != nil {
					t.Fatal(err)
				}
				refused := errors.New("native host producer refused compilation")
				calls := 0
				g.options.HostBuild = func(context.Context, HostBuildRequest) error {
					calls++
					raw, err := os.ReadFile(path)
					if operation == "remove" {
						if !os.IsNotExist(err) {
							t.Fatalf("host producer did not see removal: %v", err)
						}
					} else if err != nil || string(raw) != operation+" native input\n" {
						t.Fatalf("host producer saw stale source: %q, %v", raw, err)
					}
					return refused
				}
				if operation != "add" {
					stamp := time.Unix(1234567890, 0)
					if err = os.Chtimes(path, stamp, stamp); err != nil {
						t.Fatal(err)
					}
				}
				// A fresh bootstrap must select the actual owned executable,
				// including after a timestamp-only change to an existing input.
				if err = g.execute(ctx, []BuildNode{node}, g.loadBuildReuse()); err != nil {
					t.Fatal(err)
				}
				if calls != 0 || supervisor.binary != published {
					t.Fatalf("unchanged host not reused: producer calls=%d, binary=%q, want %q", calls, supervisor.binary, published)
				}
				supervisor.binary = ""
				if operation == "remove" {
					if err = os.Remove(path); err != nil {
						t.Fatal(err)
					}
				} else {
					writeGraphFixture(t, path, operation+" native input\n")
				}
				g.outputs = nil
				if err = g.execute(ctx, []BuildNode{node}, g.loadBuildReuse()); !errors.Is(err, refused) {
					t.Fatalf("native %s did not reach refusing host producer: %v", operation, err)
				}
				if calls != 1 || supervisor.binary != "" {
					t.Fatalf("stale host selected: producer calls=%d, binary=%q", calls, supervisor.binary)
				}
			})
		}
	}
}
