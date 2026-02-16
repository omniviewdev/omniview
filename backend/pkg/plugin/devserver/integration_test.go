//go:build integration

package devserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
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

	// Create and start the watcher.
	gw := newGoWatcherProcess(
		context.Background(),
		zap.NewNop().Sugar(),
		"test-integration",
		devPath,
		BuildOpts{GoPath: goPath},
		reloader,
		appendLog,
		statusRec.record,
		buildRec.record,
		errorRec.record,
	)

	err = gw.Start()
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

	// Verify binary exists in build output.
	_, err = os.Stat(filepath.Join(devPath, "build", "bin", "plugin"))
	assert.NoError(t, err, "built binary should exist in devPath/build/bin/plugin")

	// Verify binary was transferred to fake home.
	transferredPath := filepath.Join(fakeHome, ".omniview", "plugins", "test-integration", "bin", "plugin")
	_, err = os.Stat(transferredPath)
	assert.NoError(t, err, "binary should be transferred to ~/.omniview/plugins/<id>/bin/plugin")
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
		zap.NewNop().Sugar(),
		"test-build-error",
		devPath,
		BuildOpts{GoPath: goPath},
		reloader,
		func(LogEntry) {},
		statusRec.record,
		buildRec.record,
		errorRec.record,
	)

	require.NoError(t, gw.Start())
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
		zap.NewNop().Sugar(),
		"test-no-pkg",
		devPath,
		BuildOpts{GoPath: "/usr/bin/go"},
		&mockPluginReloader{},
		func(LogEntry) {},
		func(DevProcessStatus) {},
		func(time.Duration, string) {},
		func(string, []BuildError) {},
	)

	err := gw.Start()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "pkg/ directory does not exist")
}

// ============================================================================
// ExternalWatcher Integration Tests
// ============================================================================

func TestIntegration_ExternalWatcher_DetectDevInfo(t *testing.T) {
	pluginDir := t.TempDir()
	pluginID := "ext-test-plugin"

	// Create the plugin subdirectory.
	pluginSubDir := filepath.Join(pluginDir, pluginID)
	require.NoError(t, os.MkdirAll(pluginSubDir, 0755))

	cr := &connectRecorder{}
	dr := &disconnectRecorder{}

	// Create a real fsnotify watcher and build ExternalWatcher manually
	// (to avoid NewExternalWatcher which hardcodes ~/.omniview).
	watcher, err := fsnotify.NewWatcher()
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ew := &ExternalWatcher{
		ctx:          ctx,
		logger:       zap.NewNop().Sugar(),
		watcher:      watcher,
		connections:  make(map[string]*ExternalConnection),
		pluginDir:    pluginDir,
		done:         make(chan struct{}),
		onConnect:    cr.record,
		onDisconnect: dr.record,
	}

	// Watch the plugin subdirectory and the parent.
	require.NoError(t, watcher.Add(pluginDir))
	require.NoError(t, watcher.Add(pluginSubDir))

	// Start the event loop.
	go ew.run()
	defer ew.Stop()

	// Give the watcher a moment to settle.
	time.Sleep(100 * time.Millisecond)

	// Write a valid .devinfo file.
	info := DevInfoFile{
		PID:      os.Getpid(),
		Addr:     "127.0.0.1:50051",
		PluginID: pluginID,
		VitePort: 15173,
	}
	data, err := json.Marshal(info)
	require.NoError(t, err)
	devInfoPath := filepath.Join(pluginSubDir, ".devinfo")
	require.NoError(t, os.WriteFile(devInfoPath, data, 0644))

	// Wait for connect callback.
	ok := waitForCondition(5*time.Second, func() bool {
		return cr.count() > 0
	})
	require.True(t, ok, "onConnect should have been called after writing .devinfo")

	assert.True(t, ew.IsExternallyManaged(pluginID))
	extInfo := ew.GetExternalInfo(pluginID)
	require.NotNil(t, extInfo)
	assert.Equal(t, os.Getpid(), extInfo.PID)
	assert.Equal(t, "127.0.0.1:50051", extInfo.Addr)

	// Remove .devinfo and verify disconnect.
	require.NoError(t, os.Remove(devInfoPath))

	ok = waitForCondition(5*time.Second, func() bool {
		return dr.count() > 0
	})
	require.True(t, ok, "onDisconnect should have been called after removing .devinfo")
	assert.False(t, ew.IsExternallyManaged(pluginID))
}

func TestIntegration_ExternalWatcher_StaleDevInfo(t *testing.T) {
	pluginDir := t.TempDir()
	pluginID := "stale-plugin"

	pluginSubDir := filepath.Join(pluginDir, pluginID)
	require.NoError(t, os.MkdirAll(pluginSubDir, 0755))

	cr := &connectRecorder{}
	dr := &disconnectRecorder{}

	watcher, err := fsnotify.NewWatcher()
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ew := &ExternalWatcher{
		ctx:          ctx,
		logger:       zap.NewNop().Sugar(),
		watcher:      watcher,
		connections:  make(map[string]*ExternalConnection),
		pluginDir:    pluginDir,
		done:         make(chan struct{}),
		onConnect:    cr.record,
		onDisconnect: dr.record,
	}

	require.NoError(t, watcher.Add(pluginDir))
	require.NoError(t, watcher.Add(pluginSubDir))

	go ew.run()
	defer ew.Stop()

	time.Sleep(100 * time.Millisecond)

	// Write a .devinfo with a dead PID.
	info := DevInfoFile{
		PID:      9999999,
		Addr:     "127.0.0.1:50051",
		PluginID: pluginID,
	}
	data, err := json.Marshal(info)
	require.NoError(t, err)
	devInfoPath := filepath.Join(pluginSubDir, ".devinfo")
	require.NoError(t, os.WriteFile(devInfoPath, data, 0644))

	// Give it time to process the event.
	time.Sleep(1 * time.Second)

	// Connect should NOT have been called (dead PID).
	assert.Equal(t, 0, cr.count(), "should not connect for dead PID")
	assert.False(t, ew.IsExternallyManaged(pluginID))

	// The stale .devinfo file should have been cleaned up.
	_, err = os.Stat(devInfoPath)
	assert.True(t, os.IsNotExist(err), "stale .devinfo should be removed")
}

func TestIntegration_ExternalWatcher_ScanOnStart(t *testing.T) {
	pluginDir := t.TempDir()

	cr := &connectRecorder{}
	dr := &disconnectRecorder{}

	// Write valid .devinfo files for two plugins BEFORE starting.
	for _, id := range []string{"scan-plugin-a", "scan-plugin-b"} {
		dir := filepath.Join(pluginDir, id)
		require.NoError(t, os.MkdirAll(dir, 0755))
		info := DevInfoFile{
			PID:      os.Getpid(),
			Addr:     "127.0.0.1:50051",
			PluginID: id,
		}
		data, err := json.Marshal(info)
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(filepath.Join(dir, ".devinfo"), data, 0644))
	}

	// Create the ExternalWatcher manually with real watcher.
	watcher, err := fsnotify.NewWatcher()
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ew := &ExternalWatcher{
		ctx:          ctx,
		logger:       zap.NewNop().Sugar(),
		watcher:      watcher,
		connections:  make(map[string]*ExternalConnection),
		pluginDir:    pluginDir,
		done:         make(chan struct{}),
		onConnect:    cr.record,
		onDisconnect: dr.record,
	}

	// Call Start which does scanExistingDevInfoFiles.
	err = ew.Start(ctx)
	require.NoError(t, err)
	defer ew.Stop()

	// Both plugins should be detected via scan.
	assert.Equal(t, 2, cr.count(), "both pre-existing plugins should be detected on start")
	assert.True(t, ew.IsExternallyManaged("scan-plugin-a"))
	assert.True(t, ew.IsExternallyManaged("scan-plugin-b"))
}

// ============================================================================
// Bug-exposing tests (these should FAIL before fixes, PASS after)
// ============================================================================

// TestIntegration_ExternalWatcher_StopBlocksUntilRunExits verifies that Stop()
// blocks until the run() goroutine has fully exited.
//
// BUG: Stop() returns immediately after closing the watcher. If run() is inside
// handleDevInfoCreated (which has a 50ms sleep), it continues processing and
// fires callbacks after Stop() has returned.
func TestIntegration_ExternalWatcher_StopBlocksUntilRunExits(t *testing.T) {
	pluginDir := t.TempDir()
	pluginID := "stop-sync-plugin"
	pluginSubDir := filepath.Join(pluginDir, pluginID)
	require.NoError(t, os.MkdirAll(pluginSubDir, 0755))

	cr := &connectRecorder{}
	dr := &disconnectRecorder{}

	watcher, err := fsnotify.NewWatcher()
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ew := &ExternalWatcher{
		ctx:          ctx,
		logger:       zap.NewNop().Sugar(),
		watcher:      watcher,
		connections:  make(map[string]*ExternalConnection),
		pluginDir:    pluginDir,
		done:         make(chan struct{}),
		onConnect:    cr.record,
		onDisconnect: dr.record,
	}

	require.NoError(t, watcher.Add(pluginDir))
	require.NoError(t, watcher.Add(pluginSubDir))

	// Start run() and track when it exits.
	runExited := make(chan struct{})
	go func() {
		ew.run()
		close(runExited)
	}()

	// Write .devinfo to make run() call handleDevInfoCreated, which has a 50ms sleep.
	info := DevInfoFile{
		PID:      os.Getpid(),
		Addr:     "127.0.0.1:50051",
		PluginID: pluginID,
	}
	data, err := json.Marshal(info)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(pluginSubDir, ".devinfo"), data, 0644))

	// Wait for fsnotify to deliver the event. run() will then enter
	// handleDevInfoCreated which sleeps 50ms. We sleep 30ms so we call Stop()
	// while handleDevInfoCreated is still in its sleep.
	time.Sleep(30 * time.Millisecond)

	// Stop should block until run() finishes — including the in-flight
	// handleDevInfoCreated call. Currently it doesn't wait.
	ew.Stop()

	// If Stop() properly waited, run() should have already exited.
	select {
	case <-runExited:
		// Good — Stop() blocked until run() exited.
	default:
		t.Fatal("Stop() returned before run() goroutine exited; Stop() should block until run() is done")
	}
}

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
		zap.NewNop().Sugar(),
		"test-stop-build",
		devPath,
		BuildOpts{GoPath: goPath},
		reloader,
		func(LogEntry) {},
		statusRec.record,
		buildRec.record,
		func(string, []BuildError) {},
	)

	require.NoError(t, gw.Start())

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

// TestIntegration_ExternalWatcher_RenameDisconnects verifies that renaming a
// .devinfo file (not just removing it) triggers a disconnect.
//
// BUG: The run() event loop only handles Remove events for .devinfo files,
// not Rename events. On many platforms/editors, file deletion manifests as a
// Rename event, causing missed disconnects.
func TestIntegration_ExternalWatcher_RenameDisconnects(t *testing.T) {
	pluginDir := t.TempDir()
	pluginID := "rename-plugin"
	pluginSubDir := filepath.Join(pluginDir, pluginID)
	require.NoError(t, os.MkdirAll(pluginSubDir, 0755))

	cr := &connectRecorder{}
	dr := &disconnectRecorder{}

	watcher, err := fsnotify.NewWatcher()
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ew := &ExternalWatcher{
		ctx:          ctx,
		logger:       zap.NewNop().Sugar(),
		watcher:      watcher,
		connections:  make(map[string]*ExternalConnection),
		pluginDir:    pluginDir,
		done:         make(chan struct{}),
		onConnect:    cr.record,
		onDisconnect: dr.record,
	}

	require.NoError(t, watcher.Add(pluginDir))
	require.NoError(t, watcher.Add(pluginSubDir))

	go ew.run()
	defer ew.Stop()

	time.Sleep(100 * time.Millisecond)

	// Write .devinfo and wait for connect.
	info := DevInfoFile{
		PID:      os.Getpid(),
		Addr:     "127.0.0.1:50051",
		PluginID: pluginID,
	}
	data, err := json.Marshal(info)
	require.NoError(t, err)
	devInfoPath := filepath.Join(pluginSubDir, ".devinfo")
	require.NoError(t, os.WriteFile(devInfoPath, data, 0644))

	require.True(t, waitForCondition(5*time.Second, func() bool {
		return cr.count() > 0
	}), "should connect after writing .devinfo")

	// Rename the .devinfo file instead of removing it.
	// This generates a Rename event (not Remove) on most platforms.
	require.NoError(t, os.Rename(devInfoPath, devInfoPath+".bak"))

	// Should trigger disconnect.
	ok := waitForCondition(3*time.Second, func() bool {
		return dr.count() > 0
	})
	assert.True(t, ok, "renaming .devinfo away should trigger disconnect")
	assert.False(t, ew.IsExternallyManaged(pluginID))
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
		zap.NewNop().Sugar(),
		"test-debounce",
		devPath,
		BuildOpts{GoPath: goPath},
		reloader,
		func(LogEntry) {},
		statusRec.record,
		buildRec.record,
		func(string, []BuildError) {},
	)

	require.NoError(t, gw.Start())
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
		zap.NewNop().Sugar(),
		"test-ignore-nongo",
		devPath,
		BuildOpts{GoPath: goPath},
		reloader,
		func(LogEntry) {},
		statusRec.record,
		func(time.Duration, string) {},
		func(string, []BuildError) {},
	)

	require.NoError(t, gw.Start())
	defer gw.Stop()
	require.True(t, statusRec.waitForStatus(DevProcessStatusReady, 5*time.Second))

	// Write non-Go files in the watched pkg/ directory.
	require.NoError(t, os.WriteFile(filepath.Join(devPath, "pkg", "notes.txt"), []byte("hello"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(devPath, "pkg", "data.json"), []byte("{}"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(devPath, "pkg", "script.py"), []byte("pass"), 0644))

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
		zap.NewNop().Sugar(),
		"test-nested",
		devPath,
		BuildOpts{GoPath: goPath},
		reloader,
		func(LogEntry) {},
		statusRec.record,
		func(time.Duration, string) {},
		func(string, []BuildError) {},
	)

	require.NoError(t, gw.Start())
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
// but the reloader returns an error, the status transitions to Error (not Ready).
func TestIntegration_GoWatcher_ReloaderError(t *testing.T) {
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
	reloader := &mockPluginReloader{err: fmt.Errorf("reload failed: simulated")}

	gw := newGoWatcherProcess(
		context.Background(),
		zap.NewNop().Sugar(),
		"test-reload-err",
		devPath,
		BuildOpts{GoPath: goPath},
		reloader,
		func(LogEntry) {},
		statusRec.record,
		buildRec.record,
		func(string, []BuildError) {},
	)

	require.NoError(t, gw.Start())
	defer gw.Stop()
	require.True(t, statusRec.waitForStatus(DevProcessStatusReady, 5*time.Second))

	// Trigger a build.
	mainGoPath := filepath.Join(devPath, "pkg", "main.go")
	require.NoError(t, os.WriteFile(mainGoPath,
		[]byte("package main\n\n// trigger\nfunc main() {}\n"), 0644))

	// Build succeeds, but reloader fails → Error, not Ready.
	require.True(t, statusRec.waitForStatus(DevProcessStatusBuilding, 10*time.Second))
	require.True(t, statusRec.waitForStatus(DevProcessStatusError, 30*time.Second))

	br, ok := buildRec.waitForBuild(1 * time.Second)
	require.True(t, ok)
	assert.Contains(t, br.buildErr, "reload failed")
}

// TestIntegration_ExternalWatcher_AutoWatchNewDir verifies that when a new plugin
// directory is created at runtime, run() auto-watches it and detects subsequent
// .devinfo files.
func TestIntegration_ExternalWatcher_AutoWatchNewDir(t *testing.T) {
	pluginDir := t.TempDir()

	cr := &connectRecorder{}
	dr := &disconnectRecorder{}

	watcher, err := fsnotify.NewWatcher()
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ew := &ExternalWatcher{
		ctx:          ctx,
		logger:       zap.NewNop().Sugar(),
		watcher:      watcher,
		connections:  make(map[string]*ExternalConnection),
		pluginDir:    pluginDir,
		done:         make(chan struct{}),
		onConnect:    cr.record,
		onDisconnect: dr.record,
	}

	// Only watch the parent directory — no subdirectories yet.
	require.NoError(t, watcher.Add(pluginDir))

	go ew.run()
	defer ew.Stop()

	time.Sleep(100 * time.Millisecond)

	// Create a NEW plugin directory at runtime.
	pluginID := "runtime-new-plugin"
	pluginSubDir := filepath.Join(pluginDir, pluginID)
	require.NoError(t, os.MkdirAll(pluginSubDir, 0755))

	// Give run() time to detect the new dir and add it to the watcher.
	time.Sleep(200 * time.Millisecond)

	// Write .devinfo in the newly-created directory.
	info := DevInfoFile{
		PID:      os.Getpid(),
		Addr:     "127.0.0.1:50051",
		PluginID: pluginID,
	}
	data, err := json.Marshal(info)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(pluginSubDir, ".devinfo"), data, 0644))

	// Should detect the .devinfo in the dynamically-watched directory.
	ok := waitForCondition(5*time.Second, func() bool {
		return cr.count() > 0
	})
	require.True(t, ok, "should detect .devinfo in dynamically-watched new directory")
	assert.True(t, ew.IsExternallyManaged(pluginID))
}

// TestIntegration_ExternalWatcher_HealthCheckDetectsDeadPID verifies that the
// health check loop detects when a plugin's PID dies and triggers a disconnect.
func TestIntegration_ExternalWatcher_HealthCheckDetectsDeadPID(t *testing.T) {
	pluginDir := t.TempDir()
	pluginID := "dying-plugin"
	pluginSubDir := filepath.Join(pluginDir, pluginID)
	require.NoError(t, os.MkdirAll(pluginSubDir, 0755))

	cr := &connectRecorder{}
	dr := &disconnectRecorder{}

	watcher, err := fsnotify.NewWatcher()
	require.NoError(t, err)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	ew := &ExternalWatcher{
		ctx:          ctx,
		logger:       zap.NewNop().Sugar(),
		watcher:      watcher,
		connections:  make(map[string]*ExternalConnection),
		pluginDir:    pluginDir,
		done:         make(chan struct{}),
		onConnect:    cr.record,
		onDisconnect: dr.record,
	}

	require.NoError(t, watcher.Add(pluginDir))
	require.NoError(t, watcher.Add(pluginSubDir))

	go ew.run()
	defer ew.Stop()

	time.Sleep(100 * time.Millisecond)

	// Start a subprocess we can kill.
	cmd := exec.Command("sleep", "100")
	require.NoError(t, cmd.Start())
	pid := cmd.Process.Pid

	// Write .devinfo with the subprocess PID.
	info := DevInfoFile{
		PID:      pid,
		Addr:     "127.0.0.1:50051",
		PluginID: pluginID,
	}
	data, err := json.Marshal(info)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(pluginSubDir, ".devinfo"), data, 0644))

	// Wait for connect.
	require.True(t, waitForCondition(5*time.Second, func() bool {
		return cr.count() > 0
	}), "should connect after writing .devinfo")
	assert.True(t, ew.IsExternallyManaged(pluginID))

	// Kill the subprocess.
	cmd.Process.Kill()
	cmd.Wait()

	// Health check runs every 5s, so we need to wait for the next tick.
	ok := waitForCondition(8*time.Second, func() bool {
		return dr.count() > 0
	})
	require.True(t, ok, "health check should detect dead PID and disconnect")
	assert.False(t, ew.IsExternallyManaged(pluginID))

	// .devinfo should be cleaned up by the health check.
	_, err = os.Stat(filepath.Join(pluginSubDir, ".devinfo"))
	assert.True(t, os.IsNotExist(err), "health check should clean up .devinfo for dead PID")
}
