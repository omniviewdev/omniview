package devworkspace

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsdk/sdktest"
)

// The published-SDK tests of this package run real `go` commands in a hermetic
// scratch world: a file:// module proxy and module cache serving real plugin SDK
// releases. Every identifier here carries the pub prefix.

// pubAmbientGoCache is the Go build cache this test binary started with. Build
// outputs are content addressed, so sharing it keeps compiles fast without
// touching the scratch module cache.
var pubAmbientGoCache = func() string {
	output, err := exec.Command("go", "env", "GOCACHE").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}()

// pubGoBinary is the real go executable resolved before any test moves PATH.
var pubGoBinary = func() string {
	path, err := exec.LookPath("go")
	if err != nil {
		return ""
	}
	return path
}()

// pubEnv is one hermetic world with the three releases the tests use: the
// floor release (real checksums), a second reviewed release under world.Policy
// and the uuid dependency.
type pubEnv struct {
	t      *testing.T
	world  *sdktest.World
	sdk    sdktest.Release // FloorVersion
	other  sdktest.Release // another served release, reviewed only under policy
	uuid   sdktest.Release
	policy devsdk.Policy
	home   string
}

// newPubEnv publishes every release before anything moves HOME or the module
// cache: the pinned SDK tree is read from the ambient cache.
func newPubEnv(t *testing.T) *pubEnv {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the published SDK fixtures run POSIX helper programs")
	}
	require.NotEmpty(t, pubGoBinary, "go must be on PATH")
	world := sdktest.New(t)
	home, err := filepath.EvalSymlinks(sdktest.Home(t))
	require.NoError(t, err)
	env := &pubEnv{t: t, world: world, home: home}
	env.sdk = world.PublishSDK(devsdk.FloorVersion, nil)
	env.uuid = world.PublishPinned("github.com/google/uuid")
	env.other = world.PublishSDK("v0.98.1", nil)
	env.policy = world.Policy(env.other)
	return env
}

// activate puts the world's Go environment into this test process, because the
// code under test spawns Go itself (the supervisor and graph runners), and gives
// the test a private HOME. An ambient SDK_SOURCE is planted to prove it never
// reaches a child.
func (e *pubEnv) activate() {
	e.t.Helper()
	for _, entry := range e.world.Environment() {
		key, value, _ := strings.Cut(entry, "=")
		e.t.Setenv(key, value)
	}
	e.t.Setenv("HOME", e.home)
	e.t.Setenv("USERPROFILE", e.home)
	e.t.Setenv("XDG_CONFIG_HOME", filepath.Join(e.home, ".config"))
	e.t.Setenv("XDG_CACHE_HOME", filepath.Join(e.home, ".cache"))
	e.t.Setenv("GOCACHE", pubAmbientGoCache)
	e.t.Setenv("SDK_SOURCE", "/ambient/sdk")
	e.t.Setenv(devcontract.WorkspaceEnvironment, "")
}

// pubSums renders go.sum lines recording the releases' checksums.
func pubSums(releases ...sdktest.Release) string {
	var sums strings.Builder
	for _, release := range releases {
		fmt.Fprintf(&sums, "%s %s %s\n%s %s/go.mod %s\n", release.Module, release.Version, release.ModuleSum, release.Module, release.Version, release.GoModSum)
	}
	return sums.String()
}

// pubGoMod renders a go.mod requiring the releases, with extra directives
// appended verbatim.
func pubGoMod(module string, extra string, releases ...sdktest.Release) string {
	var mod strings.Builder
	fmt.Fprintf(&mod, "module %s\n\ngo 1.27.0\n\nrequire (\n", module)
	for _, release := range releases {
		fmt.Fprintf(&mod, "\t%s %s\n", release.Module, release.Version)
	}
	mod.WriteString(")\n")
	mod.WriteString(extra)
	return mod.String()
}

const pubProfileMain = "package main\n\nimport (\n\t\"fmt\"\n\n\t\"github.com/omniviewdev/plugin-sdk/pkg/profilecontract\"\n)\n\nfunc main() { fmt.Println(profilecontract.CanonicalPath(\"/\")) }\n"

func pubWrite(t *testing.T, path, content string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o700))
	require.NoError(t, os.WriteFile(path, []byte(content), 0o600))
}

func pubRead(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	return string(data)
}

// pubWorkspace materializes a published-SDK workspace with real files: a host
// module at omniview/ and a plugin module at plugin/, both requiring the floor
// release and uuid with their world go.sum, no SDK repository, vendor-free.
// The manifest is registered and written like the composition fixtures.
func (e *pubEnv) workspace() Workspace {
	t := e.t
	t.Helper()
	root, err := filepath.EvalSymlinks(sdktest.TempDir(t))
	require.NoError(t, err)
	root = filepath.Join(root, "workspaces", "feature")
	require.NoError(t, os.MkdirAll(root, 0o700))
	w := Workspace{ResolvedWorkspace: devcontract.ResolvedWorkspace{Root: root, Manifest: devcontract.WorkspaceManifest{
		WorkspaceID:  uuid.NewString(),
		Repositories: []devcontract.Repository{{ID: "omniview", Directory: "omniview"}, {ID: "plugin", Directory: "plugin"}},
		Plugins:      []devcontract.Plugin{{ID: "plugin", RepositoryID: "plugin", Mode: "managed"}},
	}}}
	host := filepath.Join(root, "omniview")
	pubWrite(t, filepath.Join(host, "go.mod"), pubGoMod("github.com/omniviewdev/omniview", "", e.sdk, e.uuid))
	pubWrite(t, filepath.Join(host, "go.sum"), pubSums(e.sdk, e.uuid))
	pubWrite(t, filepath.Join(host, "main.go"), pubProfileMain)
	pubWrite(t, filepath.Join(host, "package.json"), `{"name":"omniview","version":"1.0.0","private":true,"packageManager":"pnpm@12.14.0"}`+"\n")
	pubWrite(t, filepath.Join(host, "pnpm-workspace.yaml"), "packages: []\n")
	plugin := filepath.Join(root, "plugin")
	pubWrite(t, filepath.Join(plugin, "go.mod"), pubGoMod("example.com/plugin", "", e.sdk, e.uuid))
	pubWrite(t, filepath.Join(plugin, "go.sum"), pubSums(e.sdk, e.uuid))
	pubWrite(t, filepath.Join(plugin, "pkg", "main.go"), pubProfileMain)
	pubWrite(t, filepath.Join(plugin, "plugin.yaml"), "id: plugin\nname: Plugin\nversion: 0.1.0\nschema_version: 1\nsdk_protocol_version: 1\ncapabilities:\n  - resource\n")
	registerCompositionFixture(t, &w)
	// The default profile of the workspace under the test's private HOME, which
	// is where the host's artifact evidence is recorded and read.
	w.StateRoot = filepath.Join(e.home, ".omniview-dev", "profiles", w.Manifest.WorkspaceID, "state")
	require.NoError(t, os.MkdirAll(filepath.Join(root, ".local"), 0o700))
	return w
}

// run is the world's Go runner: a real caller-owned runner for verification.
func (e *pubEnv) run() devsdk.Runner { return e.world.Runner() }

// pubRefusal returns the typed refusal in err's chain, failing when there is
// none, so a test asserts a code and never error text alone.
func pubRefusal(t *testing.T, err error) *devcontract.Error {
	t.Helper()
	require.Error(t, err)
	var failure *devcontract.Error
	require.True(t, errors.As(err, &failure), "want a typed refusal, got: %v", err)
	return failure
}

func pubRequireCode(t *testing.T, err error, code string, exit int) *devcontract.Error {
	t.Helper()
	failure := pubRefusal(t, err)
	require.Equal(t, code, failure.Code, "%v", err)
	require.Equal(t, exit, failure.Exit)
	return failure
}

// pubHostileGoEnv writes a Go environment file setting GOFLAGS to an overlay
// (valid, empty, so Go itself still runs) and selects it through GOENV, the way
// `go env -w GOFLAGS=...` would persist it.
func (e *pubEnv) hostileGoEnv() string {
	t := e.t
	t.Helper()
	directory := sdktest.TempDir(t)
	overlay := filepath.Join(directory, "overlay.json")
	pubWrite(t, overlay, `{"Replace":{}}`+"\n")
	file := filepath.Join(directory, "go.env")
	pubWrite(t, file, "GOFLAGS=-overlay="+overlay+"\n")
	t.Setenv("GOENV", file)
	return file
}

// pubGoShim installs a go executable first on PATH that logs every invocation's
// arguments to the returned file and then runs the real go. The shim is a real
// program on the real command path, so a log without "build" proves no compile
// was ever started.
func pubGoShim(t *testing.T) (log string) {
	t.Helper()
	directory := sdktest.TempDir(t)
	log = filepath.Join(directory, "go-invocations.log")
	script := "#!/bin/sh\nprintf '%s\\n' \"$*\" >> " + pubShellQuote(log) + "\nexec " + pubShellQuote(pubGoBinary) + " \"$@\"\n"
	pubWrite(t, filepath.Join(directory, "go"), script)
	require.NoError(t, os.Chmod(filepath.Join(directory, "go"), 0o700))
	t.Setenv("PATH", directory+string(os.PathListSeparator)+os.Getenv("PATH"))
	return log
}

func pubShellQuote(value string) string { return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'" }

// pubInvocations lists the argument lines the go shim recorded.
func pubInvocations(t *testing.T, log string) []string {
	t.Helper()
	data, err := os.ReadFile(log)
	if os.IsNotExist(err) {
		return nil
	}
	require.NoError(t, err)
	return strings.Split(strings.TrimSpace(string(data)), "\n")
}

// pubInvocationsOf filters recorded lines to one go subcommand.
func pubInvocationsOf(t *testing.T, log, subcommand string) []string {
	t.Helper()
	var lines []string
	for _, line := range pubInvocations(t, log) {
		if fields := strings.Fields(line); len(fields) > 0 && fields[0] == subcommand {
			lines = append(lines, line)
		}
	}
	return lines
}

// pubGraph is a published-selection BuildGraph over w that runs real commands
// the way the production graph does (its own command runner and owned Go
// runner) and verifies with the production verifier under policy.
func (e *pubEnv) graph(w Workspace, hostBuild func(context.Context, HostBuildRequest) error) *BuildGraph {
	t := e.t
	t.Helper()
	g := &BuildGraph{workspace: w, plan: linkPlan{SDK: devsdk.PublishedSelection()}, options: BuildOptions{
		Generation: uuid.NewString(), GoBuildCacheDirectory: pubAmbientGoCache,
		VerifySDK: devsdk.NewVerifier(e.policy), HostBuild: hostBuild,
	}}
	g.run, g.runProducer = g.command, g.commandWithEnvironment
	return g
}
