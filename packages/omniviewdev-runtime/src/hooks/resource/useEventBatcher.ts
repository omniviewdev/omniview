import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
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
  const original: unknown[] = base.result ?? [];
  let result: unknown[] | undefined;
  // Index a multi-event batch once. A single event needs only one scan.
  const positions = events.length > 1 ? new Map<unknown, number>() : undefined;
  const duplicates = new Map<number, number>();
  if (positions) {
    for (let i = original.length - 1; i >= 0; i--) {
      const id = get(original[i], idAccessor);
      // Match the previous strict-equality lookup: NaN never matches itself.
      if (id !== id) continue;
      const next = positions.get(id);
      if (next !== undefined) duplicates.set(i, next);
      positions.set(id, i);
    }
  }
  const deleted = new Set<number>();
  for (const event of events) {
    const eventId = get(event.payload.data, idAccessor);
    const rows = result ?? original;
    const idx = positions
      ? (eventId === eventId ? positions.get(eventId) ?? -1 : -1)
      : rows.findIndex((item) => get(item, idAccessor) === eventId);
    switch (event.type) {
      case 'ADD':
        if (idx === -1) {
          result ??= original.slice();
          if (eventId === eventId) positions?.set(eventId, result.length);
          result.push(event.payload.data);
        }
        break;
      case 'UPDATE':
        if (idx !== -1 && rows[idx] !== event.payload.data) {
          result ??= original.slice();
          result[idx] = event.payload.data;
        }
        break;
      case 'DELETE':
        if (idx !== -1) {
          result ??= original.slice();
          deleted.add(idx);
          const next = duplicates.get(idx);
          if (next === undefined) positions?.delete(eventId);
          else positions?.set(eventId, next);
        }
        break;
    }
  }
  if (!result) return base;
  if (deleted.size) result = result.filter((_, index) => !deleted.has(index));
  return { ...base, result };
}

/**
 * Adaptive two-mode event batcher for resource watch events.
 *
 * **Mode 1 — Initial Sync (SYNCING state):** Uses `setTimeout` with a larger
 * window (default 500ms) to batch the initial ADD flood into 1-2 flushes.
 * Satisfies REQ-BATCH-2.
 *
 * **Mode 2 — Live Updates (all other states):** Races `requestAnimationFrame`
 * against the same bounded window, retaining next-frame batching while allowing
 * already-delivered data to progress when painting is withheld but timers run.
 * This does not promise progress while the entire event loop is frozen.
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

  // Scheduling reads only the committed watch state, never an abandoned render.
  const stateRef = useRef(watchState);
  useLayoutEffect(() => {
    stateRef.current = watchState;
  }, [watchState]);

  const flush = useCallback(() => {
    const events = bufferRef.current;
    bufferRef.current = [];
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

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
          { success: true, result: event.payload.data },
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

      // One timer bounds both modes; live updates normally win on the next frame.
      // Whichever callback flushes first cancels the other schedule.
      timerRef.current = setTimeout(flush, syncWindowMs);
      if (stateRef.current !== 1) {
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
