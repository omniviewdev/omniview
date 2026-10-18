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

### 1.5 Contributing a Theme

UI plugins can contribute themes through the `omniview/theme` extension point. A contribution contains the theme definition without an `id`; the host derives the globally unique ID from the plugin and registration IDs.

```ts
import type { ThemeDefinitionV1 } from '@omniviewdev/base-ui';
import type { ExtensionRegistration } from '@omniviewdev/runtime';

type ThemeContribution = Omit<ThemeDefinitionV1, 'id'>;

export const extensionRegistrations = [
  {
    extensionPointId: 'omniview/theme',
    registration: {
      id: 'slate',
      label: 'Slate',
      value: {
        schemaVersion: 1,
        name: 'Slate',
        base: 'void',
        author: 'Acme',
        version: '1.0.0',
        tokens: {
          'color.bg.base': '#101114',
          'color.bg.surface': '#16181d',
          'color.accent.strong': '#82a8ff',
        },
      },
    },
  },
] satisfies ExtensionRegistration<ThemeContribution>[];
```

For a plugin whose ID is `acme-tools`, the registration above has the canonical theme ID `plugin:acme-tools/slate`. More generally, the host derives `plugin:<encoded-plugin-id>/<encoded-registration-id>`, URL-encoding both ID components. Plugins should use a stable local registration ID and must not put an `id` inside `value`.

The host validates the schema version, metadata, base theme, token names and values, ownership, and ID uniqueness before adding a contributed theme. An invalid contribution is reported in the developer console and is not registered; it does not prevent other valid contributions from loading.

Registration cleanup follows the plugin lifecycle:

- Unloading a plugin automatically removes its contributed themes.
- If the removed theme is selected, Omniview immediately renders the built-in `void` fallback. The requested canonical ID remains selected, so reloading the same valid contribution makes it active again.
- Reloading or replacing a registration disposes its previous theme before registering the current contribution. Plugin code does not need to unregister themes manually.

Before React starts, the loading surface uses the last cached built-in theme, including validated legacy Light and Solarized preferences during upgrades. Custom/plugin themes use Void for this first paint until their contribution loads; the persisted requested theme ID is not changed. The Appearance theme picker applies selections immediately and exposes the accessible name “Theme.”

---

## 2. IDE-Managed Mode (Recommended)

The named workspace host owns plugin builds, Vite, RPC and controller lifecycles. Start from the [workspace CLI workflow](development-workspaces.md); plugin cards and the CLI use the same canonical managers.

### 2.1 Setup

1. Select the plugin repository in a named feature workspace.
2. Start that workspace with `omniview-dev workspace up`.
3. For interactive management, open **Settings > Plugins** in that named instance.
4. Any selected source directory must match the workspace manifest.

The host will:
- Build with the selected verified SDK
- Install transactionally into the resolved workspace state root, never an inferred `~/.omniview` path
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

## 3. Workspace-Managed Development

For isolated feature work, use a named development instance and its authenticated
CLI. The host owns the plugin build, Vite server, RPC connection, controller
initialization and source watcher. A listening port or live PID is not readiness.

```bash
omniview-dev instance inspect --workspace /path/to/workspaces/my-feature
omniview-dev plugin dev link --path /path/to/workspaces/my-feature/my-plugin \
  --workspace /path/to/workspaces/my-feature --wait
omniview-dev plugin dev status my-plugin --workspace /path/to/workspaces/my-feature
```

The instance must already be running with the development control build enabled.
Workspace lookup never falls back to the production profile. Source linking is a
host transaction; do not copy binaries or metadata into `~/.omniview`.

External binary/Air/Delve supervision is not an attachment mechanism. The former
PID-file discovery path did not establish a working RPC attachment and has been
removed. Do not start a second Go or Vite supervisor for a managed plugin.

See [development CLI](development-cli.md) and
[managed lifecycle](development-plugin-lifecycle.md) for generation-aware status,
readiness and dependency-watch details.

## 4. CLI Development Workflow

The host-module `omniview-dev` command replaces the independent plugin runner.
Its commands call the running host's canonical managers; there is no second
plugin process manager in the CLI.

```bash
# List installed plugins, not marketplace publisher listings.
omniview-dev plugin list --workspace /path/to/workspaces/my-feature
omniview-dev plugin dev start my-plugin --workspace /path/to/workspaces/my-feature --wait
omniview-dev plugin dev logs my-plugin --workspace /path/to/workspaces/my-feature --limit 100
omniview-dev plugin dev stop my-plugin --workspace /path/to/workspaces/my-feature --wait
```

JSON results and operation IDs go to stdout. Default log messages are redacted.
Use `plugin dev logs <id> --unsafe-output` deliberately for real bounded log text
in JSON stdout; a stderr warning explains that arbitrary plugin/build output may
contain secrets. Do not automatically forward raw logs to shared reports.
Accepted mutations continue after a client wait timeout; poll their operation ID
instead of submitting the mutation again. Go-only and UI-only capability handling
belongs to the host lifecycle, not a client `--no-vite` switch.

See [development CLI](development-cli.md) for installation, settings JSON input,
all commands and stable exit codes.

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

### 5.3 Managed Port Already in Use

**Cause**: Another Vite instance or process is using the port.

**Fix**: Inspect the selected workspace's actual endpoints and port policy. Sticky allocation may choose another port only through its owned bounded bind-retry path; explicit/strict overrides fail rather than silently increment. Choose another explicit assignment or clear the override with `--port "plugin-vite:<id>=0"`. Never kill a process merely because it occupies a port. Managed Vite uses `strictPort: true`; HTTP and HMR must agree with its actual lease.

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
3. For workspace-managed plugins, inspect generation-aware `plugin dev status` and bounded `plugin dev logs`; a handshake line alone is not proof of initialized controllers.

### 5.6 Workspace Instance Not Found

Select the workspace manifest/directory explicitly, or use a registered name with
`--root`. The selected development host must be running with control support.
`instance inspect` authenticates and compares the actual endpoint descriptor,
workspace UUID, profile root and generation before any plugin mutation.

### 5.7 Managed Plugin Keeps Disconnecting

Use `plugin dev status <id>` and `plugin dev logs <id>` against the same workspace.
Inspect build, Vite, RPC and controller readiness separately. Repair the source
error and allow the retained host watcher to rebuild, or submit a generation-aware
rebuild. Do not launch an external binary as a fallback.

### 5.8 "Plugin Binary Not Found" After Build

**Cause**: The build output path does not match what the IDE expects.

**Fix**: The built binary must be at `build/bin/plugin` relative to the plugin directory. Check your Go build command outputs to the correct path.

### 5.9 Shared Dependencies Not Resolving

**Symptoms**: `import { useState } from 'react'` fails in dev mode or returns a different React instance.

**Checks**:
1. Ensure `@omniviewdev/vite-plugin` is installed: `pnpm list @omniviewdev/vite-plugin`
2. Check that `omniviewExternals(external)` is in your Vite plugins array
3. Verify the shared deps bridge is initialized (check for `window.__OMNIVIEW_SHARED__` in browser console)
4. If you import a subpath of a shared package (for example `@omniviewdev/runtime/api`), ensure that exact subpath is in your `external` array (exact match, not prefix)
5. The host no longer shares MUI, Emotion or the legacy `@omniviewdev/ui` design system. Build plugin UI with `@omniviewdev/base-ui` (plus `@omniviewdev/ai-ui` and `@omniviewdev/editors`); a plugin that still imports MUI or `@omniviewdev/ui` fails to load

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
| `server.port` | Managed assignment | Actual workspace lease | Do not hardcode or silently increment managed ports |
| `server.cors` | Yes | `true` | Required for cross-origin module loading |
| `server.strictPort` | Yes in managed mode | `true` | Occupied explicit assignments fail without adopting or killing another listener |
| `hmr.protocol` | No | `'ws'` | WebSocket protocol |
| `hmr.host` | Yes | `'127.0.0.1'` | Must match server.host |
| `build.rollupOptions.format` | Yes | `'system'` | SystemJS format for production builds |
| `build.rollupOptions.external` | Yes | `external` | Same array used by omniviewExternals |

### 6.2 Workspace Environment

`OMNIVIEW_WORKSPACE_FILE` may select an absolute workspace manifest. An explicit
`--workspace` must agree with it. The host provides isolated runtime paths and
assigned service ports to managed children; users should not hardcode discovery
files or force production state roots.

### 6.3 IDE Settings

Available in Settings > Developer:

| Setting | Key | Description |
|---------|-----|-------------|
| Go Path | `developer.gopath` | Path to `go` binary (auto-detected) |
| pnpm Path | `developer.pnpmpath` | Path to `pnpm` binary (auto-detected) |
| Node Path | `developer.nodepath` | Path to `node` binary (auto-detected) |

### 6.4 Instance and Operation Discovery

Use `omniview-dev instance inspect --workspace <path>` for the actual descriptor
and `operation get <operation-id>` for accepted work. Credentials live only in
private per-generation token files and are never included in command output.
Plugin state includes its own generation; pass that generation to `plugin dev rebuild`.

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

// Serve under the host-managed lifecycle and its isolated environment.
plugin.Serve()
```

---

## 7. Development Workflow Comparison

| Feature | IDE-managed UI | Workspace CLI |
|---------|----------------|---------------|
| Supervisor | Canonical host manager | Same canonical host manager |
| UI HMR and Go rebuild | Host-owned | Host-owned |
| Target selection | Current application | Explicit/enclosing development workspace |
| Multi-plugin addressing | Plugin cards | Explicit plugin IDs |
| Completion | UI lifecycle state | Operation ID, wait, generation-aware status |
| Standalone external attachment | Not supported | Not supported |

Use the CLI for reproducible noninteractive work in isolated development profiles;
use plugin cards for interactive work. Neither path trusts PID-only discovery.

