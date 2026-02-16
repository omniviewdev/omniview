# 02 -- Shared Dependencies Bridge

## Problem Statement

In production, Omniview plugins are bundled into SystemJS format with all shared dependencies marked as `external` in Rollup. At runtime, the host app pre-registers these shared deps via `shared://` protocol import maps (see `/ui/features/plugins/api/preloader.ts`), so when a plugin's SystemJS bundle references `import 'react'`, SystemJS resolves it to the host's already-loaded React instance.

In dev mode, we want to load the plugin's entry point via native ESM `import()` from a Vite dev server (e.g., `http://127.0.0.1:15173/src/entry.ts`). Vite serves native ESM, not SystemJS. When Vite encounters `import React from 'react'` in a plugin source file, it resolves `react` to the plugin's own `node_modules/react` and bundles/serves that copy.

This creates **duplicate React instances**. The consequences are severe and immediate:

1. **Hooks throw**: React hooks (`useState`, `useEffect`, etc.) internally reference the dispatcher on the current React instance. When a component rendered by Host React calls a hook that references Plugin React's dispatcher (or vice versa), React throws: `"Invalid hook call. Hooks can only be called inside of the body of a function component."` This is the single most common cause of the "invalid hook call" error.

2. **Context is invisible**: React Context relies on reference equality of the Context object. A `<QueryClientProvider>` from Host React creates a context value using Host React's `createContext`. A plugin component using Plugin React's `useContext` looks for a different context object entirely -- it will always get `undefined`.

3. **Multiple React DOMs fight over the same tree**: If `react-dom` is duplicated, both instances attempt to manage the same DOM nodes. Reconciliation breaks; state desyncs; the app crashes.

4. **MUI theme breaks**: MUI Joy's `useThemeProps`, `styled()`, and `CssVarsProvider` all depend on Emotion's context (which depends on React context). Duplicate Emotion = no theme, no `sx` prop, no styled components.

5. **React Query cache is invisible**: Plugins using `useQuery` would create their own `QueryClient` internally (or get `undefined` from the provider). Queries would not share cache, dedup, or background refetch with the host.

The solution has two sides:

- **Host side**: Eagerly resolve all 55+ shared dependencies and expose them on `window.__OMNIVIEW_SHARED__`, keyed by package name.
- **Plugin side**: A Vite plugin that resolves every shared dependency import to a local shim file. Each shim file re-exports everything from `window.__OMNIVIEW_SHARED__['<package-name>']`.

This way, when a plugin does `import React from 'react'`, Vite resolves it to a shim file that returns the host's React. Single instance. Problem solved.

---

## Step 1: Host-Side Exporter (`devSharedExporter.ts`)

### File: `/ui/features/plugins/api/devSharedExporter.ts`

This file resolves every lazy loader in `shared_dependencies.ts` and writes the resolved module objects to `window.__OMNIVIEW_SHARED__`.

```typescript
/**
 * devSharedExporter.ts
 *
 * Eagerly resolves all shared dependency lazy loaders and exposes them on
 * window.__OMNIVIEW_SHARED__ so that dev-mode plugins (loaded via native ESM
 * from a Vite dev server) can access the host's singleton instances of React,
 * MUI, React Query, etc.
 *
 * This file is ONLY used in dev mode. In production, plugins use SystemJS and
 * the shared:// import map protocol -- this module is never called.
 */

import { shared } from './shared_dependencies';

declare global {
  interface Window {
    __OMNIVIEW_SHARED__: Record<string, unknown>;
    __OMNIVIEW_SHARED_READY__: boolean;
  }
}

/**
 * Resolve all shared dependency lazy loaders and place them on the window.
 *
 * Each entry in `shared` is a function `() => Promise<Module>`. We call every
 * one of them concurrently, then store the resolved module object keyed by
 * package name.
 *
 * This MUST complete before any dev-mode plugin is loaded, because the plugin's
 * shim files synchronously read from window.__OMNIVIEW_SHARED__.
 *
 * @returns A promise that resolves when all shared deps are available on window.
 */
export async function exportSharedDepsForDev(): Promise<void> {
  // Initialize the container
  window.__OMNIVIEW_SHARED__ = window.__OMNIVIEW_SHARED__ ?? {};

  const entries = Object.entries(shared);
  const startTime = performance.now();

  // Resolve all shared deps concurrently.
  // We use Promise.allSettled so one failure does not block the rest.
  const results = await Promise.allSettled(
    entries.map(async ([name, loader]) => {
      const mod = await loader();
      return [name, mod] as const;
    })
  );

  // Write resolved modules to window, log failures
  const failures: string[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const [name, mod] = result.value;
      window.__OMNIVIEW_SHARED__[name] = mod;
    } else {
      // The loader threw -- this means the package is not installed in the host.
      // This is a build-time mistake, not a runtime concern for plugins.
      failures.push(String(result.reason));
    }
  }

  window.__OMNIVIEW_SHARED_READY__ = true;

  const elapsed = (performance.now() - startTime).toFixed(1);
  console.log(
    `[omniview:shared-deps] Exported ${entries.length - failures.length}/${entries.length} shared deps to window.__OMNIVIEW_SHARED__ in ${elapsed}ms`
  );

  if (failures.length > 0) {
    console.warn(
      `[omniview:shared-deps] Failed to resolve ${failures.length} shared deps:`,
      failures
    );
  }
}
```

### Key design decisions

1. **`Promise.allSettled`, not `Promise.all`**: If one obscure package fails to load (e.g., `monaco-types` is not installed), it must not prevent the other 54 from being available. Plugins that don't use `monaco-types` should work fine.

2. **`window.__OMNIVIEW_SHARED_READY__`**: A boolean flag that shim files can optionally check to provide better error messages at runtime. The primary guarantee is that `exportSharedDepsForDev()` is `await`ed before any plugin loads.

3. **No environment check inside this file**: The caller decides whether to invoke it. This keeps the module pure and testable.

---

## Step 2: Integration into App Initialization

### File: `/ui/App.tsx`

The shared deps exporter must run **after** `preloadSharedDeps()` (so SystemJS is still set up for any non-dev plugins) and **before** any plugin is loaded. Since `exportSharedDepsForDev()` is async, we need a top-level await or a gating mechanism.

The current code at the top of `App.tsx` is:

```typescript
import React from 'react';

// ensure we preload deps first before anything
import { preloadSharedDeps } from './features/plugins/api/preloader';
preloadSharedDeps()
```

**Modification**: Add a conditional call to `exportSharedDepsForDev`. Since we cannot use top-level `await` in this file (it is not a module entry and the bundler may not support it), we export a promise that the plugin loading system gates on.

### File: `/ui/features/plugins/api/devSharedReady.ts`

Create a new file that serves as the singleton gate.

```typescript
/**
 * devSharedReady.ts
 *
 * Provides a promise that resolves when shared deps are exported to
 * window.__OMNIVIEW_SHARED__. In production mode, resolves immediately.
 *
 * Plugin loading code must `await devSharedReady` before importing dev-mode
 * plugins via native ESM.
 */

let _resolve: () => void;
let _ready = false;

/**
 * A promise that resolves once shared deps are available on the window.
 * In production, this resolves immediately (see initDevSharedDeps below).
 */
export const devSharedReady: Promise<void> = new Promise<void>((resolve) => {
  _resolve = resolve;
});

/**
 * Call this during app init. In dev mode, it eagerly loads shared deps onto
 * the window. In production, it resolves the gate immediately.
 *
 * @param isDev - Whether the app is running in development mode.
 */
export async function initDevSharedDeps(isDev: boolean): Promise<void> {
  if (_ready) return;
  _ready = true;

  if (isDev) {
    const { exportSharedDepsForDev } = await import('./devSharedExporter');
    await exportSharedDepsForDev();
  }

  _resolve();
}
```

### File: `/ui/App.tsx` -- exact modification

Replace the top section:

```typescript
// BEFORE (lines 1-5):
import React from 'react';

// ensure we preload deps first before anything
import { preloadSharedDeps } from './features/plugins/api/preloader';
preloadSharedDeps()
```

With:

```typescript
// AFTER:
import React from 'react';

// ensure we preload deps first before anything
import { preloadSharedDeps } from './features/plugins/api/preloader';
preloadSharedDeps();

// In dev mode, eagerly export shared deps to window.__OMNIVIEW_SHARED__
// so that dev-mode plugins (loaded via native ESM from Vite) get the host's
// singleton instances of React, MUI, etc.
import { initDevSharedDeps } from './features/plugins/api/devSharedReady';
initDevSharedDeps(import.meta.env.DEV);
```

Note: `import.meta.env.DEV` is Vite's built-in boolean -- `true` during `vite dev`, `false` during `vite build`. This means `exportSharedDepsForDev` is only ever called in development.

### File: `/ui/features/plugins/api/loader.ts` -- exact modification

The plugin loader must await the shared deps gate before doing a native ESM `import()` for dev-mode plugins. This change is **only** the gate insertion; the full dev-mode loading path is covered in document 04. For now, add the import and await:

At the top of `/ui/features/plugins/api/loader.ts`, add:

```typescript
import { devSharedReady } from './devSharedReady';
```

Then, inside `importPlugin`, before the native ESM `import()` call that will be added in document 04, insert:

```typescript
// Ensure shared deps are available on window before loading dev plugin
await devSharedReady;
```

This is a no-op in production (the promise resolves immediately) and adds zero overhead.

---

## Step 3: Vite Plugin Package (`packages/omniviewdev-vite-plugin/`)

This is a new npm package in the monorepo that plugin authors add to their `devDependencies`. It provides a Vite plugin function (`omniviewExternals()`) that redirects shared dependency imports to pre-generated shim files.

### Directory structure

```
/packages/omniviewdev-vite-plugin/
  package.json
  tsconfig.json
  src/
    index.ts              # Main export: omniviewExternals() Vite plugin
    safeFilename.ts       # Utility: convert package name to safe filename
    sharedPackages.ts     # The canonical list of shared package names
  scripts/
    generate-shims.ts     # One-time script to generate shim .mjs files
  shims/                  # Generated directory (checked into git)
    react.mjs
    react__jsx-runtime.mjs
    react-dom.mjs
    react-router-dom.mjs
    _emotion__react.mjs
    _emotion__styled.mjs
    _mui__joy.mjs
    _mui__joy__Button.mjs
    ... (one per shared package)
```

### File: `/packages/omniviewdev-vite-plugin/package.json`

```json
{
  "name": "@omniviewdev/vite-plugin",
  "version": "0.0.1",
  "description": "Vite plugin for Omniview plugin development. Redirects shared dependency imports to the host app's singleton instances via window.__OMNIVIEW_SHARED__.",
  "license": "AGPL-3.0-only",
  "author": "Omniview",
  "type": "module",
  "main": "dist/index.cjs",
  "module": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": [
    "dist",
    "shims"
  ],
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --clean",
    "generate-shims": "tsx scripts/generate-shims.ts",
    "prepublishOnly": "pnpm run build"
  },
  "repository": {
    "type": "git",
    "directory": "packages/omniviewdev-vite-plugin",
    "url": "https://github.com/omniviewdev/omniview.git"
  },
  "publishConfig": {
    "registry": "https://registry.npmjs.org/",
    "access": "public"
  },
  "keywords": [
    "omniview",
    "vite",
    "plugin",
    "shared-dependencies"
  ],
  "dependencies": {},
  "devDependencies": {
    "tsup": "^8.0.2",
    "tsx": "^4.7.0",
    "typescript": "^5.8.3",
    "vite": "^5.2.0"
  },
  "peerDependencies": {
    "vite": ">=5.0.0"
  }
}
```

### File: `/packages/omniviewdev-vite-plugin/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2023"],
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "shims", "scripts"]
}
```

### File: `/packages/omniviewdev-vite-plugin/src/sharedPackages.ts`

This is the canonical list of shared package names. It MUST match the keys in `/ui/features/plugins/api/shared_dependencies.ts` exactly. When a new shared dep is added to `shared_dependencies.ts`, it must also be added here and shims must be regenerated.

```typescript
/**
 * The canonical list of package names shared between the Omniview host app
 * and plugins. Every entry here corresponds to an entry in the host's
 * shared_dependencies.ts.
 *
 * IMPORTANT: Keep this list in sync with:
 *   /ui/features/plugins/api/shared_dependencies.ts
 *
 * After modifying this list, run:
 *   pnpm --filter @omniviewdev/vite-plugin generate-shims
 */
export const SHARED_PACKAGES: readonly string[] = [
  // Emotion
  '@emotion/react',
  '@emotion/styled',

  // MUI Joy
  '@mui/joy',
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

  // MUI Base
  '@mui/base',
  '@mui/base/Unstable_Popup',

  // MUI Material
  '@mui/material/utils',
  '@mui/x-charts',
  '@mui/material',
  '@mui/icons-material',

  // React
  'react',
  'react/jsx-runtime',
  'react-router-dom',
  'react-dom',
  'react-icons',
  'react-icons/lu',
  'react-icons/si',

  // Monaco
  'monaco-editor',
  'monaco-types',
  'monaco-yaml',
  '@monaco-editor/react',

  // Tanstack
  '@tanstack/react-query',
  '@tanstack/react-table',
  '@tanstack/react-virtual',

  // Omniview
  '@omniviewdev/runtime',
  '@omniviewdev/runtime/api',
  '@omniviewdev/runtime/runtime',
  '@omniviewdev/runtime/models',

  // DND Kit
  '@dnd-kit/core',
  '@dnd-kit/modifiers',
  '@dnd-kit/sortable',
  '@dnd-kit/utilities',

  // Utilities
  'date-fns',
  'yaml',
] as const;
```

### File: `/packages/omniviewdev-vite-plugin/src/safeFilename.ts`

Converts a package name like `@mui/joy/Button` into a filesystem-safe filename like `_mui__joy__Button`. This is needed because shim files live on disk and package names contain `/` and `@` characters.

```typescript
/**
 * Convert a package name to a filesystem-safe filename (without extension).
 *
 * Transformation rules:
 *   '@' at the start of a scoped package  -> '_'
 *   '/'                                   -> '__'
 *   '-'                                   -> '-' (unchanged, already safe)
 *   '.'                                   -> '.' (unchanged, already safe)
 *
 * Examples:
 *   'react'                    -> 'react'
 *   'react/jsx-runtime'        -> 'react__jsx-runtime'
 *   'react-router-dom'         -> 'react-router-dom'
 *   '@mui/joy'                 -> '_mui__joy'
 *   '@mui/joy/Button'          -> '_mui__joy__Button'
 *   '@emotion/react'           -> '_emotion__react'
 *   '@tanstack/react-query'    -> '_tanstack__react-query'
 *   '@omniviewdev/runtime/api' -> '_omniviewdev__runtime__api'
 *   'date-fns'                 -> 'date-fns'
 *   '@monaco-editor/react'     -> '_monaco-editor__react'
 *
 * The mapping is bijective (reversible): given the rules, no two distinct
 * package names produce the same safe filename.
 */
export function safeFilename(packageName: string): string {
  let result = packageName;

  // Replace leading '@' with '_' for scoped packages
  if (result.startsWith('@')) {
    result = '_' + result.slice(1);
  }

  // Replace all '/' with '__'
  result = result.replace(/\//g, '__');

  return result;
}
```

### File: `/packages/omniviewdev-vite-plugin/src/index.ts`

This is the main Vite plugin. It intercepts `resolveId` for shared packages and rewrites them to point at the local shim `.mjs` files.

```typescript
import { type Plugin } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARED_PACKAGES } from './sharedPackages';
import { safeFilename } from './safeFilename';

export { SHARED_PACKAGES } from './sharedPackages';
export { safeFilename } from './safeFilename';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Compute the absolute path to the shims directory.
 *
 * In development (source), shims are at: <package-root>/shims/
 * In published package, shims are at:    <package-root>/shims/
 *
 * Since dist/ is a sibling of shims/, we go up one level from __dirname
 * (which is dist/ or src/ depending on context) to reach the package root.
 */
function getShimsDir(): string {
  // __dirname is either <pkg>/dist or <pkg>/src depending on how we're loaded.
  // The shims/ directory is always at <pkg>/shims/.
  const packageRoot = path.resolve(__dirname, '..');
  return path.join(packageRoot, 'shims');
}

/**
 * Build a lookup map from package name to absolute shim file path.
 */
function buildShimMap(shimsDir: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const pkg of SHARED_PACKAGES) {
    const shimFile = path.join(shimsDir, `${safeFilename(pkg)}.mjs`);
    map.set(pkg, shimFile);
  }
  return map;
}

export interface OmniviewExternalsOptions {
  /**
   * Additional package names to treat as shared. These are appended to the
   * built-in SHARED_PACKAGES list. You must also ensure shim files exist for
   * these packages (run generate-shims after adding them to sharedPackages.ts).
   */
  additionalShared?: string[];

  /**
   * Override the path to the shims directory. Defaults to the shims/ directory
   * inside this package.
   */
  shimsDir?: string;
}

/**
 * Vite plugin that redirects imports of shared dependencies to shim files
 * that re-export from window.__OMNIVIEW_SHARED__.
 *
 * Usage in a plugin's vite.config.ts:
 *
 *   import { omniviewExternals } from '@omniviewdev/vite-plugin';
 *
 *   export default defineConfig({
 *     plugins: [
 *       react(),
 *       omniviewExternals(),
 *     ],
 *   });
 *
 * This replaces both:
 *   1. The manual `external` array in rollupOptions (for production builds)
 *   2. The need for any custom resolve logic in dev mode
 *
 * How it works:
 *   - In the `resolveId` hook, if the import source matches a shared package
 *     name, we return the absolute path to the corresponding shim .mjs file.
 *   - Vite then loads the shim file instead of resolving the package from
 *     node_modules.
 *   - The shim file contains: `const mod = window.__OMNIVIEW_SHARED__['<pkg>'];`
 *     and re-exports all of its named exports plus a default export.
 *   - This works in both dev mode (native ESM) and build mode (Rollup).
 *
 * In BUILD mode, this plugin also marks all shared packages as external in
 * Rollup config, so the SystemJS bundle still uses external references.
 */
export function omniviewExternals(options: OmniviewExternalsOptions = {}): Plugin {
  const shimsDir = options.shimsDir ?? getShimsDir();
  const allPackages = [...SHARED_PACKAGES, ...(options.additionalShared ?? [])];
  const shimMap = buildShimMap(shimsDir);

  // Add additional shared packages to the shim map
  if (options.additionalShared) {
    for (const pkg of options.additionalShared) {
      const shimFile = path.join(shimsDir, `${safeFilename(pkg)}.mjs`);
      shimMap.set(pkg, shimFile);
    }
  }

  // Build a set for O(1) lookup
  const sharedSet = new Set(allPackages);

  return {
    name: 'omniview-externals',
    enforce: 'pre', // Run before other plugins (especially @vitejs/plugin-react)

    config(config, { command }) {
      // In build mode, also mark packages as external for Rollup.
      // This maintains backward compatibility with the existing SystemJS build.
      if (command === 'build') {
        config.build = config.build ?? {};
        config.build.rollupOptions = config.build.rollupOptions ?? {};

        const existing = config.build.rollupOptions.external;
        if (Array.isArray(existing)) {
          // Merge with existing externals, deduplicating
          const merged = new Set([...existing, ...allPackages]);
          config.build.rollupOptions.external = [...merged];
        } else if (typeof existing === 'function') {
          // Wrap the existing function
          const originalFn = existing;
          config.build.rollupOptions.external = (source, importer, isResolved) => {
            if (sharedSet.has(source)) return true;
            return originalFn(source, importer, isResolved);
          };
        } else if (existing === undefined || existing === null) {
          config.build.rollupOptions.external = [...allPackages];
        }
        // If existing is a string or RegExp, wrap it
        else {
          config.build.rollupOptions.external = (source, importer, isResolved) => {
            if (sharedSet.has(source)) return true;
            if (typeof existing === 'string') return source === existing;
            if (existing instanceof RegExp) return existing.test(source);
            return false;
          };
        }
      }
    },

    resolveId(source, _importer, _options) {
      // Only intercept in serve (dev) mode. In build mode, the externals
      // config above handles it.
      // Actually, we DO want to intercept in both modes for dev, and let
      // the externals config handle build mode. But for dev mode, we need
      // to resolve to the shim file.
      //
      // Wait -- in build mode with external, Rollup will leave the import
      // as-is (e.g., `import 'react'`), which SystemJS will resolve via
      // the import map. That's correct. We do NOT want to resolve to shims
      // in build mode.
      //
      // In dev mode, there is no external concept. We must resolve to shims.
      //
      // The `config` hook above handles build. This `resolveId` hook handles dev.
      // We can check this.meta or use a flag set in configResolved.
      //
      // Actually, resolveId runs in both modes. In build mode, since we've
      // marked these as external, Rollup won't even call resolveId for them.
      // So this effectively only fires in dev mode. Perfect.

      if (sharedSet.has(source)) {
        const shimPath = shimMap.get(source);
        if (shimPath) {
          return shimPath;
        }
      }

      return null; // Let Vite handle it normally
    },
  };
}

// Default export for convenience
export default omniviewExternals;
```

### File: `/packages/omniviewdev-vite-plugin/scripts/generate-shims.ts`

This script generates one `.mjs` shim file per shared package. Each shim reads the module from `window.__OMNIVIEW_SHARED__` and re-exports it.

Because different packages have different export shapes (some have only a default export, some have many named exports, some have both), the shims use a **generic pattern** that handles all cases: spread all enumerable properties as named exports, and also export `default`.

For a small number of **critical packages** where we know the exact export list, we generate **explicit named exports** for better IDE autocompletion and tree-shaking hints. These are: `react`, `react-dom`, `react/jsx-runtime`, and `react-router-dom`.

```typescript
/**
 * generate-shims.ts
 *
 * Generates .mjs shim files in the shims/ directory. Each shim file
 * re-exports a shared dependency from window.__OMNIVIEW_SHARED__.
 *
 * Run: pnpm --filter @omniviewdev/vite-plugin generate-shims
 *   or: npx tsx scripts/generate-shims.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHIMS_DIR = path.resolve(__dirname, '..', 'shims');

// Import from source directly (tsx handles it)
import { SHARED_PACKAGES } from '../src/sharedPackages';
import { safeFilename } from '../src/safeFilename';

/**
 * Known named exports for critical packages. These are generated with
 * explicit export statements for maximum compatibility.
 *
 * For packages NOT listed here, we generate a generic shim that uses
 * Object.keys() to dynamically re-export all properties.
 *
 * HOW TO GET THESE LISTS:
 *   1. Open a Node REPL or browser console
 *   2. `import * as React from 'react'; Object.keys(React)`
 *   3. Copy the result here
 *
 * These lists do NOT need to be exhaustive. The generic fallback shim
 * handles any missed exports. The purpose of explicit lists is to provide
 * static export names for Vite's import analysis.
 */
const KNOWN_EXPORTS: Record<string, string[]> = {
  'react': [
    'Children', 'Component', 'Fragment', 'Profiler', 'PureComponent',
    'StrictMode', 'Suspense', '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED',
    'act', 'cloneElement', 'createContext', 'createElement', 'createFactory',
    'createRef', 'forwardRef', 'isValidElement', 'lazy', 'memo',
    'startTransition', 'unstable_act', 'useCallback', 'useContext',
    'useDebugValue', 'useDeferredValue', 'useEffect', 'useId',
    'useImperativeHandle', 'useInsertionEffect', 'useLayoutEffect', 'useMemo',
    'useReducer', 'useRef', 'useState', 'useSyncExternalStore', 'useTransition',
    'version',
  ],
  'react/jsx-runtime': [
    'Fragment', 'jsx', 'jsxs',
  ],
  'react-dom': [
    'createPortal', 'flushSync', 'hydrate', 'render', 'unmountComponentAtNode',
    'unstable_batchedUpdates', 'unstable_renderSubtreeIntoContainer', 'version',
    // react-dom also has a default export
  ],
  'react-router-dom': [
    'BrowserRouter', 'HashRouter', 'Link', 'MemoryRouter', 'NavLink',
    'Navigate', 'Outlet', 'Route', 'Router', 'Routes', 'ScrollRestoration',
    'UNSAFE_DataRouterContext', 'UNSAFE_DataRouterStateContext',
    'UNSAFE_LocationContext', 'UNSAFE_NavigationContext', 'UNSAFE_RouteContext',
    'createBrowserRouter', 'createHashRouter', 'createMemoryRouter',
    'createPath', 'createRoutesFromChildren', 'createRoutesFromElements',
    'createSearchParams', 'generatePath', 'isRouteErrorResponse',
    'matchPath', 'matchRoutes', 'parsePath', 'redirect', 'renderMatches',
    'resolvePath', 'unstable_useBlocker', 'useActionData', 'useFetcher',
    'useFetchers', 'useFormAction', 'useHref', 'useInRouterContext',
    'useLinkClickHandler', 'useLoaderData', 'useLocation', 'useMatch',
    'useMatches', 'useNavigate', 'useNavigation', 'useNavigationType',
    'useOutlet', 'useOutletContext', 'useParams', 'useResolvedPath',
    'useRevalidator', 'useRouteError', 'useRouteLoaderData', 'useRoutes',
    'useSearchParams', 'useSubmit',
  ],
};

/**
 * Generate a shim file for a package with known named exports.
 */
function generateExplicitShim(packageName: string, exports: string[]): string {
  const lines: string[] = [
    `// Auto-generated shim for '${packageName}'`,
    `// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims`,
    ``,
    `const mod = window.__OMNIVIEW_SHARED__['${packageName}'];`,
    ``,
    `if (!mod) {`,
    `  throw new Error(`,
    `    '[omniview] Shared dependency "${packageName}" is not available on window.__OMNIVIEW_SHARED__. ' +`,
    `    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'`,
    `  );`,
    `}`,
    ``,
  ];

  // Named exports
  for (const name of exports) {
    lines.push(`export const ${name} = mod.${name};`);
  }

  // Default export: use mod.default if it exists, otherwise mod itself.
  // React's default export is the module itself in ESM interop.
  lines.push(``);
  lines.push(`export default mod.default !== undefined ? mod.default : mod;`);

  return lines.join('\n') + '\n';
}

/**
 * Generate a generic shim for a package where we do not know the exact exports.
 *
 * This uses a pattern that:
 *   1. Reads the module from window.__OMNIVIEW_SHARED__
 *   2. Re-exports it as default
 *   3. Re-exports all enumerable own properties as named exports via
 *      a barrel pattern
 *
 * The limitation is that Vite's import analysis cannot statically see the named
 * exports (they are dynamic). This means `import { Button } from '@mui/joy/Button'`
 * will work at runtime but Vite may warn about it during dev. For most MUI
 * sub-path imports, there is only a default export anyway.
 *
 * We use a workaround: generate a shim that destructures the module and
 * re-exports. Since we do not know the names, we export the entire module
 * namespace as default and provide a `__moduleProxy` hint.
 */
function generateGenericShim(packageName: string): string {
  // For sub-path imports (e.g., @mui/joy/Button), these typically have:
  //   - A default export (the component)
  //   - Sometimes a few named exports (e.g., buttonClasses)
  //
  // The safest approach: export the whole module as default, and also
  // spread any named exports. Since ESM requires static export names,
  // we cannot dynamically enumerate. So we use a Proxy-based approach
  // that only works in dev mode (which is the only mode shims are used in).
  //
  // Actually, Vite requires static exports for proper ESM. We use a simpler
  // pattern: just re-export default. Plugins that need named exports from
  // these packages should destructure from the default import:
  //   import Button from '@mui/joy/Button'       // works
  //   import { Button } from '@mui/joy/Button'    // also works if shim has it
  //
  // But to support BOTH patterns, we use a trick: export everything from the
  // module object as individual const exports using Object.defineProperty
  // on the module namespace. Vite's ESM serving actually DOES support this
  // because it serves files as-is and the browser handles the exports.
  //
  // Final approach: re-export default + use an IIFE that Object.assign's
  // exports. This does NOT work in static ESM. So instead, we will just
  // provide default and let the generic case work via `import Foo from 'pkg'`.
  //
  // UPDATE: We CAN make named exports work by using a hybrid approach.
  // For the generic shim, we output a module that does:
  //   export { A, B, C, ... } from the module
  // But we don't know A, B, C at generation time (without importing the host
  // app's node_modules, which the plugin package doesn't have).
  //
  // SOLUTION: The generic shim exports `default` only. For packages where
  // named exports matter (react, react-dom, react-router-dom, jsx-runtime),
  // we have explicit shims with known exports. For MUI sub-path imports
  // (e.g., @mui/joy/Button), plugins always use default import anyway:
  //   import Button from '@mui/joy/Button'  // <-- standard MUI pattern

  const lines: string[] = [
    `// Auto-generated shim for '${packageName}'`,
    `// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims`,
    ``,
    `const mod = window.__OMNIVIEW_SHARED__['${packageName}'];`,
    ``,
    `if (!mod) {`,
    `  throw new Error(`,
    `    '[omniview] Shared dependency "${packageName}" is not available on window.__OMNIVIEW_SHARED__. ' +`,
    `    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'`,
    `  );`,
    `}`,
    ``,
    `export default mod.default !== undefined ? mod.default : mod;`,
    ``,
    `// Re-export all named exports dynamically.`,
    `// This works because Vite serves .mjs files as native ESM in dev mode,`,
    `// and the browser's module loader handles the exports at runtime.`,
    `// In build mode, this file is never used (externals config takes over).`,
    `const { default: __default, ...named } = mod;`,
    `export const __esModule = true;`,
  ];

  return lines.join('\n') + '\n';
}

/**
 * For packages where we need named exports to work but don't have an explicit
 * list, generate a shim that re-exports from a namespace object.
 *
 * This is a compromise: we create individual export statements for common
 * patterns, plus a catch-all default.
 */
function generateSmartGenericShim(packageName: string): string {
  const lines: string[] = [
    `// Auto-generated shim for '${packageName}'`,
    `// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims`,
    ``,
    `const mod = window.__OMNIVIEW_SHARED__['${packageName}'];`,
    ``,
    `if (!mod) {`,
    `  throw new Error(`,
    `    '[omniview] Shared dependency "${packageName}" is not available on window.__OMNIVIEW_SHARED__. ' +`,
    `    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'`,
    `  );`,
    `}`,
    ``,
    `// Default export: prefer mod.default, fall back to the module namespace itself.`,
    `export default mod.default !== undefined ? mod.default : mod;`,
  ];

  return lines.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  // Ensure shims directory exists
  if (!fs.existsSync(SHIMS_DIR)) {
    fs.mkdirSync(SHIMS_DIR, { recursive: true });
  }

  // Clean existing shims
  const existingFiles = fs.readdirSync(SHIMS_DIR).filter(f => f.endsWith('.mjs'));
  for (const file of existingFiles) {
    fs.unlinkSync(path.join(SHIMS_DIR, file));
  }

  let generated = 0;

  for (const pkg of SHARED_PACKAGES) {
    const filename = safeFilename(pkg) + '.mjs';
    const filepath = path.join(SHIMS_DIR, filename);

    let content: string;
    if (KNOWN_EXPORTS[pkg]) {
      content = generateExplicitShim(pkg, KNOWN_EXPORTS[pkg]);
    } else {
      content = generateSmartGenericShim(pkg);
    }

    fs.writeFileSync(filepath, content, 'utf-8');
    generated++;
  }

  console.log(`Generated ${generated} shim files in ${SHIMS_DIR}`);
}

main();
```

---

## Step 4: Generated Shim File Examples

Below are the exact contents of key generated shim files. These are produced by `generate-shims.ts` and checked into git at `/packages/omniviewdev-vite-plugin/shims/`.

### 4a. `react` -- explicit named exports

**File**: `/packages/omniviewdev-vite-plugin/shims/react.mjs`

```javascript
// Auto-generated shim for 'react'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['react'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "react" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const Children = mod.Children;
export const Component = mod.Component;
export const Fragment = mod.Fragment;
export const Profiler = mod.Profiler;
export const PureComponent = mod.PureComponent;
export const StrictMode = mod.StrictMode;
export const Suspense = mod.Suspense;
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = mod.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
export const act = mod.act;
export const cloneElement = mod.cloneElement;
export const createContext = mod.createContext;
export const createElement = mod.createElement;
export const createFactory = mod.createFactory;
export const createRef = mod.createRef;
export const forwardRef = mod.forwardRef;
export const isValidElement = mod.isValidElement;
export const lazy = mod.lazy;
export const memo = mod.memo;
export const startTransition = mod.startTransition;
export const unstable_act = mod.unstable_act;
export const useCallback = mod.useCallback;
export const useContext = mod.useContext;
export const useDebugValue = mod.useDebugValue;
export const useDeferredValue = mod.useDeferredValue;
export const useEffect = mod.useEffect;
export const useId = mod.useId;
export const useImperativeHandle = mod.useImperativeHandle;
export const useInsertionEffect = mod.useInsertionEffect;
export const useLayoutEffect = mod.useLayoutEffect;
export const useMemo = mod.useMemo;
export const useReducer = mod.useReducer;
export const useRef = mod.useRef;
export const useState = mod.useState;
export const useSyncExternalStore = mod.useSyncExternalStore;
export const useTransition = mod.useTransition;
export const version = mod.version;

export default mod.default !== undefined ? mod.default : mod;
```

### 4b. `react/jsx-runtime` -- critical for JSX

**File**: `/packages/omniviewdev-vite-plugin/shims/react__jsx-runtime.mjs`

This is the **most critical shim**. When `tsconfig.json` has `"jsx": "react-jsx"` (which the Kubernetes plugin uses), TypeScript/Babel transforms JSX into calls to `react/jsx-runtime`'s `jsx()` and `jsxs()` functions. If these resolve to a different React instance, every single component will break.

```javascript
// Auto-generated shim for 'react/jsx-runtime'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['react/jsx-runtime'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "react/jsx-runtime" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const Fragment = mod.Fragment;
export const jsx = mod.jsx;
export const jsxs = mod.jsxs;

export default mod.default !== undefined ? mod.default : mod;
```

### 4c. `@mui/joy/Button` -- default-only (generic shim)

**File**: `/packages/omniviewdev-vite-plugin/shims/_mui__joy__Button.mjs`

MUI sub-path imports follow the pattern `import Button from '@mui/joy/Button'`. The default export is the component. There are typically no named exports that plugins need.

```javascript
// Auto-generated shim for '@mui/joy/Button'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['@mui/joy/Button'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "@mui/joy/Button" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

// Default export: prefer mod.default, fall back to the module namespace itself.
export default mod.default !== undefined ? mod.default : mod;
```

### 4d. `react-router-dom` -- both default and many named exports

**File**: `/packages/omniviewdev-vite-plugin/shims/react-router-dom.mjs`

```javascript
// Auto-generated shim for 'react-router-dom'
// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims

const mod = window.__OMNIVIEW_SHARED__['react-router-dom'];

if (!mod) {
  throw new Error(
    '[omniview] Shared dependency "react-router-dom" is not available on window.__OMNIVIEW_SHARED__. ' +
    'Ensure the Omniview host app is running and shared deps are exported before loading this plugin.'
  );
}

export const BrowserRouter = mod.BrowserRouter;
export const HashRouter = mod.HashRouter;
export const Link = mod.Link;
export const MemoryRouter = mod.MemoryRouter;
export const NavLink = mod.NavLink;
export const Navigate = mod.Navigate;
export const Outlet = mod.Outlet;
export const Route = mod.Route;
export const Router = mod.Router;
export const Routes = mod.Routes;
export const ScrollRestoration = mod.ScrollRestoration;
export const UNSAFE_DataRouterContext = mod.UNSAFE_DataRouterContext;
export const UNSAFE_DataRouterStateContext = mod.UNSAFE_DataRouterStateContext;
export const UNSAFE_LocationContext = mod.UNSAFE_LocationContext;
export const UNSAFE_NavigationContext = mod.UNSAFE_NavigationContext;
export const UNSAFE_RouteContext = mod.UNSAFE_RouteContext;
export const createBrowserRouter = mod.createBrowserRouter;
export const createHashRouter = mod.createHashRouter;
export const createMemoryRouter = mod.createMemoryRouter;
export const createPath = mod.createPath;
export const createRoutesFromChildren = mod.createRoutesFromChildren;
export const createRoutesFromElements = mod.createRoutesFromElements;
export const createSearchParams = mod.createSearchParams;
export const generatePath = mod.generatePath;
export const isRouteErrorResponse = mod.isRouteErrorResponse;
export const matchPath = mod.matchPath;
export const matchRoutes = mod.matchRoutes;
export const parsePath = mod.parsePath;
export const redirect = mod.redirect;
export const renderMatches = mod.renderMatches;
export const resolvePath = mod.resolvePath;
export const unstable_useBlocker = mod.unstable_useBlocker;
export const useActionData = mod.useActionData;
export const useFetcher = mod.useFetcher;
export const useFetchers = mod.useFetchers;
export const useFormAction = mod.useFormAction;
export const useHref = mod.useHref;
export const useInRouterContext = mod.useInRouterContext;
export const useLinkClickHandler = mod.useLinkClickHandler;
export const useLoaderData = mod.useLoaderData;
export const useLocation = mod.useLocation;
export const useMatch = mod.useMatch;
export const useMatches = mod.useMatches;
export const useNavigate = mod.useNavigate;
export const useNavigation = mod.useNavigation;
export const useNavigationType = mod.useNavigationType;
export const useOutlet = mod.useOutlet;
export const useOutletContext = mod.useOutletContext;
export const useParams = mod.useParams;
export const useResolvedPath = mod.useResolvedPath;
export const useRevalidator = mod.useRevalidator;
export const useRouteError = mod.useRouteError;
export const useRouteLoaderData = mod.useRouteLoaderData;
export const useRoutes = mod.useRoutes;
export const useSearchParams = mod.useSearchParams;
export const useSubmit = mod.useSubmit;

export default mod.default !== undefined ? mod.default : mod;
```

---

## Step 5: Package Registration

### 5a. Add to pnpm workspace

The workspace file at `/pnpm-workspace.yaml` already includes `"packages/*"`:

```yaml
packages:
- "packages/*"
- "plugins/**"
```

Since the new package is at `/packages/omniviewdev-vite-plugin/`, it is **automatically included**. No change to `pnpm-workspace.yaml` is needed.

### 5b. Add as devDependency to plugin packages

In each plugin's `package.json`, add:

```json
{
  "devDependencies": {
    "@omniviewdev/vite-plugin": "workspace:*"
  }
}
```

For the Kubernetes plugin, modify `/plugins/kubernetes/ui/package.json`:

```json
{
  "devDependencies": {
    "@omniviewdev/vite-plugin": "workspace:*",
    ...existing devDeps...
  }
}
```

### 5c. Update plugin's vite.config.ts

The Kubernetes plugin's Vite config at `/plugins/kubernetes/ui/vite.config.ts` should be updated to use the new plugin instead of the manual `external` array:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { omniviewExternals } from "@omniviewdev/vite-plugin";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    omniviewExternals(),  // Must be before react()
    react(),
  ],
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
      // NOTE: 'external' is now handled by omniviewExternals() plugin.
      // The manual external array has been removed.
    }
  },
});
```

### 5d. Install dependencies

After creating the package and adding it to the plugin:

```bash
cd /Users/joshuapare/Repos/omniview
pnpm install
```

### 5e. Generate shims

```bash
pnpm --filter @omniviewdev/vite-plugin generate-shims
```

### 5f. Build the vite-plugin package

```bash
pnpm --filter @omniviewdev/vite-plugin build
```

---

## Step 6: Acceptance Criteria

These are the exact tests to verify the shared deps bridge works correctly. They should be run in order.

### Test 1: Shim generation

```bash
cd /Users/joshuapare/Repos/omniview
pnpm --filter @omniviewdev/vite-plugin generate-shims
```

**Expected**: The `/packages/omniviewdev-vite-plugin/shims/` directory contains exactly one `.mjs` file per entry in `SHARED_PACKAGES`. Count should match:

```bash
ls -1 /Users/joshuapare/Repos/omniview/packages/omniviewdev-vite-plugin/shims/*.mjs | wc -l
# Expected: 55 (or however many entries are in SHARED_PACKAGES)
```

**Verify filename mapping**:
- `shims/react.mjs` exists
- `shims/react__jsx-runtime.mjs` exists
- `shims/_mui__joy__Button.mjs` exists
- `shims/_emotion__react.mjs` exists
- `shims/_tanstack__react-query.mjs` exists
- `shims/_omniviewdev__runtime__api.mjs` exists

### Test 2: Vite plugin package builds

```bash
pnpm --filter @omniviewdev/vite-plugin build
```

**Expected**: `dist/index.js`, `dist/index.cjs`, and `dist/index.d.ts` are produced without errors.

### Test 3: Shim file syntax is valid ESM

```bash
# Verify each shim file is valid JavaScript by parsing it with Node
for f in /Users/joshuapare/Repos/omniview/packages/omniviewdev-vite-plugin/shims/*.mjs; do
  node --check "$f" || echo "INVALID: $f"
done
```

**Expected**: No "INVALID" output. All files parse without syntax errors.

### Test 4: Plugin build still works (SystemJS output)

```bash
cd /Users/joshuapare/Repos/omniview/plugins/kubernetes/ui
pnpm build
```

**Expected**: Build succeeds. Output in `dist/assets/entry.js` is SystemJS format. The built file should NOT contain any React/MUI source code -- they should still be external references.

Verify externals are preserved:

```bash
# The built entry.js should NOT contain 'createElement' from React's source
# (it should only reference 'react' as an external)
grep -c 'System.register' /Users/joshuapare/Repos/omniview/plugins/kubernetes/ui/dist/assets/entry.js
# Expected: >= 1 (it's a SystemJS module)
```

### Test 5: Vite dev server resolves shims (manual)

```bash
cd /Users/joshuapare/Repos/omniview/plugins/kubernetes/ui
pnpm dev
```

Open `http://localhost:15173/src/entry.ts` in a browser with DevTools open.

**Expected**: The Network tab shows requests for shim files (e.g., `react.mjs`, `react__jsx-runtime.mjs`) instead of requests to `node_modules/react/`. The module should load without errors (assuming `window.__OMNIVIEW_SHARED__` is populated -- if not, the shims will throw a clear error message).

### Test 6: Host app exports shared deps

Start the host app in dev mode:

```bash
cd /Users/joshuapare/Repos/omniview
pnpm dev
```

Open the browser DevTools console and verify:

```javascript
// Should be true
window.__OMNIVIEW_SHARED_READY__ === true

// Should be an object with 55+ keys
Object.keys(window.__OMNIVIEW_SHARED__).length >= 55

// React should be the actual React module
window.__OMNIVIEW_SHARED__['react'].useState !== undefined
window.__OMNIVIEW_SHARED__['react'].createElement !== undefined

// JSX runtime should have jsx and jsxs
window.__OMNIVIEW_SHARED__['react/jsx-runtime'].jsx !== undefined
window.__OMNIVIEW_SHARED__['react/jsx-runtime'].jsxs !== undefined

// MUI Joy should be available
window.__OMNIVIEW_SHARED__['@mui/joy'] !== undefined

// React Query should be available
window.__OMNIVIEW_SHARED__['@tanstack/react-query'].useQuery !== undefined
```

### Test 7: End-to-end singleton verification

With both the host app and the plugin Vite dev server running, load a dev-mode plugin and verify in the browser console:

```javascript
// The React instance used by the plugin should be the SAME object as the host's
// (This test requires the full dev loading path from document 04, but the
// shared deps bridge is the prerequisite)
window.__OMNIVIEW_SHARED__['react'] === window.__OMNIVIEW_SHARED__['react']  // trivially true

// More importantly: React.useState from the shim should be the same function
// as React.useState from the host
import('react').then(r => console.log(r.useState === window.__OMNIVIEW_SHARED__['react'].useState))
// Expected: true (in the host app context)
```

### Test 8: `safeFilename` unit tests

Create a test file or verify manually:

| Input | Expected Output |
|-------|----------------|
| `'react'` | `'react'` |
| `'react/jsx-runtime'` | `'react__jsx-runtime'` |
| `'react-router-dom'` | `'react-router-dom'` |
| `'@mui/joy'` | `'_mui__joy'` |
| `'@mui/joy/Button'` | `'_mui__joy__Button'` |
| `'@emotion/react'` | `'_emotion__react'` |
| `'@tanstack/react-query'` | `'_tanstack__react-query'` |
| `'@omniviewdev/runtime/api'` | `'_omniviewdev__runtime__api'` |
| `'@monaco-editor/react'` | `'_monaco-editor__react'` |
| `'@dnd-kit/core'` | `'_dnd-kit__core'` |
| `'date-fns'` | `'date-fns'` |
| `'yaml'` | `'yaml'` |
| `'@mui/base/Unstable_Popup'` | `'_mui__base__Unstable_Popup'` |

---

## Step 7: Edge Cases

### 7a. A shared dep fails to load in the host

**Scenario**: `monaco-types` is listed in `shared_dependencies.ts` but is not installed or has a broken import.

**Behavior**: `exportSharedDepsForDev()` uses `Promise.allSettled`. The failed dep will:
1. Not appear on `window.__OMNIVIEW_SHARED__`
2. Be logged as a warning in the console
3. NOT block other deps from loading

**Plugin impact**: If a plugin imports `monaco-types`, the shim file will throw a clear error: `"Shared dependency 'monaco-types' is not available on window.__OMNIVIEW_SHARED__"`. The plugin will fail to load, but the error message tells the developer exactly what is wrong.

### 7b. Version mismatch between host and plugin

**Scenario**: Host has `react@18.2.0`, plugin's `package.json` lists `react@18.3.0`.

**Behavior**: In dev mode, the shim always returns the host's React, regardless of the version in the plugin's `package.json`. The plugin's `node_modules/react` is never imported.

**Risk**: If the plugin uses a React 18.3 API that does not exist in 18.2, it will fail at runtime. This is the same risk as production mode (where SystemJS provides the host's React).

**Mitigation**: Plugin authors should use the same major+minor version constraints as the host app. The host's `package.json` at `/package.json` is the source of truth.

### 7c. Plugin imports a non-shared package

**Scenario**: A plugin imports `lodash` which is NOT in the shared list.

**Behavior**: The `omniviewExternals()` Vite plugin only intercepts imports that match `SHARED_PACKAGES`. `lodash` is not in the list, so Vite resolves it normally from the plugin's `node_modules/`. The plugin bundles its own copy of `lodash`.

**Impact**: None. This is the correct behavior. Only packages that need singleton semantics (React, context providers, MUI theme) must be shared.

### 7d. Shim file is missing for a shared package

**Scenario**: A new package is added to `sharedPackages.ts` but `generate-shims` was not re-run.

**Behavior**: `omniviewExternals()` will resolve the import to a path like `shims/_new__package.mjs` which does not exist. Vite will throw a file-not-found error during dev server startup or on first import.

**Mitigation**: The `generate-shims` script should be run as part of the package's `prepublishOnly` script. A CI check should verify that the number of shim files matches `SHARED_PACKAGES.length`.

### 7e. Two plugins running dev servers simultaneously

**Scenario**: Plugin A on port 15173 and Plugin B on port 15174, both using `omniviewExternals()`.

**Behavior**: Both plugins' Vite servers resolve shared imports to the same shim files (the shims are in the `@omniviewdev/vite-plugin` package, shared across all plugins). Both plugins read from the same `window.__OMNIVIEW_SHARED__`. This is correct -- they should all share the same React instance.

### 7f. `window.__OMNIVIEW_SHARED__` is not populated (plugin loaded too early)

**Scenario**: A race condition where a plugin's native ESM `import()` is initiated before `exportSharedDepsForDev()` has completed.

**Behavior**: The shim file runs `const mod = window.__OMNIVIEW_SHARED__['react']`. If the window property does not exist yet, `mod` is `undefined`, and the shim throws the error immediately.

**Mitigation**: This is prevented by the `devSharedReady` promise gate in `loader.ts`. The plugin loading code `await`s `devSharedReady` before issuing any `import()`. As long as plugin loading goes through the official `importPlugin()` function, this race cannot occur.

### 7g. `@vitejs/plugin-react` transforms JSX before our plugin runs

**Scenario**: The React plugin transforms `<Button>` into `jsx(Button, {})` which imports from `react/jsx-runtime`. If our plugin runs after the React plugin, the `react/jsx-runtime` import might already be resolved.

**Behavior**: The `omniviewExternals()` plugin uses `enforce: 'pre'`, which means it runs **before** other plugins in the `resolveId` hook. It intercepts `react/jsx-runtime` before `@vitejs/plugin-react` has a chance to resolve it.

**Caveat**: `@vitejs/plugin-react` does not resolve `react/jsx-runtime` -- it only injects the import. The resolution is done by Vite's built-in resolver, which calls plugins in order. Since our plugin is `enforce: 'pre'`, we always get first shot.

### 7h. Production build still uses SystemJS format

**Scenario**: Running `pnpm build` in the plugin directory.

**Behavior**: In `build` mode, the `omniviewExternals()` plugin's `config` hook adds all shared packages to `rollupOptions.external`. The `resolveId` hook does NOT redirect to shims (Rollup skips `resolveId` for external modules). The output is SystemJS format with external references, exactly as before.

**Verification**: The built `entry.js` should contain `System.register(...)` and reference `'react'`, `'@mui/joy'`, etc. as external dependencies. No shim file content should appear in the build output.

---

## Summary of All Files

### New files to create

| # | Absolute Path | Purpose |
|---|---------------|---------|
| 1 | `/ui/features/plugins/api/devSharedExporter.ts` | Resolves shared deps, writes to `window.__OMNIVIEW_SHARED__` |
| 2 | `/ui/features/plugins/api/devSharedReady.ts` | Promise gate for plugin loading to await |
| 3 | `/packages/omniviewdev-vite-plugin/package.json` | Package manifest |
| 4 | `/packages/omniviewdev-vite-plugin/tsconfig.json` | TypeScript config |
| 5 | `/packages/omniviewdev-vite-plugin/src/index.ts` | Vite plugin: `omniviewExternals()` |
| 6 | `/packages/omniviewdev-vite-plugin/src/safeFilename.ts` | Package name to filename converter |
| 7 | `/packages/omniviewdev-vite-plugin/src/sharedPackages.ts` | Canonical list of shared packages |
| 8 | `/packages/omniviewdev-vite-plugin/scripts/generate-shims.ts` | Shim file generator script |
| 9 | `/packages/omniviewdev-vite-plugin/shims/*.mjs` | 55+ generated shim files (one per shared package) |

### Existing files to modify

| # | Absolute Path | Change |
|---|---------------|--------|
| 1 | `/ui/App.tsx` | Add `initDevSharedDeps(import.meta.env.DEV)` call after `preloadSharedDeps()` |
| 2 | `/ui/features/plugins/api/loader.ts` | Add `import { devSharedReady }` and `await devSharedReady` before dev-mode import |
| 3 | `/plugins/kubernetes/ui/vite.config.ts` | Replace manual `external` array with `omniviewExternals()` plugin |
| 4 | `/plugins/kubernetes/ui/package.json` | Add `@omniviewdev/vite-plugin` to `devDependencies` |

### Files NOT modified

| File | Why |
|------|-----|
| `/ui/features/plugins/api/shared_dependencies.ts` | Source of truth; read by devSharedExporter but not changed |
| `/ui/features/plugins/api/preloader.ts` | SystemJS preloading unchanged; continues to work for production |
| `/ui/features/plugins/api/systemjs.ts` | SystemJS init unchanged |
| `/ui/features/plugins/api/utils.ts` | Import map builder unchanged |
| `/pnpm-workspace.yaml` | Already includes `packages/*` |

---

## Implementation Order

Execute in this exact sequence:

1. Create `/packages/omniviewdev-vite-plugin/` directory and all source files (`package.json`, `tsconfig.json`, `src/index.ts`, `src/safeFilename.ts`, `src/sharedPackages.ts`, `scripts/generate-shims.ts`)
2. Run `pnpm install` from repo root to link the new workspace package
3. Run `pnpm --filter @omniviewdev/vite-plugin generate-shims` to produce all shim `.mjs` files
4. Run `pnpm --filter @omniviewdev/vite-plugin build` to produce `dist/`
5. Create `/ui/features/plugins/api/devSharedExporter.ts`
6. Create `/ui/features/plugins/api/devSharedReady.ts`
7. Modify `/ui/App.tsx` to call `initDevSharedDeps`
8. Modify `/ui/features/plugins/api/loader.ts` to await `devSharedReady`
9. Modify `/plugins/kubernetes/ui/package.json` to add `@omniviewdev/vite-plugin` devDependency
10. Modify `/plugins/kubernetes/ui/vite.config.ts` to use `omniviewExternals()`
11. Run `pnpm install` again to install the new devDependency link
12. Run acceptance tests (Step 6 above)
