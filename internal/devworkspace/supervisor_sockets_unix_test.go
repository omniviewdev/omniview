//go:build darwin || linux

package devworkspace

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func TestSupervisorSocketDirectoryWaitsForOwnedGroupDisposal(t *testing.T) {
	w := generatedFixture(t)
	home, err := devcontract.CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	w.StateRoot = filepath.Join(home, ".omniview-dev", "profiles", w.Manifest.WorkspaceID, "state")
	if err := devcontract.EnsureDefaultProfileOwnership(home, w.Manifest.WorkspaceID); err != nil {
		t.Fatal(err)
	}
	generation := NewGeneration()
	registry, err := devsession.OpenRegistry(filepath.Join(home, ".omniview-dev", "sessions"), devsession.RegistryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	runtimeRoot := filepath.Join(filepath.Dir(w.StateRoot), "runtime")
	if err := os.MkdirAll(runtimeRoot, 0700); err != nil {
		t.Fatal(err)
	}
	owner, err := devsession.CaptureProcess(os.Getpid(), devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "supervisor", Source: w.Root})
	if err != nil {
		t.Fatal(err)
	}
	directory, err := devsession.CreateUnixSocketDirectory(runtimeRoot, owner)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := directory.Close(); err != nil {
			t.Error(err)
		}
	}()
	root, err := devsession.ReadUnixSocketDirectory(runtimeRoot, w.Manifest.WorkspaceID, generation, w.Root)
	if err != nil {
		t.Fatal(err)
	}
	child, err := startOwnedChild(context.Background(), w.Root, os.Environ(), io.Discard, devsession.ProcessOwner{WorkspaceID: w.Manifest.WorkspaceID, Generation: generation, Role: "host", Source: w.Root}, nil, "/bin/sleep", "300")
	if err != nil {
		t.Fatal(err)
	}
	stopTree := child.stopTree
	defer func() { child.stopTree = stopTree; _ = child.stop(context.Background()) }()
	s := &workspaceSupervisor{workspace: w, generation: generation, owner: owner, manager: &Manager{options: Options{Home: home}}, registry: registry, children: map[string]*ownedChild{"host": child}, output: io.Discard, unixSocketDirectory: directory}
	child.stopTree = func(bool) error { return errors.New("owned group disposal not confirmed") }
	if err := s.stopChildren(context.Background()); err == nil {
		t.Fatal("uncertain disposal succeeded")
	}
	if _, err := os.Lstat(root); err != nil {
		t.Fatalf("uncertain disposal deleted socket namespace: %v", err)
	}
	if err := devsession.ValidateUnixSocketDirectoriesRemoved(runtimeRoot); !errors.Is(err, devsession.ErrOwnership) {
		t.Fatalf("uncertain disposal discarded durable proof: %v", err)
	}
	child.stopTree = stopTree
	if err := s.stopChildren(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(root); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("confirmed disposal retained socket namespace: %v", err)
	}
	if err := devsession.ValidateUnixSocketDirectoriesRemoved(runtimeRoot); err != nil {
		t.Fatal(err)
	}
}
