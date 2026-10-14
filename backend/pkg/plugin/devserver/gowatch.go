package devserver

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/internal/appstate"
	logging "github.com/omniviewdev/plugin-sdk/log"
)

const (
	// DedupInterval is the debounce window for file change events.
	DedupInterval = 500 * time.Millisecond

	// goWatcherStopTimeout bounds how long Stop waits for the event loop to exit.
	goWatcherStopTimeout = 5 * time.Second

	// dirPerm and filePerm are the permissions for directories and files the
	// dev server creates in the plugins root.
	dirPerm  os.FileMode = 0o755
	filePerm os.FileMode = 0o644
)

// goWatcherProcess watches Go source files for changes and rebuilds the plugin binary.
type goWatcherProcess struct {
	ctx    context.Context
	cancel context.CancelFunc
	logger logging.Logger

	pluginID    string
	devPath     string
	buildOpts   BuildOpts
	reloader    PluginReloader
	pluginsRoot *appstate.ScopedRoot

	appendLog  func(LogEntry)
	setStatus  func(DevProcessStatus)
	setBuild   func(duration time.Duration, buildErr string)
	emitErrors func(pluginID string, errors []BuildError)

	watcher *fsnotify.Watcher
	done    chan struct{} // closed when the watcher goroutine exits
}

// newGoWatcherProcess creates a Go watcher. Call Start() to begin watching.
func newGoWatcherProcess(
	parentCtx context.Context,
	logger logging.Logger,
	pluginID string,
	devPath string,
	buildOpts BuildOpts,
	reloader PluginReloader,
	pluginsRoot *appstate.ScopedRoot,
	appendLog func(LogEntry),
	setStatus func(DevProcessStatus),
	setBuild func(duration time.Duration, buildErr string),
	emitErrors func(pluginID string, errors []BuildError),
) *goWatcherProcess {
	ctx, cancel := context.WithCancel(parentCtx)
	return &goWatcherProcess{
		ctx:         ctx,
		cancel:      cancel,
		logger:      logger.Named("gowatch"),
		pluginID:    pluginID,
		devPath:     devPath,
		buildOpts:   buildOpts,
		reloader:    reloader,
		pluginsRoot: pluginsRoot,
		appendLog:   appendLog,
		setStatus:   setStatus,
		setBuild:    setBuild,
		emitErrors:  emitErrors,
		watcher:     nil,
		done:        make(chan struct{}),
	}
}

// Start initializes the fsnotify watcher, walks the `pkg/` directory to register
// all subdirectories, and starts the event loop goroutine.
func (gw *goWatcherProcess) Start() error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return apperror.Internal(err, "Failed to create file watcher")
	}
	gw.watcher = watcher

	// Walk the pkg/ directory and add all subdirectories.
	pkgDir := filepath.Join(gw.devPath, "pkg")
	if _, statErr := os.Stat(pkgDir); os.IsNotExist(statErr) {
		watcher.Close()
		return apperror.New(
			apperror.TypeValidation,
			http.StatusUnprocessableEntity,
			"Plugin directory not found",
			"Plugin pkg/ directory does not exist: "+pkgDir,
		)
	}

	watchCount := 0
	err = filepath.Walk(pkgDir, gw.watchDirsFunc(watcher, &watchCount))
	if err != nil {
		watcher.Close()
		return apperror.Internal(err, "Failed to scan plugin directory")
	}

	// Watch the plugin root directory for go.mod/go.sum changes.
	if addErr := watcher.Add(gw.devPath); addErr != nil {
		gw.logger.Warnw(context.Background(), "failed to watch plugin root", "path", gw.devPath, "error", addErr)
	} else {
		watchCount++
	}

	// Parse go.work and watch workspace module pkg/ directories so that
	// changes to dependencies like plugin-sdk trigger a rebuild.
	gw.watchWorkspaceModules(watcher, &watchCount)

	gw.logger.Infow(context.Background(), "go file watcher started", "directories", watchCount)
	gw.appendLog(newLogEntry(
		logSourceGoWatch, logLevelInfo, fmt.Sprintf("Watching %d directories for Go changes", watchCount),
	))

	// Perform initial build so the binary exists for LoadPlugin validation.
	gw.initialBuild()

	// Start the event loop.
	go gw.eventLoop()

	return nil
}

// watchDirsFunc returns a filepath.WalkFunc that adds every directory it visits
// to the watcher (skipping hidden directories, vendor and node_modules) and
// counts the directories added.
func (gw *goWatcherProcess) watchDirsFunc(watcher *fsnotify.Watcher, watchCount *int) filepath.WalkFunc {
	return func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() {
			// Skip hidden directories and vendor.
			base := filepath.Base(path)
			if strings.HasPrefix(base, ".") || base == "vendor" || base == "node_modules" {
				return filepath.SkipDir
			}
			if addErr := watcher.Add(path); addErr != nil {
				gw.logger.Warnw(context.Background(), "failed to watch directory", "path", path, "error", addErr)
			} else {
				*watchCount++
			}
		}
		return nil
	}
}

// watchWorkspaceModules parses go.work and watches the pkg/ directories of the
// workspace modules it uses.
func (gw *goWatcherProcess) watchWorkspaceModules(watcher *fsnotify.Watcher, watchCount *int) {
	goWorkPath := filepath.Join(gw.devPath, "go.work")
	data, readErr := os.ReadFile(goWorkPath)
	if readErr != nil {
		return
	}
	for _, mod := range parseGoWorkUseDirectives(data) {
		if mod == "." {
			continue
		}
		modPkg := filepath.Join(gw.devPath, mod, "pkg")
		if info, statErr := os.Stat(modPkg); statErr == nil && info.IsDir() {
			_ = filepath.Walk(modPkg, gw.watchDirsFunc(watcher, watchCount))
		}
	}
}

// initialBuild builds, transfers and reloads the plugin once when the watcher
// starts. Failures are logged and reflected in the status; the watcher still
// starts so the user can fix the code and rebuild.
func (gw *goWatcherProcess) initialBuild() {
	gw.setStatus(DevProcessStatusBuilding)
	gw.appendLog(newLogEntry(logSourceGoBuild, logLevelInfo, "Running initial build..."))

	startTime := time.Now()
	if err := gw.runGoBuild(); err != nil {
		gw.logger.Warnw(context.Background(), "initial go build failed", "error", err)
		gw.appendLog(newLogEntry(logSourceGoBuild, logLevelError, fmt.Sprintf("Initial build failed: %v", err)))
		gw.setBuild(time.Since(startTime), err.Error())
		gw.setStatus(DevProcessStatusError)
		return
	}

	duration := time.Since(startTime)
	if err := gw.transferBinary(); err != nil {
		gw.logger.Errorw(context.Background(), "initial binary transfer failed", "error", err)
		gw.appendLog(newLogEntry(logSourceGoBuild, logLevelError, fmt.Sprintf("Binary transfer failed: %v", err)))
		gw.setBuild(duration, err.Error())
		gw.setStatus(DevProcessStatusError)
		return
	}

	gw.logger.Infow(context.Background(), "initial build succeeded", "duration", duration)
	gw.appendLog(newLogEntry(
		logSourceGoBuild, logLevelInfo,
		fmt.Sprintf("Initial build succeeded in %s", duration.Round(time.Millisecond)),
	))
	gw.setBuild(duration, "")
	gw.setStatus(DevProcessStatusReady)

	// Sync plugin.yaml so capability changes are picked up.
	if err := gw.syncPluginYaml(); err != nil {
		gw.logger.Warnw(context.Background(), "failed to sync plugin.yaml on initial build", "error", err)
	}

	// Reload the plugin so the fresh binary is picked up.
	err := gw.reloader.ReloadPlugin(gw.pluginID)
	if err == nil {
		gw.appendLog(newLogEntry(logSourceGoBuild, logLevelInfo, "Plugin reloaded with fresh binary"))
		return
	}
	var appErr *apperror.AppError
	if errors.As(err, &appErr) && appErr.Type == apperror.TypePluginNotLoaded {
		// During dev install the watcher may finish initial build before
		// InstallInDevMode has called LoadPlugin; this is expected.
		gw.logger.Infow(context.Background(), "initial plugin reload skipped (plugin not loaded yet)")
		gw.appendLog(newLogEntry(logSourceGoBuild, logLevelInfo, "Initial reload skipped: plugin not loaded yet"))
		return
	}
	gw.logger.Errorw(context.Background(), "initial plugin reload failed", "error", err)
	gw.appendLog(newLogEntry(logSourceGoBuild, logLevelError, fmt.Sprintf("Initial reload failed: %v", err)))
}

// Stop shuts down the fsnotify watcher and waits for the event loop to exit.
func (gw *goWatcherProcess) Stop() {
	gw.cancel()
	if gw.watcher != nil {
		gw.watcher.Close()
	}
	// Wait for the event loop to finish.
	select {
	case <-gw.done:
	case <-time.After(goWatcherStopTimeout):
		gw.logger.Warnw(context.Background(), "go watcher event loop did not exit in time")
	}
}

// eventLoop processes fsnotify events with debouncing.
func (gw *goWatcherProcess) eventLoop() {
	defer close(gw.done)

	var (
		mu     sync.Mutex
		timers = make(map[string]*time.Timer)
	)

	goExtensions := []string{".go", ".mod", ".sum"}

	for {
		select {
		case <-gw.ctx.Done():
			// Cancel all pending debounce timers to prevent spurious
			// builds after the watcher has been stopped.
			mu.Lock()
			for name, t := range timers {
				t.Stop()
				delete(timers, name)
			}
			mu.Unlock()
			return

		case err, ok := <-gw.watcher.Errors:
			if !ok {
				return
			}
			gw.logger.Errorw(context.Background(), "fsnotify error", "error", err)
			gw.appendLog(newLogEntry(logSourceGoWatch, logLevelError, fmt.Sprintf("Watcher error: %v", err)))

		case event, ok := <-gw.watcher.Events:
			if !ok {
				return
			}

			// Only care about Create and Write events on Go files.
			if !event.Has(fsnotify.Create) && !event.Has(fsnotify.Write) {
				continue
			}
			ext := filepath.Ext(event.Name)
			if !slices.Contains(goExtensions, ext) {
				continue
			}

			gw.logger.Debugw(context.Background(), "go file changed", "file", event.Name, "op", event.Op)

			// Debounce: reset the timer for this file path.
			gw.debounceRebuild(&mu, timers, event.Name)
		}
	}
}

// debounceRebuild (re)starts the debounce timer for name; when it fires, the
// plugin is rebuilt and the timer is removed from timers. mu guards timers.
func (gw *goWatcherProcess) debounceRebuild(mu *sync.Mutex, timers map[string]*time.Timer, name string) {
	mu.Lock()
	t, exists := timers[name]
	if !exists {
		t = time.AfterFunc(math.MaxInt64, func() {
			gw.handleRebuild(name)
			mu.Lock()
			delete(timers, name)
			mu.Unlock()
		})
		t.Stop()
		timers[name] = t
	}
	t.Reset(DedupInterval)
	mu.Unlock()
}

// handleRebuild performs a go build, copies the binary if successful, and triggers plugin reload.
func (gw *goWatcherProcess) handleRebuild(changedFile string) {
	l := gw.logger.With(logging.Any("changedFile", changedFile))
	l.Infow(context.Background(), "rebuilding plugin binary")

	gw.setStatus(DevProcessStatusBuilding)
	gw.appendLog(newLogEntry(
		logSourceGoBuild, logLevelInfo,
		fmt.Sprintf("Building plugin (triggered by %s)", filepath.Base(changedFile)),
	))

	startTime := time.Now()

	// Run go build.
	buildErr := gw.runGoBuild()
	duration := time.Since(startTime)

	if buildErr != nil {
		l.Warnw(context.Background(), "go build failed", "duration", duration, "error", buildErr)
		gw.appendLog(newLogEntry(
			logSourceGoBuild, logLevelError,
			fmt.Sprintf("Build failed in %s: %v", duration.Round(time.Millisecond), buildErr),
		))
		gw.setBuild(duration, buildErr.Error())
		gw.setStatus(DevProcessStatusError)
		return
	}

	l.Infow(context.Background(), "go build succeeded", "duration", duration)
	gw.appendLog(newLogEntry(
		logSourceGoBuild, logLevelInfo, fmt.Sprintf("Build succeeded in %s", duration.Round(time.Millisecond)),
	))

	// Sync plugin.yaml so capability changes (e.g. adding "metric") are
	// picked up on reload without requiring a full reinstall.
	if err := gw.syncPluginYaml(); err != nil {
		l.Warnw(context.Background(), "failed to sync plugin.yaml", "error", err)
	}

	// Transfer the binary to <pluginsRoot>/<pluginID>/bin/plugin.
	if err := gw.transferBinary(); err != nil {
		l.Errorw(context.Background(), "failed to transfer binary", "error", err)
		gw.appendLog(newLogEntry(logSourceGoBuild, logLevelError, fmt.Sprintf("Failed to transfer binary: %v", err)))
		gw.setBuild(duration, err.Error())
		gw.setStatus(DevProcessStatusError)
		return
	}

	gw.appendLog(newLogEntry(logSourceGoBuild, logLevelInfo, "Binary transferred, reloading plugin..."))

	// Trigger plugin reload via the plugin reloader.
	if err := gw.reloader.ReloadPlugin(gw.pluginID); err != nil {
		l.Errorw(context.Background(), "plugin reload failed", "error", err)
		gw.appendLog(newLogEntry(logSourceGoBuild, logLevelError, fmt.Sprintf("Plugin reload failed: %v", err)))
		gw.setBuild(duration, err.Error())
		gw.setStatus(DevProcessStatusError)
		return
	}

	gw.appendLog(newLogEntry(logSourceGoBuild, logLevelInfo, "Plugin reloaded successfully"))
	gw.setBuild(duration, "")
	gw.setStatus(DevProcessStatusReady)
}

// goBuildEnv drops GOROOT from the inherited environment. The app may have been
// launched by one Go toolchain while the configured go binary (often a version
// manager shim that picks a version per directory) is another; an inherited
// GOROOT then makes go fail with "does not match go tool version".
func goBuildEnv(env []string) []string {
	out := make([]string, 0, len(env))
	for _, kv := range env {
		if !strings.HasPrefix(kv, "GOROOT=") {
			out = append(out, kv)
		}
	}
	return out
}

// runGoBuild runs `go build -o build/bin/plugin ./pkg` in the plugin's dev directory.
// Returns nil on success, or an error containing the compiler output.
func (gw *goWatcherProcess) runGoBuild() error {
	goPath := gw.buildOpts.GoPath
	if goPath == "" {
		return apperror.ConfigMissing(
			"developer.gopath",
			"Go binary path is not configured. Please set developer.gopath in settings.",
		)
	}

	// Ensure the output directory exists.
	outDir := filepath.Join(gw.devPath, "build", "bin")
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return apperror.Internal(err, "Failed to create build output directory")
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer

	cmd := exec.CommandContext(gw.ctx, goPath, "build", "-o", "build/bin/plugin", "./pkg")
	cmd.Dir = gw.devPath
	cmd.Env = goBuildEnv(os.Environ())
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		// Parse build errors from stderr.
		errOutput := stderr.String()
		buildErrors := parseBuildErrors(errOutput, gw.devPath)
		if len(buildErrors) > 0 {
			gw.emitErrors(gw.pluginID, buildErrors)
		}

		// Log each line of the error output.
		for _, line := range strings.Split(errOutput, "\n") {
			if strings.TrimSpace(line) != "" {
				gw.appendLog(newLogEntry(logSourceGoBuild, logLevelError, line))
			}
		}

		return apperror.New(apperror.TypePluginBuildFailed, http.StatusInternalServerError, "Plugin build failed", errOutput)
	}

	return nil
}

// transferBinary copies the built binary from <devPath>/build/bin/plugin to
// <pluginsRoot>/<pluginID>/bin/plugin.
func (gw *goWatcherProcess) transferBinary() error {
	srcPath := filepath.Join(gw.devPath, "build", "bin", "plugin")
	binDir := filepath.Join(gw.pluginID, "bin")

	if err := gw.pluginsRoot.MkdirAll(binDir, dirPerm); err != nil {
		return apperror.Internal(err, "Failed to create plugin bin directory")
	}

	// Read source binary.
	srcFile, err := os.Open(srcPath)
	if err != nil {
		return apperror.Internal(err, "Failed to open built binary")
	}
	defer srcFile.Close()

	srcInfo, err := srcFile.Stat()
	if err != nil {
		return apperror.Internal(err, "Failed to stat built binary")
	}

	dstRelPath := filepath.Join(binDir, "plugin")

	// Remove existing binary first (in case it's being held open).
	_ = gw.pluginsRoot.Remove(dstRelPath)

	dstFile, err := gw.pluginsRoot.OpenFile(dstRelPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, srcInfo.Mode())
	if err != nil {
		return apperror.Internal(err, "Failed to create destination binary")
	}
	defer dstFile.Close()

	if _, err = io.Copy(dstFile, srcFile); err != nil {
		return apperror.Internal(err, "Failed to copy binary")
	}

	return nil
}

// syncPluginYaml copies plugin.yaml from the dev source directory to the
// installed plugin directory so that capability changes are picked up on
// the next reload without requiring a full reinstall.
func (gw *goWatcherProcess) syncPluginYaml() error {
	srcPath := filepath.Join(gw.devPath, "plugin.yaml")

	src, err := os.Open(srcPath)
	if err != nil {
		return apperror.Internal(err, "Failed to open plugin.yaml")
	}
	defer src.Close()

	pluginDir := gw.pluginID
	if err = gw.pluginsRoot.MkdirAll(pluginDir, dirPerm); err != nil {
		return apperror.Internal(err, "Failed to create plugin directory")
	}

	dstRelPath := filepath.Join(gw.pluginID, "plugin.yaml")
	dst, err := gw.pluginsRoot.OpenFile(dstRelPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, filePerm)
	if err != nil {
		return apperror.Internal(err, "Failed to create destination plugin.yaml")
	}
	defer dst.Close()

	if _, err = io.Copy(dst, src); err != nil {
		return apperror.Internal(err, "Failed to copy plugin.yaml")
	}
	return nil
}

// ============================================================================
// go.work parsing
// ============================================================================

// parseGoWorkUseDirectives extracts module paths from a go.work file's "use" directives.
// Handles both single-line ("use ./foo") and block ("use (\n  ./foo\n  ./bar\n)") forms.
func parseGoWorkUseDirectives(data []byte) []string {
	var paths []string
	lines := strings.Split(string(data), "\n")
	inBlock := false
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "use (") {
			inBlock = true
			continue
		}
		if inBlock {
			if line == ")" {
				inBlock = false
				continue
			}
			p := strings.TrimSpace(line)
			if p != "" && !strings.HasPrefix(p, "//") {
				paths = append(paths, p)
			}
		} else if strings.HasPrefix(line, "use ") {
			p := strings.TrimSpace(strings.TrimPrefix(line, "use"))
			if p != "" {
				paths = append(paths, p)
			}
		}
	}
	return paths
}

// ============================================================================
// Build error parsing
// ============================================================================

// goErrorRegex matches Go compiler error lines of the form:
//
//	./path/to/file.go:42:10: error message here
var goErrorRegex = regexp.MustCompile(`^(.+\.go):(\d+):(\d+):\s*(.+)$`)

// parseBuildErrors parses Go compiler error output into structured BuildError values.
func parseBuildErrors(output string, basePath string) []BuildError {
	var errors []BuildError
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		matches := goErrorRegex.FindStringSubmatch(line)
		if matches == nil {
			continue
		}

		file := matches[1]
		// Make the file path relative to the plugin's dev path for display.
		if strings.HasPrefix(file, "./") {
			file = filepath.Join(basePath, file[2:])
		}

		lineNum, _ := strconv.Atoi(matches[2])
		colNum, _ := strconv.Atoi(matches[3])
		msg := matches[4]

		errors = append(errors, BuildError{
			File:    file,
			Line:    lineNum,
			Column:  colNum,
			Message: msg,
		})
	}
	return errors
}
