package plugin

import (
	"embed"
	"encoding/json"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
)

// The plugin a test installs has an executable, and the executable is a real one
// on every OS: a small Go program (testdata/pluginfixture), built the first time a
// test of this package run asks for it, for the OS the tests run on, and copied
// into each fixture's bin directory under the name the host looks for
// (plugintypes.BinaryName: plugin, or plugin.exe on Windows). It replaces the
// shell scripts the fixtures used to write, which Windows cannot run. Nothing
// built is kept: the build lives in a temporary directory that TestMain removes.
//
// What the executable does is a pluginFixtureBehaviour the test writes next to it
// (bin/fixture.json); without one it exits at once with status 0, which is what
// the one-line script `#!/bin/sh` did.

//go:embed testdata/pluginfixture
var pluginFixtureSource embed.FS

const (
	// pluginFixtureEnv names an executable built by the process that started this
	// one. A test that starts a child process of its own binary passes it, so the
	// child does not build the program again.
	pluginFixtureEnv      = "OMNIVIEW_TEST_PLUGIN_FIXTURE_EXE"
	pluginFixtureSpecFile = "fixture.json"
)

var pluginFixtureBuild struct {
	once sync.Once
	dir  string
	exe  []byte
	err  error
}

func TestMain(m *testing.M) {
	code := m.Run()
	if dir := pluginFixtureBuild.dir; dir != "" {
		_ = os.RemoveAll(dir)
	}
	os.Exit(code)
}

// pluginFixtureRecord is a file the fixture writes before it acts.
type pluginFixtureRecord struct {
	File string `json:"file"`
	Text string `json:"text"`
}

// pluginFixtureBehaviour is what the fixture executable does when it is started
// (see testdata/pluginfixture/main.go for the semantics and the expansion rules
// of its strings). The zero value is not written: no file means "exit 0".
type pluginFixtureBehaviour struct {
	Records      []pluginFixtureRecord `json:"records,omitempty"`
	Env          map[string]*string    `json:"env,omitempty"`
	Run          []string              `json:"run,omitempty"`
	SleepSeconds float64               `json:"sleepSeconds,omitempty"`
	ExitCode     int                   `json:"exitCode,omitempty"`
}

// pluginFixtureRunsTestBinary is the behaviour of a plugin whose process is this
// test binary running the test childTest: the fixture executes the binary the
// test names in the environment variable binaryEnv.
func pluginFixtureRunsTestBinary(binaryEnv, childTest string) *pluginFixtureBehaviour {
	return &pluginFixtureBehaviour{Run: []string{"${" + binaryEnv + "}", "-test.run=^" + childTest + "$"}}
}

func (b *pluginFixtureBehaviour) json(t testing.TB) []byte {
	t.Helper()
	data, err := json.Marshal(b)
	require.NoError(t, err)
	return data
}

// pluginFixtureExecutable returns the bytes of the fixture executable for this
// OS, building it once per process.
func pluginFixtureExecutable(t testing.TB) []byte {
	t.Helper()
	pluginFixtureBuild.once.Do(func() {
		if prebuilt := os.Getenv(pluginFixtureEnv); prebuilt != "" {
			pluginFixtureBuild.exe, pluginFixtureBuild.err = os.ReadFile(prebuilt)
			return
		}
		pluginFixtureBuild.exe, pluginFixtureBuild.err = buildPluginFixture()
	})
	require.NoError(t, pluginFixtureBuild.err, "build the plugin fixture executable")
	return pluginFixtureBuild.exe
}

// pluginFixtureExecutablePath writes the fixture executable where a child process
// can read it, and returns the value to give it as pluginFixtureEnv.
func pluginFixtureExecutablePath(t testing.TB) string {
	t.Helper()
	exe := pluginFixtureExecutable(t)
	file := filepath.Join(t.TempDir(), plugintypes.BinaryName())
	require.NoError(t, os.WriteFile(file, exe, 0o755))
	return pluginFixtureEnv + "=" + file
}

func buildPluginFixture() ([]byte, error) {
	dir, err := os.MkdirTemp("", "omniview-plugin-fixture-")
	if err != nil {
		return nil, err
	}
	pluginFixtureBuild.dir = dir
	source := filepath.Join(dir, "src")
	if err := os.Mkdir(source, 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(source, "go.mod"), []byte("module pluginfixture\n\ngo 1.21\n"), 0o600); err != nil {
		return nil, err
	}
	entries, err := fs.ReadDir(pluginFixtureSource, "testdata/pluginfixture")
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		data, err := pluginFixtureSource.ReadFile(path.Join("testdata/pluginfixture", entry.Name()))
		if err != nil {
			return nil, err
		}
		if err := os.WriteFile(filepath.Join(source, entry.Name()), data, 0o600); err != nil {
			return nil, err
		}
	}
	output := filepath.Join(dir, plugintypes.BinaryName())
	build := exec.Command("go", "build", "-trimpath", "-ldflags=-s -w", "-o", output, ".")
	build.Dir = source
	// The program is its own module with no dependency: nothing of the host's
	// build environment (workspace, modfile, flags) applies to it.
	build.Env = append(os.Environ(),
		"GOWORK=off", "GOFLAGS=", "GOTOOLCHAIN=local", "CGO_ENABLED=0",
		"GOOS="+runtime.GOOS, "GOARCH="+runtime.GOARCH)
	if combined, err := build.CombinedOutput(); err != nil {
		return nil, &pluginFixtureBuildError{err: err, output: string(combined)}
	}
	return os.ReadFile(output)
}

type pluginFixtureBuildError struct {
	err    error
	output string
}

func (e *pluginFixtureBuildError) Error() string { return e.err.Error() + ": " + e.output }

// writePluginFixture writes the fixture executable, under the name the host looks
// for, into binDir, with the behaviour next to it when there is one. It returns
// the executable's path.
func writePluginFixture(t testing.TB, binDir string, behaviour *pluginFixtureBehaviour) string {
	t.Helper()
	require.NoError(t, os.MkdirAll(binDir, 0o755))
	executable := filepath.Join(binDir, plugintypes.BinaryName())
	require.NoError(t, os.WriteFile(executable, pluginFixtureExecutable(t), 0o755))
	spec := filepath.Join(binDir, pluginFixtureSpecFile)
	if behaviour == nil {
		require.NoError(t, removeIfPresent(spec))
		return executable
	}
	require.NoError(t, os.WriteFile(spec, behaviour.json(t), 0o644))
	return executable
}

func removeIfPresent(file string) error {
	if err := os.Remove(file); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// pluginFixtureArchiveEntries are the archive entries of the fixture's bin
// directory: the directory, the executable under the host's name for this OS,
// and the behaviour when there is one.
func pluginFixtureArchiveEntries(t testing.TB, behaviour *pluginFixtureBehaviour) []tarEntry {
	t.Helper()
	entries := []tarEntry{
		{name: "bin/", mode: 0o755, dir: true},
		{name: "bin/" + plugintypes.BinaryName(), mode: 0o755, body: string(pluginFixtureExecutable(t))},
	}
	if behaviour != nil {
		entries = append(entries, tarEntry{name: "bin/" + pluginFixtureSpecFile, mode: 0o644, body: string(behaviour.json(t))})
	}
	return entries
}

// shortSocketRoot is a directory the tests give a plugin child as its temporary
// directory, so that a Unix socket made under it stays below the platform's path
// limit whatever the test is called. Windows has no such limit (go-plugin listens
// on loopback TCP there), and no /tmp: the child keeps the default.
// It sets TMPDIR for the test and returns the directory, or "" where there is none.
func shortSocketRoot(t testing.TB, prefix string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		return ""
	}
	sockets, err := os.MkdirTemp("/tmp", prefix)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, os.RemoveAll(sockets)) })
	t.Setenv("TMPDIR", sockets)
	return sockets
}
