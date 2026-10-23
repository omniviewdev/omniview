package devserver

import (
	"bytes"
	"context"
	"debug/buildinfo"
	"encoding/json"
	"errors"
	"fmt"
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
	"gopkg.in/yaml.v3"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devsource"
	"github.com/omniviewdev/omniview/internal/instance"
	logging "github.com/omniviewdev/plugin-sdk/log"
	sdkconfig "github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

const (
	// DedupInterval is the debounce window for file change events.
	DedupInterval = 500 * time.Millisecond

	// goWatcherStopTimeout bounds retirement of the event loop and all publishers.
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

	watcher           *fsnotify.Watcher
	done              chan struct{} // closed when the watcher goroutine exits
	buildMu           sync.Mutex
	lifecycleMu       sync.Mutex
	stopping          bool
	loopStarted       bool
	publishers        sync.WaitGroup
	stopOnce          sync.Once
	retired           chan struct{}
	stopErr           error
	dependencyMu      sync.Mutex
	dependencyDirs    []string
	selectedSDK       devsource.Identity
	buildRelativePath string
	runtimeError      func(error)
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

// Start initializes watching before the synchronous initial build. A lifecycle
// reloader may stop the watcher without waiting for Start to launch its loop.
func (gw *goWatcherProcess) Start() error {
	if err := gw.startWatching(); err != nil {
		return err
	}
	gw.initialBuild()
	return nil
}

func (gw *goWatcherProcess) startWatching() error {
	if err := gw.beginActivity(); err != nil {
		return err
	}
	defer gw.publishers.Done()
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return apperror.Internal(err, "Failed to create file watcher")
	}
	gw.lifecycleMu.Lock()
	if gw.stopping || gw.ctx.Err() != nil {
		gw.lifecycleMu.Unlock()
		watcher.Close()
		return context.Canceled
	}
	gw.watcher = watcher
	gw.lifecycleMu.Unlock()

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

	// Watch effective local module replacements with GOWORK explicitly disabled.
	gw.dependencyMu.Lock()
	if !gw.buildOpts.DisableDependencyWatching {
		gw.watchWorkspaceModules(watcher, &watchCount)
	}
	gw.dependencyMu.Unlock()

	gw.logger.Infow(context.Background(), "go file watcher started", "directories", watchCount)
	gw.appendLog(newLogEntry(
		logSourceGoWatch, logLevelInfo, fmt.Sprintf("Watching %d directories for Go changes", watchCount),
	))

	gw.lifecycleMu.Lock()
	defer gw.lifecycleMu.Unlock()
	if gw.stopping || gw.ctx.Err() != nil {
		watcher.Close()
		return context.Canceled
	}
	gw.loopStarted = true
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

// watchWorkspaceModules watches all effective replacement source directories,
// including SDK settings/log/proto outside pkg/.
func (gw *goWatcherProcess) watchWorkspaceModules(watcher *fsnotify.Watcher, watchCount *int) {
	goPath, err := resolveTool(gw.buildOpts.GoPath, "go")
	if err != nil {
		return
	}
	cmd := exec.CommandContext(gw.ctx, goPath, "list", "-m", "-json", "all")
	cmd.Dir, cmd.Env = gw.devPath, goBuildEnv(gw.buildOpts.Environment)
	data, err := cmd.Output()
	if err != nil {
		gw.appendLog(newLogEntry(logSourceGoWatch, logLevelError, fmt.Sprintf("Resolve dependency watches: %v", err)))
		return
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	for {
		var module struct {
			Path, Dir string
			Main      bool
			Replace   *struct{ Dir string }
		}
		if err = decoder.Decode(&module); err != nil {
			break
		}
		directory := ""
		if module.Replace != nil {
			directory = module.Replace.Dir
		}
		if directory == "" || module.Main {
			continue
		}
		directory, err = filepath.EvalSymlinks(directory)
		if err != nil || directory == gw.devPath {
			continue
		}
		_ = filepath.Walk(directory, func(path string, info os.FileInfo, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if !info.IsDir() {
				return nil
			}
			base := filepath.Base(path)
			if strings.HasPrefix(base, ".") || base == "vendor" || base == "node_modules" || base == "build" || base == "dist" {
				return filepath.SkipDir
			}
			if err := watcher.Add(path); err != nil {
				return err
			}
			gw.dependencyDirs = append(gw.dependencyDirs, path)
			*watchCount++
			return nil
		})
	}
}

// initialBuild builds, transfers and reloads the plugin once when the watcher
// starts. Failures are logged and reflected in the status; the watcher still
// starts so the user can fix the code and rebuild.
func (gw *goWatcherProcess) initialBuild() {
	_ = gw.buildAndReload(true, "")
}

// beginActivity serializes admission with Stop sealing the publisher set.
// No WaitGroup Add can race the retirement wait after that seal.
func (gw *goWatcherProcess) beginActivity() error {
	gw.lifecycleMu.Lock()
	defer gw.lifecycleMu.Unlock()
	if gw.stopping {
		return context.Canceled
	}
	if err := gw.ctx.Err(); err != nil {
		return err
	}
	gw.publishers.Add(1)
	return nil
}

// Stop seals build admission, cancels pending work, and confirms retirement.
// A timeout retains ownership in the caller instead of reporting a false stop.
func (gw *goWatcherProcess) Stop() error {
	gw.stopOnce.Do(func() {
		gw.lifecycleMu.Lock()
		gw.stopping = true
		gw.cancel()
		watcher := gw.watcher
		gw.retired = make(chan struct{})
		gw.lifecycleMu.Unlock()
		go func() {
			if watcher != nil {
				gw.stopErr = watcher.Close()
			}
			gw.publishers.Wait()
			gw.lifecycleMu.Lock()
			loopStarted := gw.loopStarted
			gw.lifecycleMu.Unlock()
			if loopStarted {
				<-gw.done
			}
			close(gw.retired)
		}()
	})
	select {
	case <-gw.retired:
		return gw.stopErr
	default:
	}
	timer := time.NewTimer(goWatcherStopTimeout)
	defer timer.Stop()
	select {
	case <-gw.retired:
		return gw.stopErr
	case <-timer.C:
		return fmt.Errorf("go watcher did not retire all publishers within %s", goWatcherStopTimeout)
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

// handleRebuild compiles and publishes a private profile artifact, then reloads.
func (gw *goWatcherProcess) handleRebuild(changedFile string) error {
	return gw.buildAndReload(false, changedFile)
}

func (gw *goWatcherProcess) buildAndReload(initial bool, changedFile string) error {
	// Serialize the complete build/reload/result operation before admission.
	// Queued requests must not join the publisher set while a reloader can Stop.
	gw.buildMu.Lock()
	defer gw.buildMu.Unlock()
	started := time.Now()
	if err := gw.buildPlugin(initial, changedFile, started); err != nil {
		return err
	}
	if err := gw.ctx.Err(); err != nil {
		return err
	}

	// The mutable producer, including staging cleanup, has retired. Reload may
	// synchronously Stop: retirement never waits for buildMu or queued requests.
	var err error
	if gw.reloader == nil {
		err = fmt.Errorf("plugin lifecycle reloader unavailable")
	} else if managed, ok := gw.reloader.(interface {
		ReloadManagedPlugin(context.Context, string, string, string) error
	}); ok && gw.buildOpts.Generation != "" {
		err = managed.ReloadManagedPlugin(gw.ctx, gw.pluginID, gw.devPath, gw.buildOpts.Generation)
	} else if gw.buildOpts.ExpectedSDKRevision != "" {
		err = fmt.Errorf("workspace reloader must enforce source/generation")
	} else {
		err = gw.reloader.ReloadPlugin(gw.pluginID)
	}
	var appErr *apperror.AppError
	if initial && errors.As(err, &appErr) && appErr.Type == apperror.TypePluginNotLoaded {
		// Build ready, runtime still pending until installer LoadPlugin succeeds.
		return nil
	}
	if err == nil {
		return nil
	}
	err = fmt.Errorf("plugin lifecycle reload: %w", err)
	// Reload failure is a separate, admitted notification, not an extension of
	// the retired publisher. Stop can seal it out before returning success.
	if gw.beginActivity() == nil {
		defer gw.publishers.Done()
		gw.setBuild(time.Since(started), err.Error())
		if gw.runtimeError != nil {
			gw.runtimeError(err)
		}
		gw.appendLog(newLogEntry(logSourceGoBuild, logLevelError, err.Error()))
	}
	return err
}

func (gw *goWatcherProcess) buildPlugin(initial bool, changedFile string, started time.Time) (result error) {
	if err := gw.beginActivity(); err != nil {
		return err
	}
	defer gw.publishers.Done()
	if err := gw.ctx.Err(); err != nil {
		return err
	}
	if initial {
		gw.appendLog(newLogEntry(logSourceGoBuild, logLevelInfo, "Running initial build..."))
	} else {
		gw.appendLog(newLogEntry(logSourceGoBuild, logLevelInfo, "Rebuilding after "+filepath.Base(changedFile)))
	}
	gw.setStatus(DevProcessStatusBuilding)
	defer func() {
		result = errors.Join(result, gw.cleanupBuildOutput())
		if result != nil {
			gw.setBuild(time.Since(started), result.Error())
			gw.setStatus(DevProcessStatusError)
			gw.appendLog(newLogEntry(logSourceGoBuild, logLevelError, result.Error()))
		}
	}()
	if err := gw.runGoBuild(); err != nil {
		return err
	}
	if err := gw.ctx.Err(); err != nil {
		return err
	}
	if err := gw.syncPluginYaml(); err != nil {
		return err
	}
	if err := gw.ctx.Err(); err != nil {
		return err
	}
	if err := gw.transferBinary(); err != nil {
		return err
	}
	if err := gw.ctx.Err(); err != nil {
		return err
	}
	if gw.selectedSDK.ReviewedRevision != "" {
		path := gw.pluginsRoot.ResolvePath(filepath.Join(gw.pluginID, "bin", "plugin"))
		if gw.buildOpts.Workspace == nil {
			return fmt.Errorf("resolved workspace required for build source attestation")
		}
		if err := instance.RecordBuiltArtifactSource(*gw.buildOpts.Workspace, gw.pluginID, path, gw.selectedSDK.ReviewedRevision, gw.selectedSDK.SourceDigest); err != nil {
			return err
		}
	}
	if err := gw.ctx.Err(); err != nil {
		return err
	}
	gw.setBuild(time.Since(started), "")
	gw.setStatus(DevProcessStatusReady)
	return nil
}

// goBuildEnv drops GOROOT from the inherited environment. The app may have been
// launched by one Go toolchain while the configured go binary (often a version
// manager shim that picks a version per directory) is another; an inherited
// GOROOT then makes go fail with "does not match go tool version".
func goBuildEnv(env []string) []string {
	if env == nil {
		env = os.Environ()
	}
	out := make([]string, 0, len(env)+1)
	for _, kv := range env {
		if strings.HasPrefix(kv, "OMNIVIEW_PROCESS_BRIDGE_") || strings.HasPrefix(kv, "OMNIVIEW_PROCESS_SUPERVISOR_") || strings.HasPrefix(kv, "OMNIVIEW_SUPERVISOR_") {
			continue
		}
		if !strings.HasPrefix(kv, "GOROOT=") && !strings.HasPrefix(kv, "GOWORK=") {
			out = append(out, kv)
		}
	}
	return append(out, "GOWORK=off")
}

func (gw *goWatcherProcess) cleanupBuildOutput() error {
	if gw.buildRelativePath == "" {
		return nil
	}
	if err := gw.pluginsRoot.RemoveAll(filepath.Dir(gw.buildRelativePath)); err != nil {
		return err
	}
	gw.buildRelativePath = ""
	return nil
}

// runGoBuild compiles into an exclusively created profile-local staging directory.
// Returns nil on success, or an error containing the compiler output.
func (gw *goWatcherProcess) runGoBuild() error {
	goPath, err := resolveTool(gw.buildOpts.GoPath, "go")
	if err != nil {
		return err
	}
	workspace := false
	for _, entry := range gw.buildOpts.Environment {
		if strings.HasPrefix(entry, "OMNIVIEW_WORKSPACE_ID=") && entry != "OMNIVIEW_WORKSPACE_ID=" {
			workspace = true
		}
	}
	if workspace || gw.buildOpts.ExpectedSDKRevision != "" {
		gw.selectedSDK, err = VerifySelectedSDK(gw.ctx, goPath, gw.devPath, gw.buildOpts.ExpectedSDKRevision, gw.buildOpts.Environment)
		if err != nil {
			return err
		}
	}

	if err := gw.cleanupBuildOutput(); err != nil {
		return err
	}
	if err := gw.pluginsRoot.MkdirAll(gw.pluginID, 0700); err != nil {
		return apperror.Internal(err, "Failed to create plugin build root")
	}
	stage, err := os.MkdirTemp(gw.pluginsRoot.ResolvePath(gw.pluginID), ".dev-build-")
	if err != nil {
		return apperror.Internal(err, "Failed to create private build output")
	}
	gw.buildRelativePath = filepath.Join(gw.pluginID, filepath.Base(stage), "plugin")
	binaryPath := filepath.Join(stage, "plugin")

	var stdout bytes.Buffer
	var stderr bytes.Buffer

	cmd := exec.CommandContext(gw.ctx, goPath, "build", "-o", binaryPath, "./pkg")
	cmd.Dir = gw.devPath
	cmd.Env = goBuildEnv(gw.buildOpts.Environment)
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
	if gw.selectedSDK.ReviewedRevision != "" {
		after, err := VerifySelectedSDK(gw.ctx, goPath, gw.devPath, gw.buildOpts.ExpectedSDKRevision, gw.buildOpts.Environment)
		if err != nil {
			return err
		}
		if after != gw.selectedSDK {
			return fmt.Errorf("selected SDK source changed during build")
		}
	}
	if gw.selectedSDK.ReviewedRevision != "" {
		info, err := buildinfo.ReadFile(binaryPath)
		if err != nil {
			return fmt.Errorf("read built SDK provenance: %w", err)
		}
		found := false
		for _, dependency := range info.Deps {
			if dependency.Path == sdkModulePath {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("built binary does not contain selected SDK module")
		}
	}

	return nil
}

// transferBinary atomically publishes the private staged executable inside the
// same profile filesystem, without copying or mutating source-owned artifacts.
func (gw *goWatcherProcess) transferBinary() error {
	if err := gw.ctx.Err(); err != nil {
		return err
	}
	if gw.buildRelativePath == "" {
		return fmt.Errorf("plugin build has no private artifact to publish")
	}
	binDir := filepath.Join(gw.pluginID, "bin")

	if err := gw.pluginsRoot.MkdirAll(binDir, dirPerm); err != nil {
		return apperror.Internal(err, "Failed to create plugin bin directory")
	}

	if err := gw.ctx.Err(); err != nil {
		return err
	}
	dstRelPath := filepath.Join(binDir, "plugin")
	if err := gw.pluginsRoot.Rename(gw.buildRelativePath, dstRelPath); err != nil {
		return apperror.Internal(err, "Failed to publish built binary")
	}
	return gw.cleanupBuildOutput()
}

// syncPluginYaml synchronizes capabilities but never copies self-attested source
// provenance. Only the binary produced from this build's verified SDK snapshot
// may stamp installed metadata; launch still requires the independent host record.
func (gw *goWatcherProcess) syncPluginYaml() error {
	metadata, err := sdktypes.LoadPluginMetadata(gw.devPath)
	if err != nil {
		return err
	}
	if gw.ctx != nil {
		if err := gw.ctx.Err(); err != nil {
			return err
		}
	}
	if metadata.ID != gw.pluginID {
		return fmt.Errorf("source metadata plugin ID changed from %q to %q", gw.pluginID, metadata.ID)
	}
	metadata.StateIsolation = nil
	if gw.selectedSDK.ReviewedRevision != "" {
		binary := gw.pluginsRoot.ResolvePath(gw.buildRelativePath)
		metadata.StateIsolation, err = sdkconfig.BuildStateIsolationProvenance(binary, gw.selectedSDK.ReviewedRevision, gw.selectedSDK.SourceDigest)
		if err != nil {
			return err
		}
	}
	encoded, err := yaml.Marshal(metadata)
	if err != nil {
		return err
	}
	if gw.ctx != nil {
		if err := gw.ctx.Err(); err != nil {
			return err
		}
	}
	if err = gw.pluginsRoot.MkdirAll(gw.pluginID, dirPerm); err != nil {
		return err
	}
	temporary := filepath.Join(gw.pluginID, "plugin.yaml.tmp")
	if err = gw.pluginsRoot.WriteFile(temporary, encoded, filePerm); err != nil {
		return err
	}
	if gw.ctx != nil {
		if err := gw.ctx.Err(); err != nil {
			_ = gw.pluginsRoot.Remove(temporary)
			return err
		}
	}
	if err = gw.pluginsRoot.Rename(temporary, filepath.Join(gw.pluginID, "plugin.yaml")); err != nil {
		_ = gw.pluginsRoot.Remove(temporary)
		return err
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

func (gw *goWatcherProcess) WatchedDirectories() []string {
	gw.dependencyMu.Lock()
	defer gw.dependencyMu.Unlock()
	if gw.watcher == nil {
		return nil
	}
	return append([]string(nil), gw.watcher.WatchList()...)
}

func (gw *goWatcherProcess) SetDependencyWatching(enabled bool) error {
	gw.dependencyMu.Lock()
	defer gw.dependencyMu.Unlock()
	if gw.ctx != nil {
		if err := gw.ctx.Err(); err != nil {
			return err
		}
	}
	if gw.watcher == nil {
		return fmt.Errorf("managed source watcher not started")
	}
	if enabled {
		if len(gw.dependencyDirs) > 0 {
			return nil
		}
		count := 0
		gw.watchWorkspaceModules(gw.watcher, &count)
		return nil
	}
	for _, path := range gw.dependencyDirs {
		if err := gw.watcher.Remove(path); err != nil && !errors.Is(err, fsnotify.ErrNonExistentWatch) {
			return err
		}
	}
	gw.dependencyDirs = nil
	return nil
}
