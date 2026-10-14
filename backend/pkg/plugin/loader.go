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
	"time"

	"github.com/hashicorp/go-hclog"
	goplugin "github.com/hashicorp/go-plugin"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	logging "github.com/omniviewdev/plugin-sdk/log"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
	ep "github.com/omniviewdev/plugin-sdk/pkg/v1/exec"
	lc "github.com/omniviewdev/plugin-sdk/pkg/v1/lifecycle"
	lp "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	mp "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
	np "github.com/omniviewdev/plugin-sdk/pkg/v1/networker"
	rpv1 "github.com/omniviewdev/plugin-sdk/pkg/v1/resource/plugin"
	sp "github.com/omniviewdev/plugin-sdk/pkg/v1/settings"
)

// pluginStartTimeout bounds how long a plugin process may take to start, so
// broken plugins don't block startup (go-plugin's default is 60s).
const pluginStartTimeout = 15 * time.Second

// LoadPluginOptions configures how a plugin is loaded.
type LoadPluginOptions struct {
	DevMode       bool
	DevModePath   string
	ExistingState *plugintypes.PluginStateRecord
}

// LoadPlugin loads a plugin from its installation directory.
// If the plugin is already loaded and running, this is a no-op.
func (pm *pluginManager) LoadPlugin(id string, opts *LoadPluginOptions) (sdktypes.PluginInfo, error) {
	opsMu := pm.pluginOpsLock(id)
	opsMu.Lock()
	defer opsMu.Unlock()
	return pm.loadPluginLocked(id, opts)
}

func (pm *pluginManager) loadPluginLocked(id string, opts *LoadPluginOptions) (sdktypes.PluginInfo, error) {
	log := pm.logger.Named("LoadPlugin").With(logging.Any("id", id), logging.Any("opts", opts))

	// Idempotent: if already loaded and running, return existing.
	pm.recordsMu.RLock()
	if existing, ok := pm.records[id]; ok {
		if existing.Phase == lifecycle.PhaseRunning {
			log.Debugw(pm.ctx, "plugin already loaded and running, skipping", "pluginID", id)
			info := existing.ToInfo()
			pm.recordsMu.RUnlock()
			return info, nil
		}
		if existing.Phase == lifecycle.PhaseStarting {
			pm.recordsMu.RUnlock()
			return sdktypes.PluginInfo{}, apperror.New(apperror.TypePluginLoadFailed, http.StatusConflict,
				"Plugin is starting", fmt.Sprintf("Plugin '%s' is currently starting.", id)).WithInstance(id)
		}
	}
	pm.recordsMu.RUnlock()

	// Remove stale entry under write lock.
	pm.recordsMu.Lock()
	delete(pm.records, id)
	pm.recordsMu.Unlock()

	location := pm.pluginsRoot.ResolvePath(id)
	log.Debugw(pm.ctx, "loading plugin from location", "location", location, "pluginID", id)

	if _, err := os.Stat(location); os.IsNotExist(err) {
		return sdktypes.PluginInfo{}, apperror.PluginNotFound(id)
	}

	metadata, err := sdktypes.LoadPluginMetadata(location)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return sdktypes.PluginInfo{}, apperror.New(apperror.TypePluginLoadFailed, http.StatusNotFound,
				"Plugin metadata missing",
				fmt.Sprintf("Plugin '%s' is missing its metadata file (plugin.yaml).", id)).
				WithInstance(id)
		}
		return sdktypes.PluginInfo{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusInternalServerError,
			fmt.Sprintf("Failed to load metadata for plugin '%s'", id)).
			WithInstance(id)
	}

	// Validate based on mode.
	isDevMode := (opts != nil && opts.DevMode) ||
		(opts != nil && opts.ExistingState != nil && opts.ExistingState.DevMode)

	if err = validateForLoad(id, metadata, location, isDevMode); err != nil {
		return sdktypes.PluginInfo{}, err
	}

	// Build the record directly.
	record := newLoadRecord(id, metadata, opts)

	pm.logger.Debugw(pm.ctx, "found metadata",
		"metadata", metadata,
		"hasBackendCapabilities", metadata.HasBackendCapabilities(),
		"hasUiCapabilities", metadata.HasUICapabilities(),
	)

	var backend plugintypes.PluginBackend

	if metadata.HasBackendCapabilities() {
		backend, err = pm.startBackend(id, record, metadata, location)
		if err != nil {
			return sdktypes.PluginInfo{}, err
		}
	}

	record.Phase = lifecycle.PhaseRunning
	record.Backend = backend
	pm.recordsMu.Lock()
	pm.records[id] = record
	pm.recordsMu.Unlock()

	// Sync the state machine to Running.
	if record.StateMachine != nil {
		record.StateMachine.ForcePhase(lifecycle.PhaseRunning, "plugin loaded successfully")
		pm.registerStateObserver(record.StateMachine)
	}

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
) (plugintypes.PluginBackend, error) {
	backend, createErr := pm.createBackend(id, metadata, location)
	if createErr != nil {
		pm.storeFailedRecord(id, record, createErr)
		return nil, apperror.Wrap(
			createErr, apperror.TypePluginLoadFailed, http.StatusInternalServerError, "Failed to initialize plugin RPC",
		).WithInstance(id)
	}

	// Track the plugin process PID for orphan cleanup on next startup.
	pm.trackBackendPID(id, backend)

	if err := pm.initPlugin(record); err != nil {
		pm.storeFailedRecord(id, record, err)
		return nil, apperror.Wrap(
			err, apperror.TypePluginLoadFailed, http.StatusInternalServerError, "Failed to initialize plugin",
		).WithInstance(id)
	}

	if err := pm.startPlugin(record, backend); err != nil {
		pm.storeFailedRecord(id, record, err)
		return nil, apperror.Wrap(
			err, apperror.TypePluginLoadFailed, http.StatusInternalServerError, "Failed to start plugin",
		).WithInstance(id)
	}
	return backend, nil
}

// validateForLoad validates the installed plugin at location before it is loaded.
// In dev mode only backend plugins need a binary (UI-only plugins are served by
// the Vite dev server); otherwise the full start validation runs.
func validateForLoad(id string, metadata config.PluginMeta, location string, isDevMode bool) error {
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
	record.LastError = cause.Error()
	record.Phase = lifecycle.PhaseFailed
	if record.StateMachine != nil {
		record.StateMachine.ForcePhase(lifecycle.PhaseFailed, cause.Error())
	}
	pm.recordsMu.Lock()
	pm.records[id] = record
	pm.recordsMu.Unlock()
}

// trackBackendPID records the PID of an external plugin process so it can be
// cleaned up as an orphan on next startup.
func (pm *pluginManager) trackBackendPID(id string, backend plugintypes.PluginBackend) {
	if eb, ok := backend.(*plugintypes.ExternalBackend); ok {
		if rc := eb.ReattachConfig(); rc != nil {
			pm.pidTracker.Record(id, rc.Pid)
		}
	}
}

// createBackend creates a PluginBackend for the given plugin.
// Uses backendFactory if set (for testing), otherwise creates a real go-plugin client.
func (pm *pluginManager) createBackend(
	id string,
	metadata config.PluginMeta,
	location string,
) (plugintypes.PluginBackend, error) {
	if pm.backendFactory != nil {
		return pm.backendFactory(metadata, location)
	}

	// Build the hclog writer: always write to stdout, and additionally
	// persist to the plugin's rotated log file when the log manager is available.
	var logOutput io.Writer = os.Stdout
	if pm.pluginLogMgr != nil {
		logOutput = io.MultiWriter(os.Stdout, pm.pluginLogMgr.Stream(id))
	}

	//nolint:gosec // this is completely software controlled
	cmd := exec.CommandContext(context.Background(), filepath.Join(location, "bin", "plugin"))

	// Inject telemetry env vars if config function is available.
	if pm.telemetryConfigFn != nil {
		cfg := pm.telemetryConfigFn()
		cmd.Env = append(os.Environ(),
			"OMNIVIEW_TELEMETRY_ENABLED="+strconv.FormatBool(cfg.Enabled),
			"OMNIVIEW_TELEMETRY_OTLP_ENDPOINT="+cfg.OTLPEndpoint,
			"OMNIVIEW_TELEMETRY_PROFILING="+strconv.FormatBool(cfg.Profiling),
			"OMNIVIEW_TELEMETRY_PYROSCOPE_ENDPOINT="+cfg.PyroscopeEndpoint,
			"OMNIVIEW_PLUGIN_ID="+id,
		)
	}

	pluginClient := goplugin.NewClient(&goplugin.ClientConfig{
		HandshakeConfig: metadata.GenerateHandshakeConfig(),
		VersionedPlugins: map[int]goplugin.PluginSet{
			1: {
				"resource":  &rpv1.GRPCPlugin{Plugin: nil, Impl: nil, SettingsProvider: nil},
				"exec":      &ep.Plugin{Plugin: nil, Impl: nil},
				"networker": &np.Plugin{Plugin: nil, Impl: nil},
				"log":       &lp.Plugin{Plugin: nil, Impl: nil},
				"metric":    &mp.Plugin{Plugin: nil, Impl: nil},
				"settings":  &sp.SettingsPlugin{Plugin: nil, Impl: nil},
				"lifecycle": &lc.Plugin{Plugin: nil, Impl: nil},
			},
		},
		GRPCDialOptions:  sdk.GRPCDialOptions(),
		Cmd:              cmd,
		StartTimeout:     pluginStartTimeout,
		AllowedProtocols: []goplugin.Protocol{goplugin.ProtocolGRPC},
		Logger: hclog.New(&hclog.LoggerOptions{
			Name:   id,
			Output: logOutput,
			Level:  hclog.Debug,
		}),
	})

	rpcClient, err := pluginClient.Client()
	if err != nil {
		return nil, err
	}

	return plugintypes.NewExternalBackend(pluginClient, rpcClient), nil
}

// ReloadPlugin stops and re-loads a plugin.
func (pm *pluginManager) ReloadPlugin(id string) (sdktypes.PluginInfo, error) {
	opsMu := pm.pluginOpsLock(id)
	opsMu.Lock()
	defer opsMu.Unlock()

	pm.recordsMu.RLock()
	record, ok := pm.records[id]
	pm.recordsMu.RUnlock()
	if !ok {
		return sdktypes.PluginInfo{}, apperror.New(apperror.TypePluginNotLoaded, http.StatusNotFound,
			"Plugin not loaded",
			fmt.Sprintf("Plugin '%s' is not currently loaded.", id)).WithInstance(id)
	}

	// Build reload opts from the current record state.
	// Only ID, Enabled, DevMode and DevPath carry over; the rest stays zero.
	var existing plugintypes.PluginStateRecord
	existing.ID = record.ID
	existing.Enabled = record.Enabled
	existing.DevMode = record.DevMode
	existing.DevPath = record.DevPath
	opts := &LoadPluginOptions{
		DevMode:       false,
		DevModePath:   "",
		ExistingState: &existing,
	}

	if err := pm.unloadPluginLocked(id); err != nil {
		return sdktypes.PluginInfo{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, http.StatusInternalServerError,
			"Failed to unload plugin during reload").WithInstance(id)
	}
	return pm.loadPluginLocked(id, opts)
}

// RetryFailedPlugin resets the crash budget and reloads the plugin.
// Use this for user-initiated retries (e.g. the UI "Retry Plugin" button)
// so the plugin gets fresh recovery attempts. Do NOT use for automated
// crash recovery — use ReloadPlugin instead.
func (pm *pluginManager) RetryFailedPlugin(id string) (sdktypes.PluginInfo, error) {
	if pm.healthChecker != nil {
		pm.healthChecker.CancelRecovery(id)
	}
	return pm.ReloadPlugin(id)
}

// UnloadPlugin unloads a plugin, stopping it if running.
// If the plugin is already unloaded, this is a no-op.
func (pm *pluginManager) UnloadPlugin(id string) error {
	opsMu := pm.pluginOpsLock(id)
	opsMu.Lock()
	defer opsMu.Unlock()
	return pm.unloadPluginLocked(id)
}

func (pm *pluginManager) unloadPluginLocked(id string) error {
	pm.recordsMu.RLock()
	record, ok := pm.records[id]
	pm.recordsMu.RUnlock()
	if !ok {
		return nil // idempotent: not loaded = success
	}

	if record.Phase == lifecycle.PhaseRunning {
		if err := pm.stopPlugin(record); err != nil {
			return fmt.Errorf("error stopping plugin: %w", err)
		}
	}

	if err := pm.shutdownPlugin(id, record); err != nil {
		return fmt.Errorf("error shutting down plugin: %w", err)
	}

	pm.recordsMu.Lock()
	delete(pm.records, id)
	pm.recordsMu.Unlock()
	return nil
}

// initPlugin initializes all plugin controllers.
func (pm *pluginManager) initPlugin(record *plugintypes.PluginRecord) error {
	if record == nil {
		return errors.New("record is nil")
	}

	ctx := context.Background()
	pluginID := record.ID

	for name, manager := range pm.managers {
		if err := manager.OnPluginInit(ctx, pluginID, record.Metadata); err != nil {
			pm.logger.Errorw(ctx, "error invoking init for plugin manager",
				"manager", name, "pluginID", record.Metadata.ID, "error", err)
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
func (pm *pluginManager) startPlugin(record *plugintypes.PluginRecord, backend plugintypes.PluginBackend) error {
	if record == nil {
		return errors.New("record is nil")
	}

	ctx := context.Background()
	pluginID := record.ID

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
			pm.logger.Errorw(ctx, "error invoking start for plugin manager",
				"manager", name, "pluginID", record.Metadata.ID, "error", err)
		}
	}

	if ctrl := pm.connlessControllers[sdktypes.CapabilitySettings]; ctrl != nil {
		if err := ctrl.OnPluginStart(pluginID, record.Metadata, backend); err != nil {
			return fmt.Errorf("error starting settings plugin: %w", err)
		}
	}

	// Detect capabilities via the backend.
	var detectedCaps []sdktypes.Capability
	if detector, ok := backend.(plugintypes.CapabilityDetector); ok {
		capStrings, err := detector.DetectCapabilities()
		if err != nil {
			pm.logger.Debugw(ctx, "capability detection failed", "pluginID", pluginID, "error", err)
		} else {
			detectedCaps = capStringsToCapabilities(capStrings)
		}
	}

	record.Capabilities = detectedCaps

	// Start controllers for detected capabilities.
	for _, cap := range detectedCaps {
		if cap == sdktypes.CapabilitySettings {
			continue // already handled above
		}
		ctrl := pm.controllerFor(cap)
		if ctrl == nil {
			continue
		}
		if err := ctrl.OnPluginStart(pluginID, record.Metadata, backend); err != nil {
			pm.logger.Warnw(ctx, "failed to start capability controller",
				"pluginID", pluginID, "capability", cap.String(), "error", err)
			continue
		}
	}

	pm.logger.Infow(ctx, "detected plugin capabilities",
		"pluginID", record.Metadata.ID,
		"capabilities", record.Capabilities,
	)

	return nil
}

// capStringsToCapabilities converts raw capability strings to Capability values.
func capStringsToCapabilities(caps []string) []sdktypes.Capability {
	var result []sdktypes.Capability
	for _, capStr := range caps {
		c, ok := sdktypes.ParseCapability(capStr)
		if !ok || c == sdktypes.CapabilitySettings {
			// settings is always registered separately, skip
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

	for name, manager := range pm.managers {
		if err := manager.OnPluginStop(ctx, pluginID, record.Metadata); err != nil {
			pm.logger.Errorw(ctx, "error invoking stop for plugin manager",
				"manager", name, "pluginID", record.Metadata.ID, "error", err)
		}
	}

	if ctrl := pm.connlessControllers[sdktypes.CapabilitySettings]; ctrl != nil {
		if err := ctrl.OnPluginStop(pluginID, record.Metadata); err != nil {
			return fmt.Errorf("error stopping settings plugin: %w", err)
		}
	}

	for _, cap := range record.Capabilities {
		if cap == sdktypes.CapabilitySettings {
			continue // already handled above
		}
		ctrl := pm.controllerFor(cap)
		if ctrl == nil {
			continue
		}
		if err := ctrl.OnPluginStop(pluginID, record.Metadata); err != nil {
			return fmt.Errorf("error stopping %s plugin: %w", cap, err)
		}
	}

	return nil
}

// shutdownPlugin shuts down the plugin process and controllers.
func (pm *pluginManager) shutdownPlugin(pluginID string, record *plugintypes.PluginRecord) error {
	if record == nil {
		return errors.New("record is nil")
	}

	ctx := context.Background()

	for name, manager := range pm.managers {
		if err := manager.OnPluginShutdown(ctx, pluginID, record.Metadata); err != nil {
			pm.logger.Errorw(ctx, "error invoking shutdown for plugin manager",
				"manager", name, "pluginID", record.Metadata.ID, "error", err)
		}
	}

	if record.Metadata.HasBackendCapabilities() {
		if err := pm.shutdownBackend(ctx, pluginID, record); err != nil {
			return err
		}
	}

	for _, cap := range record.Capabilities {
		if cap == sdktypes.CapabilitySettings {
			continue // already handled above
		}
		ctrl := pm.controllerFor(cap)
		if ctrl == nil {
			continue
		}
		if err := ctrl.OnPluginShutdown(pluginID, record.Metadata); err != nil {
			return fmt.Errorf("error shutting down %s plugin: %w", cap, err)
		}
	}
	return nil
}

// shutdownBackend stops and kills the plugin's backend process, forgets its PID
// and shuts down its settings controller.
func (pm *pluginManager) shutdownBackend(ctx context.Context, pluginID string, record *plugintypes.PluginRecord) error {
	if record.Backend != nil {
		if err := record.Backend.Stop(); err != nil {
			pm.logger.Warnw(ctx, "error closing plugin backend", "pluginID", pluginID, "error", err)
		}
		record.Backend.Kill()
	}
	pm.pidTracker.Remove(pluginID)

	if ctrl := pm.connlessControllers[sdktypes.CapabilitySettings]; ctrl != nil {
		if err := ctrl.OnPluginShutdown(pluginID, record.Metadata); err != nil {
			return fmt.Errorf("error shutting down settings plugin: %w", err)
		}
	}
	return nil
}

// controllerFor returns the controller registered for capability c, or nil.
// Resource controllers are connection-full; all others are connection-less.
func (pm *pluginManager) controllerFor(c sdktypes.Capability) plugintypes.Controller {
	if c == sdktypes.CapabilityResource {
		return pm.connfullControllers[c]
	}
	return pm.connlessControllers[c]
}
