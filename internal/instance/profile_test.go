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
		env, err := p.ChildEnvironment([]string{"OMNIVIEW_STATE_DIR=/wrong", "OMNIVIEW_GENERATION=wrong", "GOWORK=on", "KEEP=yes", "OMNIVIEW_PROCESS_BRIDGE_TOKEN_FILE=/private/capability", "OMNIVIEW_PROCESS_BRIDGE_ENDPOINT=http://127.0.0.1:1234", "OMNIVIEW_SUPERVISOR_TOKEN_FILE=/private/capability", "OMNIVIEW_PLUGIN_PNPM_COMMANDS=private-command-map"}, "kubernetes")
		if err != nil {
			t.Fatal(err)
		}
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

func TestP02MetricsControlRemainsHostOnly(t *testing.T) {
	p := Profile{Descriptor: devcontract.InstanceDescriptor{StateRoot: t.TempDir(), Kind: "development", WorkspaceID: fixtureID}}
	base := []string{"OMNIVIEW_P02_METRICS_SOCKET=/private/benchmark.sock", "KEEP=yes"}
	for _, pluginID := range []string{"", "workspace-probe"} {
		child, err := p.ChildEnvironment(base, pluginID)
		if err != nil {
			t.Fatal(err)
		}
		joined := strings.Join(child, "\n")
		present := strings.Contains(joined, "OMNIVIEW_P02_METRICS_SOCKET=")
		if present != (pluginID == "") {
			t.Fatalf("benchmark socket inheritance for plugin %q: %s", pluginID, joined)
		}
		if !strings.Contains(joined, "KEEP=yes") {
			t.Fatal("unrelated environment changed")
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
	childEnvironment, err := p.ChildEnvironment([]string{"OMNIVIEW_WORKSPACE_FILE=/foreign/workspace.json", "OMNIVIEW_INSTANCE_ID=foreign", "OMNIVIEW_STATE_DIR=/foreign"}, "plugin")
	if err != nil {
		t.Fatal(err)
	}
	env := strings.Join(childEnvironment, "\n")
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

func productionCustomProfileFixture(t *testing.T) (string, devcontract.ResolvedWorkspace, string) {
	t.Helper()
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	manifest := workspaceFixture(t, home, fixtureID, "Production isolation")
	local, err := Resolve(Options{Home: home, Workspace: manifest, Channel: "local"})
	if err != nil {
		t.Fatal(err)
	}
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(base, "profiles", "custom", "state")
	bound, err := devcontract.SetCustomProfile(context.Background(), *local.Workspace, state, home)
	if err != nil {
		t.Fatal(err)
	}
	// A stopped development instance still owns its profile. Release the real
	// canonical state lock before attempting production resolution.
	service, err := appstate.New(appstate.WithRoot(state))
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(state, "sentinel"), []byte("development state must survive"), 0600); err != nil {
		t.Fatal(err)
	}
	return home, bound, state
}

func preserveProfileEvidence(t *testing.T, paths ...string) {
	t.Helper()
	for _, path := range paths {
		before, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		info, err := os.Lstat(path)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			after, err := os.ReadFile(path)
			if err != nil || string(after) != string(before) {
				t.Errorf("profile resolution changed existing bytes at %s: %v", path, err)
			}
			afterInfo, err := os.Lstat(path)
			if err != nil || afterInfo.Mode() != info.Mode() {
				t.Errorf("profile resolution changed ownership evidence type/mode at %s: %v", path, err)
			}
		})
	}
}

func TestProductionRejectsDurableCustomProfileOverlap(t *testing.T) {
	for _, channel := range []string{"stable", "nightly"} {
		t.Run(channel, func(t *testing.T) {
			home, bound, state := productionCustomProfileFixture(t)
			container := filepath.Dir(state)
			alias := filepath.Join(t.TempDir(), "custom-alias")
			if err := os.Symlink(container, alias); err != nil {
				t.Fatal(err)
			}
			// Rebinding leaves the old durable reservation intact even though
			// the workspace's current machine-local binding now points elsewhere.
			next := filepath.Join(filepath.Dir(container), "replacement", "state")
			if _, err := devcontract.SetCustomProfile(context.Background(), bound, next, home); err != nil {
				t.Fatal(err)
			}
			preserveProfileEvidence(t,
				filepath.Join(home, ".omniview-dev", "custom-profiles.json"),
				filepath.Join(bound.Root, ".local", "profile.json"),
				filepath.Join(container, ".omniview-profile.json"),
				filepath.Join(filepath.Dir(next), ".omniview-profile.json"),
				filepath.Join(state, "sentinel"),
			)
			for _, tc := range []struct{ name, root string }{
				{"state equal", state},
				{"container equal", container},
				{"state descendant", filepath.Join(state, "nested")},
				{"container descendant outside state", filepath.Join(container, "runtime")},
				{"container ancestor", filepath.Dir(container)},
				{"symlink state", filepath.Join(alias, "state")},
				{"symlink container", alias},
				{"symlink descendant", filepath.Join(alias, "nested")},
				{"current binding", next},
			} {
				t.Run(tc.name, func(t *testing.T) {
					if _, err := Resolve(Options{Home: home, CWD: t.TempDir(), StateRoot: tc.root, Channel: channel, Generation: fixtureID}); err == nil {
						t.Errorf("%s production accepted durable development container overlap: %s", channel, tc.root)
					}
				})
			}
			for _, absent := range []string{next, filepath.Join(state, "nested"), filepath.Join(container, "runtime"), filepath.Join(container, "nested")} {
				if _, err := os.Lstat(absent); !os.IsNotExist(err) {
					t.Errorf("profile resolution created %s: %v", absent, err)
				}
			}
		})
	}
}

func TestProductionAllowsDisjointCustomProfileClaims(t *testing.T) {
	for _, channel := range []string{"stable", "nightly"} {
		t.Run(channel, func(t *testing.T) {
			home, bound, state := productionCustomProfileFixture(t)
			container := filepath.Dir(state)
			preserveProfileEvidence(t,
				filepath.Join(home, ".omniview-dev", "custom-profiles.json"),
				filepath.Join(bound.Root, ".local", "profile.json"),
				filepath.Join(container, ".omniview-profile.json"),
				filepath.Join(state, "sentinel"),
			)
			defaultName := ".omniview"
			if channel == "nightly" {
				defaultName = ".omniview-nightly"
			}
			for _, tc := range []struct{ name, root, want string }{
				{"default", "", filepath.Join(home, defaultName)},
				{"sibling", filepath.Join(filepath.Dir(container), "production"), filepath.Join(filepath.Dir(container), "production")},
				{"lexical prefix sibling", container + "-production", container + "-production"},
			} {
				t.Run(tc.name, func(t *testing.T) {
					profile, err := Resolve(Options{Home: home, CWD: t.TempDir(), StateRoot: tc.root, Channel: channel, Generation: fixtureID})
					if err != nil {
						t.Fatal(err)
					}
					if profile.Descriptor.Kind != "production" || profile.Descriptor.Channel != channel || profile.Descriptor.StateRoot != tc.want {
						t.Fatalf("wrong disjoint production selection: %+v", profile.Descriptor)
					}
					if _, err := os.Lstat(tc.want); !os.IsNotExist(err) {
						t.Fatalf("read-only profile resolution created production state: %v", err)
					}
				})
			}
		})
	}
}

func TestProductionStartsWithUnrelatedMissingCustomProfileOwner(t *testing.T) {
	for _, channel := range []string{"stable", "nightly"} {
		t.Run(channel, func(t *testing.T) {
			home, bound, state := productionCustomProfileFixture(t)
			container := filepath.Dir(state)
			owner := filepath.Join(container, ".omniview-profile.json")
			if err := os.Remove(owner); err != nil {
				t.Fatal(err)
			}
			preserveProfileEvidence(t,
				filepath.Join(home, ".omniview-dev", "custom-profiles.json"),
				filepath.Join(bound.Root, ".local", "profile.json"),
				filepath.Join(state, "sentinel"),
			)
			defaultName := ".omniview"
			if channel == "nightly" {
				defaultName = ".omniview-nightly"
			}
			for _, tc := range []struct{ name, root, want string }{
				{"default", "", filepath.Join(home, defaultName)},
				{"custom", container + "-production", container + "-production"},
			} {
				t.Run(tc.name, func(t *testing.T) {
					profile, err := Resolve(Options{Home: home, CWD: t.TempDir(), StateRoot: tc.root, Channel: channel})
					if err != nil {
						t.Fatal(err)
					}
					if profile.Descriptor.Kind != "production" || profile.Descriptor.Channel != channel || profile.Descriptor.StateRoot != tc.want {
						t.Fatalf("wrong production selection with stale development claim: %+v", profile.Descriptor)
					}
					service, err := appstate.New(appstate.WithRoot(profile.Descriptor.StateRoot))
					if err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() {
						if err := service.Close(); err != nil {
							t.Error(err)
						}
					})
					if err := profile.PrepareRuntime(); err != nil {
						t.Fatal(err)
					}
				})
			}
			for _, root := range []string{state, container, filepath.Join(state, "nested"), filepath.Dir(container)} {
				if _, err := Resolve(Options{Home: home, CWD: t.TempDir(), StateRoot: root, Channel: channel}); err == nil {
					t.Errorf("production accepted durable development overlap without owner marker: %s", root)
				}
			}
			if _, err := os.Lstat(owner); !os.IsNotExist(err) {
				t.Fatalf("production recreated missing development owner marker: %v", err)
			}
		})
	}
}

func TestProductionRejectsInvalidCustomProfileEvidence(t *testing.T) {
	for _, channel := range []string{"stable", "nightly"} {
		for _, kind := range []string{"registry malformed", "registry schema", "registry symlink", "registry dangling", "owner malformed", "owner foreign", "owner symlink", "owner dangling", "registry missing with owner", "claim missing with owner"} {
			t.Run(channel+"/"+kind, func(t *testing.T) {
				home, bound, state := productionCustomProfileFixture(t)
				registry := filepath.Join(home, ".omniview-dev", "custom-profiles.json")
				owner := filepath.Join(filepath.Dir(state), ".omniview-profile.json")
				path := owner
				if strings.HasPrefix(kind, "registry") || kind == "claim missing with owner" {
					path = registry
				}
				root := filepath.Join(filepath.Dir(filepath.Dir(state)), "production")
				switch kind {
				case "registry malformed", "owner malformed":
					if err := os.WriteFile(path, []byte("{not-json"), 0600); err != nil {
						t.Fatal(err)
					}
				case "registry schema":
					if err := os.WriteFile(path, []byte(`{"schemaVersion":99,"claims":[]}`), 0600); err != nil {
						t.Fatal(err)
					}
				case "owner foreign":
					data, err := os.ReadFile(owner)
					if err != nil {
						t.Fatal(err)
					}
					data = []byte(strings.ReplaceAll(string(data), fixtureID, "22f2dbb0-9ecd-4b17-9690-a0c2239387ac"))
					if err := os.WriteFile(owner, data, 0600); err != nil {
						t.Fatal(err)
					}
				case "registry symlink", "owner symlink", "registry dangling", "owner dangling":
					target := path + ".original"
					if err := os.Rename(path, target); err != nil {
						t.Fatal(err)
					}
					preserveProfileEvidence(t, target)
					if strings.HasSuffix(kind, "dangling") {
						target = path + ".missing"
					}
					if err := os.Symlink(target, path); err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() {
						actual, err := os.Readlink(path)
						if err != nil || actual != target {
							t.Errorf("resolution changed redirected ownership evidence: %s %v", actual, err)
						}
					})
				case "registry missing with owner":
					if err := os.Remove(path); err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() {
						if _, err := os.Lstat(path); !os.IsNotExist(err) {
							t.Errorf("resolution recreated missing ownership evidence: %v", err)
						}
					})
				case "claim missing with owner":
					if err := os.WriteFile(registry, []byte(`{"schemaVersion":1,"claims":[]}`), 0600); err != nil {
						t.Fatal(err)
					}
				}
				// Without a registry entry, the external marker along the
				// selected root's ancestors is still ownership evidence.
				if kind == "registry missing with owner" || kind == "claim missing with owner" {
					root = state
				}
				preserveProfileEvidence(t, filepath.Join(bound.Root, ".local", "profile.json"), filepath.Join(state, "sentinel"))
				for _, evidence := range []string{registry, owner} {
					if _, err := os.ReadFile(evidence); err == nil {
						preserveProfileEvidence(t, evidence)
					}
				}
				if _, err := Resolve(Options{Home: home, CWD: t.TempDir(), StateRoot: root, Channel: channel, Generation: fixtureID}); err == nil {
					t.Errorf("%s production accepted invalid custom ownership evidence: %s", channel, kind)
				}
			})
		}
	}
}

func caseVariantProfileRoot(t *testing.T, original string) (string, bool) {
	t.Helper()
	originalInfo, err := os.Stat(original)
	if err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(filepath.Dir(original), strings.ToUpper(filepath.Base(original)))
	aliasInfo, err := os.Stat(alias)
	if os.IsNotExist(err) {
		// On case-sensitive filesystems this is a genuinely disjoint sibling,
		// not an alias. It must remain a legitimate production selection.
		if err := os.Mkdir(alias, 0700); err != nil {
			t.Fatal(err)
		}
		aliasInfo, err = os.Stat(alias)
	}
	if err != nil {
		t.Fatal(err)
	}
	same := os.SameFile(originalInfo, aliasInfo)
	t.Logf("case-variant directories share physical identity: %t", same)
	return alias, same
}

func TestProductionProfileCaseVariantContainment(t *testing.T) {
	for _, channel := range []string{"stable", "nightly"} {
		for _, kind := range []string{"custom ancestor", "default development ancestor", "other production channel"} {
			t.Run(channel+"/"+kind, func(t *testing.T) {
				var home, original string
				switch kind {
				case "custom ancestor":
					var bound devcontract.ResolvedWorkspace
					var state string
					home, bound, state = productionCustomProfileFixture(t)
					original = filepath.Dir(filepath.Dir(state))
					preserveProfileEvidence(t,
						filepath.Join(home, ".omniview-dev", "custom-profiles.json"),
						filepath.Join(bound.Root, ".local", "profile.json"),
						filepath.Join(filepath.Dir(state), ".omniview-profile.json"),
						filepath.Join(state, "sentinel"),
					)
				case "default development ancestor":
					var err error
					home, err = filepath.EvalSymlinks(t.TempDir())
					if err != nil {
						t.Fatal(err)
					}
					ensureDefaultOwnerFixture(t, home, fixtureID)
					original = filepath.Join(home, ".omniview-dev")
					state := filepath.Join(original, "profiles", fixtureID, "state")
					if err := os.MkdirAll(state, 0700); err != nil {
						t.Fatal(err)
					}
					sentinel := filepath.Join(state, "sentinel")
					if err := os.WriteFile(sentinel, []byte("default development unchanged"), 0600); err != nil {
						t.Fatal(err)
					}
					preserveProfileEvidence(t,
						filepath.Join(original, "profiles", fixtureID, ".workspace-owner.json"),
						sentinel,
					)
				case "other production channel":
					var err error
					home, err = filepath.EvalSymlinks(t.TempDir())
					if err != nil {
						t.Fatal(err)
					}
					other := ".omniview-nightly"
					if channel == "nightly" {
						other = ".omniview"
					}
					original = filepath.Join(home, other)
					if err := os.Mkdir(original, 0700); err != nil {
						t.Fatal(err)
					}
					sentinel := filepath.Join(original, "sentinel")
					if err := os.WriteFile(sentinel, []byte("other production channel unchanged"), 0600); err != nil {
						t.Fatal(err)
					}
					preserveProfileEvidence(t, sentinel)
				}
				alias, same := caseVariantProfileRoot(t, original)
				profile, err := Resolve(Options{Home: home, CWD: t.TempDir(), StateRoot: alias, Channel: channel, Generation: fixtureID})
				if same || kind != "custom ancestor" {
					if err == nil {
						t.Errorf("%s accepted reserved or physical %s overlap through case variant %s", channel, kind, alias)
					}
				} else {
					if err != nil {
						t.Fatalf("case-sensitive disjoint sibling rejected: %v", err)
					}
					if profile.Descriptor.Kind != "production" || profile.Descriptor.Channel != channel || profile.Descriptor.StateRoot != alias {
						t.Errorf("wrong case-sensitive sibling selection: %+v", profile.Descriptor)
					}
				}
				if _, err := os.Lstat(filepath.Join(alias, "runtime")); !os.IsNotExist(err) {
					t.Errorf("resolution created case-variant runtime: %v", err)
				}
			})
		}
	}
}

func TestProductionRejectsProspectiveCaseVariantReservedRoots(t *testing.T) {
	arena, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	// Default profile labels are product-reserved ASCII namespaces even on
	// case-sensitive filesystems. Neither endpoint needs to exist.
	for _, channel := range []string{"stable", "nightly"} {
		for _, kind := range []string{"default development", "other production channel"} {
			t.Run(channel+"/"+kind, func(t *testing.T) {
				home := filepath.Join(arena, channel+"-"+strings.ReplaceAll(kind, " ", "-"))
				if err := os.Mkdir(home, 0700); err != nil {
					t.Fatal(err)
				}
				sentinel := filepath.Join(home, "unrelated-sentinel")
				if err := os.WriteFile(sentinel, []byte("fresh home unchanged"), 0600); err != nil {
					t.Fatal(err)
				}
				preserveProfileEvidence(t, sentinel)
				var protected, selected string
				if kind == "default development" {
					protected = filepath.Join(home, ".omniview-dev", "profiles")
					selected = filepath.Join(home, ".OMNIVIEW-DEV", "profiles", fixtureID, "state")
				} else {
					other := ".omniview-nightly"
					if channel == "nightly" {
						other = ".omniview"
					}
					protected = filepath.Join(home, other)
					selected = filepath.Join(home, strings.ToUpper(other))
				}
				for _, path := range []string{protected, selected} {
					if _, err := os.Lstat(path); !os.IsNotExist(err) {
						t.Fatalf("prospective profile endpoint already exists: %s %v", path, err)
					}
				}
				if _, err := Resolve(Options{Home: home, CWD: t.TempDir(), StateRoot: selected, Channel: channel, Generation: fixtureID}); err == nil {
					t.Errorf("%s accepted prospective reserved %s case variant with both endpoints absent: %s", channel, kind, selected)
				}
				for _, path := range []string{protected, selected, filepath.Join(home, ".omniview-dev"), filepath.Join(home, ".OMNIVIEW-DEV"), filepath.Join(home, ".omniview"), filepath.Join(home, ".omniview-nightly")} {
					if _, err := os.Lstat(path); !os.IsNotExist(err) {
						t.Errorf("read-only resolution created prospective profile path: %s %v", path, err)
					}
				}
			})
		}
	}
}

func TestProductionReservedNamespaceBoundariesAndHomeIdentity(t *testing.T) {
	for _, channel := range []string{"stable", "nightly"} {
		t.Run(channel, func(t *testing.T) {
			arena, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			home := filepath.Join(arena, "home")
			if err := os.Mkdir(home, 0700); err != nil {
				t.Fatal(err)
			}
			other, own := ".omniview-nightly", ".omniview"
			if channel == "nightly" {
				other, own = own, other
			}
			for _, tc := range []struct {
				name, root string
				reject     bool
			}{
				{"other channel descendant", filepath.Join(home, strings.ToUpper(other), "state"), true},
				{"development parent", filepath.Join(home, ".OMNIVIEW-DEV"), true},
				{"development uppercase profiles", filepath.Join(home, ".OMNIVIEW-DEV", "PROFILES", fixtureID, "state"), true},
				{"other channel prefix sibling", filepath.Join(home, strings.ToUpper(other)+"-backup"), false},
				{"development prefix sibling", filepath.Join(home, ".OMNIVIEW-DEV-backup", "profiles"), false},
				{"profiles prefix sibling", filepath.Join(home, ".OMNIVIEW-DEV", "profiles-backup"), false},
				{"unreserved development child", filepath.Join(home, ".OMNIVIEW-DEV", "settings"), false},
				{"own channel case variant", filepath.Join(home, strings.ToUpper(own)), false},
			} {
				t.Run(tc.name, func(t *testing.T) {
					profile, err := Resolve(Options{Home: home, CWD: t.TempDir(), StateRoot: tc.root, Channel: channel, Generation: fixtureID})
					if tc.reject {
						if err == nil {
							t.Errorf("accepted reserved production override %s", tc.root)
						}
					} else {
						if err != nil {
							t.Fatalf("rejected unreserved production override: %v", err)
						}
						if profile.Descriptor.StateRoot != tc.root {
							t.Errorf("unexpected unreserved root: %s", profile.Descriptor.StateRoot)
						}
					}
					if _, err := os.Lstat(tc.root); !os.IsNotExist(err) {
						t.Errorf("namespace validation created state: %v", err)
					}
				})
			}
			t.Run("case variant home identity", func(t *testing.T) {
				variantHome, same := caseVariantProfileRoot(t, home)
				selected := filepath.Join(variantHome, strings.ToUpper(other))
				profile, err := Resolve(Options{Home: home, CWD: t.TempDir(), StateRoot: selected, Channel: channel, Generation: fixtureID})
				if same {
					if err == nil {
						t.Error("physical HOME alias bypassed reserved namespace")
					}
				} else {
					if err != nil {
						t.Fatalf("reserved namespace leaked into a distinct case-sensitive HOME sibling: %v", err)
					}
					if profile.Descriptor.StateRoot != selected {
						t.Errorf("wrong distinct HOME sibling root: %s", profile.Descriptor.StateRoot)
					}
				}
				if _, err := os.Lstat(selected); !os.IsNotExist(err) {
					t.Errorf("HOME identity validation created state: %v", err)
				}
			})
		})
	}
}
