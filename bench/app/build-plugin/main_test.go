package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devworkspace"
)

// This crosses the actual private manager boundary that failed before linking:
// a real source worktree must be accepted as stopped, then retired without an
// injected no-op guard, package installation, native launch or fake session.
func TestProfileManagerCanUnlinkAndRetireItsStoppedPrivateWorkspace(t *testing.T) {
	ctx := context.Background()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "source")
	if err = os.Mkdir(source, 0700); err != nil {
		t.Fatal(err)
	}
	git := func(args ...string) string {
		t.Helper()
		command := exec.Command("git", append([]string{"-C", source}, args...)...)
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %v: %s", args, err, output)
		}
		return strings.TrimSpace(string(output))
	}
	git("init")
	if err = os.WriteFile(filepath.Join(source, "source.txt"), []byte("committed source\n"), 0600); err != nil {
		t.Fatal(err)
	}
	git("add", "source.txt")
	git("-c", "user.name=Profile test", "-c", "user.email=profile-test@example.invalid", "commit", "-m", "source")
	commit := git("rev-parse", "HEAD")
	collection := filepath.Join(root, "collection")
	if err = os.Mkdir(collection, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err = devworkspace.Init(ctx, devworkspace.InitOptions{Root: collection, Sources: []devworkspace.SourceSpec{{ID: "omniview", Path: source, DefaultRef: commit}}}); err != nil {
		t.Fatal(err)
	}
	manager, err := openProfileManager(collection)
	if err != nil {
		t.Fatal(err)
	}
	workspace, err := manager.Create(ctx, devworkspace.CreateOptions{Slug: "app-profile"})
	if err != nil {
		t.Fatal(err)
	}
	report, err := manager.Unlink(ctx, workspace.Manifest.WorkspaceID)
	if err != nil {
		t.Fatalf("real stopped guard rejected the private workspace: %v", err)
	}
	if report.Phase != "unlinked" {
		t.Fatalf("unexpected unlink phase: %s", report.Phase)
	}
	if _, err = manager.Remove(ctx, workspace.Manifest.WorkspaceID, devworkspace.RemoveOptions{PurgeState: true, DeleteBranches: true}); err != nil {
		t.Fatalf("ownership-safe private workspace retirement: %v", err)
	}
	if _, err = os.Stat(workspace.Root); !os.IsNotExist(err) {
		t.Fatalf("retired private worktree still exists: %v", err)
	}
}
