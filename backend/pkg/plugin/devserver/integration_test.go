//go:build integration

package devserver

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

// ============================================================================
// Helpers
// ============================================================================

// copyTestFixture recursively copies srcDir into dstDir.
func copyTestFixture(t *testing.T, srcDir, dstDir string) {
	t.Helper()
	err := filepath.WalkDir(srcDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		dst := filepath.Join(dstDir, rel)
		if d.IsDir() {
			return os.MkdirAll(dst, 0755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(dst, data, 0644)
	})
	require.NoError(t, err)
}

// waitForCondition polls fn every 50ms until it returns true or timeout elapses.
func waitForCondition(timeout time.Duration, fn func() bool) bool {
	deadline := time.After(timeout)
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		if fn() {
			return true
		}
		select {
		case <-deadline:
			return false
		case <-ticker.C:
		}
	}
}

// goWatcherStatusRecorder records DevProcessStatus values from setStatus callbacks.
type goWatcherStatusRecorder struct {
	ch chan DevProcessStatus
}

func newGoWatcherStatusRecorder() *goWatcherStatusRecorder {
	return &goWatcherStatusRecorder{ch: make(chan DevProcessStatus, 100)}
}

func (r *goWatcherStatusRecorder) record(status DevProcessStatus) {
	r.ch <- status
}

// waitForStatus blocks until the expected status is received or timeout.
func (r *goWatcherStatusRecorder) waitForStatus(expected DevProcessStatus, timeout time.Duration) bool {
	deadline := time.After(timeout)
	for {
		select {
		case s := <-r.ch:
			if s == expected {
				return true
			}
		case <-deadline:
			return false
		}
	}
}

// drainUntil reads statuses until the expected one is seen or timeout.
// Returns the sequence of statuses observed.
func (r *goWatcherStatusRecorder) drainUntil(expected DevProcessStatus, timeout time.Duration) []DevProcessStatus {
	var seen []DevProcessStatus
	deadline := time.After(timeout)
	for {
		select {
		case s := <-r.ch:
			seen = append(seen, s)
			if s == expected {
				return seen
			}
		case <-deadline:
			return seen
		}
	}
}

// goWatcherBuildRecorder records setBuild callback invocations.
type goWatcherBuildRecorder struct {
	ch chan buildResult
}

type buildResult struct {
	duration time.Duration
	buildErr string
}

func newGoWatcherBuildRecorder() *goWatcherBuildRecorder {
	return &goWatcherBuildRecorder{ch: make(chan buildResult, 100)}
}

func (r *goWatcherBuildRecorder) record(duration time.Duration, buildErr string) {
	r.ch <- buildResult{duration: duration, buildErr: buildErr}
}

func (r *goWatcherBuildRecorder) waitForBuild(timeout time.Duration) (buildResult, bool) {
	select {
	case br := <-r.ch:
		return br, true
	case <-time.After(timeout):
		return buildResult{}, false
	}
}

// goWatcherErrorRecorder records emitErrors callback invocations.
type goWatcherErrorRecorder struct {
	ch chan []BuildError
}

func newGoWatcherErrorRecorder() *goWatcherErrorRecorder {
	return &goWatcherErrorRecorder{ch: make(chan []BuildError, 100)}
}

func (r *goWatcherErrorRecorder) record(_ string, errors []BuildError) {
	r.ch <- errors
}

func (r *goWatcherErrorRecorder) waitForErrors(timeout time.Duration) ([]BuildError, bool) {
	select {
	case errs := <-r.ch:
		return errs, true
	case <-time.After(timeout):
		return nil, false
	}
}

// newTestPluginsRoot creates a temporary appstate.ScopedRoot for the plugins
// directory, cleaned up when the test finishes.
func newTestPluginsRoot(t *testing.T) *appstate.ScopedRoot {
	t.Helper()
	return appstate.NewTestService(t).Plugins()
}

// ============================================================================
// Go Watcher Integration Tests
// ============================================================================

func TestIntegration_GoWatcher_BuildOnFileChange(t *testing.T) {
	// Find Go binary.
	goPath, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go binary not found in PATH; skipping integration test")
	}

	// Copy test fixture to temp dir.
	devPath := t.TempDir()
	fixtureDir := filepath.Join("testdata", "test-plugin")
	copyTestFixture(t, fixtureDir, devPath)

	// Set GOWORK=off so the standalone module builds correctly outside the workspace.
	t.Setenv("GOWORK", "off")

	// Redirect HOME so transferBinary doesn't write to real home.
	fakeHome := t.TempDir()
	t.Setenv("HOME", fakeHome)

	// Create callback recorders.
	statusRec := newGoWatcherStatusRecorder()
	buildRec := newGoWatcherBuildRecorder()
	errorRec := newGoWatcherErrorRecorder()
	reloader := &mockPluginReloader{}
	var logEntries []LogEntry
	appendLog := func(entry LogEntry) {
		logEntries = append(logEntries, entry)
	}

	testSvc := appstate.NewTestService(t)

	// Create and start the watcher.
	gw := newGoWatcherProcess(
		context.Background(),
		logging.NewNop(),
		"test-integration",
		devPath,
		BuildOpts{GoPath: goPath},
		reloader,
		testSvc.Plugins(),
		appendLog,
		statusRec.record,
		buildRec.record,
		errorRec.record,
	)

	err = startFixtureWatcher(t, gw)
	require.NoError(t, err, "goWatcherProcess.Start() should succeed")
	defer gw.Stop()

	// Should receive initial Ready status.
	ok := statusRec.waitForStatus(DevProcessStatusReady, 5*time.Second)
	require.True(t, ok, "should receive initial Ready status")

	// Trigger a rebuild by modifying a .go file.
	mainGoPath := filepath.Join(devPath, "pkg", "main.go")
	err = os.WriteFile(mainGoPath, []byte("package main\n\n// modified\nfunc main() {}\n"), 0644)
	require.NoError(t, err)

	// Wait for Building status.
	ok = statusRec.waitForStatus(DevProcessStatusBuilding, 10*time.Second)
	require.True(t, ok, "should receive Building status after file change")

	// Wait for Ready status (build completed).
	ok = statusRec.waitForStatus(DevProcessStatusReady, 30*time.Second)
	require.True(t, ok, "should receive Ready status after successful build")

	// Verify build result.
	br, ok := buildRec.waitForBuild(1 * time.Second)
	require.True(t, ok, "should have received a build result")
	assert.Empty(t, br.buildErr, "build should have succeeded with no error")
	assert.Greater(t, br.duration, time.Duration(0), "build duration should be positive")

	// Verify plugin reloader was called.
	ok = waitForCondition(2*time.Second, func() bool {
		return reloader.getCallCount() > 0
	})
	require.True(t, ok, "reloader.ReloadPlugin should have been called")
	assert.Equal(t, "test-integration", reloader.getLastPluginID())

	// Verify binary was transferred to the plugins directory.
	transferredPath := filepath.Join(testSvc.Plugins().ResolvePath("test-integration"), "bin", "plugin")
	_, err = os.Stat(transferredPath)
	assert.NoError(t, err, "binary should be transferred to plugins/<id>/bin/plugin")
}

func TestIntegration_GoWatcher_BuildError(t *testing.T) {
	goPath, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go binary not found in PATH; skipping integration test")
	}

	devPath := t.TempDir()
	copyTestFixture(t, filepath.Join("testdata", "test-plugin"), devPath)
	t.Setenv("GOWORK", "off")
	t.Setenv("HOME", t.TempDir())

	statusRec := newGoWatcherStatusRecorder()
	buildRec := newGoWatcherBuildRecorder()
	errorRec := newGoWatcherErrorRecorder()
	reloader := &mockPluginReloader{}

	gw := newGoWatcherProcess(
		context.Background(),
		logging.NewNop(),
		"test-build-error",
		devPath,
		BuildOpts{GoPath: goPath},
		reloader,
		appstate.NewTestService(t).Plugins(),
		func(LogEntry) {},
		statusRec.record,
		buildRec.record,
		errorRec.record,
	)

	require.NoError(t, startFixtureWatcher(t, gw))
	defer gw.Stop()

	// Wait for initial Ready.
	require.True(t, statusRec.waitForStatus(DevProcessStatusReady, 5*time.Second))

	// Write invalid Go code.
	mainGoPath := filepath.Join(devPath, "pkg", "main.go")
	err = os.WriteFile(mainGoPath, []byte("package main\n\nfunc main() { undefined_var }\n"), 0644)
	require.NoError(t, err)

	// Wait for Building → Error.
	require.True(t, statusRec.waitForStatus(DevProcessStatusBuilding, 10*time.Second))
	require.True(t, statusRec.waitForStatus(DevProcessStatusError, 30*time.Second))

	// Verify build result has an error.
	br, ok := buildRec.waitForBuild(1 * time.Second)
	require.True(t, ok)
	assert.NotEmpty(t, br.buildErr, "build should have failed")

	// Verify errors were emitted.
	buildErrors, ok := errorRec.waitForErrors(1 * time.Second)
	require.True(t, ok, "emitErrors should have been called")
	assert.NotEmpty(t, buildErrors, "should have parsed build errors")

	// Reloader should NOT have been called (build failed).
	assert.Equal(t, 0, reloader.getCallCount(), "reloader should not be called on build failure")

	// Now fix the code and verify recovery.
	err = os.WriteFile(mainGoPath, []byte("package main\n\nfunc main() {}\n"), 0644)
	require.NoError(t, err)

	// Wait for Building → Ready.
	require.True(t, statusRec.waitForStatus(DevProcessStatusBuilding, 10*time.Second))
	require.True(t, statusRec.waitForStatus(DevProcessStatusReady, 30*time.Second))

	// Reloader should now have been called.
	ok = waitForCondition(2*time.Second, func() bool {
		return reloader.getCallCount() > 0
	})
	require.True(t, ok, "reloader should be called after successful rebuild")
}

func TestIntegration_GoWatcher_Start_MissingPkgDir(t *testing.T) {
	// Create a temp dir with no pkg/ subdirectory.
	devPath := t.TempDir()

	gw := newGoWatcherProcess(
		context.Background(),
		logging.NewNop(),
		"test-no-pkg",
		devPath,
		BuildOpts{GoPath: "/usr/bin/go"},
		&mockPluginReloader{},
		appstate.NewTestService(t).Plugins(),
		func(LogEntry) {},
		func(DevProcessStatus) {},
		func(time.Duration, string) {},
		func(string, []BuildError) {},
	)

	err := startFixtureWatcher(t, gw)
	require.Error(t, err)
	var appErr *apperror.AppError
	require.True(t, errors.As(err, &appErr))
	assert.Equal(t, apperror.TypeValidation, appErr.Type)
	assert.Equal(t, 422, appErr.Status)
	assert.Contains(t, appErr.Detail, "pkg/")
}

// ============================================================================
// Initial build reload test
// ============================================================================

// TestIntegration_GoWatcher_InitialBuild_TriggersReload verifies that the initial
// build in Start() calls ReloadPlugin so the fresh binary is picked up immediately.
// This was Bug 1: initial build transferred the binary but never reloaded.
func TestIntegration_GoWatcher_InitialBuild_TriggersReload(t *testing.T) {
	goPath, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go binary not found in PATH; skipping integration test")
	}

	devPath := t.TempDir()
	copyTestFixture(t, filepath.Join("testdata", "test-plugin"), devPath)
	t.Setenv("GOWORK", "off")
	t.Setenv("HOME", t.TempDir())

	statusRec := newGoWatcherStatusRecorder()
	reloader := &mockPluginReloader{}
	var logEntries []LogEntry

	gw := newGoWatcherProcess(
		context.Background(),
		logging.NewNop(),
		"test-initial-reload",
		devPath,
		BuildOpts{GoPath: goPath},
		reloader,
		appstate.NewTestService(t).Plugins(),
		func(e LogEntry) { logEntries = append(logEntries, e) },
		statusRec.record,
		func(time.Duration, string) {},
		func(string, []BuildError) {},
	)

	err = startFixtureWatcher(t, gw)
	require.NoError(t, err, "Start() should succeed")
	defer gw.Stop()

	// Should reach Ready status from the initial build.
	ok := statusRec.waitForStatus(DevProcessStatusReady, 10*time.Second)
	require.True(t, ok, "should reach Ready status after initial build")

	// ReloadPlugin should have been called exactly once during Start().
	assert.Equal(t, 1, reloader.getCallCount(),
		"ReloadPlugin should be called once after initial build")
	assert.Equal(t, "test-initial-reload", reloader.getLastPluginID())

	// Verify the reload log message appeared.
	hasReloadMsg := false
	for _, entry := range logEntries {
		if entry.Message == "Plugin reloaded with fresh binary" {
			hasReloadMsg = true
			break
		}
	}
	assert.True(t, hasReloadMsg, "should log 'Plugin reloaded with fresh binary'")
}

// TestIntegration_GoWatcher_InitialBuild_ReloadFails verifies that when the
// initial build succeeds but ReloadPlugin fails, the failure is logged but
// Start() still succeeds (the watcher keeps running so the user can fix it).
func TestIntegration_GoWatcher_InitialBuild_ReloadFails(t *testing.T) {
	goPath, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go binary not found in PATH; skipping integration test")
	}

	devPath := t.TempDir()
	copyTestFixture(t, filepath.Join("testdata", "test-plugin"), devPath)
	t.Setenv("GOWORK", "off")
	t.Setenv("HOME", t.TempDir())

	reloader := &mockPluginReloader{err: fmt.Errorf("reload error: simulated")}
	var logEntries []LogEntry

	gw := newGoWatcherProcess(
		context.Background(),
		logging.NewNop(),
		"test-reload-fail",
		devPath,
		BuildOpts{GoPath: goPath},
		reloader,
		appstate.NewTestService(t).Plugins(),
		func(e LogEntry) { logEntries = append(logEntries, e) },
		func(DevProcessStatus) {},
		func(time.Duration, string) {},
		func(string, []BuildError) {},
	)

	err = startFixtureWatcher(t, gw)
	require.NoError(t, err, "Start() should succeed even when reload fails")
	defer gw.Stop()

	// ReloadPlugin was called but failed.
	assert.Equal(t, 1, reloader.getCallCount())

	// Should have an error log about the failed reload.
	hasErrorLog := false
	for _, entry := range logEntries {
		if entry.Source == "go-build" && entry.Level == "error" &&
			entry.Message == "Initial lifecycle build: plugin lifecycle reload: reload error: simulated" {
			hasErrorLog = true
			break
		}
	}
	assert.True(t, hasErrorLog, "should log initial reload failure")
}

// ============================================================================
// Bug-exposing tests (these should FAIL before fixes, PASS after)
// ============================================================================

// TestIntegration_GoWatcher_NoBuildAfterStop verifies that no builds are triggered
// after Stop() returns.
//
// BUG: When a file change creates a debounce timer (500ms) and Stop() is called
// before the timer fires, the timer still fires and triggers handleRebuild on a
// cancelled context — producing spurious Building/Error status transitions.
func TestIntegration_GoWatcher_NoBuildAfterStop(t *testing.T) {
	goPath, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go binary not found in PATH; skipping integration test")
	}

	devPath := t.TempDir()
	copyTestFixture(t, filepath.Join("testdata", "test-plugin"), devPath)
	t.Setenv("GOWORK", "off")
	t.Setenv("HOME", t.TempDir())

	statusRec := newGoWatcherStatusRecorder()
	buildRec := newGoWatcherBuildRecorder()
	reloader := &mockPluginReloader{}

	gw := newGoWatcherProcess(
		context.Background(),
		logging.NewNop(),
		"test-stop-build",
		devPath,
		BuildOpts{GoPath: goPath},
		reloader,
		appstate.NewTestService(t).Plugins(),
		func(LogEntry) {},
		statusRec.record,
		buildRec.record,
		func(string, []BuildError) {},
	)

	require.NoError(t, startFixtureWatcher(t, gw))

	// Wait for initial Ready.
	require.True(t, statusRec.waitForStatus(DevProcessStatusReady, 5*time.Second))

	// Modify a .go file to arm the debounce timer (500ms).
	mainGoPath := filepath.Join(devPath, "pkg", "main.go")
	require.NoError(t, os.WriteFile(mainGoPath, []byte("package main\n\n// touch\nfunc main() {}\n"), 0644))

	// Wait just long enough for fsnotify to deliver the event, but well
	// within the 500ms debounce window.
	time.Sleep(100 * time.Millisecond)

	// Stop the watcher. The debounce timer has ~400ms remaining.
	gw.Stop()

	// After Stop(), wait longer than the debounce interval.
	// No Building status should appear — the timer should have been cancelled.
	gotBuilding := statusRec.waitForStatus(DevProcessStatusBuilding, 2*time.Second)
	assert.False(t, gotBuilding, "no build should be triggered after Stop()")
	assert.Equal(t, 0, reloader.getCallCount(), "reloader should not be called after Stop()")
}

// ============================================================================
// Edge-case tests
// ============================================================================

// TestIntegration_GoWatcher_DebounceRapidChanges verifies that multiple rapid
// file changes within the debounce window produce only a single build.
func TestIntegration_GoWatcher_DebounceRapidChanges(t *testing.T) {
	goPath, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go binary not found in PATH; skipping integration test")
	}

	devPath := t.TempDir()
	copyTestFixture(t, filepath.Join("testdata", "test-plugin"), devPath)
	t.Setenv("GOWORK", "off")
	t.Setenv("HOME", t.TempDir())

	statusRec := newGoWatcherStatusRecorder()
	buildRec := newGoWatcherBuildRecorder()
	reloader := &mockPluginReloader{}

	gw := newGoWatcherProcess(
		context.Background(),
		logging.NewNop(),
		"test-debounce",
		devPath,
		BuildOpts{GoPath: goPath},
		reloader,
		appstate.NewTestService(t).Plugins(),
		func(LogEntry) {},
		statusRec.record,
		buildRec.record,
		func(string, []BuildError) {},
	)

	require.NoError(t, startFixtureWatcher(t, gw))
	defer gw.Stop()
	require.True(t, statusRec.waitForStatus(DevProcessStatusReady, 5*time.Second))

	// Write 5 rapid changes within 200ms (well inside the 500ms debounce).
	mainGoPath := filepath.Join(devPath, "pkg", "main.go")
	for i := 0; i < 5; i++ {
		require.NoError(t, os.WriteFile(mainGoPath,
			[]byte(fmt.Sprintf("package main\n\n// change %d\nfunc main() {}\n", i)), 0644))
		time.Sleep(40 * time.Millisecond)
	}

	// Wait for exactly one build cycle.
	require.True(t, statusRec.waitForStatus(DevProcessStatusBuilding, 10*time.Second))
	require.True(t, statusRec.waitForStatus(DevProcessStatusReady, 30*time.Second))

	// Wait a bit more to see if additional builds fire.
	time.Sleep(2 * time.Second)

	assert.Equal(t, 1, reloader.getCallCount(),
		"rapid changes should be debounced into a single build")
}

// TestIntegration_GoWatcher_IgnoresNonGoFiles verifies that modifying non-Go
// files (.txt, .json, .py) does not trigger a rebuild.
func TestIntegration_GoWatcher_IgnoresNonGoFiles(t *testing.T) {
	goPath, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go binary not found in PATH; skipping integration test")
	}

	devPath := t.TempDir()
	copyTestFixture(t, filepath.Join("testdata", "test-plugin"), devPath)
	t.Setenv("GOWORK", "off")
	t.Setenv("HOME", t.TempDir())

	statusRec := newGoWatcherStatusRecorder()
	reloader := &mockPluginReloader{}

	gw := newGoWatcherProcess(
		context.Background(),
		logging.NewNop(),
		"test-ignore-nongo",
		devPath,
		BuildOpts{GoPath: goPath},
		reloader,
		appstate.NewTestService(t).Plugins(),
		func(LogEntry) {},
		statusRec.record,
		func(time.Duration, string) {},
		func(string, []BuildError) {},
	)

	require.NoError(t, startFixtureWatcher(t, gw))
	defer gw.Stop()
	require.True(t, statusRec.waitForStatus(DevProcessStatusReady, 5*time.Second))

	// Write non-Go files in the watched pkg/ directory.
	// Covers typical frontend/config files that should never trigger a Go rebuild.
	require.NoError(t, os.WriteFile(filepath.Join(devPath, "pkg", "notes.txt"), []byte("hello"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(devPath, "pkg", "data.json"), []byte("{}"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(devPath, "pkg", "script.py"), []byte("pass"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(devPath, "pkg", "component.ts"), []byte("export const x = 1;"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(devPath, "pkg", "component.tsx"), []byte("export default () => null;"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(devPath, "pkg", "styles.css"), []byte("body{}"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(devPath, "pkg", "README.md"), []byte("# readme"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(devPath, "pkg", "config.yaml"), []byte("key: val"), 0644))

	// Wait longer than the debounce interval + some margin.
	time.Sleep(1500 * time.Millisecond)

	gotBuilding := statusRec.waitForStatus(DevProcessStatusBuilding, 500*time.Millisecond)
	assert.False(t, gotBuilding, "non-Go files should not trigger a build")
	assert.Equal(t, 0, reloader.getCallCount())
}

// TestIntegration_GoWatcher_NestedSubdirChange verifies that file changes in
// nested subdirectories under pkg/ are detected and trigger a rebuild.
func TestIntegration_GoWatcher_NestedSubdirChange(t *testing.T) {
	goPath, err := exec.LookPath("go")
	if err != nil {
		t.Skip("go binary not found in PATH; skipping integration test")
	}

	devPath := t.TempDir()
	copyTestFixture(t, filepath.Join("testdata", "test-plugin"), devPath)
	t.Setenv("GOWORK", "off")
	t.Setenv("HOME", t.TempDir())

	// Create a nested subdirectory with a Go file BEFORE Start.
	nestedDir := filepath.Join(devPath, "pkg", "sub")
	require.NoError(t, os.MkdirAll(nestedDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(nestedDir, "helper.go"),
		[]byte("package main\n"), 0644))

	statusRec := newGoWatcherStatusRecorder()
	reloader := &mockPluginReloader{}

	gw := newGoWatcherProcess(
		context.Background(),
		logging.NewNop(),
		"test-nested",
		devPath,
		BuildOpts{GoPath: goPath},
		reloader,
		appstate.NewTestService(t).Plugins(),
		func(LogEntry) {},
		statusRec.record,
		func(time.Duration, string) {},
		func(string, []BuildError) {},
	)

	require.NoError(t, startFixtureWatcher(t, gw))
	defer gw.Stop()
	require.True(t, statusRec.waitForStatus(DevProcessStatusReady, 5*time.Second))

	// Modify the nested file.
	require.NoError(t, os.WriteFile(filepath.Join(nestedDir, "helper.go"),
		[]byte("package main\n\n// modified\n"), 0644))

	require.True(t, statusRec.waitForStatus(DevProcessStatusBuilding, 10*time.Second))
	require.True(t, statusRec.waitForStatus(DevProcessStatusReady, 30*time.Second))
	assert.Equal(t, 1, reloader.getCallCount())
}

// TestIntegration_GoWatcher_ReloaderError verifies that when the build succeeds
// but the reloader returns an error, only runtime readiness fails; build remains ready.
func TestIntegration_GoWatcher_ReloaderError(t *testing.T) {
	goPath, err := exec.LookPath("go")
	if err != nil {
		t.Skip("Go unavailable")
	}
	devPath := t.TempDir()
	copyTestFixture(t, filepath.Join("testdata", "test-plugin"), devPath)
	root := appstate.NewTestService(t).Plugins()
	inst, _, _ := newTestInstance(t, "reload-error")
	inst.hasBackend = true
	inst.initializeStages()
	reloader := &mockPluginReloader{err: fmt.Errorf("RPC unavailable")}
	gw := newGoWatcherProcess(context.Background(), logging.NewNop(), "reload-error", devPath, BuildOpts{GoPath: goPath}, reloader, root, inst.appendLog, inst.setGoStatus, inst.setBuildResult, func(string, []BuildError) {})
	gw.runtimeError = func(err error) { inst.notifyLifecycle(false, false, err) }
	require.NoError(t, startFixtureWatcher(t, gw))
	defer gw.Stop()
	state := inst.State()
	require.Equal(t, StageReady, state.BuildStatus)
	require.Equal(t, StageError, state.RPCStatus)
	require.False(t, state.GRPCConnected)
	require.False(t, state.Ready)
	_, err = root.Stat(filepath.Join("reload-error", "bin", "plugin"))
	require.NoError(t, err, "real successful build artifact must remain available despite failed RPC load")
	require.ErrorContains(t, gw.handleRebuild("manual"), "RPC unavailable")
	require.Equal(t, StageReady, inst.State().BuildStatus)
}
