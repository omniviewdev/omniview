# Wails v2 to v3 Migration Design — Omniview

**Date**: 2026-03-20
**Branch**: feat/wails3-migration
**Status**: Approved

## Overview

Migrate the Omniview desktop application from Wails v2 (v2.11.0) to Wails v3.
This is not a package bump — Wails v3 is a complete rewrite that changes the
application lifecycle, service model, runtime access patterns, event system,
frontend runtime, dialog/menu/tray APIs, and config structure. The migration
touches 253 Go files, 1,066 frontend TypeScript/JavaScript files, 17 bound
structs, 4 EnumBind arrays, 394+ context references, 25+ event emission sites,
and 30+ frontend event listeners.

## Migration Strategy

**Approach**: Outside-in — stand up the v3 app shell first (entry point, window,
build system, asset handler, menus), get a running app, then migrate services one
at a time. The resource controller goes first as the proving ground since it has
the most complex event patterns (watch states, dynamic event keys, subscription
lifecycle). That validated pattern becomes the template for remaining services.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Binding location | Keep shared package (`packages/omniviewdev-runtime/`) | Preserves existing monorepo architecture; other packages consume bindings |
| Client/controller pairs | Collapse — controllers become v3 services directly | Eliminates thin client wrapper boilerplate |
| Multi-window | Plan from start, implement incrementally | Name windows, create WindowManager, set up routing; settings and devtools are candidates |
| FileLoader | Migrate to asset middleware | Preserves same URL scheme (`/_/` prefix on asset server); no frontend URL changes needed |
| Typed events | Fully adopt `RegisterEvent[T]` for all payloads | Full TypeScript type generation, replaces manual types |
| Context menus | Keep frontend-managed, but register Go-side definitions now | Enables incremental migration to native menus by just adding HTML attributes |
| Build system | Fully replace Makefile with Taskfile | Adopts v3 convention completely |
| EventEmitter abstraction | Keep, update to v3 signature | Testability via `recordingEmitter` is valuable with 25+ emission sites |
| WML | Adopt where it fits | Simple window operations and triggers; complex interactions stay in TypeScript |
| EnumBind | Delete — v3 auto-discovers enums from source | No manual registration needed; generator discovers named types with constants |

## Section 1: App Shell & Entry Point

The monolithic `wails.Run(&options.App{...})` in `main.go` becomes a phased
structure.

### App creation

`application.New(application.Options{...})` with all services registered in the
`Services` array. The 17 bound items become `application.Service` registrations.
EnumBind arrays are deleted entirely — v3's binding generator auto-discovers
enum types.

### Window creation

A separate, explicit step:

```go
mainWindow := app.Window.NewWithOptions(application.WebviewWindowOptions{
    Name:   "main",
    Title:  "Omniview",
    URL:    "/",
    Width:  1920,
    Height: 1080,
    MinWidth:  1280,
    MinHeight: 800,
    BackgroundColour: application.NewRGBA(13, 17, 23, 255),
    Mac: application.MacWindow{
        TitleBar:   application.MacTitleBarHiddenInset,
        Appearance: application.NSAppearanceNameDarkAqua,
        Backdrop:   application.MacBackdropTranslucent,
    },
    Windows: application.WindowsWindow{
        // Windows-specific options
    },
    Linux: application.LinuxWindow{
        WebviewGpuPolicy: application.WebviewGpuPolicyOnDemand,
    },
    Zoom: 1.0,
})
```

### Asset serving

```go
Assets: application.AssetOptions{
    Handler: application.AssetFileServerFS(assets),
}
```

The `FileLoader` custom handler becomes asset middleware (see Section 6).

### Embed directives

`//go:embed all:dist` stays as-is (v3 uses the same pattern). Verify during
implementation that the embed path matches the actual frontend build output
directory — if it changes (e.g., to `ui/dist/`), the embed directive must match.
`//go:embed build/appicon.png` stays for icon embedding.

### Lifecycle decomposition

The 100-line `startup` closure in `main.go:198-298` gets split — each
controller's `Run(ctx)` becomes that service's `ServiceStartup`. Mapping:

| v2 lifecycle | v3 equivalent |
|---|---|
| `OnStartup` (startup closure) | `ServiceStartup` on each service |
| `OnShutdown` (lambda) | `ServiceShutdown` on each service |
| `OnDomReady` (app.domReady) | `window.OnWindowEvent(events.Common.WindowRuntimeReady, ...)` |
| `OnBeforeClose` (app.beforeClose) | `window.RegisterHook(events.Common.WindowClosing, ...)` |

### Platform options

Relocated from app-level to window-level options:

- Mac `TitleBarHiddenInset()` (function) -> `MacTitleBarHiddenInset` (struct field)
- Mac `WebviewIsTransparent`/`WindowIsTranslucent` -> `Backdrop: MacBackdropTranslucent`
- Windows `ZoomFactor: 1.0` -> `WebviewWindowOptions.Zoom = 1.0` (generic)
- Linux `WebviewGpuPolicy` -> `WebviewWindowOptions.Linux.WebviewGpuPolicy`

## Section 2: Service Architecture

### Service conversion table

| Current v2 | v3 Service | Migration notes |
|---|---|---|
| `app` (App struct) | `AppService` | Dialogs move to builder pattern; `FileDialogOptions`/`FileFilter` wrappers removed |
| `diagnosticsClient` | `DiagnosticsService` | Direct service |
| `telemetry.NewTelemetryBinding()` | `TelemetryService` | Already self-contained |
| `settingsProvider` | `SettingsService` | SDK type; thin adapter for `ServiceStartup`. Init (categories, change handlers) moves here |
| `pluginManager` | `PluginManagerService` | `Initialize()` + `Run()` merge into `ServiceStartup`; `Shutdown()` -> `ServiceShutdown()` |
| `pluginLogManager` | `PluginLogService` | Already standalone |
| `devServerManager` | `DevServerService` | `Initialize()` -> `ServiceStartup`; `Shutdown()` -> `ServiceShutdown()` |
| `resourceController` + `resourceClient` | `ResourceService` | Client wrapper deleted; controller is the service |
| `settingsController` + `settingsClient` | `SettingsControllerService` | Same pattern |
| `execController` + `execClient` | `ExecService` | Same pattern |
| `networkerController` + `networkerClient` | `NetworkerService` | Same pattern |
| `logsController` + `logsClient` | `LogsService` | Same pattern |
| `metricController` + `metricClient` | `MetricService` | Same pattern |
| `dataController` + `dataClient` | `DataService` | Same pattern |
| `uiManager` + `uiClient` | `UIService` | Same pattern |
| `utilsClient` | `UtilsService` | Already standalone |

### Context elimination

Every service that stores `context.Context` and receives it via `Run(ctx)` or
`Initialize(ctx)` gets an `*application.App` field instead, set via
`application.Get()` in `ServiceStartup`. The 394+ context references reduce to
app references. Nil context guards (`if ctx == nil { return }`) become nil app
guards or are eliminated entirely.

### Inter-service dependencies

Constructor injections stay — services are still created in `main()` before
`application.New()`. The difference is that `Run(ctx)` calls disappear;
`ServiceStartup` handles initialization automatically.

### Service ordering

v3 calls `ServiceStartup` in registration order and `ServiceShutdown` in
**reverse** registration order. The current startup sequence must be preserved
in the `Services` array. The reverse shutdown order means services registered
last (like `AppService`) shut down first, and foundational services (like
`SettingsService`) shut down last — matching the expected teardown pattern:

1. `SettingsService` (settings init, category registration)
2. `TelemetryService` (hot-toggle wiring, depends on settings)
3. `ResourceService` (controller startup)
4. `ExecService`
5. `LogsService`
6. `MetricService`
7. `NetworkerService`
8. `DataService`
9. `UIService`
10. `UtilsService`
11. `DevServerService` (needs context before plugin manager)
12. `PluginManagerService` (depends on all controllers)
13. `PluginLogService`
14. `SettingsControllerService`
15. `DiagnosticsService`
16. `AppService` (menus, window manager — last)

### Startup closure decomposition

The `startup` closure in `main.go:198-298` splits across services:

- Settings initialization -> `SettingsService.ServiceStartup`
- Telemetry hot-toggle wiring -> `TelemetryService.ServiceStartup`
- Controller `Run(ctx)` calls -> each controller's `ServiceStartup`
- `devServerManager.Initialize(ctx)` -> `DevServerService.ServiceStartup`
- `pluginManager.Initialize(ctx)` + `Run(ctx)` -> `PluginManagerService.ServiceStartup`
- `MenuSetApplicationMenu` -> `AppService.ServiceStartup` using `app.Menu.Set()`

## Section 3: Event System

### Go-side EventEmitter interface

Updated to drop context:

```go
// v3 interface
type EventEmitter interface {
    Emit(eventKey string, data ...any)
}

// Production implementation
type appEmitter struct {
    app *application.App
}

func newAppEmitter(app *application.App) *appEmitter {
    return &appEmitter{app: app}
}

func (e *appEmitter) Emit(eventKey string, data ...any) {
    e.app.Event.Emit(eventKey, data...)  // Emit returns bool (true if cancelled by hook); interface ignores it
}

// Test implementation
type recordingEmitter struct {
    events []emittedEvent
    mu     sync.Mutex
}

func (e *recordingEmitter) Emit(eventKey string, data ...any) {
    e.mu.Lock()
    defer e.mu.Unlock()
    e.events = append(e.events, emittedEvent{eventKey, data})
}
```

The `emitEvent()` helper and replaceable `eventEmitFn` var in `events.go` are
replaced by the interface-based approach.

### Typed event registration

All event constants with defined payloads get `RegisterEvent[T]` in `init()`:

```go
func init() {
    application.RegisterEvent[StateChangePayload](EventStateChange)
    application.RegisterEvent[DeprecatedProtocolPayload](EventDeprecatedProtocol)
    // resource events, exec stream events, log events, metric events, etc.
}
```

Dynamic event keys (e.g., `${pluginID}/${connectionID}/${resourceKey}/ADD`) register
the base event type once; string interpolation at emit time.

For events that carry no data, use `application.Void`:

```go
application.RegisterEvent[application.Void](EventInitComplete)
```

### Event listener cleanup

Go services that register listeners via `app.Event.On()` or `app.Event.Once()`
store cleanup functions in a `[]func()` slice, called during `ServiceShutdown()`.
Both `On()` and `Once()` return cleanup functions that must be captured.
`Once()` auto-unsubscribes after the first call but the cleanup function is still
needed if the service shuts down before the event fires:

```go
type MyService struct {
    app      *application.App
    cleanups []func()
}

func (s *MyService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
    s.app = application.Get()
    cleanup := s.app.Event.On("event:name", func(e *application.CustomEvent) {
        // handle
    })
    s.cleanups = append(s.cleanups, cleanup)
    return nil
}

func (s *MyService) ServiceShutdown() error {
    for _, cleanup := range s.cleanups {
        cleanup()
    }
    return nil
}
```

### Frontend event migration

```typescript
// v2
import { EventsOn, EventsEmit, EventsOff } from '@omniviewdev/runtime/runtime'
EventsOn("name", (data) => { ... })

// v3
import { Events } from '@wailsio/runtime'
const cleanup = Events.On("name", (event) => {
    const data = event.data  // unwrap from event object
})
```

Existing `useEffect` + cleanup patterns map cleanly. Key change is unwrapping
`event.data` instead of receiving raw payload.

### Concurrency consideration

v3 dispatches each listener callback in its own goroutine — no ordering
guarantees. The exec controller's stream events and resource controller's watch
state events need verification during implementation. If ordering is required,
the listener should buffer and sequence internally.

## Section 4: Frontend Migration

### Binding imports

Generated into `packages/omniviewdev-runtime/src/bindings/` via
`wails3 generate bindings`. Import paths change:

```typescript
// v2
import { SubscribeResource } from '@omniviewdev/runtime/wailsjs/go/resource/Client'

// v3
import { SubscribeResource } from '@omniviewdev/runtime/bindings/resource/ResourceService'
```

### Runtime imports

Custom runtime wrapper at `packages/omniviewdev-runtime/src/wailsjs/runtime/`
replaced by `@wailsio/runtime`. The `omniviewdev-runtime` package re-exports:

```typescript
export { Events, Window, Clipboard, Browser, Application } from '@wailsio/runtime'
```

Existing hooks update internal imports; their public API stays the same.

### Vite plugin

```typescript
import wails from '@wailsio/runtime/plugins/vite'

export default defineConfig({
    plugins: [react(), wails('./bindings')],
})
```

### WML adoption

Simple window operations use declarative attributes:

```html
<button wml-window="Reload">Reload</button>
<button wml-window="Close">Close</button>
```

Complex interactions (resource subscriptions, exec streams) stay in TypeScript.

**Important**: `WML.Reload()` must be called after React DOM updates for WML
attributes to be picked up. Use `useEffect(() => { WML.Reload(); }, [])` in
components that use WML attributes.

### Package updates

- Add `@wailsio/runtime` to `package.json`
- Delete old `packages/omniviewdev-runtime/src/wailsjs/` directory after migration
- Generated type models from v3 binding generator replace manual `models.ts`

## Section 5: Menu System

### App menus

Menus created via `app.NewMenu()` with `OnClick` callbacks:

```go
func SetupMenus(app *application.App, window *application.WebviewWindow) {
    menu := app.NewMenu()

    if runtime.GOOS == "darwin" {
        menu.AddRole(application.AppMenu)
        menu.AddRole(application.EditMenu)
        menu.AddRole(application.WindowMenu)
    }

    viewMenu := menu.AddSubmenu("View")
    viewMenu.Add("Reload").SetAccelerator("CmdOrCtrl+R").OnClick(func(ctx *application.Context) {
        window.Reload()
    })
    // ...
    app.Menu.Set(menu)
}
```

Key changes:
- No `context.Context` parameter
- `menu.CallbackData` -> `*application.Context`
- `keys.CmdOrCtrl("r")` -> `SetAccelerator("CmdOrCtrl+R")`
- `menu.AppMenu()` -> `AddRole(application.AppMenu)`

### Package structure

```
backend/menus/
├── app.go          # Application menu (View menu, role menus)
├── keybindings.go  # Standalone key bindings
└── context.go      # Context menu registration (Go-side definitions)
```

### Context menu readiness

Go-side context menus are defined and registered via
`app.RegisterContextMenu("id", menu)` during this migration. The frontend
doesn't use them yet — the CSS custom properties
(`style="--custom-contextmenu: id"`) get added in a future sprint. Having the
Go-side definitions ready means future migration is just adding CSS properties
to HTML elements, no backend work needed.

```go
// context.go — register menus now, wire to frontend later
editorMenu := app.NewContextMenu()
editorMenu.Add("Cut").OnClick(cutHandler)
editorMenu.Add("Copy").OnClick(copyHandler)
editorMenu.Add("Paste").OnClick(pasteHandler)
app.RegisterContextMenu("editor", editorMenu)
```

```html
<!-- Future: just add CSS property to trigger -->
<div style="--custom-contextmenu: editor">Right-click for options</div>
```

During implementation, identify all frontend-managed context menus and create
corresponding Go-side definitions.

### Standalone key bindings

View menu items that exist primarily as shortcuts (terminal create, drawer toggle,
sidebar toggle) get `app.KeyBinding.Add()` in addition to menu items. Decouples
shortcuts from the menu and supports per-window behavior in the future.

## Section 6: FileLoader as Asset Middleware

The `FileLoader` custom asset handler migrates to v3's `AssetOptions.Middleware`
field. This preserves the existing URL scheme — frontend `fetch("/_/...")` calls
continue to work without changes. Using a routed service would change URLs to
`http://wails.localhost/_/...` which would break existing frontend references.

```go
Assets: application.AssetOptions{
    Handler: application.AssetFileServerFS(assets),
    Middleware: func(next http.Handler) http.Handler {
        pluginAssetHandler := NewPluginAssetHandler(log)
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if strings.HasPrefix(r.URL.Path, "/_/") {
                pluginAssetHandler.ServeHTTP(w, r)
                return
            }
            next.ServeHTTP(w, r)
        })
    },
}
```

The `PluginAssetHandler` (renamed from `FileLoader`) keeps the same security
logic: allowlist regex, path containment under `~/.omniview`, MIME type forcing,
no-cache for `remoteEntry.js`. The struct is simplified — it no longer needs to
embed `http.Handler` since it's not used as a standalone handler. It no longer
needs Wails context since v3 middleware receives standard `http.Request`.

## Section 7: Multi-Window Architecture

### Window naming

Every window gets a name at creation for `app.Window.GetByName()` access.
Main window is named `"main"`.

### WindowManager with main window recycling

Internal helper (not a v3 service) that centralizes window creation and
implements **hide-on-close for the main window**. The main window holds all
application state and is expensive to recreate — closing it hides to tray/dock
instead of quitting. Secondary windows (settings, devtools) are ephemeral and
close normally since they're cheap to recreate.

```go
type WindowManager struct {
    app *application.App
}

func NewWindowManager(app *application.App, main *application.WebviewWindow) *WindowManager {
    wm := &WindowManager{app: app}
    wm.registerMainWindowHideOnClose(main)
    return wm
}

func (wm *WindowManager) Main() *application.WebviewWindow {
    return wm.app.Window.GetByName("main")
}

// registerMainWindowHideOnClose intercepts close on the main window,
// hiding it instead of quitting the app. Re-show from tray/dock.
func (wm *WindowManager) registerMainWindowHideOnClose(w *application.WebviewWindow) {
    w.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
        w.Hide()
        e.Cancel()  // prevent quit — app stays alive in tray/dock
    })
}

// OpenSettings creates a fresh settings window. Closes normally.
func (wm *WindowManager) OpenSettings() *application.WebviewWindow {
    return wm.app.Window.NewWithOptions(application.WebviewWindowOptions{
        Name:   "settings",
        Title:  "Settings — Omniview",
        URL:    "/#/settings",
        Width:  900,
        Height: 700,
        UseApplicationMenu: true,
    })
}

func (wm *WindowManager) OpenDevtools() *application.WebviewWindow { /* same pattern */ }
```

This follows the [Wails v3 documented best practice](~/Repos/wails/docs/src/content/docs/features/windows/multiple.mdx)
for efficient window management. The main window is the primary candidate for
recycling since it holds all the app state and plugin connections. Secondary
windows are stateless and close/recreate naturally.

### WindowPool for detachable panels (future)

For the future detachable panels feature (popping out terminals, log viewers,
etc.), a `WindowPool` should be used to efficiently manage multiple ephemeral
windows of the same type. The pool hides released windows instead of destroying
them and reuses them on acquire:

```go
type WindowPool struct {
    app       *application.App
    available []*application.WebviewWindow
    inUse     map[uint]*application.WebviewWindow
    mu        sync.Mutex
}

func (wp *WindowPool) Acquire(opts application.WebviewWindowOptions) *application.WebviewWindow {
    wp.mu.Lock()
    defer wp.mu.Unlock()

    // Reuse a hidden window if available
    if len(wp.available) > 0 {
        w := wp.available[len(wp.available)-1]
        wp.available = wp.available[:len(wp.available)-1]
        wp.inUse[w.ID()] = w
        w.SetURL(opts.URL)
        w.SetTitle(opts.Title)
        w.Show()
        return w
    }

    // Create new window
    w := wp.app.Window.NewWithOptions(opts)
    wp.inUse[w.ID()] = w
    w.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
        wp.Release(w)
        e.Cancel()
    })
    return w
}

func (wp *WindowPool) Release(w *application.WebviewWindow) {
    wp.mu.Lock()
    defer wp.mu.Unlock()
    delete(wp.inUse, w.ID())
    w.Hide()
    wp.available = append(wp.available, w)
}
```

The `WindowManager` should be structured so that `WindowPool` can be integrated
later without changing the manager's public API. The pool is NOT implemented in
this migration — it is documented here so the architecture supports it.

### Window-scoped events

All events broadcast via `app.Event.Emit()` initially (matching current
single-window behavior). Per-window targeting via `window.EmitEvent()` available
when needed.

### Frontend routing

React app supports different URL paths (`/`, `/settings`, `/devtools`). Each
window loads the same frontend bundle at a different route. Uses hash routing
(`/#/settings`, `/#/devtools`) to match the existing `createHashRouter` setup.

### Phase 1 (this migration)

Only main window created with hide-on-close recycling (hides to tray/dock
instead of quitting). `WindowManager` implemented with `Main()`,
`OpenSettings()`, `OpenDevtools()` ready but not wired into menus. Frontend
routing set up so routes render correctly.

### Future work

- Wire menu items and key bindings to open secondary windows
- Add window-scoped event targeting
- Implement `WindowPool` for detachable panels: popping out terminal sessions,
  log viewers, etc. into pooled windows (e.g., `/#/detached/terminal/{id}`)

## Section 8: Build System

### Structure

```
Taskfile.yml                    # Root orchestrator
build/
├── config.yml                  # Project metadata, dev mode config
├── appicon.png                 # App icon source
├── Taskfile.yml                # Common tasks (frontend, bindings, icons)
├── darwin/
│   ├── Taskfile.yml            # macOS build/package/sign/notarize
│   └── Info.plist
├── windows/
│   ├── Taskfile.yml            # Windows build/package
│   └── info.json
└── linux/
    └── Taskfile.yml            # Linux build/package
```

### Task mapping from Makefile

| Makefile target | Taskfile task |
|---|---|
| `make dev` | `task dev` |
| `make build` | `task build` |
| `make go-build` | `task check:go-build` |
| `make go-vet` | `task check:go-vet` |
| `make go-test` | `task check:go-test` |
| `make go-lint` | `task check:go-lint` |
| `make bindings` | `task common:bindings` |
| `make bindings-check` | `task check:bindings` |
| `make ui-install` | `task common:frontend:install` |
| `make ui-build` | `task common:frontend:build` |
| `make ui-lint` | `task check:ui-lint` |
| `make ui-typecheck` | `task check:ui-typecheck` |
| `make check` | `task check` (runs all) |
| `make packages` | `task common:packages` |
| `make sign` | `task darwin:sign` |
| `make notarize` | `task darwin:notarize` |

### config.yml

```yaml
version: '3'
info:
  companyName: "Omniview"
  productName: "Omniview"
  productIdentifier: "dev.omniview.app"
  description: "The modern, lightweight, pluggable cross-platform IDE for DevOps engineers"
  version: "0.0.1"

dev_mode:
  root_path: .
  log_level: warn
  debounce: 1000
  ignore:
    dir: [.git, node_modules, frontend, bin, dist, packages]
    file: [.DS_Store, .gitignore]
    watched_extension: ["*.go"]
    git_ignore: true
```

### CI updates

`.github/workflows/pr-checks.yml` changes from `make` targets to `task` targets.
`go-task` installed in CI via `go install github.com/go-task/task/v3/cmd/task@latest`
or GitHub Action.

### .gitignore additions

- `.task` (Task runner checksum cache)

### Files to delete

- `wails.json`
- `Makefile`

## Section 9: Migration Phases

### Phase 1: App Shell

- Convert `main.go` to `application.New()` + `app.Run()`
- Create main window with name `"main"` and all current options (including `UseApplicationMenu: true` for Windows/Linux)
- Set up `Taskfile.yml` + `build/config.yml`; delete `wails.json` and `Makefile`
- Migrate `FileLoader` -> `PluginAssetHandler` as asset middleware
- Migrate menus to v3 API; set up `menus/` package (app menus, keybindings, context menu stubs)
- Set up `WindowManager` with `Main()`, stubbed `OpenSettings()`, `OpenDevtools()`
- Update Go module dependency to Wails v3
- Install `@wailsio/runtime` npm dependency and add Wails Vite plugin to `vite.config.ts` (required before any frontend migration in later phases)
- **Checkpoint**: App boots with `task dev`, main window renders, menus work, plugin assets load

### Phase 2: Event System Foundation

- Update `EventEmitter` interface to v3 signature (drop context)
- Create `appEmitter` using `*application.App`
- Update `recordingEmitter` for tests
- Remove `eventEmitFn` var and `emitEvent()` helper
- Add `RegisterEvent[T]` calls in `init()` for all typed event payloads
- **Checkpoint**: Go compiles, existing tests pass with updated `recordingEmitter`

### Phase 3: Resource Controller (Proving Ground)

- Collapse `resource.Controller` + `resource.Client` into `ResourceService`
- Replace stored `context.Context` with `*application.App`
- Migrate all resource event emission to v3 patterns
- Update frontend hooks (`useResources`, `useConnections`) to `@wailsio/runtime`
- Update frontend binding imports to new paths
- **Checkpoint**: Resource subscription, watch states, ADD/UPDATE/DELETE events work end-to-end

### Phase 4: Remaining Services

Migrate in dependency order, each following Phase 3 pattern. Names below use
the v3 service names from the conversion table in Section 2:

1. `settingsController + settingsClient` -> `SettingsControllerService`
2. `execController + execClient` -> `ExecService`
3. `logsController + logsClient` -> `LogsService`
4. `metricController + metricClient` -> `MetricService`
5. `networkerController + networkerClient` -> `NetworkerService`
6. `dataController + dataClient` -> `DataService`
7. `uiManager + uiClient` -> `UIService`
8. `utilsClient` -> `UtilsService`
9. `pluginManager` -> `PluginManagerService`
10. `devServerManager` -> `DevServerService`
11. `diagnosticsClient` -> `DiagnosticsService`
12. `telemetry.NewTelemetryBinding()` -> `TelemetryService`
13. `settingsProvider` -> `SettingsService` (adapter)
14. `pluginLogManager` -> `PluginLogService`
15. `app` -> `AppService`

**Checkpoint** per service: methods callable from frontend, events flow correctly.

### Phase 5: Frontend Finalization

- Update `packages/omniviewdev-runtime` exports (re-export v3 runtime types)
- Delete old `wailsjs/` directory
- Set up frontend routing for multi-window readiness
- Add WML attributes where appropriate
- Run `wails3 generate bindings` and verify TypeScript types
- **Checkpoint**: Full app works end-to-end

### Phase 6: Cleanup & CI

- Verify zero remaining `github.com/wailsapp/wails/v2` imports
- Update `.github/workflows/pr-checks.yml` for Taskfile
- Update `.gitignore`
- Run full migration review checklist
- **Checkpoint**: `task build` succeeds, `task check` passes, production build works

## Review Checklist

- [ ] No remaining `github.com/wailsapp/wails/v2` imports
- [ ] No `wails.Run(...)` — replaced with `application.New(...)` + `app.Run()`
- [ ] App type is `*application.App` not `*application.Application`
- [ ] Services registered via `application.NewService(...)` or `application.NewServiceWithOptions(...)`
- [ ] Old `startup(ctx)` replaced with `ServiceStartup(ctx, options) error`
- [ ] `ServiceShutdown()` takes no parameters
- [ ] Runtime calls use object methods, not `runtime.Something(ctx, ...)`
- [ ] Dialogs use builder pattern, not direct function calls
- [ ] Frontend imports use `./bindings/...` not `wailsjs/...`
- [ ] Frontend runtime from `@wailsio/runtime` not `../wailsjs/runtime/runtime`
- [ ] Go event handlers receive `*application.CustomEvent`, not `func(data ...interface{})`
- [ ] Frontend event handlers unwrap `event.data`
- [ ] Event listeners use cleanup functions from `On()`, not `Off(name)`
- [ ] Typed events registered via `RegisterEvent[T](name)` in `init()`
- [ ] `wails.json` deleted, replaced with `build/config.yml` + `Taskfile.yml`
- [ ] `Makefile` deleted, all targets migrated to Taskfile
- [ ] Embed directive uses `//go:embed all:dist` (keep `all:` prefix)
- [ ] Vite config uses `@wailsio/runtime/plugins/vite`
- [ ] `.gitignore` includes `.task`
- [ ] CLI commands use `task dev` / `task build`
- [ ] Context menus defined in Go via `app.RegisterContextMenu()` with CSS `--custom-contextmenu`
- [ ] Windows on Windows/Linux use `UseApplicationMenu: true` in window options
- [ ] `WindowManager` implemented with named windows and hide-on-close recycling for main window
- [ ] Frontend routing supports `/`, `/settings`, `/devtools` paths
- [ ] All test code uses `testify` (`assert`/`require`) — no raw `t.Fatalf`/`t.Errorf` in modified files
