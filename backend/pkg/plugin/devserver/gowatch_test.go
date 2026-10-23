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

// ============================================================================
// parseGoWorkUseDirectives tests
// ============================================================================

func TestGoBuildEnvDropsGOROOT(t *testing.T) {
	got := goBuildEnv([]string{"PATH=/bin", "GOROOT=/old/go", "GOWORK=/foreign/go.work", "GOPATH=/gopath"})
	assert.Equal(t, []string{"PATH=/bin", "GOPATH=/gopath", "GOWORK=off"}, got)
}
