package devserver

import (
	"context"
	"fmt"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"go.uber.org/zap"

	pkgsettings "github.com/omniviewdev/settings"
)

// PluginRef is the minimal interface for reading plugin info.
// This avoids importing the plugin package (which would cause circular deps).
type PluginRef interface {
	GetDevPluginInfo(pluginID string) (devMode bool, devPath string, err error)
}

// PluginReloader is the interface for reloading plugins after Go rebuild.
type PluginReloader interface {
	ReloadPlugin(id string) error
}

// DevServerManager manages dev server instances for plugins in development mode.
// It is exposed as a Wails binding. All public methods are callable from the frontend.
type DevServerManager struct {
	ctx              context.Context
	logger           *zap.SugaredLogger
	mu               sync.RWMutex
	instances        map[string]*DevServerInstance // pluginID -> instance
	ports            *PortAllocator
	pluginRef        PluginRef
	pluginReloader   PluginReloader
	settingsProvider pkgsettings.Provider
	externalWatcher  *ExternalWatcher
}

// NewDevServerManager creates a new DevServerManager. Call Initialize() with the Wails
// context before using any other methods.
func NewDevServerManager(
	logger *zap.SugaredLogger,
	pluginRef PluginRef,
	pluginReloader PluginReloader,
	settingsProvider pkgsettings.Provider,
) *DevServerManager {
	return &DevServerManager{
		logger:           logger.Named("DevServerManager"),
		instances:        make(map[string]*DevServerInstance),
		ports:            NewPortAllocator(),
		pluginRef:        pluginRef,
		pluginReloader:   pluginReloader,
		settingsProvider: settingsProvider,
	}
}

// Initialize is called during Wails startup (OnStartup callback). It stores the
// Wails context needed for runtime.EventsEmit, and starts the external plugin watcher.
func (m *DevServerManager) Initialize(ctx context.Context) {
	m.ctx = ctx

	// Start the external watcher for .devinfo files.
	watcher, err := NewExternalWatcher(
		m.logger,
		m.handleExternalConnect,
		m.handleExternalDisconnect,
	)
	if err != nil {
		m.logger.Errorw("failed to create external watcher", "error", err)
	} else {
		m.externalWatcher = watcher
		if err := watcher.Start(ctx); err != nil {
			m.logger.Errorw("failed to start external watcher", "error", err)
		}
	}

	m.logger.Info("DevServerManager initialized")
}

// Shutdown stops all running dev server instances and the external watcher.
// Called from Wails OnShutdown.
func (m *DevServerManager) Shutdown() {
	m.logger.Info("DevServerManager shutting down")

	// Stop the external watcher first.
	if m.externalWatcher != nil {
		m.externalWatcher.Stop()
	}

	m.mu.RLock()
	ids := make([]string, 0, len(m.instances))
	for id := range m.instances {
		ids = append(ids, id)
	}
	m.mu.RUnlock()

	for _, id := range ids {
		if err := m.StopDevServer(id); err != nil {
			m.logger.Errorw("error stopping dev server during shutdown",
				"pluginID", id,
				"error", err,
			)
		}
	}

	m.logger.Info("DevServerManager shutdown complete")
}

// ============================================================================
// Wails-bound methods (callable from frontend)
// ============================================================================

// StartDevServer starts a managed dev server for the given plugin. This spawns
// a Vite dev server process and a Go file watcher. The plugin must already be
// loaded in dev mode (DevMode=true, DevPath set).
//
// Returns the initial DevServerState.
func (m *DevServerManager) StartDevServer(pluginID string) (DevServerState, error) {
	l := m.logger.With("method", "StartDevServer", "pluginID", pluginID)
	l.Info("starting dev server")

	// Fast path: if already running, return existing state without looking up the plugin.
	m.mu.RLock()
	if inst, exists := m.instances[pluginID]; exists {
		m.mu.RUnlock()
		l.Warn("dev server already running")
		return inst.State(), nil
	}
	m.mu.RUnlock()

	// Look up the plugin to get DevPath.
	devMode, devPath, err := m.pluginRef.GetDevPluginInfo(pluginID)
	if err != nil {
		return DevServerState{}, fmt.Errorf("plugin not found: %w", err)
	}
	if !devMode {
		return DevServerState{}, fmt.Errorf("plugin %q is not in dev mode", pluginID)
	}
	if devPath == "" {
		return DevServerState{}, fmt.Errorf("plugin %q has no DevPath set", pluginID)
	}

	return m.startDevServer(pluginID, devPath)
}

// StartDevServerForPath starts a managed dev server for a plugin using the
// provided devPath directly, without requiring the plugin to be loaded first.
// This is used during InstallInDevMode and Initialize where the plugin hasn't
// been loaded yet but we need the dev server (and its initial Go build) to run
// before LoadPlugin.
func (m *DevServerManager) StartDevServerForPath(pluginID, devPath string) (DevServerState, error) {
	l := m.logger.With("method", "StartDevServerForPath", "pluginID", pluginID, "devPath", devPath)
	l.Info("starting dev server for path")

	if devPath == "" {
		return DevServerState{}, fmt.Errorf("plugin %q has no devPath", pluginID)
	}

	return m.startDevServer(pluginID, devPath)
}

// startDevServer is the shared implementation for StartDevServer and StartDevServerForPath.
func (m *DevServerManager) startDevServer(pluginID, devPath string) (DevServerState, error) {
	l := m.logger.With("method", "startDevServer", "pluginID", pluginID)

	m.mu.Lock()

	// Check if already running.
	if inst, exists := m.instances[pluginID]; exists {
		m.mu.Unlock()
		l.Warn("dev server already running")
		return inst.State(), nil
	}

	// Allocate a port for the Vite dev server.
	port, err := m.ports.Allocate(pluginID)
	if err != nil {
		m.mu.Unlock()
		return DevServerState{}, fmt.Errorf("port allocation failed: %w", err)
	}

	// Resolve build tool paths from settings.
	buildOpts := m.resolveBuildOpts()

	// Create the instance.
	inst := NewDevServerInstance(
		m.ctx,
		m.logger,
		pluginID,
		devPath,
		port,
		buildOpts,
		m.pluginReloader,
		m.emitStatus,
		m.emitLogs,
		m.emitErrors,
	)

	m.instances[pluginID] = inst
	m.mu.Unlock()

	// Start the instance (non-blocking; spawns goroutines).
	if err := inst.Start(); err != nil {
		m.mu.Lock()
		delete(m.instances, pluginID)
		m.mu.Unlock()
		m.ports.Release(port)
		return DevServerState{}, fmt.Errorf("failed to start dev server: %w", err)
	}

	state := inst.State()
	m.emitStatus(pluginID, state)

	l.Infow("dev server started", "port", port)
	return state, nil
}

// StopDevServer stops the managed dev server for the given plugin.
func (m *DevServerManager) StopDevServer(pluginID string) error {
	l := m.logger.With("method", "StopDevServer", "pluginID", pluginID)
	l.Info("stopping dev server")

	m.mu.Lock()
	inst, exists := m.instances[pluginID]
	if !exists {
		m.mu.Unlock()
		return fmt.Errorf("no dev server running for plugin %q", pluginID)
	}
	delete(m.instances, pluginID)
	m.mu.Unlock()

	inst.Stop()
	m.ports.ReleaseByPlugin(pluginID)

	state := DevServerState{
		PluginID:   pluginID,
		Mode:       DevServerModeIdle,
		ViteStatus: DevProcessStatusStopped,
		GoStatus:   DevProcessStatusStopped,
	}
	m.emitStatus(pluginID, state)

	l.Info("dev server stopped")
	return nil
}

// RestartDevServer stops and then starts the dev server for the given plugin.
func (m *DevServerManager) RestartDevServer(pluginID string) (DevServerState, error) {
	m.logger.Infow("restarting dev server", "pluginID", pluginID)
	_ = m.StopDevServer(pluginID)
	return m.StartDevServer(pluginID)
}

// GetDevServerState returns the current state of the dev server for a single plugin.
func (m *DevServerManager) GetDevServerState(pluginID string) DevServerState {
	m.mu.RLock()
	defer m.mu.RUnlock()

	inst, exists := m.instances[pluginID]
	if !exists {
		return DevServerState{
			PluginID: pluginID,
			Mode:     DevServerModeIdle,
		}
	}
	return inst.State()
}

// ListDevServerStates returns the state of all running dev server instances,
// including externally-managed plugins.
func (m *DevServerManager) ListDevServerStates() []DevServerState {
	m.mu.RLock()
	states := make([]DevServerState, 0, len(m.instances))
	for _, inst := range m.instances {
		states = append(states, inst.State())
	}
	m.mu.RUnlock()

	// Include externally-managed plugins.
	if m.externalWatcher != nil {
		m.externalWatcher.mu.RLock()
		for pluginID, conn := range m.externalWatcher.connections {
			if !conn.Connected {
				continue
			}
			state := DevServerState{
				PluginID:      pluginID,
				Mode:          DevServerModeExternal,
				VitePort:      conn.DevInfo.VitePort,
				GRPCConnected: true,
			}
			if conn.DevInfo.VitePort > 0 {
				state.ViteStatus = DevProcessStatusReady
				state.ViteURL = fmt.Sprintf("http://127.0.0.1:%d", conn.DevInfo.VitePort)
			}
			states = append(states, state)
		}
		m.externalWatcher.mu.RUnlock()
	}

	return states
}

// GetDevServerLogs returns the most recent log entries for a plugin's dev server.
func (m *DevServerManager) GetDevServerLogs(pluginID string, count int) []LogEntry {
	m.mu.RLock()
	inst, exists := m.instances[pluginID]
	m.mu.RUnlock()

	if !exists {
		return nil
	}

	return inst.GetLogs(count)
}

// IsManaged returns true if the plugin's dev server is currently managed by this manager,
// either via IDE-managed mode or external mode.
func (m *DevServerManager) IsManaged(pluginID string) bool {
	m.mu.RLock()
	_, exists := m.instances[pluginID]
	m.mu.RUnlock()
	if exists {
		return true
	}

	// Check externally-managed instances.
	if m.externalWatcher != nil {
		return m.externalWatcher.IsExternallyManaged(pluginID)
	}

	return false
}

// GetExternalPluginInfo returns the DevInfo for an externally-managed plugin, or nil.
func (m *DevServerManager) GetExternalPluginInfo(pluginID string) *DevInfoFile {
	if m.externalWatcher == nil {
		return nil
	}
	return m.externalWatcher.GetExternalInfo(pluginID)
}

// ============================================================================
// Internal helpers
// ============================================================================

// handleExternalConnect is called by ExternalWatcher when a .devinfo file is detected.
func (m *DevServerManager) handleExternalConnect(pluginID string, info *DevInfoFile) {
	m.logger.Infow("external plugin connected",
		"pluginID", pluginID,
		"addr", info.Addr,
		"vitePort", info.VitePort,
		"pid", info.PID,
	)

	state := DevServerState{
		PluginID:      pluginID,
		Mode:          DevServerModeExternal,
		VitePort:      info.VitePort,
		GRPCConnected: true,
	}
	if info.VitePort > 0 {
		state.ViteStatus = DevProcessStatusReady
		state.ViteURL = fmt.Sprintf("http://127.0.0.1:%d", info.VitePort)
	}

	m.emitStatus(pluginID, state)
}

// handleExternalDisconnect is called by ExternalWatcher when an external plugin disconnects.
func (m *DevServerManager) handleExternalDisconnect(pluginID string) {
	m.logger.Infow("external plugin disconnected", "pluginID", pluginID)

	state := DevServerState{
		PluginID:      pluginID,
		Mode:          DevServerModeIdle,
		GRPCConnected: false,
	}
	m.emitStatus(pluginID, state)
}

func (m *DevServerManager) resolveBuildOpts() BuildOpts {
	opts := BuildOpts{}
	opts.GoPath, _ = m.settingsProvider.GetString("developer.gopath")
	opts.PnpmPath, _ = m.settingsProvider.GetString("developer.pnpmpath")
	opts.NodePath, _ = m.settingsProvider.GetString("developer.nodepath")
	return opts
}

func (m *DevServerManager) emitStatus(pluginID string, state DevServerState) {
	if m.ctx == nil {
		return
	}
	runtime.EventsEmit(m.ctx, EventDevServerStatus, state)
}

func (m *DevServerManager) emitLogs(pluginID string, entries []LogEntry) {
	if m.ctx == nil || len(entries) == 0 {
		return
	}
	runtime.EventsEmit(m.ctx, EventDevServerLog, entries)
}

func (m *DevServerManager) emitErrors(pluginID string, errors []BuildError) {
	if m.ctx == nil || len(errors) == 0 {
		return
	}
	runtime.EventsEmit(m.ctx, EventDevServerError, pluginID, errors)
}
