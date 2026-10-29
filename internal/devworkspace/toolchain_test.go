package devworkspace

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func TestPNPMToolchainRejectsUnselectedPinsBeforeCreatingFiles(t *testing.T) {
	g := graphFixture(t)
	if _, _, err := g.PNPMCommand(context.Background(), "10.34.7"); err == nil {
		t.Fatal("accepted unproved/unselected pnpm pin")
	}
	if _, err := os.Stat(filepath.Join(g.workspace.Root, ".local", "toolchains")); !os.IsNotExist(err) {
		t.Fatalf("invalid pin created toolchain outputs: %v", err)
	}
}

// Parent-only real toolchain barrier: no mock pnpm or installed package deps.
// The native pinned pnpm runs an outer script, which launches a bare nested
// pnpm script through PATH under the inherited Corepack marker.
func TestPinnedPNPMNestedScriptProbe(t *testing.T) {
	if os.Getenv("A15_PINNED_PNPM_PROBE") != "1" {
		t.Skip("parent-only real pinned pnpm nested-script probe")
	}
	pins := []string{"12.14.0"}
	for _, pin := range pins {
		t.Run(pin, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "collection with spaces", "workspaces", "feature with spaces")
			if err := os.MkdirAll(filepath.Join(root, ".local"), 0700); err != nil {
				t.Fatal(err)
			}
			root, err := filepath.EvalSymlinks(root)
			if err != nil {
				t.Fatal(err)
			}
			consumer := filepath.Join(root, "consumer with spaces")
			if err = os.MkdirAll(consumer, 0700); err != nil {
				t.Fatal(err)
			}
			report := filepath.Join(consumer, "nested result.json")
			pkg := map[string]any{"name": "real-pinned-nested-fixture", "private": true, "packageManager": "pnpm@" + pin, "scripts": map[string]string{"outer": "pnpm run inner -- \"argument with spaces\"", "inner": "node inner.cjs"}}
			raw, _ := json.Marshal(pkg)
			if err = os.WriteFile(filepath.Join(consumer, "package.json"), raw, 0600); err != nil {
				t.Fatal(err)
			}
			inner := `const fs = require('node:fs');
fs.writeFileSync(process.env.A15_NESTED_REPORT, JSON.stringify({agent:process.env.npm_config_user_agent,argv:process.argv.slice(2),marker:process.env.COREPACK_ROOT,cwd:process.cwd()}));
`
			if err = os.WriteFile(filepath.Join(consumer, "inner.cjs"), []byte(inner), 0600); err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(filepath.Join(consumer, "pnpm-workspace.yaml"), []byte("packages: []\n"), 0600); err != nil {
				t.Fatal(err)
			}
			w := Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: root, Manifest: devcontract.WorkspaceManifest{WorkspaceID: "33333333-3333-4333-8333-333333333333", Repositories: []devcontract.Repository{{ID: "omniview", Directory: "consumer with spaces"}}}}}
			registerCompositionFixture(t, &w)
			plan, err := makeLinkPlan(w)
			if err != nil {
				t.Fatal(err)
			}
			for _, file := range plan.Composition.Files {
				if err := os.WriteFile(file.Path, file.Data, 0600); err != nil {
					t.Fatal(err)
				}
			}
			g := &BuildGraph{workspace: w, plan: plan, options: BuildOptions{Generation: "44444444-4444-4444-8444-444444444444"}}
			program, args, err := g.PNPMCommand(context.Background(), pin, "run", "outer")
			if err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command(program, args...)
			cmd.Dir = consumer
			cmd.Env = append(os.Environ(), "GOWORK=off", "GOFLAGS=", "OMNIVIEW_PNPM_NODE_PATH=", "COREPACK_ROOT=inherited-marker-must-not-select-global", "A15_NESTED_REPORT="+report)
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("actual pinned nested script failed: %v\n%s", err, output)
			}
			raw, err = os.ReadFile(report)
			if err != nil {
				t.Fatal(err)
			}
			var got struct {
				Agent       string
				Argv        []string
				Marker, Cwd string
			}
			if err = json.Unmarshal(raw, &got); err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(got.Agent, "pnpm/"+pin+" ") {
				t.Fatalf("nested script used another pnpm: %+v", got)
			}
			if got.Marker == "" {
				t.Fatal("probe accidentally removed Corepack marker rather than fixing executable selection")
			}
			if got.Cwd != consumer || len(got.Argv) == 0 || got.Argv[len(got.Argv)-1] != "argument with spaces" {
				t.Fatalf("nested argv/cwd changed: %+v", got)
			}
			tool, err := g.preparePNPMToolchain(context.Background(), pin)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(tool.directory, "pnpm-"+pin) {
				t.Fatalf("launcher pin boundary missing: %s", tool.directory)
			}
		})
	}
}

func TestPNPMLauncherRejectsInvalidExplicitNodeWithoutFallback(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("actual Node is required for launcher behavior")
	}
	node, err = filepath.EvalSymlinks(node)
	if err != nil {
		t.Fatal(err)
	}
	root := linkFixtureRoot(t)
	child := filepath.Join(root, "child.cjs")
	if err = os.WriteFile(child, []byte(`console.log("default fallback must not execute");`), 0600); err != nil {
		t.Fatal(err)
	}
	files, err := nativePNPMLauncherFiles(node, node, "12.14.0", root)
	if err != nil {
		t.Fatal(err)
	}
	launcher := filepath.Join(root, "pnpm.cjs")
	if err = os.WriteFile(launcher, files[0].Data, 0600); err != nil {
		t.Fatal(err)
	}
	for _, override := range []string{"relative-node", filepath.Join(root, "missing-node")} {
		cmd := exec.Command(node, launcher)
		cmd.Env = append(os.Environ(), "GOWORK=off", "GOFLAGS=", "OMNIVIEW_PNPM_NODE_PATH="+override)
		raw, err := cmd.CombinedOutput()
		if err == nil || strings.Contains(string(raw), "default fallback must not execute") {
			t.Fatalf("invalid explicit Node fell back: %q output=%s err=%v", override, raw, err)
		}
	}
}

func TestGraphCommandClearsAmbientNodeOverride(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("actual Node is required for command environment behavior")
	}
	t.Setenv("OMNIVIEW_PNPM_NODE_PATH", "ambient-node-must-not-override")
	g := graphFixture(t)
	raw, err := g.command(context.Background(), g.workspace.Root, node, "-e", `process.stdout.write(JSON.stringify({override:process.env.OMNIVIEW_PNPM_NODE_PATH}));`)
	if err != nil {
		t.Fatal(err)
	}
	var got struct{ Override string }
	if err = json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.Override != "" {
		t.Fatalf("ambient Node override leaked into plain graph command: %q", got.Override)
	}
}

func TestPrivateNodeAliasesExecuteActualRenamedRuntime(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("actual Node is required for renamed-runtime behavior")
	}
	node, err = filepath.EvalSymlinks(node)
	if err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	runtimeRoot := filepath.Join(root, "runtime package with spaces")
	bin := filepath.Join(runtimeRoot, "bin")
	if err = os.MkdirAll(bin, 0700); err != nil {
		t.Fatal(err)
	}
	// Homebrew's Node executable loads libnode through @loader_path/../lib.
	// Preserve that distribution layout without copying or editing its libraries.
	// Self-contained Node distributions do not have an adjacent lib directory.
	if runtime.GOOS == "darwin" {
		libraryDirectory := filepath.Join(filepath.Dir(filepath.Dir(node)), "lib")
		info, statErr := os.Stat(libraryDirectory)
		if statErr != nil && !os.IsNotExist(statErr) {
			t.Fatal(statErr)
		}
		if statErr == nil {
			if !info.IsDir() {
				t.Fatalf("Node distribution library path is not a directory: %s", libraryDirectory)
			}
			if err = os.Symlink(libraryDirectory, filepath.Join(runtimeRoot, "lib")); err != nil {
				t.Fatal(err)
			}
		}
	}
	renamed := filepath.Join(bin, "renamed-runtime with spaces")
	if runtime.GOOS == "windows" {
		renamed += ".exe"
	}
	source, err := os.Open(node)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	target, err := os.OpenFile(renamed, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
	if err != nil {
		t.Fatal(err)
	}
	_, copyErr := io.Copy(target, source)
	closeErr := target.Close()
	if copyErr != nil {
		t.Fatal(copyErr)
	}
	if closeErr != nil {
		t.Fatal(closeErr)
	}
	if err = os.Chmod(renamed, 0700); err != nil {
		t.Fatal(err)
	}
	files, err := nativePNPMLauncherFiles(node, node, "12.14.0", root)
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		path := filepath.Join(root, file.Name)
		if err = os.WriteFile(path, file.Data, file.Mode); err != nil {
			t.Fatal(err)
		}
		if err = os.Chmod(path, file.Mode); err != nil {
			t.Fatal(err)
		}
	}
	child := `console.log(JSON.stringify({node:process.execPath,argv:process.argv.slice(2)}));`
	if err = os.WriteFile(filepath.Join(root, "inner.cjs"), []byte(child), 0600); err != nil {
		t.Fatal(err)
	}
	for _, selection := range []struct{ name, override, want string }{{"explicit renamed", renamed, renamed}, {"detected default", "", node}} {
		t.Run(selection.name, func(t *testing.T) {
			env := append(os.Environ(), "GOWORK=off", "GOFLAGS=", "PATH="+root+string(os.PathListSeparator)+os.Getenv("PATH"), "OMNIVIEW_PNPM_NODE_PATH="+selection.override)
			assertRuntime := func(cmd *exec.Cmd) {
				t.Helper()
				cmd.Dir = root
				cmd.Env = env
				raw, err := cmd.CombinedOutput()
				if err != nil {
					t.Fatalf("actual node alias failed: %v\n%s", err, raw)
				}
				var got struct {
					Node string
					Argv []string
				}
				if err = json.Unmarshal(raw, &got); err != nil {
					t.Fatal(err)
				}
				if got.Node != selection.want || len(got.Argv) != 1 || got.Argv[0] != "argument with spaces" {
					t.Fatalf("actual runtime/argv changed: %+v want %s", got, selection.want)
				}
			}
			if runtime.GOOS == "windows" {
				shell, err := exec.LookPath("cmd.exe")
				if err != nil {
					t.Fatal(err)
				}
				assertRuntime(exec.Command(shell, "/d", "/s", "/c", `node inner.cjs "argument with spaces"`))
			} else {
				assertRuntime(exec.Command("/bin/sh", "-c", `node inner.cjs "argument with spaces"`))
				shebang := filepath.Join(root, "env-node")
				if err = os.WriteFile(shebang, []byte("#!/usr/bin/env node\n"+child), 0700); err != nil {
					t.Fatal(err)
				}
				assertRuntime(exec.Command(shebang, "argument with spaces"))
			}
		})
	}
}

func TestNativePNPMRefusesActualWrongVersionAndNoncanonicalOverride(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("actual native Node is required for mismatch refusal")
	}
	node, err = filepath.EvalSymlinks(node)
	if err != nil {
		t.Fatal(err)
	}
	g := graphFixture(t)
	t.Setenv("OMNIVIEW_PNPM_EXECUTABLE", node)
	version, err := exec.Command(node, "--version").Output()
	if err != nil {
		t.Fatal(err)
	}
	if actual, err := g.resolveNativePNPM(context.Background(), strings.TrimSpace(string(version))); err != nil || actual != node {
		t.Fatalf("actual native executable was not attested: path=%q err=%v", actual, err)
	}
	if _, err = g.resolveNativePNPM(context.Background(), "12.14.0"); err == nil || !strings.Contains(err.Error(), "version mismatch") {
		t.Fatalf("accepted actual non-pnpm executable: %v", err)
	}
	if runtime.GOOS != "windows" {
		alias := filepath.Join(t.TempDir(), "pnpm alias")
		if err = os.Symlink(node, alias); err != nil {
			t.Fatal(err)
		}
		t.Setenv("OMNIVIEW_PNPM_EXECUTABLE", alias)
		if _, err = g.resolveNativePNPM(context.Background(), strings.TrimSpace(string(version))); err == nil {
			t.Fatal("accepted an explicit alias instead of the canonical native executable")
		}
	}
	t.Setenv("OMNIVIEW_PNPM_EXECUTABLE", "relative-pnpm")
	if _, err = g.resolveNativePNPM(context.Background(), "12.14.0"); err == nil {
		t.Fatal("accepted a relative explicit native executable")
	}
}

func TestNativePNPMLauncherRefusesVersionMismatchBeforeScript(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("actual native Node is required for mismatch refusal")
	}
	node, err = filepath.EvalSymlinks(node)
	if err != nil {
		t.Fatal(err)
	}
	root := linkFixtureRoot(t)
	files, err := nativePNPMLauncherFiles(node, node, "12.14.0", root)
	if err != nil {
		t.Fatal(err)
	}
	launcher := filepath.Join(root, "pnpm.cjs")
	if err = os.WriteFile(launcher, files[0].Data, 0600); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(root, "must-not-exist")
	cmd := exec.Command(node, launcher, "-e", `require('node:fs').writeFileSync(process.argv[1],'wrong runtime ran')`, sentinel)
	cmd.Env = append(os.Environ(), "OMNIVIEW_PNPM_NODE_PATH=")
	if raw, err := cmd.CombinedOutput(); err == nil || !strings.Contains(string(raw), "could not be attested") {
		t.Fatalf("wrong native version not refused: %v: %s", err, raw)
	}
	if _, err = os.Stat(sentinel); !os.IsNotExist(err) {
		t.Fatalf("mismatched executable ran the requested script: %v", err)
	}
}

// The launcher pins the workspace root, so a dependency-changing command from
// any directory rewrites the owned composition node_modules. Only the recorded
// composition install may pass; ordinary scripts and audits still run.
func TestNativePNPMLauncherRefusesDependencyWritesOutsideCompositionInstall(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX fake native pnpm")
	}
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("actual Node is required for launcher behavior")
	}
	node, err = filepath.EvalSymlinks(node)
	if err != nil {
		t.Fatal(err)
	}
	root := linkFixtureRoot(t)
	record := filepath.Join(root, "invocations")
	fake := filepath.Join(root, "fake-pnpm")
	script := "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 12.14.0; exit 0; fi\nprintf '%s\\n' \"$*\" >> '" + record + "'\n"
	if err = os.WriteFile(fake, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	files, err := nativePNPMLauncherFiles(node, fake, "12.14.0", root)
	if err != nil {
		t.Fatal(err)
	}
	launcher := filepath.Join(root, "pnpm.cjs")
	if err = os.WriteFile(launcher, files[0].Data, 0600); err != nil {
		t.Fatal(err)
	}
	run := func(authorized bool, args ...string) (string, error) {
		t.Helper()
		if err := os.RemoveAll(record); err != nil {
			t.Fatal(err)
		}
		cmd := exec.Command(node, append([]string{launcher}, args...)...)
		cmd.Dir = t.TempDir()
		cmd.Env = append(os.Environ(), "OMNIVIEW_PNPM_NODE_PATH=", compositionInstallEnvironment+"=")
		if authorized {
			cmd.Env = append(cmd.Env, compositionInstallEnvironment+"=1")
		}
		raw, err := cmd.CombinedOutput()
		recorded, _ := os.ReadFile(record)
		if err != nil {
			return string(recorded), fmt.Errorf("%w: %s", err, raw)
		}
		return string(recorded), nil
	}
	for _, args := range [][]string{{"install"}, {"i", "--offline"}, {"-C", "ui", "add", "left-pad"}, {"--filter", "base-ui", "remove", "react"}, {"-r", "update"}, {"dedupe"}} {
		recorded, err := run(false, args...)
		if err == nil || !strings.Contains(err.Error(), "omniview-dev workspace refresh") {
			t.Fatalf("pnpm %q was not refused: %v", args, err)
		}
		if recorded != "" {
			t.Fatalf("refused pnpm %q still reached native pnpm: %q", args, recorded)
		}
	}
	for _, args := range [][]string{{"run", "build"}, {"exec", "tsc", "--noEmit"}, {"-r", "peers", "check", "--json", "--lockfile-only"}, {"--filter", "install", "test"}} {
		recorded, err := run(false, args...)
		if err != nil {
			t.Fatalf("pnpm %q was refused: %v", args, err)
		}
		if want := "--config.verify-deps-before-run=error " + strings.Join(args, " ") + "\n"; recorded != want {
			t.Fatalf("pnpm %q reached native pnpm as %q, want %q", args, recorded, want)
		}
	}
	recorded, err := run(true, "install", "--ignore-scripts")
	if err != nil || recorded != "--config.verify-deps-before-run=error install --ignore-scripts\n" {
		t.Fatalf("composition install was not passed through: recorded=%q err=%v", recorded, err)
	}
}

func TestLinkEvidenceCoversEverySelectedExactPin(t *testing.T) {
	legacy := LinkProtocolEvidence{Protocol: "link", Versions: []string{"10.34.7", "10.6.2"}, AtomicDist: true, Peers: true, Runtime: true}
	roots := []linkRoot{{Version: "12.14.0"}, {Version: "10.6.2"}}
	if err := legacy.validateRoots(roots); err == nil {
		t.Fatal("historical pnpm 10 evidence authorized a native pnpm 12 root")
	}
	native := LinkProtocolEvidence{Protocol: "workspace", Versions: []string{"12.14.0"}, AtomicDist: true, Peers: true, Runtime: true}
	if err := native.validateRoots(roots[:1]); err != nil {
		t.Fatal(err)
	}
	if err := native.validateRoots(roots); err == nil {
		t.Fatal("native-only evidence authorized an explicitly selected legacy root")
	}
	native.Versions = append(native.Versions, "10.6.2")
	if err := native.validateRoots(roots); err == nil {
		t.Fatal("mixed historical evidence authorized a composition")
	}
}

func TestSelectedManifestAcceptsOnlySupportedExactNativePin(t *testing.T) {
	root := t.TempDir()
	for _, pin := range []string{"12.14.0", "12.14.1", "^12.14.0", "12"} {
		raw, _ := json.Marshal(map[string]string{"packageManager": "pnpm@" + pin})
		if err := os.WriteFile(filepath.Join(root, "package.json"), raw, 0600); err != nil {
			t.Fatal(err)
		}
		got, err := pinnedLinkVersion(root)
		if pin == "12.14.0" {
			if err != nil || got != pin {
				t.Fatalf("native selected manifest rejected: pin=%q err=%v", got, err)
			}
		} else if err == nil {
			t.Fatalf("accepted unattested or inexact selected pin %q", pin)
		}
	}
}
