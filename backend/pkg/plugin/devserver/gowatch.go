package devserver

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"math"
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
	"go.uber.org/zap"
)

const (
	// DedupInterval is the debounce window for file change events.
	DedupInterval = 500 * time.Millisecond
)

// goWatcherProcess watches Go source files for changes and rebuilds the plugin binary.
type goWatcherProcess struct {
	ctx    context.Context
	cancel context.CancelFunc
	logger *zap.SugaredLogger

	pluginID  string
	devPath   string
	buildOpts BuildOpts
	reloader  PluginReloader

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
	logger *zap.SugaredLogger,
	pluginID string,
	devPath string,
	buildOpts BuildOpts,
	reloader PluginReloader,
	appendLog func(LogEntry),
	setStatus func(DevProcessStatus),
	setBuild func(duration time.Duration, buildErr string),
	emitErrors func(pluginID string, errors []BuildError),
) *goWatcherProcess {
	ctx, cancel := context.WithCancel(parentCtx)
	return &goWatcherProcess{
		ctx:        ctx,
		cancel:     cancel,
		logger:     logger.Named("gowatch"),
		pluginID:   pluginID,
		devPath:    devPath,
		buildOpts:  buildOpts,
		reloader:   reloader,
		appendLog:  appendLog,
		setStatus:  setStatus,
		setBuild:   setBuild,
		emitErrors: emitErrors,
		done:       make(chan struct{}),
	}
}

// Start initializes the fsnotify watcher, walks the `pkg/` directory to register
// all subdirectories, and starts the event loop goroutine.
func (gw *goWatcherProcess) Start() error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("failed to create fsnotify watcher: %w", err)
	}
	gw.watcher = watcher

	// Walk the pkg/ directory and add all subdirectories.
	pkgDir := filepath.Join(gw.devPath, "pkg")
	if _, err := os.Stat(pkgDir); os.IsNotExist(err) {
		watcher.Close()
		return fmt.Errorf("plugin pkg/ directory does not exist: %s", pkgDir)
	}

	watchCount := 0
	err = filepath.Walk(pkgDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			// Skip hidden directories and vendor.
			base := filepath.Base(path)
			if strings.HasPrefix(base, ".") || base == "vendor" || base == "node_modules" {
				return filepath.SkipDir
			}
			if addErr := watcher.Add(path); addErr != nil {
				gw.logger.Warnw("failed to watch directory", "path", path, "error", addErr)
			} else {
				watchCount++
			}
		}
		return nil
	})
	if err != nil {
		watcher.Close()
		return fmt.Errorf("failed to walk pkg/ directory: %w", err)
	}

	gw.logger.Infow("go file watcher started", "directories", watchCount)
	gw.appendLog(LogEntry{
		Source:  "go-watch",
		Level:   "info",
		Message: fmt.Sprintf("Watching %d directories under pkg/", watchCount),
	})

	// Perform initial build so the binary exists for LoadPlugin validation.
	gw.setStatus(DevProcessStatusBuilding)
	gw.appendLog(LogEntry{
		Source:  "go-build",
		Level:   "info",
		Message: "Running initial build...",
	})

	startTime := time.Now()
	if err := gw.runGoBuild(); err != nil {
		gw.logger.Warnw("initial go build failed", "error", err)
		gw.appendLog(LogEntry{
			Source:  "go-build",
			Level:   "error",
			Message: fmt.Sprintf("Initial build failed: %v", err),
		})
		gw.setBuild(time.Since(startTime), err.Error())
		gw.setStatus(DevProcessStatusError)
		// Don't return error — still start watcher so user can fix and rebuild.
	} else {
		duration := time.Since(startTime)
		if err := gw.transferBinary(); err != nil {
			gw.logger.Errorw("initial binary transfer failed", "error", err)
			gw.appendLog(LogEntry{
				Source:  "go-build",
				Level:   "error",
				Message: fmt.Sprintf("Binary transfer failed: %v", err),
			})
			gw.setBuild(duration, err.Error())
			gw.setStatus(DevProcessStatusError)
		} else {
			gw.logger.Infow("initial build succeeded", "duration", duration)
			gw.appendLog(LogEntry{
				Source:  "go-build",
				Level:   "info",
				Message: fmt.Sprintf("Initial build succeeded in %s", duration.Round(time.Millisecond)),
			})
			gw.setBuild(duration, "")
			gw.setStatus(DevProcessStatusReady)
		}
	}

	// Start the event loop.
	go gw.eventLoop()

	return nil
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
	case <-time.After(5 * time.Second):
		gw.logger.Warn("go watcher event loop did not exit in time")
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
			gw.logger.Errorw("fsnotify error", "error", err)
			gw.appendLog(LogEntry{
				Source:  "go-watch",
				Level:   "error",
				Message: fmt.Sprintf("Watcher error: %v", err),
			})

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

			gw.logger.Debugw("go file changed", "file", event.Name, "op", event.Op)

			// Debounce: reset the timer for this file path.
			mu.Lock()
			t, exists := timers[event.Name]
			if !exists {
				t = time.AfterFunc(math.MaxInt64, func() {
					gw.handleRebuild(event.Name)
					mu.Lock()
					delete(timers, event.Name)
					mu.Unlock()
				})
				t.Stop()
				timers[event.Name] = t
			}
			t.Reset(DedupInterval)
			mu.Unlock()
		}
	}
}

// handleRebuild performs a go build, copies the binary if successful, and triggers plugin reload.
func (gw *goWatcherProcess) handleRebuild(changedFile string) {
	l := gw.logger.With("changedFile", changedFile)
	l.Info("rebuilding plugin binary")

	gw.setStatus(DevProcessStatusBuilding)
	gw.appendLog(LogEntry{
		Source:  "go-build",
		Level:   "info",
		Message: fmt.Sprintf("Building plugin (triggered by %s)", filepath.Base(changedFile)),
	})

	startTime := time.Now()

	// Run go build.
	buildErr := gw.runGoBuild()
	duration := time.Since(startTime)

	if buildErr != nil {
		l.Warnw("go build failed", "duration", duration, "error", buildErr)
		gw.appendLog(LogEntry{
			Source:  "go-build",
			Level:   "error",
			Message: fmt.Sprintf("Build failed in %s: %v", duration.Round(time.Millisecond), buildErr),
		})
		gw.setBuild(duration, buildErr.Error())
		gw.setStatus(DevProcessStatusError)
		return
	}

	l.Infow("go build succeeded", "duration", duration)
	gw.appendLog(LogEntry{
		Source:  "go-build",
		Level:   "info",
		Message: fmt.Sprintf("Build succeeded in %s", duration.Round(time.Millisecond)),
	})

	// Sync plugin.yaml so capability changes (e.g. adding "metric") are
	// picked up on reload without requiring a full reinstall.
	if err := gw.syncPluginYaml(); err != nil {
		l.Warnw("failed to sync plugin.yaml", "error", err)
	}

	// Transfer the binary to ~/.omniview/plugins/<id>/bin/plugin.
	if err := gw.transferBinary(); err != nil {
		l.Errorw("failed to transfer binary", "error", err)
		gw.appendLog(LogEntry{
			Source:  "go-build",
			Level:   "error",
			Message: fmt.Sprintf("Failed to transfer binary: %v", err),
		})
		gw.setBuild(duration, err.Error())
		gw.setStatus(DevProcessStatusError)
		return
	}

	gw.appendLog(LogEntry{
		Source:  "go-build",
		Level:   "info",
		Message: "Binary transferred, reloading plugin...",
	})

	// Trigger plugin reload via the plugin reloader.
	if err := gw.reloader.ReloadPlugin(gw.pluginID); err != nil {
		l.Errorw("plugin reload failed", "error", err)
		gw.appendLog(LogEntry{
			Source:  "go-build",
			Level:   "error",
			Message: fmt.Sprintf("Plugin reload failed: %v", err),
		})
		gw.setBuild(duration, err.Error())
		gw.setStatus(DevProcessStatusError)
		return
	}

	gw.appendLog(LogEntry{
		Source:  "go-build",
		Level:   "info",
		Message: "Plugin reloaded successfully",
	})
	gw.setBuild(duration, "")
	gw.setStatus(DevProcessStatusReady)
}

// runGoBuild runs `go build -o build/bin/plugin ./pkg` in the plugin's dev directory.
// Returns nil on success, or an error containing the compiler output.
func (gw *goWatcherProcess) runGoBuild() error {
	goPath := gw.buildOpts.GoPath
	if goPath == "" {
		return fmt.Errorf("go binary path not configured; set developer.gopath in settings")
	}

	// Ensure the output directory exists.
	outDir := filepath.Join(gw.devPath, "build", "bin")
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return fmt.Errorf("failed to create build output directory: %w", err)
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer

	cmd := exec.CommandContext(gw.ctx, goPath, "build", "-o", "build/bin/plugin", "./pkg")
	cmd.Dir = gw.devPath
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
				gw.appendLog(LogEntry{
					Source:  "go-build",
					Level:   "error",
					Message: line,
				})
			}
		}

		return fmt.Errorf("build failed: %s", errOutput)
	}

	return nil
}

// transferBinary copies the built binary from <devPath>/build/bin/plugin to
// ~/.omniview/plugins/<pluginID>/bin/plugin.
func (gw *goWatcherProcess) transferBinary() error {
	srcPath := filepath.Join(gw.devPath, "build", "bin", "plugin")
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}
	dstDir := filepath.Join(homeDir, ".omniview", "plugins", gw.pluginID, "bin")
	dstPath := filepath.Join(dstDir, "plugin")

	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return fmt.Errorf("failed to create plugin bin directory: %w", err)
	}

	// Read source binary.
	srcFile, err := os.Open(srcPath)
	if err != nil {
		return fmt.Errorf("failed to open built binary: %w", err)
	}
	defer srcFile.Close()

	srcInfo, err := srcFile.Stat()
	if err != nil {
		return fmt.Errorf("failed to stat built binary: %w", err)
	}

	// Remove existing binary first (in case it's being held open).
	_ = os.Remove(dstPath)

	dstFile, err := os.OpenFile(dstPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, srcInfo.Mode())
	if err != nil {
		return fmt.Errorf("failed to create destination binary: %w", err)
	}
	defer dstFile.Close()

	if _, err := io.Copy(dstFile, srcFile); err != nil {
		return fmt.Errorf("failed to copy binary: %w", err)
	}

	return nil
}

// syncPluginYaml copies plugin.yaml from the dev source directory to the
// installed plugin directory so that capability changes are picked up on
// the next reload without requiring a full reinstall.
func (gw *goWatcherProcess) syncPluginYaml() error {
	srcPath := filepath.Join(gw.devPath, "plugin.yaml")
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %w", err)
	}
	dstPath := filepath.Join(homeDir, ".omniview", "plugins", gw.pluginID, "plugin.yaml")

	src, err := os.Open(srcPath)
	if err != nil {
		return fmt.Errorf("failed to open source plugin.yaml: %w", err)
	}
	defer src.Close()

	dst, err := os.Create(dstPath)
	if err != nil {
		return fmt.Errorf("failed to create destination plugin.yaml: %w", err)
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src); err != nil {
		return fmt.Errorf("failed to copy plugin.yaml: %w", err)
	}
	return nil
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
