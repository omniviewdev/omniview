import { useMemo, useSyncExternalStore } from 'react';
import { connectionReadinessStore, getConnectionReadinessGeneration } from '../../connection/connectionReadiness';

const inactiveGenerationStore = {
  getSnapshot: (): number | undefined => undefined,
  subscribe: () => () => {},
};

/**
 * The connection's current readiness generation, or undefined while inactive.
 *
 * It changes whenever the connection is restarted, reconfigured or lost, which is
 * when the native client behind a route can be replaced. Key connection-scoped
 * reads by it so a result acquired under one generation is never served under
 * another. Call it after useConnectionReadiness: reading the readiness snapshot
 * creates the store entry whose generation this returns.
 */
export function useConnectionGeneration(pluginID: string, connectionID: string, enabled: boolean): number | undefined {
  const store = useMemo(() => enabled && pluginID && connectionID ? {
    subscribe: connectionReadinessStore(pluginID, connectionID).subscribe,
    getSnapshot: () => getConnectionReadinessGeneration(pluginID, connectionID),
  } : inactiveGenerationStore, [enabled, pluginID, connectionID]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
