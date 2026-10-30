import React, { useRef, useState, useEffect } from 'react';
import { PluginServiceContext } from './context';
import { PluginService } from '../core/PluginService';
import { createProductionDeps } from '../adapters/createProductionDeps';
import type { PluginDescriptor } from '../core/types';

// Startup discovery is independent from the service consumer hook.
import { useInstalledPlugins } from '@/hooks/plugin/useInstalledPlugins';

export type PluginServiceProviderProps = {
  readonly children: React.ReactNode;
};

/**
 * Owns the single PluginService instance.
 * - Creates service once (via lazy state)
 * - Starts/stops event listeners on mount/unmount
 * - Orchestrates initial loadAll + markReady
 * - Provides the service via context
 * - Always renders children (page tab routers handle loading state)
 * - Defers dev plugin loading until dev server reports ready
 */
export function PluginServiceProvider({ children }: PluginServiceProviderProps) {
  const [service] = useState(() => new PluginService(createProductionDeps()));

  // Read-only startup data — acyclic, does not use the service consumer hook
  const { plugins: installedPlugins, isLoading, error } = useInstalledPlugins();
  const loadStarted = useRef(false);
  const initialBatch = useRef<Set<string> | null>(null);

  // The provider owns registrations as well as event listeners. A Fast Refresh
  // remount retains the document's extension registry, but creates a new service.
  useEffect(() => {
    service.startEventListeners();
    return () => {
      loadStarted.current = false;
      initialBatch.current = null;
      service.reset();
    };
  }, [service]);

  // Orchestrate initial load
  useEffect(() => {
    if (isLoading || error !== null || loadStarted.current) {
      return;
    }

    loadStarted.current = true;

    // Ready dev servers join the initial batch; others are loaded as soon as
    // their reconciled status becomes ready, independently of navigation.
    const descriptors: PluginDescriptor[] = installedPlugins
      .filter((p) => !p.dev || (p.dev && p.devPort && p.devPort > 0))
      .map((p) => ({
        id: p.id,
        dev: p.dev,
        devPort: p.devPort,
      }));
    const batchIds = new Set(descriptors.map((plugin) => plugin.id));
    initialBatch.current = batchIds;

    void service.loadAll(descriptors)
      .catch((err) => {
        console.error('[PluginServiceProvider] loadAll failed:', err);
      })
      .finally(() => {
        if (initialBatch.current !== batchIds) {
          return;
        }

        initialBatch.current = null;
        service.markReady();
      });
  }, [isLoading, error, installedPlugins, service]);

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

  // React to the same snapshot/event state used during initial discovery.
  // This also handles readiness that arrives while loadAll is in flight.
  useEffect(() => {
    if (isLoading || error !== null) {
      return;
    }

    for (const plugin of installedPlugins) {
      if (!plugin.dev || !plugin.devPort || initialBatch.current?.has(plugin.id)) {
        continue;
      }

      const state = service.getPluginState(plugin.id);
      const opts = { dev: true, devPort: plugin.devPort };
      // Inventory refreshes must not dismiss a failed import. Recovery belongs
      // to Retry/Reset or a new development-server lifecycle event.
      const loading = !state || state.phase === 'idle'
        ? service.load(plugin.id, opts)
        : undefined;
      void loading?.catch((err: unknown) => {
        console.error(`[PluginServiceProvider] dev load failed for ${plugin.id}:`, err);
      });
    }
  }, [isLoading, error, installedPlugins, service]);

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
