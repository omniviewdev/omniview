package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devworkspace"
)

// cliEdgeFixture uses real Git worktrees, but never starts an application or installer.
type cliEdgeFixture struct {
	t         *testing.T
	root      string
	workspace devworkspace.Workspace
}

func newCLIEdgeFixture(t *testing.T) cliEdgeFixture {
	t.Helper()
	t.Setenv("HOME", t.TempDir())
	t.Setenv(devcontract.WorkspaceEnvironment, "")
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	root := t.TempDir()
	f := cliEdgeFixture{t: t, root: root}
	args := []string{"workspace", "init", "--root", root, "--json"}
	for _, repo := range []struct{ id, plugin string }{{"omniview", ""}, {"omniview-plugin-edge", "edge"}} {
		source := filepath.Join(t.TempDir(), repo.id)
		if err := os.MkdirAll(source, 0700); err != nil {
			t.Fatal(err)
		}
		for _, command := range [][]string{{"init", "-b", "main"}, {"config", "user.name", "Fixture"}, {"config", "user.email", "fixture@example.invalid"}} {
			cliEdgeGit(t, source, command...)
		}
		if err := os.WriteFile(filepath.Join(source, "tracked"), []byte("source sentinel\n"), 0600); err != nil {
			t.Fatal(err)
		}
		if repo.plugin != "" {
			if err := os.WriteFile(filepath.Join(source, "plugin.yaml"), []byte("id: edge\nname: Edge\nversion: 1.0.0\n"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		cliEdgeGit(t, source, "add", ".")
		cliEdgeGit(t, source, "commit", "-m", "initial")
		args = append(args, "--source", repo.id+"="+source, "--source-ref", repo.id+"=main")
	}
	f.success(args...)
	if err := json.Unmarshal(f.success("workspace", "create", "feature", "--root", root, "--json"), &f.workspace); err != nil {
		t.Fatal(err)
	}
	return f
}

func cliEdgeGit(t *testing.T, directory string, args ...string) {
	t.Helper()
	command := exec.Command("git", args...)
	command.Dir = directory
	command.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+os.DevNull, "GIT_TERMINAL_PROMPT=0")
	if raw, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %s: %v", args, raw, err)
	}
}

func (f cliEdgeFixture) success(args ...string) []byte {
	f.t.Helper()
	var out, diagnostics bytes.Buffer
	if code := run(args, &out, &diagnostics); code != 0 {
		f.t.Fatalf("%v: exit=%d stdout=%s stderr=%s", args, code, &out, &diagnostics)
	}
	return out.Bytes()
}

func (f cliEdgeFixture) manifest() []byte {
	f.t.Helper()
	raw, err := os.ReadFile(f.workspace.ManifestPath)
	if err != nil {
		f.t.Fatal(err)
	}
	return raw
}

func TestWorkspaceEditAddsPluginAndItsPortTogetherEdges(t *testing.T) {
	f := newCLIEdgeFixture(t)
	f.success("workspace", "edit", "feature", "--root", f.root, "--add-plugin", "edge", "--port", "plugin-vite:edge=43129", "--json")
	var manifest devcontract.WorkspaceManifest
	if err := json.Unmarshal(f.manifest(), &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest.Plugins) != 1 || manifest.Plugins[0].ID != "edge" || manifest.Ports.Overrides["plugin-vite:edge"] != 43129 {
		t.Fatalf("plugin selection and port were not committed together: %+v", manifest)
	}
	for _, repo := range manifest.Repositories {
		if repo.ID == "omniview-plugin-edge" {
			if raw, err := os.ReadFile(filepath.Join(f.workspace.Root, repo.Directory, "plugin.yaml")); err != nil || !bytes.Contains(raw, []byte("id: edge")) {
				t.Fatalf("plugin worktree absent: %s %v", raw, err)
			}
			return
		}
	}
	t.Fatal("plugin selection has no source worktree")
}

type cliEdgeBrokenOutput struct{}

func (cliEdgeBrokenOutput) Write([]byte) (int, error) { return 0, errors.New("consumer closed output") }

func TestWorkspaceMutationOutputFailurePersistsHonestStateEdges(t *testing.T) {
	for _, jsonMode := range []bool{false, true} {
		t.Run(map[bool]string{false: "text", true: "json"}[jsonMode], func(t *testing.T) {
			f := newCLIEdgeFixture(t)
			args := []string{"workspace", "edit", "feature", "--root", f.root, "--name", "Persisted despite output failure"}
			if jsonMode {
				args = append(args, "--json")
			}
			var diagnostics bytes.Buffer
			code := run(args, cliEdgeBrokenOutput{}, &diagnostics)
			var manifest devcontract.WorkspaceManifest
			if err := json.Unmarshal(f.manifest(), &manifest); err != nil {
				t.Fatal(err)
			}
			if manifest.DisplayName != "Persisted despite output failure" {
				t.Fatalf("output failure rolled back completed mutation: %+v", manifest)
			}
			if code == 0 {
				t.Fatalf("successful exit despite failed result delivery: stderr=%s", &diagnostics)
			}
		})
	}
}

func TestWorkspaceConflictingEditsLeaveManifestUnchangedEdges(t *testing.T) {
	for _, flags := range [][]string{
		{"--ref", "omniview=main", "--ref", "omniview=other"},
		{"--add-plugin", "edge", "--remove-plugin", "edge"},
		{"--add-repo", "omniview", "--remove-repo", "omniview"},
		{"--port", "vite=43129", "--port", "vite=43130"},
	} {
		t.Run(flags[0]+flags[1], func(t *testing.T) {
			f := newCLIEdgeFixture(t)
			if flags[0] == "--ref" {
				// Both refs must resolve, otherwise a missing ref could hide a
				// regression that incorrectly accepts the last assignment.
				cliEdgeGit(t, filepath.Join(f.workspace.Root, "omniview"), "branch", "other")
			}
			before := f.manifest()
			args := append([]string{"workspace", "edit", "feature", "--root", f.root, "--name", "Must not persist", "--json"}, flags...)
			var out, diagnostics bytes.Buffer
			code := run(args, &out, &diagnostics)
			if after := f.manifest(); !bytes.Equal(before, after) {
				t.Errorf("conflicting edit changed manifest: %s", after)
			}
			if code == 0 {
				t.Errorf("conflicting edit accepted: %s", &out)
			}
		})
	}
}

func TestWorkspaceExplicitInvalidPathNeverMutatesEnvironmentDecoyEdges(t *testing.T) {
	for _, malformed := range []bool{false, true} {
		t.Run(map[bool]string{false: "missing", true: "malformed"}[malformed], func(t *testing.T) {
			f := newCLIEdgeFixture(t)
			t.Setenv(devcontract.WorkspaceEnvironment, f.workspace.ManifestPath)
			explicit := filepath.Join(t.TempDir(), "workspace.json")
			if malformed {
				if err := os.WriteFile(explicit, []byte("{broken"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			before := f.manifest()
			for _, verb := range []string{"edit", "remove", "resume", "rollback", "recover"} {
				args := []string{"workspace", verb, "--workspace", explicit, "--json"}
				if verb == "edit" {
					args = append(args, "--name", "Wrong target")
				}
				var out, diagnostics bytes.Buffer
				if code := run(args, &out, &diagnostics); code == 0 {
					t.Errorf("%s accepted invalid explicit target: %s", verb, &out)
				}
				if after := f.manifest(); !bytes.Equal(before, after) {
					t.Fatalf("%s mutated environment decoy: %s", verb, after)
				}
			}
		})
	}
}

func TestWorkspaceMalformedExplicitEvidenceAggregatesWithoutMutationEdges(t *testing.T) {
	f := newCLIEdgeFixture(t)
	before := f.manifest()
	proof := filepath.Join(t.TempDir(), "proof.json")
	if err := os.WriteFile(proof, []byte("{broken"), 0600); err != nil {
		t.Fatal(err)
	}
	var out, diagnostics bytes.Buffer
	code := run([]string{"workspace", "preflight", "feature", "--root", f.root, "--link-evidence", proof, "--json"}, &out, &diagnostics)
	var report devworkspace.LaunchPreflight
	if err := json.Unmarshal(out.Bytes(), &report); err != nil {
		t.Fatalf("invalid report: %s %v", &out, err)
	}
	counts := map[string]int{}
	for _, issue := range report.Issues {
		counts[issue.Code]++
	}
	if code != 3 || report.Ready || len(report.Issues) != 3 || counts["invalid_link_evidence"] != 1 || counts["reviewed_sdk_required"] != 1 || counts["sdk_source_required"] != 1 {
		t.Fatalf("explicit malformed evidence lost independent issues: code=%d report=%+v", code, report)
	}
	if after := f.manifest(); !bytes.Equal(before, after) {
		t.Fatal("preflight changed manifest")
	}
}
