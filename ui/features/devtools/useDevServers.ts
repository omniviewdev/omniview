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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    const updated = new Set<string>();

    // Subscribe first; a slow snapshot must never replace a newer status event.
    const unsub = devToolsChannel.on('onStatusChange', (state) => {
      updated.add(state.pluginID);
      setServers((prev) => {
        const next = new Map(prev);
        if (!state.grpcConnected && state.viteStatus === undefined) {
          next.delete(state.pluginID);
        } else {
          next.set(state.pluginID, state);
        }

        return next;
      });
    });

    void DevServerManager.ListDevServerStates()
      .then((states) => {
        if (!active) {
          return;
        }

        setServers((prev) => {
          const next = new Map(prev);
          for (const state of states ?? []) {
            if (!updated.has(state.pluginID)) {
              next.set(state.pluginID, state);
            }
          }

          return next;
        });
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause : new Error(String(cause)));
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
      unsub();
    };
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
      case 'connecting':
        break;
    }
  });

  return { servers, summary, isLoading, error };
}
