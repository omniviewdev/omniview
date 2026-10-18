package devserver

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

func TestParseBuildErrors(t *testing.T) {
	tests := []struct {
		name     string
		output   string
		basePath string
		expected []BuildError
	}{
		{
			name:     "single error",
			output:   "./pkg/main.go:42:10: undefined: Foo",
			basePath: "/home/user/plugins/test",
			expected: []BuildError{
				{
					File:    "/home/user/plugins/test/pkg/main.go",
					Line:    42,
					Column:  10,
					Message: "undefined: Foo",
				},
			},
		},
		{
			name: "multiple errors",
			output: `./pkg/main.go:10:2: syntax error: unexpected }
./pkg/handler.go:25:5: cannot use x (variable of type int) as string value`,
			basePath: "/home/user/plugins/test",
			expected: []BuildError{
				{
					File:    "/home/user/plugins/test/pkg/main.go",
					Line:    10,
					Column:  2,
					Message: "syntax error: unexpected }",
				},
				{
					File:    "/home/user/plugins/test/pkg/handler.go",
					Line:    25,
					Column:  5,
					Message: "cannot use x (variable of type int) as string value",
				},
			},
		},
		{
			name:     "no errors (empty output)",
			output:   "",
			basePath: "/home/user",
			expected: nil,
		},
		{
			name:     "non-error output mixed in",
			output:   "# github.com/example/pkg\n./pkg/main.go:5:1: expected declaration, found 'IDENT'\n",
			basePath: "/home/user/plugins/test",
			expected: []BuildError{
				{
					File:    "/home/user/plugins/test/pkg/main.go",
					Line:    5,
					Column:  1,
					Message: "expected declaration, found 'IDENT'",
				},
			},
		},
		{
			name:     "absolute path (not relative)",
			output:   "/absolute/path/main.go:1:1: error here",
			basePath: "/home/user",
			expected: []BuildError{
				{
					File:    "/absolute/path/main.go",
					Line:    1,
					Column:  1,
					Message: "error here",
				},
			},
		},
		{
			name:     "only non-matching lines",
			output:   "# some/package\nno match here\nalso not a match",
			basePath: "/home",
			expected: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := parseBuildErrors(tt.output, tt.basePath)
			if tt.expected == nil {
				assert.Nil(t, result)
			} else {
				require.Len(t, result, len(tt.expected))
				for i, exp := range tt.expected {
					assert.Equal(t, exp.File, result[i].File, "file mismatch at index %d", i)
					assert.Equal(t, exp.Line, result[i].Line, "line mismatch at index %d", i)
					assert.Equal(t, exp.Column, result[i].Column, "column mismatch at index %d", i)
					assert.Equal(t, exp.Message, result[i].Message, "message mismatch at index %d", i)
				}
			}
		})
	}
}

// ============================================================================
// transferBinary tests
// ============================================================================

func TestTransferBinary_Success(t *testing.T) {
	devPath := t.TempDir()

	// Create a fake built binary at devPath/build/bin/plugin.
	buildDir := filepath.Join(devPath, "build", "bin")
	require.NoError(t, os.MkdirAll(buildDir, 0755))
	srcBinary := filepath.Join(buildDir, "plugin")
	require.NoError(t, os.WriteFile(srcBinary, []byte("fake-binary-data"), 0755))

	svc := appstate.NewTestService(t)

	gw := &goWatcherProcess{
		logger:      logging.NewNop(),
		pluginID:    "transfer-test",
		devPath:     devPath,
		pluginsRoot: svc.Plugins(),
	}

	err := gw.transferBinary()
	require.NoError(t, err)

	// Verify the binary was copied.
	dstPath := filepath.Join(svc.Plugins().ResolvePath(""), "transfer-test", "bin", "plugin")
	data, err := os.ReadFile(dstPath)
	require.NoError(t, err)
	assert.Equal(t, "fake-binary-data", string(data))

	// Verify the file is executable.
	info, err := os.Stat(dstPath)
	require.NoError(t, err)
	assert.NotZero(t, info.Mode()&0111, "binary should be executable")
}

func TestTransferBinary_SourceMissing(t *testing.T) {
	devPath := t.TempDir()
	// Do NOT create the binary — it should be missing.

	svc := appstate.NewTestService(t)

	gw := &goWatcherProcess{
		logger:      logging.NewNop(),
		pluginID:    "missing-src",
		devPath:     devPath,
		pluginsRoot: svc.Plugins(),
	}

	err := gw.transferBinary()
	require.Error(t, err)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypeInternal, appErr.Type)
	assert.Equal(t, 500, appErr.Status)
	assert.Equal(t, "Failed to open built binary", appErr.Title)
}

func TestTransferBinary_DestDirCreated(t *testing.T) {
	devPath := t.TempDir()

	// Create a fake binary.
	buildDir := filepath.Join(devPath, "build", "bin")
	require.NoError(t, os.MkdirAll(buildDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(buildDir, "plugin"), []byte("bin"), 0755))

	svc := appstate.NewTestService(t)

	gw := &goWatcherProcess{
		logger:      logging.NewNop(),
		pluginID:    "dest-create",
		devPath:     devPath,
		pluginsRoot: svc.Plugins(),
	}

	// The dest dir doesn't exist yet.
	dstDir := filepath.Join(svc.Plugins().ResolvePath(""), "dest-create", "bin")
	_, err := os.Stat(dstDir)
	assert.True(t, os.IsNotExist(err))

	require.NoError(t, gw.transferBinary())

	// Now it should exist.
	info, err := os.Stat(dstDir)
	require.NoError(t, err)
	assert.True(t, info.IsDir())
}

func TestTransferBinary_OverwritesExisting(t *testing.T) {
	devPath := t.TempDir()

	buildDir := filepath.Join(devPath, "build", "bin")
	require.NoError(t, os.MkdirAll(buildDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(buildDir, "plugin"), []byte("new-binary"), 0755))

	svc := appstate.NewTestService(t)

	gw := &goWatcherProcess{
		logger:      logging.NewNop(),
		pluginID:    "overwrite-test",
		devPath:     devPath,
		pluginsRoot: svc.Plugins(),
	}

	// Pre-create an old binary at the destination.
	dstDir := filepath.Join(svc.Plugins().ResolvePath(""), "overwrite-test", "bin")
	require.NoError(t, os.MkdirAll(dstDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(dstDir, "plugin"), []byte("old-binary"), 0755))

	require.NoError(t, gw.transferBinary())

	data, err := os.ReadFile(filepath.Join(dstDir, "plugin"))
	require.NoError(t, err)
	assert.Equal(t, "new-binary", string(data))
}

func TestParseBuildErrors_GoTestOutput(t *testing.T) {
	// Test failure output from `go test` looks different — no file:line:col pattern.
	output := `--- FAIL: TestSomething (0.01s)
    something_test.go:15: expected 5, got 3
FAIL	github.com/example/pkg	0.015s`

	errors := parseBuildErrors(output, "/dev/null")
	// The regex requires file.go:line:col: msg — test output doesn't match.
	assert.Nil(t, errors)
}

func TestParseBuildErrors_RelativePaths(t *testing.T) {
	output := "./internal/handler.go:100:15: too many arguments"
	errors := parseBuildErrors(output, "/workspace/plugin")

	require.Len(t, errors, 1)
	assert.Equal(t, "/workspace/plugin/internal/handler.go", errors[0].File)
	assert.Equal(t, 100, errors[0].Line)
	assert.Equal(t, 15, errors[0].Column)
}

func TestNewGoWatcherProcess(t *testing.T) {
	ctx := context.Background()
	logger := logging.NewNop()
	reloader := &mockPluginReloader{}
	appendLog := func(LogEntry) {}
	setStatus := func(DevProcessStatus) {}
	setBuild := func(time.Duration, string) {}
	emitErrors := func(string, []BuildError) {}

	gw := newGoWatcherProcess(ctx, logger, "gw-test", "/dev/path", BuildOpts{
		GoPath: "/usr/local/go/bin/go",
	}, reloader, appstate.NewTestService(t).Plugins(), appendLog, setStatus, setBuild, emitErrors)

	assert.Equal(t, "gw-test", gw.pluginID)
	assert.Equal(t, "/dev/path", gw.devPath)
	assert.Equal(t, "/usr/local/go/bin/go", gw.buildOpts.GoPath)
	assert.NotNil(t, gw.done)
	assert.NotNil(t, gw.cancel)
}

func TestGoWatcherProcess_Stop_NilWatcher(_ *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	doneCh := make(chan struct{})
	close(doneCh) // pre-close so Stop doesn't block

	gw := &goWatcherProcess{
		ctx:    ctx,
		cancel: cancel,
		logger: logging.NewNop(),
		done:   doneCh,
	}

	// Should not panic with nil watcher.
	gw.Stop()
}

func TestGoWatcherProcess_Stop_WithWatcher(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	doneCh := make(chan struct{})
	close(doneCh)

	watcher, err := fsnotify.NewWatcher()
	require.NoError(t, err)

	gw := &goWatcherProcess{
		ctx:     ctx,
		cancel:  cancel,
		logger:  logging.NewNop(),
		watcher: watcher,
		done:    doneCh,
	}

	gw.Stop()
	// Watcher should be closed (double close would error, but that's ok).
}

func TestRunGoBuild_EmptyGoPath(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	gw := newGoWatcherProcess(context.Background(), logging.NewNop(), "missing-go", t.TempDir(), BuildOpts{}, nil, appstate.NewTestService(t).Plugins(), func(LogEntry) {}, func(DevProcessStatus) {}, func(time.Duration, string) {}, func(string, []BuildError) {})
	require.ErrorContains(t, gw.runGoBuild(), "resolve go tool")
}

// ============================================================================
// Initial build tests
// ============================================================================

func TestGoWatcherStart_InitialBuild_FailsGracefully(t *testing.T) {
	// When GoPath is empty, initial build fails but Start() should NOT return error.
	// The watcher should still start so the user can fix the issue and rebuild.
	devPath := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(devPath, "pkg"), 0755))

	var statuses []DevProcessStatus
	gw := newGoWatcherProcess(
		context.Background(),
		logging.NewNop(),
		"fail-build",
		devPath,
		BuildOpts{GoPath: ""}, // Empty → build will fail
		&mockPluginReloader{},
		appstate.NewTestService(t).Plugins(),
		func(LogEntry) {},
		func(s DevProcessStatus) { statuses = append(statuses, s) },
		func(time.Duration, string) {},
		func(string, []BuildError) {},
	)

	// Start should succeed even though the initial build fails.
	require.NoError(t, startFixtureWatcher(t, gw))
	defer gw.Stop()

	// Verify status progression: Building → Error (from initial build failure)
	require.GreaterOrEqual(t, len(statuses), 2)
	assert.Equal(t, DevProcessStatusBuilding, statuses[0])
	assert.Equal(t, DevProcessStatusError, statuses[1])

}

func TestGoWatcherStart_InitialBuild_StatusProgression(t *testing.T) {
	// Verify the status transitions through Building when Start() is called.
	devPath := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(devPath, "pkg"), 0755))

	var statuses []DevProcessStatus
	gw := newGoWatcherProcess(
		context.Background(),
		logging.NewNop(),
		"status-test",
		devPath,
		BuildOpts{GoPath: "nonexistent-go-binary"},
		&mockPluginReloader{},
		appstate.NewTestService(t).Plugins(),
		func(LogEntry) {},
		func(s DevProcessStatus) { statuses = append(statuses, s) },
		func(time.Duration, string) {},
		func(string, []BuildError) {},
	)

	require.NoError(t, startFixtureWatcher(t, gw))
	defer gw.Stop()

	// Should have at least Building status (first status set by initial build).
	require.GreaterOrEqual(t, len(statuses), 1)
	assert.Equal(t, DevProcessStatusBuilding, statuses[0])
}

func TestTransferBinary_ReadOnlyDestDir(t *testing.T) {
	devPath := t.TempDir()

	// Create a built binary.
	buildDir := filepath.Join(devPath, "build", "bin")
	require.NoError(t, os.MkdirAll(buildDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(buildDir, "plugin"), []byte("bin"), 0755))

	svc := appstate.NewTestService(t)

	// Create the dest dir as read-only so file creation fails.
	dstDir := filepath.Join(svc.Plugins().ResolvePath(""), "readonly-test", "bin")
	require.NoError(t, os.MkdirAll(dstDir, 0755))
	require.NoError(t, os.Chmod(dstDir, 0444))
	t.Cleanup(func() { _ = os.Chmod(dstDir, 0755) })

	gw := &goWatcherProcess{
		logger:      logging.NewNop(),
		pluginID:    "readonly-test",
		devPath:     devPath,
		pluginsRoot: svc.Plugins(),
	}

	err := gw.transferBinary()
	require.Error(t, err)
	var appErr *apperror.AppError
	require.ErrorAs(t, err, &appErr)
	assert.Equal(t, apperror.TypeInternal, appErr.Type)
	assert.Equal(t, 500, appErr.Status)
	assert.Equal(t, "Failed to create destination binary", appErr.Title)
	assert.Contains(t, appErr.Detail, "permission denied")
}

// ============================================================================
// parseGoWorkUseDirectives tests
// ============================================================================

func TestGoBuildEnvDropsGOROOT(t *testing.T) {
	got := goBuildEnv([]string{"PATH=/bin", "GOROOT=/old/go", "GOWORK=/foreign/go.work", "GOPATH=/gopath"})
	assert.Equal(t, []string{"PATH=/bin", "GOPATH=/gopath", "GOWORK=off"}, got)
}
