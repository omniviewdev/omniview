import { useEffect, useState } from 'react';
import { devToolsChannel } from './events';
import type { DevServerState, DevServerSummary } from './types';
import { getAggregateStatus } from './types';

/**
 * Hook that tracks the state of all dev server instances.
 * Returns a map of pluginId -> state, plus a summary.
 */
export function useDevServers() {
  const [servers, setServers] = useState<Map<string, DevServerState>>(new Map());

  useEffect(() => {
    const unsub = devToolsChannel.on('onStatusChange', (state) => {
      setServers((prev) => {
        const next = new Map(prev);
        if (!state.grpcConnected && state.viteStatus === undefined) {
          // Plugin fully disconnected -- remove from map.
          next.delete(state.pluginID);
        } else {
          next.set(state.pluginID, state);
        }
        return next;
      });
    });

    return unsub;
  }, []);

  const summary: DevServerSummary = {
    total: servers.size,
    ready: 0,
    building: 0,
    error: 0,
    stopped: 0,
  };

  servers.forEach((state) => {
    const agg = getAggregateStatus(state);
    switch (agg) {
      case 'ready':
        summary.ready++;
        break;
      case 'building':
        summary.building++;
        break;
      case 'error':
        summary.error++;
        break;
      case 'stopped':
        summary.stopped++;
        break;
    }
  });

  return { servers, summary };
}
