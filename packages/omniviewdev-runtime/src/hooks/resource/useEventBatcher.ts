import { useCallback, useEffect, useRef } from 'react';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import get from 'lodash.get';
import type { WatchState } from '../../types/watch';

// Re-use the payload shapes already defined in useResources.
export type AddPayload = {
  data: any;
  key: string;
  connection: string;
  id: string;
  namespace: string;
};

export type UpdatePayload = {
  data: any;
  key: string;
  connection: string;
  id: string;
  namespace: string;
};

export type DeletePayload = {
  data: any;
  key: string;
  connection: string;
  id: string;
  namespace: string;
};

export type ResourceEvent =
  | { type: 'ADD'; payload: AddPayload }
  | { type: 'UPDATE'; payload: UpdatePayload }
  | { type: 'DELETE'; payload: DeletePayload };

/**
 * Apply a batch of resource events to a list query cache entry.
 * Extracted for testability — this is the core batching logic.
 *
 * Returns a new plain object (immutable-style) without relying on Immer,
 * avoiding issues with Wails binding class instances that Immer cannot draft.
 */
export function applyBatch(
  oldData: any,
  events: ResourceEvent[],
  idAccessor: string,
): any {
  const base = oldData ?? { result: [], success: true, totalCount: 0 };
  // Shallow-copy the result array so we never mutate the cached version.
  const result = [...(base.result ?? [])];

  for (const event of events) {
    const eventId = get(event.payload.data, idAccessor);

    switch (event.type) {
      case 'ADD': {
        const idx = result.findIndex((item: any) => get(item, idAccessor) === eventId);
        if (idx === -1) {
          result.push(event.payload.data);
        }
        break;
      }
      case 'UPDATE': {
        const idx = result.findIndex((item: any) => get(item, idAccessor) === eventId);
        if (idx !== -1) {
          result[idx] = event.payload.data;
        }
        break;
      }
      case 'DELETE': {
        const idx = result.findIndex((item: any) => get(item, idAccessor) === eventId);
        if (idx !== -1) {
          result.splice(idx, 1);
        }
        break;
      }
    }
  }

  return { ...base, result };
}

/**
 * Adaptive two-mode event batcher for resource watch events.
 *
 * **Mode 1 — Initial Sync (SYNCING state):** Uses `setTimeout` with a larger
 * window (default 500ms) to batch the initial ADD flood into 1-2 flushes.
 * Satisfies REQ-BATCH-2.
 *
 * **Mode 2 — Live Updates (all other states):** Uses `requestAnimationFrame`
 * to align cache updates with the browser repaint cycle (~16ms), providing
 * the lowest-latency batching for live updates. Satisfies REQ-BATCH-1.
 *
 * Mode transitions happen automatically when `watchState` changes.
 * Pending timers flush normally; subsequent events use the new scheduling.
 */
export function useEventBatcher(
  queryClient: QueryClient,
  queryKey: QueryKey,
  getResourceKey: (id: string, ns: string) => QueryKey,
  idAccessor: string | undefined,
  watchState: WatchState,
  options?: { syncWindowMs?: number },
) {
  const syncWindowMs = options?.syncWindowMs ?? 500;

  const bufferRef = useRef<ResourceEvent[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  // Track watchState in a ref so flush callback always reads the latest
  // value without needing to be re-created on every state change.
  const stateRef = useRef(watchState);
  stateRef.current = watchState;

  const flush = useCallback(() => {
    const events = bufferRef.current;
    bufferRef.current = [];
    timerRef.current = null;
    rafRef.current = null;

    if (events.length === 0 || !idAccessor) return;

    // Single cache update for the list query.
    queryClient.setQueryData(queryKey, (oldData: any) =>
      applyBatch(oldData, events, idAccessor),
    );

    // Update individual resource caches.
    for (const event of events) {
      if (event.type === 'ADD' || event.type === 'UPDATE') {
        queryClient.setQueryData(
          getResourceKey(event.payload.id, event.payload.namespace),
          { result: event.payload.data },
        );
      }
    }
  }, [queryClient, queryKey, getResourceKey, idAccessor]);

  const enqueue = useCallback(
    (event: ResourceEvent) => {
      bufferRef.current.push(event);

      // Already have a pending flush scheduled — just buffer.
      if (timerRef.current !== null || rafRef.current !== null) {
        return;
      }

      // SYNCING (1) → use setTimeout with larger window for initial sync batching.
      // All other states → use requestAnimationFrame for lowest-latency live updates.
      if (stateRef.current === 1) {
        timerRef.current = setTimeout(flush, syncWindowMs);
      } else {
        rafRef.current = requestAnimationFrame(flush);
      }
    },
    [flush, syncWindowMs],
  );

  // Cancel pending timer/RAF on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return enqueue;
}
