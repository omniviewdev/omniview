package devcontract

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func fixtureManifest() WorkspaceManifest {
	return WorkspaceManifest{SchemaVersion: 1, WorkspaceID: "f14566c4-5130-4e3f-aa09-3e49c63b29a6", Slug: "resource-graph", DisplayName: "Resource graph", Repositories: []Repository{{ID: "omniview", Directory: "omniview", BaseRef: "main", BaseCommit: "22e8241a8692b45c496b24aac3a6fb128933cb0e", Branch: "feature/resource-graph"}}, Profile: Profile{Kind: "development"}, Ports: PortPolicy{Policy: "sticky"}}
}

// Removing validation must not let malformed or escaping workspace selections reach a launcher.
func TestManifestRejectsUnsafeSelections(t *testing.T) {
	cases := []struct {
		name   string
		change func(*WorkspaceManifest)
	}{
		{"unsupported schema", func(m *WorkspaceManifest) { m.SchemaVersion = 2 }},
		{"invalid identity", func(m *WorkspaceManifest) { m.WorkspaceID = "../production" }},
		{"slug traversal", func(m *WorkspaceManifest) { m.Slug = "../main" }},
		{"empty slug", func(m *WorkspaceManifest) { m.Slug = "" }},
		{"duplicate separators", func(m *WorkspaceManifest) { m.Slug = "feature--one" }},
		{"production profile", func(m *WorkspaceManifest) { m.Profile.Kind = "production" }},
		{"escaping repository", func(m *WorkspaceManifest) { m.Repositories[0].Directory = "../main" }},
		{"absolute repository", func(m *WorkspaceManifest) { m.Repositories[0].Directory = "/main" }},
		{"duplicate repository", func(m *WorkspaceManifest) { m.Repositories = append(m.Repositories, m.Repositories[0]) }},
		{"nested repository", func(m *WorkspaceManifest) {
			m.Repositories = append(m.Repositories, Repository{ID: "ui", Directory: "omniview/ui", BaseRef: "main", BaseCommit: m.Repositories[0].BaseCommit, Branch: "feature/ui"})
		}},
		{"unresolved ref", func(m *WorkspaceManifest) { m.Repositories[0].BaseCommit = "main" }},
		{"missing host", func(m *WorkspaceManifest) { m.Repositories[0].ID = "ui" }},
		{"missing plugin source", func(m *WorkspaceManifest) {
			m.Plugins = []Plugin{{ID: "kubernetes", RepositoryID: "absent", Mode: "managed"}}
		}},
		{"duplicate plugin", func(m *WorkspaceManifest) {
			m.Plugins = []Plugin{{ID: "kubernetes", RepositoryID: "omniview", Mode: "managed"}, {ID: "kubernetes", RepositoryID: "omniview", Mode: "managed"}}
		}},
		{"unknown link", func(m *WorkspaceManifest) { s := "absent"; m.Links.UIRepositoryID = &s }},
		{"invalid port", func(m *WorkspaceManifest) { m.Ports.Overrides = map[string]int{"vite": 70000} }},
	}
	if err := fixtureManifest().Validate(); err != nil {
		t.Fatalf("valid selection rejected: %v", err)
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := fixtureManifest()
			tc.change(&m)
			if err := m.Validate(); err == nil {
				t.Fatal("unsafe selection accepted")
			}
		})
	}
}

func saveFixture(t *testing.T, dir string) string {
	t.Helper()
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(fixtureManifest())
	if err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dir, "workspace.json")
	if err = os.WriteFile(p, b, 0600); err != nil {
		t.Fatal(err)
	}
	return p
}

// Context discovery must never silently select an outer workspace or a production default.
func TestResolveWorkspacePrecedenceAndAmbiguity(t *testing.T) {
	root, canonicalErr := filepath.EvalSymlinks(t.TempDir())
	if canonicalErr != nil {
		t.Fatal(canonicalErr)
	}
	outer := saveFixture(t, root)
	inner := saveFixture(t, filepath.Join(root, "nested"))
	cwd := filepath.Join(root, "nested", "src")
	if err := os.MkdirAll(cwd, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveWorkspace(ResolveOptions{CWD: cwd}); ExitCode(err) != 3 {
		t.Fatalf("nested contexts must be ambiguous: %v", err)
	}
	selected, err := ResolveWorkspace(ResolveOptions{CWD: cwd, Explicit: outer})
	if err != nil {
		t.Fatal(err)
	}
	if selected.ManifestPath != outer {
		t.Fatalf("explicit target lost: %s", selected.ManifestPath)
	}
	selected, err = ResolveWorkspace(ResolveOptions{CWD: cwd, EnvironmentManifest: inner})
	if err != nil {
		t.Fatal(err)
	}
	if selected.ManifestPath != inner {
		t.Fatalf("environment target lost: %s", selected.ManifestPath)
	}
	if _, err = ResolveWorkspace(ResolveOptions{CWD: t.TempDir()}); ExitCode(err) != 3 {
		t.Fatalf("missing context must not fall back: %v", err)
	}
	if _, err = ResolveWorkspace(ResolveOptions{CWD: cwd, Explicit: outer, EnvironmentManifest: inner}); ExitCode(err) != 4 {
		t.Fatalf("conflicting target must fail: %v", err)
	}
}

// Symlinked source trees must not bypass feature-root containment.
func TestResolveWorkspaceRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	saveFixture(t, root)
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "omniview")); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveWorkspace(ResolveOptions{CWD: root}); ExitCode(err) != 4 {
		t.Fatalf("symlink escape accepted: %v", err)
	}
}

func TestResolveWorkspaceRejectsCanonicalRepositoryOverlap(t *testing.T) {
	for _, target := range []string{"omniview", filepath.Join("omniview", "child")} {
		t.Run(target, func(t *testing.T) {
			root, home := t.TempDir(), t.TempDir()
			m := fixtureManifest()
			m.Repositories = append(m.Repositories, Repository{ID: "ui", Directory: "ui", BaseRef: "main", BaseCommit: m.Repositories[0].BaseCommit, Branch: "feature/ui"})
			saveFixture(t, root)
			data, err := json.Marshal(m)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "workspace.json"), data, 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Join(root, target), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(target, filepath.Join(root, "ui")); err != nil {
				t.Fatal(err)
			}
			if _, err := ResolveWorkspace(ResolveOptions{Explicit: root, Home: home}); ExitCode(err) != 4 {
				t.Fatalf("canonical repository overlap accepted: %v", err)
			}
		})
	}
}

func TestResolveWorkspaceRejectsForeignProfileAliases(t *testing.T) {
	for _, alias := range []string{"state", "profile", "nested state"} {
		t.Run(alias, func(t *testing.T) {
			root, home := t.TempDir(), t.TempDir()
			saveFixture(t, root)
			profiles := filepath.Join(home, ".omniview-dev", "profiles")
			own := filepath.Join(profiles, fixtureManifest().WorkspaceID)
			foreign := filepath.Join(profiles, "4beee3e2-2450-421c-ad44-485a704c3a65")
			if err := os.MkdirAll(filepath.Join(foreign, "state", "child"), 0700); err != nil {
				t.Fatal(err)
			}
			link, target := own, foreign
			if alias != "profile" {
				if err := os.MkdirAll(own, 0700); err != nil {
					t.Fatal(err)
				}
				link, target = filepath.Join(own, "state"), filepath.Join(foreign, "state")
				if alias == "nested state" {
					target = filepath.Join(target, "child")
				}
			}
			if err := os.Symlink(target, link); err != nil {
				t.Fatal(err)
			}
			if _, err := ResolveWorkspace(ResolveOptions{Explicit: root, Home: home}); ExitCode(err) != 4 {
				t.Fatalf("foreign profile alias accepted: %v", err)
			}
		})
	}
}

func TestResolveWorkspaceAcceptsCanonicalHomeAncestor(t *testing.T) {
	root, parent := t.TempDir(), t.TempDir()
	saveFixture(t, root)
	realHome := filepath.Join(parent, "real-home")
	if err := os.MkdirAll(realHome, 0700); err != nil {
		t.Fatal(err)
	}
	aliasHome := filepath.Join(parent, "home")
	if err := os.Symlink(realHome, aliasHome); err != nil {
		t.Fatal(err)
	}
	selected, err := ResolveWorkspace(ResolveOptions{Explicit: root, Home: aliasHome})
	if err != nil {
		t.Fatal(err)
	}
	canonicalHome, err := CanonicalPath(realHome)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(canonicalHome, ".omniview-dev", "profiles", fixtureManifest().WorkspaceID, "state"); selected.StateRoot != want {
		t.Fatalf("state root = %q, want %q", selected.StateRoot, want)
	}
}

func TestResolveWorkspaceRejectsDanglingSymlinkIdentity(t *testing.T) {
	for _, alias := range []string{"repository", "state", "profile ancestor"} {
		t.Run(alias, func(t *testing.T) {
			root, home := t.TempDir(), t.TempDir()
			saveFixture(t, root)
			profiles := filepath.Join(home, ".omniview-dev", "profiles")
			link := filepath.Join(root, "omniview")
			target := filepath.Join(t.TempDir(), "missing-repository")
			if alias != "repository" {
				link = filepath.Join(profiles, fixtureManifest().WorkspaceID)
				target = filepath.Join(profiles, "4beee3e2-2450-421c-ad44-485a704c3a65")
				if alias == "state" {
					link = filepath.Join(link, "state")
					target = filepath.Join(target, "state")
				}
			}
			if err := os.MkdirAll(filepath.Dir(link), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(target, link); err != nil {
				t.Fatal(err)
			}
			if selected, err := ResolveWorkspace(ResolveOptions{Explicit: root, Home: home}); err == nil {
				t.Fatalf("dangling symlink accepted as canonical workspace identity: %+v", selected)
			}
		})
	}
}

func TestResolveWorkspaceDanglingManifestIsMissingTarget(t *testing.T) {
	root, home := t.TempDir(), t.TempDir()
	saveFixture(t, root)
	link := filepath.Join(root, "missing-workspace.json")
	if err := os.Symlink(filepath.Join(root, "missing", "workspace.json"), link); err != nil {
		t.Fatal(err)
	}
	for _, options := range []ResolveOptions{
		{CWD: root, Home: home, Explicit: link},
		{CWD: root, Home: home, EnvironmentManifest: link},
		{CWD: root, Home: home, Explicit: link, EnvironmentManifest: link},
	} {
		_, err := ResolveWorkspace(options)
		failure, ok := err.(*Error)
		if !ok || ExitCode(err) != 3 || failure.Code != "missing_workspace" {
			t.Fatalf("dangling manifest must be a structured missing target, got %v", err)
		}
	}
}

func TestResolveWorkspaceRejectsStateNamespaceRemapping(t *testing.T) {
	for _, destination := range []string{".", "runtime", "webview", "other-state"} {
		t.Run(destination, func(t *testing.T) {
			root, home := t.TempDir(), t.TempDir()
			saveFixture(t, root)
			profile := filepath.Join(home, ".omniview-dev", "profiles", fixtureManifest().WorkspaceID)
			target := filepath.Join(profile, destination)
			if err := os.MkdirAll(target, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(target, filepath.Join(profile, "state")); err != nil {
				t.Fatal(err)
			}
			if _, err := ResolveWorkspace(ResolveOptions{Explicit: root, Home: home}); ExitCode(err) != 4 {
				t.Fatalf("state remap to %q must fail with exit 4: %v", destination, err)
			}
		})
	}
}
