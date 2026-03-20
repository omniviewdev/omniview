import React from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { Events } from '@omniviewdev/runtime/runtime';
import { DevServerManager } from '@omniviewdev/runtime/api';
import type { DevServerState as DevServerStateModel, DevServerLogEntry } from '@omniviewdev/runtime/models';

// ── Types ──────────────────────────────────────────────────────────────────

// Re-export from the Wails binding models so consumers don't need to import
// from two places.
export type DevServerState = DevServerStateModel;
export type DevLogEntry = DevServerLogEntry;

export interface DevBuildError {
  file: string;
  line: number;
  column: number;
  message: string;
}

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

// ── Build Log Stream Hook ──────────────────────────────────────────────────

/**
 * Hook for streaming build logs from a specific plugin's dev server.
 * Maintains a ring buffer of log entries and subscribes to Wails events.
 */
export function useDevBuildStream(
  pluginID: string,
  opts?: { maxLines?: number; sourceFilter?: string }
) {
  const maxLines = opts?.maxLines ?? 1000;
  const sourceFilter = opts?.sourceFilter ?? 'all';

  const [lines, setLines] = React.useState<DevLogEntry[]>([]);
  const [errors, setErrors] = React.useState<DevBuildError[]>([]);

  React.useEffect(() => {
    const offLog = Events.On('plugin/devserver/log', (ev) => {
      const entries = ev.data as DevLogEntry[];
      const filtered = entries.filter((entry) => {
        if (entry.pluginID !== pluginID) return false;
        if (sourceFilter !== 'all' && entry.source !== sourceFilter) return false;
        return true;
      });

      if (filtered.length === 0) return;

      setLines((prev) => {
        const next = [...prev, ...filtered];
        return next.length > maxLines ? next.slice(-maxLines) : next;
      });
    });

    const offError = Events.On(
      'plugin/devserver/error',
      (ev) => {
        const [errorPluginID, buildErrors] = ev.data as [string, DevBuildError[]];
        if (errorPluginID !== pluginID) return;
        setErrors((prev) => [...prev, ...buildErrors]);
      }
    );

    return () => {
      offLog();
      offError();
    };
  }, [pluginID, sourceFilter, maxLines]);

  const clear = React.useCallback(() => {
    setLines([]);
    setErrors([]);
  }, []);

  return { lines, errors, clear };
}
