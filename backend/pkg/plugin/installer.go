package plugin

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/wailsapp/wails/v3/pkg/application"
	"golang.org/x/sync/errgroup"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdkstate "github.com/omniviewdev/plugin-sdk/pkg/state"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// InstallInDevMode installs a plugin from a directory selected via dialog.
func (pm *pluginManager) InstallInDevMode() (*config.PluginMeta, error) {
	path, err := application.Get().Dialog.OpenFile().
		CanChooseDirectories(true).
		CanChooseFiles(false).
		PromptForSingleSelection()
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, apperror.Cancelled()
	}
	info, err := pm.InstallDevPluginFromPath(path)
	if info.ID == "" {
		return nil, err
	}
	return &info.Metadata, err
}

// InstallDevPluginFromPath links a local source without opening a native dialog.
// A failed build/load returns the retained, recoverable record and a non-nil
// structured error; it does not represent a ready installation.
func (pm *pluginManager) InstallDevPluginFromPath(path string) (info sdktypes.PluginInfo, err error) {
	l := pm.logger.Named("InstallDevPluginFromPath")
	var pluginID string
	buildAttempted := false
	defer func() {
		if r := recover(); r != nil {
			l.Errorw(pm.ctx, "panic in dev install", "panic", r, "stack", string(debug.Stack()))
			err = apperror.Internal(fmt.Errorf("panic: %v", r), "Install in dev mode failed")
		}
		if err != nil {
			var appErr *apperror.AppError
			if !errors.As(err, &appErr) {
				appErr = apperror.Wrap(err, apperror.TypePluginInstallFailed,
					http.StatusInternalServerError, "Dev mode installation failed")
			}
			// Copy before adding occurrence-specific context.
			diagnostic := *appErr
			var logs []devserver.LogEntry
			var startupErr *devserver.StartupError
			if errors.As(err, &startupErr) {
				logs = startupErr.Logs
			} else if logsSource, ok := pm.devServerMgr.(interface {
				GetDevServerLogs(string, int) []devserver.LogEntry
			}); buildAttempted && pluginID != "" && ok {
				logs = logsSource.GetDevServerLogs(pluginID, 200)
			}
			if pluginID != "" {
				diagnostic.Instance = pluginID
			}
			diagnostic.Detail = devInstallDiagnostic(path, pluginID, appErr.Detail, logs)
			err = &diagnostic
		}
	}()

	path, err = filepath.Abs(path)
	if err == nil {
		path, err = filepath.EvalSymlinks(path)
	}
	if err != nil {
		return info, apperror.Wrap(err, apperror.TypeValidation, http.StatusUnprocessableEntity, "Invalid plugin source path")
	}
	metadata, err := parseMetadataFromPluginPath(path)
	if err != nil {
		return info, apperror.Wrap(err, apperror.TypePluginInstallFailed, http.StatusUnprocessableEntity, "Failed to parse plugin metadata")
	}
	pluginID = metadata.ID
	if pm.devServerMgr == nil {
		return info, apperror.New(
			apperror.TypeSettingsMissingConfig, http.StatusUnprocessableEntity,
			"No dev server manager configured",
			"The dev server manager is not available. Ensure developer settings are configured.",
		).WithActions(apperror.OpenSettingsAction("developer"))
	}
	if _, selectionErr := pm.validateManagedSource(metadata.ID, path, nil); selectionErr != nil {
		return info, selectionErr
	}

	installMu := pm.installOpsLock(metadata.ID)
	installMu.Lock()
	defer installMu.Unlock()
	if err := pm.guardUninstallRecovery(metadata.ID); err != nil {
		return info, err
	}
	pm.emitter.Emit(EventDevInstallStart, metadata)

	// Stop the watcher before unloading so it cannot reload the old source
	// during the swap. Never trust StartDevServerForPath's existing-ID path.
	if err = pm.unloadForReinstall(metadata.ID); err != nil {
		pm.emitter.Emit(EventDevInstallError, metadata)
		return info, err
	}
	if err = pm.prepareDevInstallDir(path, metadata); err != nil {
		pm.emitter.Emit(EventDevInstallError, metadata)
		return info, err
	}

	buildAttempted = true
	state, startErr := pm.devServerMgr.StartDevServerForPath(metadata.ID, path)
	if startErr != nil {
		return pm.failedDevInstall(metadata, path, lifecycle.PhaseFailed,
			apperror.Wrap(startErr, apperror.TypePluginBuildFailed, http.StatusInternalServerError, "Dev server failed to start"))
	}
	if state.GoStatus == devserver.DevProcessStatusError || state.ViteStatus == devserver.DevProcessStatusError {
		buildErr := apperror.New(apperror.TypePluginBuildFailed, http.StatusUnprocessableEntity,
			"Dev plugin build failed", state.LastError).WithInstance(metadata.ID)
		return pm.failedDevInstall(metadata, path, lifecycle.PhaseBuildFailed, buildErr)
	}

	info, err = pm.LoadPlugin(metadata.ID, &LoadPluginOptions{DevMode: true, DevModePath: path})
	if err != nil {
		return pm.failedDevInstall(metadata, path, lifecycle.PhaseFailed,
			apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusInternalServerError, "Failed to load plugin"))
	}
	if err = pm.persistPluginOperation(metadata.ID); err != nil {
		pm.emitter.Emit(EventDevInstallError, metadata)
		return info, err
	}
	pm.emitter.Emit(EventDevInstallComplete, metadata)
	return info, nil
}

func devInstallDiagnostic(path, pluginID, cause string, logs []devserver.LogEntry) string {
	const limit = 1800
	const truncated = "\n[Diagnostic truncated.]"
	var detail strings.Builder
	fmt.Fprintf(&detail, "Source: %s\n", path)
	if pluginID != "" {
		fmt.Fprintf(&detail, "Plugin: %s\n", pluginID)
	}
	fmt.Fprintf(&detail, "\n%s", cause)
	context := detail.String()
	contextLimit := limit
	if len(logs) > 0 {
		contextLimit = limit / 2
	}
	if utf8.RuneCountInString(context) > contextLimit {
		context = diagnosticPrefix(context, contextLimit-utf8.RuneCountInString(truncated)) + truncated
	}
	if len(logs) == 0 {
		return context
	}
	const header = "\n\nBuild output (newest retained lines; earlier output may be omitted):\n"
	remaining := limit - utf8.RuneCountInString(context) - utf8.RuneCountInString(header)
	start := len(logs)
	for start > 0 {
		entry := logs[start-1]
		size := 7 + utf8.RuneCountInString(entry.Timestamp) + utf8.RuneCountInString(entry.Source) + utf8.RuneCountInString(entry.Message)
		if size > remaining {
			break
		}
		remaining -= size
		start--
	}
	var result strings.Builder
	result.WriteString(context)
	result.WriteString(header)
	if start == len(logs) {
		message := logs[start-1].Message
		for remaining > 0 && len(message) > 0 {
			_, size := utf8.DecodeLastRuneInString(message)
			message = message[:len(message)-size]
			remaining--
		}
		result.WriteString(logs[start-1].Message[len(message):])
	} else {
		for _, entry := range logs[start:] {
			fmt.Fprintf(&result, "[%s] [%s] %s\n", entry.Timestamp, entry.Source, entry.Message)
		}
	}
	return result.String()
}

func diagnosticPrefix(value string, limit int) string {
	for offset := range value {
		if limit == 0 {
			return value[:offset]
		}
		limit--
	}
	return value
}

// installOpsLock serializes install/rebind/unlink/uninstall transactions, but
// does not hold the load/reload mutex while the watcher's initial build calls
// back into ReloadPlugin.
func (pm *pluginManager) installOpsLock(id string) *sync.Mutex {
	pm.pluginOpsMu.Lock()
	defer pm.pluginOpsMu.Unlock()
	if pm.installOpsLocks == nil {
		pm.installOpsLocks = make(map[string]*sync.Mutex)
	}
	mu := pm.installOpsLocks[id]
	if mu == nil {
		mu = &sync.Mutex{}
		pm.installOpsLocks[id] = mu
	}
	return mu
}

func (pm *pluginManager) unloadForReinstall(pluginID string) error {
	if pm.healthChecker != nil {
		pm.healthChecker.CancelRecovery(pluginID)
	}
	if pm.devServerMgr != nil && pm.devServerMgr.IsManaged(pluginID) {
		if err := pm.devServerMgr.StopDevServer(pluginID); err != nil {
			return apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusConflict,
				"Failed to stop existing dev server").WithInstance(pluginID)
		}
	}
	if err := pm.UnloadPlugin(pluginID); err != nil {
		return apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusConflict,
			"Failed to unload existing plugin").WithInstance(pluginID)
	}
	return nil
}

func (pm *pluginManager) persistPluginOperation(pluginID string) error {
	if err := pm.writePluginStateJSON(); err != nil {
		pm.emitter.Emit(EventStateWriteError, StateWriteErrorPayload{PluginID: pluginID, Detail: err.Error()})
		return apperror.Internal(err, "Failed to persist plugin state").WithInstance(pluginID)
	}
	return nil
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
	// A failed build of a newly linked source must not leave the previous
	// source's executable available for startup/reload.
	if err := os.Remove(filepath.Join(installLocation, "bin", "plugin")); err != nil && !os.IsNotExist(err) {
		return apperror.Wrap(err, apperror.TypePluginInstallFailed, http.StatusInternalServerError,
			"Failed to remove previous dev plugin binary")
	}
	return nil
}

// failedDevInstall preserves the source binding so watcher/manual reload can
// recover after a failed initial build or load. Failure is never completion.
func (pm *pluginManager) failedDevInstall(
	metadata *config.PluginMeta,
	path string,
	phase lifecycle.PluginPhase,
	cause error,
) (sdktypes.PluginInfo, error) {
	record := plugintypes.NewPluginRecord(metadata.ID, *metadata, phase)
	record.DevMode = true
	record.DevPath = path
	record.LastError = cause.Error()
	pm.recordsMu.Lock()
	pm.records[metadata.ID] = record
	pm.recordsMu.Unlock()
	pm.emitter.Emit(EventDevInstallError, metadata)
	if persistErr := pm.persistPluginOperation(metadata.ID); persistErr != nil {
		return record.ToInfo(), apperror.Wrap(errors.Join(cause, persistErr),
			apperror.TypePluginInstallFailed, http.StatusInternalServerError,
			"Dev install failed and state could not be persisted").WithInstance(metadata.ID)
	}
	return record.ToInfo(), cause
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
	defer os.Remove(tmpPath) // DownloadPlugin transfers ownership of this temporary archive.

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

	if writeErr := pm.persistPluginOperation(pluginID); writeErr != nil {
		pm.emitter.Emit(EventUpdateError, UpdateErrorPayload{PluginID: pluginID, Error: writeErr.Error()})
		return meta, writeErr
	}

	pm.emitter.Emit(EventUpdateComplete, UpdatePayload{PluginID: pluginID, Version: version})
	return meta, nil
}

// InstallPluginFromPath installs a caller-owned tarball without deleting it.
// Download callers, not this transaction, own temporary archive cleanup.
func (pm *pluginManager) InstallPluginFromPath(path string) (*config.PluginMeta, error) {
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
	installMu := pm.installOpsLock(metadata.ID)
	installMu.Lock()
	defer installMu.Unlock()
	if err := pm.guardUninstallRecovery(metadata.ID); err != nil {
		return nil, err
	}
	if err := pm.guardArchiveRecovery(metadata.ID); err != nil {
		return nil, err
	}

	statePublished, err := pm.installArchiveCandidate(path, metadata)
	if err != nil {
		var problem *apperror.AppError
		if !errors.As(err, &problem) || problem.Type != apperror.TypePluginCommittedCleanupPending {
			pm.emitter.Emit(EventInstallError, metadata)
		}
		if statePublished {
			return metadata, err
		}
		return nil, err
	}

	return metadata, nil
}

// UninstallPlugin uninstalls a plugin from the manager and removes it from the filesystem.
func (pm *pluginManager) UninstallPlugin(id string) (sdktypes.PluginInfo, error) {
	installMu := pm.installOpsLock(id)
	installMu.Lock()
	defer installMu.Unlock()
	return pm.uninstallPlugin(id)
}

// UnlinkDevPlugin stops and removes the installed dev binding and copied build
// artifacts using the normal uninstall transaction. The source tree is never
// removed. Installed (non-dev) plugins must use UninstallPlugin explicitly.
func (pm *pluginManager) UnlinkDevPlugin(id string) (sdktypes.PluginInfo, error) {
	installMu := pm.installOpsLock(id)
	installMu.Lock()
	defer installMu.Unlock()
	pm.recordsMu.RLock()
	record := pm.records[id]
	isDev := record != nil && record.DevMode
	pm.recordsMu.RUnlock()
	if record == nil {
		return sdktypes.PluginInfo{}, apperror.PluginNotFound(id)
	}
	if !isDev {
		return record.ToInfo(), apperror.New(apperror.TypeValidation, http.StatusConflict,
			"Plugin is not linked in dev mode", "Use uninstall for installed plugins.").WithInstance(id)
	}
	return pm.uninstallPlugin(id)
}

func (pm *pluginManager) uninstallPlugin(id string) (sdktypes.PluginInfo, error) {
	pm.recordsMu.RLock()
	record, ok := pm.records[id]
	pm.recordsMu.RUnlock()
	if !ok {
		return sdktypes.PluginInfo{}, apperror.PluginNotFound(id)
	}
	if err := sdkstate.ValidateComponent(id); err != nil {
		return record.ToInfo(), apperror.Internal(err, "Invalid installed plugin identity")
	}
	if err := pm.guardArchiveRecovery(id); err != nil {
		return record.ToInfo(), err
	}
	recovery, err := pm.prepareUninstallRecovery(id, record)
	if err != nil {
		return record.ToInfo(), apperror.Internal(err, "Failed to prepare owned uninstall recovery").WithInstance(id)
	}
	canonical, staged, err := pm.locateUninstallRecovery(recovery)
	if err != nil {
		record.LastError = fmt.Sprintf("pending uninstall recovery at %s: %v", pm.pluginsRoot.ResolvePath(recovery.Stage), err)
		return record.ToInfo(), apperror.Internal(err, "Uninstall recovery path is occupied or changed").WithInstance(id)
	}
	info := record.ToInfo()
	if err = pm.unloadForReinstall(id); err != nil {
		// The pre-unload ownership marker remains available for a safe retry.
		return info, err
	}
	restore := func(cause error, incomplete bool) (sdktypes.PluginInfo, error) {
		if recovery != nil && staged && recovery.cleanupStarted {
			incomplete = true
			cause = errors.Join(cause, errors.New("disposal began; partial artifacts remain in owned staging"))
		}
		if recovery != nil && staged && !recovery.cleanupStarted {
			_, stillStaged, ownershipErr := pm.locateUninstallRecovery(recovery)
			if ownershipErr == nil && stillStaged {
				ownershipErr = pm.pluginsRoot.RenameDirectoryNoReplace(filepath.Join(recovery.Stage, "plugin"), id)
				if ownershipErr == nil {
					identity, identityErr := pm.pluginsRoot.DirectoryIdentity(id)
					if identityErr != nil || identity != recovery.OwnedIdentity {
						ownershipErr = errors.Join(identityErr, errors.New("restored plugin directory identity changed"))
					}
				}
			} else if ownershipErr == nil {
				ownershipErr = errors.New("owned staged installation is no longer complete")
			}
			if ownershipErr != nil {
				incomplete = true
				cause = errors.Join(cause, ownershipErr)
			}
		}
		// Keep durable proof on every incomplete transaction, including when the
		// main inventory write is unavailable. Never recapture a replacement inode.
		if recovery != nil {
			cause = fmt.Errorf("pending uninstall recovery at %s: %w", pm.pluginsRoot.ResolvePath(recovery.Stage), cause)
		}
		record.Phase = lifecycle.PhaseStopped
		if incomplete {
			record.Phase = lifecycle.PhaseFailed
		}
		record.Backend = nil
		record.LastError = cause.Error()
		if record.StateMachine != nil {
			record.StateMachine.ForcePhase(record.Phase, "uninstall did not complete")
		}
		pm.recordsMu.Lock()
		pm.records[id] = record
		pm.recordsMu.Unlock()
		return record.ToInfo(), apperror.Internal(errors.Join(cause, pm.persistPluginOperation(id)), "Failed to uninstall plugin").WithInstance(id)
	}
	if recovery != nil && canonical {
		if err = pm.pluginsRoot.RenameDirectoryNoReplace(id, filepath.Join(recovery.Stage, "plugin")); err != nil {
			return restore(err, false)
		}
		staged = true
		if _, _, err = pm.locateUninstallRecovery(recovery); err != nil {
			return restore(err, true)
		}
	}
	if err = pm.persistPluginOperation(id); err != nil {
		return restore(err, false)
	}
	if err = pm.removeUninstallRecovery(recovery); err != nil {
		return restore(err, true)
	}
	pm.emitter.Emit(EventInventoryChanged)
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
