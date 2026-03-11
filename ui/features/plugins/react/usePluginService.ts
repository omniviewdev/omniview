import { useContext, useSyncExternalStore, useMemo } from 'react';
import { PluginServiceContext } from './context';
import type { PluginServiceSnapshot } from '../core/types';
import type { PluginService } from '../core/PluginService';

export interface UsePluginServiceResult extends PluginServiceSnapshot {
  readonly load: PluginService['load'];
  readonly unload: PluginService['unload'];
  readonly reload: PluginService['reload'];
  readonly retry: PluginService['retry'];
  readonly forceReset: PluginService['forceReset'];
  readonly getDebugSnapshot: PluginService['getDebugSnapshot'];
  readonly isQuarantined: PluginService['isQuarantined'];
  readonly unquarantine: PluginService['unquarantine'];
  readonly listQuarantined: PluginService['listQuarantined'];
  readonly getDependencyGraph: PluginService['getDependencyGraph'];
  readonly getDependencyWarnings: PluginService['getDependencyWarnings'];
}

/**
 * Subscribe to the PluginService snapshot via useSyncExternalStore.
 * Must be used within a PluginServiceProvider.
 */
export function usePluginService(): UsePluginServiceResult {
  const service = useContext(PluginServiceContext);
  if (!service) {
    throw new Error('usePluginService must be used within PluginServiceProvider');
  }

  const subscribe = useMemo(() => service.subscribe.bind(service), [service]);
  const getSnapshot = useMemo(() => service.getSnapshot.bind(service), [service]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  const actions = useMemo(
    () => ({
      load: service.load.bind(service),
      unload: service.unload.bind(service),
      reload: service.reload.bind(service),
      retry: service.retry.bind(service),
      forceReset: service.forceReset.bind(service),
      getDebugSnapshot: service.getDebugSnapshot.bind(service),
      isQuarantined: service.isQuarantined.bind(service),
      unquarantine: service.unquarantine.bind(service),
      listQuarantined: service.listQuarantined.bind(service),
      getDependencyGraph: service.getDependencyGraph.bind(service),
      getDependencyWarnings: service.getDependencyWarnings.bind(service),
    }),
    [service],
  );

  return useMemo(
    () => ({ ...snapshot, ...actions }),
    [snapshot, actions],
  );
}
