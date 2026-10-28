import { useCallback, useEffect, useRef } from 'react';
import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { HostRecord, HostSourcePage, HostWatchAddPayload, HostWatchDeletePayload, HostWatchUpdatePayload, ResourceView } from '../../resource/v2/host';
import { WatchState } from '../../types/watch';

export type AddPayload = HostWatchAddPayload;
export type UpdatePayload = HostWatchUpdatePayload;
export type DeletePayload = HostWatchDeletePayload;
export type ResourceUpdateEvent =
  | { type: 'ADD'; payload: AddPayload }
  | { type: 'UPDATE'; payload: UpdatePayload }
  | { type: 'DELETE'; payload: DeletePayload };

/** Host membership keys, including incarnation, prevent stale deletes replacing current rows. */
export function applyBatch(oldData: HostSourcePage | undefined, events: readonly ResourceUpdateEvent[]): ResourceView | undefined {
  if (!oldData) return oldData;
  const records = [...oldData.records];
  for (const event of events) {
    if (event.type === 'DELETE') {
      const index = records.findIndex((row) => row.key === event.payload.key);
      if (index !== -1) records.splice(index, 1);
    } else {
      const row = event.payload.record;
      const index = records.findIndex((existing) => existing.addressKey === row.addressKey && existing.targetId === row.targetId);
      if (index === -1) records.push(row);
      else records[index] = row;
    }
  }
  // Keep native acquisition provenance separate from the advisory modified view.
  return { records, sourcePage: oldData.sourcePage, view: { guarantee: 'bestEffort', count: { kind: 'unknown' } } };
}

/** Advisory updates use adaptive batching; no snapshot/update continuity is claimed. */
export function useEventBatcher(
  queryClient: QueryClient,
  queryKey: QueryKey,
  watchState: WatchState,
  options?: { syncWindowMs?: number },
) {
  const buffer = useRef<ResourceUpdateEvent[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const state = useRef(watchState);
  state.current = watchState;
  const windowMs = options?.syncWindowMs ?? 500;
  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    timer.current = undefined;
    frame.current = undefined;
    if (!buffer.current.length) return;
    // Retain updates until the real native baseline exists; never synthesize a page.
    if (!queryClient.getQueryData<HostSourcePage>(queryKey)) return;
    const events = buffer.current;
    buffer.current = [];
    queryClient.setQueryData<ResourceView>(queryKey, (old) => applyBatch(old, events));
    for (const event of events) {
      if (event.type === 'DELETE') {
        void queryClient.invalidateQueries({
          queryKey: [queryKey[0], 'resource-v2', 'get'],
          predicate: (query) => (query.state.data as HostRecord | undefined)?.key === event.payload.key,
        });
      } else {
        queryClient.setQueriesData<HostRecord>({ queryKey: [queryKey[0], 'resource-v2', 'get'] }, (old) =>
          old?.key === event.payload.record.key ? event.payload.record : old,
        );
      }
    }
  }, [queryClient, queryKey]);
  const enqueue = useCallback((event: ResourceUpdateEvent) => {
    buffer.current.push(event);
    if (timer.current !== undefined || frame.current !== undefined) return;
    timer.current = window.setTimeout(flush, windowMs);
    if (state.current !== WatchState.WatchStateSyncing) frame.current = requestAnimationFrame(flush);
  }, [flush, windowMs]);
  useEffect(() => {
    const cancel = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated' && event.query.queryHash === hashKey(queryKey) && event.action.type === 'success') flush();
    });
    return () => {
      cancel();
      window.clearTimeout(timer.current);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      buffer.current = [];
      timer.current = undefined;
      frame.current = undefined;
    };
  }, [queryClient, queryKey, flush]);
  return enqueue;
}
