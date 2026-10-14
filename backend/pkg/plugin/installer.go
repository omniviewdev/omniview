package plugin

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"

	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sync/errgroup"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// InstallInDevMode installs a plugin from a directory selected via dialog.
func (pm *pluginManager) InstallInDevMode() (metadata *config.PluginMeta, err error) {
	l := pm.logger.Named("InstallInDevMode")
	l.Infow(pm.ctx, "InstallInDevMode called")
	defer func() {
		if r := recover(); r != nil {
			l.Errorw(pm.ctx, "panic in InstallInDevMode",
				"panic", r,
				"stack", string(debug.Stack()),
			)
			if metadata != nil {
				pm.emitter.Emit(EventDevInstallError, metadata)
			}
			metadata = nil
			err = apperror.Internal(fmt.Errorf("panic: %v", r), "Install in dev mode failed")
		}
	}()

	path, err := application.Get().Dialog.OpenFile().
		CanChooseDirectories(true).
		CanChooseFiles(false).
		PromptForSingleSelection()
	if err != nil {
		l.Errorw(pm.ctx, err.Error())
		return nil, err
	}
	if path == "" {
		return nil, apperror.Cancelled()
	}

	l.Infow(pm.ctx, "installing plugin in dev mode", "path", path)

	metadata, err = parseMetadataFromPluginPath(path)
	if err != nil {
		return nil, apperror.Wrap(
			err, apperror.TypePluginInstallFailed, http.StatusInternalServerError, "Failed to parse plugin metadata",
		)
	}
	l.Infow(pm.ctx, "parsed plugin metadata", "pluginID", metadata.ID)

	pm.emitter.Emit(EventDevInstallStart, metadata)

	// Unload existing instance if it exists.
	pm.unloadForReinstall(l, metadata.ID)

	// Copy plugin.yaml and create the bin directory in ~/.omniview/plugins/<pluginID>/.
	if err = pm.prepareDevInstallDir(path, metadata); err != nil {
		pm.emitter.Emit(EventDevInstallError, metadata)
		return nil, err
	}

	// Start the dev server (Vite + GoWatcher with initial build).
	if pm.devServerMgr == nil {
		pm.emitter.Emit(EventDevInstallError, metadata)
		return nil, apperror.New(
			apperror.TypeSettingsMissingConfig,
			http.StatusUnprocessableEntity,
			"No dev server manager configured",
			"The dev server manager is not available. Ensure developer settings are configured.",
		).WithActions(apperror.OpenSettingsAction("developer"))
	}

	l.Infow(pm.ctx, "starting dev server (triggers initial build)", "pluginID", metadata.ID)
	state, startErr := pm.devServerMgr.StartDevServerForPath(metadata.ID, path)
	if startErr != nil {
		pm.emitter.Emit(EventDevInstallError, metadata)
		return nil, apperror.Wrap(
			startErr, apperror.TypePluginBuildFailed, http.StatusInternalServerError, "Dev server failed to start",
		).WithActions(apperror.OpenSettingsAction("developer"))
	}
	l.Infow(pm.ctx, "dev server started successfully", "pluginID", metadata.ID)

	// If the initial build failed, register the plugin as pending rebuild
	// and return. The GoWatcher is still running — it will call ReloadPlugin
	// when the user fixes the code and the build succeeds.
	if state.GoStatus == devserver.DevProcessStatusError {
		pm.registerBuildFailedDevPlugin(l, metadata, path, state.LastError)
		return metadata, nil
	}

	// Load the plugin — binary should now exist from GoWatcher initial build.
	l.Infow(pm.ctx, "loading plugin (starting binary + gRPC connect)", "pluginID", metadata.ID)
	_, err = pm.LoadPlugin(metadata.ID, &LoadPluginOptions{DevMode: true, DevModePath: path, ExistingState: nil})
	if err != nil {
		pm.emitter.Emit(EventDevInstallError, metadata)
		return nil, apperror.Wrap(
			err, apperror.TypePluginLoadFailed, http.StatusInternalServerError, "Failed to load plugin",
		)
	}

	pm.emitter.Emit(EventDevInstallComplete, metadata)

	if err = pm.writePluginStateJSON(); err != nil {
		l.Errorw(pm.ctx, "failed to persist plugin state after dev install", "pluginID", metadata.ID, "error", err)
		pm.emitter.Emit(EventStateWriteError, map[string]interface{}{
			payloadKeyPluginID: metadata.ID,
			"detail":           err.Error(),
		})
	}

	return metadata, nil
}

// unloadForReinstall unloads the plugin if it is loaded, logging (and otherwise
// ignoring) a failure to unload.
func (pm *pluginManager) unloadForReinstall(l logging.Logger, pluginID string) {
	pm.recordsMu.RLock()
	_, exists := pm.records[pluginID]
	pm.recordsMu.RUnlock()
	if !exists {
		return
	}
	l.Infow(pm.ctx, "plugin already loaded, unloading first for reinstall", "pluginID", pluginID)
	if unloadErr := pm.UnloadPlugin(pluginID); unloadErr != nil {
		l.Warnw(pm.ctx, "failed to unload existing plugin (continuing anyway)",
			"pluginID", pluginID, "error", unloadErr)
	}
}

// prepareDevInstallDir copies plugin.yaml from the dev source path into the
// plugin's install directory and creates the bin directory the GoWatcher
// transfers the built binary into.
func (pm *pluginManager) prepareDevInstallDir(path string, metadata *config.PluginMeta) error {
	if err := pm.transferPluginBuild(path, metadata, metadata.ID, plugintypes.BuildOpts{
		ExcludeBackend: true,
		ExcludeUI:      true,
		GoPath:         "",
		PnpmPath:       "",
		NodePath:       "",
	}); err != nil {
		return apperror.Wrap(
			err, apperror.TypePluginInstallFailed, http.StatusInternalServerError, "Failed to copy plugin metadata",
		)
	}

	installLocation := pm.pluginsRoot.ResolvePath(metadata.ID)
	if err := os.MkdirAll(filepath.Join(installLocation, "bin"), 0755); err != nil {
		return apperror.Wrap(
			err, apperror.TypePluginInstallFailed, http.StatusInternalServerError, "Failed to create plugin bin directory",
		)
	}
	return nil
}

// registerBuildFailedDevPlugin stores a build-failed record for a dev plugin
// whose initial build failed, so the GoWatcher can reload it once the build
// succeeds, then emits EventDevInstallComplete and persists the state.
func (pm *pluginManager) registerBuildFailedDevPlugin(
	l logging.Logger,
	metadata *config.PluginMeta,
	path string,
	lastError string,
) {
	l.Infow(pm.ctx, "initial build failed, deferring to GoWatcher for rebuild", "pluginID", metadata.ID)
	record := plugintypes.NewPluginRecord(metadata.ID, *metadata, lifecycle.PhaseBuildFailed)
	record.DevMode = true
	record.DevPath = path
	record.LastError = lastError

	pm.recordsMu.Lock()
	pm.records[metadata.ID] = record
	pm.recordsMu.Unlock()

	pm.emitter.Emit(EventDevInstallComplete, metadata)
	if err := pm.writePluginStateJSON(); err != nil {
		l.Warnw(pm.ctx, "failed to persist plugin state after build-failed stub",
			"pluginID", metadata.ID, "error", err)
	}
}

// InstallFromPathPrompt installs a plugin from a file selected via dialog.
func (pm *pluginManager) InstallFromPathPrompt() (*config.PluginMeta, error) {
	path, err := application.Get().Dialog.OpenFile().
		PromptForSingleSelection()
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, apperror.Cancelled()
	}

	return pm.InstallPluginFromPath(path)
}

// InstallPluginVersion installs a plugin from the registry.
func (pm *pluginManager) InstallPluginVersion(
	pluginID string,
	version string,
) (*config.PluginMeta, error) {
	pm.emitter.Emit(EventUpdateStarted, UpdatePayload{PluginID: pluginID, Version: version})

	pm.syncRegistryURL()
	tmpPath, err := pm.registryClient.DownloadPlugin(context.Background(), pluginID, version)
	if err != nil {
		pm.logger.Errorw(pm.ctx, "failed to download and prepare", "error", err)
		pm.emitter.Emit(EventUpdateError, UpdateErrorPayload{PluginID: pluginID, Error: err.Error()})
		return nil, err
	}

	pm.logger.Debugw(pm.ctx, "installing plugin from downloaded tmp path", "path", tmpPath)
	meta, err := pm.InstallPluginFromPath(tmpPath)
	if err != nil {
		pm.emitter.Emit(EventUpdateError, UpdateErrorPayload{PluginID: pluginID, Error: err.Error()})
		return nil, err
	}

	// The marketplace version is authoritative — override whatever the
	// plugin.yaml inside the tarball says.
	meta.Version = version
	pm.recordsMu.Lock()
	if record, ok := pm.records[pluginID]; ok {
		record.Metadata.Version = version
	}
	pm.recordsMu.Unlock()

	if writeErr := pm.writePluginStateJSON(); writeErr != nil {
		pm.logger.Errorw(pm.ctx, "failed to persist state after version override", "error", writeErr)
	}

	pm.emitter.Emit(EventUpdateComplete, UpdatePayload{PluginID: pluginID, Version: version})
	return meta, nil
}

// InstallPluginFromPath installs a plugin from a tarball path.
func (pm *pluginManager) InstallPluginFromPath(path string) (*config.PluginMeta, error) {
	defer os.Remove(path)

	if !isGzippedTarball(path) {
		return nil, apperror.New(apperror.TypeValidation, http.StatusUnprocessableEntity, "Invalid plugin package",
			fmt.Sprintf("The file at '%s' is not a valid tar.gz archive.", path)).
			WithSuggestions("Ensure the file is a .tar.gz plugin package")
	}

	if err := checkTarball(path); err != nil {
		return nil, apperror.Wrap(err, apperror.TypeValidation, http.StatusUnprocessableEntity, "Corrupt plugin package").
			WithSuggestions("Re-download the plugin package and try again")
	}

	metadata, err := parseMetadataFromArchive(path)
	if err != nil {
		return nil, apperror.Wrap(
			err, apperror.TypePluginInstallFailed, http.StatusInternalServerError, "Failed to parse plugin metadata",
		)
	}

	pm.emitter.Emit(EventInstallStarted, metadata)

	location := pm.pluginsRoot.ResolvePath(metadata.ID)

	// Unpack to a temporary directory first so we don't destroy a working
	// installation if the archive is corrupt or extraction fails.
	tmpDir, mkErr := os.MkdirTemp(pm.pluginsRoot.ResolvePath(""), metadata.ID+"-install-")
	if mkErr != nil {
		pm.emitter.Emit(EventInstallError, metadata)
		return nil, apperror.Wrap(
			mkErr, apperror.TypePluginInstallFailed, http.StatusInternalServerError, "Failed to create temp directory",
		)
	}
	defer os.RemoveAll(tmpDir) // clean up temp dir in all cases

	if err = unpackPluginArchive(path, tmpDir); err != nil {
		pm.emitter.Emit(EventInstallError, metadata)
		return nil, apperror.Wrap(
			err, apperror.TypePluginInstallFailed, http.StatusInternalServerError, "Failed to unpack plugin package",
		)
	}

	// Extraction succeeded — now unload the running plugin and swap directories.
	if unloadErr := pm.UnloadPlugin(metadata.ID); unloadErr != nil {
		pm.logger.Debugw(pm.ctx, "unload before install failed (continuing anyway)",
			"pluginID", metadata.ID, "error", unloadErr)
	}
	os.RemoveAll(location)

	if err = os.Rename(tmpDir, location); err != nil {
		pm.emitter.Emit(EventInstallError, metadata)
		return nil, apperror.Wrap(
			err, apperror.TypePluginInstallFailed, http.StatusInternalServerError, "Failed to install plugin files",
		)
	}

	_, err = pm.LoadPlugin(metadata.ID, nil)
	if err != nil {
		pm.emitter.Emit(EventInstallError, metadata)
		return nil, apperror.Wrap(
			err, apperror.TypePluginLoadFailed, http.StatusInternalServerError, "Failed to load plugin after install",
		)
	}

	if err = pm.writePluginStateJSON(); err != nil {
		pm.logger.Errorw(pm.ctx, "failed to persist plugin state after install", "pluginID", metadata.ID, "error", err)
		pm.emitter.Emit(EventStateWriteError, map[string]interface{}{
			payloadKeyPluginID: metadata.ID,
			"detail":           err.Error(),
		})
	}

	pm.emitter.Emit(EventInstallFinished, metadata)
	return metadata, nil
}

// UninstallPlugin uninstalls a plugin from the manager and removes it from the filesystem.
func (pm *pluginManager) UninstallPlugin(id string) (sdktypes.PluginInfo, error) {
	l := pm.logger.With(logging.Any("name", "UninstallPlugin"), logging.Any("pluginID", id))
	defer func() {
		if writeErr := pm.writePluginStateJSON(); writeErr != nil {
			l.Errorw(pm.ctx, "failed to persist plugin state after uninstall", "error", writeErr)
		}
	}()

	l.Debugw(pm.ctx, "uninstalling plugin", "pluginID", id)
	pm.recordsMu.RLock()
	record, ok := pm.records[id]
	pm.recordsMu.RUnlock()
	if !ok {
		appErr := apperror.New(apperror.TypePluginNotLoaded, http.StatusNotFound,
			"Plugin not loaded",
			fmt.Sprintf("Plugin '%s' is not currently loaded.", id)).WithInstance(id)
		l.Errorw(pm.ctx, appErr.Error())
		return sdktypes.PluginInfo{}, appErr
	}

	info := record.ToInfo()

	// Stop dev server processes (Vite + GoWatcher) if running.
	if pm.devServerMgr != nil {
		if err := pm.devServerMgr.StopDevServer(id); err != nil {
			l.Warnw(pm.ctx, "failed to stop dev server (continuing with uninstall)", "pluginID", id, "error", err)
		}
	}

	// Cancel any in-progress crash recovery for this plugin.
	if pm.healthChecker != nil {
		pm.healthChecker.CancelRecovery(id)
	}

	if err := pm.UnloadPlugin(id); err != nil {
		appErr := apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusInternalServerError,
			"Failed to unload plugin during uninstall").WithInstance(id)
		l.Errorw(pm.ctx, appErr.Error())
		return sdktypes.PluginInfo{}, appErr
	}
	l.Debugw(pm.ctx, "unloaded plugin", "pluginID", id)

	if err := pm.pluginsRoot.RemoveAll(id); err != nil {
		appErr := apperror.Internal(err, "Failed to remove plugin from filesystem").WithInstance(id)
		l.Errorw(pm.ctx, appErr.Error())
		return sdktypes.PluginInfo{}, appErr
	}
	l.Debugw(pm.ctx, "uninstalled plugin", "pluginID", id)

	return info, nil
}

// Build-related helper functions (extracted from dev.go).

func (pm *pluginManager) transferPluginBuild(
	path string,
	meta *config.PluginMeta,
	pluginID string,
	opts plugintypes.BuildOpts,
) error {
	installLocation := pm.pluginsRoot.ResolvePath(pluginID)

	if err := os.MkdirAll(installLocation, 0755); err != nil {
		return apperror.Internal(err, "Failed to create plugin install location")
	}

	ctx := context.Background()
	g, _ := errgroup.WithContext(ctx)

	g.Go(func() error { return copyPluginMeta(path, installLocation) })

	if meta.HasBackendCapabilities() && !opts.ExcludeBackend {
		g.Go(func() error { return movePluginBinary(path, installLocation) })
	}

	if meta.HasUICapabilities() && !opts.ExcludeUI {
		g.Go(func() error { return copyPluginUIAssets(path, installLocation) })
	}

	return g.Wait()
}

// copyPluginMeta copies plugin.yaml from the plugin source path to installLocation.
func copyPluginMeta(path, installLocation string) error {
	metaPath := filepath.Join(path, pluginMetaFile)
	targetMetaPath := filepath.Join(installLocation, pluginMetaFile)

	sourceMetaFile, err := os.Open(metaPath)
	if err != nil {
		return apperror.Internal(err, "Failed to open metadata file")
	}
	defer sourceMetaFile.Close()

	destMetaFile, err := os.Create(targetMetaPath)
	if err != nil {
		return apperror.Internal(err, "Failed to create metadata file")
	}
	defer destMetaFile.Close()

	if _, err = io.Copy(destMetaFile, sourceMetaFile); err != nil {
		return apperror.Internal(err, "Failed to copy metadata to plugin location")
	}
	return nil
}

// movePluginBinary moves the built plugin binary into installLocation/bin.
func movePluginBinary(path, installLocation string) error {
	binaryPath := filepath.Join(path, "build", "bin", "plugin")
	targetBinPath := filepath.Join(installLocation, "bin", "plugin")

	if err := os.MkdirAll(filepath.Dir(targetBinPath), 0755); err != nil {
		return apperror.Internal(err, "Failed to create plugin binary directory")
	}
	if err := os.Rename(binaryPath, targetBinPath); err != nil {
		return apperror.Internal(err, "Failed to move binary to plugin location")
	}
	return nil
}

// copyPluginUIAssets replaces installLocation/assets with the plugin's built UI assets.
func copyPluginUIAssets(path, installLocation string) error {
	uiPath := filepath.Join(path, "ui", "dist", "assets")
	targetUIPath := filepath.Join(installLocation, "assets")

	if err := os.RemoveAll(targetUIPath); err != nil {
		return apperror.Internal(err, "Failed to remove existing UI directory")
	}
	if err := os.MkdirAll(targetUIPath, 0755); err != nil {
		return apperror.Internal(err, "Failed to create UI directory")
	}

	if _, err := os.Stat(uiPath); err == nil {
		if err = CopyDirectory(uiPath, targetUIPath); err != nil {
			return apperror.Internal(err, "Failed to copy UI to plugin location")
		}
	}
	return nil
}
