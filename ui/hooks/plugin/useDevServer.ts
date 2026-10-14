import React from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { Events } from '@omniviewdev/runtime/runtime';
import { DevServerManager } from '@omniviewdev/runtime/api';
import type { DevServerState as DevServerStateModel } from '@omniviewdev/runtime/models';

// ── Types ──────────────────────────────────────────────────────────────────

type DevServerState = DevServerStateModel;

// ── Query Keys ─────────────────────────────────────────────────────────────

const KEYS = {
  all: ['devservers'] as const,
  one: (id: string) => ['devserver', id] as const,
};

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Upsert a DevServerState into the list cache, replacing the existing entry
 * for the same pluginID or appending if new.
 */
function upsertState(
  existing: DevServerState[] | undefined,
  incoming: DevServerState
): DevServerState[] {
  if (!existing) return [incoming];
  const idx = existing.findIndex((s) => s.pluginID === incoming.pluginID);
  if (idx >= 0) {
    const next = [...existing];
    next[idx] = incoming;
    return next;
  }
  return [...existing, incoming];
}

// ── Hook ───────────────────────────────────────────────────────────────────

/**
 * React hook for interacting with the plugin dev server system.
 *
 * Provides:
 * - `allStates`: React Query result for all dev server states
 * - `state`: React Query result for a specific plugin's dev server state
 * - `start/stop/restart`: Mutations for controlling dev servers
 * - Real-time updates via Wails events (patches React Query cache directly)
 */
export function useDevServer(pluginID?: string) {
  const queryClient = useQueryClient();

  // ── Real-time event subscription ───────────────────────────────────────

  React.useEffect(() => {
    const offStatus = Events.On(
      'plugin/devserver/status',
      (ev) => {
        const state = ev.data as DevServerState;
        // Update single-plugin cache
        queryClient.setQueryData(KEYS.one(state.pluginID), state);

        // Update list cache
        queryClient.setQueryData<DevServerState[]>(KEYS.all, (old) =>
          upsertState(old, state)
        );
      }
    );

    return () => {
      offStatus();
    };
  }, [queryClient]);

  // ── Queries ────────────────────────────────────────────────────────────

  const allStates = useQuery({
    queryKey: KEYS.all,
    queryFn: () => DevServerManager.ListDevServerStates(),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const state = useQuery({
    queryKey: KEYS.one(pluginID ?? ''),
    queryFn: () => DevServerManager.GetDevServerState(pluginID!),
    enabled: !!pluginID,
    staleTime: 30_000,
  });

  // ── Mutations ──────────────────────────────────────────────────────────

  const start = useMutation({
    mutationFn: (id: string) => DevServerManager.StartDevServer(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.all });
      if (pluginID) {
        void queryClient.invalidateQueries({ queryKey: KEYS.one(pluginID) });
      }
    },
  });

  const stop = useMutation({
    mutationFn: (id: string) => DevServerManager.StopDevServer(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.all });
      if (pluginID) {
        void queryClient.invalidateQueries({ queryKey: KEYS.one(pluginID) });
      }
    },
  });

  const restart = useMutation({
    mutationFn: (id: string) => DevServerManager.RestartDevServer(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.all });
      if (pluginID) {
        void queryClient.invalidateQueries({ queryKey: KEYS.one(pluginID) });
      }
    },
  });

  return {
    allStates,
    state,
    start,
    stop,
    restart,
  };
}
