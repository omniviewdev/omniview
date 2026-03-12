import React, { useRef, useMemo, useEffect } from 'react';
import { EventsOn } from '@omniviewdev/runtime/runtime';
import { PluginServiceContext } from './context';
import { PluginService } from '../core/PluginService';
import { createProductionDeps } from '../adapters/createProductionDeps';
import type { PluginDescriptor } from '../core/types';

// Read-only startup hook — independent from the service consumer hook.
// Stubbed here; wired to real backend in B8.
import { useInstalledPlugins } from '@/hooks/plugin/useInstalledPlugins';

export interface PluginServiceProviderProps {
  readonly children: React.ReactNode;
}

/**
 * Owns the single PluginService instance.
 * - Creates service once (via ref)
 * - Starts/stops event listeners on mount/unmount
 * - Orchestrates initial loadAll + markReady
 * - Provides the service via context
 * - Always renders children (RouteProvider handles loading state)
 * - Defers dev plugin loading until dev server reports ready
 */
export function PluginServiceProvider({ children }: PluginServiceProviderProps) {
  const serviceRef = useRef<PluginService | null>(null);
  const deps = useMemo(() => createProductionDeps(), []);

  if (!serviceRef.current) {
    serviceRef.current = new PluginService(deps);
  }

  const service = serviceRef.current;

  // Read-only startup data — acyclic, does not use the service consumer hook
  const { plugins: installedPlugins, isLoading } = useInstalledPlugins();

  // Start/stop event listeners
  useEffect(() => {
    service.startEventListeners();
    return () => {
      service.stopEventListeners();
    };
  }, [service]);

  // Orchestrate initial load
  const loadStarted = useRef(false);
  useEffect(() => {
    if (isLoading || loadStarted.current) return;
    loadStarted.current = true;

    // Exclude dev plugins whose dev server hasn't started yet (no port).
    // They will be loaded later when the dev server status event fires.
    const descriptors: PluginDescriptor[] = installedPlugins
      .filter((p) => !p.dev || (p.dev && p.devPort && p.devPort > 0))
      .map((p) => ({
        id: p.id,
        dev: p.dev,
        devPort: p.devPort,
      }));

    void service.loadAll(descriptors)
      .catch((err) => {
        console.error('[PluginServiceProvider] loadAll failed:', err);
      })
      .finally(() => {
        service.markReady();
      });
  }, [isLoading, installedPlugins, service]);

  // Listen for quarantine activations
  useEffect(() => {
    const cleanup = service.onQuarantineActivated((info) => {
      // TODO: Wire to notification/toast system when available
      console.warn(
        `[PluginService] Contribution quarantined: ${info.contributionId} (plugin: ${info.pluginId}, crashes: ${info.crashCount})`,
      );
    });
    return cleanup;
  }, [service]);

  // Listen for dev server readiness — load dev plugins once their server is up
  useEffect(() => {
    const cleanup = EventsOn('plugin/devserver/status', (state: {
      pluginID: string;
      vitePort: number;
      viteStatus: string;
    }) => {
      if (state.viteStatus !== 'ready' || !state.vitePort || state.vitePort <= 0) return;

      const ps = service.getPluginState(state.pluginID);
      const devOpts = { dev: true, devPort: state.vitePort };

      if (ps?.phase === 'error') {
        void service.retry(state.pluginID, devOpts).catch((err) => {
          console.error(`[PluginServiceProvider] deferred dev retry failed for ${state.pluginID}:`, err);
        });
      } else if (!ps || ps.phase === 'idle') {
        void service.load(state.pluginID, devOpts).catch((err) => {
          console.error(`[PluginServiceProvider] deferred dev load failed for ${state.pluginID}:`, err);
        });
      }
    });

    return cleanup;
  }, [service]);

  // Dev mode: expose debug surface
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__PLUGIN_SERVICE__ = {
        getDebugSnapshot: service.getDebugSnapshot.bind(service),
        forceReset: service.forceReset.bind(service),
        retry: service.retry.bind(service),
        unquarantine: service.unquarantine.bind(service),
        listQuarantined: service.listQuarantined.bind(service),
        getCrashCount: service.getCrashCount.bind(service),
        getDependencyGraph: service.getDependencyGraph.bind(service),
      };
      return () => {
        delete (window as any).__PLUGIN_SERVICE__;
      };
    }
  }, [service]);

  return (
    <PluginServiceContext.Provider value={service}>
      {children}
    </PluginServiceContext.Provider>
  );
}
