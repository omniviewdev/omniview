# Wails v3 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Omniview desktop application from Wails v2 (v2.11.0) to Wails v3, converting 17 bound structs to services, eliminating 394+ context references, updating the event system, migrating frontend bindings, and replacing the Makefile/wails.json build system with Taskfile.

**Architecture:** Outside-in migration — stand up the v3 app shell first (entry point, window, build system, asset middleware, menus), then migrate the event system, then convert services one at a time starting with the resource controller as the proving ground. Each phase has a verification checkpoint.

**Tech Stack:** Go 1.26, Wails v3 (`github.com/wailsapp/wails/v3`), React 19, TypeScript 5.8, Vite 6, `@wailsio/runtime`, pnpm, Taskfile (go-task)

**Testing:** All test code MUST use `github.com/stretchr/testify` (`assert` and `require` sub-packages). Do not use raw `t.Fatalf`, `t.Errorf`, or `if != expected` patterns. The codebase has 13 test files with inconsistent raw assertions — if any of these files are modified during migration, convert their assertions to testify.

**Spec:** `docs/superpowers/specs/2026-03-20-wails3-migration-design.md`

**Wails v3 API References:** Located at `~/.claude/skills/wails-v3-migrator/references/` — consult `api-application.md`, `api-windows.md`, `api-events.md`, `api-menus.md`, `api-frontend-runtime.md`, `api-build-system.md`, and `api-platform-options.md` for exact API signatures when implementing each task.

---

## File Structure

### Files to Create

```
Taskfile.yml                                    # Root build orchestrator (dev, build, package, run, check)
build/config.yml                                # Project metadata, dev mode config (replaces wails.json)
build/Taskfile.yml                              # Common tasks (frontend build, bindings, icons)
build/darwin/Taskfile.yml                        # macOS build/package/sign/notarize
build/darwin/Info.plist                           # macOS app metadata
build/windows/Taskfile.yml                       # Windows build/package
build/windows/info.json                          # Windows app metadata
build/linux/Taskfile.yml                         # Linux build/package
backend/menus/app.go                             # v3 application menu (replaces menus.go + view.go)
backend/menus/keybindings.go                     # Standalone key bindings
backend/menus/context.go                         # Go-side context menu definitions
backend/window/manager.go                        # WindowManager helper
```

### Files to Modify

```
main.go                          # Complete rewrite: application.New() + app.Run()
app.go                           # Rewrite: AppService with dialog builders, remove ctx
fileloader.go                    # Rename to plugin_asset_handler.go, remove http.Handler embed
go.mod                           # wails/v2 -> wails/v3 dependency
vite.config.ts                   # Add @wailsio/runtime/plugins/vite plugin
package.json                     # Add @wailsio/runtime dependency
.gitignore                       # Add .task

backend/pkg/plugin/events.go                     # Remove eventEmitFn, update emitEvent
backend/pkg/plugin/resource/emitter.go           # v3 EventEmitter interface (drop ctx)
backend/pkg/plugin/resource/testutil_test.go     # Update recordingEmitter signature
backend/pkg/plugin/resource/emitter_test.go      # Update interface tests
backend/pkg/plugin/resource/controller.go        # Run() -> ServiceStartup(), add app field
backend/pkg/plugin/resource/client.go            # DELETE (collapse into controller)
backend/pkg/plugin/exec/controller.go            # Replace ctx with app, EventsEmit -> emitter
backend/pkg/plugin/exec/client.go                # DELETE
backend/pkg/plugin/logs/controller.go            # Replace ctx with app, EventsEmit -> emitter
backend/pkg/plugin/logs/client.go                # DELETE
backend/pkg/plugin/metric/controller.go          # Replace ctx with app
backend/pkg/plugin/metric/client.go              # DELETE
backend/pkg/plugin/networker/controller.go       # Replace ctx with app
backend/pkg/plugin/networker/client.go           # DELETE
backend/pkg/plugin/settings/controller.go        # Add ServiceStartup
backend/pkg/plugin/settings/client.go            # DELETE
backend/pkg/plugin/data/controller.go            # Add ServiceStartup
backend/pkg/plugin/data/client.go                # DELETE
backend/pkg/plugin/ui/client.go                  # DELETE (merge into manager)
backend/pkg/plugin/utils/client.go               # Add ServiceStartup
backend/pkg/plugin/manager.go                    # Replace ctx with app, ServiceStartup/Shutdown
backend/pkg/plugin/installer.go                  # Remove wails/v2/pkg/runtime import, update event calls
backend/pkg/plugin/devserver/manager.go          # Replace ctx with app, ServiceStartup/Shutdown
backend/pkg/plugin/pluginlog/pluginlog.go        # Update OnEmit callback pattern for v3
backend/diagnostics/logger.go                    # Replace runtime.EventsEmit with emitter

packages/omniviewdev-runtime/src/api.ts          # Update binding paths
packages/omniviewdev-runtime/src/runtime.ts      # Re-export @wailsio/runtime
packages/omniviewdev-runtime/package.json        # Add @wailsio/runtime dep, update exports
```

### Files to Delete

```
wails.json                                       # Replaced by build/config.yml + Taskfile.yml
Makefile                                         # Replaced by Taskfile.yml
backend/menus/menus.go                           # Replaced by backend/menus/app.go
backend/menus/view.go                            # Merged into backend/menus/app.go
packages/omniviewdev-runtime/src/wailsjs/        # Entire directory (replaced by bindings/)
```

---

## Task 1: Install Wails v3 CLI and go-task

**Files:**
- None (tooling setup)

- [ ] **Step 1: Install Wails v3 CLI**

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@latest
```

Verify: `wails3 version` prints version info.

- [ ] **Step 2: Install go-task**

```bash
go install github.com/go-task/task/v3/cmd/task@latest
```

Verify: `task --version` prints version info.

- [ ] **Step 3: Install @wailsio/runtime npm package**

```bash
pnpm add @wailsio/runtime
```

Verify: `pnpm ls @wailsio/runtime` shows installed version.

---

## Task 2: Create Taskfile build system

**Files:**
- Create: `Taskfile.yml`
- Create: `build/config.yml`
- Create: `build/Taskfile.yml`
- Create: `build/darwin/Taskfile.yml`
- Create: `build/darwin/Info.plist`
- Create: `build/windows/Taskfile.yml`
- Create: `build/windows/info.json`
- Create: `build/linux/Taskfile.yml`
- Modify: `.gitignore`

Reference `~/.claude/skills/wails-v3-migrator/references/api-build-system.md` for the complete Taskfile structure, config.yml format, and platform-specific build tasks.

- [ ] **Step 1: Scaffold Taskfile structure**

Generate a reference v3 project in a temp directory to get the canonical Taskfile structure:

```bash
cd /tmp && wails3 init -n omniview-ref -t vanilla
```

Copy the `Taskfile.yml` and `build/` directory structure from the generated project. These will serve as the base templates.

- [ ] **Step 2: Create root Taskfile.yml**

Create `Taskfile.yml` at the project root. This is the main orchestrator that replaces the Makefile. It must include:

- `includes` for `common`, `windows`, `darwin`, `linux` subtaskfiles
- `vars` section with `APP_NAME: "Omniview"`, `BIN_DIR: "bin"`, `VITE_PORT`
- Tasks: `build`, `package`, `run`, `dev` (delegates to platform-specific or `wails3 dev`)
- CI check tasks: `check` (runs all), `check:go-build`, `check:go-vet`, `check:go-test`, `check:go-lint`, `check:fmt`, `check:bindings`, `check:ui-lint`, `check:ui-typecheck`
- Frontend tasks: `common:frontend:install`, `common:frontend:build`, `common:packages`
- Signing tasks: `darwin:sign`, `darwin:notarize`

Replicate all targets from the current `Makefile` (see `Makefile:1-163`). Key translations:
- `GOWORK=off go build ./...` stays the same in Taskfile commands
- `pnpm install --frozen-lockfile` for `common:frontend:install`
- `pnpm build` for `common:frontend:build`
- `wails3 generate bindings` for `common:bindings` (replaces `wails generate module`)
- E2E tasks: `e2e`, `e2e-ui`, `e2e-report` for Playwright

- [ ] **Step 3: Create build/config.yml**

Create `build/config.yml` with project metadata. Reference `api-build-system.md` for format:

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
  executes:
    - cmd: wails3 build DEV=true
      type: blocking
    - cmd: wails3 task common:dev:frontend
      type: background
    - cmd: wails3 task run
      type: primary
```

- [ ] **Step 4: Create build/Taskfile.yml (common tasks)**

Reference the scaffolded project from Step 1. Include:
- `build:frontend` — `pnpm install && pnpm build`
- `dev:frontend` — `pnpm dev`
- `bindings` — `wails3 generate bindings`
- `icons` — `wails3 generate icons`
- Workspace package build tasks (providers, vite-plugin, ui, runtime — in order)

- [ ] **Step 5: Create platform Taskfiles**

Create `build/darwin/Taskfile.yml`, `build/windows/Taskfile.yml`, `build/linux/Taskfile.yml`. Each needs:
- `build` — platform-specific Go build with correct `-o` flag and ldflags
- `package` — create platform bundle (.app, NSIS installer, AppImage)
- `run` — execute the built binary
- For darwin: `sign` and `notarize` tasks (port from `Makefile:126-149`)

Create `build/darwin/Info.plist` and `build/windows/info.json` with app metadata. Reference the scaffolded project.

- [ ] **Step 6: Update .gitignore**

Add to `.gitignore`:
```
.task
```

- [ ] **Step 7: Verify Taskfile works**

```bash
task --list
```

Expected: all tasks listed without errors.

- [ ] **Step 8: Delete Makefile and wails.json**

```bash
rm Makefile wails.json
```

- [ ] **Step 9: Commit**

```bash
git add Taskfile.yml build/ .gitignore
git rm Makefile wails.json
git commit -m "build: replace Makefile and wails.json with Taskfile build system"
```

---

## Task 3: Update Go module dependency to Wails v3

**Files:**
- Modify: `go.mod`
- Modify: `go.sum`

- [ ] **Step 1: Replace Wails v2 dependency with v3**

```bash
go get github.com/wailsapp/wails/v3@latest
```

This will update `go.mod` from `github.com/wailsapp/wails/v2 v2.11.0` to the v3 module path.

- [ ] **Step 2: Remove old v2 dependency**

```bash
go mod edit -droprequire github.com/wailsapp/wails/v2
go mod tidy
```

Note: The code won't compile yet — that's expected. This step just gets the dependency in place.

- [ ] **Step 3: Commit**

```bash
git add go.mod go.sum
git commit -m "deps: switch from wails/v2 to wails/v3"
```

---

## Task 4: Migrate EventEmitter interface to v3

**Files:**
- Modify: `backend/pkg/plugin/resource/emitter.go`
- Modify: `backend/pkg/plugin/resource/testutil_test.go`
- Modify: `backend/pkg/plugin/resource/emitter_test.go`
- Modify: `backend/pkg/plugin/events.go`

This task updates the event abstraction layer to the v3 API. No Wails app reference needed yet — the interface changes are pure Go.

- [ ] **Step 1: Update EventEmitter interface signature**

Edit `backend/pkg/plugin/resource/emitter.go`. The interface changes from single `data interface{}` to variadic `data ...any`. The `wailsEmitter` implementation changes from storing `context.Context` to storing `*application.App`:

```go
package resource

import (
	"github.com/wailsapp/wails/v3/pkg/application"
)

// EventEmitter abstracts event emission for testability.
// Production uses appEmitter; tests use recordingEmitter.
type EventEmitter interface {
	Emit(eventKey string, data ...any)
}

// appEmitter emits events via the Wails v3 application event system.
type appEmitter struct {
	app *application.App
}

func newAppEmitter(app *application.App) *appEmitter {
	return &appEmitter{app: app}
}

func (e *appEmitter) Emit(eventKey string, data ...any) {
	e.app.Event.Emit(eventKey, data...)
}

// noopEmitter discards all events. Used before the app is initialized.
type noopEmitter struct{}

func (noopEmitter) Emit(string, ...any) {}
```

- [ ] **Step 2: Update recordingEmitter in tests**

Edit `backend/pkg/plugin/resource/testutil_test.go`. Change `Emit` signature to match new interface:

```go
type emittedEvent struct {
	Key  string
	Data []any  // Changed from interface{} to []any (variadic capture)
}

func (e *recordingEmitter) Emit(key string, data ...any) {
	e.mu.Lock()
	e.events = append(e.events, emittedEvent{Key: key, Data: data})
	close(e.changed)
	e.changed = make(chan struct{})
	e.mu.Unlock()
}
```

Also update all test assertions that check `.Data` — it's now a `[]any` slice, not a single `interface{}`. For example, in `TestRecordingEmitter_EmitAndEvents`:

```go
assert.Equal(t, []any{"data-1"}, events[0].Data)
```

Update `TestRecordingEmitter_WaitForEvent_Immediate`, `TestRecordingEmitter_WaitForEvent_Async`, etc. similarly.

- [ ] **Step 3: Update emitter_test.go**

Edit `backend/pkg/plugin/resource/emitter_test.go` to verify the new interface is implemented correctly. The compile-time checks should reference `appEmitter` instead of `wailsEmitter`:

```go
var _ EventEmitter = (*appEmitter)(nil)
var _ EventEmitter = (*recordingEmitter)(nil)
var _ EventEmitter = noopEmitter{}
```

- [ ] **Step 4: Update events.go — remove eventEmitFn and emitEvent**

Edit `backend/pkg/plugin/events.go`. Remove the global `eventEmitFn` variable and `emitEvent` helper. The plugin package will use the `EventEmitter` interface directly instead:

Remove lines 67-78 (the `eventEmitFn` var and `emitEvent` function). The `emitStateChange` function should accept an `EventEmitter` parameter instead of `context.Context`:

```go
// emitStateChange emits a state change event via the provided emitter.
func emitStateChange(emitter resource.EventEmitter, pluginID string, t lifecycle.Transition) {
	if emitter == nil {
		return
	}
	emitter.Emit(EventStateChange, StateChangePayload{
		PluginID:  pluginID,
		From:      t.From,
		To:        t.To,
		Reason:    t.Reason,
		Timestamp: t.Timestamp,
	})
}
```

Remove the `github.com/wailsapp/wails/v2/pkg/runtime` import from this file.

- [ ] **Step 5: Run tests**

```bash
cd backend/pkg/plugin/resource && go test ./... -count=1 -v
```

Expected: All existing tests pass with the updated emitter signatures.

- [ ] **Step 6: Commit**

```bash
git add backend/pkg/plugin/resource/emitter.go backend/pkg/plugin/resource/testutil_test.go \
       backend/pkg/plugin/resource/emitter_test.go backend/pkg/plugin/events.go
git commit -m "refactor: update EventEmitter interface and helpers for wails v3"
```

---

## Task 5: Add typed event registration

**Files:**
- Modify: `backend/pkg/plugin/events.go`
- Modify: Each controller file that defines event payload types

- [ ] **Step 1: Add RegisterEvent calls to events.go init()**

Add an `init()` function to `backend/pkg/plugin/events.go` that registers typed events for TypeScript generation. Reference `~/.claude/skills/wails-v3-migrator/references/api-events.md` for `RegisterEvent[T]` API:

```go
func init() {
	application.RegisterEvent[StateChangePayload](EventStateChange)
	application.RegisterEvent[DeprecatedProtocolPayload](EventDeprecatedProtocol)
	application.RegisterEvent[application.Void](EventInstallStarted)
	application.RegisterEvent[application.Void](EventInstallFinished)
	application.RegisterEvent[application.Void](EventInstallError)
	application.RegisterEvent[application.Void](EventDevInstallStart)
	application.RegisterEvent[application.Void](EventDevInstallError)
	application.RegisterEvent[application.Void](EventDevInstallComplete)
	application.RegisterEvent[application.Void](EventReloadStart)
	application.RegisterEvent[application.Void](EventReloadError)
	application.RegisterEvent[application.Void](EventReloadComplete)
	application.RegisterEvent[application.Void](EventUpdateStarted)
	application.RegisterEvent[application.Void](EventUpdateError)
	application.RegisterEvent[application.Void](EventUpdateComplete)
	application.RegisterEvent[application.Void](EventInitComplete)
	application.RegisterEvent[application.Void](EventCrashRecoveryFailed)
	application.RegisterEvent[application.Void](EventRecovered)
	application.RegisterEvent[application.Void](EventStateWriteError)
}
```

- [ ] **Step 2: Add typed registrations in each controller package**

For each controller that defines event payload types, add `RegisterEvent[T]` calls in `init()`. Search each controller package for event key constants and payload structs. The exact types need to be discovered per-controller during implementation.

Key packages to check:
- `backend/pkg/plugin/exec/` — exec stream output events
- `backend/pkg/plugin/logs/` — log stream events
- `backend/pkg/plugin/metric/` — metric data events
- `backend/pkg/plugin/networker/` — port-forward session events (lines 29-30)
- `backend/pkg/plugin/devserver/` — dev server status/log/error events

- [ ] **Step 3: Verify compilation**

```bash
GOWORK=off go build ./...
```

Expected: Compiles (may have other errors from unmigrated code — that's OK, this just checks the event registration compiles).

- [ ] **Step 4: Commit**

```bash
git add backend/pkg/plugin/events.go backend/pkg/plugin/*/
git commit -m "feat: add typed event registration for v3 TypeScript generation"
```

---

## Task 6: Migrate main.go entry point to v3

**Files:**
- Modify: `main.go` (major rewrite)
- Modify: `app.go` (rewrite to AppService)
- Modify: `fileloader.go` (rename, restructure as middleware handler)

This is the largest single task. It converts the monolithic `wails.Run()` call to v3's phased structure.

Reference `~/.claude/skills/wails-v3-migrator/references/api-application.md` for `application.Options`, `ServiceStartup`, service registration. Reference `api-windows.md` for `WebviewWindowOptions`. Reference `api-platform-options.md` for Mac/Windows/Linux options.

- [ ] **Step 1: Rewrite main.go**

Replace the entire `main.go` content. The new structure:

1. **Keep** all pre-Wails setup (telemetry init, logger creation, diagnostics, settings provider, controller/manager creation, wiring)
2. **Remove** the `startup` closure (lines 198-298) — its contents move to each service's `ServiceStartup`
3. **Remove** the `wails.Run(&options.App{...})` call (lines 301-386)
4. **Add** `application.New(application.Options{...})` with:
   - `Name: "Omniview"`
   - `Services: []application.Service{...}` — all 17 services registered via `application.NewService()` or `application.NewServiceWithOptions()`
   - `Assets: application.AssetOptions{Handler: application.AssetFileServerFS(assets), Middleware: ...}` — with plugin asset middleware
5. **Add** window creation: `app.Window.NewWithOptions(application.WebviewWindowOptions{...})` with `Name: "main"`, all dimensions, platform options, `UseApplicationMenu: true`
6. **Add** `app.Run()` with error handling

Key details for the rewrite:
- The `pluginRefAdapter` and `pluginReloaderAdapter` types (lines 62-78) stay unchanged
- The controller/manager construction logic (lines 81-195) stays unchanged
- Services are registered in order: SettingsService, TelemetryService, ResourceService, ExecService, LogsService, MetricService, NetworkerService, DataService, UIService, UtilsService, DevServerService, PluginManagerService, PluginLogService, SettingsControllerService, DiagnosticsService, AppService
- The `PluginAssetHandler` (renamed from `FileLoader`) is used as middleware, NOT as a routed service
- Embed directives stay: `//go:embed all:dist` and `//go:embed build/appicon.png`
- Import `github.com/wailsapp/wails/v3/pkg/application` instead of v2 packages

Window platform options mapping (from `api-platform-options.md`):
```go
Mac: application.MacWindow{
    TitleBar:   application.MacTitleBarHiddenInset,
    Appearance: application.NSAppearanceNameDarkAqua,
    Backdrop:   application.MacBackdropTranslucent,
},
Linux: application.LinuxWindow{
    WebviewGpuPolicy: application.WebviewGpuPolicyOnDemand,
},
Zoom: 1.0,
```

- [ ] **Step 2: Rewrite app.go as AppService**

Replace `app.go`. The `App` struct becomes `AppService`:

```go
type AppService struct {
	app *application.App
}

func NewAppService() *AppService {
	return &AppService{}
}

func (s *AppService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	s.app = application.Get()
	return nil
}

func (s *AppService) ServiceShutdown() error {
	return nil
}

func (s *AppService) GetOperatingSystem() string { /* same logic */ }

func (s *AppService) OpenFileSelectionDialog(opts FileDialogOptions) ([]string, error) {
	// Use v3 dialog builder: s.app.Dialog.OpenFile()...PromptForMultipleSelection()
}

func (s *AppService) SaveFileDialog(opts FileDialogOptions) (string, error) {
	// Use v3 dialog builder: s.app.Dialog.SaveFile()...PromptForSingleSelection()
}

func (s *AppService) WriteFileContent(path string, content string) error { /* same */ }
```

Dialog migration — reference `~/.claude/skills/wails-v3-migrator/references/api-dialogs.md`:
- `OpenMultipleFilesDialog` → `s.app.Dialog.OpenFile().SetTitle(...).AddFilter(...).PromptForMultipleSelection()`
- `SaveFileDialog` → `s.app.Dialog.SaveFile().SetTitle(...).SetFilename(...).PromptForSingleSelection()`
- Remove `FileDialogOptions` wrapper struct — use builder methods directly. Keep the struct as a parameter type for the bound method if the frontend currently passes it.

Remove the `Shutdownable` interface, `startup()`, `domReady()`, `beforeClose()` methods. Remove the `ctx context.Context` field. Remove `wailsruntime` import.

Migrate lifecycle hooks:
- `domReady` is currently empty (`app.go:111-113`) — no migration needed, just delete it. If logic is added later, use `window.OnWindowEvent(events.Common.WindowRuntimeReady, handler)` in `AppService.ServiceStartup`.
- `beforeClose` currently returns false (`app.go:118-120`) — no migration needed, just delete it. If close prevention is needed later, use `window.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) { e.Cancel() })` in `AppService.ServiceStartup`.

- [ ] **Step 3: Rename fileloader.go and restructure**

Rename `fileloader.go` to `plugin_asset_handler.go`. Rename struct from `FileLoader` to `PluginAssetHandler`. Remove the embedded `http.Handler` field. The `ServeHTTP` method stays but is called from middleware, not as a standalone handler.

Update `main.go` to use it as middleware:
```go
Assets: application.AssetOptions{
    Handler: application.AssetFileServerFS(assets),
    Middleware: func(next http.Handler) http.Handler {
        handler := NewPluginAssetHandler(log)
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if strings.HasPrefix(r.URL.Path, "/_/") {
                handler.ServeHTTP(w, r)
                return
            }
            next.ServeHTTP(w, r)
        })
    },
},
```

- [ ] **Step 4: Verify compilation**

At this point most controllers still have v2 imports. The goal is just that `main.go`, `app.go`, and `plugin_asset_handler.go` compile with v3 imports. Other packages will be updated in subsequent tasks.

```bash
GOWORK=off go build ./...
```

If compilation fails on other packages (expected), verify main package files compile in isolation by checking for syntax errors.

- [ ] **Step 5: Commit**

```bash
git add main.go app.go plugin_asset_handler.go
git rm fileloader.go
git commit -m "feat: migrate main.go entry point and app service to wails v3"
```

---

## Task 7: Migrate menus to v3

**Files:**
- Create: `backend/menus/app.go`
- Create: `backend/menus/keybindings.go`
- Create: `backend/menus/context.go`
- Delete: `backend/menus/menus.go`
- Delete: `backend/menus/view.go`

Reference `~/.claude/skills/wails-v3-migrator/references/api-menus.md` for menu API, role menus, accelerator syntax, and context menu registration.

- [ ] **Step 1: Create backend/menus/app.go**

New file that replaces both `menus.go` and `view.go`. Uses v3 menu API:

```go
package menus

import (
	"runtime"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// SetupAppMenu creates and sets the application menu.
func SetupAppMenu(app *application.App, window *application.WebviewWindow) {
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
	viewMenu.Add("Force Reload").SetAccelerator("CmdOrCtrl+Shift+F").OnClick(func(ctx *application.Context) {
		window.ForceReload()
	})

	viewMenu.AddSeparator()
	viewMenu.Add("New Terminal Session").SetAccelerator("CmdOrCtrl+Shift+T").OnClick(func(ctx *application.Context) {
		app.Event.Emit("menu/view/terminal/create")
	})
	viewMenu.Add("Minimize Bottom Menu").SetAccelerator("CmdOrCtrl+Shift+B").OnClick(func(ctx *application.Context) {
		app.Event.Emit("menu/view/bottomdrawer/minimize")
	})
	viewMenu.Add("Maximize Bottom Menu").SetAccelerator("CmdOrCtrl+Alt+B").OnClick(func(ctx *application.Context) {
		app.Event.Emit("menu/view/bottomdrawer/fullscreen")
	})

	viewMenu.AddSeparator()
	viewMenu.Add("Close Sidebar").SetAccelerator("CmdOrCtrl+Shift+S").OnClick(func(ctx *application.Context) {
		app.Event.Emit("menu/view/sidebar/minimize")
	})

	app.Menu.Set(menu)
}
```

Key translations from current code:
- `keys.CmdOrCtrl("r")` → `SetAccelerator("CmdOrCtrl+R")`
- `keys.Combo("f", keys.CmdOrCtrlKey, keys.ShiftKey)` → `SetAccelerator("CmdOrCtrl+Shift+F")`
- `keys.Combo("b", keys.CmdOrCtrlKey, keys.ShiftKey)` → `SetAccelerator("CmdOrCtrl+Shift+B")`
- `keys.Combo("b", keys.CmdOrCtrlKey, keys.OptionOrAltKey)` → `SetAccelerator("CmdOrCtrl+Alt+B")`
- `keys.Combo("s", keys.CmdOrCtrlKey, keys.ShiftKey)` → `SetAccelerator("CmdOrCtrl+Shift+S")`
- `wailsruntime.WindowReload(ctx)` → `window.Reload()`
- `wailsruntime.WindowReloadApp(ctx)` → `window.ForceReload()`
- `wailsruntime.EventsEmit(ctx, name)` → `app.Event.Emit(name)`
- `func(_ *menu.CallbackData)` → `func(ctx *application.Context)`

- [ ] **Step 2: Create backend/menus/keybindings.go**

```go
package menus

import "github.com/wailsapp/wails/v3/pkg/application"

// SetupKeyBindings registers standalone keyboard shortcuts.
func SetupKeyBindings(app *application.App, window *application.WebviewWindow) {
	// These duplicate menu accelerators but also work when menus are hidden
	app.KeyBinding.Add("ctrl+shift+t", func(w *application.WebviewWindow) {
		app.Event.Emit("menu/view/terminal/create")
	})
}
```

- [ ] **Step 3: Create backend/menus/context.go**

Define Go-side context menus for future frontend migration. Reference `api-menus.md` for `RegisterContextMenu`:

```go
package menus

import "github.com/wailsapp/wails/v3/pkg/application"

// SetupContextMenus registers Go-side context menus by ID.
// Frontend activation via CSS --custom-contextmenu is a future sprint.
func SetupContextMenus(app *application.App) {
	// Bottom drawer tab context menu
	tabMenu := app.NewContextMenu()
	tabMenu.Add("Close Tab").OnClick(func(ctx *application.Context) {
		app.Event.Emit("context/tab/close")
	})
	tabMenu.Add("Close Other Tabs").OnClick(func(ctx *application.Context) {
		app.Event.Emit("context/tab/close-others")
	})
	app.RegisterContextMenu("drawer-tab", tabMenu)
}
```

- [ ] **Step 4: Delete old menu files**

```bash
rm backend/menus/menus.go backend/menus/view.go
```

- [ ] **Step 5: Wire menus into AppService.ServiceStartup**

In `main.go` or `app.go`, call the menu setup functions after app and window are created (in `AppService.ServiceStartup` or after `app.Window.NewWithOptions`):

```go
menus.SetupAppMenu(app, mainWindow)
menus.SetupKeyBindings(app, mainWindow)
menus.SetupContextMenus(app)
```

- [ ] **Step 6: Verify compilation**

```bash
GOWORK=off go build ./backend/menus/...
```

- [ ] **Step 7: Commit**

```bash
git add backend/menus/app.go backend/menus/keybindings.go backend/menus/context.go
git rm backend/menus/menus.go backend/menus/view.go
git commit -m "feat: migrate menus to v3 API with context menu stubs and keybindings"
```

---

## Task 8: Create WindowManager

**Files:**
- Create: `backend/window/manager.go`

- [ ] **Step 1: Create backend/window/manager.go**

Reference `~/.claude/skills/wails-v3-migrator/references/api-windows.md` for `WebviewWindowOptions`, `GetByName`, window methods. Also reference the Wails v3 documented window recycling pattern from `~/Repos/wails/docs/src/content/docs/features/windows/multiple.mdx`.

The `WindowManager` implements **hide-on-close recycling for the main window**. The main window holds all app state and plugin connections — closing it hides to tray/dock instead of quitting. Secondary windows (settings, devtools) are ephemeral and close normally since they're stateless and cheap to recreate.

```go
package window

import (
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Manager centralizes window creation, access, and lifecycle management.
// The main window uses hide-on-close recycling to stay alive in tray/dock.
// Secondary windows close normally.
type Manager struct {
	app *application.App
}

// NewManager creates a new WindowManager and registers hide-on-close
// on the main window so closing it hides to tray/dock instead of quitting.
func NewManager(app *application.App, main *application.WebviewWindow) *Manager {
	m := &Manager{app: app}
	m.registerMainWindowHideOnClose(main)
	return m
}

// Main returns the main application window.
func (m *Manager) Main() *application.WebviewWindow {
	return m.app.Window.GetByName("main")
}

// registerMainWindowHideOnClose intercepts WindowClosing on the main window,
// hiding it instead of quitting the app. The app stays alive in tray/dock.
func (m *Manager) registerMainWindowHideOnClose(w *application.WebviewWindow) {
	w.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		w.Hide()
		e.Cancel() // prevent quit — app stays alive in tray/dock
	})
}

// OpenSettings creates a fresh settings window. Closes normally when dismissed.
func (m *Manager) OpenSettings() *application.WebviewWindow {
	return m.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:   "settings",
		Title:  "Settings — Omniview",
		URL:    "/#/settings",
		Width:  900,
		Height: 700,
		UseApplicationMenu: true,
	})
}

// OpenDevtools creates a fresh devtools window. Closes normally when dismissed.
func (m *Manager) OpenDevtools() *application.WebviewWindow {
	return m.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:   "devtools",
		Title:  "DevTools — Omniview",
		URL:    "/#/devtools",
		Width:  1200,
		Height: 800,
		UseApplicationMenu: true,
	})
}
```

Note: URLs use `/#/` prefix because the frontend uses hash routing (`createHashRouter`). The future `WindowPool` (for detachable terminals/logs) would add hide-on-close recycling to its pooled windows, but that's a separate sprint.

- [ ] **Step 2: Commit**

```bash
git add backend/window/manager.go
git commit -m "feat: add WindowManager for multi-window support"
```

---

## Task 9: Update Vite config for v3

**Files:**
- Modify: `vite.config.ts`

- [ ] **Step 1: Add Wails Vite plugin**

Edit `vite.config.ts`. Add the Wails plugin import and add it to the plugins array. Also update the `@omniviewdev/runtime/runtime` alias to point to the new re-export:

```typescript
import wails from '@wailsio/runtime/plugins/vite';
```

Add to the `plugins` array after `react()`:

```typescript
plugins: [
    react({ /* existing config */ }),
    wails('./packages/omniviewdev-runtime/src/bindings'),  // path to generated bindings
    { name: 'strip-dev-scripts', /* existing */ },
],
```

The binding path must point to wherever `wails3 generate bindings` outputs. This will be configured to output into the runtime package.

- [ ] **Step 2: Commit**

```bash
git add vite.config.ts
git commit -m "feat: add wails v3 vite plugin to vite.config.ts"
```

---

## Task 10: Migrate resource controller (proving ground)

**Files:**
- Modify: `backend/pkg/plugin/resource/controller.go`
- Delete: `backend/pkg/plugin/resource/client.go`

This is the proving ground — the most complex service with event patterns, watch states, and dynamic event keys.

- [ ] **Step 1: Add app field and ServiceStartup to controller**

Edit `backend/pkg/plugin/resource/controller.go`. Add `*application.App` field to the `controller` struct (line 58). Change `Run(ctx context.Context)` (line 123) to `ServiceStartup`:

```go
type controller struct {
	app              *application.App  // NEW: replaces ctx
	logger           logging.Logger
	settingsProvider pkgsettings.Provider
	emitter          EventEmitter
	// ... rest stays the same
}

func (c *controller) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	c.app = application.Get()
	c.emitter = newAppEmitter(c.app)
	c.dispatcher.Start()
	return nil
}

func (c *controller) ServiceShutdown() error {
	c.dispatcher.Stop()
	return nil
}
```

Remove the old `Run(ctx context.Context)` and `Shutdown()` methods.

- [ ] **Step 2: Delete client.go**

The `resource.Client` struct is a thin wrapper. All its methods delegate to the controller. Delete `backend/pkg/plugin/resource/client.go`. The controller is registered as the v3 service directly in `main.go`.

Update `main.go` to remove `resourceClient := resource.NewClient(resourceController)` and register `resourceController` directly as a service.

- [ ] **Step 3: Update any code that references resource.Client**

Search for `resource.NewClient` and `resource.Client` in other files. Update imports and references to use the controller directly.

- [ ] **Step 4: Run tests**

```bash
cd backend/pkg/plugin/resource && go test ./... -count=1 -v
```

Expected: Tests pass. The `newTestControllerWithEmitter` helper in `testutil_test.go` already uses `recordingEmitter` directly, so tests don't need the app reference.

- [ ] **Step 5: Commit**

```bash
git add backend/pkg/plugin/resource/controller.go
git rm backend/pkg/plugin/resource/client.go
git commit -m "feat: migrate resource controller to v3 service, delete client wrapper"
```

---

## Task 11: Migrate remaining controllers to v3 services

**Files:** Each controller package under `backend/pkg/plugin/`

For each controller, apply the same pattern proven in Task 10:
1. Add `app *application.App` field to the struct
2. Replace `Run(ctx context.Context)` with `ServiceStartup(ctx context.Context, options application.ServiceOptions) error`
3. Replace `Shutdown()` with `ServiceShutdown() error`
4. Replace `ctx context.Context` field with `app *application.App`
5. Replace `runtime.EventsEmit(c.ctx, ...)` calls with emitter-based calls or `c.app.Event.Emit(...)`
6. Delete the client.go wrapper file
7. Run tests

- [ ] **Step 1: Migrate exec controller**

Edit `backend/pkg/plugin/exec/controller.go`:
- Struct (line 71): replace `ctx context.Context` (line 73) with `app *application.App`
- `Run` (line 92) → `ServiceStartup`, set `c.app = application.Get()`
- 6 `runtime.EventsEmit(c.ctx, ...)` calls (lines 151, 153, 173, 214, 216, 236) → `c.app.Event.Emit(...)`
- Delete `backend/pkg/plugin/exec/client.go`

- [ ] **Step 2: Migrate logs controller**

Edit `backend/pkg/plugin/logs/controller.go`:
- Struct (line 55): replace `ctx context.Context` (line 56) with `app *application.App`
- `Run` (line 96) → `ServiceStartup`
- `runtime.EventsEmit(c.ctx, eventKey, ...)` (line 123) → `c.app.Event.Emit(eventKey, ...)`
- Delete `backend/pkg/plugin/logs/client.go`

- [ ] **Step 3: Migrate metric controller**

Edit `backend/pkg/plugin/metric/controller.go`:
- Struct (line 80): replace `ctx context.Context` (line 81) with `app *application.App`
- `Run` (line 112) → `ServiceStartup`
- Delete `backend/pkg/plugin/metric/client.go`

- [ ] **Step 4: Migrate networker controller**

Edit `backend/pkg/plugin/networker/controller.go`:
- Struct (line 90): replace `ctx context.Context` (line 91) with `app *application.App`
- `Run` (line 103) → `ServiceStartup`
- Delete `backend/pkg/plugin/networker/client.go`

- [ ] **Step 5: Migrate settings controller**

Edit `backend/pkg/plugin/settings/controller.go`:
- No `Run` method — add `ServiceStartup` and `ServiceShutdown`
- Delete `backend/pkg/plugin/settings/client.go`

- [ ] **Step 6: Migrate data controller**

Edit `backend/pkg/plugin/data/controller.go`:
- No `Run` method — add `ServiceStartup` and `ServiceShutdown`
- Delete `backend/pkg/plugin/data/client.go`

- [ ] **Step 7: Migrate UI manager + client**

Merge `backend/pkg/plugin/ui/client.go` into the manager. Add `ServiceStartup`/`ServiceShutdown` to the manager struct.

- [ ] **Step 8: Migrate utils client**

Edit `backend/pkg/plugin/utils/client.go`. Add `ServiceStartup`/`ServiceShutdown`.

- [ ] **Step 9: Migrate plugin manager**

Edit `backend/pkg/plugin/manager.go`. This is the largest service:
- Replace stored `ctx` with `app *application.App`
- `Initialize(ctx)` + `Run(ctx)` merge into `ServiceStartup`
- `Shutdown()` → `ServiceShutdown() error`
- All `emitEvent(ctx, ...)` calls → use emitter interface
- `runtime.EventsEmit(pm.ctx, EventInitComplete)` (line 495) → `pm.app.Event.Emit(EventInitComplete)`

- [ ] **Step 10: Migrate devserver manager**

Edit `backend/pkg/plugin/devserver/manager.go`:
- Replace stored `ctx` with `app *application.App`
- `Initialize(ctx)` → `ServiceStartup`
- `Shutdown()` → `ServiceShutdown() error`
- All `runtime.EventsEmit(m.ctx, ...)` calls (lines 430, 437, 444) → `m.app.Event.Emit(...)`

- [ ] **Step 11: Migrate installer.go**

Edit `backend/pkg/plugin/installer.go`. This file imports `github.com/wailsapp/wails/v2/pkg/runtime`. Update any `runtime.EventsEmit` calls to use the emitter interface or `app.Event.Emit(...)`. Remove the v2 runtime import.

- [ ] **Step 12: Migrate pluginlog manager callback wiring**

The `pluginlog` manager uses an `OnEmit` callback pattern wired in `main.go`'s startup closure. During the `main.go` rewrite (Task 6), this callback closure that calls `runtime.EventsEmit(ctx, ...)` must be updated to use `app.Event.Emit(...)` instead. The `pluginlog` package itself may not import Wails directly, but its callback wiring in main.go does.

- [ ] **Step 13: Migrate diagnostics logger**

Edit `backend/diagnostics/logger.go`:
- `runtime.EventsEmit(ctx, ...)` (line 217) → use emitter or `app.Event.Emit(...)`

- [ ] **Step 14: Run all Go tests**

```bash
GOWORK=off go test ./... -count=1
```

Expected: All tests pass. Note: test files for each controller may need updates if they construct controllers with `context.Context` arguments. Inspect test files during each controller migration, not just at the end.

- [ ] **Step 15: Verify no remaining v2 imports**

```bash
grep -r "wailsapp/wails/v2" --include="*.go" .
```

Expected: No matches.

- [ ] **Step 16: Commit (split into multiple commits by batch)**

Commit controllers in batches of 3-4 for easier review and bisection:

```bash
# Batch 1: settings, exec, logs
git add backend/pkg/plugin/settings/ backend/pkg/plugin/exec/ backend/pkg/plugin/logs/
git commit -m "feat: migrate settings, exec, logs controllers to v3 services"

# Batch 2: metric, networker, data
git add backend/pkg/plugin/metric/ backend/pkg/plugin/networker/ backend/pkg/plugin/data/
git commit -m "feat: migrate metric, networker, data controllers to v3 services"

# Batch 3: ui, utils, installer
git add backend/pkg/plugin/ui/ backend/pkg/plugin/utils/ backend/pkg/plugin/installer.go
git commit -m "feat: migrate ui, utils, installer to v3 services"

# Batch 4: plugin manager, devserver, pluginlog, diagnostics
git add backend/pkg/plugin/manager.go backend/pkg/plugin/devserver/ \
       backend/pkg/plugin/pluginlog/ backend/diagnostics/
git commit -m "feat: migrate plugin manager, devserver, pluginlog, diagnostics to v3 services"
```

```bash
git add backend/pkg/plugin/ backend/diagnostics/
git commit -m "feat: migrate all controllers to v3 services, delete client wrappers"
```

---

## Task 12: Update main.go service registration

**Files:**
- Modify: `main.go`

After all controllers are migrated, update `main.go` to register them correctly.

- [ ] **Step 1: Update service registrations**

Remove all `NewClient()` calls. Register controllers directly.

**Important:** `application.NewService[T](instance *T)` requires a concrete pointer type, NOT an interface. For variables declared as interfaces (e.g., `resourceController Controller`), use `application.NewServiceWithOptions()` instead, or change the variable type to the concrete pointer type.

For each service, determine whether the variable is a pointer or an interface:
- Variables that are already `*ConcreteType` (e.g., `app *AppService`) → use `application.NewService(app)`
- Variables that are interfaces (e.g., `resourceController Controller`) → either change the construction to return `*controller` directly, or use `application.NewServiceWithOptions(&svc, application.ServiceOptions{})`

```go
Services: []application.Service{
    application.NewServiceWithOptions(settingsProvider, application.ServiceOptions{}),
    application.NewServiceWithOptions(telemetryBinding, application.ServiceOptions{}),
    application.NewServiceWithOptions(resourceController, application.ServiceOptions{}),
    application.NewServiceWithOptions(execController, application.ServiceOptions{}),
    application.NewServiceWithOptions(logsController, application.ServiceOptions{}),
    application.NewServiceWithOptions(metricController, application.ServiceOptions{}),
    application.NewServiceWithOptions(networkerController, application.ServiceOptions{}),
    application.NewServiceWithOptions(dataController, application.ServiceOptions{}),
    application.NewServiceWithOptions(uiManager, application.ServiceOptions{}),
    application.NewServiceWithOptions(utilsClient, application.ServiceOptions{}),
    application.NewServiceWithOptions(devServerManager, application.ServiceOptions{}),
    application.NewServiceWithOptions(pluginManager, application.ServiceOptions{}),
    application.NewServiceWithOptions(pluginLogManager, application.ServiceOptions{}),
    application.NewServiceWithOptions(diagnosticsClient, application.ServiceOptions{}),
    application.NewService(app),  // AppService is a concrete pointer
},
```

Remove the `EnumBind` array entirely — v3 auto-discovers enums.

Remove the `OnStartup`, `OnDomReady`, `OnBeforeClose`, `OnShutdown` callbacks — replaced by `ServiceStartup`/`ServiceShutdown`.

- [ ] **Step 2: Verify full compilation**

```bash
GOWORK=off go build ./...
```

Expected: Full project compiles with v3 only.

- [ ] **Step 3: Commit**

```bash
git add main.go
git commit -m "feat: register all services in v3 application, remove EnumBind and lifecycle callbacks"
```

---

## Task 13: Migrate frontend runtime package

**Files:**
- Modify: `packages/omniviewdev-runtime/src/runtime.ts`
- Modify: `packages/omniviewdev-runtime/src/api.ts`
- Modify: `packages/omniviewdev-runtime/package.json`

- [ ] **Step 1: Update runtime.ts to re-export @wailsio/runtime**

Replace `packages/omniviewdev-runtime/src/runtime.ts`:

```typescript
export { Events, Window, Clipboard, Browser, Application, WML } from '@wailsio/runtime';
```

- [ ] **Step 2: Update package.json exports**

Add `@wailsio/runtime` as a dependency in `packages/omniviewdev-runtime/package.json`. Update exports to include bindings path:

```json
{
  "dependencies": {
    "@wailsio/runtime": "^3.0.0"
  }
}
```

- [ ] **Step 3: Generate v3 bindings**

Run `wails3 generate bindings` with output configured to `packages/omniviewdev-runtime/src/bindings/`. The exact command flags will need to be determined during implementation based on `wails3 generate bindings --help`.

- [ ] **Step 4: Update api.ts to use new binding paths**

Replace `packages/omniviewdev-runtime/src/api.ts` with imports from the new `bindings/` directory. The exact paths depend on what `wails3 generate bindings` produces. Example:

```typescript
export * as ExecClient from './bindings/exec/ExecService';
export * as ResourceClient from './bindings/resource/ResourceService';
// ... etc for each service
```

Note: The exact module names depend on what the v3 binding generator outputs for each Go service type name. Verify after generation.

- [ ] **Step 5: Commit**

```bash
git add packages/omniviewdev-runtime/src/runtime.ts packages/omniviewdev-runtime/src/api.ts \
       packages/omniviewdev-runtime/package.json
git commit -m "feat: migrate runtime package to @wailsio/runtime and v3 bindings"
```

---

## Task 14: Migrate frontend event listeners

**Files:**
- Modify: All files using `EventsOn`, `EventsEmit`, `EventsOff` from `@omniviewdev/runtime/runtime`

The key change: `EventsOn(name, (data) => ...)` → `Events.On(name, (event) => { event.data ... })`. The cleanup function return pattern stays the same.

There are approximately **33 files** using `EventsOn`/`EventsOff`/`EventsEmit` across the codebase. Use `grep -rn "EventsOn\|EventsOff\|EventsEmit" --include="*.ts" --include="*.tsx" .` to find all sites. Migrate in batches by package.

**Note on `Once`:** The frontend `Events.Once()` method exists in `@wailsio/runtime`. On the Go side, `app.Event.Once()` is not available — use `app.Event.OnMultiple(name, handler, 1)` for one-shot listeners.

- [ ] **Step 1: Update hooks in packages/omniviewdev-runtime/src/hooks/**

Run `grep -rn "EventsOn\|EventsOff\|EventsEmit" --include="*.ts" --include="*.tsx" packages/omniviewdev-runtime/src/hooks/` to find all files. Expected ~15 files including:

```typescript
// Before
import { EventsOn, EventsOff } from '@omniviewdev/runtime/runtime';
const cancel = EventsOn('event-name', (data) => { ... });

// After
import { Events } from '@omniviewdev/runtime/runtime';
const cancel = Events.On('event-name', (event) => {
    const data = event.data;
    // ... rest of handler
});
```

Key files in hooks:
- `hooks/resource/useResources.ts` — multiple `EventsOn` with cleanup (lines 132-182)
- `hooks/resource/useStreamAction.ts` — stream action events
- `hooks/resource/useWatchState.ts` — watch state events
- `hooks/resource/useActiveSyncs.ts` — active sync events
- `hooks/connection/useConnections.ts` — `EventsOn` with cleanup (lines 50-56)
- `hooks/connection/useConnectionStatus.ts` — connection status events
- `hooks/metric/useMetricStream.ts` — metric stream events
- `hooks/networker/usePortForwardSessions.ts` — port-forward events

For each: update import, wrap handler to unwrap `event.data`.

- [ ] **Step 2: Update UI components and bridges**

Run `grep -rn "EventsOn\|EventsOff\|EventsEmit" --include="*.ts" --include="*.tsx" ui/` to find all files. Expected ~18 files including:

- `ui/providers/BottomDrawer/tabs.tsx` — `EventsOn("menu/view/terminal/create", ...)`
- `ui/providers/BottomDrawer/containers/Terminal.tsx` — 12+ `runtime.EventsOn(...)` calls
- `ui/providers/BottomDrawer/containers/LogViewer/hooks/useLogStream.ts` — log stream events
- `ui/providers/BottomDrawer/containers/LogViewer/sources/sessionSource.ts` — session events
- `ui/providers/RightDrawer/index.tsx` — drawer events
- `ui/features/pluginlogs/wailsBridge.ts` — `EventsOn('plugin/process/log', ...)`
- `ui/features/devtools/wailsBridge.ts` — dev server status bridge
- `ui/features/plugins/react/PluginServiceProvider.tsx` — plugin events
- `ui/features/plugins/adapters/createProductionDeps.ts` — production deps events
- `ui/features/logger/useLogger.tsx` — logger events
- `ui/hooks/plugin/useDevServer.ts` — dev server events
- `ui/hooks/plugin/usePluginManager.ts` — plugin manager events
- `ui/pages/connecting/index.tsx` — connection events
- `ui/layouts/core/main/BottomDrawer/index.tsx` — drawer events
- `ui/components/displays/Footer/AppStatusFooter.tsx` — status events

For each: update import, wrap handler to unwrap `event.data`.

Also check `packages/omniviewdev-providers/internal/runtime/runtime.d.ts` — this file may reference event types and need updating.

- [ ] **Step 3: Remove EventsOff usage**

Search for `EventsOff` calls. Replace with cleanup functions from `Events.On()`. If any code uses `EventsOff(name)` to remove all listeners, verify this is intentional and either:
- Replace with stored cleanup functions, or
- Use `Events.Off(name)` (v3 equivalent, removes ALL listeners for that name)

- [ ] **Step 4: Run frontend type check**

```bash
pnpm exec tsc -p tsconfig.app.json --noEmit
```

Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/omniviewdev-runtime/src/hooks/ ui/
git commit -m "feat: migrate frontend event listeners to @wailsio/runtime Events API"
```

---

## Task 15: Update frontend binding imports

**Files:**
- All frontend files importing from `wailsjs/go/...`

- [ ] **Step 1: Find all wailsjs import sites**

```bash
grep -rn "wailsjs/go/" --include="*.ts" --include="*.tsx" .
```

Expected: ~31 files across `packages/omniviewdev-runtime/src/` (hooks, context providers, api.ts) that import from `wailsjs/go/`. Each import needs to change from the old path to the new binding path via `@omniviewdev/runtime/api` re-exports.

- [ ] **Step 2: Update imports**

For each file, change:
```typescript
// Old
import { Something } from '@omniviewdev/runtime/api';
// This import still works IF api.ts was updated in Task 13

// Old direct imports
import { Something } from '../../wailsjs/go/resource/Client';
// New
import { Something } from '@omniviewdev/runtime/api';
```

The `api.ts` re-exports should handle most of this transparently. Direct `wailsjs/go/...` imports need updating.

- [ ] **Step 3: Delete old wailsjs directory**

```bash
rm -rf packages/omniviewdev-runtime/src/wailsjs/
```

- [ ] **Step 4: Run frontend type check**

```bash
pnpm exec tsc -p tsconfig.app.json --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: update all frontend binding imports to v3 paths, delete wailsjs directory"
```

---

## Task 16: Set up frontend routing for multi-window

**Files:**
- Modify: `ui/routes.tsx`

- [ ] **Step 1: Verify existing routes**

The app already uses `react-router-dom` with hash routing and has `/settings` route. Verify that `/settings` and any devtools route render correctly when loaded directly (not just navigated to). This is needed for multi-window where each window loads a specific URL.

- [ ] **Step 2: Add devtools route if missing**

If there's no `/devtools` route in `ui/routes.tsx`, add one:

```typescript
{
    path: '/devtools',
    element: <DevToolsPage />,
}
```

- [ ] **Step 3: Commit**

```bash
git add ui/routes.tsx
git commit -m "feat: ensure routes support direct URL loading for multi-window"
```

---

## Task 17: Final verification and cleanup

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Verify no remaining v2 Go imports**

```bash
grep -r "wailsapp/wails/v2" --include="*.go" .
```

Expected: No matches.

- [ ] **Step 2: Verify no remaining wailsjs frontend imports**

```bash
grep -rn "wailsjs" --include="*.ts" --include="*.tsx" .
```

Expected: No matches (or only in generated binding output).

- [ ] **Step 3: Run full Go test suite**

```bash
GOWORK=off go test ./... -count=1
```

Expected: All tests pass.

- [ ] **Step 4: Run frontend type check and lint**

```bash
pnpm exec tsc -p tsconfig.app.json --noEmit
pnpm lint
```

Expected: No errors.

- [ ] **Step 5: Generate fresh bindings**

```bash
wails3 generate bindings
```

- [ ] **Step 6: Build and run**

```bash
task dev
```

Expected: App boots, main window renders with correct title and dimensions.

Verification checklist:
- [ ] App starts without errors
- [ ] Menus render and callbacks fire (View > Reload, New Terminal, etc.)
- [ ] Plugin assets load via `/_/` prefix
- [ ] Resource subscription and events work
- [ ] Exec sessions stream output
- [ ] Log streaming works
- [ ] Dialogs open (file selection, save)
- [ ] Settings page renders
- [ ] Plugins load and initialize

- [ ] **Step 7: Production build**

```bash
task build
```

Expected: Build succeeds, produces binary.

- [ ] **Step 8: Run review checklist from spec**

Go through every item in the Review Checklist section of `docs/superpowers/specs/2026-03-20-wails3-migration-design.md`. Verify each item is satisfied.

- [ ] **Step 9: Update CI workflow**

Edit `.github/workflows/pr-checks.yml` to use `task` commands instead of `make`:

- Install go-task in CI
- Replace `make check` with `task check`
- Replace individual `make go-build` etc. with `task check:go-build` etc.

- [ ] **Step 10: Final commit**

```bash
git add -A
git commit -m "feat: complete wails v3 migration — all services, events, bindings, and build system migrated"
```
