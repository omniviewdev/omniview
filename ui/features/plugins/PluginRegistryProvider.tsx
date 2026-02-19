import React, { createContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { importPluginWindow } from './api/loader';
import { registerPlugin } from './PluginManager';
import PrimaryLoading from '@/components/util/PrimaryLoading';
import { useDevServer, type DevServerState } from '@/hooks/plugin/useDevServer';
import { useSnackbar } from '@omniviewdev/runtime';

interface PluginRegistryContextValue {
  ready: boolean;
  failedPlugins: string[];
}

export const PluginRegistryContext = createContext<PluginRegistryContextValue>({
  ready: false,
  failedPlugins: [],
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
  const [failedPlugins, setFailedPlugins] = useState<string[]>([]);
  const { showSnackbar } = useSnackbar();

  // Track the current loadAll run so stale runs don't clobber state.
  const loadGenRef = useRef(0);

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
      console.debug('[PluginRegistry] waiting for plugins query', {
        hasData: !!plugins.data,
        isLoading: plugins.isLoading,
        isError: plugins.isError,
      });
      return;
    }

    // Increment generation — any in-flight loadAll from a previous run
    // will see the mismatch and skip its state updates.
    const gen = ++loadGenRef.current;

    // Close the gate so the router shows loading while we re-import.
    // Critical for HMR: React Fast Refresh preserves component state
    // (ready=true) but module-level plugin Maps are cleared.
    setReady(false);

    const devStates: DevServerState[] = allStates.data ?? [];
    const pluginList = plugins.data;

    console.debug('[PluginRegistry] loadAll starting', {
      gen,
      pluginCount: pluginList.length,
      pluginIds: pluginList.map(p => p.id),
      devStates: devStates.map(s => ({ id: s.pluginID, viteStatus: s.viteStatus, vitePort: s.vitePort })),
    });

    const startTime = performance.now();

    const loadAll = async () => {
      const failures: string[] = [];

      await Promise.all(
        pluginList.map(async (plugin) => {
          try {
            const devState = devStates.find((s) => s.pluginID === plugin.id);
            const isDevReady =
              devState &&
              devState.viteStatus === 'ready' &&
              devState.vitePort > 0;

            console.debug(`[PluginRegistry] loading "${plugin.id}"`, {
              plugin: plugin.id,
              isDevReady: !!isDevReady,
              vitePort: devState?.vitePort,
            });

            const pluginWindow = await importPluginWindow({
              pluginId: plugin.id,
              dev: !!isDevReady,
              devPort: devState?.vitePort,
            });

            // If a newer loadAll started while we were awaiting, bail out.
            // The newer run will register the correct plugin set.
            if (gen !== loadGenRef.current) {
              console.debug(`[PluginRegistry] stale run (gen ${gen}), skipping register for "${plugin.id}"`);
              return;
            }

            registerPlugin(plugin.id, pluginWindow);
            console.debug(`[PluginRegistry] registered "${plugin.id}"`, {
              routeCount: pluginWindow.Routes?.length ?? 0,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[PluginRegistry] plugin "${plugin.id}" failed to load:`, message);
            failures.push(plugin.id);
          }
        })
      );

      // Final stale check — don't open the gate if a newer run superseded us.
      if (gen !== loadGenRef.current) {
        console.debug(`[PluginRegistry] stale run (gen ${gen}) — discarding results`);
        return;
      }

      const elapsed = (performance.now() - startTime).toFixed(1);
      console.debug('[PluginRegistry] loadAll complete', {
        gen,
        elapsed: `${elapsed}ms`,
        loaded: pluginList.length - failures.length,
        failed: failures.length,
        failedIds: failures,
      });

      setFailedPlugins(failures);
      setReady(true);
    };

    loadAll();

    // Cleanup: if the effect re-fires before loadAll finishes, the gen
    // mismatch will cause the stale run to bail out.
  }, [stableKey]);

  // Show snackbar for each failed plugin after we're ready
  useEffect(() => {
    if (!ready) return;
    failedPlugins.forEach((id) => {
      showSnackbar(`Plugin "${id}" failed to load`, 'error');
    });
  }, [ready, failedPlugins]);

  if (!ready) {
    return <PrimaryLoading />;
  }

  return (
    <PluginRegistryContext.Provider value={{ ready, failedPlugins }}>
      {children}
    </PluginRegistryContext.Provider>
  );
};
