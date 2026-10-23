package devserver

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/instance"
	logging "github.com/omniviewdev/plugin-sdk/log"
	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
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
	app                       *application.App
	ctx                       context.Context
	logger                    logging.Logger
	mu                        sync.RWMutex
	instances                 map[string]*DevServerInstance // pluginID -> instance
	ports                     *PortAllocator
	pluginRef                 PluginRef
	pluginReloader            PluginReloader
	settingsProvider          pkgsettings.Provider
	pluginsRoot               *appstate.ScopedRoot // scoped to ~/.omniview/plugins
	stateRoot                 *appstate.ScopedRoot
	buildEnvironment          []string
	workspace                 *devcontract.ResolvedWorkspace
	expectedSDKRevision       string
	disableDependencyWatching bool
	operations                sync.Map
	pnpmCommands              map[string]PNPMCommand
	processSupervisor         *devsession.ProcessBridgeClient
}

// NewDevServerManager creates a new DevServerManager. Call Initialize() with the Wails
// context before using any other methods.
func NewDevServerManager(
	logger logging.Logger,
	stateRoot *appstate.ScopedRoot,
	pluginsRoot *appstate.ScopedRoot,
	pluginRef PluginRef,
	pluginReloader PluginReloader,
	settingsProvider pkgsettings.Provider,
) *DevServerManager {
	return &DevServerManager{
		app:              nil,                  // set by ServiceStartup
		ctx:              context.Background(), // replaced by ServiceStartup
		logger:           logger.Named("DevServerManager"),
		mu:               sync.RWMutex{},
		instances:        make(map[string]*DevServerInstance),
		ports:            NewPortAllocator(stateRoot),
		pluginRef:        pluginRef,
		pluginReloader:   pluginReloader,
		settingsProvider: settingsProvider,
		pluginsRoot:      pluginsRoot,
		stateRoot:        stateRoot,
	}
}

// ServiceStartup is called during Wails v3 service startup. It stores the
// application reference and starts the external plugin watcher.
func (m *DevServerManager) ServiceStartup(ctx context.Context, _ application.ServiceOptions) error {
	m.app = application.Get()
	m.ctx = ctx

	// Kill any stale Vite dev server processes left over from a previous
	// unclean shutdown (crash, SIGKILL, etc.). These zombie node processes
	// hold ports in our allocated range and prevent new dev servers from
	// starting.
	m.ports.CleanupStaleProcesses(m.ctx, m.logger)

	m.logger.Infow(ctx, "DevServerManager initialized")
	return nil
}

// ServiceShutdown stops all owned managed dev server instances.
func (m *DevServerManager) ServiceShutdown() error {
	m.logger.Infow(context.Background(), "DevServerManager shutting down")

	m.mu.RLock()
	ids := make([]string, 0, len(m.instances))
	for id := range m.instances {
		ids = append(ids, id)
	}
	m.mu.RUnlock()

	var shutdownErr error
	for _, id := range ids {
		if err := m.StopDevServer(id); err != nil {
			shutdownErr = errors.Join(shutdownErr, err)
			m.logger.Errorw(context.Background(), "error stopping dev server during shutdown",
				"pluginID", id,
				"error", err,
			)
		}
	}

	// SavePIDs removes only records whose owned stop was confirmed; unresolved
	// ownership survives shutdown for the retained supervisor/recovery path.
	shutdownErr = errors.Join(shutdownErr, m.ports.SavePIDs())
	if m.processSupervisor != nil {
		m.processSupervisor.Close()
	}
	m.logger.Infow(context.Background(), "DevServerManager shutdown complete")
	return shutdownErr
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
	l := m.logger.With(logging.Any("method", "StartDevServer"), logging.Any("pluginID", pluginID))
	l.Infow(context.Background(), "starting dev server")

	// Look up the plugin to get DevPath.
	devMode, devPath, err := m.pluginRef.GetDevPluginInfo(pluginID)
	if err != nil {
		return DevServerState{}, apperror.PluginNotFound(pluginID)
	}
	if !devMode {
		return DevServerState{}, apperror.New(
			apperror.TypeValidation,
			http.StatusUnprocessableEntity,
			"Not in dev mode",
			fmt.Sprintf("Plugin '%s' is not in dev mode.", pluginID),
		)
	}
	if devPath == "" {
		return DevServerState{}, apperror.New(
			apperror.TypeValidation,
			http.StatusUnprocessableEntity,
			"Missing dev path",
			fmt.Sprintf("Plugin '%s' has no development path configured.", pluginID),
		)
	}

	return m.startDevServer(pluginID, devPath)
}

// StartDevServerForPath starts a managed dev server for a plugin using the
// provided devPath directly, without requiring the plugin to be loaded first.
// This is used during InstallInDevMode and Initialize where the plugin hasn't
// been loaded yet but we need the dev server (and its initial Go build) to run
// before LoadPlugin.
func (m *DevServerManager) StartDevServerForPath(pluginID, devPath string) (DevServerState, error) {
	l := m.logger.With(logging.Any("method", "StartDevServerForPath"), logging.Any("pluginID", pluginID))
	l.Debugw(context.Background(), "starting dev server for path", "devPath", devPath)

	if devPath == "" {
		return DevServerState{}, apperror.New(
			apperror.TypeValidation,
			http.StatusUnprocessableEntity,
			"Missing dev path",
			fmt.Sprintf("Plugin '%s' has no development path configured.", pluginID),
		)
	}

	return m.startDevServer(pluginID, devPath)
}

// startDevServer is the shared implementation for StartDevServer and StartDevServerForPath.
func (m *DevServerManager) startDevServer(pluginID, devPath string) (DevServerState, error) {
	lock := m.operationLock(pluginID)
	lock.Lock()
	defer lock.Unlock()
	l := m.logger.With(logging.Any("method", "startDevServer"), logging.Any("pluginID", pluginID))

	canonical, err := filepath.EvalSymlinks(devPath)
	if err != nil {
		return DevServerState{}, err
	}
	devPath, err = filepath.Abs(canonical)
	if err != nil {
		return DevServerState{}, err
	}
	metadata, err := sdktypes.LoadPluginMetadata(devPath)
	if err != nil {
		return DevServerState{}, fmt.Errorf("load source metadata: %w", err)
	}
	if metadata.ID != pluginID {
		return DevServerState{}, fmt.Errorf("source plugin ID %q does not match %q", metadata.ID, pluginID)
	}
	if !metadata.HasUICapabilities() && !metadata.HasBackendCapabilities() {
		return DevServerState{}, fmt.Errorf("plugin has no supported development capabilities")
	}
	if _, err = m.ValidateManagedSource(pluginID, devPath); err != nil {
		return DevServerState{}, err
	}
	m.mu.Lock()
	if inst, exists := m.instances[pluginID]; exists {
		m.mu.Unlock()
		if inst.devPath != devPath {
			return DevServerState{}, fmt.Errorf("plugin %q is still managed from %s; stop/unload before rebinding source", pluginID, inst.devPath)
		}
		return inst.State(), nil
	}
	port := 0
	if metadata.HasUICapabilities() {
		port, err = m.ports.Allocate(pluginID)
		if err != nil {
			m.mu.Unlock()
			return DevServerState{}, err
		}
		m.ports.mu.Lock()
		m.ports.sources[pluginID] = devPath
		m.ports.mu.Unlock()
	}
	buildOpts := m.resolveBuildOpts()
	if metadata.HasUICapabilities() {
		if err = m.applyPNPMCommand(pluginID, devPath, &buildOpts); err != nil {
			m.mu.Unlock()
			m.ports.Release(port)
			return DevServerState{}, err
		}
	}
	buildOpts.Environment, err = instance.PluginEnvironment(buildOpts.StateRoot, pluginID, buildOpts.Environment)
	if err != nil {
		m.mu.Unlock()
		m.ports.Release(port)
		return DevServerState{}, err
	}
	if os.Getenv(devcontract.WorkspaceEnvironment) != "" && m.ports.registry == nil {
		m.mu.Unlock()
		m.ports.Release(port)
		return DevServerState{}, fmt.Errorf("workspace managed lifecycle not configured")
	}
	buildOpts.ViteOwner = devsession.ProcessOwner{WorkspaceID: m.ports.owner.WorkspaceID, Generation: m.ports.owner.Generation, Role: "plugin-vite", Source: devPath}
	buildOpts.ViteStarted = func(identity devcontract.ProcessIdentity) error {
		if err := m.ports.RecordProcess(port, identity); err != nil {
			return err
		}
		return m.ports.SavePIDs()
	}

	// Create the instance.
	inst := NewDevServerInstance(
		m.ctx,
		m.logger,
		pluginID,
		devPath,
		port,
		buildOpts,
		m.pluginReloader,
		m.pluginsRoot,
		m.emitStatus,
		m.emitLogs,
		m.emitErrors,
	)
	inst.hasUI, inst.hasBackend = metadata.HasUICapabilities(), metadata.HasBackendCapabilities()
	inst.buildOpts.Generation = inst.generation
	inst.buildOpts.DisableDependencyWatching = m.disableDependencyWatching

	m.instances[pluginID] = inst
	m.mu.Unlock()

	// Initial compilation is synchronous; Vite is probed before a successful
	// start result, while backend readiness awaits the actual loader callback.
	if err = inst.Start(); err != nil {
		if stopErr := inst.Stop(); stopErr != nil {
			failure := errors.Join(err, stopErr)
			inst.setLastError(failure.Error())
			return inst.State(), failure
		}
		m.mu.Lock()
		delete(m.instances, pluginID)
		m.mu.Unlock()
		m.ports.Release(port)
		return DevServerState{}, apperror.Wrap(
			err, apperror.TypePluginBuildFailed, http.StatusInternalServerError, "Failed to start dev server",
		)
	}

	if inst.vite != nil {
		if err = inst.vite.WaitReady(); err == nil {
			err = m.ports.ConfirmBound(pluginID)
		}
		if err != nil {
			_ = m.ports.BindFailed(pluginID)
			inst.setLastError(err.Error())
			inst.setViteStatus(DevProcessStatusError)
			return inst.State(), err
		}
	}

	state := inst.State()
	m.emitStatus(pluginID, state)
	if state.LastError != "" {
		return state, fmt.Errorf("managed plugin startup: %s", state.LastError)
	}

	l.Infow(context.Background(), "dev server started", "port", port)
	return state, nil
}

// StopDevServer stops the managed dev server for the given plugin.
func (m *DevServerManager) StopDevServer(pluginID string) error {
	l := m.logger.With(logging.Any("method", "StopDevServer"), logging.Any("pluginID", pluginID))
	lock := m.operationLock(pluginID)
	lock.Lock()
	defer lock.Unlock()
	l.Infow(context.Background(), "stopping dev server")

	m.mu.Lock()
	inst, exists := m.instances[pluginID]
	if !exists {
		m.mu.Unlock()
		return apperror.New(
			apperror.TypeValidation,
			http.StatusUnprocessableEntity,
			"No dev server running",
			fmt.Sprintf("No dev server is running for plugin '%s'.", pluginID),
		)
	}
	delete(m.instances, pluginID)
	m.mu.Unlock()

	if err := inst.Stop(); err != nil {
		m.mu.Lock()
		m.instances[pluginID] = inst
		m.mu.Unlock()
		m.emitStatus(pluginID, inst.State())
		return err
	}
	m.ports.ReleaseByPlugin(pluginID)
	m.ports.SavePIDs()

	state := DevServerState{
		PluginID:          pluginID,
		Mode:              DevServerModeIdle,
		DevPath:           "",
		VitePort:          0,
		ViteURL:           "",
		ViteStatus:        DevProcessStatusStopped,
		GoStatus:          DevProcessStatusStopped,
		LastBuildDuration: 0,
		LastBuildTime:     "",
		LastError:         "",
		GRPCConnected:     false,
	}
	m.emitStatus(pluginID, state)

	l.Infow(context.Background(), "dev server stopped")
	return nil
}

// RestartDevServer stops and then starts the dev server for the given plugin.
func (m *DevServerManager) RestartDevServer(pluginID string) (DevServerState, error) {
	m.logger.Infow(context.Background(), "restarting dev server", "pluginID", pluginID)
	_ = m.StopDevServer(pluginID)
	return m.StartDevServer(pluginID)
}

// RebuildPlugin triggers a Go rebuild, transfers the binary, and reloads the plugin
// without restarting the Vite dev server.
func (m *DevServerManager) RebuildPlugin(pluginID string) error {
	m.mu.RLock()
	inst, exists := m.instances[pluginID]
	m.mu.RUnlock()

	if !exists {
		return apperror.New(apperror.TypeValidation, http.StatusUnprocessableEntity,
			"No dev server running",
			fmt.Sprintf("No dev server is running for plugin '%s'.", pluginID))
	}

	return inst.TriggerRebuild()
}

// GetDevServerState returns the current state of the dev server for a single plugin.
func (m *DevServerManager) GetDevServerState(pluginID string) DevServerState {
	m.mu.RLock()
	defer m.mu.RUnlock()

	inst, exists := m.instances[pluginID]
	if !exists {
		return idleState(pluginID)
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
	return exists
}

// ============================================================================
// Internal helpers
// ============================================================================

// idleState is the state of a plugin with no dev server.
func idleState(pluginID string) DevServerState {
	return DevServerState{
		PluginID:          pluginID,
		Mode:              DevServerModeIdle,
		DevPath:           "",
		VitePort:          0,
		ViteURL:           "",
		ViteStatus:        "",
		GoStatus:          "",
		LastBuildDuration: 0,
		LastBuildTime:     "",
		LastError:         "",
		GRPCConnected:     false,
	}
}

func (m *DevServerManager) resolveBuildOpts() BuildOpts {
	opts := BuildOpts{StateRoot: m.stateRoot.ResolvePath(""), Environment: m.buildEnvironment, ExpectedSDKRevision: m.expectedSDKRevision, Workspace: m.workspace, ProcessSupervisor: m.processSupervisor}
	if m.settingsProvider != nil {
		opts.GoPath, _ = m.settingsProvider.GetString("developer.gopath")
		opts.PnpmPath, _ = m.settingsProvider.GetString("developer.pnpmpath")
		opts.NodePath, _ = m.settingsProvider.GetString("developer.nodepath")
		opts.ExplicitPnpmPath = opts.PnpmPath
		opts.ExplicitNodePath = opts.NodePath
	}
	if opts.GoPath == "" {
		opts.GoPath, _ = exec.LookPath("go")
	}
	if opts.PnpmPath == "" {
		opts.PnpmPath, _ = exec.LookPath("pnpm")
	}
	if opts.NodePath == "" {
		opts.NodePath, _ = exec.LookPath("node")
	}
	if opts.Environment == nil {
		opts.Environment = os.Environ()
	}
	return opts
}

func (m *DevServerManager) emitStatus(pluginID string, state DevServerState) {
	if state.Generation != "" {
		m.mu.RLock()
		inst := m.instances[pluginID]
		current := inst != nil && inst.generation == state.Generation
		m.mu.RUnlock()
		if !current {
			return
		}
	}
	if m.app == nil {
		return
	}
	m.app.Event.Emit(EventDevServerStatus, state)
}

func (m *DevServerManager) emitLogs(_ string, entries []LogEntry) {
	if m.app == nil || len(entries) == 0 {
		return
	}
	m.app.Event.Emit(EventDevServerLog, entries)
}

func (m *DevServerManager) emitErrors(pluginID string, errors []BuildError) {
	if m.app == nil || len(errors) == 0 {
		return
	}
	m.app.Event.Emit(EventDevServerError, DevServerErrorPayload{PluginID: pluginID, Errors: errors})
}
