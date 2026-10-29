import { useCallback, useEffect, useRef } from 'react';
import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query';
import type { HostRecord, HostWatchAddPayload, HostWatchDeletePayload, HostWatchUpdatePayload, ResourceView } from '../../resource/v2/host';
import { WatchState } from '../../types/watch';

export type AddPayload = HostWatchAddPayload;
export type UpdatePayload = HostWatchUpdatePayload;
export type DeletePayload = HostWatchDeletePayload;
export type ResourceUpdateEvent =
  | { type: 'ADD'; payload: AddPayload }
  | { type: 'UPDATE'; payload: UpdatePayload }
  | { type: 'DELETE'; payload: DeletePayload };

/** Advisory events may patch observed host keys, never expand native page membership. */
export function applyBatch(oldData: ResourceView | undefined, events: readonly ResourceUpdateEvent[], membershipChanged = false): ResourceView | undefined {
  if (!oldData || (!events.length && !membershipChanged)) return oldData;
  const records = [...oldData.records];
  let membershipStale = oldData.view?.membershipStale === true || membershipChanged;
  for (const event of events) {
    if (event.type === 'DELETE') {
      const index = records.findIndex((row) => row.key === event.payload.key);
      if (index !== -1) records.splice(index, 1);
      // A deleted member can leave a page gap; unknown incarnations are never inferred.
      membershipStale = true;
    } else {
      const row = event.payload.record;
      const index = records.findIndex((existing) => existing.key === row.key);
      if (index === -1) membershipStale = true;
      else records[index] = row;
    }
  }
  return {
    records,
    sourcePage: oldData.sourcePage,
    view: { guarantee: 'bestEffort', count: { kind: 'unknown' }, membershipStale },
  };
}

/** At most one pending event per observed page key; unseen row bodies are never retained. */
export function useEventBatcher(
  queryClient: QueryClient,
  queryKey: QueryKey,
  watchState: WatchState,
  options?: { syncWindowMs?: number },
) {
  const buffer = useRef(new Map<string, ResourceUpdateEvent>());
  const pendingMembershipChange = useRef(false);
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
    if (!buffer.current.size && !pendingMembershipChange.current) return;
    if (!queryClient.getQueryData<ResourceView>(queryKey)) return;
    const events = [...buffer.current.values()];
    const membershipChanged = pendingMembershipChange.current;
    buffer.current.clear();
    pendingMembershipChange.current = false;
    queryClient.setQueryData<ResourceView>(queryKey, (old) => applyBatch(old, events, membershipChanged));
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
    const key = event.type === 'DELETE' ? event.payload.key : event.payload.record.key;
    const baseline = queryClient.getQueryData<ResourceView>(queryKey);
    if (baseline?.records.some((row) => row.key === key)) buffer.current.set(key, event);
    else pendingMembershipChange.current = true;
    if (event.type === 'DELETE') pendingMembershipChange.current = true;
    if (timer.current !== undefined || frame.current !== undefined) return;
    timer.current = window.setTimeout(flush, windowMs);
    if (state.current !== WatchState.WatchStateSyncing) frame.current = requestAnimationFrame(flush);
  }, [queryClient, queryKey, flush, windowMs]);
  useEffect(() => {
    const cancel = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.query.queryHash !== hashKey(queryKey)) return;
      if (event.action.type === 'fetch') {
        // A new native acquisition supersedes older queued advisory observations.
        buffer.current.clear();
        pendingMembershipChange.current = false;
      } else if (event.action.type === 'success') flush();
    });
    return () => {
      cancel();
      window.clearTimeout(timer.current);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      buffer.current.clear();
      pendingMembershipChange.current = false;
      timer.current = undefined;
      frame.current = undefined;
    };
  }, [queryClient, queryKey, flush]);
  return enqueue;
}
