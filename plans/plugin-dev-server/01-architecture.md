# 01 -- Architecture

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         HOST APPLICATION                              │
│                                                                       │
│  ┌───────────────────┐    ┌─────────────────────────────────────┐    │
│  │ DevServerManager   │───▶│ DevServerInstance (per plugin)      │    │
│  │ (Wails Binding)    │    │                                     │    │
│  │                    │    │  Mode A: IDE-Managed                │    │
│  │ Start/Stop/Restart │    │  ┌──────────┐  ┌─────────────────┐ │    │
│  │ Attach/Detach      │    │  │Vite Proc  │  │Go Watcher+Build│ │    │
│  │ Status/Logs        │    │  │:15173+N   │  │(fsnotify+build)│ │    │
│  │                    │    │  └──────────┘  └─────────────────┘ │    │
│  │                    │    │                                     │    │
│  │                    │    │  Mode B: External (ReattachConfig)  │    │
│  │                    │    │  ┌──────────────────────────────┐  │    │
│  │                    │    │  │Watch .devinfo file for PID,  │  │    │
│  │                    │    │  │addr, vitePort. Connect gRPC  │  │    │
│  │                    │    │  │via ReattachConfig.            │  │    │
│  │                    │    │  └──────────────────────────────┘  │    │
│  └───────────────────┘    └─────────────────────────────────────┘    │
│                                                                       │
│  Two UI loading strategies (coexist on same page):                    │
│    Dev:  import("http://127.0.0.1:<port>/src/entry.ts") → ESM + HMR  │
│    Prod: SystemJS.import("/_/plugins/<id>/assets/entry.js")           │
│                                                                       │
│  Wails Events (Go → Frontend):                                        │
│    plugin/devserver/status    (DevServerState JSON)                    │
│    plugin/devserver/log       (build output lines)                    │
│    plugin/devserver/error     (structured build errors)               │
│    plugin/dev_reload_complete (existing, backward compat)             │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flow: UI File Change (HMR Path)

```
1. Developer saves a .tsx file in plugins/my-plugin/ui/src/
2. Vite dev server (running at 127.0.0.1:15173) detects change via chokidar
3. Vite transforms the changed module using esbuild
4. Vite sends HMR update over its WebSocket to the browser
5. @vite/client (injected into the module) receives the update
6. React Fast Refresh applies the update in-place
7. Component re-renders with new code; React state is PRESERVED
8. Total time: <100ms
9. NO backend involvement. NO Wails events. NO SystemJS cache clear.
```

**Why this works:** In dev mode, the plugin's entry.ts is loaded via native ESM `import()` directly from the Vite dev server. Vite's HMR client is injected into every module. When a file changes, Vite sends a WebSocket message identifying the changed module. The HMR client fetches the new version and React Fast Refresh hot-swaps it.

## Data Flow: Go File Change (Rebuild Path)

```
1. Developer saves a .go file in plugins/my-plugin/pkg/
2. DevServerInstance's fsnotify watcher fires
3. Debounced for 500ms (DedupInterval) to batch rapid saves
4. DevServerManager emits: plugin/devserver/status {goStatus: "building"}
5. go build -o build/bin/plugin ./pkg (streaming stdout/stderr to log events)
6. IF BUILD FAILS:
   a. Parse error output for file:line:col info
   b. Emit: plugin/devserver/error {errors: [...]}
   c. Emit: plugin/devserver/status {goStatus: "error"}
   d. Keep old binary running (no reload)
   e. Frontend shows error overlay
7. IF BUILD SUCCEEDS:
   a. Copy binary to ~/.omniview/plugins/<id>/bin/plugin
   b. Call pluginManager.ReloadPlugin(id):
      i.   OnPluginStop() called on all controllers
      ii.  RPCClient.Close() -- close gRPC connection
      iii. PluginClient.Kill() -- kill old process
      iv.  plugin.NewClient() with Cmd pointing to new binary
      v.   Spawn new process, gRPC handshake
      vi.  Re-initialize controllers with new RPC client
   c. Emit: plugin/dev_reload_complete (existing event, backward compat)
   d. Emit: plugin/devserver/status {goStatus: "ready", grpcConnected: true}
8. Frontend PluginRenderer receives plugin/dev_reload_complete:
   a. clearPlugin() -- remove old module from SystemJS cache (if it was loaded via SystemJS)
   b. loadAndRegisterPlugin() -- re-import plugin
   c. setReloadKey(k => k + 1) -- increment React key
   d. PluginContextProvider re-mounts with fresh context from new gRPC backend
9. Total time: 2-5s (dominated by go build)
```

## Data Flow: External Plugin Attach

```
1. Developer starts plugin binary externally:
   $ cd plugins/my-plugin && go run ./pkg
   Plugin outputs to stdout: 1|1|tcp|127.0.0.1:42367|grpc

2. Plugin SDK's Serve() writes ~/.omniview/plugins/my-plugin/.devinfo:
   {"pid":12345,"protocol":"grpc","protocolVersion":1,"addr":"127.0.0.1:42367","vitePort":15173}

3. Developer optionally starts Vite dev server:
   $ cd plugins/my-plugin/ui && pnpm run dev
   Vite starts on port 15173

4. DevServerManager's file watcher detects .devinfo creation:
   a. Parse JSON
   b. Validate PID is alive (os.FindProcess + signal 0)
   c. Create go-plugin Client with ReattachConfig:
      - Protocol: ProtocolGRPC
      - ProtocolVersion: 1
      - Addr: net.TCPAddr{IP: 127.0.0.1, Port: 42367}
      - Pid: 12345
      - Test: true (don't kill process on disconnect)
   d. Call rpcClient.Client() to establish gRPC connection
   e. Initialize controllers with the RPC client
   f. Emit: plugin/devserver/status {mode: "external", grpcConnected: true, vitePort: 15173}

5. Frontend detects viteStatus: "running" and devPort: 15173
   → Loads plugin via import("http://127.0.0.1:15173/src/entry.ts")
   → HMR active

6. Health check loop (every 5s):
   - Check if PID is still alive
   - If dead: set grpcConnected: false, emit status, remove .devinfo
   - If alive: check gRPC connection with a ping (optional)

7. When developer stops plugin binary:
   - PID health check fails
   - IDE disconnects gracefully
   - UI falls back to SystemJS loading (or shows disconnected state)

8. When .devinfo is updated (e.g., air restarted the plugin with new PID):
   - Disconnect from old process
   - Re-read .devinfo
   - Connect to new process via ReattachConfig
```

## Technical Constraints

### Vite Dev Server
- **Always serves native ESM in dev mode** -- cannot output SystemJS format
- **HMR uses a single global WebSocket** per page, multiplexed for all modules
- **Cross-origin import() works** if CORS is configured (`server.cors: true`)
- **React Fast Refresh requires** modules to only export React components for auto-boundary detection
- **Each Vite instance** is fully independent: own HTTP server, WebSocket, file watcher

### go-plugin
- **Normally spawns the plugin binary** via `Cmd` field in ClientConfig
- **ReattachConfig** allows connecting to already-running processes (skips handshake)
- **ReattachConfig.Test = true** prevents host from killing the plugin on disconnect
- **Cannot use SecureConfig with Reattach** (mutually exclusive)
- **Handshake format** (stdout): `CORE-PROTOCOL-VERSION|APP-PROTOCOL-VERSION|NETWORK-TYPE|NETWORK-ADDR|PROTOCOL`

### Wails Webview
- **macOS**: WebKit; **Windows**: WebView2 (Blink); **Linux**: WebKit GTK
- **All support**: native ESM `import()`, WebSocket connections, no restrictive CSP by default
- **Hostname**: Use `127.0.0.1` instead of `localhost` for reliable WebSocket/fetch

### SystemJS
- **Version**: Standard system.js + AMD + named-register extras
- **Coexists with native ESM** on the same page (main app uses ESM, plugins use SystemJS)
- **Shared deps**: Registered via `shared://` protocol in import map
- **Cache clear**: `SystemJS.delete(moduleId)` removes a module; re-import fetches fresh

### Resource Limits (10 concurrent plugins)
- **Vite memory**: ~15-25 MB per instance → ~150-250 MB for 10
- **File watchers**: macOS FSEvents handles 32k files; Linux inotify default 65k (may need increase)
- **Ports**: 100 available in 15173-15273 range
- **gRPC**: 10 TCP connections = negligible overhead

## Backward Compatibility

- **Existing events** (`plugin/dev_reload_start`, `plugin/dev_reload_complete`, `plugin/dev_reload_error`) remain and are emitted alongside new events
- **Old watcher** (`dev.go`) continues to work for plugins NOT managed by DevServerManager
- **SystemJS loading** remains the default for production and for plugins without a running dev server
- **FileLoader** (`fileloader.go`) unchanged -- it only serves static assets for production mode
- **Plugin state** (`PluginState.DevMode`, `PluginState.DevPath`) already persisted; we add dev server info alongside

## File Changes Summary

### New Files
| File | Package/Module | Purpose |
|------|---------------|---------|
| `backend/pkg/plugin/devserver/manager.go` | `devserver` | DevServerManager Wails binding |
| `backend/pkg/plugin/devserver/instance.go` | `devserver` | Per-plugin instance lifecycle |
| `backend/pkg/plugin/devserver/vite.go` | `devserver` | Vite process management |
| `backend/pkg/plugin/devserver/gowatch.go` | `devserver` | Go file watcher + builder |
| `backend/pkg/plugin/devserver/external.go` | `devserver` | External mode (.devinfo, ReattachConfig) |
| `backend/pkg/plugin/devserver/types.go` | `devserver` | Type definitions |
| `backend/pkg/plugin/devserver/ports.go` | `devserver` | Port allocation |
| `packages/omniviewdev-vite-plugin/` | npm package | Vite plugin + shim files |
| `ui/features/plugins/api/devSharedExporter.ts` | -- | Export shared deps to window |
| `ui/hooks/plugin/useDevServer.ts` | -- | React hooks for dev server state |
| `ui/features/devtools/` | -- | Dev tools types, events, hooks, components |
| `ui/providers/BottomDrawer/containers/DevBuildOutput/` | -- | Build output tab |
| `ui/components/displays/Footer/PluginDevStatusIndicators.tsx` | -- | Footer status dots |
| `ui/pages/plugins/DevModeSection.tsx` | -- | Enhanced plugin card dev section |
| `pkg/plugin-sdk/pkg/sdk/devinfo.go` | `sdk` | .devinfo file writing |

### Modified Files
| File | Changes |
|------|---------|
| `main.go` | Add DevServerManager to Wails bindings |
| `backend/pkg/plugin/manager.go` | Add devServerMgr field, auto-start |
| `backend/pkg/plugin/dev.go` | Skip DevServerManager-managed plugins |
| `ui/features/plugins/api/loader.ts` | Add dev-mode ESM import branch |
| `ui/features/plugins/PluginRegistryProvider.tsx` | Pass dev state to loader |
| `ui/features/plugins/components/PluginRenderer.tsx` | Remove WindowReloadApp, use reloadKey |
| `plugins/kubernetes/ui/vite.config.ts` | Add omniviewExternals plugin |
| `ui/providers/BottomDrawer/types.ts` | Add 'devbuild' variant |
| `ui/layouts/core/main/BottomDrawer/index.tsx` | Render devbuild tab |
| `ui/components/displays/Footer/LeftSide.tsx` | Add status indicators |
| `ui/pages/plugins/InstalledPluginCard.tsx` | Render DevModeSection |

### Unchanged Files
| File | Why unchanged |
|------|--------------|
| `fileloader.go` | No proxy needed; direct ESM import from Vite server |
| `ui/features/plugins/api/shared_dependencies.ts` | Source of truth; referenced but not modified |
| `ui/features/plugins/api/systemjs.ts` | SystemJS init unchanged |
| `ui/features/plugins/api/preloader.ts` | Preloading unchanged |
