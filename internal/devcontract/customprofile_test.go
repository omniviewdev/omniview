package devcontract

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gofrs/flock"
	"github.com/omniviewdev/plugin-sdk/pkg/profilecontract"
	"github.com/omniviewdev/plugin-sdk/pkg/state"
)

func customFixture(t *testing.T) (ResolvedWorkspace, string, string) {
	t.Helper()
	base, err := CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	home := filepath.Join(base, "home")
	if err := os.MkdirAll(home, 0700); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(base, "workspace")
	saveFixture(t, root)
	w, err := ResolveWorkspace(ResolveOptions{Explicit: root, Home: home})
	if err != nil {
		t.Fatal(err)
	}
	return w, home, filepath.Join(base, "custom", "state")
}

func TestProductionProfileIsolationWithMissingCustomOwner(t *testing.T) {
	w, home, state := customFixture(t)
	if _, err := SetCustomProfile(context.Background(), w, state, home); err != nil {
		t.Fatal(err)
	}
	container := filepath.Dir(state)
	owner := filepath.Join(container, ".omniview-profile.json")
	if err := os.Remove(owner); err != nil {
		t.Fatal(err)
	}
	registry := filepath.Join(home, ".omniview-dev", "custom-profiles.json")
	before, err := os.ReadFile(registry)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name         string
		root         string
		wantConflict bool
	}{
		{"unrelated default", filepath.Join(home, ".omniview"), false},
		{"unrelated sibling", container + "-production", false},
		{"state", state, true},
		{"container", container, true},
		{"descendant", filepath.Join(state, "nested"), true},
		{"container sibling state", filepath.Join(container, "runtime"), true},
		{"ancestor", filepath.Dir(container), true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateProductionProfileIsolation(tc.root, home)
			if tc.wantConflict {
				if ExitCode(err) != 4 {
					t.Fatalf("missing owner erased durable overlap protection: %v", err)
				}
			} else if err != nil {
				t.Fatalf("unrelated missing owner blocked production: %v", err)
			}
		})
	}
	if err := ValidateCustomProfileClaim(state, w.Manifest.WorkspaceID, home); ExitCode(err) != 4 {
		t.Fatalf("development accepted missing owner: %v", err)
	}
	if _, err := os.Lstat(owner); !os.IsNotExist(err) {
		t.Fatalf("validation recreated missing owner: %v", err)
	}
	if _, err := os.Lstat(state); !os.IsNotExist(err) {
		t.Fatalf("validation created state: %v", err)
	}
	after, err := os.ReadFile(registry)
	if err != nil || string(after) != string(before) {
		t.Fatalf("validation changed durable registry: %v", err)
	}
}

func TestCustomProfileBindingPreservesAbsentStateAndResolves(t *testing.T) {
	w, home, state := customFixture(t)
	selected, err := SetCustomProfile(context.Background(), w, state, home)
	if err != nil {
		t.Fatal(err)
	}
	if selected.StateRoot != state {
		t.Fatalf("selected %q, want %q", selected.StateRoot, state)
	}
	if _, err := os.Lstat(state); !os.IsNotExist(err) {
		t.Fatalf("binding created state before baseline publication: %v", err)
	}
	for _, path := range []string{filepath.Join(w.Root, ".local", "profile.json"), filepath.Join(filepath.Dir(state), ".omniview-profile.json"), filepath.Join(home, ".omniview-dev", "custom-profiles.json")} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0600 {
			t.Fatalf("metadata is not private: %s %v", path, info.Mode())
		}
	}
	if _, err := SetCustomProfile(context.Background(), selected, state, home); err != nil {
		t.Fatalf("idempotent binding: %v", err)
	}
	resolved, err := ResolveWorkspace(ResolveOptions{Explicit: w.ManifestPath, Home: home, StateRoot: state})
	if err != nil || resolved.StateRoot != state {
		t.Fatalf("read-only custom selection: %+v %v", resolved, err)
	}
	if _, err := os.Lstat(state); !os.IsNotExist(err) {
		t.Fatalf("resolution created state: %v", err)
	}
	if _, err := ResolveWorkspace(ResolveOptions{Explicit: w.ManifestPath, Home: home, StateRoot: w.StateRoot}); ExitCode(err) != 4 {
		t.Fatalf("environment disagreement accepted: %v", err)
	}
}

func TestCustomProfileRejectsUnsafeClaims(t *testing.T) {
	for _, kind := range []string{"relative", "wrong leaf", "production", "nightly", "default profiles", "workspace", "nonempty", "symlink", "dangling"} {
		t.Run(kind, func(t *testing.T) {
			w, home, state := customFixture(t)
			switch kind {
			case "relative":
				state = "custom/state"
			case "wrong leaf":
				state = filepath.Join(filepath.Dir(state), "settings")
			case "production":
				state = filepath.Join(home, ".omniview", "child", "state")
			case "nightly":
				state = filepath.Join(home, ".omniview-nightly", "state")
			case "default profiles":
				state = filepath.Join(home, ".omniview-dev", "profiles", "custom", "state")
			case "workspace":
				state = filepath.Join(w.Root, "nested", "state")
			case "nonempty":
				if err := os.MkdirAll(filepath.Dir(state), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(filepath.Dir(state), "foreign"), []byte("keep"), 0600); err != nil {
					t.Fatal(err)
				}
			case "symlink", "dangling":
				target := filepath.Join(home, "redirected")
				if kind == "symlink" {
					if err := os.MkdirAll(target, 0700); err != nil {
						t.Fatal(err)
					}
				}
				if err := os.Symlink(target, filepath.Dir(state)); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := SetCustomProfile(context.Background(), w, state, home); err == nil {
				t.Fatal("unsafe custom claim accepted")
			}
		})
	}
}

func TestCustomProfileRegistryRejectsForeignAndNestedClaims(t *testing.T) {
	w, home, state := customFixture(t)
	selected, err := SetCustomProfile(context.Background(), w, state, home)
	if err != nil {
		t.Fatal(err)
	}
	otherRoot := filepath.Join(filepath.Dir(w.Root), "other-workspace")
	saveFixture(t, otherRoot)
	m := fixtureManifest()
	m.WorkspaceID = "4beee3e2-2450-421c-ad44-485a704c3a65"
	data, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(otherRoot, "workspace.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	other, err := ResolveWorkspace(ResolveOptions{Explicit: otherRoot, Home: home})
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{state, filepath.Join(filepath.Dir(state), "nested", "state"), filepath.Join(filepath.Dir(filepath.Dir(state)), "state")} {
		if _, err := SetCustomProfile(context.Background(), other, target, home); ExitCode(err) != 4 {
			t.Fatalf("foreign overlap accepted %q: %v", target, err)
		}
	}
	newState := filepath.Join(filepath.Dir(w.Root), "second-custom", "state")
	if _, err := SetCustomProfile(context.Background(), selected, newState, home); err != nil {
		t.Fatal(err)
	}
	if _, err := SetCustomProfile(context.Background(), other, state, home); ExitCode(err) != 4 {
		t.Fatalf("old reservation was lost on rebind: %v", err)
	}
}

func caseAliasDirectory(t *testing.T, path string) string {
	t.Helper()
	if err := os.MkdirAll(path, 0700); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(filepath.Dir(path), strings.ToUpper(filepath.Base(path)))
	original, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	aliased, err := os.Stat(alias)
	if os.IsNotExist(err) {
		t.Skip("filesystem does not alias differently cased directory names")
	}
	if err != nil {
		t.Fatal(err)
	}
	if alias == path || !os.SameFile(original, aliased) {
		t.Skip("filesystem does not alias differently cased directory names")
	}
	return alias
}

func TestCustomProfileRejectsCaseAliasedNestedClaims(t *testing.T) {
	t.Run("admission", func(t *testing.T) {
		w, home, state := customFixture(t)
		alias := caseAliasDirectory(t, filepath.Dir(state))
		selected, err := SetCustomProfile(context.Background(), w, state, home)
		if err != nil {
			t.Fatal(err)
		}
		nested := filepath.Join(alias, "nested", "state")
		if _, err := SetCustomProfile(context.Background(), selected, nested, home); ExitCode(err) != 4 {
			t.Fatalf("case-aliased nested claim accepted: %v", err)
		}
		if _, err := os.Lstat(filepath.Dir(nested)); !os.IsNotExist(err) {
			t.Fatalf("rejected claim created its container: %v", err)
		}
		resolved, err := ResolveWorkspace(ResolveOptions{Explicit: w.ManifestPath, Home: home})
		if err != nil || resolved.StateRoot != state {
			t.Fatalf("rejected claim changed the binding: %+v %v", resolved, err)
		}
	})
	t.Run("registry", func(t *testing.T) {
		w, home, state := customFixture(t)
		alias := caseAliasDirectory(t, filepath.Dir(state))
		registry := profilecontract.Claims{SchemaVersion: 1, Claims: []profilecontract.Record{
			{SchemaVersion: 1, WorkspaceID: w.Manifest.WorkspaceID, StateRoot: state},
			{SchemaVersion: 1, WorkspaceID: "4beee3e2-2450-421c-ad44-485a704c3a65", StateRoot: filepath.Join(alias, "nested", "state")},
		}}
		data, err := json.Marshal(registry)
		if err != nil {
			t.Fatal(err)
		}
		base := filepath.Join(home, ".omniview-dev")
		if err := os.MkdirAll(base, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(base, "custom-profiles.json"), data, 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := loadCustomProfiles(base, false); ExitCode(err) != 4 {
			t.Fatalf("case-aliased nested registry claims accepted: %v", err)
		}
	})
	t.Run("protected boundary", func(t *testing.T) {
		w, home, _ := customFixture(t)
		alias := caseAliasDirectory(t, w.Root)
		state := filepath.Join(alias, "nested", "state")
		if _, err := SetCustomProfile(context.Background(), w, state, home); ExitCode(err) != 4 {
			t.Fatalf("case-aliased workspace boundary accepted: %v", err)
		}
		if _, err := os.Lstat(filepath.Dir(state)); !os.IsNotExist(err) {
			t.Fatalf("rejected boundary created its container: %v", err)
		}
	})
}

func TestCustomProfilePublicationReplacesMetadata(t *testing.T) {
	base, err := CanonicalPath(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(base, "metadata", "profile.json")
	first := profilecontract.Record{SchemaVersion: 1, WorkspaceID: "4beee3e2-2450-421c-ad44-485a704c3a65", StateRoot: filepath.Join(base, "first", "state")}
	second := first
	second.StateRoot = filepath.Join(base, "second", "state")
	for _, record := range []profilecontract.Record{first, second} {
		if err := writeProfileJSON(path, record); err != nil {
			t.Fatalf("publish profile metadata: %v", err)
		}
		var actual profilecontract.Record
		if err := readProfileJSON(path, &actual); err != nil {
			t.Fatal(err)
		}
		if actual != record {
			t.Fatalf("published metadata = %+v, want %+v", actual, record)
		}
	}
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name() != "profile.json" {
		t.Fatalf("publication left temporary metadata: %v", entries)
	}
}

func TestCustomProfileRejectsMalformedOrRedirectedMetadata(t *testing.T) {
	for _, kind := range []string{"binding", "owner", "registry", "binding symlink", "owner symlink", "binding dangling", "missing owner", "missing registry"} {
		t.Run(kind, func(t *testing.T) {
			w, home, state := customFixture(t)
			if _, err := SetCustomProfile(context.Background(), w, state, home); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(w.Root, ".local", "profile.json")
			switch kind {
			case "owner", "owner symlink", "missing owner":
				path = filepath.Join(filepath.Dir(state), ".omniview-profile.json")
			case "registry", "missing registry":
				path = filepath.Join(home, ".omniview-dev", "custom-profiles.json")
			}
			if kind == "missing owner" || kind == "missing registry" {
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
			} else if kind == "binding dangling" {
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(path+".missing", path); err != nil {
					t.Fatal(err)
				}
			} else if kind == "binding symlink" || kind == "owner symlink" {
				original := path + ".original"
				if err := os.Rename(path, original); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(original, path); err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(path, []byte(`{"schemaVersion":99}`), 0600); err != nil {
				t.Fatal(err)
			}
			_, err := ResolveWorkspace(ResolveOptions{Explicit: w.ManifestPath, Home: home})
			if err == nil {
				t.Fatalf("unsafe %s accepted", kind)
			}
			if (kind == "missing owner" || kind == "missing registry") && ExitCode(err) != 4 {
				t.Fatalf("missing ownership must be a conflict, got %v", err)
			}
		})
	}
}

func TestCustomProfileResumesClaimBeforeBinding(t *testing.T) {
	w, home, state := customFixture(t)
	selected, err := SetCustomProfile(context.Background(), w, state, home)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(w.Root, ".local", "profile.json")); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(filepath.Dir(state), ".omniview-profile.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := SetCustomProfile(context.Background(), w, state, home); err != nil {
		t.Fatalf("interrupted claim did not resume: %v", err)
	}
	if err := os.MkdirAll(state, 0700); err != nil {
		t.Fatal(err)
	}
	lock := flock.New(filepath.Join(state, ".lock"))
	if err := lock.Lock(); err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if _, err := SetCustomProfile(context.Background(), selected, filepath.Join(filepath.Dir(w.Root), "new-profile", "state"), home); ExitCode(err) != 4 {
		t.Fatalf("running custom root allowed rebinding: %v", err)
	}
}

func TestCustomProfileProtectsRegisteredCollectionAndExternalSources(t *testing.T) {
	w, home, state := customFixture(t)
	collection := filepath.Join(filepath.Dir(w.Root), "registered")
	workspace := filepath.Join(collection, "workspaces", "feature")
	saveFixture(t, workspace)
	external := filepath.Join(filepath.Dir(w.Root), "external-source")
	registry := map[string]any{"schemaVersion": 1, "repositories": []any{map[string]any{"id": "omniview", "commonDir": filepath.Join(external, ".git"), "worktree": external}}}
	data, err := json.Marshal(registry)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(collection, ".omniview-dev"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(collection, ".omniview-dev", "repositories.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	registered, err := ResolveWorkspace(ResolveOptions{Explicit: workspace, Home: home})
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{filepath.Join(collection, "custom", "state"), filepath.Join(external, "custom", "state")} {
		if _, err := SetCustomProfile(context.Background(), registered, target, home); ExitCode(err) != 4 {
			t.Fatalf("source overlap accepted %q: %v", target, err)
		}
	}
	if _, err := SetCustomProfile(context.Background(), w, state, home); err != nil {
		t.Fatalf("unregistered siblings must not be overprotected: %v", err)
	}
}

func TestCustomProfileBindingRequiresStoppedLifecycle(t *testing.T) {
	for _, kind := range []string{"uuid guard", "global guard", "existing default state"} {
		t.Run(kind, func(t *testing.T) {
			w, home, state := customFixture(t)
			var release func() error
			if kind == "uuid guard" {
				var err error
				release, err = LockProfile(context.Background(), home, w.Manifest.WorkspaceID)
				if err != nil {
					t.Fatal(err)
				}
			} else {
				path := filepath.Join(home, ".omniview-dev", "custom-profiles.lock")
				if kind == "existing default state" {
					path = filepath.Join(w.StateRoot, ".lock")
				}
				if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
					t.Fatal(err)
				}
				lock := flock.New(path)
				if err := lock.Lock(); err != nil {
					t.Fatal(err)
				}
				release = lock.Close
			}
			defer release()
			if _, err := SetCustomProfile(context.Background(), w, state, home); ExitCode(err) != 4 {
				t.Fatalf("%s did not prevent binding: %v", kind, err)
			}
			if _, err := os.Lstat(filepath.Join(w.Root, ".local", "profile.json")); !os.IsNotExist(err) {
				t.Fatalf("busy operation published binding: %v", err)
			}
			if _, err := os.Lstat(filepath.Dir(state)); !os.IsNotExist(err) {
				t.Fatalf("busy operation claimed container: %v", err)
			}
		})
	}
}

func TestCustomProfileValidatesForeignOwnershipAndStateRemap(t *testing.T) {
	for _, kind := range []string{"binding identity", "owner identity", "claim identity", "state remap"} {
		t.Run(kind, func(t *testing.T) {
			w, home, state := customFixture(t)
			if _, err := SetCustomProfile(context.Background(), w, state, home); err != nil {
				t.Fatal(err)
			}
			foreign := profilecontract.Record{SchemaVersion: 1, WorkspaceID: "4beee3e2-2450-421c-ad44-485a704c3a65", StateRoot: state}
			var value any = foreign
			path := filepath.Join(w.Root, ".local", "profile.json")
			switch kind {
			case "owner identity":
				path = filepath.Join(filepath.Dir(state), ".omniview-profile.json")
			case "claim identity":
				path = filepath.Join(home, ".omniview-dev", "custom-profiles.json")
				value = profilecontract.Claims{SchemaVersion: 1, Claims: []profilecontract.Record{foreign}}
			case "state remap":
				target := filepath.Join(filepath.Dir(state), "runtime")
				if err := os.MkdirAll(target, 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(target, state); err != nil {
					t.Fatal(err)
				}
			}
			if kind != "state remap" {
				data, err := json.Marshal(value)
				if err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := ResolveWorkspace(ResolveOptions{Explicit: w.ManifestPath, Home: home}); ExitCode(err) != 4 {
				t.Fatalf("%s accepted: %v", kind, err)
			}
		})
	}
}

func TestCustomProfileResolutionPreservesInterruptedRenameRecovery(t *testing.T) {
	for _, kind := range []string{"valid rename", "outside collection", "wrong phase", "wrong target", "wrong identity", "wrong target slug"} {
		t.Run(kind, func(t *testing.T) {
			w, home, state := customFixture(t)
			if _, err := SetCustomProfile(context.Background(), w, state, home); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(filepath.Dir(w.Root), "renamed")
			manifest := w.Manifest
			manifest.Slug = "renamed"
			journal := map[string]any{"schemaVersion": 1, "workspaceID": w.Manifest.WorkspaceID, "root": w.Root, "phase": "rename", "renameTo": target, "manifest": manifest, "resources": []any{}}
			switch kind {
			case "outside collection":
				journal["root"] = filepath.Join(home, "other-workspace")
			case "wrong phase":
				journal["phase"] = "complete"
			case "wrong target":
				journal["renameTo"] = filepath.Join(filepath.Dir(w.Root), "different")
			case "wrong identity":
				journal["workspaceID"] = "4beee3e2-2450-421c-ad44-485a704c3a65"
			case "wrong target slug":
				manifest.Slug = "different"
				journal["manifest"] = manifest
			}
			data, err := json.Marshal(journal)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(w.Root, ".local", "ownership.json"), data, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Rename(w.Root, target); err != nil {
				t.Fatal(err)
			}
			resolved, err := ResolveWorkspace(ResolveOptions{Explicit: target, Home: home})
			if kind == "valid rename" {
				if err != nil || resolved.StateRoot != state {
					t.Fatalf("valid rename recovery blocked: %+v %v", resolved, err)
				}
			} else if err == nil {
				t.Fatalf("invalid rename boundary %s accepted", kind)
			}
		})
	}
}

// Both readers consume identical durable bytes; only the host validates portable
// manifest intent beyond the identity needed to prove an interrupted rename.
func TestCustomProfileProtocolReaderParity(t *testing.T) {
	for _, kind := range []string{"valid rename", "wrong phase", "wrong target", "wrong identity", "wrong manifest identity", "unsupported schema", "production intent", "wrong slug", "invalid full manifest"} {
		t.Run(kind, func(t *testing.T) {
			w, home, stateRoot := customFixture(t)
			if _, err := SetCustomProfile(context.Background(), w, stateRoot, home); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(filepath.Dir(w.Root), "renamed")
			intent := w.Manifest
			intent.Slug = "renamed"
			journal := map[string]any{"schemaVersion": 1, "workspaceID": w.Manifest.WorkspaceID, "root": w.Root, "phase": "rename", "renameTo": target}
			switch kind {
			case "wrong phase":
				journal["phase"] = "ready"
			case "wrong target":
				journal["renameTo"] = w.Root
			case "wrong identity":
				journal["workspaceID"] = "4beee3e2-2450-421c-ad44-485a704c3a65"
			case "wrong manifest identity":
				intent.WorkspaceID = "4beee3e2-2450-421c-ad44-485a704c3a65"
			case "unsupported schema":
				intent.SchemaVersion = 2
			case "production intent":
				intent.Profile.Kind = "production"
			case "wrong slug":
				intent.Slug = "different"
			case "invalid full manifest":
				intent.Repositories = nil
			}
			journal["manifest"] = intent
			before, err := json.Marshal(journal)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(w.Root, ".local", "ownership.json"), before, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Rename(w.Root, target); err != nil {
				t.Fatal(err)
			}
			t.Setenv("HOME", home)
			t.Setenv("USERPROFILE", home)
			t.Setenv(state.WorkspaceFileEnvironment, filepath.Join(target, "workspace.json"))
			t.Setenv(state.StateDirectoryEnvironment, stateRoot)
			host, hostErr := ResolveWorkspace(ResolveOptions{Explicit: target, Home: home})
			sdk, sdkErr := state.ResolveRoot()
			hostAccepts := kind == "valid rename"
			sdkAccepts := hostAccepts || kind == "invalid full manifest"
			if (hostErr == nil) != hostAccepts || hostErr == nil && host.StateRoot != stateRoot {
				t.Fatalf("host result: root=%q error=%v", host.StateRoot, hostErr)
			}
			if (sdkErr == nil) != sdkAccepts || sdkErr == nil && sdk != stateRoot {
				t.Fatalf("SDK result: root=%q error=%v", sdk, sdkErr)
			}
			after, err := os.ReadFile(filepath.Join(target, ".local", "ownership.json"))
			if err != nil || string(after) != string(before) {
				t.Fatalf("readers changed durable intent: %v", err)
			}
		})
	}
}

func TestReadCustomProfileBindingAfterOwnedManifestRemoval(t *testing.T) {
	w, home, state := customFixture(t)
	if _, err := SetCustomProfile(context.Background(), w, state, home); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(w.ManifestPath); err != nil {
		t.Fatal(err)
	}
	retired := filepath.Join(filepath.Dir(w.Root), ".retired-"+w.Manifest.WorkspaceID)
	if err := os.Rename(w.Root, retired); err != nil {
		t.Fatal(err)
	}
	selected, present, err := ReadCustomProfileBinding(retired, w.Manifest.WorkspaceID, home)
	if err != nil || !present || selected != state {
		t.Fatalf("owned retired binding unavailable without manifest: %q %v %v", selected, present, err)
	}
	if _, _, err := ReadCustomProfileBinding(retired, "4beee3e2-2450-421c-ad44-485a704c3a65", home); ExitCode(err) != 4 {
		t.Fatalf("foreign retired UUID accepted: %v", err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(state), ".omniview-profile.json"), []byte(`{"schemaVersion":1,"workspaceID":"4beee3e2-2450-421c-ad44-485a704c3a65","stateRoot":"`+state+`"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := ReadCustomProfileBinding(retired, w.Manifest.WorkspaceID, home); ExitCode(err) != 4 {
		t.Fatalf("tampered retired owner accepted: %v", err)
	}
}

func TestReadCustomProfileBindingAbsentDoesNotCreateMetadata(t *testing.T) {
	w, home, _ := customFixture(t)
	selected, present, err := ReadCustomProfileBinding(w.Root, w.Manifest.WorkspaceID, home)
	if err != nil || present || selected != "" {
		t.Fatalf("absent binding: %q %v %v", selected, present, err)
	}
	if _, err := os.Lstat(filepath.Join(w.Root, ".local")); !os.IsNotExist(err) {
		t.Fatalf("reader created metadata: %v", err)
	}
}

func TestValidateCustomProfileClaimAfterBindingRemoval(t *testing.T) {
	w, home, state := customFixture(t)
	if _, err := SetCustomProfile(context.Background(), w, state, home); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(w.Root, ".local", "profile.json")); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(w.ManifestPath); err != nil {
		t.Fatal(err)
	}
	if err := ValidateCustomProfileClaim(state, w.Manifest.WorkspaceID, home); err != nil {
		t.Fatalf("durable receipt claim unavailable: %v", err)
	}
	if _, err := os.Lstat(state); !os.IsNotExist(err) {
		t.Fatalf("claim validation created state: %v", err)
	}
	if err := ValidateCustomProfileClaim(state, "4beee3e2-2450-421c-ad44-485a704c3a65", home); ExitCode(err) != 4 {
		t.Fatalf("foreign receipt UUID accepted: %v", err)
	}
	if err := os.Remove(filepath.Join(filepath.Dir(state), ".omniview-profile.json")); err != nil {
		t.Fatal(err)
	}
	if err := ValidateCustomProfileClaim(state, w.Manifest.WorkspaceID, home); ExitCode(err) != 4 {
		t.Fatalf("missing external owner accepted: %v", err)
	}
}
