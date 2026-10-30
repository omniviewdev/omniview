import { useMemo, useSyncExternalStore } from 'react';
import { useResolvedPluginId } from '../useResolvedPluginId';
import {
  connectionReadinessStore,
  type ConnectionReadiness,
} from '../../connection/connectionReadiness';

export type { ConnectionReadiness, ConnectionReadinessPhase } from '../../connection/connectionReadiness';

export interface UseConnectionReadinessOptions {
  pluginID?: string;
  connectionID: string;
  enabled?: boolean;
}

const inactiveSnapshot = { phase: 'checking' as const };
const inactiveStore = {
  getSnapshot: () => inactiveSnapshot,
  subscribe: () => () => {},
  connect: async () => {},
  retry: async () => {},
};

/** Readiness is independent of resource-watch synchronization and never auto-connects. */
export function useConnectionReadiness({
  pluginID: explicitPluginID,
  connectionID,
  enabled = true,
}: UseConnectionReadinessOptions): ConnectionReadiness {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const store = useMemo(() => enabled
    ? connectionReadinessStore(pluginID, connectionID)
    : inactiveStore, [pluginID, connectionID, enabled]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return useMemo(() => ({ ...snapshot, connect: store.connect, retry: store.retry }), [snapshot, store]);
}
