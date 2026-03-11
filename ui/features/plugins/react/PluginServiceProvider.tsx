import React, { useRef, useMemo, useEffect, useSyncExternalStore } from 'react';
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
 * - Shows children only after service is ready
 */
export function PluginServiceProvider({ children }: PluginServiceProviderProps) {
  const serviceRef = useRef<PluginService | null>(null);
  const deps = useMemo(() => createProductionDeps(), []);

  if (!serviceRef.current) {
    serviceRef.current = new PluginService(deps);
  }

  const service = serviceRef.current;

  // Subscribe to snapshot for readiness gating
  const snapshot = useSyncExternalStore(
    service.subscribe.bind(service),
    service.getSnapshot.bind(service),
  );

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

    const descriptors: PluginDescriptor[] = installedPlugins.map((p) => ({
      id: p.id,
      dev: p.dev,
      devPort: p.devPort,
      moduleHash: p.moduleHash,
    }));

    void service.loadAll(descriptors)
      .catch((err) => {
        console.error('[PluginServiceProvider] loadAll failed:', err);
      })
      .finally(() => {
        service.markReady();
      });
  }, [isLoading, installedPlugins, service]);

  // Dev mode: expose debug surface
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__PLUGIN_SERVICE__ = {
        getDebugSnapshot: service.getDebugSnapshot.bind(service),
        forceReset: service.forceReset.bind(service),
        retry: service.retry.bind(service),
      };
      return () => {
        delete (window as any).__PLUGIN_SERVICE__;
      };
    }
  }, [service]);

  return (
    <PluginServiceContext.Provider value={service}>
      {snapshot.ready ? children : null}
    </PluginServiceContext.Provider>
  );
}
