# Plugin Dev Server -- Implementation Specification

## Overview

This specification covers the implementation of a plugin development server system for Omniview that provides:

- **UI Hot Module Replacement (HMR)**: Sub-100ms, state-preserving React Fast Refresh for plugin UI changes
- **Go Backend Auto-Reload**: Automatic rebuild + graceful gRPC reconnection on Go file changes
- **IDE-Managed Mode**: The IDE manages Vite + Go watcher processes per plugin
- **External/Self-Managed Mode**: Developers run their own processes; IDE auto-connects via `ReattachConfig`
- **CLI Wrapper Tool**: Single `omniview-plugin-dev` binary that handles everything
- **Dev Tools UI**: Full visibility into dev server status, build logs, errors, and connection health

## Current Problem

Plugin development requires a full rebuild cycle per change:
```
file change → fsnotify → full go build / vite build → copy to ~/.omniview/
→ emit event → SystemJS cache clear → WindowReloadApp() (full page refresh)
```
This takes several seconds and destroys all UI state.

## Glossary

| Term | Definition |
|------|-----------|
| **DevServerManager** | Go backend service (Wails binding) that manages dev server instances per plugin |
| **DevServerInstance** | Per-plugin struct tracking Vite process, Go watcher, and gRPC state |
| **IDE-Managed Mode** | The IDE spawns and manages all plugin dev processes |
| **External Mode** | Developer runs processes externally; IDE connects via `.devinfo` file |
| **ReattachConfig** | go-plugin feature for connecting to an already-running plugin process |
| **`.devinfo` file** | JSON file at `~/.omniview/plugins/<id>/.devinfo` advertising a running plugin's connection info |
| **Shared deps bridge** | System that exposes host app's React/MUI/etc. instances to dev-mode plugins |
| **Shim file** | Small `.mjs` file that re-exports a shared dependency from `window.__OMNIVIEW_SHARED__` |

## Document Index

| # | Document | Phase | What it covers |
|---|----------|-------|---------------|
| 01 | [Architecture](01-architecture.md) | -- | System architecture, data flows, mode descriptions, technical constraints |
| 02 | [Shared Deps Bridge](02-shared-deps-bridge.md) | Phase 1 | `window.__OMNIVIEW_SHARED__`, Vite plugin, shim generation |
| 03 | [DevServer Manager](03-devserver-manager.md) | Phase 2 | Go backend service, structs, methods, Wails bindings |
| 04 | [Frontend Dev Loading](04-frontend-dev-loading.md) | Phase 3 | `loader.ts`, `PluginRenderer`, `PluginRegistryProvider`, hooks |
| 05 | [Plugin Vite Config](05-plugin-vite-config.md) | Phase 4 | Plugin-side vite.config changes, template for new plugins |
| 06 | [Refactor Watcher](06-refactor-watcher.md) | Phase 5 | `dev.go` changes, backward compat, migration |
| 07 | [External Mode](07-external-mode.md) | Phase 6 | ReattachConfig, `.devinfo` protocol, health checking, air integration |
| 08 | [Dev Tools UI](08-dev-tools-ui.md) | Phase 7 | UI components, wireframes, events, MUI Joy patterns |
| 09 | [CLI Wrapper Tool](09-dev-cli-wrapper.md) | -- | `omniview-plugin-dev` binary design, distribution, architecture research |
| 10 | [Testing & Verification](10-testing-verification.md) | -- | Test plan, QA checklist, automated tests |
| 11 | [Plugin Author Guide](11-plugin-author-guide.md) | -- | End-user documentation for plugin developers |

## Implementation Dependency Graph

```
Phase 1 (Shared Deps Bridge) ─────┐
                                    ├──→ Phase 3 (Frontend Dev Loading) ──→ Phase 7 (Dev Tools UI)
Phase 2 (DevServer Manager) ──────┤
         │                         └──→ Phase 4 (Plugin Vite Config)
         ├──→ Phase 5 (Refactor Watcher)
         └──→ Phase 6 (External Mode)
```

Phases 1 and 2 have **no dependencies** and can be implemented in parallel.

## Key Technical Decisions

1. **Direct ESM import, no FileLoader proxy**: In dev mode, plugins load directly from `http://127.0.0.1:<vitePort>/src/entry.ts`. No reverse proxy through FileLoader -- this avoids WebSocket proxy complexity for HMR.

2. **`127.0.0.1` not `localhost`**: Wails webview can have hostname resolution issues with `localhost`. Explicit IP is more reliable.

3. **Generated shim files, not virtual modules**: ESM requires statically analyzable exports. Pre-generated `.mjs` shim files are the only correct approach for bridging shared deps.

4. **`ReattachConfig` for external mode**: go-plugin's built-in reattach feature (skips handshake, connects to running process) enables developers to run their own plugin process.

5. **Component re-mount, not page refresh**: `WindowReloadApp()` is removed. UI changes use Vite HMR. Go changes increment a React `key` to re-mount just the plugin component.

6. **Auto-start on app launch**: Dev server state persists via the existing plugin state file (gob-encoded). On next launch, dev servers auto-start for plugins that were previously in dev mode.

## Repository Paths (Key Existing Files)

| File | Purpose |
|------|---------|
| `/main.go` | Wails app setup, bindings, startup/shutdown |
| `/fileloader.go` | HTTP handler serving plugin assets from `~/.omniview/` |
| `/backend/pkg/plugin/manager.go` | Plugin lifecycle: load, start, stop, reload |
| `/backend/pkg/plugin/dev.go` | Current file watcher, rebuild logic, dev events |
| `/backend/pkg/plugin/types/state.go` | PluginState struct (DevMode, DevPath) |
| `/ui/features/plugins/api/loader.ts` | SystemJS plugin loading |
| `/ui/features/plugins/api/shared_dependencies.ts` | 55 shared dependency mappings |
| `/ui/features/plugins/api/preloader.ts` | SystemJS import map registration |
| `/ui/features/plugins/api/systemjs.ts` | SystemJS initialization |
| `/ui/features/plugins/api/utils.ts` | Import map builder |
| `/ui/features/plugins/components/PluginRenderer.tsx` | Plugin UI renderer with reload logic |
| `/ui/features/plugins/PluginRegistryProvider.tsx` | Plugin loading orchestration |
| `/ui/features/plugins/PluginManager.ts` | Plugin route/component registry |
| `/ui/hooks/plugin/usePluginManager.ts` | React hooks for plugin operations |
| `/ui/providers/BottomDrawer/types.ts` | Bottom drawer tab types |
| `/ui/pages/plugins/InstalledPluginCard.tsx` | Plugin card UI |
| `/plugins/kubernetes/ui/vite.config.ts` | Kubernetes plugin Vite configuration |
| `/plugins/kubernetes/ui/src/entry.ts` | Kubernetes plugin entry point |
| `/packages/omniviewdev-runtime/src/types/app.tsx` | PluginWindow class |
