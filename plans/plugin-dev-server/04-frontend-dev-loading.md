# 04 -- Frontend Dev Loading

> **Phase 3** | Depends on: Phase 1 (Shared Deps Bridge), Phase 2 (DevServer Manager)

## Overview

This phase modifies the frontend plugin loading pipeline to support two modes:

1. **Dev mode**: Native ESM `import()` directly from the Vite dev server URL (`http://127.0.0.1:<port>/src/entry.ts`)
2. **Production mode**: SystemJS import from the Wails asset server (existing behavior, unchanged)

The critical change is **removing `WindowReloadApp()`** from the Go-change reload path and replacing it with a React `key`-based component re-mount. UI changes are handled entirely by Vite HMR (zero backend involvement).

## Files to Modify

| File | Changes |
|------|---------|
| `ui/features/plugins/api/loader.ts` | Fix `devPort` type, add dev ESM import branch |
| `ui/features/plugins/components/PluginRenderer.tsx` | Remove `WindowReloadApp`, use `reloadKey` for Go changes |
| `ui/features/plugins/PluginRegistryProvider.tsx` | Pass dev server state to loader |

## Files to Create

| File | Purpose |
|------|---------|
| `ui/hooks/plugin/useDevServer.ts` | React hooks for dev server state, mutations, and real-time event updates |

---

## 1. Modify `ui/features/plugins/api/loader.ts`

### Current State

```typescript
type PluginImportInfo = {
  pluginId: string;
  moduleHash?: string;
  dev?: boolean;
  devPort?: 15173  // BUG: literal type, should be `number`
}
```

The current `importPlugin` function only uses SystemJS. The `dev` and `devPort` fields exist but are unused and `devPort` has a broken type (literal `15173` instead of `number`).

### Required Changes

#### 1a. Fix `PluginImportInfo` type

```typescript
// BEFORE:
type PluginImportInfo = {
  pluginId: string;
  moduleHash?: string;
  dev?: boolean;
  devPort?: 15173
}

// AFTER:
type PluginImportInfo = {
  pluginId: string;
  moduleHash?: string;
  dev?: boolean;
  devPort?: number;
}
```

#### 1b. Add dev-mode ESM import branch to `importPlugin`

Insert the dev-mode branch after the built-in plugin check and before the SystemJS path:

```typescript
export async function importPlugin({ pluginId, moduleHash, dev, devPort }: PluginImportInfo): Promise<System.Module> {

  // 1. Check if the plugin is a built-in plugin (unchanged)
  const builtInPlugin = builtInPlugins[pluginId];
  if (builtInPlugin) {
    return typeof builtInPlugin === 'function' ? await builtInPlugin() : builtInPlugin;
  }

  // 2. DEV MODE: native ESM import from Vite dev server
  //    This is the new branch. When a dev server is running with Vite serving
  //    the plugin's UI, import directly via native ESM. This enables:
  //    - Vite HMR via WebSocket (injected by @vite/client)
  //    - React Fast Refresh for sub-100ms state-preserving updates
  //    - No SystemJS involvement at all for dev-mode plugins
  if (dev && devPort) {
    const devUrl = `http://127.0.0.1:${devPort}/src/entry.ts`;
    try {
      console.log(`[plugin:${pluginId}] Loading from dev server: ${devUrl}`);
      const module = await import(/* @vite-ignore */ devUrl);
      return module;
    } catch (err) {
      console.error(`[plugin:${pluginId}] Dev server import failed, falling back to static`, err);
      // Fall through to SystemJS path below
    }
  }

  // 3. PRODUCTION: SystemJS import (existing code, unchanged)
  const modulePath = `${window.location.protocol}//${window.location.host}/_/plugins/${pluginId}/assets/entry.js`;

  const resolvedModule = SystemJS.resolve(modulePath);
  const integrityMap = SystemJS.getImportMap().integrity;

  if (moduleHash && integrityMap && !integrityMap[resolvedModule]) {
    SystemJS.addImportMap({
      integrity: {
        [resolvedModule]: moduleHash,
      },
    });
  }

  console.log(`[plugin:${pluginId}] Loading from SystemJS: ${modulePath}`);
  return SystemJS.import(modulePath);
}
```

#### 1c. Update `clearPlugin` to handle dev-mode modules

Dev-mode modules loaded via native ESM cannot be cleared from SystemJS (they were never loaded through it). `clearPlugin` should be a no-op for dev-mode plugins when it comes to SystemJS, but it should still call the re-import flow:

```typescript
export async function clearPlugin({ pluginId, dev }: PluginImportInfo) {
  if (dev) {
    // Dev-mode modules are loaded via native ESM, not SystemJS.
    // Vite HMR handles UI updates automatically.
    // For Go backend changes, the caller will re-import via importPluginWindow.
    // We don't need to clear anything from SystemJS.
    return;
  }

  // Production: remove from SystemJS cache
  await SystemJS.delete(getModuleId({ pluginId }));
}
```

#### 1d. Update `loadAndRegisterPlugin` to accept dev params

```typescript
export async function loadAndRegisterPlugin(
  pluginID: string,
  opts?: { dev?: boolean; devPort?: number }
): Promise<void> {
  const pluginWindow = await importPluginWindow({
    pluginId: pluginID,
    dev: opts?.dev,
    devPort: opts?.devPort,
  });
  registerPlugin(pluginID, pluginWindow);
  EventsEmit('core/window/recalc_routes');
}
```

### Complete File After Changes

```typescript
import builtInPlugins from './builtins';
import { PluginWindow } from '@omniviewdev/runtime';
import { EXTENSION_REGISTRY } from '../../extensions/store';
import { registerPlugin } from '../PluginManager';
import { SystemJS } from './systemjs';
import { EventsEmit } from '@omniviewdev/runtime/runtime';

type PluginImportInfo = {
  pluginId: string;
  moduleHash?: string;
  dev?: boolean;
  devPort?: number;
}

/**
 * Get's the calculated module ID for the plugin (SystemJS path)
 */
const getModuleId = ({ pluginId }: PluginImportInfo): string => {
  return `${window.location.protocol}//${window.location.host}/_/plugins/${pluginId}/assets/entry.js`;
};

export async function clearPlugin({ pluginId, dev }: PluginImportInfo) {
  if (dev) {
    // Dev-mode modules loaded via native ESM; nothing to clear from SystemJS.
    // Vite HMR handles UI updates. For Go changes, caller re-imports via importPluginWindow.
    return;
  }
  await SystemJS.delete(getModuleId({ pluginId }));
}

/**
 * Imports a plugin module. In dev mode, uses native ESM import from the Vite
 * dev server. In production, uses SystemJS import from the Wails asset server.
 *
 * Dev mode enables:
 * - Vite HMR via WebSocket (injected by @vite/client into every module)
 * - React Fast Refresh for sub-100ms, state-preserving updates
 * - No SystemJS involvement for the plugin's module graph
 *
 * @see {@link file://fileloader.go} for the production asset serving path
 */
export async function importPlugin({ pluginId, moduleHash, dev, devPort }: PluginImportInfo): Promise<System.Module> {
  // Built-in plugins (unchanged)
  const builtInPlugin = builtInPlugins[pluginId];
  if (builtInPlugin) {
    return typeof builtInPlugin === 'function' ? await builtInPlugin() : builtInPlugin;
  }

  // DEV MODE: native ESM import from Vite dev server
  if (dev && devPort) {
    const devUrl = `http://127.0.0.1:${devPort}/src/entry.ts`;
    try {
      console.log(`[plugin:${pluginId}] Loading from dev server: ${devUrl}`);
      const module = await import(/* @vite-ignore */ devUrl);
      return module;
    } catch (err) {
      console.error(`[plugin:${pluginId}] Dev server import failed, falling back to static`, err);
      // Fall through to SystemJS path
    }
  }

  // PRODUCTION: SystemJS import (existing code)
  const modulePath = `${window.location.protocol}//${window.location.host}/_/plugins/${pluginId}/assets/entry.js`;

  const resolvedModule = SystemJS.resolve(modulePath);
  const integrityMap = SystemJS.getImportMap().integrity;

  if (moduleHash && integrityMap && !integrityMap[resolvedModule]) {
    SystemJS.addImportMap({
      integrity: {
        [resolvedModule]: moduleHash,
      },
    });
  }

  console.log(`[plugin:${pluginId}] Loading from SystemJS: ${modulePath}`);
  return SystemJS.import(modulePath);
}

type PluginWindowImportInfo = PluginImportInfo & {}

/**
 * Imports the plugin window component so that it may be shown within the plugin renderer.
 */
export async function importPluginWindow(opts: PluginWindowImportInfo): Promise<PluginWindow> {
  const exports = await importPlugin(opts);

  const { plugin = new PluginWindow() } = exports as { plugin?: PluginWindow };

  // register any extension points
  for (const extension of plugin.extensions) {
    EXTENSION_REGISTRY.addExtensionPoint(extension);
  }

  return plugin;
}

export async function loadAndRegisterPlugin(
  pluginID: string,
  opts?: { dev?: boolean; devPort?: number }
): Promise<void> {
  const pluginWindow = await importPluginWindow({
    pluginId: pluginID,
    dev: opts?.dev,
    devPort: opts?.devPort,
  });
  registerPlugin(pluginID, pluginWindow);
  EventsEmit('core/window/recalc_routes');
}
```

---

## 2. Modify `ui/features/plugins/components/PluginRenderer.tsx`

### Current State

The PluginRenderer listens for `plugin/dev_reload_complete`, then calls `clearPlugin → loadAndRegisterPlugin → WindowReloadApp()`. This causes a **full page refresh** that destroys all application state.

```typescript
// CURRENT (problematic):
clearPlugin({ pluginId: data?.pluginID })
  .then(() => loadAndRegisterPlugin(data.pluginID))
  .then(WindowReloadApp)  // ← THIS IS THE PROBLEM
```

### Required Changes

1. **Remove `WindowReloadApp` import and usage**
2. **Add `reloadKey` state** that increments on Go backend changes
3. **Pass `key={reloadKey}`** to `PluginContextProvider` so it fully re-mounts with fresh context from the new gRPC backend
4. **UI changes need NO handling here** — Vite HMR patches components in-place automatically

### Why `key` Re-mount Works

When a Go file changes:
1. Backend rebuilds the plugin binary
2. Backend kills old plugin process, starts new one, establishes gRPC
3. Backend emits `plugin/dev_reload_complete`
4. PluginRenderer receives event → increments `reloadKey`
5. React sees `key` changed on `PluginContextProvider` → unmounts old tree, mounts new
6. `PluginContextProvider` re-initializes with the new gRPC backend
7. Plugin component tree renders fresh with new backend data

This is **orders of magnitude better** than `WindowReloadApp()` because:
- Only the plugin's component tree re-mounts (rest of app untouched)
- App-level state (bottom drawer, sidebar, navigation) is preserved
- Other plugins are unaffected
- No flash of loading screen

### Complete File After Changes

```typescript
import React from 'react';

import { PluginContextProvider } from '@omniviewdev/runtime';
import { Outlet, useLoaderData } from 'react-router-dom';
import { clearPlugin, loadAndRegisterPlugin } from '../api/loader';
import { EventsOn } from '@omniviewdev/runtime/runtime';
import { type config } from '@omniviewdev/runtime/models';

export type PluginRendererProps = {}

/**
 * PluginRenderer loads a plugin with a UI entrypoint, injecting the necessary
 * contexts and rendering the component.
 *
 * Two change flows exist in dev mode:
 *
 * 1. UI changes (.tsx/.ts/.css files):
 *    Handled entirely by Vite HMR + React Fast Refresh.
 *    No event, no re-mount, no action needed here.
 *    Components update in-place with state preserved.
 *
 * 2. Go changes (.go files):
 *    Backend rebuilds binary, restarts plugin process, re-establishes gRPC.
 *    Emits `plugin/dev_reload_complete` event.
 *    This component increments `reloadKey`, causing PluginContextProvider
 *    to unmount and re-mount with the new gRPC backend.
 *    Only the plugin tree re-mounts — rest of app is untouched.
 */
const PluginRenderer: React.FC<PluginRendererProps> = () => {
  const data = useLoaderData() as { pluginID: string } | undefined;
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    if (!data?.pluginID) return;

    const closer = EventsOn('plugin/dev_reload_complete', (meta: config.PluginMeta) => {
      if (meta.id === data.pluginID) {
        // Go backend changed: clear old module, re-import, then re-mount
        // via key increment (NOT a full page refresh)
        clearPlugin({ pluginId: data.pluginID })
          .then(() => loadAndRegisterPlugin(data.pluginID))
          .then(() => {
            setReloadKey(k => k + 1);
            console.log(`[plugin:${data.pluginID}] Go reload complete, re-mounting plugin`);
          })
          .catch((error) => {
            console.error(`[plugin:${data.pluginID}] Error during Go reload`, error);
          });
      }
    });

    return () => {
      closer();
    };
  }, [data?.pluginID]);

  if (!data?.pluginID) {
    return <>No Plugin ID found</>;
  }

  return (
    <PluginContextProvider pluginId={data.pluginID} key={reloadKey}>
      <Outlet />
    </PluginContextProvider>
  );
};

export default PluginRenderer;
```

### Key Differences from Current Code

| Aspect | Before | After |
|--------|--------|-------|
| Import | `WindowReloadApp` imported | `WindowReloadApp` removed |
| On Go reload | `clearPlugin → loadAndRegister → WindowReloadApp()` | `clearPlugin → loadAndRegister → setReloadKey(k+1)` |
| Reload scope | Full page refresh (everything destroyed) | Plugin component tree only (app state preserved) |
| UI changes | Also triggers via same reload path (slow) | Handled by Vite HMR automatically (fast, no action) |
| `key` prop | None on `PluginContextProvider` | `key={reloadKey}` forces unmount/mount cycle |

---

## 3. Modify `ui/features/plugins/PluginRegistryProvider.tsx`

### Current State

The provider loads all plugins on mount via `importPluginWindow` but has no awareness of dev server state. All plugins are loaded via SystemJS.

### Required Changes

1. Import and use the `useDevServer` hook to get dev server states
2. Pass `dev` and `devPort` to `importPluginWindow` when a plugin's dev server is running
3. Export shared deps for dev mode before loading dev-mode plugins

### Complete File After Changes

```typescript
import React, { createContext, useLayoutEffect, useState } from 'react';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { importPluginWindow } from './api/loader';
import { registerPlugin } from './PluginManager';
import PrimaryLoading from '@/components/util/PrimaryLoading';
import { useDevServer } from '@/hooks/plugin/useDevServer';
import { exportSharedDepsForDev } from './api/devSharedExporter';

interface PluginRegistryContextValue {
  ready: boolean;
}

export const PluginRegistryContext = createContext<PluginRegistryContextValue>({
  ready: false,
});

export const PluginRegistryProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { plugins } = usePluginManager();
  const { allStates } = useDevServer();
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (!plugins.data || plugins.isLoading || plugins.isError) {
      return;
    }

    const loadAll = async () => {
      // Check if any plugins have running dev servers
      const devStates = allStates.data ?? [];
      const hasDevPlugins = devStates.some(
        (s) => s.viteStatus === 'running' && s.vitePort > 0
      );

      // If any dev-mode plugins exist, ensure shared deps are exported to window
      // This must happen before any dev-mode plugin tries to import shared deps
      if (hasDevPlugins) {
        await exportSharedDepsForDev();
      }

      await Promise.all(
        plugins.data.map(async (plugin) => {
          try {
            // Find dev server state for this plugin
            const devState = devStates.find((s) => s.pluginId === plugin.id);
            const isDevReady =
              devState &&
              devState.viteStatus === 'running' &&
              devState.vitePort > 0;

            const pluginWindow = await importPluginWindow({
              pluginId: plugin.id,
              dev: isDevReady,
              devPort: devState?.vitePort,
            });
            registerPlugin(plugin.id, pluginWindow);
          } catch (err) {
            console.error(`Failed to load plugin ${plugin.id}`, err);
          }
        })
      );

      setReady(true);
    };

    loadAll();
  }, [plugins.data, allStates.data]);

  if (!ready) return <PrimaryLoading />;

  return (
    <PluginRegistryContext.Provider value={{ ready }}>
      {children}
    </PluginRegistryContext.Provider>
  );
};
```

### Important Implementation Notes

#### Dependency on `allStates.data`

Adding `allStates.data` to the `useLayoutEffect` dependency array means plugin loading will re-run when dev server states change. This is intentional for one scenario: when a dev server starts **after** the app has already loaded plugins (e.g., user clicks "Start Dev Server" on a plugin card). In that case:

1. `allStates.data` updates with `viteStatus: "running"`
2. `useLayoutEffect` re-runs
3. The newly dev-ready plugin is re-imported via native ESM
4. `registerPlugin` overwrites the SystemJS-loaded version

To prevent unnecessary re-loading of already-loaded plugins, the `registerPlugin` function in `PluginManager.ts` already handles idempotent registration.

#### `exportSharedDepsForDev()` Timing

This function (from Phase 1) **must** be called before any dev-mode plugin is imported. The shared deps need to be available on `window.__OMNIVIEW_SHARED__` before Vite-served modules try to resolve them through the shim files. This is a synchronous prerequisite, called once, and adds negligible overhead since all shared deps are already loaded by the preloader.

---

## 4. Create `ui/hooks/plugin/useDevServer.ts`

This hook provides React Query-based access to all dev server state and mutations.

### Design Decisions

- **Wails events for real-time updates**: The hook subscribes to `plugin/devserver/status` events and patches React Query cache directly. This gives sub-second UI updates without polling.
- **React Query for initial state**: On mount, the hook fetches all dev server states from the Go backend. Subsequent updates come from events.
- **Mutations for control**: Start, stop, restart, attach, detach are exposed as React Query mutations with proper loading/error states.
- **Upsert pattern**: When a status event arrives, we update both the per-plugin cache key and the list cache key.

### Complete File

```typescript
import React from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { EventsOn } from '@omniviewdev/runtime/runtime';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Mirrors the Go DevServerState struct (backend/pkg/plugin/devserver/types.go).
 * Kept in sync manually; Wails generates bindings but we define the shape
 * here for better TypeScript ergonomics.
 */
export interface DevServerState {
  pluginId: string;
  mode: 'managed' | 'external' | 'idle';
  viteStatus: 'idle' | 'starting' | 'running' | 'error' | 'stopped';
  goStatus: 'idle' | 'building' | 'ready' | 'error' | 'stopped';
  grpcConnected: boolean;
  vitePort: number;
  viteUrl: string;
  viteError?: string;
  goError?: string;
  lastBuildMs?: number;
  buildCount: number;
  errorCount: number;
}

export interface DevBuildLogEntry {
  pluginId: string;
  source: 'go' | 'ui';
  stream: 'stdout' | 'stderr';
  data: string;
  timestamp?: string;
}

export interface DevBuildError {
  pluginId: string;
  source: 'go' | 'ui';
  errors: Array<{
    file?: string;
    line?: number;
    col?: number;
    message: string;
  }>;
}

// ── Query Keys ─────────────────────────────────────────────────────────────

const KEYS = {
  all: ['devservers'] as const,
  one: (id: string) => ['devserver', id] as const,
  logs: (id: string, source?: string) => ['devserver', id, 'logs', source] as const,
};

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Upsert a DevServerState into the list cache, replacing the existing entry
 * for the same pluginId or appending if new.
 */
function upsertState(
  existing: DevServerState[] | undefined,
  incoming: DevServerState
): DevServerState[] {
  if (!existing) return [incoming];
  const idx = existing.findIndex((s) => s.pluginId === incoming.pluginId);
  if (idx >= 0) {
    const next = [...existing];
    next[idx] = incoming;
    return next;
  }
  return [...existing, incoming];
}

// ── Wails Binding Accessors ────────────────────────────────────────────────
//
// These call the auto-generated Wails bindings for DevServerManager.
// The actual binding path depends on how DevServerManager is registered in
// main.go. Wails generates: window.go.devserver.DevServerManager.<Method>
//
// We wrap them here so the hook is the single source of truth for all
// dev server interactions.

const DevServerAPI = {
  listStates: (): Promise<DevServerState[]> =>
    (window as any).go.devserver.DevServerManager.ListDevServerStates(),

  getState: (pluginId: string): Promise<DevServerState> =>
    (window as any).go.devserver.DevServerManager.GetDevServerState(pluginId),

  start: (pluginId: string): Promise<void> =>
    (window as any).go.devserver.DevServerManager.StartDevServer(pluginId),

  stop: (pluginId: string): Promise<void> =>
    (window as any).go.devserver.DevServerManager.StopDevServer(pluginId),

  restart: (pluginId: string): Promise<void> =>
    (window as any).go.devserver.DevServerManager.RestartDevServer(pluginId),

  attach: (pluginId: string): Promise<void> =>
    (window as any).go.devserver.DevServerManager.AttachExternal(pluginId),

  detach: (pluginId: string): Promise<void> =>
    (window as any).go.devserver.DevServerManager.DetachExternal(pluginId),

  getLogs: (pluginId: string, source: string, limit: number): Promise<string[]> =>
    (window as any).go.devserver.DevServerManager.GetDevServerLogs(pluginId, source, limit),
};

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * React hook for interacting with the plugin dev server system.
 *
 * Provides:
 * - `allStates`: React Query result for all dev server states
 * - `state`: React Query result for a specific plugin's dev server state (when pluginID provided)
 * - `start/stop/restart/attach/detach`: Mutations for controlling dev servers
 * - Real-time updates via Wails events (patches React Query cache directly)
 *
 * Usage:
 * ```tsx
 * // List all dev servers
 * const { allStates } = useDevServer();
 *
 * // Single plugin
 * const { state, start, stop, restart } = useDevServer('my-plugin-id');
 *
 * // Start a dev server
 * start.mutate('my-plugin-id');
 * ```
 */
export function useDevServer(pluginID?: string) {
  const queryClient = useQueryClient();

  // ── Real-time event subscription ───────────────────────────────────────
  //
  // Subscribe to Wails events from the Go DevServerManager. When a status
  // event arrives, we patch the React Query cache directly. This gives
  // instant UI updates without needing to re-fetch from the backend.

  React.useEffect(() => {
    const offStatus = EventsOn(
      'plugin/devserver/status',
      (state: DevServerState) => {
        // Update single-plugin cache
        queryClient.setQueryData(KEYS.one(state.pluginId), state);

        // Update list cache
        queryClient.setQueryData<DevServerState[]>(KEYS.all, (old) =>
          upsertState(old, state)
        );
      }
    );

    return () => {
      offStatus();
    };
  }, [queryClient]);

  // ── Queries ────────────────────────────────────────────────────────────

  const allStates = useQuery({
    queryKey: KEYS.all,
    queryFn: DevServerAPI.listStates,
    // Refetch on window focus in case events were missed
    refetchOnWindowFocus: true,
    // Don't refetch too aggressively since events handle real-time updates
    staleTime: 30_000,
  });

  const state = useQuery({
    queryKey: KEYS.one(pluginID ?? ''),
    queryFn: () => DevServerAPI.getState(pluginID!),
    enabled: !!pluginID,
    staleTime: 30_000,
  });

  // ── Mutations ──────────────────────────────────────────────────────────

  const start = useMutation({
    mutationFn: DevServerAPI.start,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.all });
      if (pluginID) {
        void queryClient.invalidateQueries({ queryKey: KEYS.one(pluginID) });
      }
    },
  });

  const stop = useMutation({
    mutationFn: DevServerAPI.stop,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.all });
      if (pluginID) {
        void queryClient.invalidateQueries({ queryKey: KEYS.one(pluginID) });
      }
    },
  });

  const restart = useMutation({
    mutationFn: DevServerAPI.restart,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.all });
      if (pluginID) {
        void queryClient.invalidateQueries({ queryKey: KEYS.one(pluginID) });
      }
    },
  });

  const attach = useMutation({
    mutationFn: DevServerAPI.attach,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.all });
    },
  });

  const detach = useMutation({
    mutationFn: DevServerAPI.detach,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.all });
    },
  });

  return {
    // Queries
    allStates,
    state,

    // Mutations
    start,
    stop,
    restart,
    attach,
    detach,
  };
}

// ── Build Log Stream Hook ──────────────────────────────────────────────────

/**
 * Hook for streaming build logs from a specific plugin's dev server.
 * Maintains a ring buffer of log lines and subscribes to Wails events.
 *
 * Usage:
 * ```tsx
 * const { lines, errors, clear } = useDevBuildStream('my-plugin-id');
 * ```
 */
export function useDevBuildStream(
  pluginID: string,
  opts?: { maxLines?: number; sourceFilter?: 'go' | 'ui' | 'all' }
) {
  const maxLines = opts?.maxLines ?? 1000;
  const sourceFilter = opts?.sourceFilter ?? 'all';

  const [lines, setLines] = React.useState<DevBuildLogEntry[]>([]);
  const [errors, setErrors] = React.useState<DevBuildError[]>([]);

  React.useEffect(() => {
    const offLog = EventsOn('plugin/devserver/log', (entry: DevBuildLogEntry) => {
      if (entry.pluginId !== pluginID) return;
      if (sourceFilter !== 'all' && entry.source !== sourceFilter) return;

      setLines((prev) => {
        const next = [...prev, entry];
        // Ring buffer: keep only the last maxLines entries
        return next.length > maxLines ? next.slice(-maxLines) : next;
      });
    });

    const offError = EventsOn('plugin/devserver/error', (error: DevBuildError) => {
      if (error.pluginId !== pluginID) return;

      setErrors((prev) => [...prev, error]);
    });

    return () => {
      offLog();
      offError();
    };
  }, [pluginID, sourceFilter, maxLines]);

  const clear = React.useCallback(() => {
    setLines([]);
    setErrors([]);
  }, []);

  return { lines, errors, clear };
}
```

### API Binding Path

The Wails auto-generated bindings for `DevServerManager` will be at:
```
window.go.devserver.DevServerManager.<MethodName>
```

This assumes the package name is `devserver` (from `backend/pkg/plugin/devserver/manager.go`). Wails generates bindings based on package name + struct name. After running `wails generate`, the TypeScript declarations will appear in:
```
packages/omniviewdev-runtime/src/wailsjs/go/devserver/DevServerManager.d.ts
packages/omniviewdev-runtime/src/wailsjs/go/devserver/DevServerManager.js
```

---

## 5. Integration with `exportSharedDepsForDev`

The `PluginRegistryProvider` calls `exportSharedDepsForDev()` from Phase 1 when any dev-mode plugins exist. The function must be available at:

```
ui/features/plugins/api/devSharedExporter.ts
```

See `02-shared-deps-bridge.md` for the full implementation. The key contract is:

```typescript
// Resolves all 55+ shared deps from shared_dependencies.ts and sets them on
// window.__OMNIVIEW_SHARED__. Returns a promise that resolves when all deps
// are available. Must be called before any dev-mode plugin is imported.
export async function exportSharedDepsForDev(): Promise<void>;
```

---

## 6. Event Flow Summary

### UI File Change (HMR Path) — No Backend Involvement

```
1. Developer saves .tsx file
2. Vite dev server detects change via chokidar
3. Vite transforms module, sends HMR update over WebSocket
4. @vite/client receives update
5. React Fast Refresh patches component in-place
6. State preserved, <100ms
7. PluginRenderer: no action needed
8. PluginRegistryProvider: no action needed
9. loader.ts: no action needed
```

### Go File Change (Rebuild + Re-mount Path)

```
1. Developer saves .go file
2. DevServerInstance's fsnotify watcher fires
3. Debounced 500ms, then `go build`
4. On success: pluginManager.ReloadPlugin(id) → kill old, start new, gRPC handshake
5. Backend emits: plugin/dev_reload_complete
6. PluginRenderer receives event:
   a. clearPlugin({ pluginId }) → no-op if dev mode (no SystemJS cache)
   b. loadAndRegisterPlugin(pluginId) → re-imports via native ESM
   c. setReloadKey(k => k + 1) → React unmounts old PluginContextProvider
   d. New PluginContextProvider mounts with fresh context from new gRPC backend
7. Only plugin tree re-renders, rest of app untouched
8. Total time: 2-5s (dominated by `go build`)
```

### Dev Server Lifecycle Changes

```
1. User starts dev server (or app auto-starts on launch)
2. Backend emits: plugin/devserver/status { viteStatus: "running", vitePort: 15175 }
3. useDevServer hook patches React Query cache
4. PluginRegistryProvider sees viteStatus === "running" for this plugin
5. Re-runs loadAll() → exportSharedDepsForDev() → importPluginWindow({ dev: true, devPort: 15175 })
6. Plugin now loaded via native ESM from Vite dev server
7. HMR active from this point forward
```

---

## 7. Edge Cases

| Scenario | Handling |
|----------|---------|
| **Dev server starts after initial load** | `allStates.data` changes → `useLayoutEffect` re-runs → plugin re-imported via ESM |
| **Dev server stops while plugin is active** | Next Go reload or manual refresh falls back to SystemJS. `viteStatus !== 'running'` → `dev: false` |
| **Vite dev server unreachable** | `import()` throws → caught in try/catch → falls through to SystemJS path |
| **Shared deps not yet exported** | `exportSharedDepsForDev()` is awaited before any plugin import. If it fails, plugins fall back to SystemJS |
| **Multiple plugins loading simultaneously** | `Promise.all` handles this. Each plugin's dev state is independent |
| **`reloadKey` increment during render** | React batches state updates. The key change causes unmount → mount, which is a clean lifecycle |
| **`clearPlugin` called for dev-mode plugin** | Returns immediately (no SystemJS cache to clear). The caller then re-imports via native ESM |
| **Built-in plugin with dev server** | Built-in plugins are checked first in `importPlugin` and always use the inline import. Dev server is irrelevant for built-ins |
| **Plugin loaded via ESM fails to export `plugin`** | `importPluginWindow` creates a fallback `new PluginWindow()` (existing behavior, unchanged) |

---

## 8. Acceptance Criteria

1. **Type fix**: `devPort` in `PluginImportInfo` is `number`, not literal `15173`
2. **Dev ESM import**: When `dev: true` and `devPort` set, `importPlugin` uses `import()` from `http://127.0.0.1:<port>/src/entry.ts`
3. **Fallback**: If dev import fails, falls through to SystemJS (no user-visible error)
4. **No `WindowReloadApp`**: Removed from `PluginRenderer.tsx` and no longer imported
5. **Key-based re-mount**: Go changes cause `reloadKey` increment → `PluginContextProvider` re-mounts
6. **Dev state awareness**: `PluginRegistryProvider` uses `useDevServer().allStates` to determine which plugins get dev loading
7. **Shared deps gate**: `exportSharedDepsForDev()` is called before any dev-mode plugin is imported
8. **Real-time updates**: `useDevServer` subscribes to `plugin/devserver/status` events and patches cache
9. **Build log streaming**: `useDevBuildStream` provides ring-buffered log entries per plugin
10. **Backward compatibility**: Production plugins (no dev server) continue loading via SystemJS exactly as before
11. **Existing events preserved**: `plugin/dev_reload_start/complete/error` events continue to work alongside new `plugin/devserver/*` events
