package devworkspace

import (
	"context"
	"debug/buildinfo"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsdk/sdktest"
)

// pubHostmodSource is a real Go program standing in for the host-selected
// scripts/hostmod: run by the real `go run ./scripts/hostmod/main.go`, it writes
// the generated host.mod/host.sum into the owned output directory and prints the
// JSON the controller requires. overrideMod/overrideSum replace the copy of the
// host's own go.mod/go.sum when non-empty, which is how a branch's hostmod
// misbehaves. It leaves a marker beside the host so a test can tell whether it
// ran at all.
const pubHostmodSource = `package main

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
)

const overrideMod, overrideSum = %q, %q

func main() {
	root := flag.String("root", ".", "")
	output := flag.String("output-directory", "", "")
	format := flag.String("format", "modfile", "")
	flag.Parse()
	if err := os.WriteFile(filepath.Join(filepath.Dir(*root), "hostmod.ran"), nil, 0o600); err != nil {
		panic(err)
	}
	mod, err := os.ReadFile(filepath.Join(*root, "go.mod"))
	if err != nil {
		panic(err)
	}
	sum, err := os.ReadFile(filepath.Join(*root, "go.sum"))
	if err != nil {
		panic(err)
	}
	if overrideMod != "" {
		mod = []byte(overrideMod)
	}
	if overrideSum != "" {
		sum = []byte(overrideSum)
	}
	modfile := filepath.Join(*output, "host.mod")
	if err := os.WriteFile(modfile, mod, 0o600); err != nil {
		panic(err)
	}
	if err := os.WriteFile(filepath.Join(*output, "host.sum"), sum, 0o600); err != nil {
		panic(err)
	}
	if *format != "json" {
		panic("unexpected format " + *format)
	}
	if err := json.NewEncoder(os.Stdout).Encode(map[string]string{"modfile": modfile}); err != nil {
		panic(err)
	}
}
`

// pubHostFixture is a published workspace whose host carries a fake hostmod.
type pubHostFixture struct {
	env        *pubEnv
	workspace  Workspace
	host       string
	supervisor *workspaceSupervisor
	graph      *BuildGraph
	goLog      string
}

func (e *pubEnv) hostFixture(overrideMod, overrideSum string) *pubHostFixture {
	t := e.t
	t.Helper()
	w := e.workspace()
	host := filepath.Join(w.Root, "omniview")
	pubWrite(t, filepath.Join(host, "scripts", "hostmod", "main.go"), fmt.Sprintf(pubHostmodSource, overrideMod, overrideSum))
	e.activate()
	f := &pubHostFixture{env: e, workspace: w, host: host, goLog: pubGoShim(t)}
	f.supervisor = &workspaceSupervisor{
		workspace: w, options: LaunchOptions{Mode: "browser"}, goBuildCache: pubAmbientGoCache,
		manager: &Manager{options: Options{Home: sdktest.TempDir(t), SDKPolicy: e.policy}},
	}
	f.graph = e.graph(w, f.supervisor.buildHost)
	f.supervisor.generation = f.graph.options.Generation
	return f
}

// build runs the host-backend node the way the production graph does: verify the
// host's own module files, call the host build, verify again.
func (f *pubHostFixture) build() error {
	return f.graph.buildNode(context.Background(), BuildNode{ID: "host-backend", Kind: "host-backend", Directory: f.host})
}

func (f *pubHostFixture) hostmodRan() bool {
	_, err := os.Stat(filepath.Join(f.workspace.Root, "hostmod.ran"))
	return err == nil
}

// requireNoCompile asserts the refused build never started a compiler, never
// produced a binary and never adopted one.
func (f *pubHostFixture) requireNoCompile(t *testing.T) {
	t.Helper()
	require.Empty(t, pubInvocationsOf(t, f.goLog, "build"), "a refused host build must not run go build")
	_, err := os.Stat(filepath.Join(f.workspace.Root, ".local", "bin"))
	require.ErrorIs(t, err, fs.ErrNotExist, "a refused host build must not publish any output tree")
	require.Empty(t, f.supervisor.binary, "a refused host build must not adopt a launch binary")
}

func pubCopyDirectory(t *testing.T, from, to string) {
	t.Helper()
	require.NoError(t, filepath.WalkDir(from, func(path string, entry fs.DirEntry, walkErr error) error {
		require.NoError(t, walkErr)
		relative, err := filepath.Rel(from, path)
		require.NoError(t, err)
		target := filepath.Join(to, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		data, err := os.ReadFile(path)
		require.NoError(t, err)
		return os.WriteFile(target, data, 0o600)
	}))
}

// The published host build compiles with the read-only generated modfile, the
// resulting executable's own build information names exactly the published SDK
// release (version and module checksum, no replacement), and neither the host's
// go.mod nor go.sum is edited.
func TestPublishedHostBuildCompilesAgainstThePublishedSDKAndAdoptsTheBinary(t *testing.T) {
	env := newPubEnv(t)
	f := env.hostFixture("", "")
	goMod, goSum := pubRead(t, filepath.Join(f.host, "go.mod")), pubRead(t, filepath.Join(f.host, "go.sum"))

	require.NoError(t, f.build())

	require.NotEmpty(t, f.supervisor.binary)
	require.Equal(t, filepath.Join(f.workspace.Root, ".local", "bin", "browser", f.supervisor.hostExecutable()), f.supervisor.binary)
	info, err := buildinfo.ReadFile(f.supervisor.binary)
	require.NoError(t, err)
	var found bool
	for _, dependency := range info.Deps {
		if dependency.Path != devsdk.Module {
			continue
		}
		found = true
		require.Equal(t, env.sdk.Version, dependency.Version)
		require.Equal(t, env.sdk.ModuleSum, dependency.Sum)
		require.Nil(t, dependency.Replace, "the executable must name the published module, never a replacement")
	}
	require.True(t, found, "the host binary does not import the plugin SDK, so it proves nothing")

	builds := pubInvocationsOf(t, f.goLog, "build")
	require.Len(t, builds, 1)
	require.Contains(t, builds[0], "-mod=readonly")
	require.Regexp(t, `-modfile=\S*/toolsrc/hostmod/host\.mod`, builds[0])
	require.True(t, f.hostmodRan())
	require.Equal(t, goMod, pubRead(t, filepath.Join(f.host, "go.mod")), "the host's go.mod must stay byte-identical")
	require.Equal(t, goSum, pubRead(t, filepath.Join(f.host, "go.sum")), "the host's go.sum must stay byte-identical")
	require.NoDirExists(t, filepath.Join(f.host, "vendor"))
}

// An old hostmod branch that injects an SDK replacement into the generated
// host.mod is refused with the typed selection conflict, after hostmod ran and
// before any compile.
func TestPublishedHostBuildRefusesAHostmodThatInjectsAnSDKReplacement(t *testing.T) {
	env := newPubEnv(t)
	tampered := filepath.Join(sdktest.TempDir(t), "tampered-sdk")
	require.NoError(t, os.MkdirAll(tampered, 0o700))
	pubCopyDirectory(t, sdktest.PinnedSDK(t), tampered)
	pubWrite(t, filepath.Join(tampered, "pkg", "profilecontract", "tamper.go"), "package profilecontract\n\nfunc init() { panic(\"tampered SDK was compiled\") }\n")

	hostMod := pubGoMod("github.com/omniviewdev/omniview", "\nreplace "+devsdk.Module+" => "+tampered+"\n", env.sdk, env.uuid)
	f := env.hostFixture(hostMod, "")

	err := f.build()

	failure := pubRequireCode(t, err, devsdk.CodeSelectionConflict, 4)
	require.NotContains(t, failure.Message, tampered, "diagnostics must not be mistaken for acceptance")
	require.True(t, f.hostmodRan(), "the replacement came from the hostmod output, so hostmod must have run")
	f.requireNoCompile(t)
}

// A hostmod that rewrites host.mod to require another served release (with that
// release's own checksums in host.sum) states a different SDK tuple than the
// host's verified go.mod, so the build is refused before compiling and no binary
// is produced.
func TestPublishedHostBuildRefusesAHostmodThatSwitchesToAnotherServedRelease(t *testing.T) {
	env := newPubEnv(t)
	hostMod := pubGoMod("github.com/omniviewdev/omniview", "", env.other, env.uuid)
	f := env.hostFixture(hostMod, pubSums(env.other, env.uuid))

	err := f.build()

	failure := pubRequireCode(t, err, devsdk.CodeSelectionConflict, 4)
	require.Contains(t, failure.Message, "different")
	require.True(t, f.hostmodRan())
	f.requireNoCompile(t)
}

// A replacement committed in the host's own go.mod is refused from the module
// files themselves, before hostmod (or any Go command) runs.
func TestPublishedHostBuildRefusesAnSDKReplaceCommittedInTheHostBeforeHostmodRuns(t *testing.T) {
	env := newPubEnv(t)
	f := env.hostFixture("", "")
	goMod := filepath.Join(f.host, "go.mod")
	pubWrite(t, goMod, pubRead(t, goMod)+"\nreplace "+devsdk.Module+" => ../sdk\n")

	err := f.build()

	pubRequireCode(t, err, devsdk.CodeSelectionConflict, 4)
	require.False(t, f.hostmodRan(), "hostmod is branch code and must not run before the host's go.mod is accepted")
	require.Empty(t, pubInvocationsOf(t, f.goLog, "run"))
	require.Empty(t, pubInvocationsOf(t, f.goLog, "list"), "the refusal comes from the module files, before any resolution")
	f.requireNoCompile(t)
}

// A Go environment file that sets GOFLAGS (an overlay, toolexec, modfile or
// vendor flag) is not masked by the empty GOFLAGS variable, so published
// verification refuses it before hostmod, resolution or any compile.
func TestPublishedHostBuildRefusesAGoEnvironmentFileGOFLAGS(t *testing.T) {
	env := newPubEnv(t)
	f := env.hostFixture("", "")
	file := env.hostileGoEnv()

	err := f.build()

	failure := pubRequireCode(t, err, devsdk.CodeSelectionConflict, 4)
	require.Contains(t, failure.Message, "-overlay=", "the refusal must name the effective flags")
	require.Contains(t, failure.Message, "GOFLAGS")
	require.False(t, f.hostmodRan())
	f.requireNoCompile(t)
	require.FileExists(t, file)
}
