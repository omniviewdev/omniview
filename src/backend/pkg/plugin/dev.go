package plugin

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/exp/slices"
)

const (
	PluginDevInstallEventStart = "plugin/dev_install_start"
	PluginReloadEventStart     = "plugin/dev_reload_start"
	PluginReloadEventError     = "plugin/dev_reload_error"
	PluginReloadEventComplete  = "plugin/dev_reload_complete"
)

const (
	DedupInterval = 500 * time.Millisecond
)

func eventShouldFire(event fsnotify.Event) bool {
	// only care about create and write events
	if !event.Has(fsnotify.Create) && !event.Has(fsnotify.Write) {
		return false
	}

	// make sure its one of our file types we actually want to watch
	extensions := []string{".go", ".html", ".css", ".js", ".ts", ".tsx"}
	ext := filepath.Ext(event.Name)
	return slices.Contains(extensions, ext)
}

func (pm *pluginManager) runWatcher() {
	var (
		// Keep track of the timers, as path → timer.
		mu     sync.Mutex
		timers = make(map[string]*time.Timer)

		// Callback we run.
		handleEvent = func(e fsnotify.Event) {
			// handle and clear the timer
			if err := pm.handleWatchEvent(e); err != nil {
				pm.logger.Errorf("error handling reload event:", err)
			}

			mu.Lock()
			delete(timers, e.Name)
			mu.Unlock()
		}
	)

	for {
		select {
		case <-pm.ctx.Done():
			// shutting down
			pm.logger.Debug("shutting down plugin manager")
			return
		// Read from Errors.
		case err, ok := <-pm.watcher.Errors:
			if !ok {
				// channel closed
				return
			}
			pm.logger.Errorf("error watching files: %s", err)
		// Read from Events.
		case e, ok := <-pm.watcher.Events:
			if !ok {
				// channel closed
				return
			}
			pm.logger.Debugw("watch event", "event", e)

			if !eventShouldFire(e) {
				continue
			}

			// Get timer.
			mu.Lock()
			t, ok := timers[e.Name]
			mu.Unlock()

			// No timer yet, so create one.
			if !ok {
				t = time.AfterFunc(math.MaxInt64, func() { handleEvent(e) })
				t.Stop()

				mu.Lock()
				timers[e.Name] = t
				mu.Unlock()
			}

			// Reset the timer for this path, so it will start from 100ms again.
			t.Reset(DedupInterval)
		}
	}
}

func (pm *pluginManager) findParentTarget(target string) string {
	for dir := range pm.watchTargets {
		if strings.HasPrefix(target, dir) {
			return dir
		}
	}

	pm.logger.Errorw(
		"failed to find parent target for path",
		"target",
		target,
		"watched",
		pm.watchTargets,
	)

	return ""
}

// AddTarget adds a new target to the watcher.
func (pm *pluginManager) AddTarget(dir string) {
	pm.logger.Debugf("Adding target to watcher: %s", dir)

	if _, ok := pm.watchTargets[dir]; ok {
		// already added
		return
	}

	// target only the directories we know contain code to reload on
	watchdirs := []string{
		"pkg",
		"ui",
	}

	ignoreDirs := []string{
		filepath.Join("ui", "node_modules"),
		filepath.Join("ui", "dist"),
	}

	shouldIgnore := func(path string) bool {
		for _, ignore := range ignoreDirs {
			if strings.Contains(path, ignore) {
				return true
			}
		}
		return false
	}

	paths := []string{}

	for _, watchdir := range watchdirs {
		fullPath := filepath.Join(dir, watchdir)

		if err := filepath.Walk(fullPath, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if info.IsDir() && shouldIgnore(path) {
				return filepath.SkipDir
			}
			if info.IsDir() {
				pm.logger.Debugf("Watching directory: %s", path)
				paths = append(paths, path)
			}
			return nil
		}); err != nil {
			pm.logger.Errorf("failed to walk directory in dev watcher: %w", err)
		}
	}

	for _, path := range paths {
		if err := pm.watcher.Add(path); err != nil {
			pm.logger.Errorf("failed to add path to watcher: %w", err)
		}
		pm.logger.Debugf("Watching directory: %s", path)
	}

	pm.watchTargets[dir] = paths
}

// RemoveTarget removes the target directory from being watched for changes.
func (pm *pluginManager) RemoveTarget(dir string) {
	l := pm.logger.With("name", "RemoveTarget", "dir", dir)

	found, ok := pm.watchTargets[dir]
	if !ok {
		return // already removed
	}

	for _, path := range found {
		if err := pm.watcher.Remove(path); err != nil {
			l.Errorf("failed to remove path from watcher: %w", err)
		}
	}

	delete(pm.watchTargets, dir)
}

func (pm *pluginManager) installAndWatchDevPlugin(dir string) (*config.PluginMeta, error) {
	meta, err := parseMetadataFromPluginPath(dir)
	if err != nil {
		return nil, fmt.Errorf("failed to parse metadata from plugin path: %w", err)
	}

	// signal to UI the install has started
	runtime.EventsEmit(pm.ctx, PluginDevInstallEventStart, meta)

	// start the package
	result, err := buildAndTransferPlugin(dir)
	if err != nil {
		return nil, fmt.Errorf("failed to build and package plugin: %w", err)
	}

	return result, nil
}

func (pm *pluginManager) handleWatchEvent(event fsnotify.Event) error {
	l := pm.logger.With("name", "handleWatchEvent", "event", event)
	l.Debugw("handling watch event", "event", event)

	// find the target
	target := pm.findParentTarget(event.Name)
	if target == "" {
		return nil
	}

	meta, err := parseMetadataFromPluginPath(target)
	if err != nil {
		return fmt.Errorf("failed to parse metadata from plugin path: %w", err)
	}

	// load the meta and signal to ui
	runtime.EventsEmit(pm.ctx, PluginReloadEventStart, meta)

	// start the package
	meta, err = buildAndTransferPlugin(target)
	if err != nil {
		runtime.EventsEmit(pm.ctx, PluginReloadEventError, meta, err.Error())
		return fmt.Errorf("failed to build and package plugin: %w", err)
	}

	result, err := pm.ReloadPlugin(meta.ID)
	if err != nil {
		runtime.EventsEmit(pm.ctx, PluginReloadEventError, meta, err.Error())
		return fmt.Errorf("failed to reload plugin: %w", err)
	}

	runtime.EventsEmit(pm.ctx, PluginReloadEventComplete, result.Metadata)
	return nil
}

func buildPluginBinaries(path string) error {
	buildOutputPath := filepath.Join(path, "build", "bin")

	// remove any existing dirs
	if err := os.RemoveAll(buildOutputPath); err != nil {
		return fmt.Errorf("failed to remove 'bin' directory: %w", err)
	}

	// recreate the dirs
	if err := os.MkdirAll(buildOutputPath, 0755); err != nil {
		return fmt.Errorf("failed to create 'bin' directory: %w", err)
	}

	// Build the binary
	cmd := exec.Command("go", "build", "-o", "build/bin/plugin", "./pkg")
	cmd.Dir = path

	out, err := cmd.Output()
	if err != nil {
		// get the ExitError
		if exitError, ok := err.(*exec.ExitError); ok {
			return fmt.Errorf("failed to build plugin: %s", string(exitError.Stderr))
		}
		return fmt.Errorf("failed to build plugin: %s", string(out))
	}

	// if there's a ui directory, build it
	if _, err := os.Stat(filepath.Join(path, "ui", "package.json")); err == nil {
		cmd = exec.Command("pnpm", "run", "build")
		cmd.Dir = filepath.Join(path, "ui")

		out, err = cmd.Output()
		if err != nil {
			// get the ExitError
			if exitError, ok := err.(*exec.ExitError); ok {
				return fmt.Errorf("failed to build plugin: %s", string(exitError.Stderr))
			}
			return fmt.Errorf("failed to build plugin: %s", string(out))
		}
	}

	return nil
}

func transferPluginBuild(path string) (*config.PluginMeta, error) {
	meta, err := parseMetadataFromPluginPath(path)
	if err != nil {
		return nil, fmt.Errorf("failed to parse metadata from plugin path: %w", err)
	}

	installLocation := getPluginLocation(meta.ID)

	// 1.Plugin Binary (move)
	binaryPath := filepath.Join(path, "build", "bin", "plugin")
	targetBinPath := filepath.Join(installLocation, "bin", "plugin")

	if err = os.MkdirAll(filepath.Dir(targetBinPath), 0755); err != nil {
		return nil, fmt.Errorf("failed to create plugin binary directory: %w", err)
	}
	if err = os.Rename(binaryPath, targetBinPath); err != nil {
		return nil, fmt.Errorf("failed to move binary to plugin location: %w", err)
	}

	// 2. Plugin Metadata (copy)
	metaPath := filepath.Join(path, "plugin.yaml")
	targetMetaPath := filepath.Join(installLocation, "plugin.yaml")

	sourceMetaFile, err := os.Open(metaPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open metadata file: %w", err)
	}
	defer sourceMetaFile.Close()

	destMetaFile, err := os.Create(targetMetaPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create metadata file: %w", err)
	}
	defer destMetaFile.Close()

	if _, err = io.Copy(destMetaFile, sourceMetaFile); err != nil {
		return nil, fmt.Errorf("failed to copy metadata to plugin location: %w", err)
	}

	// 3. UI (recursive copy)
	uiPath := filepath.Join(path, "ui", "dist", "assets")
	targetUIPath := filepath.Join(installLocation, "assets")

	if err = os.RemoveAll(targetUIPath); err != nil {
		return nil, fmt.Errorf("failed to remove existing UI directory: %w", err)
	}
	if err = os.MkdirAll(targetUIPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create UI directory: %w", err)
	}

	if _, err = os.Stat(uiPath); err == nil {
		if err = CopyDirectory(uiPath, targetUIPath); err != nil {
			return nil, fmt.Errorf("failed to copy UI to plugin location: %w", err)
		}
	}

	return meta, nil
}

func buildAndTransferPlugin(path string) (*config.PluginMeta, error) {
	if err := buildPluginBinaries(path); err != nil {
		return nil, fmt.Errorf("failed to build plugin binaries: %w", err)
	}
	meta, err := transferPluginBuild(path)
	if err != nil {
		return nil, fmt.Errorf("failed to transfer plugin build: %w", err)
	}
	return meta, nil
}

func buildAndPackage(basePath string) (string, error) {
	buildOutputPath := filepath.Join(basePath, "build")

	// build output paths
	binPath := filepath.Join(buildOutputPath, "bin")
	devTarGz := filepath.Join(buildOutputPath, "_dev.tar.gz")

	// build asset paths
	pluginPath := filepath.Join(binPath, "plugin")
	metaPath := filepath.Join(basePath, "plugin.yaml")

	// remove any existing dirs
	if err := os.RemoveAll(binPath); err != nil {
		return "", fmt.Errorf("failed to remove 'bin' directory: %w", err)
	}
	if err := os.Remove(devTarGz); err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("failed to remove existing dev package: %w", err)
	}

	// recreate the dirs
	if err := os.MkdirAll(buildOutputPath, 0755); err != nil {
		return "", fmt.Errorf("failed to create build output directory: %w", err)
	}
	if err := os.MkdirAll(binPath, 0755); err != nil {
		return "", fmt.Errorf("failed to create 'bin' directory: %w", err)
	}

	log.Printf(
		"Building plugin from %s. Output: %s Package: %s",
		basePath,
		pluginPath,
		filepath.Join(basePath, "pkg"),
	)

	// Build the binary
	cmd := exec.Command("go", "build", "-o", "build/bin/plugin", "./pkg")
	cmd.Dir = basePath

	out, err := cmd.Output()
	if err != nil {
		// get the ExitError
		if exitError, ok := err.(*exec.ExitError); ok {
			log.Printf("Build output: %s", string(exitError.Stderr))
			return "", fmt.Errorf("failed to build plugin: %w", err)
		}
		return "", fmt.Errorf("failed to build plugin: %w", err)
	}
	log.Printf("Build output: %s", out)

	// Create the tar.gz archive using Go's standard library
	file, err := os.Create(devTarGz)
	if err != nil {
		return "", fmt.Errorf("failed to create tar.gz file: %w", err)
	}
	defer file.Close()

	gw := gzip.NewWriter(file)
	defer gw.Close()

	tw := tar.NewWriter(gw)
	defer tw.Close()

	// Add metadata file to the archive
	if err = addFileToTar(tw, metaPath, ""); err != nil {
		return "", fmt.Errorf("failed to add plugin.yaml to tar: %w", err)
	}

	// Add plugin binary to the archive
	if err = addFileToTar(tw, pluginPath, "bin"); err != nil {
		return "", fmt.Errorf("failed to add plugin to tar: %w", err)
	}

	return devTarGz, nil
}

func addFileToTar(tw *tar.Writer, filePath string, tarDir string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		return fmt.Errorf("failed to get file info: %w", err)
	}

	location := filepath.Base(filePath)
	if tarDir != "" {
		location = filepath.Join(tarDir, location)
	}

	header := &tar.Header{
		Name:    location,
		Size:    stat.Size(),
		Mode:    int64(stat.Mode()),
		ModTime: stat.ModTime(),
	}

	if err = tw.WriteHeader(header); err != nil {
		return fmt.Errorf("failed to write header to tar: %w", err)
	}

	if _, err = io.Copy(tw, file); err != nil {
		return fmt.Errorf("failed to copy file to tar: %w", err)
	}

	return nil
}
