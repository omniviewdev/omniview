package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devworkspace"
)

// Manager.Start invokes the test executable as the actual supervisor entrypoint.
// Intercept before testing parses the production workspace arguments.
func init() {
	if os.Getenv("OMNIVIEW_EDIT_OWNER_HELPER") != "1" {
		return
	}
	control, err := net.DialTimeout("tcp4", os.Getenv("OMNIVIEW_EDIT_OWNER_CONTROL"), 10*time.Second)
	if err != nil {
		os.Exit(81)
	}
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		var signal [1]byte
		_, _ = control.Read(signal[:])
		cancel()
	}()
	manager, err := devworkspace.Open(os.Getenv("OMNIVIEW_EDIT_OWNER_ROOT"), devworkspace.Options{Home: os.Getenv("HOME")})
	if err == nil {
		err = manager.ServeSupervisor(ctx, os.Getenv("OMNIVIEW_EDIT_OWNER_WORKSPACE"), io.Discard)
	}
	_ = control.Close()
	if err != nil {
		os.Exit(82)
	}
	os.Exit(0)
}

func startCLIEdgeOwner(t *testing.T, f *cliEdgeFixture) (*devworkspace.Manager, devworkspace.Status, []byte) {
	t.Helper()
	ctx := context.Background()
	sdk := t.TempDir()
	cliEdgeGit(t, sdk, "init", "-b", "main")
	cliEdgeGit(t, sdk, "config", "user.name", "Fixture")
	cliEdgeGit(t, sdk, "config", "user.email", "fixture@example.invalid")
	if err := os.WriteFile(filepath.Join(sdk, "tracked"), []byte("sdk source sentinel\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cliEdgeGit(t, sdk, "add", ".")
	cliEdgeGit(t, sdk, "commit", "-m", "minimal unsupported SDK stops launch before any app")
	if _, err := devworkspace.AddRepository(ctx, f.root, devworkspace.SourceSpec{ID: "plugin-sdk", Path: sdk, DefaultRef: "main"}); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(f.success("workspace", "edit", "feature", "--root", f.root, "--add-repo", "plugin-sdk", "--json"), &f.workspace); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	t.Setenv("OMNIVIEW_EDIT_OWNER_HELPER", "1")
	t.Setenv("OMNIVIEW_EDIT_OWNER_CONTROL", listener.Addr().String())
	t.Setenv("OMNIVIEW_EDIT_OWNER_ROOT", f.root)
	t.Setenv("OMNIVIEW_EDIT_OWNER_WORKSPACE", f.workspace.Manifest.WorkspaceID)
	controlReady := make(chan net.Conn, 1)
	go func() {
		_ = listener.(*net.TCPListener).SetDeadline(time.Now().Add(30 * time.Second))
		control, _ := listener.Accept()
		controlReady <- control
	}()
	manager, err := devworkspace.Open(f.root, devworkspace.Options{Home: os.Getenv("HOME")})
	if err != nil {
		t.Fatal(err)
	}
	selected, err := manager.Inspect(ctx, f.workspace.Manifest.WorkspaceID)
	if err != nil {
		t.Fatal(err)
	}
	sdkRevision := ""
	for _, repository := range selected.Manifest.Repositories {
		if repository.ID == "plugin-sdk" {
			sdkRevision = repository.BaseCommit
		}
	}
	status, launchErr := manager.Start(ctx, f.workspace.Manifest.WorkspaceID, devworkspace.LaunchOptions{Mode: "browser", ReviewedSDKRevision: sdkRevision, Timeout: 20 * time.Second}, os.Args[0], io.Discard)
	if status.Generation == "" {
		_ = listener.Close()
	}
	control := <-controlReady
	if control == nil {
		t.Fatalf("actual supervisor helper did not connect: %v", launchErr)
	}
	t.Cleanup(func() {
		_ = control.SetDeadline(time.Now().Add(20 * time.Second))
		_, _ = control.Write([]byte{1})
		if _, err := io.Copy(io.Discard, control); err != nil {
			t.Errorf("join exact supervisor helper through control IPC: %v", err)
		}
		_ = control.Close()
	})
	if launchErr == nil || status.Phase != "error" || status.Generation == "" {
		t.Fatalf("minimal source must retain a live authenticated failed-launch owner: phase=%s generation=%q err=%v", status.Phase, status.Generation, launchErr)
	}
	record, err := os.ReadFile(filepath.Join(f.workspace.Root, ".local", "supervisor.json"))
	if err != nil {
		t.Fatal(err)
	}
	return manager, status, record
}

func TestWorkspaceInvalidApplyNeverRequestsHealthySupervisorStopEdges(t *testing.T) {
	for _, test := range []struct {
		name  string
		flags []string
		code  string
		exit  int
		state string
	}{
		{"plugin", []string{"--add-plugin", "unregistered"}, "missing_plugin", 3, ""},
		{"slug", []string{"--slug", "../escape"}, "invalid_slug", 2, ""},
		{"repository", []string{"--add-repo", "unregistered"}, "missing_repository", 3, ""},
		{"upstream", []string{"--upstream", "omniview=invalid"}, "invalid_upstream", 2, ""},
		{"occupied", []string{"--slug", "occupied"}, "workspace_exists", 4, ""},
		{"redirected", []string{"--slug", "redirected"}, "workspace_exists", 4, ""},
		{"dirty-rename", []string{"--slug", "renamed"}, "dirty_worktree", 4, "dirty"},
		{"foreign-rename", []string{"--slug", "renamed"}, "foreign_worktree", 4, "foreign"},
		{"dirty-ref", []string{"--ref", "omniview=main"}, "dirty_worktree", 4, "dirty-ref"},
		{"dirty-removal", []string{"--remove-repo", "omniview-plugin-edge"}, "dirty_worktree", 4, "dirty-removal"},
		{"foreign-name", nil, "foreign_worktree", 4, "foreign"},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newCLIEdgeFixture(t)
			worktree := filepath.Join(f.workspace.Root, "omniview")
			if test.state == "dirty-removal" {
				f.success("workspace", "edit", "feature", "--root", f.root, "--add-repo", "omniview-plugin-edge", "--json")
				worktree = filepath.Join(f.workspace.Root, "omniview-plugin-edge")
			}
			manager, liveBefore, ownerBefore := startCLIEdgeOwner(t, &f)
			if test.state == "dirty-ref" {
				registry, err := devworkspace.LoadRegistry(context.Background(), f.root)
				if err != nil {
					t.Fatal(err)
				}
				for _, source := range registry.Repositories {
					if source.ID == "omniview" {
						cliEdgeGit(t, source.Worktree, "commit", "--allow-empty", "-m", "advance source")
					}
				}
			}
			if strings.HasPrefix(test.state, "dirty") {
				if err := os.WriteFile(filepath.Join(worktree, "tracked"), []byte("user changes must survive\n"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if test.state == "foreign" {
				cliEdgeGit(t, worktree, "checkout", "-b", "foreign-owner")
			}
			profile := filepath.Join(f.workspace.StateRoot, "edit-sentinel")
			if err := os.MkdirAll(filepath.Dir(profile), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(profile, []byte("profile must survive\n"), 0600); err != nil {
				t.Fatal(err)
			}
			before := f.manifest()
			var decoy devworkspace.Workspace
			if err := json.Unmarshal(f.success("workspace", "create", "occupied", "--root", f.root, "--json"), &decoy); err != nil {
				t.Fatal(err)
			}
			decoyBefore, err := os.ReadFile(decoy.ManifestPath)
			if err != nil {
				t.Fatal(err)
			}
			redirect := filepath.Join(filepath.Dir(f.workspace.Root), "redirected")
			if err := os.Symlink(decoy.Root, redirect); err != nil {
				t.Fatal(err)
			}
			preserved := map[string][]byte{}
			registry, err := devworkspace.LoadRegistry(context.Background(), f.root)
			if err != nil {
				t.Fatal(err)
			}
			for _, source := range registry.Repositories {
				path := filepath.Join(source.Worktree, "tracked")
				raw, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				preserved[path] = raw
			}
			journal := filepath.Join(f.workspace.Root, ".local", "ownership.json")
			if raw, err := os.ReadFile(journal); err != nil {
				t.Fatal(err)
			} else {
				preserved[journal] = raw
			}
			preserved[profile] = []byte("profile must survive\n")
			if test.state == "dirty-removal" {
				preserved[filepath.Join(worktree, "tracked")] = []byte("user changes must survive\n")
			}
			for _, root := range []string{f.workspace.Root, decoy.Root} {
				path := filepath.Join(root, "omniview", "tracked")
				raw, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				preserved[path] = raw
			}
			// Status authenticates the real production-published supervisor record.
			if live, err := manager.Status(context.Background(), f.workspace.Manifest.WorkspaceID); err != nil || live.Generation != liveBefore.Generation || live.Phase != liveBefore.Phase {
				t.Fatalf("live owner fixture lost before refusal: status=%+v err=%v", live, err)
			}
			args := append([]string{"workspace", "edit", "feature", "--root", f.root, "--apply", "--name", "Must not persist", "--json"}, test.flags...)
			var out, diagnostics bytes.Buffer
			code := run(args, &out, &diagnostics)
			var result struct {
				Error *devcontract.Error `json:"error"`
			}
			if err := json.Unmarshal(out.Bytes(), &result); err != nil || code != test.exit || result.Error == nil || result.Error.Code != test.code {
				t.Errorf("wrong canonical refusal: code=%d want=%d/%s out=%s err=%v", code, test.exit, test.code, &out, err)
			}
			if _, err := os.Lstat(filepath.Join(filepath.Dir(f.workspace.Root), "renamed")); !os.IsNotExist(err) {
				t.Errorf("refused edit created rename destination: %v", err)
			}
			liveAfter, statusErr := manager.Status(context.Background(), f.workspace.Manifest.WorkspaceID)
			ownerAfter, ownerErr := os.ReadFile(filepath.Join(f.workspace.Root, ".local", "supervisor.json"))
			if statusErr != nil || liveAfter.Generation != liveBefore.Generation || liveAfter.Phase != liveBefore.Phase || ownerErr != nil || !bytes.Equal(ownerBefore, ownerAfter) {
				t.Errorf("refused edit stopped or replaced exact live owner: status=%+v statusErr=%v ownerErr=%v", liveAfter, statusErr, ownerErr)
			}
			if !bytes.Equal(before, f.manifest()) {
				t.Fatal("invalid apply changed manifest")
			}
			if after, err := os.ReadFile(decoy.ManifestPath); err != nil || !bytes.Equal(decoyBefore, after) {
				t.Fatalf("invalid apply changed destination workspace: %s %v", after, err)
			}
			if target, err := os.Readlink(redirect); err != nil || target != decoy.Root {
				t.Fatalf("invalid apply changed destination redirect: %q %v", target, err)
			}
			for path, before := range preserved {
				if after, err := os.ReadFile(path); err != nil || !bytes.Equal(before, after) {
					t.Errorf("invalid apply changed source bytes at %s: %q %v", path, after, err)
				}
			}
		})
	}
}

func TestWorkspaceDirtyMetadataEditPreservesSourceEdges(t *testing.T) {
	f := newCLIEdgeFixture(t)
	path := filepath.Join(f.workspace.Root, "omniview", "tracked")
	before := []byte("dirty source permits metadata-only edit\n")
	if err := os.WriteFile(path, before, 0600); err != nil {
		t.Fatal(err)
	}
	var edited devworkspace.Workspace
	if err := json.Unmarshal(f.success("workspace", "edit", "feature", "--root", f.root, "--name", "Metadata only", "--json"), &edited); err != nil {
		t.Fatal(err)
	}
	if edited.Manifest.WorkspaceID != f.workspace.Manifest.WorkspaceID || edited.Manifest.DisplayName != "Metadata only" {
		t.Fatalf("metadata edit changed selection: %+v", edited.Manifest)
	}
	if after, err := os.ReadFile(path); err != nil || !bytes.Equal(before, after) {
		t.Fatalf("metadata edit changed dirty source: %q %v", after, err)
	}
}
