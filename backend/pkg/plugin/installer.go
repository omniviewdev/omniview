package plugin

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/sync/errgroup"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// InstallInDevMode installs a plugin from a directory selected via dialog.
func (pm *pluginManager) InstallInDevMode() (*config.PluginMeta, error) {
	l := pm.logger.Named("InstallInDevMode")
	l.Infow("InstallInDevMode called")

	path, err := runtime.OpenDirectoryDialog(pm.ctx, runtime.OpenDialogOptions{})
	if err != nil {
		l.Error(err)
		return nil, err
	}
	if path == "" {
		return nil, apperror.Cancelled()
	}

	l.Infow("installing plugin in dev mode", "path", path)

	metadata, err := parseMetadataFromPluginPath(path)
	if err != nil {
		return nil, apperror.Wrap(err, apperror.TypePluginInstallFailed, 500, "Failed to parse plugin metadata")
	}
	l.Infow("parsed plugin metadata", "pluginID", metadata.ID)

	emitEvent(pm.ctx, EventDevInstallStart, metadata)

	// Unload existing instance if it exists.
	if _, exists := pm.records[metadata.ID]; exists {
		l.Infow("plugin already loaded, unloading first for reinstall", "pluginID", metadata.ID)
		if unloadErr := pm.UnloadPlugin(metadata.ID); unloadErr != nil {
			l.Warnw("failed to unload existing plugin (continuing anyway)", "pluginID", metadata.ID, "error", unloadErr)
		}
	}

	// Copy plugin.yaml to ~/.omniview/plugins/<pluginID>/.
	if err = transferPluginBuild(path, metadata, metadata.ID, types.BuildOpts{
		ExcludeBackend: true,
		ExcludeUI:      true,
	}); err != nil {
		emitEvent(pm.ctx, EventDevInstallError, metadata)
		return nil, apperror.Wrap(err, apperror.TypePluginInstallFailed, 500, "Failed to copy plugin metadata")
	}

	// Ensure the bin directory exists for the GoWatcher to transfer into.
	installLocation := getPluginLocation(metadata.ID)
	if err = os.MkdirAll(filepath.Join(installLocation, "bin"), 0755); err != nil {
		emitEvent(pm.ctx, EventDevInstallError, metadata)
		return nil, apperror.Wrap(err, apperror.TypePluginInstallFailed, 500, "Failed to create plugin bin directory")
	}

	// Start the dev server (Vite + GoWatcher with initial build).
	if pm.devServerMgr != nil {
		l.Infow("starting dev server (triggers initial build)", "pluginID", metadata.ID)
		if _, startErr := pm.devServerMgr.StartDevServerForPath(metadata.ID, path); startErr != nil {
			emitEvent(pm.ctx, EventDevInstallError, metadata)
			return nil, apperror.Wrap(startErr, apperror.TypePluginBuildFailed, 500, "Dev server failed to start").
				WithActions(apperror.OpenSettingsAction("developer"))
		}
		l.Infow("dev server started successfully", "pluginID", metadata.ID)
	} else {
		emitEvent(pm.ctx, EventDevInstallError, metadata)
		return nil, apperror.New(apperror.TypeSettingsMissingConfig, 422, "No dev server manager configured",
			"The dev server manager is not available. Ensure developer settings are configured.").
			WithActions(apperror.OpenSettingsAction("developer"))
	}

	// Load the plugin — binary should now exist from GoWatcher initial build.
	l.Infow("loading plugin (starting binary + gRPC connect)", "pluginID", metadata.ID)
	_, err = pm.LoadPlugin(metadata.ID, &LoadPluginOptions{DevMode: true, DevModePath: path})
	if err != nil {
		emitEvent(pm.ctx, EventDevInstallError, metadata)
		return nil, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500, "Failed to load plugin")
	}

	emitEvent(pm.ctx, EventDevInstallComplete, metadata)

	if err = pm.writePluginStateJSON(); err != nil {
		l.Errorw("failed to persist plugin state after dev install", "pluginID", metadata.ID, "error", err)
		emitEvent(pm.ctx, EventStateWriteError, map[string]interface{}{
			"pluginID": metadata.ID,
			"detail":   err.Error(),
		})
	}

	return metadata, nil
}

// InstallFromPathPrompt installs a plugin from a file selected via dialog.
func (pm *pluginManager) InstallFromPathPrompt() (*config.PluginMeta, error) {
	path, err := runtime.OpenFileDialog(pm.ctx, runtime.OpenDialogOptions{})
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
	emitEvent(pm.ctx, EventUpdateStarted, pluginID, version)

	pm.syncRegistryURL()
	tmpPath, err := pm.registryClient.DownloadPlugin(context.Background(), pluginID, version)
	if err != nil {
		pm.logger.Errorw("failed to download and prepare", "error", err)
		return nil, err
	}

	pm.logger.Debug("installing plugin from downloaded tmp path", "path", tmpPath)
	return pm.InstallPluginFromPath(tmpPath)
}

// InstallPluginFromPath installs a plugin from a tarball path.
func (pm *pluginManager) InstallPluginFromPath(path string) (*config.PluginMeta, error) {
	if err := auditPluginDir(); err != nil {
		return nil, err
	}

	if !isGzippedTarball(path) {
		return nil, apperror.New(apperror.TypeValidation, 422, "Invalid plugin package",
			fmt.Sprintf("The file at '%s' is not a valid tar.gz archive.", path)).
			WithSuggestions("Ensure the file is a .tar.gz plugin package")
	}

	if err := checkTarball(path); err != nil {
		return nil, apperror.Wrap(err, apperror.TypeValidation, 422, "Corrupt plugin package").
			WithSuggestions("Re-download the plugin package and try again")
	}

	metadata, err := parseMetadataFromArchive(path)
	if err != nil {
		return nil, apperror.Wrap(err, apperror.TypePluginInstallFailed, 500, "Failed to parse plugin metadata")
	}

	emitEvent(pm.ctx, EventInstallStarted, metadata)

	location := getPluginLocation(metadata.ID)
	if err = os.MkdirAll(location, 0755); err != nil {
		emitEvent(pm.ctx, EventInstallError, metadata)
		return nil, apperror.Wrap(err, apperror.TypePluginInstallFailed, 500, "Failed to create plugin directory")
	}

	if err = unpackPluginArchive(path, location); err != nil {
		emitEvent(pm.ctx, EventInstallError, metadata)
		return nil, apperror.Wrap(err, apperror.TypePluginInstallFailed, 500, "Failed to unpack plugin package")
	}

	// Unload existing version if present.
	pm.UnloadPlugin(metadata.ID)

	_, err = pm.LoadPlugin(metadata.ID, nil)
	if err != nil {
		emitEvent(pm.ctx, EventInstallError, metadata)
		return nil, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500, "Failed to load plugin after install")
	}

	if err = pm.writePluginStateJSON(); err != nil {
		pm.logger.Errorw("failed to persist plugin state after install", "pluginID", metadata.ID, "error", err)
		emitEvent(pm.ctx, EventStateWriteError, map[string]interface{}{
			"pluginID": metadata.ID,
			"detail":   err.Error(),
		})
	}

	emitEvent(pm.ctx, EventInstallFinished, metadata)
	return metadata, nil
}

// UninstallPlugin uninstalls a plugin from the manager and removes it from the filesystem.
func (pm *pluginManager) UninstallPlugin(id string) (sdktypes.PluginInfo, error) {
	l := pm.logger.With("name", "UninstallPlugin", "pluginID", id)
	defer pm.writePluginStateJSON()

	l.Debugw("uninstalling plugin", "pluginID", id)
	record, ok := pm.records[id]
	if !ok {
		appErr := apperror.New(apperror.TypePluginNotLoaded, 404,
			"Plugin not loaded",
			fmt.Sprintf("Plugin '%s' is not currently loaded.", id)).WithInstance(id)
		l.Error(appErr)
		return sdktypes.PluginInfo{}, appErr
	}

	info := record.ToInfo()

	// Stop dev server processes (Vite + GoWatcher) if running.
	if pm.devServerMgr != nil {
		if err := pm.devServerMgr.StopDevServer(id); err != nil {
			l.Warnw("failed to stop dev server (continuing with uninstall)", "pluginID", id, "error", err)
		}
	}

	// Cancel any in-progress crash recovery for this plugin.
	if pm.healthChecker != nil {
		pm.healthChecker.CancelRecovery(id)
	}

	if err := pm.UnloadPlugin(id); err != nil {
		appErr := apperror.Wrap(err, apperror.TypePluginLoadFailed, 500,
			"Failed to unload plugin during uninstall").WithInstance(id)
		l.Error(appErr)
		return sdktypes.PluginInfo{}, appErr
	}
	l.Debugw("unloaded plugin", "pluginID", id)

	location := getPluginLocation(id)
	if err := os.RemoveAll(location); err != nil {
		appErr := apperror.Internal(err, "Failed to remove plugin from filesystem").WithInstance(id)
		l.Error(appErr)
		return sdktypes.PluginInfo{}, appErr
	}
	l.Debugw("uninstalled plugin", "pluginID", id)

	return info, nil
}

// Build-related helper functions (extracted from dev.go).

func transferPluginBuild(path string, meta *config.PluginMeta, pluginID string, opts types.BuildOpts) error {
	installLocation := getPluginLocation(pluginID)

	if err := os.MkdirAll(installLocation, 0755); err != nil {
		return apperror.Internal(err, "Failed to create plugin install location")
	}

	ctx := context.Background()
	g, _ := errgroup.WithContext(ctx)

	g.Go(func() error {
		metaPath := filepath.Join(path, "plugin.yaml")
		targetMetaPath := filepath.Join(installLocation, "plugin.yaml")

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
	})

	if meta.HasBackendCapabilities() && !opts.ExcludeBackend {
		g.Go(func() error {
			binaryPath := filepath.Join(path, "build", "bin", "plugin")
			targetBinPath := filepath.Join(installLocation, "bin", "plugin")

			if err := os.MkdirAll(filepath.Dir(targetBinPath), 0755); err != nil {
				return apperror.Internal(err, "Failed to create plugin binary directory")
			}
			if err := os.Rename(binaryPath, targetBinPath); err != nil {
				return apperror.Internal(err, "Failed to move binary to plugin location")
			}
			return nil
		})
	}

	if meta.HasUICapabilities() && !opts.ExcludeUI {
		g.Go(func() error {
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
		})
	}

	return g.Wait()
}

func buildPluginBinary(path string, opts types.BuildOpts) error {
	if path == "" {
		return apperror.New(apperror.TypeValidation, 422, "Invalid plugin path", "Plugin binary path is empty.")
	}

	requiredFiles := []string{"plugin.yaml", "pkg/main.go"}
	for _, file := range requiredFiles {
		joined := filepath.Join(path, file)
		_, err := os.Stat(joined)
		if errors.Is(err, os.ErrNotExist) {
			return apperror.New(apperror.TypeValidation, 422, "Missing required file",
				fmt.Sprintf("Required file %s not found in plugin path.", joined))
		}
	}

	out := filepath.Join(path, "build", "bin")
	if err := os.RemoveAll(out); err != nil {
		return apperror.Internal(err, "Failed to remove output directory")
	}
	if err := os.MkdirAll(out, 0755); err != nil {
		return apperror.Internal(err, "Failed to create output directory")
	}

	var stdout bytes.Buffer
	var stderr bytes.Buffer

	cmd := exec.Command(opts.GoPath, "build", "-o", "build/bin/plugin", "./pkg")
	cmd.Dir = path
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return apperror.New(apperror.TypePluginBuildFailed, 500, "Plugin build failed",
			fmt.Sprintf("Build error: %s\n%s", err, stderr.String()))
	}

	return nil
}

func buildPluginUi(path string, opts types.BuildOpts) error {
	if path == "" {
		return apperror.New(apperror.TypeValidation, 422, "Invalid plugin path", "Plugin UI path is empty.")
	}

	requiredFiles := []string{"plugin.yaml", "ui/package.json", "ui/vite.config.ts"}
	for _, file := range requiredFiles {
		joined := filepath.Join(path, file)
		_, err := os.Stat(joined)
		if errors.Is(err, os.ErrNotExist) {
			return apperror.New(apperror.TypeValidation, 422, "Missing required file",
				fmt.Sprintf("Required file %s not found in plugin path.", joined))
		}
	}

	out := filepath.Join(path, "ui")

	var stdout bytes.Buffer
	var stderr bytes.Buffer

	cmd, err := PrepareCommandWithBinaries(
		opts.PnpmPath,
		[]string{"run", "build"},
		opts.PnpmPath,
		opts.NodePath,
	)
	if err != nil {
		return err
	}

	cmd.Dir = filepath.Join(out)
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err = cmd.Run(); err != nil {
		return apperror.New(apperror.TypePluginBuildFailed, 500, "Plugin UI build failed",
			fmt.Sprintf("Build error: %s\n%s\n%s", err, stderr.String(), stdout.String()))
	}

	return nil
}

func buildAndTransferPlugin(path string, meta *config.PluginMeta, pluginID string, opts types.BuildOpts) error {
	if meta == nil {
		return apperror.New(apperror.TypeValidation, 422, "Invalid plugin", "Plugin metadata is missing.")
	}
	if !meta.HasBackendCapabilities() && !meta.HasUICapabilities() {
		return apperror.New(apperror.TypeValidation, 422, "Invalid plugin", "No plugin capabilities found.")
	}

	if err := HydrateBuildOpts(&opts); err != nil {
		return err
	}

	var buildtasks sync.WaitGroup
	var beError, feError error

	if meta.HasBackendCapabilities() && !opts.ExcludeBackend {
		buildtasks.Add(1)
		go func() {
			defer buildtasks.Done()
			beError = buildPluginBinary(path, opts)
		}()
	}

	if meta.HasUICapabilities() && !opts.ExcludeUI {
		buildtasks.Add(1)
		go func() {
			defer buildtasks.Done()
			feError = buildPluginUi(path, opts)
		}()
	}

	buildtasks.Wait()

	if beError != nil {
		return beError
	}
	if feError != nil {
		return feError
	}

	return transferPluginBuild(path, meta, pluginID, opts)
}
