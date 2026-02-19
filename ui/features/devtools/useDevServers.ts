import { useEffect, useState } from 'react';
import { DevServerManager } from '@omniviewdev/runtime/api';
import { devToolsChannel } from './events';
import type { DevServerState, DevServerSummary } from './types';
import { getAggregateStatus } from './types';

/**
 * Hook that tracks the state of all dev server instances.
 * Hydrates from the backend on mount and stays in sync via real-time events.
 * Returns a map of pluginId -> state, plus a summary.
 */
export function useDevServers() {
  const [servers, setServers] = useState<Map<string, DevServerState>>(new Map());

  // Hydrate from backend on mount.
  useEffect(() => {
    DevServerManager.ListDevServerStates()
      .then((states) => {
        if (!states || states.length === 0) return;
        setServers(new Map(
          (states as unknown as DevServerState[]).map((s) => [s.pluginID, s]),
        ));
      })
      .catch(() => {
        // Silently ignore -- backend may not be ready yet.
      });
  }, []);

  // Subscribe to real-time status events.
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
