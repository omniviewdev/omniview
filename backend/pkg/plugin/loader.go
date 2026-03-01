package plugin

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/hashicorp/go-hclog"
	goplugin "github.com/hashicorp/go-plugin"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/lifecycle"
	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"

	"github.com/omniviewdev/plugin-sdk/pkg/config"
	ep "github.com/omniviewdev/plugin-sdk/pkg/exec"
	lc "github.com/omniviewdev/plugin-sdk/pkg/lifecycle"
	lp "github.com/omniviewdev/plugin-sdk/pkg/logs"
	mp "github.com/omniviewdev/plugin-sdk/pkg/metric"
	np "github.com/omniviewdev/plugin-sdk/pkg/networker"
	rpv1 "github.com/omniviewdev/plugin-sdk/pkg/v1/resource/plugin"
	"github.com/omniviewdev/plugin-sdk/pkg/sdk"
	sp "github.com/omniviewdev/plugin-sdk/pkg/settings"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

// LoadPluginOptions configures how a plugin is loaded.
type LoadPluginOptions struct {
	DevMode       bool
	DevModePath   string
	ExistingState *plugintypes.PluginStateRecord
}

// LoadPlugin loads a plugin from its installation directory.
// If the plugin is already loaded and running, this is a no-op.
func (pm *pluginManager) LoadPlugin(id string, opts *LoadPluginOptions) (sdktypes.PluginInfo, error) {
	log := pm.logger.Named("LoadPlugin").With("id", id, "opts", opts)

	// Idempotent: if already loaded and running, return existing.
	pm.recordsMu.RLock()
	if existing, ok := pm.records[id]; ok {
		if existing.Phase == lifecycle.PhaseRunning {
			log.Debugw("plugin already loaded and running, skipping", "pluginID", id)
			info := existing.ToInfo()
			pm.recordsMu.RUnlock()
			return info, nil
		}
		if existing.Phase == lifecycle.PhaseStarting {
			pm.recordsMu.RUnlock()
			return sdktypes.PluginInfo{}, apperror.New(apperror.TypePluginLoadFailed, 409,
				"Plugin is starting", fmt.Sprintf("Plugin '%s' is currently starting.", id)).WithInstance(id)
		}
	}
	pm.recordsMu.RUnlock()

	// Remove stale entry under write lock.
	pm.recordsMu.Lock()
	delete(pm.records, id)
	pm.recordsMu.Unlock()

	location := getPluginLocation(id)
	log.Debugw("loading plugin from location", "location", location, "pluginID", id)

	if _, err := os.Stat(location); os.IsNotExist(err) {
		return sdktypes.PluginInfo{}, apperror.PluginNotFound(id)
	}

	metadata, err := sdktypes.LoadPluginMetadata(location)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return sdktypes.PluginInfo{}, apperror.New(apperror.TypePluginLoadFailed, 404,
				"Plugin metadata missing",
				fmt.Sprintf("Plugin '%s' is missing its metadata file (plugin.yaml).", id)).
				WithInstance(id)
		}
		return sdktypes.PluginInfo{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500,
			fmt.Sprintf("Failed to load metadata for plugin '%s'", id)).
			WithInstance(id)
	}

	// Validate based on mode.
	isDevMode := (opts != nil && opts.DevMode) ||
		(opts != nil && opts.ExistingState != nil && opts.ExistingState.DevMode)

	if isDevMode {
		if err = validateHasBinary(location); err != nil {
			return sdktypes.PluginInfo{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500,
				fmt.Sprintf("Plugin '%s' failed dev validation", id)).WithInstance(id)
		}
	} else {
		if err = validateForStart(metadata, location); err != nil {
			return sdktypes.PluginInfo{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500,
				fmt.Sprintf("Plugin '%s' failed validation during loading", id)).WithInstance(id)
		}
	}

	// Build the record directly.
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

	pm.logger.Debugw("found metadata",
		"metadata", metadata,
		"hasBackendCapabilities", metadata.HasBackendCapabilities(),
		"hasUiCapabilities", metadata.HasUICapabilities(),
	)

	var backend plugintypes.PluginBackend

	if metadata.HasBackendCapabilities() {
		var createErr error
		backend, createErr = pm.createBackend(id, metadata, location)
		if createErr != nil {
			record.LastError = createErr.Error()
			record.Phase = lifecycle.PhaseFailed
			if record.StateMachine != nil {
				record.StateMachine.ForcePhase(lifecycle.PhaseFailed, createErr.Error())
			}
			pm.recordsMu.Lock()
			pm.records[id] = record
			pm.recordsMu.Unlock()
			return sdktypes.PluginInfo{}, apperror.Wrap(createErr, apperror.TypePluginLoadFailed, 500,
				"Failed to initialize plugin RPC").WithInstance(id)
		}

		// Track the plugin process PID for orphan cleanup on next startup.
		if eb, ok := backend.(*plugintypes.ExternalBackend); ok {
			if rc := eb.ReattachConfig(); rc != nil {
				pm.pidTracker.Record(id, rc.Pid)
			}
		}

		if err = pm.initPlugin(record); err != nil {
			record.LastError = err.Error()
			record.Phase = lifecycle.PhaseFailed
			if record.StateMachine != nil {
				record.StateMachine.ForcePhase(lifecycle.PhaseFailed, err.Error())
			}
			pm.recordsMu.Lock()
			pm.records[id] = record
			pm.recordsMu.Unlock()
			return sdktypes.PluginInfo{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500, "Failed to initialize plugin").WithInstance(id)
		}

		if err = pm.startPlugin(record, backend); err != nil {
			record.LastError = err.Error()
			record.Phase = lifecycle.PhaseFailed
			if record.StateMachine != nil {
				record.StateMachine.ForcePhase(lifecycle.PhaseFailed, err.Error())
			}
			pm.recordsMu.Lock()
			pm.records[id] = record
			pm.recordsMu.Unlock()
			return sdktypes.PluginInfo{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500, "Failed to start plugin").WithInstance(id)
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

// createBackend creates a PluginBackend for the given plugin.
// Uses backendFactory if set (for testing), otherwise creates a real go-plugin client.
func (pm *pluginManager) createBackend(id string, metadata config.PluginMeta, location string) (plugintypes.PluginBackend, error) {
	if pm.backendFactory != nil {
		return pm.backendFactory(metadata, location)
	}

	pluginClient := goplugin.NewClient(&goplugin.ClientConfig{
		HandshakeConfig: metadata.GenerateHandshakeConfig(),
		VersionedPlugins: map[int]goplugin.PluginSet{
			1: {
				"resource":  &rpv1.GRPCPlugin{},
				"exec":      &ep.Plugin{},
				"networker": &np.Plugin{},
				"log":       &lp.Plugin{},
				"metric":    &mp.Plugin{},
				"settings":  &sp.SettingsPlugin{},
				"lifecycle": &lc.Plugin{},
			},
		},
		GRPCDialOptions: sdk.GRPCDialOptions(),
		//nolint:gosec // this is completely software controlled
		Cmd:              exec.Command(filepath.Join(location, "bin", "plugin")),
		AllowedProtocols: []goplugin.Protocol{goplugin.ProtocolGRPC},
		Logger: hclog.New(&hclog.LoggerOptions{
			Name:   id,
			Output: os.Stdout,
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
	pm.recordsMu.RLock()
	record, ok := pm.records[id]
	pm.recordsMu.RUnlock()
	if !ok {
		return sdktypes.PluginInfo{}, apperror.New(apperror.TypePluginNotLoaded, 404,
			"Plugin not loaded",
			fmt.Sprintf("Plugin '%s' is not currently loaded.", id)).WithInstance(id)
	}

	// Build reload opts from the current record state.
	opts := &LoadPluginOptions{
		ExistingState: &plugintypes.PluginStateRecord{
			ID:      record.ID,
			Enabled: record.Enabled,
			DevMode: record.DevMode,
			DevPath: record.DevPath,
		},
	}

	if err := pm.UnloadPlugin(id); err != nil {
		return sdktypes.PluginInfo{}, apperror.Wrap(err, apperror.TypePluginLoadFailed, 500,
			"Failed to unload plugin during reload").WithInstance(id)
	}
	return pm.LoadPlugin(id, opts)
}

// UnloadPlugin unloads a plugin, stopping it if running.
// If the plugin is already unloaded, this is a no-op.
func (pm *pluginManager) UnloadPlugin(id string) error {
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
			pm.logger.Errorw("error invoking init for plugin manager",
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
		pm.logger.Warnw("plugin uses deprecated SDK protocol version",
			"pluginID", pluginID, "version", version,
			"current", plugintypes.CurrentProtocolVersion)
	}

	for name, manager := range pm.managers {
		if err := manager.OnPluginStart(ctx, pluginID, record.Metadata); err != nil {
			pm.logger.Errorw("error invoking start for plugin manager",
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
			pm.logger.Debugw("capability detection failed", "pluginID", pluginID, "error", err)
		} else {
			detectedCaps = capStringsToCapabilities(capStrings)
		}
	}

	record.Capabilities = detectedCaps

	// Start controllers for detected capabilities.
	for _, cap := range detectedCaps {
		var ctrl plugintypes.Controller
		switch cap {
		case sdktypes.CapabilityResource:
			ctrl = pm.connfullControllers[cap]
		default:
			ctrl = pm.connlessControllers[cap]
		}
		if ctrl == nil {
			continue
		}
		if err := ctrl.OnPluginStart(pluginID, record.Metadata, backend); err != nil {
			pm.logger.Warnw("failed to start capability controller",
				"pluginID", pluginID, "capability", cap.String(), "error", err)
			continue
		}
	}

	pm.logger.Infow("detected plugin capabilities",
		"pluginID", record.Metadata.ID,
		"capabilities", record.Capabilities,
	)

	return nil
}

// capStringsToCapabilities converts raw capability strings to Capability values.
func capStringsToCapabilities(caps []string) []sdktypes.Capability {
	var result []sdktypes.Capability
	for _, capStr := range caps {
		cap, ok := sdktypes.ParseCapability(capStr)
		if !ok || cap == sdktypes.CapabilitySettings {
			// settings is always registered separately, skip
			continue
		}
		result = append(result, cap)
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
			pm.logger.Errorw("error invoking stop for plugin manager",
				"manager", name, "pluginID", record.Metadata.ID, "error", err)
		}
	}

	if ctrl := pm.connlessControllers[sdktypes.CapabilitySettings]; ctrl != nil {
		if err := ctrl.OnPluginStop(pluginID, record.Metadata); err != nil {
			return fmt.Errorf("error stopping settings plugin: %w", err)
		}
	}

	for _, cap := range record.Capabilities {
		var ctrl plugintypes.Controller
		switch cap {
		case sdktypes.CapabilityResource:
			ctrl = pm.connfullControllers[cap]
		default:
			ctrl = pm.connlessControllers[cap]
		}
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
			pm.logger.Errorw("error invoking shutdown for plugin manager",
				"manager", name, "pluginID", record.Metadata.ID, "error", err)
		}
	}

	if record.Metadata.HasBackendCapabilities() {
		if record.Backend != nil {
			if err := record.Backend.Stop(); err != nil {
				pm.logger.Warnw("error closing plugin backend", "pluginID", pluginID, "error", err)
			}
			record.Backend.Kill()
		}
		pm.pidTracker.Remove(pluginID)

		if ctrl := pm.connlessControllers[sdktypes.CapabilitySettings]; ctrl != nil {
			if err := ctrl.OnPluginShutdown(pluginID, record.Metadata); err != nil {
				return fmt.Errorf("error shutting down settings plugin: %w", err)
			}
		}
	}

	for _, cap := range record.Capabilities {
		var ctrl plugintypes.Controller
		switch cap {
		case sdktypes.CapabilityResource:
			ctrl = pm.connfullControllers[cap]
		default:
			ctrl = pm.connlessControllers[cap]
		}
		if ctrl == nil {
			continue
		}
		if err := ctrl.OnPluginShutdown(pluginID, record.Metadata); err != nil {
			return fmt.Errorf("error shutting down %s plugin: %w", cap, err)
		}
	}
	return nil
}
