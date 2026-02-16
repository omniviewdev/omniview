# 06 -- Refactor Existing Dev Watcher

## Phase 5: Integrate DevServerManager with Existing Watcher

**Goal**: Modify the existing file watcher in `dev.go` and the plugin manager in `manager.go` so that plugins managed by the DevServerManager skip the old rebuild-and-transfer pipeline, while non-managed dev-mode plugins continue to work as before.

**Prerequisites**: Phase 2 (DevServer Manager) must be complete.

---

## 1. Current State

### 1.1 File: `/backend/pkg/plugin/dev.go`

The file watcher system works as follows:

1. **`runWatcher()`** (line 57): Runs in a goroutine. Reads from `pm.watcher.Events` channel (fsnotify). Debounces events per file path using `DedupInterval` (500ms). Calls `handleWatchEvent()` after debounce.

2. **`handleWatchEvent()`** (line 242): Determines which plugin owns the changed file via `findParentTarget()`. Decides whether the change is backend (`.go` in `pkg/`) or UI (files in `ui/`). Calls `buildAndTransferPlugin()` to rebuild and copy artifacts to `~/.omniview/plugins/<id>/`. Then calls `pm.ReloadPlugin()` to restart the gRPC process. Emits Wails events throughout.

3. **`AddTarget()`** (line 141): Registers a plugin's source directory for watching. Walks `pkg/` and `ui/` subdirectories, adding each to the fsnotify watcher. Stores the mapping in `pm.watchTargets[dir] = paths`.

4. **`RemoveTarget()`** (line 202): Removes a directory from the watcher.

5. **`installAndWatchDevPlugin()`** (line 219): Performs the initial build and transfer for a newly added dev-mode plugin.

The key issue: when DevServerManager takes over a plugin, the old watcher should NOT rebuild and transfer it. DevServerManager handles Vite HMR for UI and its own Go rebuild pipeline for the backend.

### 1.2 File: `/backend/pkg/plugin/manager.go`

The `pluginManager` struct (line 159):

```go
type pluginManager struct {
    ctx                 context.Context
    logger              *zap.SugaredLogger
    plugins             map[string]types.Plugin
    connlessControllers map[types.PluginType]plugintypes.Controller
    connfullControllers map[types.PluginType]plugintypes.ConnectedController
    watcher             *fsnotify.Watcher
    watchTargets        map[string][]string
    settingsProvider    pkgsettings.Provider
    registryClient      *registry.RegistryClient
    managers            map[string]plugintypes.PluginManager
}
```

`NewManager()` (line 108) creates a new `pluginManager` with all controllers and a fresh fsnotify watcher.

`InstallInDevMode()` (line 245):
1. Opens a directory dialog
2. Builds and transfers the plugin
3. Calls `LoadPlugin()` with `DevMode: true`
4. `LoadPlugin()` calls `pm.AddTarget(newPlugin.DevPath)` which sets up the old watcher

`Initialize()` (line 192):
1. Reads plugin state from disk
2. Loads each plugin directory from `~/.omniview/plugins/`
3. If a plugin was previously in dev mode, `LoadPluginOptions.ExistingState` restores that state
4. Dev-mode plugins get `AddTarget()` called, re-enabling the old watcher

---

## 2. Required Changes to dev.go

### 2.1 Add DevServerManager Check in `handleWatchEvent()`

The `handleWatchEvent()` function must skip processing when the DevServerManager owns the plugin. The DevServerManager owns a plugin if it has an active `DevServerInstance` for that plugin ID.

#### Current code (lines 242-291):

```go
func (pm *pluginManager) handleWatchEvent(event fsnotify.Event) error {
    l := pm.logger.With("name", "handleWatchEvent", "event", event)
    l.Debugw("handling watch event", "event", event)

    // find the target
    target := pm.findParentTarget(event.Name)
    if target == "" {
        return nil
    }

    opts := types.BuildOpts{
        ExcludeBackend: true,
        ExcludeUI:      true,
    }
    // ... rest of function
```

#### New code:

```go
func (pm *pluginManager) handleWatchEvent(event fsnotify.Event) error {
    l := pm.logger.With("name", "handleWatchEvent", "event", event)
    l.Debugw("handling watch event", "event", event)

    // find the target
    target := pm.findParentTarget(event.Name)
    if target == "" {
        return nil
    }

    // If DevServerManager owns this plugin, skip the old rebuild pipeline.
    // DevServerManager handles its own Vite HMR and Go rebuild flow.
    if pm.devServerMgr != nil {
        meta, err := parseMetadataFromPluginPath(target)
        if err == nil && pm.devServerMgr.IsManaged(meta.ID) {
            l.Debugw("skipping watch event for DevServerManager-managed plugin",
                "pluginID", meta.ID,
                "target", target,
            )
            return nil
        }
    }

    opts := types.BuildOpts{
        ExcludeBackend: true,
        ExcludeUI:      true,
    }
    opts.GoPath, _ = pm.settingsProvider.GetString("developer.gopath")
    opts.PnpmPath, _ = pm.settingsProvider.GetString("developer.pnpmpath")
    opts.NodePath, _ = pm.settingsProvider.GetString("developer.nodepath")

    // determine which portions we need to build
    if strings.HasPrefix(event.Name, filepath.Join(target, "pkg")) {
        opts.ExcludeBackend = false
    }

    if strings.HasPrefix(event.Name, filepath.Join(target, "ui")) {
        opts.ExcludeUI = false
    }

    meta, err := parseMetadataFromPluginPath(target)
    if err != nil {
        return fmt.Errorf("failed to parse metadata from plugin path: %w", err)
    }

    // load the meta and signal to ui
    runtime.EventsEmit(pm.ctx, PluginReloadEventStart, meta)

    // start the package
    if err = buildAndTransferPlugin(target, meta, opts); err != nil {
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
```

**What changed**: Lines 10-20 are new. They check if `pm.devServerMgr` is non-nil and if the plugin is managed by it. If so, the function returns early without building or reloading.

### 2.2 No Other Changes to dev.go

The `runWatcher()`, `AddTarget()`, `RemoveTarget()`, `eventShouldFire()`, and build functions remain unchanged. The old watcher continues to fire fsnotify events. The only change is in `handleWatchEvent()` which now short-circuits for DevServerManager-managed plugins.

---

## 3. Required Changes to manager.go

### 3.1 Add `devServerMgr` Field to `pluginManager` Struct

#### Current struct (lines 159-171):

```go
type pluginManager struct {
    ctx                 context.Context
    logger              *zap.SugaredLogger
    plugins             map[string]types.Plugin
    connlessControllers map[types.PluginType]plugintypes.Controller
    connfullControllers map[types.PluginType]plugintypes.ConnectedController
    watcher             *fsnotify.Watcher
    watchTargets        map[string][]string
    settingsProvider    pkgsettings.Provider
    registryClient      *registry.RegistryClient
    managers            map[string]plugintypes.PluginManager
}
```

#### New struct:

```go
type pluginManager struct {
    ctx                 context.Context
    logger              *zap.SugaredLogger
    plugins             map[string]types.Plugin
    connlessControllers map[types.PluginType]plugintypes.Controller
    connfullControllers map[types.PluginType]plugintypes.ConnectedController
    watcher             *fsnotify.Watcher
    watchTargets        map[string][]string
    settingsProvider    pkgsettings.Provider
    registryClient      *registry.RegistryClient
    managers            map[string]plugintypes.PluginManager
    devServerMgr        DevServerManagerRef
}
```

### 3.2 Define the DevServerManagerRef Interface

Add this interface to `manager.go` (or a separate file in the `plugin` package) to avoid a circular dependency with the `devserver` package:

```go
// DevServerManagerRef is a minimal interface for the DevServerManager,
// used by the plugin manager to check if a plugin is managed by the dev
// server system. This avoids circular imports between the plugin and
// devserver packages.
type DevServerManagerRef interface {
    // IsManaged returns true if the given plugin ID has an active dev
    // server instance managed by the DevServerManager.
    IsManaged(pluginID string) bool
}
```

The `devserver.Manager` struct (from Phase 2) will satisfy this interface.

### 3.3 Modify `NewManager()` to Accept DevServerManagerRef

#### Current signature (lines 108-118):

```go
func NewManager(
    logger *zap.SugaredLogger,
    resourceController resource.Controller,
    settingsController settings.Controller,
    execController pluginexec.Controller,
    networkerController networker.Controller,
    logsController pluginlogs.Controller,
    managers map[string]plugintypes.PluginManager,
    settingsProvider pkgsettings.Provider,
    registryClient *registry.RegistryClient,
) Manager {
```

#### New signature:

```go
func NewManager(
    logger *zap.SugaredLogger,
    resourceController resource.Controller,
    settingsController settings.Controller,
    execController pluginexec.Controller,
    networkerController networker.Controller,
    logsController pluginlogs.Controller,
    managers map[string]plugintypes.PluginManager,
    settingsProvider pkgsettings.Provider,
    registryClient *registry.RegistryClient,
    devServerMgr DevServerManagerRef,
) Manager {
```

#### New return block (lines 127-156):

```go
    return &pluginManager{
        logger:  logger,
        plugins: make(map[string]types.Plugin),
        connlessControllers: map[types.PluginType]plugintypes.Controller{
            types.SettingsPlugin:   settingsController,
            types.ReporterPlugin:   nil,
            types.ExecutorPlugin:   execController,
            types.NetworkerPlugin:  networkerController,
            types.ResourcePlugin:   nil,
            types.FilesystemPlugin: nil,
            types.LogPlugin:        logsController,
            types.MetricPlugin:     nil,
        },
        connfullControllers: map[types.PluginType]plugintypes.ConnectedController{
            types.ResourcePlugin:   resourceController,
            types.ExecutorPlugin:   nil,
            types.NetworkerPlugin:  nil,
            types.ReporterPlugin:   nil,
            types.SettingsPlugin:   nil,
            types.FilesystemPlugin: nil,
            types.LogPlugin:        nil,
            types.MetricPlugin:     nil,
        },
        watcher:          watcher,
        watchTargets:     make(map[string][]string),
        managers:         managers,
        settingsProvider: settingsProvider,
        registryClient:   registryClient,
        devServerMgr:     devServerMgr,
    }
```

### 3.4 Modify `Initialize()` to Auto-Start Dev Servers

After loading all plugins, iterate over the loaded plugins and start dev servers for any that are in dev mode.

#### Current code (lines 192-243):

```go
func (pm *pluginManager) Initialize(ctx context.Context) error {
    pm.ctx = ctx
    if err := auditPluginDir(); err != nil {
        return err
    }
    states, err := pm.readPluginState()
    if err != nil {
        pm.logger.Error(err)
    }
    pm.logger.Debugw("Loading plugins states from disk", "states", states)

    files, err := os.ReadDir(getPluginDir())
    if err != nil {
        return fmt.Errorf("error reading plugin directory: %w", err)
    }

    for _, file := range files {
        if file.IsDir() {
            var opts *LoadPluginOptions
            for _, state := range states {
                if state.ID == file.Name() {
                    opts = &LoadPluginOptions{
                        ExistingState: state,
                    }
                }
            }
            if _, err = pm.LoadPlugin(file.Name(), opts); err != nil {
                pm.logger.Errorf("error loading plugin: %w", err)
            }
        }
    }

    if err = pm.writePluginState(); err != nil {
        pm.logger.Error(err)
    }

    return nil
}
```

#### New code:

```go
func (pm *pluginManager) Initialize(ctx context.Context) error {
    pm.ctx = ctx
    if err := auditPluginDir(); err != nil {
        return err
    }
    states, err := pm.readPluginState()
    if err != nil {
        pm.logger.Error(err)
    }
    pm.logger.Debugw("Loading plugins states from disk", "states", states)

    files, err := os.ReadDir(getPluginDir())
    if err != nil {
        return fmt.Errorf("error reading plugin directory: %w", err)
    }

    for _, file := range files {
        if file.IsDir() {
            var opts *LoadPluginOptions
            for _, state := range states {
                if state.ID == file.Name() {
                    opts = &LoadPluginOptions{
                        ExistingState: state,
                    }
                }
            }
            if _, err = pm.LoadPlugin(file.Name(), opts); err != nil {
                pm.logger.Errorf("error loading plugin: %w", err)
            }
        }
    }

    // Auto-start dev servers for plugins that were in dev mode.
    // This runs AFTER all plugins are loaded so gRPC connections are ready.
    if pm.devServerMgr != nil {
        for id, p := range pm.plugins {
            if p.DevMode && p.DevPath != "" {
                pm.logger.Infow("auto-starting dev server for dev-mode plugin",
                    "pluginID", id,
                    "devPath", p.DevPath,
                )
                // StartDevServer is non-blocking (spawns goroutines internally).
                // Errors are emitted as Wails events, not returned here.
                if err := pm.devServerMgr.StartDevServer(id); err != nil {
                    pm.logger.Errorw("failed to auto-start dev server",
                        "pluginID", id,
                        "error", err,
                    )
                }
            }
        }
    }

    if err = pm.writePluginState(); err != nil {
        pm.logger.Error(err)
    }

    return nil
}
```

**What changed**: After the plugin loading loop and before writing state, we iterate over loaded plugins. For any plugin with `DevMode == true` and a non-empty `DevPath`, we call `pm.devServerMgr.StartDevServer()`. This restores the dev server state from the previous session.

### 3.5 Modify `InstallInDevMode()` to Start Dev Server

#### Current code (lines 245-285):

```go
func (pm *pluginManager) InstallInDevMode() (*config.PluginMeta, error) {
    path, err := runtime.OpenDirectoryDialog(pm.ctx, runtime.OpenDialogOptions{})
    if err != nil {
        pm.logger.Error(err)
        return nil, err
    }
    if path == "" {
        return nil, errors.New("cancelled")
    }

    opts := plugintypes.BuildOpts{}
    opts.GoPath, _ = pm.settingsProvider.GetString("developer.gopath")
    opts.PnpmPath, _ = pm.settingsProvider.GetString("developer.pnpmpath")
    opts.NodePath, _ = pm.settingsProvider.GetString("developer.nodepath")

    pm.logger.Infow("installing plugin from path",
        "path", path,
        "opts", opts,
    )

    var metadata *config.PluginMeta
    metadata, err = pm.installAndWatchDevPlugin(path, opts)
    if err != nil {
        pm.logger.Error(err)
        return nil, err
    }
    _, err = pm.LoadPlugin(metadata.ID, &LoadPluginOptions{DevMode: true, DevModePath: path})
    if err != nil {
        return nil, fmt.Errorf("error loading plugin: %w", err)
    }

    if err = pm.writePluginState(); err != nil {
        pm.logger.Error(err)
    }

    return metadata, nil
}
```

#### New code:

```go
func (pm *pluginManager) InstallInDevMode() (*config.PluginMeta, error) {
    path, err := runtime.OpenDirectoryDialog(pm.ctx, runtime.OpenDialogOptions{})
    if err != nil {
        pm.logger.Error(err)
        return nil, err
    }
    if path == "" {
        return nil, errors.New("cancelled")
    }

    opts := plugintypes.BuildOpts{}
    opts.GoPath, _ = pm.settingsProvider.GetString("developer.gopath")
    opts.PnpmPath, _ = pm.settingsProvider.GetString("developer.pnpmpath")
    opts.NodePath, _ = pm.settingsProvider.GetString("developer.nodepath")

    pm.logger.Infow("installing plugin from path",
        "path", path,
        "opts", opts,
    )

    // Perform initial build and transfer (creates binary + UI assets in ~/.omniview/plugins/)
    var metadata *config.PluginMeta
    metadata, err = pm.installAndWatchDevPlugin(path, opts)
    if err != nil {
        pm.logger.Error(err)
        return nil, err
    }

    // Load the plugin (starts gRPC process, initializes controllers)
    _, err = pm.LoadPlugin(metadata.ID, &LoadPluginOptions{DevMode: true, DevModePath: path})
    if err != nil {
        return nil, fmt.Errorf("error loading plugin: %w", err)
    }

    // Start the dev server (Vite + Go watcher) if DevServerManager is available.
    // This replaces the old watcher for this plugin.
    if pm.devServerMgr != nil {
        if startErr := pm.devServerMgr.StartDevServer(metadata.ID); startErr != nil {
            pm.logger.Errorw("failed to start dev server after install",
                "pluginID", metadata.ID,
                "error", startErr,
            )
            // Non-fatal: the plugin is loaded and running, just without HMR.
            // The old watcher (AddTarget) will still handle rebuilds.
        }
    }

    if err = pm.writePluginState(); err != nil {
        pm.logger.Error(err)
    }

    return metadata, nil
}
```

**What changed**: After `LoadPlugin()`, we call `pm.devServerMgr.StartDevServer()`. This is non-fatal: if it fails, the old fsnotify watcher (registered in `LoadPlugin` via `AddTarget`) still works as a fallback.

### 3.6 Modify `Shutdown()` to Stop Dev Servers

#### Current code (lines 182-190):

```go
func (pm *pluginManager) Shutdown() {
    pm.watcher.Close()

    for _, plugin := range pm.plugins {
        pm.shutdownPlugin(&plugin)
    }
}
```

#### New code:

```go
func (pm *pluginManager) Shutdown() {
    // Stop all dev servers first (kills Vite processes, stops Go watchers)
    if pm.devServerMgr != nil {
        pm.devServerMgr.Shutdown()
    }

    pm.watcher.Close()

    for _, plugin := range pm.plugins {
        pm.shutdownPlugin(&plugin)
    }
}
```

### 3.7 Update `main.go` to Wire DevServerManager

The DevServerManager needs to be created in `main.go` and passed to `NewManager()`.

#### Current code in main.go (lines 97-107):

```go
pluginRegistryClient := registry.NewRegistryClient()
pluginManager := plugin.NewManager(
    log,
    resourceController,
    settingsController,
    execController,
    networkerController,
    logsController,
    managers,
    settingsProvider,
    pluginRegistryClient,
)
```

#### New code:

```go
pluginRegistryClient := registry.NewRegistryClient()

// Create the dev server manager (manages Vite + Go rebuild for dev-mode plugins)
devServerMgr := devserver.NewManager(log, pluginMgr, settingsProvider)

pluginManager := plugin.NewManager(
    log,
    resourceController,
    settingsController,
    execController,
    networkerController,
    logsController,
    managers,
    settingsProvider,
    pluginRegistryClient,
    devServerMgr,
)
```

And in the `Bind` array (lines 167-185), add the dev server manager:

```go
Bind: []any{
    app,
    diagnosticsClient,

    // core engines/providers
    settingsProvider,
    trivyClient,

    // plugin system
    pluginManager,
    devServerMgr,       // <-- NEW
    resourceClient,
    settingsClient,
    execClient,
    networkerClient,
    logsClient,
    dataClient,
    uiClient,
    utilsClient,
},
```

And add the import:

```go
import (
    // ... existing imports ...
    "github.com/omniviewdev/omniview/backend/pkg/plugin/devserver"
)
```

And in the `OnStartup` function, initialize the dev server manager:

```go
startup := func(ctx context.Context) {
    app.startup(ctx)

    // ... existing initialization ...

    // Initialize the dev server manager with Wails context
    devServerMgr.Initialize(ctx)

    // Initialize the plugin system
    if err := pluginManager.Initialize(ctx); err != nil {
        log.Errorw("error while initializing plugin system", "error", err)
    }
    pluginManager.Run(ctx)
    runtime.MenuSetApplicationMenu(ctx, menus.GetMenus(ctx))
}
```

And in the `OnShutdown` function:

```go
OnShutdown: func(_ context.Context) {
    pluginManager.Shutdown()
    // devServerMgr is stopped inside pluginManager.Shutdown()
},
```

---

## 4. DevServerManagerRef Interface Contract

The `DevServerManagerRef` interface that the plugin manager depends on:

```go
// DevServerManagerRef is the interface that pluginManager uses to interact
// with the DevServerManager. It is defined in the plugin package to avoid
// circular imports.
type DevServerManagerRef interface {
    // IsManaged returns true if the plugin has an active dev server instance.
    IsManaged(pluginID string) bool

    // StartDevServer starts a new dev server instance for the given plugin.
    // The plugin must be loaded in dev mode with DevPath set.
    // This is non-blocking -- it spawns goroutines for Vite and Go watcher.
    StartDevServer(pluginID string) error

    // Shutdown stops all running dev server instances. Called during shutdown.
    Shutdown()
}
```

The `devserver.Manager` struct from Phase 2 implements this interface. Its concrete type is:

```go
package devserver

type Manager struct {
    // ... fields from Phase 2 spec
}

func (m *Manager) IsManaged(pluginID string) bool {
    m.mu.RLock()
    defer m.mu.RUnlock()
    _, ok := m.instances[pluginID]
    return ok
}

func (m *Manager) StartDevServer(pluginID string) error {
    // ... implementation from Phase 2 spec
}

func (m *Manager) Shutdown() {
    // ... implementation from Phase 2 spec
}
```

---

## 5. Backward Compatibility

### Old watcher continues for non-managed plugins

The flow for a plugin NOT managed by DevServerManager is completely unchanged:

1. Plugin loaded with `DevMode: true` and `DevPath: "/path/to/source"`
2. `LoadPlugin()` calls `pm.AddTarget(newPlugin.DevPath)` -- registers fsnotify watcher
3. File change fires `handleWatchEvent()`
4. `pm.devServerMgr.IsManaged(meta.ID)` returns `false`
5. Old pipeline runs: `buildAndTransferPlugin()` -> `ReloadPlugin()` -> events emitted

### Graceful fallback when DevServerManager fails

If `StartDevServer()` fails:
- `InstallInDevMode()` logs the error but does NOT return it
- The plugin is still loaded with `DevMode: true`
- `AddTarget()` was already called in `LoadPlugin()`, so the old watcher is active
- Result: plugin works as before, just without HMR

### DevServerManager is optional

If `devServerMgr` is `nil`:
- `handleWatchEvent()` skips the `IsManaged` check (nil guard)
- `InstallInDevMode()` skips the `StartDevServer` call
- `Initialize()` skips the auto-start loop
- `Shutdown()` skips the `Shutdown` call on `devServerMgr`
- Everything works exactly as it does today

This means the DevServerManager can be disabled by passing `nil` to `NewManager()`, which is useful for testing or if the feature is not yet stable.

### Watcher overlap

When DevServerManager IS active for a plugin:
- `AddTarget()` is still called in `LoadPlugin()`, so fsnotify events still fire
- `handleWatchEvent()` calls `IsManaged()` which returns `true`, and returns early
- The old watcher fires events but they are no-ops for managed plugins
- This is intentional: if DevServerManager is later stopped for a plugin, the old watcher can pick up seamlessly

To avoid watcher overhead for managed plugins, an optional optimization (NOT required for correctness) is to call `RemoveTarget()` when `StartDevServer()` succeeds and `AddTarget()` when it stops. This can be added later.

---

## 6. Testing the Integration

### Unit test: handleWatchEvent skips managed plugins

```go
func TestHandleWatchEvent_SkipsManagedPlugin(t *testing.T) {
    // Create a mock DevServerManagerRef
    mockMgr := &mockDevServerMgr{
        managed: map[string]bool{"test-plugin": true},
    }

    pm := &pluginManager{
        logger:       zap.NewNop().Sugar(),
        devServerMgr: mockMgr,
        watchTargets: map[string][]string{
            "/tmp/test-plugin": {"/tmp/test-plugin/pkg", "/tmp/test-plugin/ui"},
        },
    }

    // This should return nil without calling buildAndTransferPlugin
    err := pm.handleWatchEvent(fsnotify.Event{
        Name: "/tmp/test-plugin/pkg/main.go",
        Op:   fsnotify.Write,
    })
    assert.NoError(t, err)
}

type mockDevServerMgr struct {
    managed map[string]bool
}

func (m *mockDevServerMgr) IsManaged(pluginID string) bool {
    return m.managed[pluginID]
}

func (m *mockDevServerMgr) StartDevServer(pluginID string) error {
    return nil
}

func (m *mockDevServerMgr) Shutdown() {}
```

### Integration test: full flow

1. Install a plugin in dev mode
2. Verify DevServerManager.StartDevServer() was called
3. Modify a Go file in the plugin's pkg/ directory
4. Verify handleWatchEvent returns immediately (no build triggered)
5. Stop the dev server for the plugin
6. Modify the same Go file again
7. Verify the old build pipeline runs (buildAndTransferPlugin + ReloadPlugin)

### Manual verification

1. Start the IDE with a dev-mode Kubernetes plugin
2. Verify "auto-starting dev server" log message appears
3. Edit a `.tsx` file -- confirm HMR update (no full rebuild)
4. Edit a `.go` file -- confirm DevServerManager handles the rebuild
5. Check that `buildAndTransferPlugin` is NOT called (add temporary log line)
6. Kill the Vite process -- verify the old watcher picks up UI changes

---

## 7. File Change Summary

| File | Change | Lines Affected |
|------|--------|---------------|
| `backend/pkg/plugin/dev.go` | Add `IsManaged()` guard in `handleWatchEvent()` | ~10 lines added after line 248 |
| `backend/pkg/plugin/manager.go` | Add `devServerMgr` field to struct | 1 line added at line 170 |
| `backend/pkg/plugin/manager.go` | Add `DevServerManagerRef` interface | ~12 lines new |
| `backend/pkg/plugin/manager.go` | Add `devServerMgr` param to `NewManager()` | 1 param added, 1 field added in return |
| `backend/pkg/plugin/manager.go` | Add auto-start loop in `Initialize()` | ~15 lines added after plugin loading |
| `backend/pkg/plugin/manager.go` | Add `StartDevServer()` call in `InstallInDevMode()` | ~10 lines added after `LoadPlugin()` |
| `backend/pkg/plugin/manager.go` | Add `Shutdown()` call on `devServerMgr` in `Shutdown()` | 3 lines added |
| `main.go` | Create `devServerMgr`, pass to `NewManager()`, add to Bind, init in startup | ~10 lines changed |
