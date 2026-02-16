# 05 -- Plugin-Side Vite Configuration Changes

## Phase 4: Plugin Vite Config

**Goal**: Modify the plugin-side `vite.config.ts` to support HMR-based development via the `@omniviewdev/vite-plugin` package, while remaining backward-compatible with the existing SystemJS production build.

**Prerequisites**: Phase 1 (Shared Deps Bridge) must be complete so that `@omniviewdev/vite-plugin` is published to the workspace.

---

## 1. Current State

**File**: `/plugins/kubernetes/ui/vite.config.ts`

The current Kubernetes plugin Vite config has:

### External Array (55 packages)

```typescript
const external = [
  // DND Kit
  "@dnd-kit/core",
  "@dnd-kit/modifiers",
  "@dnd-kit/sortable",
  "@dnd-kit/utilities",

  // MUI
  "@emotion/react",
  "@emotion/styled",
  "@mui/base",
  '@mui/base/Unstable_Popup',
  "@mui/x-charts",
  "@mui/material",
  "@mui/material-icons",
  "@mui/material-icons/si",
  "@mui/material-icons/lu",
  "date-fns",

  "@mui/joy",
  '@mui/joy/Table',
  '@mui/joy/Typography',
  // ... 20+ more @mui/joy subpath imports
  '@mui/joy/Textarea',

  // REACT
  "react",
  "react/jsx-runtime",
  "react-router-dom",
  "react-dom",
  "react-icons",
  "@tanstack/react-query",
  '@tanstack/react-table',
  '@tanstack/react-virtual',

  // Monaco
  "@monaco-editor/react",
  "monaco-editor",
  "monaco-yaml",
  "yaml",

  // OMNIVIEW
  "@omniviewdev/runtime",
  "@omniviewdev/runtime/api",
  "@omniviewdev/runtime/models",
  "@omniviewdev/runtime/runtime",
]
```

### Server Configuration

```typescript
server: {
  port: 15173,
  cors: true,
  origin: "http://localhost:15173",
  strictPort: true,
  hmr: {
    protocol: "ws",
    host: "localhost",
    port: 15173,
  },
},
```

### Problems with current config

| Problem | Impact |
|---------|--------|
| `host` is implicit (defaults to `localhost`) | Wails webview on macOS can fail DNS resolution for `localhost`; `127.0.0.1` is required |
| `strictPort: true` | If port 15173 is taken (another plugin dev server), Vite exits instead of incrementing |
| HMR `host: "localhost"` | Same DNS issue; WebSocket connection may fail in webview |
| HMR `port: 15173` hardcoded | Prevents multi-plugin dev: each plugin needs its own HMR port |
| No `omniviewExternals` Vite plugin | In serve mode, externals are ignored by Vite since it only uses them for Rollup builds. Shared deps get bundled into dev output, causing duplicate React instances |
| `origin: "http://localhost:15173"` | Assets reference wrong origin when loaded from within Wails webview |

### Build Configuration (unchanged)

The build section remains correct for production and is NOT modified:

```typescript
build: {
  cssCodeSplit: false,
  sourcemap: true,
  rollupOptions: {
    input: "src/entry.ts",
    output: {
      entryFileNames: "assets/entry.js",
      chunkFileNames: "assets/[name].js",
      assetFileNames: "assets/[name].[ext]",
      format: 'system',
    },
    preserveEntrySignatures: 'exports-only',
    external,
  }
},
```

---

## 2. Required Changes

### 2.1 Add the `@omniviewdev/vite-plugin` import

```typescript
import { omniviewExternals } from "@omniviewdev/vite-plugin";
```

This Vite plugin (created in Phase 1) does two things during `serve` mode only:
- Rewrites bare import specifiers for shared deps to point at generated `.mjs` shim files served by the host
- Ensures that `react`, `@mui/joy`, `@tanstack/react-query`, etc. resolve to the host app's singleton instances via `window.__OMNIVIEW_SHARED__`

### 2.2 Add `omniviewExternals(external)` to plugins array

```typescript
plugins: [
  react(),
  omniviewExternals(external),  // only active in serve mode
],
```

The `omniviewExternals` plugin is a no-op during `build` mode (it checks `command === 'serve'` internally). This means the existing SystemJS production build is completely unaffected.

### 2.3 Change `host` to `'127.0.0.1'`

**Why**: Wails uses a custom protocol handler (`wails://`) on macOS and WebView2 on Windows. The webview's network stack sometimes fails to resolve `localhost` to `127.0.0.1`, particularly in sandboxed or restrictive environments. Using the explicit IP address avoids this entirely.

### 2.4 Change `strictPort: false`

**Why**: When developing multiple plugins simultaneously, each needs its own Vite dev server on a different port. With `strictPort: false`, if port 15173 is taken, Vite increments to 15174, 15175, etc. The DevServerManager reads the actual port from Vite's stdout and reports it to the frontend.

### 2.5 Change HMR `host` to `'127.0.0.1'`

Same reasoning as 2.3. The HMR WebSocket must connect to `127.0.0.1` for reliability in the Wails webview.

### 2.6 Remove hardcoded HMR `port`

**Why**: When `strictPort: false` allows Vite to pick a different HTTP port, the HMR WebSocket must also use that same port. By removing the explicit `port` field from the `hmr` config, Vite automatically uses the same port as the HTTP server. This is the correct behavior for multi-plugin setups.

### 2.7 Remove the `origin` field

**Why**: The `origin` field is used by Vite to generate absolute URLs for assets. In dev mode, the plugin is loaded via `import("http://127.0.0.1:<port>/src/entry.ts")` and Vite's dev middleware handles all relative paths correctly. The `origin` field is unnecessary and causes issues when the port changes.

---

## 3. Complete New vite.config.ts

This is the complete replacement for `/plugins/kubernetes/ui/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { omniviewExternals } from "@omniviewdev/vite-plugin";

const external = [
  // DND Kit
  "@dnd-kit/core",
  "@dnd-kit/modifiers",
  "@dnd-kit/sortable",
  "@dnd-kit/utilities",

  // MUI
  "@emotion/react",
  "@emotion/styled",
  "@mui/base",
  '@mui/base/Unstable_Popup',
  "@mui/x-charts",
  "@mui/material",
  "@mui/material-icons",
  "@mui/material-icons/si",
  "@mui/material-icons/lu",
  "date-fns",

  "@mui/joy",
  '@mui/joy/Table',
  '@mui/joy/Typography',
  '@mui/joy/Sheet',
  '@mui/joy/Stack',
  '@mui/joy/Box',
  '@mui/joy/Card',
  '@mui/joy/CardContent',
  '@mui/joy/Divider',
  '@mui/joy/Grid',
  '@mui/joy/AccordionGroup',
  '@mui/joy/Accordion',
  '@mui/joy/AccordionDetails',
  '@mui/joy/AccordionSummary',
  '@mui/joy/Avatar',
  '@mui/joy/Chip',
  '@mui/joy/Tooltip',
  '@mui/joy/Button',
  '@mui/joy/FormControl',
  '@mui/joy/FormHelperText',
  '@mui/joy/IconButton',
  '@mui/joy/Input',
  '@mui/joy/Textarea',

  // REACT
  "react",
  "react/jsx-runtime",
  "react-router-dom",
  "react-dom",
  "react-icons",
  "@tanstack/react-query",
  '@tanstack/react-table',
  '@tanstack/react-virtual',

  // Monaco
  "@monaco-editor/react",
  "monaco-editor",
  "monaco-yaml",
  "yaml",

  // OMNIVIEW
  "@omniviewdev/runtime",
  "@omniviewdev/runtime/api",
  "@omniviewdev/runtime/models",
  "@omniviewdev/runtime/runtime",
];

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    omniviewExternals(external),
  ],
  server: {
    host: '127.0.0.1',
    port: 15173,
    cors: true,
    strictPort: false,
    hmr: {
      protocol: "ws",
      host: "127.0.0.1",
    },
  },
  build: {
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: {
      input: "src/entry.ts",
      output: {
        entryFileNames: "assets/entry.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
        format: 'system',
      },
      preserveEntrySignatures: 'exports-only',
      external,
    }
  },
});
```

### Diff summary

| Line/Section | Old | New | Reason |
|--------------|-----|-----|--------|
| Import | (none) | `import { omniviewExternals } from "@omniviewdev/vite-plugin"` | Shared deps bridge |
| `plugins` | `[react()]` | `[react(), omniviewExternals(external)]` | Externalize shared deps in serve mode |
| `server.host` | (implicit) | `'127.0.0.1'` | Wails webview compatibility |
| `server.origin` | `"http://localhost:15173"` | (removed) | Unnecessary, causes issues with dynamic ports |
| `server.strictPort` | `true` | `false` | Multi-plugin port incrementing |
| `hmr.host` | `"localhost"` | `"127.0.0.1"` | Wails webview compatibility |
| `hmr.port` | `15173` | (removed) | Auto-detect from server port |

---

## 4. Template for New Plugins

When a developer scaffolds a new plugin (via `omniview-plugin-dev init` or manually), they should start with this template.

### File: `<plugin-root>/ui/vite.config.ts`

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { omniviewExternals } from "@omniviewdev/vite-plugin";

// Shared dependencies provided by the host application.
// These are NOT bundled into your plugin -- they are resolved at runtime
// from the host's singleton instances.
//
// Add entries here when you import a package that the host already provides.
// The full list of available shared deps is in @omniviewdev/vite-plugin.
const external = [
  // React core (always required)
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-router-dom",

  // State management
  "@tanstack/react-query",

  // MUI Joy (add subpath imports as needed)
  "@emotion/react",
  "@emotion/styled",
  "@mui/joy",

  // Omniview runtime (always required for plugin API)
  "@omniviewdev/runtime",
  "@omniviewdev/runtime/api",
  "@omniviewdev/runtime/models",
  "@omniviewdev/runtime/runtime",
];

export default defineConfig({
  plugins: [
    react(),
    omniviewExternals(external),
  ],
  server: {
    host: '127.0.0.1',
    port: 15173,
    cors: true,
    strictPort: false,
    hmr: {
      protocol: "ws",
      host: "127.0.0.1",
    },
  },
  build: {
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: {
      input: "src/entry.ts",
      output: {
        entryFileNames: "assets/entry.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
        format: 'system',
      },
      preserveEntrySignatures: 'exports-only',
      external,
    },
  },
});
```

### Notes for plugin authors

1. **Only add externals you actually import.** Unnecessary externals do not cause errors, but they clutter the config. The `omniviewExternals` plugin only processes imports that match entries in the array.

2. **Subpath imports for MUI Joy**: If you import `import Chip from '@mui/joy/Chip'`, you must add `'@mui/joy/Chip'` to the external array. The plugin does exact-match comparison, not prefix-match, to avoid accidentally externalizing unrelated packages.

3. **The `external` array is used for both dev and build**: In dev mode, `omniviewExternals` intercepts them. In build mode, Rollup's `external` option excludes them. This single source of truth avoids drift.

4. **Port 15173 is a convention, not a requirement**: The DevServerManager detects the actual port from Vite's stdout. If you prefer a different base port, change it here.

---

## 5. Adding `@omniviewdev/vite-plugin` as a Dev Dependency

### For the Kubernetes plugin (or any existing plugin)

From the plugin's `ui/` directory:

```bash
cd plugins/kubernetes/ui
pnpm add -D @omniviewdev/vite-plugin
```

Since Omniview uses pnpm workspaces, if `@omniviewdev/vite-plugin` is a workspace package (defined in `packages/omniviewdev-vite-plugin/`), pnpm will link it automatically.

### Expected `package.json` addition

```json
{
  "devDependencies": {
    "@omniviewdev/vite-plugin": "workspace:*",
    "@vitejs/plugin-react": "^4.x",
    "vite": "^5.x"
  }
}
```

### For new plugins outside the monorepo

```bash
pnpm add -D @omniviewdev/vite-plugin
```

This installs from npm (once published). The version should match the Omniview version the plugin targets.

### Workspace configuration

The `@omniviewdev/vite-plugin` package must be listed in the root `pnpm-workspace.yaml`:

```yaml
packages:
  - 'packages/*'
  - 'plugins/*/ui'
  - 'ui'
```

And the package itself at `packages/omniviewdev-vite-plugin/package.json`:

```json
{
  "name": "@omniviewdev/vite-plugin",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --clean",
    "dev": "tsup src/index.ts --format esm --dts --watch"
  },
  "peerDependencies": {
    "vite": "^5.0.0 || ^6.0.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0"
  }
}
```

---

## 6. Verification Checklist

After applying these changes, verify:

- [ ] `pnpm run build` in `plugins/kubernetes/ui/` produces the same `dist/assets/entry.js` SystemJS bundle as before (no regressions in production build)
- [ ] `pnpm run dev` in `plugins/kubernetes/ui/` starts Vite on `127.0.0.1:15173` (or next available port)
- [ ] Vite logs show `Local: http://127.0.0.1:15173/` (not `localhost`)
- [ ] In the browser devtools console, `import("http://127.0.0.1:15173/src/entry.ts")` loads the plugin module
- [ ] Shared deps (react, @mui/joy, etc.) resolve to shim files, NOT bundled copies
- [ ] Editing a `.tsx` file triggers HMR update via WebSocket (visible in Network tab)
- [ ] Starting a second Vite instance on a different plugin auto-increments to port 15174
- [ ] The DevServerManager correctly reads the actual port from Vite's stdout output

---

## 7. How `omniviewExternals` Works

See [02-shared-deps-bridge.md](02-shared-deps-bridge.md) for the complete implementation.

In summary: the Vite plugin uses `resolve.alias` to redirect shared dependency imports (e.g., `react`, `@mui/joy/Button`) to pre-generated `.mjs` shim files. Each shim reads from `window.__OMNIVIEW_SHARED__` and re-exports with correct named exports. The plugin only activates in `serve` mode (Vite dev server); in `build` mode, Rollup's `external` config handles shared deps via SystemJS.
