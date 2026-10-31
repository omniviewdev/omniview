import { useMemo, useSyncExternalStore } from 'react';
import { skipToken, useQueries } from '@tanstack/react-query';
import { NativeQuery } from '../../resource/v2/client';
import type { HostNativeQueryRequest } from '../../resource/v2/host';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import { connectionReadinessStore } from '../../connection/connectionReadiness';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';

/** Bounded provider-native acquisitions, not a host-wide query result. */
export const useResourceSearch = ({
  pluginID: explicitPluginID, searches, enabled = true,
}: { pluginID?: string; searches: readonly HostNativeQueryRequest[]; enabled?: boolean }) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const connectionsHash = JSON.stringify(enabled ? [...new Set(searches.map((request) => request.request.target.route.connection))].sort() : []);
  const readiness = useMemo(() => {
    const connections = JSON.parse(connectionsHash) as string[];
    const stores = new Map(connections.map((connectionID) => [connectionID, connectionReadinessStore(pluginID, connectionID)]));
    return {
      stores,
      // Primitive snapshots remain stable until a route's readiness changes.
      getSnapshot: () => JSON.stringify([...stores.values()].map((store) => store.getSnapshot().phase)),
      subscribe: (listener: () => void) => {
        const release = [...stores.values()].map((store) => store.subscribe(listener));
        return () => { for (const cancel of release) cancel(); };
      },
    };
  }, [pluginID, connectionsHash]);
  useSyncExternalStore(readiness.subscribe, readiness.getSnapshot, readiness.getSnapshot);
  const guardQuery = useConnectionQueryGuard(pluginID, '');
  return useQueries({
    queries: searches.map((request) => {
      const connectionID = request.request.target.route.connection;
      const queryEnabled = enabled && readiness.stores.get(connectionID)?.getSnapshot().phase === 'connected';
      return {
      queryKey: resourceQueryKeys.nativeQuery(pluginID, request),
      queryFn: queryEnabled ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => NativeQuery(pluginID, request), connectionID) : skipToken,
      retry: false,
      enabled: queryEnabled,
    }; }),
  });
};

export default useResourceSearch;
