import React, { createContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { loadAndRegisterPlugin } from './api/loader';
import { registerFailedPlugin } from './PluginManager';
import PrimaryLoading from '@/components/util/PrimaryLoading';
import { useDevServer, type DevServerState } from '@/hooks/plugin/useDevServer';
import { useSnackbar } from '@omniviewdev/runtime';
import type { PluginLoadError } from './PluginRegistryContext';

interface PluginRegistryContextValue {
  ready: boolean;
  failedPlugins: PluginLoadError[];
  retryPlugin: (pluginId: string) => void;
}

export const PluginRegistryContext = createContext<PluginRegistryContextValue>({
  ready: false,
  failedPlugins: [],
  retryPlugin: () => {},
});

/**
 * Derive a stable string key from plugin IDs + dev server states so the
 * loading effect only re-fires when something meaningful changes — not on
 * every React Query reference change.
 */
function buildStableKey(
  pluginIds: string[],
  devStates: DevServerState[],
): string {
  const plugins = [...pluginIds].sort().join(',');
  const devs = devStates
    .map(s => `${s.pluginID}:${s.viteStatus}:${s.vitePort}`)
    .sort()
    .join(',');
  return `${plugins}|${devs}`;
}

export const PluginRegistryProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { plugins } = usePluginManager();
  const { allStates } = useDevServer();
  const [ready, setReady] = useState(false);
  const [failedPlugins, setFailedPlugins] = useState<PluginLoadError[]>([]);
  const { showSnackbar } = useSnackbar();
  const queryClient = useQueryClient();

  // Track the current loadAll run so stale runs don't clobber state.
  const loadGenRef = useRef(0);

  // Track which plugins have been successfully loaded so we never re-import them.
  const loadedRef = useRef(new Set<string>());

  // Derive a stable key so the effect doesn't re-fire on React Query
  // reference changes when the actual plugin/dev-state data is the same.
  const stableKey = useMemo(() => {
    if (!plugins.data) return '';
    return buildStableKey(
      plugins.data.map(p => p.id),
      allStates.data ?? [],
    );
  }, [plugins.data, allStates.data]);

  useEffect(() => {
    if (!plugins.data || plugins.isLoading || plugins.isError) {
      return;
    }

    const gen = ++loadGenRef.current;
    const devStates: DevServerState[] = allStates.data ?? [];
    const pluginList = plugins.data;

    // Determine which plugins need loading (skip already-loaded ones).
    const toLoad: Array<{ id: string; dev: boolean; devPort?: number }> = [];
    const deferred: string[] = [];

    for (const plugin of pluginList) {
      if (loadedRef.current.has(plugin.id)) continue;

      const devState = devStates.find((s) => s.pluginID === plugin.id);
      const isDevReady =
        devState &&
        devState.viteStatus === 'ready' &&
        devState.vitePort > 0;

      if (devState && !isDevReady) {
        deferred.push(plugin.id);
        continue;
      }

      toLoad.push({ id: plugin.id, dev: !!isDevReady, devPort: devState?.vitePort });
    }

    // If dev servers exist but the plugin list is empty, the backend likely
    // hasn't finished initializing. Re-fetch and wait for the next cycle.
    if (pluginList.length === 0 && devStates.length > 0) {
      console.debug('[PluginRegistry] dev servers present but plugin list empty — refetching');
      void queryClient.invalidateQueries({ queryKey: ['plugins'] });
      return;
    }

    // Already ready and nothing new to load — skip.
    if (ready && toLoad.length === 0) return;

    console.debug('[PluginRegistry] loadAll starting', {
      gen,
      incremental: ready,
      toLoad: toLoad.map(p => p.id),
      deferred,
      alreadyLoaded: [...loadedRef.current],
    });

    const startTime = performance.now();

    const loadAll = async () => {
      const failures: PluginLoadError[] = [];

      await Promise.all(
        toLoad.map(async ({ id, dev, devPort }) => {
          if (gen !== loadGenRef.current) return;
          try {
            console.debug(`[PluginRegistry] loading "${id}"`, { dev, devPort });
            await loadAndRegisterPlugin(id, { dev, devPort });
            loadedRef.current.add(id);
            console.debug(`[PluginRegistry] registered "${id}"`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[PluginRegistry] plugin "${id}" failed to load:`, message);
            failures.push({ pluginId: id, error: message, timestamp: Date.now() });
          }
        })
      );

      if (gen !== loadGenRef.current) {
        console.debug(`[PluginRegistry] stale run (gen ${gen}) — discarding results`);
        return;
      }

      // Register stub error routes for failed plugins so navigating there
      // shows an error page instead of blank/404.
      for (const failure of failures) {
        registerFailedPlugin(failure.pluginId, failure.error);
      }

      const elapsed = (performance.now() - startTime).toFixed(1);
      console.debug('[PluginRegistry] loadAll complete', {
        gen,
        elapsed: `${elapsed}ms`,
        loaded: toLoad.length - failures.length,
        failed: failures.length,
        deferred: deferred.length,
        failedIds: failures.map(f => f.pluginId),
        deferredIds: deferred,
      });

      // Merge failures: keep old failures for plugins we didn't retry, add new ones.
      setFailedPlugins(prev => {
        const retried = new Set(toLoad.map(p => p.id));
        return [...prev.filter(f => !retried.has(f.pluginId)), ...failures];
      });

      // Only transition to ready on the FIRST load — never set ready back to false.
      // Dev plugins waiting for their Vite dev server should NOT block the
      // initial ready transition — they'll load incrementally once ready.
      if (!ready) {
        setReady(true);
        if (deferred.length > 0 && toLoad.length === 0) {
          console.debug('[PluginRegistry] all plugins deferred — will load incrementally');
        }
      } else if (toLoad.length - failures.length > 0) {
        // Incremental load added new plugins — invalidate the plugin list query
        // so the sidebar and other consumers refetch and show the new icons.
        void queryClient.invalidateQueries({ queryKey: ['plugins'] });
      }
    };

    loadAll();
  }, [stableKey]);

  // Show snackbar for each failed plugin after we're ready
  useEffect(() => {
    if (!ready) return;
    failedPlugins.forEach((err) => {
      showSnackbar({
        message: `Plugin "${err.pluginId}" failed to load`,
        status: 'error',
        details: err.error,
        autoHideDuration: 0,
      });
    });
  }, [ready, failedPlugins]);

  const retryPlugin = React.useCallback(async (pluginId: string) => {
    if (!plugins.data) return;

    const devStates: DevServerState[] = allStates.data ?? [];
    const plugin = plugins.data.find(p => p.id === pluginId);
    if (!plugin) return;

    const devState = devStates.find((s) => s.pluginID === plugin.id);
    const isDevReady = devState && devState.viteStatus === 'ready' && devState.vitePort > 0;

    try {
      await loadAndRegisterPlugin(plugin.id, {
        dev: !!isDevReady,
        devPort: devState?.vitePort,
      });

      loadedRef.current.add(pluginId);
      setFailedPlugins(prev => prev.filter(f => f.pluginId !== pluginId));

      showSnackbar({
        message: `Plugin "${pluginId}" loaded successfully`,
        status: 'success',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showSnackbar({
        message: `Plugin "${pluginId}" failed to load`,
        status: 'error',
        details: message,
        autoHideDuration: 0,
      });
    }
  }, [plugins.data, allStates.data, showSnackbar]);

  if (!ready) {
    return <PrimaryLoading message="Loading plugins..." />;
  }

  return (
    <PluginRegistryContext.Provider value={{ ready, failedPlugins, retryPlugin }}>
      {children}
    </PluginRegistryContext.Provider>
  );
};
