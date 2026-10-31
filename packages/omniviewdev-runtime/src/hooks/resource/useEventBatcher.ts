import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
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

/** Explicit pages retain bounded membership; collections accept every admitted target event. */
export function applyBatch(oldData: ResourceView | undefined, events: readonly ResourceUpdateEvent[], membershipChanged = false, collection = false): ResourceView | undefined {
  if (!oldData || (!events.length && !membershipChanged)) return oldData;
  if (collection) {
    const records = new Map(oldData.records.map((row) => [row.key, row]));
    for (const event of events) {
      if (event.type === 'DELETE') records.delete(event.payload.key);
      else records.set(event.payload.record.key, event.payload.record);
    }
    return {
      records: [...records.values()],
      sourcePage: oldData.sourcePage,
      view: { guarantee: 'bestEffort', count: { kind: 'unknown' }, membershipStale: false },
    };
  }
  let records: HostRecord[] | undefined;
  const positions = events.length > 1 ? new Map(oldData.records.map((row, index) => [row.key, index])) : undefined;
  const deleted = new Set<number>();
  let membershipStale = oldData.view?.membershipStale === true || membershipChanged;
  for (const event of events) {
    const key = event.type === 'DELETE' ? event.payload.key : event.payload.record.key;
    const index = positions ? positions.get(key) ?? -1 : oldData.records.findIndex((row) => row.key === key);
    if (event.type === 'DELETE') {
      if (index !== -1) deleted.add(index);
      // A deleted member can leave a page gap; unknown incarnations are never inferred.
      membershipStale = true;
    } else if (index === -1 || deleted.has(index)) {
      membershipStale = true;
    } else {
      if ((records ?? oldData.records)[index] !== event.payload.record) {
        records ??= [...oldData.records];
        records[index] = event.payload.record;
      }
    }
  }
  if (!records && !deleted.size && oldData.view?.membershipStale === membershipStale &&
    oldData.view.guarantee === 'bestEffort' && oldData.view.count.kind === 'unknown' && oldData.view.sourceRevision === undefined) return oldData;
  const rows = records ?? oldData.records;
  return {
    records: deleted.size ? rows.filter((_, index) => !deleted.has(index)) : rows,
    sourcePage: oldData.sourcePage,
    view: { guarantee: 'bestEffort', count: { kind: 'unknown' }, membershipStale },
  };
}

/** Keep only the latest event for each key within the active acquisition. */
export function useEventBatcher(
  queryClient: QueryClient,
  queryKey: QueryKey,
  watchState: WatchState,
  options?: { syncWindowMs?: number; enabled?: boolean; isCurrent?: () => boolean; collection?: boolean },
) {
  const buffer = useRef(new Map<string, ResourceUpdateEvent>());
  const pendingMembershipChange = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const state = useRef(watchState);
  const enabled = options?.enabled ?? true;
  const isCurrent = options?.isCurrent;
  const collection = options?.collection ?? false;
  const scope = useMemo(() => ({ queryClient, queryKey, enabled, isCurrent, collection }), [queryClient, queryKey, enabled, isCurrent, collection]);
  const activeScope = useRef<typeof scope | undefined>(undefined);
  const current = useCallback(() => activeScope.current === scope && enabled && (!isCurrent || isCurrent()), [scope, enabled, isCurrent]);
  useLayoutEffect(() => {
    state.current = watchState;
  }, [watchState]);
  const windowMs = options?.syncWindowMs ?? 500;
  const flush = useCallback(() => {
    // A late callback must not drain or cancel a newer scope's work.
    if (activeScope.current !== scope) return;
    window.clearTimeout(timer.current);
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    timer.current = undefined;
    frame.current = undefined;
    if (!current()) {
      buffer.current.clear();
      pendingMembershipChange.current = false;
      return;
    }
    if (!buffer.current.size && !pendingMembershipChange.current) return;
    if (!queryClient.getQueryData<ResourceView>(queryKey)) return;
    // Apply observations received during collection refresh after its snapshot settles.
    if (collection && queryClient.getQueryState(queryKey)?.fetchStatus === 'fetching') return;
    const events = [...buffer.current.values()];
    const membershipChanged = pendingMembershipChange.current;
    buffer.current.clear();
    pendingMembershipChange.current = false;
    const query = queryClient.getQueryCache().find<ResourceView>({ queryKey, exact: true });
    if (collection && query?.state.status === 'error') {
      // Advisory updates do not turn a failed native acquisition into success.
      query.setState({ data: current() ? applyBatch(query.state.data, events, membershipChanged, collection) : query.state.data });
    } else {
      queryClient.setQueryData<ResourceView>(queryKey, (old) => current() ? applyBatch(old, events, membershipChanged, collection) : old);
    }
    for (const event of events) {
      if (!current()) return;
      if (event.type === 'DELETE') {
        void queryClient.invalidateQueries({
          queryKey: [queryKey[0], 'resource-v2', 'get'],
          predicate: (query) => current() && (query.state.data as HostRecord | undefined)?.key === event.payload.key,
        });
      } else {
        queryClient.setQueriesData<HostRecord>({ queryKey: [queryKey[0], 'resource-v2', 'get'] }, (old) =>
          current() && old?.key === event.payload.record.key ? event.payload.record : old,
        );
      }
    }
  }, [queryClient, queryKey, scope, current, collection]);
  const enqueue = useCallback((event: ResourceUpdateEvent) => {
    if (!current()) return;
    const key = event.type === 'DELETE' ? event.payload.key : event.payload.record.key;
    const baseline = queryClient.getQueryData<ResourceView>(queryKey);
    if (collection || baseline?.records.some((row) => row.key === key)) buffer.current.set(key, event);
    else pendingMembershipChange.current = true;
    if (!collection && event.type === 'DELETE') pendingMembershipChange.current = true;
    if (timer.current !== undefined || frame.current !== undefined) return;
    // A timer also bounds live mode when Chromium withholds animation frames.
    timer.current = window.setTimeout(flush, windowMs);
    if (state.current !== WatchState.WatchStateSyncing) frame.current = requestAnimationFrame(flush);
  }, [queryClient, queryKey, flush, windowMs, current, collection]);
  useLayoutEffect(() => {
    if (!enabled) return;
    activeScope.current = scope;
    const pendingEvents = buffer.current;
    const cancel = queryClient.getQueryCache().subscribe((event) => {
      if (!current() || event.type !== 'updated' || event.query.queryHash !== hashKey(queryKey)) return;
      if (event.action.type === 'fetch') {
        // A new native acquisition supersedes older queued advisory observations.
        pendingEvents.clear();
        pendingMembershipChange.current = false;
      } else if (event.action.type === 'success' || (collection && event.action.type === 'error')) flush();
    });
    return () => {
      activeScope.current = undefined;
      cancel();
      window.clearTimeout(timer.current);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      pendingEvents.clear();
      pendingMembershipChange.current = false;
      timer.current = undefined;
      frame.current = undefined;
    };
  }, [queryClient, queryKey, flush, enabled, scope, current, collection]);
  return enqueue;
}
