import React from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { EventsOn } from '@omniviewdev/runtime/runtime';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * Mirrors the Go DevServerState struct (backend/pkg/plugin/devserver/types.go).
 */
export interface DevServerState {
  pluginID: string;
  mode: 'managed' | 'external' | 'idle';
  devPath: string;
  vitePort: number;
  viteURL: string;
  viteStatus: 'idle' | 'starting' | 'building' | 'running' | 'ready' | 'error' | 'stopped';
  goStatus: 'idle' | 'starting' | 'building' | 'running' | 'ready' | 'error' | 'stopped';
  lastBuildDuration: number;
  lastBuildTime: string;
  lastError: string;
  grpcConnected: boolean;
}

export interface DevLogEntry {
  timestamp: string;
  source: 'vite' | 'go-build' | 'go-watch' | 'manager';
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  pluginID: string;
}

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

// ── Wails Binding Accessors ────────────────────────────────────────────────

const DevServerAPI = {
  listStates: (): Promise<DevServerState[]> =>
    (window as any).go.devserver.DevServerManager.ListDevServerStates(),

  getState: (pluginID: string): Promise<DevServerState> =>
    (window as any).go.devserver.DevServerManager.GetDevServerState(pluginID),

  start: (pluginID: string): Promise<DevServerState> =>
    (window as any).go.devserver.DevServerManager.StartDevServer(pluginID),

  stop: (pluginID: string): Promise<void> =>
    (window as any).go.devserver.DevServerManager.StopDevServer(pluginID),

  restart: (pluginID: string): Promise<DevServerState> =>
    (window as any).go.devserver.DevServerManager.RestartDevServer(pluginID),

  getLogs: (pluginID: string, count: number): Promise<DevLogEntry[]> =>
    (window as any).go.devserver.DevServerManager.GetDevServerLogs(pluginID, count),
};

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
    const offStatus = EventsOn(
      'plugin/devserver/status',
      (state: DevServerState) => {
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
    queryFn: DevServerAPI.listStates,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

  const state = useQuery({
    queryKey: KEYS.one(pluginID ?? ''),
    queryFn: () => DevServerAPI.getState(pluginID!),
    enabled: !!pluginID,
    staleTime: 30_000,
  });

  // ── Mutations ──────────────────────────────────────────────────────────

  const start = useMutation({
    mutationFn: DevServerAPI.start,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.all });
      if (pluginID) {
        void queryClient.invalidateQueries({ queryKey: KEYS.one(pluginID) });
      }
    },
  });

  const stop = useMutation({
    mutationFn: DevServerAPI.stop,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.all });
      if (pluginID) {
        void queryClient.invalidateQueries({ queryKey: KEYS.one(pluginID) });
      }
    },
  });

  const restart = useMutation({
    mutationFn: DevServerAPI.restart,
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
    const offLog = EventsOn('plugin/devserver/log', (entries: DevLogEntry[]) => {
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

    const offError = EventsOn(
      'plugin/devserver/error',
      (errorPluginID: string, buildErrors: DevBuildError[]) => {
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
