# Developing Plugins for Omniview

This guide covers everything you need to know to develop plugins for Omniview with fast iteration cycles. You will learn how to set up your environment, choose a development workflow, and troubleshoot common issues.

---

## 1. Getting Started

### 1.1 Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Go | 1.24+ | Plugin backend |
| Node.js | 20+ | UI development |
| pnpm | 9+ | Package management |
| Omniview | Latest | The IDE |

### 1.2 Plugin Structure

Every Omniview plugin follows this directory layout:

```
my-plugin/
  plugin.yaml          # Plugin metadata (required)
  pkg/                 # Go backend code
    main.go            # Plugin entry point (required for backend plugins)
  ui/                  # React frontend code
    package.json       # npm dependencies
    vite.config.ts     # Vite configuration
    src/
      entry.ts         # Plugin UI entry point
```

### 1.3 The `plugin.yaml` File

```yaml
id: my-plugin                    # Unique identifier (required)
name: My Plugin                  # Display name (required)
version: 0.1.0                   # Semver version (required)
description: A custom plugin
icon: LuPlug                     # Icon name or URL
repository: https://github.com/me/my-plugin
website: https://my-plugin.dev

maintainers:
  - name: Your Name
    email: you@example.com

# Plugin capabilities determine what interfaces your plugin implements.
# At least one capability is required.
capabilities:
  - resource    # Manages connections and resources (Kubernetes, AWS, etc.)
  - ui          # Has a frontend UI
  - exec        # Provides terminal/exec functionality
  - networker   # Provides port-forwarding/networking
  - log         # Provides log streaming
  - settings    # Has configurable settings (auto-included)

tags:
  - kubernetes
  - devops
```

### 1.4 Creating a New Plugin

```bash
mkdir -p plugins/my-plugin/{pkg,ui/src}

# Create plugin.yaml
cat > plugins/my-plugin/plugin.yaml << 'EOF'
id: my-plugin
name: My Plugin
version: 0.1.0
capabilities:
  - resource
  - ui
EOF

# Create Go entry point
cat > plugins/my-plugin/pkg/main.go << 'EOF'
package main

import (
    "github.com/omniviewdev/plugin-sdk/pkg/sdk"
)

func main() {
    plugin := sdk.NewPlugin(sdk.PluginOpts{
        ID: "my-plugin",
    })

    // Register capabilities here...

    plugin.Serve()
}
EOF

# Create UI entry point
cat > plugins/my-plugin/ui/src/entry.ts << 'EOF'
// Export your plugin's pages, components, and routes
export default {
    routes: [],
    components: {},
};
EOF
```

---

## 2. IDE-Managed Mode (Recommended)

This is the easiest way to develop plugins. The IDE manages all dev processes for you.

### 2.1 Setup

1. **Open Omniview**
2. **Go to Settings > Plugins**
3. **Click "Install Dev Mode"**
4. **Select your plugin's root directory** (the folder containing `plugin.yaml`)

The IDE will:
- Build your Go binary
- Build your UI bundle
- Install the plugin to `~/.omniview/plugins/<id>/`
- Start a Vite dev server for HMR
- Start a Go file watcher for auto-rebuilds
- Display status indicators in the footer

### 2.2 Development Workflow

Once your plugin is installed in dev mode:

**UI Changes (instant feedback)**:
1. Edit any `.tsx`, `.ts`, or `.css` file in your plugin's `ui/src/` directory
2. The Vite HMR system updates the component in-place
3. React state is preserved -- no page refresh
4. Update appears in <100ms

**Go Changes (automatic rebuild)**:
1. Edit any `.go` file in your plugin's `pkg/` directory
2. The file watcher detects the change (500ms debounce)
3. The Go binary is rebuilt automatically
4. The plugin process is restarted with the new binary
5. gRPC connections are re-established
6. The plugin UI re-mounts with fresh backend data
7. Total time: 2-5 seconds

### 2.3 Monitoring Dev Server Status

**Footer indicators**: Colored dots in the bottom-left footer show each dev server's status:
- Green: Ready (Vite running, Go compiled, gRPC connected)
- Amber: Building (Go compiling or Vite starting)
- Red: Error (build failure or connection issue)

**Build output tab**: Click any footer dot to open the build output tab in the bottom drawer. Shows color-coded output from Vite and Go compiler.

**Plugin card**: The plugin card in Settings > Plugins shows detailed dev server info: source path, Vite port, gRPC status, last build time.

### 2.4 Handling Build Errors

When a Go build fails:
1. An error overlay appears on your plugin's UI area
2. The error shows file, line, column, and message
3. The old binary continues running (your plugin is still functional)
4. Fix the error and save -- the watcher auto-rebuilds
5. The overlay dismisses when the build succeeds

When a UI error occurs:
1. Vite shows an error overlay in the browser
2. Fix the error -- HMR updates automatically
3. If Vite cannot recover, refresh the page

---

## 3. External Mode (Advanced)

External mode is for developers who want full control over their development processes. You run the plugin binary and Vite server yourself, and the IDE auto-connects.

### 3.1 When to Use External Mode

- You want to use a debugger (e.g., `dlv debug`)
- You want to use `air` for Go live-reload
- You want custom build flags or environment variables
- You are developing on a remote machine

### 3.2 Setup

#### Step 1: Install the plugin normally first

The plugin must exist in `~/.omniview/plugins/<id>/` with at least a `plugin.yaml` for the IDE to recognize it. Either:
- Install in dev mode once (which creates the directory), then switch to external
- Manually create the directory and copy `plugin.yaml`

```bash
mkdir -p ~/.omniview/plugins/my-plugin/bin
cp plugins/my-plugin/plugin.yaml ~/.omniview/plugins/my-plugin/
```

#### Step 2: Build and run the plugin binary

```bash
cd plugins/my-plugin
go build -o build/bin/plugin ./pkg

# Run with OMNIVIEW_DEV=1 to enable .devinfo writing
OMNIVIEW_DEV=1 ./build/bin/plugin
```

The plugin outputs the go-plugin handshake to stdout:
```
1|1|tcp|127.0.0.1:42367|grpc
```

And writes `~/.omniview/plugins/my-plugin/.devinfo`:
```json
{
  "pid": 48291,
  "protocol": "grpc",
  "protocolVersion": 1,
  "addr": "127.0.0.1:42367",
  "pluginId": "my-plugin",
  "version": "0.1.0",
  "startedAt": "2026-02-16T10:30:00Z"
}
```

#### Step 3: The IDE auto-connects

The IDE watches for `.devinfo` files. Within seconds, it:
- Detects the file
- Validates the PID is alive
- Connects to the plugin via gRPC ReattachConfig
- Shows the plugin as "External" in the UI

#### Step 4: (Optional) Start Vite for UI HMR

In a separate terminal:
```bash
cd plugins/my-plugin/ui
pnpm run dev
```

Set the Vite port in the `.devinfo` by using the environment variable:
```bash
OMNIVIEW_DEV=1 OMNIVIEW_VITE_PORT=15173 ./build/bin/plugin
```

### 3.3 Using a Debugger

```bash
cd plugins/my-plugin

# Build with debug symbols
go build -gcflags="all=-N -l" -o build/bin/plugin ./pkg

# Start with delve
OMNIVIEW_DEV=1 dlv exec ./build/bin/plugin
```

Set breakpoints in your IDE (VS Code, GoLand). The Omniview IDE connects via `.devinfo` just as it would with a normal run.

### 3.4 Using Air for Live Reload

Create `.air.toml` in your plugin root:

```toml
root = "."
tmp_dir = "build/tmp"

[build]
  cmd = "go build -o build/tmp/main ./pkg"
  full_bin = "OMNIVIEW_DEV=1 OMNIVIEW_VITE_PORT=15173 ./build/tmp/main"
  include_dir = ["pkg"]
  include_ext = ["go"]
  exclude_dir = ["build", "ui", "vendor"]
  delay = 500
  send_interrupt = true
  kill_delay = "500ms"

[misc]
  clean_on_exit = true
```

Then run:
```bash
cd plugins/my-plugin
air
```

Air watches Go files, rebuilds, and restarts the plugin. The IDE detects each restart via `.devinfo` updates and reconnects automatically.

**Important**: `send_interrupt = true` ensures Air sends SIGTERM (not SIGKILL), allowing the plugin to clean up `.devinfo` before the new process starts.

### 3.5 Disconnecting

When you stop your external plugin:
- The `.devinfo` file is deleted (by the plugin's cleanup handler)
- The IDE detects the deletion and disconnects
- The plugin's UI shows a disconnected state

If the plugin crashes without cleanup, the IDE's health check (every 5 seconds) detects the dead PID and disconnects.

---

## 4. Using the CLI Wrapper Tool

The `omniview-plugin-dev` tool combines everything into one command. It is the recommended approach for external mode development.

### 4.1 Installation

```bash
go install github.com/omniviewdev/omniview-plugin-dev@latest
```

### 4.2 Basic Usage

```bash
# From your plugin directory
cd plugins/my-plugin
omniview-plugin-dev

# Or specify the directory
omniview-plugin-dev --dir ./plugins/my-plugin
```

This single command:
1. Validates your plugin structure
2. Starts the Vite dev server
3. Builds the Go binary
4. Starts the plugin process
5. Writes `.devinfo` for IDE auto-connect
6. Watches Go files for changes
7. Auto-rebuilds and restarts on changes

### 4.3 Output

```
10:30:00 [system] omniview-plugin-dev v0.1.0
10:30:00 [system] Plugin directory: /Users/you/plugins/my-plugin
10:30:00 [system] Validating plugin structure...
10:30:00 [system] Plugin: My Plugin v0.1.0 (my-plugin)
10:30:00 [system] Starting Vite dev server...
10:30:01 [vite]   VITE v5.4.0  ready in 342ms
10:30:01 [vite]   Local: http://127.0.0.1:15173/
10:30:01 [system] Vite running on http://127.0.0.1:15173
10:30:01 [system] Building plugin binary...
10:30:03 [system] Built in 2341ms
10:30:03 [system] Starting plugin process...
10:30:03 [system] Handshake: 1|1|tcp|127.0.0.1:42367|grpc
10:30:03 [system] Plugin running (PID 48291, addr 127.0.0.1:42367)
10:30:03 [system] Wrote .devinfo (IDE will auto-connect)
10:30:03 [system] Starting file watcher on pkg/...
10:30:03 [system] Ready! Watching for changes...
10:30:03 [system] Press Ctrl+C to stop
```

### 4.4 Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--dir` | `.` | Path to the plugin directory |
| `--vite-port` | `15173` | Preferred Vite dev server port |
| `--no-vite` | `false` | Skip Vite (for Go-only plugins) |
| `--verbose` | `false` | Enable debug logging |
| `--version` | - | Print version and exit |

### 4.5 Go-Only Plugins

If your plugin has no UI:
```bash
omniview-plugin-dev --dir ./plugins/my-plugin --no-vite
```

---

## 5. Troubleshooting

### 5.1 "Multiple React instances detected"

**Cause**: Your plugin is bundling its own copy of React instead of using the host's.

**Fix**: Ensure the `external` array in your `vite.config.ts` includes `"react"`, `"react/jsx-runtime"`, and `"react-dom"`. Verify that `@omniviewdev/vite-plugin` is in your devDependencies and `omniviewExternals(external)` is in the plugins array.

### 5.2 Vite HMR Not Working

**Symptoms**: UI changes require a page refresh.

**Checks**:
1. Is Vite actually running? Check the footer indicators.
2. Open browser DevTools > Network tab > WS filter. You should see a WebSocket connection to `127.0.0.1:<port>`.
3. Check the console for HMR-related errors.
4. Ensure your `vite.config.ts` has `hmr.host: '127.0.0.1'` and no hardcoded `hmr.port`.

### 5.3 "Port 15173 Already in Use"

**Cause**: Another Vite instance or process is using the port.

**Fix**: With `strictPort: false` in your Vite config, Vite auto-increments to the next available port. If you need a specific port, stop the other process first.

### 5.4 Go Build Fails but No Error Shown

**Check**:
1. Open the build output tab (click the footer indicator or go to Settings > Plugins > plugin card > Logs)
2. Check that `go` is in your PATH or configured in Omniview Settings > Developer > Go Path
3. Run the build manually: `cd plugins/my-plugin && go build ./pkg`

### 5.5 Plugin Loads but Connections Fail

**Cause**: The gRPC connection was re-established but controllers were not re-initialized properly.

**Fix**:
1. Try reloading the plugin: Settings > Plugins > plugin card > Reload button
2. Check the plugin's stderr output in the build output tab for errors
3. If using external mode, ensure the handshake matches: `OMNIVIEW` magic cookie with value `<id>-<version>`

### 5.6 External Mode: IDE Does Not Detect Plugin

**Checks**:
1. Is `OMNIVIEW_DEV=1` set when running your plugin? Without it, no `.devinfo` is written.
2. Check if `.devinfo` exists: `cat ~/.omniview/plugins/<id>/.devinfo`
3. Is the PID in `.devinfo` still alive? `kill -0 <pid>`
4. Does the plugin ID in `.devinfo` match the directory name in `~/.omniview/plugins/`?
5. Is `~/.omniview/plugins/<id>/plugin.yaml` present? The IDE needs it for metadata.

### 5.7 External Mode: IDE Keeps Disconnecting

**Cause**: The plugin process is crashing or the health check is failing.

**Checks**:
1. Run the plugin in the foreground and check for panics or errors
2. Check if the PID in `.devinfo` matches the actual process: `ps aux | grep plugin`
3. If using `air`, ensure `send_interrupt = true` so cleanup handlers run

### 5.8 "Plugin Binary Not Found" After Build

**Cause**: The build output path does not match what the IDE expects.

**Fix**: The built binary must be at `build/bin/plugin` relative to the plugin directory. Check your Go build command outputs to the correct path.

### 5.9 Shared Dependencies Not Resolving

**Symptoms**: `import { useState } from 'react'` fails in dev mode or returns a different React instance.

**Checks**:
1. Ensure `@omniviewdev/vite-plugin` is installed: `pnpm list @omniviewdev/vite-plugin`
2. Check that `omniviewExternals(external)` is in your Vite plugins array
3. Verify the shared deps bridge is initialized (check for `window.__OMNIVIEW_SHARED__` in browser console)
4. If you import `@mui/joy/Chip`, ensure `'@mui/joy/Chip'` is in your `external` array (exact match, not prefix)

### 5.10 CSS Not Updating with HMR

**Check**: Vite HMR for CSS works differently than for components. If CSS changes are not applying:
1. Check that `cssCodeSplit: false` is in your build config
2. Ensure you are importing CSS files, not inlining styles
3. Try a page refresh as a workaround -- CSS HMR can be finicky with certain PostCSS setups

---

## 6. Configuration Reference

### 6.1 Vite Config Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `plugins: [omniviewExternals(external)]` | Yes | - | Resolves shared deps from host in dev mode |
| `server.host` | Yes | `'127.0.0.1'` | Must be `127.0.0.1` for Wails webview |
| `server.port` | No | `15173` | Preferred port (auto-increments if taken) |
| `server.cors` | Yes | `true` | Required for cross-origin module loading |
| `server.strictPort` | No | `false` | Set to `false` for multi-plugin support |
| `hmr.protocol` | No | `'ws'` | WebSocket protocol |
| `hmr.host` | Yes | `'127.0.0.1'` | Must match server.host |
| `build.rollupOptions.format` | Yes | `'system'` | SystemJS format for production builds |
| `build.rollupOptions.external` | Yes | `external` | Same array used by omniviewExternals |

### 6.2 Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `OMNIVIEW_DEV=1` | Plugin SDK | Enables `.devinfo` file writing |
| `OMNIVIEW_VITE_PORT=<port>` | Plugin SDK, CLI | Vite port to include in `.devinfo` |

### 6.3 IDE Settings

Available in Settings > Developer:

| Setting | Key | Description |
|---------|-----|-------------|
| Go Path | `developer.gopath` | Path to `go` binary (auto-detected) |
| pnpm Path | `developer.pnpmpath` | Path to `pnpm` binary (auto-detected) |
| Node Path | `developer.nodepath` | Path to `node` binary (auto-detected) |

### 6.4 `.devinfo` File Format

```json
{
  "pid": 48291,
  "protocol": "grpc",
  "protocolVersion": 1,
  "addr": "127.0.0.1:42367",
  "vitePort": 15173,
  "pluginId": "my-plugin",
  "version": "0.1.0",
  "startedAt": "2026-02-16T10:30:00Z"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `pid` | Yes | Plugin process ID |
| `protocol` | Yes | Wire protocol (`"grpc"`) |
| `protocolVersion` | Yes | Protocol version (`1`) |
| `addr` | Yes | gRPC listen address |
| `vitePort` | No | Vite dev server port |
| `pluginId` | No | Plugin ID (validated against directory name) |
| `version` | No | Plugin version |
| `startedAt` | No | Process start timestamp |

### 6.5 Wails Events (for Advanced Integration)

| Event | Direction | Payload |
|-------|-----------|---------|
| `plugin/devserver/status` | Go -> Frontend | `DevServerState` JSON |
| `plugin/devserver/log` | Go -> Frontend | `DevBuildLine` JSON |
| `plugin/devserver/error` | Go -> Frontend | `{ pluginId, errors[] }` JSON |
| `plugin/dev_reload_start` | Go -> Frontend | Plugin metadata (backward compat) |
| `plugin/dev_reload_complete` | Go -> Frontend | Plugin metadata (backward compat) |
| `plugin/dev_reload_error` | Go -> Frontend | Plugin metadata + error string |

### 6.6 Plugin SDK Functions

```go
// In your plugin's main.go:

// Create a new plugin
plugin := sdk.NewPlugin(sdk.PluginOpts{
    ID:    "my-plugin",
    Debug: true,
    Settings: []settings.Setting{
        // Your plugin's settings...
    },
})

// Register capabilities
sdk.RegisterResourcePlugin(plugin, sdk.ResourcePluginOpts{
    // Your resource plugin configuration...
})

// Serve (handles .devinfo automatically when OMNIVIEW_DEV=1)
plugin.Serve()
```

---

## 7. Development Workflow Comparison

| Feature | IDE-Managed | External (Manual) | External (CLI Tool) |
|---------|-------------|-------------------|-------------------|
| Setup effort | Lowest (point-and-click) | Highest | Medium (one command) |
| UI HMR | Automatic | Manual Vite start | Automatic |
| Go rebuild | Automatic | Manual build | Automatic |
| Debugger support | No | Yes | No |
| Custom build flags | No | Yes | Limited |
| Works without IDE | No | Yes | Yes |
| IDE required | Yes | No | No |
| Multi-plugin | Automatic ports | Manual ports | Automatic ports |
| State after IDE restart | Auto-restores | Re-read .devinfo | Persistent |

**Recommendation**: Start with IDE-managed mode. Switch to external mode only when you need debugger support or custom build configurations.
