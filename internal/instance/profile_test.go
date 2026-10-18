package instance

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devcontract"
)

const fixtureID = "9d799eef-e491-493f-942a-54ac906ca34e"

func workspaceFixture(t *testing.T, home, id, name string) string {
	t.Helper()
	dir := t.TempDir()
	m := devcontract.WorkspaceManifest{SchemaVersion: 1, WorkspaceID: id, Slug: "fixture", DisplayName: name, Profile: devcontract.Profile{Kind: "development"}, Ports: devcontract.PortPolicy{Policy: "sticky"}, Repositories: []devcontract.Repository{{ID: "omniview", Directory: "omniview", BaseRef: "main", BaseCommit: strings.Repeat("a", 40), Branch: "feature/fixture"}}}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "workspace.json")
	if err := os.WriteFile(path, b, 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestResolveChannelsIndependentOfDevelopmentVersion(t *testing.T) {
	home := t.TempDir()
	for _, tc := range []struct{ channel, version, suffix string }{{"stable", "1.2.3", ".omniview"}, {"nightly", "0.0.0-dev", ".omniview-nightly"}} {
		p, err := Resolve(Options{Home: home, CWD: t.TempDir(), Channel: tc.channel, Version: tc.version})
		if err != nil {
			t.Fatal(err)
		}
		want, _ := devcontract.CanonicalPath(filepath.Join(home, tc.suffix))
		if p.Descriptor.Kind != "production" || p.Descriptor.Channel != tc.channel || p.Descriptor.StateRoot != want {
			t.Fatalf("wrong channel selection: %+v", p.Descriptor)
		}
	}
	if _, err := Resolve(Options{Home: home, CWD: t.TempDir(), Channel: "local"}); err == nil {
		t.Fatal("local launch fell back to production")
	}
}

func TestWorkspaceNamesRootsAndExplicitChildEnvironment(t *testing.T) {
	home := t.TempDir()
	for _, tc := range []struct{ id, name string }{{fixtureID, "Alpha"}, {"22f2dbb0-9ecd-4b17-9690-a0c2239387ac", "Beta"}} {
		manifest := workspaceFixture(t, home, tc.id, tc.name)
		p, err := Resolve(Options{Home: home, CWD: filepath.Dir(manifest), Workspace: manifest, Channel: "local", Generation: fixtureID})
		if err != nil {
			t.Fatal(err)
		}
		if p.Descriptor.InstanceID != tc.id || p.Descriptor.DisplayName != tc.name || p.Descriptor.Kind != "development" {
			t.Fatalf("wrong identity: %+v", p.Descriptor)
		}
		env := p.ChildEnvironment([]string{"OMNIVIEW_STATE_DIR=/wrong", "OMNIVIEW_GENERATION=wrong", "GOWORK=on", "KEEP=yes", "OMNIVIEW_PROCESS_BRIDGE_TOKEN_FILE=/private/capability", "OMNIVIEW_PROCESS_BRIDGE_ENDPOINT=http://127.0.0.1:1234", "OMNIVIEW_SUPERVISOR_TOKEN_FILE=/private/capability", "OMNIVIEW_PLUGIN_PNPM_COMMANDS=private-command-map"}, "kubernetes")
		got := strings.Join(env, "\n")
		for _, want := range []string{"OMNIVIEW_STATE_DIR=" + p.Descriptor.StateRoot, "OMNIVIEW_WORKSPACE_FILE=" + p.Workspace.ManifestPath, "OMNIVIEW_GENERATION=" + fixtureID, "OMNIVIEW_PLUGIN_ID=kubernetes", "GOWORK=off", "KEEP=yes"} {
			if !strings.Contains(got, want) {
				t.Errorf("missing %q in %s", want, got)
			}
		}
		if strings.Contains(got, "/wrong") || strings.Contains(got, "GOWORK=on") {
			t.Fatal("stale env survived")
		}
		if strings.Contains(got, "OMNIVIEW_PROCESS_BRIDGE_") || strings.Contains(got, "OMNIVIEW_SUPERVISOR_") || strings.Contains(got, "OMNIVIEW_PLUGIN_PNPM_COMMANDS=") {
			t.Fatal("plugin inherited supervisor process-control capabilities")
		}
	}
}

func TestWorkspaceRejectsConflictsAndProductionNesting(t *testing.T) {
	home := t.TempDir()
	manifest := workspaceFixture(t, home, fixtureID, "Alpha")
	for _, root := range []string{filepath.Join(home, ".omniview"), filepath.Join(home, ".omniview", "nested"), filepath.Join(home, ".omniview-dev", "profiles"), "relative"} {
		if _, err := Resolve(Options{Home: home, Workspace: manifest, StateRoot: root, Channel: "local"}); err == nil {
			t.Errorf("accepted root %q", root)
		}
	}
	other := workspaceFixture(t, home, "22f2dbb0-9ecd-4b17-9690-a0c2239387ac", "Beta")
	if _, err := Resolve(Options{Home: home, Workspace: manifest, EnvironmentManifest: other, Channel: "local"}); err == nil {
		t.Fatal("accepted conflicting manifests")
	}
	if _, err := Resolve(Options{Home: home, Workspace: manifest, Channel: "stable"}); err == nil {
		t.Fatal("workspace accepted production channel")
	}
}

func TestCanonicalAliasesRetainOneRootLock(t *testing.T) {
	home := t.TempDir()
	manifest := workspaceFixture(t, home, fixtureID, "Alpha")
	p, err := Resolve(Options{Home: home, Workspace: manifest, Channel: "local"})
	if err != nil {
		t.Fatal(err)
	}
	first, err := appstate.New(appstate.WithRoot(p.Descriptor.StateRoot))
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	alias := filepath.Join(t.TempDir(), "alias")
	if err := os.Symlink(p.Descriptor.StateRoot, alias); err != nil {
		t.Skip(err)
	}
	if _, err := appstate.New(appstate.WithRoot(alias)); err == nil {
		t.Fatal("alias bypassed root lock")
	}
}

func TestProductionEnvironmentDoesNotLeakWorkspace(t *testing.T) {
	p, err := Resolve(Options{Home: t.TempDir(), CWD: t.TempDir(), Channel: "nightly"})
	if err != nil {
		t.Fatal(err)
	}
	env := strings.Join(p.ChildEnvironment([]string{"OMNIVIEW_WORKSPACE_FILE=/foreign/workspace.json", "OMNIVIEW_INSTANCE_ID=foreign", "OMNIVIEW_STATE_DIR=/foreign"}, "plugin"), "\n")
	if strings.Contains(env, "foreign") || !strings.Contains(env, "OMNIVIEW_STATE_DIR="+p.Descriptor.StateRoot) {
		t.Fatal(env)
	}
}

func TestResolveEnvironmentManifestAloneSelectsProfileRoot(t *testing.T) {
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	manifest := workspaceFixture(t, home, fixtureID, "Env only")
	t.Setenv("OMNIVIEW_WORKSPACE_FILE", manifest)
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	t.Setenv("OMNIVIEW_CHANNEL", "local")
	t.Setenv("OMNIVIEW_GENERATION", "")
	p, err := ResolveEnvironment("1.0.0", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	if p.Descriptor.StateRoot != filepath.Join(home, ".omniview-dev", "profiles", fixtureID, "state") {
		t.Fatalf("wrong profile root: %s", p.Descriptor.StateRoot)
	}
}

func TestProgrammaticPluginRootOverridesAmbientStateWithoutTelemetry(t *testing.T) {
	t.Setenv("OMNIVIEW_WORKSPACE_FILE", "")
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	env, err := PluginEnvironment(root, "kubernetes", []string{"OMNIVIEW_STATE_DIR=/ambient", "OMNIVIEW_GENERATION=" + fixtureID, "GOWORK=on"})
	if err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(env, "\n")
	if !strings.Contains(joined, "OMNIVIEW_STATE_DIR="+root) || strings.Contains(joined, "/ambient") || !strings.Contains(joined, "OMNIVIEW_GENERATION="+fixtureID) {
		t.Fatal(joined)
	}
}

func TestInvalidWorkspaceIdentityCannotResolve(t *testing.T) {
	home := t.TempDir()
	manifest := workspaceFixture(t, home, "../production", "Invalid")
	if _, err := Resolve(Options{Home: home, Workspace: manifest, Channel: "local"}); err == nil {
		t.Fatal("invalid UUID selected profile")
	}
}

func TestDescriptorSnapshotCannotMutateOriginal(t *testing.T) {
	endpoint := "http://127.0.0.1:23456"
	original := devcontract.InstanceDescriptor{Endpoints: devcontract.Endpoints{Control: &endpoint}, Repositories: []devcontract.RepositoryResolution{{ID: "omniview"}}, Plugins: []devcontract.PluginState{{ID: "kubernetes", LastError: &devcontract.Error{Code: "failed", Message: "safe", Details: map[string]any{"token": "secret"}}}}}
	snapshot := Snapshot(original)
	snapshot.Repositories[0].ID = "foreign"
	*snapshot.Endpoints.Control = "foreign"
	snapshot.Plugins[0].ID = "foreign"
	if original.Repositories[0].ID != "omniview" || *original.Endpoints.Control != endpoint || original.Plugins[0].ID != "kubernetes" {
		t.Fatal("public snapshot shared mutable state")
	}
	if snapshot.Plugins[0].LastError.Details != nil {
		t.Fatal("provider error details leaked into descriptor")
	}
}

func TestWorkspaceStateCannotRemapToOwnProfileBoundary(t *testing.T) {
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	manifest := workspaceFixture(t, home, fixtureID, "Aliased")
	boundary := filepath.Join(home, ".omniview-dev", "profiles", fixtureID)
	if err := os.MkdirAll(boundary, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(boundary, filepath.Join(boundary, "state")); err != nil {
		t.Fatal(err)
	}
	if _, err := Resolve(Options{Home: home, Workspace: manifest, Channel: "local"}); err == nil {
		t.Fatal("own state remap escaped the state leaf boundary")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(boundary), "runtime")); !os.IsNotExist(err) {
		t.Fatal("state remap created shared profiles runtime")
	}
}

func TestWorkspaceRuntimeAndWebviewRootsRemainUUIDOwned(t *testing.T) {
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	var prior Profile
	for _, id := range []string{fixtureID, "22f2dbb0-9ecd-4b17-9690-a0c2239387ac"} {
		manifest := workspaceFixture(t, home, id, "Same display name")
		profile, err := Resolve(Options{Home: home, Workspace: manifest, Channel: "local"})
		if err != nil {
			t.Fatal(err)
		}
		boundary := filepath.Join(home, ".omniview-dev", "profiles", id)
		if profile.RuntimeRoot != filepath.Join(boundary, "runtime") || profile.WebviewRoot != filepath.Join(boundary, "webview") {
			t.Fatalf("profile roots escaped UUID ownership: %+v", profile)
		}
		if prior.RuntimeRoot != "" && (prior.RuntimeRoot == profile.RuntimeRoot || prior.WebviewRoot == profile.WebviewRoot) {
			t.Fatal("distinct UUIDs shared native/runtime roots")
		}
		prior = profile
	}
}

func TestForeignLinuxNativeStorageAliasRejectedBeforeRuntimeEffects(t *testing.T) {
	for _, child := range []string{"data", "cache"} {
		t.Run(child, func(t *testing.T) {
			home, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			manifest := workspaceFixture(t, home, fixtureID, "Native alias")
			ensureDefaultOwnerFixture(t, home, fixtureID)
			profile, err := Resolve(Options{Home: home, Workspace: manifest, Channel: "local"})
			if err != nil {
				t.Fatal(err)
			}
			foreign := t.TempDir()
			sentinel := filepath.Join(foreign, "sentinel")
			if err := os.WriteFile(sentinel, []byte("foreign unchanged"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(profile.WebviewRoot, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(foreign, filepath.Join(profile.WebviewRoot, child)); err != nil {
				t.Fatal(err)
			}
			if _, err := Resolve(Options{Home: home, Workspace: manifest, Channel: "local"}); err == nil {
				t.Fatal("native alias passed profile preflight")
			}
			if err := profile.PrepareRuntime(); err == nil {
				t.Fatal("native alias passed runtime revalidation")
			}
			if _, err := os.Stat(profile.RuntimeRoot); !os.IsNotExist(err) {
				t.Fatal("runtime directories created before all paths were validated")
			}
			got, err := os.ReadFile(sentinel)
			if err != nil || string(got) != "foreign unchanged" {
				t.Fatal("foreign sentinel changed")
			}
			if _, err := os.Stat(filepath.Join(foreign, "cookies.sqlite")); !os.IsNotExist(err) {
				t.Fatal("foreign native cookie state was created")
			}
		})
	}
}

func TestBoundCustomStateRetainsDefaultUUIDTransientRoots(t *testing.T) {
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv(devcontract.WorkspaceEnvironment, "")
	manifest := workspaceFixture(t, home, fixtureID, "Custom state")
	prior, err := Resolve(Options{Home: home, Workspace: manifest, Channel: "local"})
	if err != nil {
		t.Fatal(err)
	}
	customBase, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	customState := filepath.Join(customBase, "dedicated", "state")
	bound, err := devcontract.SetCustomProfile(context.Background(), *prior.Workspace, customState, home)
	if err != nil {
		t.Fatal(err)
	}
	selected, err := Resolve(Options{Home: home, Workspace: bound.ManifestPath, StateRoot: customState, Channel: "local"})
	if err != nil {
		t.Fatal(err)
	}
	if selected.Descriptor.StateRoot != customState || selected.Workspace.StateRoot != customState {
		t.Fatal("bound custom state was not selected")
	}
	if selected.RuntimeRoot != prior.RuntimeRoot || selected.WebviewRoot != prior.WebviewRoot {
		t.Fatal("custom state changed UUID-owned transient namespaces")
	}
	if _, err := os.Stat(customState); !os.IsNotExist(err) {
		t.Fatal("binding or profile resolution created state before baseline publication")
	}
	if _, err := Resolve(Options{Home: home, Workspace: bound.ManifestPath, StateRoot: prior.Descriptor.StateRoot, Channel: "local"}); err == nil {
		t.Fatal("explicit state overrode the validated custom binding")
	}
}

func ensureDefaultOwnerFixture(t *testing.T, home, id string) {
	t.Helper()
	release, err := devcontract.LockProfile(context.Background(), home, id)
	if err != nil {
		t.Fatal(err)
	}
	if err := devcontract.EnsureDefaultProfileOwnership(home, id); err != nil {
		release()
		t.Fatal(err)
	}
	if err := release(); err != nil {
		t.Fatal(err)
	}
}

func TestPrepareRuntimeDoesNotClaimUnmarkedDefaultProfile(t *testing.T) {
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	manifest := workspaceFixture(t, home, fixtureID, "Unmarked runtime")
	profile, err := Resolve(Options{Home: home, Workspace: manifest, Channel: "local"})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(profile.RuntimeRoot, 0700); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(profile.RuntimeRoot, "foreign")
	if err := os.WriteFile(sentinel, []byte("unchanged"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := profile.PrepareRuntime(); err == nil {
		t.Fatal("runtime preparation claimed an unmarked profile")
	}
	got, err := os.ReadFile(sentinel)
	if err != nil || string(got) != "unchanged" {
		t.Fatal("foreign runtime changed")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(profile.RuntimeRoot), ".workspace-owner.json")); !os.IsNotExist(err) {
		t.Fatal("runtime preparation created owner metadata")
	}
}
