package plugin

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/hashicorp/go-hclog"
	goplugin "github.com/hashicorp/go-plugin"
	"go.opentelemetry.io/otel/attribute"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/instance"
	"github.com/omniviewdev/omniview/internal/telemetry"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	ep "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	lp "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	mp "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	np "github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	sp "github.com/omniviewdev/plugin-sdk/pkg/v1/settings"
	tp "github.com/omniviewdev/plugin-sdk/pkg/v1/tools"
)

// pluginStartTimeout bounds how long a plugin process may take to start, so
// broken plugins don't block startup (go-plugin's default is 60s).
const pluginStartTimeout = 15 * time.Second

// LoadPluginOptions configures how a plugin is loaded.
type LoadPluginOptions struct {
	DevMode         bool
	DevModePath     string
	ExistingState   *plugintypes.PluginStateRecord
	archive         *archiveRecovery
	archiveRestore  bool
	dependencyOwner bool
}

// LoadPlugin loads a plugin from its installation directory.
// If the plugin is already loaded and running, this is a no-op.
func (pm *pluginManager) LoadPlugin(id string, opts *LoadPluginOptions) (_ plugintypes.PluginInfo, resultErr error) {
	devMode := opts != nil && (opts.DevMode || (opts.ExistingState != nil && opts.ExistingState.DevMode))
	end := pm.lifecycleOp("plugin.Load", id, attribute.Bool("dev_mode", devMode))
	started := time.Now()
	defer func() {
		end(resultErr)
		if resultErr != nil {
			pm.logger.Errorw(pm.lifecycleCtx(id), "plugin load failed", "pluginID", id,
				"errorClass", telemetryutil.ErrorClass(resultErr), "durationMs", time.Since(started).Milliseconds())
		}
	}()
	return pm.loadPluginLocked(id, opts)
}

func (pm *pluginManager) loadPluginLocked(id string, opts *LoadPluginOptions) (info plugintypes.PluginInfo, resultErr error) {
	loadStarted := time.Now()
	if entry, ok := pm.builtin(id); ok {
		return pm.loadBuiltinLocked(id, entry, opts)
	}
	pm.recordsMu.RLock()
	existing := pm.records[id]
	alreadyRunning := existing != nil && existing.Phase == lifecycle.PhaseRunning
	pm.recordsMu.RUnlock()
	if !alreadyRunning {
		op := telemetry.BeginOperation(telemetry.WithPlugin(context.Background(), id), "plugin", "load")
		defer func() { op.End(resultErr) }()
	}
	if err := pm.guardUninstallRecovery(id); err != nil {
		return plugintypes.PluginInfo{}, err
	}
	if err := pm.checkArchiveLoad(id, opts); err != nil {
		return plugintypes.PluginInfo{}, err
	}
	log := pm.logger.Named("LoadPlugin").With(logging.Any("id", id), logging.Any("opts", opts))
	// An existing dev binding remains dev inventory even when a caller omits
	// options; only the canonical unload/install transaction may replace it.
	var prior *plugintypes.PluginStateRecord
	pm.recordsMu.RLock()
	if existing := pm.records[id]; existing != nil && existing.DevMode {
		state := existing.ToStateRecord()
		prior = &state
	}
	pm.recordsMu.RUnlock()
	if prior != nil {
		if opts != nil && opts.DevMode {
			oldSource, oldErr := devcontract.CanonicalPath(prior.DevPath)
			newSource, newErr := devcontract.CanonicalPath(opts.DevModePath)
			if oldErr != nil {
				return plugintypes.PluginInfo{}, oldErr
			}
			if newErr != nil {
				return plugintypes.PluginInfo{}, newErr
			}
			if oldSource != newSource {
				return plugintypes.PluginInfo{}, fmt.Errorf("plugin %q is bound to another source; use the canonical workspace link/rebind transaction", id)
			}
		} else {
			inherited := LoadPluginOptions{}
			if opts != nil {
				inherited = *opts
			}
			inherited.ExistingState = prior
			opts = &inherited
		}
	}
	developmentSource := ""
	developmentLoad := false
	if opts != nil && opts.DevMode {
		developmentLoad = true
		developmentSource = opts.DevModePath
	} else if opts != nil && opts.ExistingState != nil && opts.ExistingState.DevMode {
		developmentLoad = true
		developmentSource = opts.ExistingState.DevPath
	}
	workspaceManaged := false
	if developmentLoad {
		var selectionErr error
		var archive *archiveRecovery
		if opts != nil {
			archive = opts.archive
		}
		workspaceManaged, selectionErr = pm.validateManagedSource(id, developmentSource, archive)
		if selectionErr != nil {
			return plugintypes.PluginInfo{}, selectionErr
		}
	}

	// Idempotent: if already loaded and running, return existing.
	pm.recordsMu.RLock()
	if existing, ok := pm.records[id]; ok {
		if existing.Phase == lifecycle.PhaseRunning {
			log.Debugw(pm.ctx, "plugin already loaded and running, skipping", "pluginID", id)
			info := existing.ToInfo()
			pm.recordsMu.RUnlock()
			if opts == nil || !opts.dependencyOwner {
				if ctrl, ok := pm.connfullControllers[sdktypes.CapabilityResource].(interface{ PromoteDependencyStart(string) }); ok {
					ctrl.PromoteDependencyStart(id)
				}
			}
			return info, nil
		}
		if existing.Phase == lifecycle.PhaseStarting {
			pm.recordsMu.RUnlock()
			return plugintypes.PluginInfo{}, apperror.New(apperror.TypePluginLoadFailed, http.StatusConflict,
				"Plugin is starting", fmt.Sprintf("Plugin '%s' is currently starting.", id)).WithInstance(id)
		}
	}
	pm.recordsMu.RUnlock()

	location := pm.pluginsRoot.ResolvePath(id)
	log.Debugw(pm.ctx, "loading plugin from location", "location", location, "pluginID", id)

	if _, err := os.Stat(location); os.IsNotExist(err) {
		return plugintypes.PluginInfo{}, apperror.PluginNotFound(id)
	}

	metadata, err := sdktypes.LoadPluginMetadata(location)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return plugintypes.PluginInfo{}, apperror.New(apperror.TypePluginLoadFailed, http.StatusNotFound,
				"Plugin metadata missing",
				fmt.Sprintf("Plugin '%s' is missing its metadata file (plugin.yaml).", id)).
				WithInstance(id)
		}
		return plugintypes.PluginInfo{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusInternalServerError,
			fmt.Sprintf("Failed to load metadata for plugin '%s'", id)).
			WithInstance(id)
	}

	if metadata.ID != id {
		return plugintypes.PluginInfo{}, fmt.Errorf("installed metadata ID %q does not match %q", metadata.ID, id)
	}
	// Validate based on mode.
	isDevMode := (opts != nil && opts.DevMode) ||
		(opts != nil && opts.ExistingState != nil && opts.ExistingState.DevMode)

	if err = validateForLoad(id, metadata, location, isDevMode); err != nil {
		return plugintypes.PluginInfo{}, err
	}
	if workspaceManaged {
		if err = pm.requireManagedArtifactStage(id, developmentSource, metadata); err != nil {
			return plugintypes.PluginInfo{}, err
		}
	}

	// Build the record directly.
	record := newLoadRecord(id, metadata, opts)
	if !record.Enabled {
		record.Phase = lifecycle.PhaseInstalled
		record.StateMachine.ForcePhase(record.Phase, "plugin disabled")
		pm.recordsMu.Lock()
		pm.records[id] = record
		pm.recordsMu.Unlock()
		return record.ToInfo(), nil
	}
	if err := pm.startRequiredOwners(metadata); err != nil {
		return plugintypes.PluginInfo{}, err
	}
	// Remove stale entry under write lock.
	pm.recordsMu.Lock()
	delete(pm.records, id)
	pm.recordsMu.Unlock()

	pm.logger.Debugw(pm.ctx, "found metadata",
		"metadata", metadata,
		"hasBackendCapabilities", metadata.HasBackendCapabilities(),
		"hasUiCapabilities", metadata.HasUICapabilities(),
	)

	var backend plugintypes.PluginBackend

	if metadata.HasBackendCapabilities() {
		backend, err = pm.startBackend(id, record, metadata, location, opts != nil && opts.dependencyOwner)
		if err != nil {
			return plugintypes.PluginInfo{}, err
		}
	}

	record.Phase = lifecycle.PhaseRunning
	record.Backend = backend
	pm.recordsMu.Lock()
	pm.records[id] = record
	pm.recordsMu.Unlock()
	if ctrl, ok := pm.connlessControllers[sdktypes.CapabilityTools].(interface{ Refresh() }); ok {
		ctrl.Refresh()
	}

	// Sync the state machine to Running.
	if record.StateMachine != nil {
		record.StateMachine.ForcePhase(lifecycle.PhaseRunning, "plugin loaded successfully")
		pm.registerStateObserver(id, record.StateMachine)
	}

	pm.logger.Infow(pm.lifecycleCtx(id), "plugin started", "pluginID", id,
		"durationMs", time.Since(loadStarted).Milliseconds())
	return record.ToInfo(), nil
}

// newLoadRecord builds the record for a plugin being loaded, applying the
// existing persisted state and dev-mode options from opts.
func newLoadRecord(id string, metadata config.PluginMeta, opts *LoadPluginOptions) *plugintypes.PluginRecord {
	record := plugintypes.NewPluginRecord(id, metadata, lifecycle.PhaseStarting)
	record.Enabled = true

	// Apply existing state if present.
	if opts != nil && opts.ExistingState != nil {
		record.Enabled = opts.ExistingState.Enabled
		record.DevMode = opts.ExistingState.DevMode
		record.DevPath = opts.ExistingState.DevPath
		record.ReleaseChannel = opts.ExistingState.ReleaseChannel
	}

	if opts != nil && opts.DevMode {
		record.DevMode = true
		record.DevPath = opts.DevModePath
	}
	return record
}

// startBackend creates the plugin's backend process and initializes and starts
// its controllers. On failure the record is stored as failed and an AppError
// is returned.
func (pm *pluginManager) startBackend(
	id string,
	record *plugintypes.PluginRecord,
	metadata config.PluginMeta,
	location string,
	dependencyOwner bool,
) (result plugintypes.PluginBackend, resultErr error) {
	_, endStart := pm.lifecycleScope("plugin.Start", id, attribute.Bool("dev_mode", record.DevMode))
	defer func() { endStart(resultErr) }()
	generation := pm.managedRuntimeGeneration(id, record.DevPath)
	if err := pm.checkBackendRecovery(id); err != nil {
		pm.storeFailedRecord(id, record, err)
		pm.observeManagedLifecycle(id, record.DevPath, generation, false, false, err)
		return nil, err
	}
	handshakeSpan, endHandshake := pm.lifecycleScope("plugin.Handshake", id, attribute.Bool("dev_mode", record.DevMode))
	if generation != "" {
		handshakeSpan.SetAttributes(attribute.String("generation", generation))
	}
	backend, createErr := pm.createBackend(id, metadata, location)
	if createErr == nil && backend != nil {
		handshakeSpan.SetAttributes(attribute.Int("protocol_version", backend.NegotiatedVersion()))
	}
	endHandshake(createErr)
	if createErr != nil {
		pm.storeFailedRecord(id, record, createErr)
		pm.observeManagedLifecycle(id, record.DevPath, generation, false, false, createErr)
		return nil, apperror.Wrap(
			createErr, apperror.TypePluginLoadFailed, http.StatusInternalServerError, "Failed to initialize plugin RPC",
		).WithInstance(id)
	}
	succeeded := false
	record.Backend = backend
	defer func() {
		if !succeeded {
			cleanupErr := pm.shutdownPlugin(id, record)
			resultErr = errors.Join(resultErr, cleanupErr)
			pm.storeFailedRecord(id, record, resultErr)
		}
	}()
	if err := pm.bindConnectionSharing(metadata, backend); err != nil {
		pm.storeFailedRecord(id, record, err)
		return nil, err
	}
	if err := pm.bindActivities(id, backend); err != nil {
		pm.storeFailedRecord(id, record, err)
		return nil, err
	}
	defer func() {
		if !succeeded {
			pm.retireConnectionSharing(id)
		}
	}()
	if err := pm.trackBackendPID(id, record.DevPath, backend); err != nil {
		pm.storeFailedRecord(id, record, err)
		pm.observeManagedLifecycle(id, record.DevPath, generation, false, false, err)
		return nil, err
	}
	if generation != "" {
		if err := verifyLifecycleRPC(backend, id); err != nil {
			pm.storeFailedRecord(id, record, err)
			pm.observeManagedLifecycle(id, record.DevPath, generation, false, false, err)
			return nil, err
		}
		pm.observeManagedLifecycle(id, record.DevPath, generation, true, false, nil)
	}

	if err := pm.initPlugin(record); err != nil {
		pm.storeFailedRecord(id, record, err)
		pm.observeManagedLifecycle(id, record.DevPath, generation, false, false, err)
		return nil, apperror.Wrap(
			err, apperror.TypePluginLoadFailed, http.StatusInternalServerError, "Failed to initialize plugin",
		).WithInstance(id)
	}

	if err := pm.startPlugin(record, backend, dependencyOwner); err != nil {
		pm.storeFailedRecord(id, record, err)
		pm.observeManagedLifecycle(id, record.DevPath, generation, false, false, err)
		return nil, apperror.Wrap(
			err, apperror.TypePluginLoadFailed, http.StatusInternalServerError, "Failed to start plugin",
		).WithInstance(id)
	}
	succeeded = true
	pm.observeManagedLifecycle(id, record.DevPath, generation, true, true, nil)
	return backend, nil
}

// validateForLoad validates the installed plugin at location before it is loaded.
// In dev mode only backend plugins need a binary (UI-only plugins are served by
// the Vite dev server); otherwise the full start validation runs.
func validateForLoad(id string, metadata config.PluginMeta, location string, isDevMode bool) error {
	if err := metadata.Validate(); err != nil {
		return apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusBadRequest,
			fmt.Sprintf("Plugin '%s' has invalid connection declarations", id)).WithInstance(id)
	}
	if isDevMode {
		if !metadata.HasBackendCapabilities() {
			return nil
		}
		if err := validateHasBinary(location); err != nil {
			return apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusInternalServerError,
				fmt.Sprintf("Plugin '%s' failed dev validation", id)).WithInstance(id)
		}
		return nil
	}
	if err := validateForStart(metadata, location); err != nil {
		return apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusInternalServerError,
			fmt.Sprintf("Plugin '%s' failed validation during loading", id)).WithInstance(id)
	}
	return nil
}

// storeFailedRecord marks record as failed with cause and stores it under id.
func (pm *pluginManager) storeFailedRecord(id string, record *plugintypes.PluginRecord, cause error) {
	pm.recordsMu.Lock()
	record.LastError = cause.Error()
	record.Phase = lifecycle.PhaseFailed
	pm.records[id] = record
	machine := record.StateMachine
	pm.recordsMu.Unlock()
	if machine != nil {
		machine.ForcePhase(lifecycle.PhaseFailed, cause.Error())
	}
}

// trackBackendPID records the PID of an external plugin process so it can be
// cleaned up as an orphan on next startup.
func (pm *pluginManager) trackBackendPID(id, source string, backend plugintypes.PluginBackend) error {
	eb, ok := backend.(*plugintypes.ExternalBackend)
	if !ok {
		return nil
	}
	rc := eb.ReattachConfig()
	if rc == nil {
		return fmt.Errorf("owned backend process identity unavailable")
	}
	env, err := instance.PluginEnvironment(pm.stateRoot.ResolvePath(""), id, os.Environ())
	if err != nil {
		return err
	}
	values := map[string]string{}
	for _, entry := range env {
		key, value, _ := strings.Cut(entry, "=")
		values[key] = value
	}
	if values["OMNIVIEW_WORKSPACE_ID"] == "" {
		return nil
	} // production has no workspace ownership identity
	if source == "" {
		source = pm.pluginsRoot.ResolvePath(id)
	}
	owner := devsession.ProcessOwner{WorkspaceID: values["OMNIVIEW_WORKSPACE_ID"], Generation: values["OMNIVIEW_GENERATION"], Role: "plugin-backend", Source: source}
	if err = pm.pidTracker.RecordOwned(id, rc.Pid, owner); err != nil {
		return err
	}
	return pm.pidTracker.Save()
}

// createBackend creates a PluginBackend for the given plugin.
// Uses backendFactory if set (for testing), otherwise creates a real go-plugin client.
func (pm *pluginManager) createBackend(
	id string,
	metadata config.PluginMeta,
	location string,
) (plugintypes.PluginBackend, error) {
	if entry, ok := pm.builtin(id); ok {
		ctx := pm.ctx
		if ctx == nil {
			ctx = context.Background()
		}
		backend, err := entry.NewBackend(ctx)
		if err != nil && backend != nil {
			err = errors.Join(err, backend.Stop())
			backend.Kill()
			return nil, err
		}
		if err == nil && backend == nil {
			err = errors.New("built-in factory returned nil backend")
		}
		return backend, err
	}
	if pm.backendFactory != nil {
		return pm.backendFactory(metadata, location)
	}

	// Build the hclog writer: always write to stdout, and additionally
	// persist to the plugin's rotated log file when the log manager is available.
	var logOutput io.Writer = os.Stdout
	if pm.pluginLogMgr != nil {
		logOutput = io.MultiWriter(os.Stdout, pm.pluginLogMgr.Stream(id))
	}

	binaryPath := filepath.Join(location, "bin", plugintypes.BinaryName())
	var snapshotCleanup func()
	defer func() {
		if snapshotCleanup != nil {
			snapshotCleanup()
		}
	}()
	// Installed metadata is untrusted input, not proof that a legacy executable
	// contains the fixed SDK. Only host-owned trusted build evidence can allow a
	// workspace backend to execute; verify a private snapshot before exec.
	if manifest := os.Getenv(devcontract.WorkspaceEnvironment); manifest != "" {
		workspace, err := devcontract.ResolveWorkspace(devcontract.ResolveOptions{
			EnvironmentManifest: manifest,
			StateRoot:           pm.stateRoot.ResolvePath(""),
		})
		if err != nil {
			return nil, err
		}
		prepared, cleanup, err := instance.PreparePluginArtifact(workspace, id, binaryPath)
		if err != nil {
			return nil, err
		}
		snapshotCleanup = cleanup
		binaryPath = prepared
	}
	//nolint:gosec // path selected from the verified installed artifact
	cmd := exec.CommandContext(context.Background(), binaryPath)
	childEnv, err := instance.PluginEnvironment(pm.stateRoot.ResolvePath(""), id, os.Environ())
	if err != nil {
		return nil, err
	}
	cmd.Env = pm.pluginProfilingEnvironment(childEnv)

	// Do not inherit OTLP credentials or exporter configuration into plugins.
	filtered := cmd.Env[:0]
	for _, entry := range cmd.Env {
		key, _, _ := strings.Cut(entry, "=")
		if strings.HasPrefix(key, "OMNIVIEW_TELEMETRY_") || strings.HasPrefix(key, "OTEL_EXPORTER_OTLP_") {
			continue
		}
		filtered = append(filtered, entry)
	}
	cmd.Env = filtered
	if pm.telemetryConfigFn != nil {
		cfg, configErr := pm.telemetryConfigFn(id)
		if configErr != nil {
			return nil, configErr
		}
		previousCleanup := snapshotCleanup
		snapshotCleanup = func() {
			if cfg.Cleanup != nil {
				cfg.Cleanup()
			}
			if previousCleanup != nil {
				previousCleanup()
			}
		}
		cmd.Env = append(cmd.Env, pluginTelemetryEnv(cfg)...)
	}

	pluginClient := goplugin.NewClient(&goplugin.ClientConfig{
		HandshakeConfig: metadata.GenerateHandshakeConfig(),
		VersionedPlugins: map[int]goplugin.PluginSet{
			1: {
				"resource":  &resourceplugin.GRPCPlugin{},
				"exec":      &ep.Plugin{Plugin: nil, Impl: nil},
				"networker": &np.Plugin{Plugin: nil, Impl: nil},
				"log":       &lp.Plugin{Plugin: nil, Impl: nil},
				"metric":    &mp.Plugin{Plugin: nil, Impl: nil},
				"settings":  &sp.SettingsPlugin{Plugin: nil, Impl: nil},
				"tools":     &tp.Plugin{Plugin: nil, Impl: nil},
				"lifecycle": &lc.Plugin{Plugin: nil, Impl: nil},
			},
		},
		// Reuse the process listener for callback services. Separate broker
		// listeners use the host's TMPDIR, whose profile-scoped path can exceed
		// Unix socket limits even when the plugin has a verified short socket root.
		// Activity and host-connection bindings complete sequentially before admission.
		GRPCBrokerMultiplex: true,
		GRPCDialOptions:     sdk.GRPCDialOptions(),
		Cmd:                 cmd,
		SkipHostEnv:         true,
		StartTimeout:        pluginStartTimeout,
		AllowedProtocols:    []goplugin.Protocol{goplugin.ProtocolGRPC},
		Logger: hclog.New(&hclog.LoggerOptions{
			Name:   id,
			Output: logOutput,
			Level:  hclog.Debug,
		}),
	})

	rpcClient, err := pluginClient.Client()
	if err != nil {
		// Client errors do not imply process exit. Kill waits for go-plugin's
		// runner before deferred cleanup may remove a Windows executable.
		pluginClient.Kill()
		return nil, err
	}

	backend := plugintypes.NewExternalBackend(pluginClient, rpcClient)
	backend.SetProcessCleanup(snapshotCleanup)
	snapshotCleanup = nil // lifecycle now owns cleanup until the process exits
	return backend, nil
}

// ReloadPlugin stops and re-loads a plugin.
func (pm *pluginManager) ReloadPlugin(id string) (_ plugintypes.PluginInfo, resultErr error) {
	started := time.Now()
	end := pm.lifecycleOp("plugin.Reload", id)
	defer func() {
		end(resultErr)
		if resultErr == nil {
			pm.logger.Infow(pm.lifecycleCtx(id), "plugin reloaded", "pluginID", id,
				"durationMs", time.Since(started).Milliseconds())
		} else {
			pm.logger.Errorw(pm.lifecycleCtx(id), "plugin reload failed", "pluginID", id,
				"errorClass", telemetryutil.ErrorClass(resultErr), "durationMs", time.Since(started).Milliseconds())
		}
	}()
	return pm.reloadPluginLocked(id)
}

func (pm *pluginManager) reloadPluginLocked(id string) (plugintypes.PluginInfo, error) {
	if err := pm.guardArchiveRecovery(id); err != nil {
		return plugintypes.PluginInfo{}, err
	}

	pm.recordsMu.RLock()
	record, ok := pm.records[id]
	var existing plugintypes.PluginStateRecord
	if ok {
		existing.ID = record.ID
		existing.Enabled = record.Enabled
		existing.DevMode = record.DevMode
		existing.DevPath = record.DevPath
		existing.ReleaseChannel = record.ReleaseChannel
	}
	pm.recordsMu.RUnlock()
	if !ok {
		return plugintypes.PluginInfo{}, apperror.New(apperror.TypePluginNotLoaded, http.StatusNotFound,
			"Plugin not loaded",
			fmt.Sprintf("Plugin '%s' is not currently loaded.", id)).WithInstance(id)
	}

	opts := &LoadPluginOptions{
		DevMode:       false,
		DevModePath:   "",
		ExistingState: &existing,
	}

	if err := pm.unloadPluginLocked(id); err != nil {
		return plugintypes.PluginInfo{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusInternalServerError,
			"Failed to unload plugin during reload").WithInstance(id)
	}
	return pm.loadPluginLocked(id, opts)
}

// RetryFailedPlugin resets the crash budget and reloads the plugin.
// Use this for user-initiated retries (e.g. the UI "Retry Plugin" button)
// so the plugin gets fresh recovery attempts. Do NOT use for automated
// crash recovery — use ReloadPlugin instead.
func (pm *pluginManager) RetryFailedPlugin(id string) (_ plugintypes.PluginInfo, resultErr error) {
	_, endRetry := pm.lifecycleScope("plugin.Retry", id)
	defer func() { endRetry(resultErr) }()
	if pm.healthChecker != nil {
		pm.healthChecker.CancelRecovery(id)
	}
	return pm.ReloadPlugin(id)
}

// UnloadPlugin unloads a plugin, stopping it if running.
// If the plugin is already unloaded, this is a no-op.
func (pm *pluginManager) UnloadPlugin(id string) (resultErr error) {
	end := pm.lifecycleOp("plugin.Unload", id)
	defer func() { end(resultErr) }()
	if err := pm.guardArchiveRecovery(id); err != nil {
		return err
	}
	return pm.unloadPluginLocked(id)
}

func (pm *pluginManager) unloadPluginLocked(id string) error {
	pm.recordsMu.RLock()
	record, ok := pm.records[id]
	if ok {
		snapshot := *record
		record = &snapshot
	}
	pm.recordsMu.RUnlock()
	if !ok {
		return nil // idempotent: not loaded = success
	}

	var cleanupErr error
	if record.Phase == lifecycle.PhaseRunning {
		cleanupErr = pm.stopPlugin(record)
	}
	cleanupErr = errors.Join(cleanupErr, pm.shutdownPlugin(id, record))
	if cleanupErr != nil {
		pm.storeFailedRecord(id, record, cleanupErr)
		return cleanupErr
	}
	pm.observeManagedLifecycle(id, record.DevPath, pm.managedRuntimeGeneration(id, record.DevPath), false, false, nil)

	pm.recordsMu.Lock()
	if record.Origin == "builtin" {
		record.Phase = lifecycle.PhaseStopped
		pm.records[id] = record
	} else {
		delete(pm.records, id)
	}
	pm.recordsMu.Unlock()
	if record.Origin == "builtin" {
		record.StateMachine.ForcePhase(record.Phase, "built-in unloaded")
	}
	return nil
}

// initPlugin initializes all plugin controllers.
func (pm *pluginManager) initPlugin(record *plugintypes.PluginRecord) (resultErr error) {
	if record == nil {
		return errors.New("record is nil")
	}
	_, endInit := pm.lifecycleScope("plugin.Init", record.ID)
	defer func() { endInit(resultErr) }()
	ctx := context.Background()
	pluginID := record.ID

	for name, manager := range pm.managers {
		if err := manager.OnPluginInit(ctx, pluginID, record.Metadata); err != nil {
			return fmt.Errorf("initialize plugin manager %s: %w", name, err)
		}
	}

	if ctrl := pm.connlessControllers[sdktypes.CapabilitySettings]; ctrl != nil {
		ctrl.OnPluginInit(pluginID, record.Metadata)
	}

	for cap, ctrl := range pm.connfullControllers {
		if ctrl == nil || cap == sdktypes.CapabilitySettings {
			continue
		}
		ctrl.OnPluginInit(pluginID, record.Metadata)
	}
	for cap, ctrl := range pm.connlessControllers {
		if ctrl == nil || cap == sdktypes.CapabilitySettings {
			continue
		}
		ctrl.OnPluginInit(pluginID, record.Metadata)
	}

	return nil
}

// startPlugin starts all plugin controllers using lifecycle-based capability detection.
func (pm *pluginManager) startPlugin(record *plugintypes.PluginRecord, backend plugintypes.PluginBackend, dependencyOwner ...bool) (resultErr error) {
	if record == nil {
		return errors.New("record is nil")
	}
	startSpan, endStartSpan := pm.lifecycleScope("plugin.StartPlugin", record.ID)
	defer func() {
		startSpan.SetAttributes(attribute.String("capabilities", lifecycleCapabilityList(record.Capabilities)))
		endStartSpan(resultErr)
	}()

	ctx := context.Background()
	pluginID := record.ID
	// Retire the previous process advertisement before any replacement startup
	// can fail, including capability detection and manager initialization.
	if ctrl := pm.connlessControllers[sdktypes.CapabilityTools]; ctrl != nil {
		if err := ctrl.OnPluginStop(pluginID, record.Metadata); err != nil {
			return fmt.Errorf("retire previous tools controller: %w", err)
		}
	}
	var started []plugintypes.LifecycleController
	committed := false
	defer func() {
		if !committed {
			for i := len(started) - 1; i >= 0; i-- {
				resultErr = errors.Join(resultErr, started[i].OnPluginStop(pluginID, record.Metadata))
			}
		}
	}()

	// Record the negotiated SDK protocol version.
	version := backend.NegotiatedVersion()
	record.ProtocolVersion = version
	if version < plugintypes.CurrentProtocolVersion {
		pm.logger.Warnw(ctx, "plugin uses deprecated SDK protocol version",
			"pluginID", pluginID, "version", version,
			"current", plugintypes.CurrentProtocolVersion)
		pm.emitter.Emit(EventDeprecatedProtocol, DeprecatedProtocolPayload{
			PluginID:       pluginID,
			Version:        version,
			CurrentVersion: plugintypes.CurrentProtocolVersion,
		})
	}

	for name, manager := range pm.managers {
		if err := manager.OnPluginStart(ctx, pluginID, record.Metadata); err != nil {
			return fmt.Errorf("start plugin manager %s: %w", name, err)
		}
	}

	// Detect capabilities via the backend.
	var detectedCaps []sdktypes.Capability
	if detector, ok := backend.(plugintypes.CapabilityDetector); ok {
		capStrings, err := detector.DetectCapabilities()
		if err != nil {
			return fmt.Errorf("detect plugin capabilities: %w", err)
		} else {
			detectedCaps = capStringsToCapabilities(capStrings)
		}
	}

	record.Capabilities = detectedCaps
	// Settings hydration must precede other declared providers, but settings is
	// optional like every other capability. Never dispense an undeclared provider.
	for _, capability := range detectedCaps {
		if capability != sdktypes.CapabilitySettings {
			continue
		}
		if ctrl := pm.connlessControllers[sdktypes.CapabilitySettings]; ctrl != nil {
			started = append(started, ctrl)
			if err := ctrl.OnPluginStart(pluginID, record.Metadata, backend); err != nil {
				return fmt.Errorf("start settings controller: %w", err)
			}
		}
		break
	}

	// Start controllers for detected capabilities.
	for _, cap := range detectedCaps {
		if cap == sdktypes.CapabilitySettings {
			continue
		}
		ctrl := pm.controllerFor(cap)
		if ctrl == nil {
			continue
		}
		started = append(started, ctrl)
		if cap == sdktypes.CapabilityResource && len(dependencyOwner) != 0 && dependencyOwner[0] {
			if noAuto, ok := ctrl.(interface {
				OnPluginStartWithoutAutoConnect(string, config.PluginMeta, plugintypes.PluginBackend) error
			}); ok {
				if err := noAuto.OnPluginStartWithoutAutoConnect(pluginID, record.Metadata, backend); err != nil {
					return fmt.Errorf("start %s controller: %w", cap.String(), err)
				}
				continue
			}
			return fmt.Errorf("resource controller cannot suppress dependency auto-connect")
		}
		if err := ctrl.OnPluginStart(pluginID, record.Metadata, backend); err != nil {
			return fmt.Errorf("start %s controller: %w", cap.String(), err)
		}
	}

	pm.logger.Infow(ctx, "detected plugin capabilities",
		"pluginID", record.Metadata.ID,
		"capabilities", record.Capabilities,
	)

	committed = true
	return nil
}

// capStringsToCapabilities converts raw capability strings to Capability values.
func capStringsToCapabilities(caps []string) []sdktypes.Capability {
	var result []sdktypes.Capability
	for _, capStr := range caps {
		c, ok := sdktypes.ParseCapability(capStr)
		if !ok {
			continue
		}
		result = append(result, c)
	}
	return result
}

// stopPlugin stops all plugin controllers.
func (pm *pluginManager) stopPlugin(record *plugintypes.PluginRecord) error {
	if record == nil {
		return errors.New("record is nil")
	}

	ctx := context.Background()
	pluginID := record.ID
	pm.retireConnectionSharing(pluginID)
	pm.retireActivities(pluginID)

	var errs []error
	for name, manager := range pm.managers {
		if err := manager.OnPluginStop(ctx, pluginID, record.Metadata); err != nil {
			errs = append(errs, fmt.Errorf("stop plugin manager %s: %w", name, err))
		}
	}
	if ctrl := pm.connlessControllers[sdktypes.CapabilitySettings]; ctrl != nil {
		if err := ctrl.OnPluginStop(pluginID, record.Metadata); err != nil {
			errs = append(errs, fmt.Errorf("stop settings: %w", err))
		}
	}
	for _, cap := range record.Capabilities {
		if cap == sdktypes.CapabilitySettings {
			continue
		}
		if ctrl := pm.controllerFor(cap); ctrl != nil {
			if err := ctrl.OnPluginStop(pluginID, record.Metadata); err != nil {
				errs = append(errs, fmt.Errorf("stop %s: %w", cap, err))
			}
		}
	}

	return errors.Join(errs...)
}

// shutdownPlugin shuts down the plugin process and controllers.
func (pm *pluginManager) shutdownPlugin(pluginID string, record *plugintypes.PluginRecord) error {
	if record == nil {
		return errors.New("record is nil")
	}
	pm.retireConnectionSharing(pluginID)
	pm.retireActivities(pluginID)

	ctx := context.Background()
	shutdownStarted := time.Now()
	_, endShutdown := pm.lifecycleScope("plugin.Shutdown", pluginID)

	var errs []error
	for name, manager := range pm.managers {
		if err := manager.OnPluginShutdown(ctx, pluginID, record.Metadata); err != nil {
			errs = append(errs, fmt.Errorf("shutdown manager %s: %w", name, err))
		}
	}
	// Initialization registers every controller, even when startup fails before
	// capability negotiation. Retire all registrations, resource admission first.
	for cap, ctrl := range pm.connfullControllers {
		if ctrl == nil {
			continue
		}
		if err := ctrl.OnPluginShutdown(pluginID, record.Metadata); err != nil {
			errs = append(errs, fmt.Errorf("shutdown %s: %w", cap, err))
		}
	}
	for cap, ctrl := range pm.connlessControllers {
		if cap == sdktypes.CapabilitySettings || ctrl == nil {
			continue
		}
		if err := ctrl.OnPluginShutdown(pluginID, record.Metadata); err != nil {
			errs = append(errs, fmt.Errorf("shutdown %s: %w", cap, err))
		}
	}
	if ctrl := pm.connlessControllers[sdktypes.CapabilitySettings]; ctrl != nil {
		if err := ctrl.OnPluginShutdown(pluginID, record.Metadata); err != nil {
			errs = append(errs, fmt.Errorf("shutdown settings: %w", err))
		}
	}
	errs = append(errs, pm.shutdownBackend(ctx, pluginID, record))
	result := errors.Join(errs...)
	phase := lifecycle.PhaseStopped
	detail := ""
	if result != nil {
		phase = lifecycle.PhaseFailed
		detail = result.Error()
	}
	pm.recordsMu.Lock()
	record.Phase = phase
	record.LastError = detail
	record.Backend = nil
	machine := record.StateMachine
	pm.recordsMu.Unlock()
	if machine != nil {
		machine.ForcePhase(phase, detail)
	}
	endShutdown(result)
	if result != nil {
		pm.logger.Warnw(ctx, "plugin shutdown failed", "pluginID", pluginID,
			"errorClass", telemetryutil.ErrorClass(result), "durationMs", time.Since(shutdownStarted).Milliseconds())
	} else {
		pm.logger.Infow(ctx, "plugin stopped", "pluginID", pluginID,
			"durationMs", time.Since(shutdownStarted).Milliseconds())
	}
	return result
}

// shutdownBackend releases aggregate resources after capability retirement.
func (pm *pluginManager) shutdownBackend(ctx context.Context, pluginID string, record *plugintypes.PluginRecord) error {
	pm.recordsMu.RLock()
	backend := record.Backend
	pm.recordsMu.RUnlock()
	var stopErr error
	if backend != nil {
		stopErr = backend.Stop()
		if stopErr != nil {
			pm.logger.Debugw(ctx, "plugin backend stop reported an error", "pluginID", pluginID,
				"errorClass", telemetryutil.ErrorClass(stopErr))
		}
		backend.Kill()
	}
	if pm.pidTracker != nil {
		pm.pidTracker.Remove(pluginID)
		stopErr = errors.Join(stopErr, pm.pidTracker.Save())
	}
	return stopErr
}

// controllerFor returns the controller registered for capability c, or nil.
// Resource controllers are connection-full; all others are connection-less.
func (pm *pluginManager) controllerFor(c sdktypes.Capability) plugintypes.LifecycleController {
	if c == sdktypes.CapabilityResource {
		return pm.connfullControllers[c]
	}
	return pm.connlessControllers[c]
}

// pluginTelemetryEnv returns the OMNIVIEW_TELEMETRY_* environment entries for a
// plugin process. OMNIVIEW_PLUGIN_LOG_LEVEL is added only when a level is set.
func pluginTelemetryEnv(cfg TelemetryEnvConfig) []string {
	env := []string{
		"OMNIVIEW_TELEMETRY_ENABLED=" + strconv.FormatBool(cfg.Enabled),
		"OMNIVIEW_TELEMETRY_OTLP_ENDPOINT=" + cfg.OTLPEndpoint,
		"OMNIVIEW_TELEMETRY_AUTH_HEADER=Authorization",
		"OMNIVIEW_TELEMETRY_AUTH_VALUE=" + cfg.AuthToken,
		"OMNIVIEW_TELEMETRY_CLIENT_ID=" + cfg.ClientID,
		"OMNIVIEW_TELEMETRY_PROFILING=" + strconv.FormatBool(cfg.Profiling),
		"OMNIVIEW_TELEMETRY_PYROSCOPE_ENDPOINT=" + cfg.PyroscopeEndpoint,
	}
	if cfg.LogLevel != "" {
		env = append(env, "OMNIVIEW_PLUGIN_LOG_LEVEL="+cfg.LogLevel)
	}
	return env
}
