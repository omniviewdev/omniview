import React from 'react';
import { hashKey, useQuery, useQueryClient } from '@tanstack/react-query';
import { Events, type CancellablePromise } from '@wailsio/runtime';
import { Enumerate, EnsureResourceWatch, GetWatchState, SubscribeResource, UnsubscribeResource } from '../../resource/v2/client';
import type { HostEnumerateRequest, HostRecord, HostSourcePage, HostSubscriptionRequest, ResourceView } from '../../resource/v2/host';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import { WatchState, type WatchStateEvent } from '../../types/watch';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useEventBatcher, type AddPayload, type DeletePayload, type UpdatePayload } from './useEventBatcher';

export interface UseResourcesOptions {
  pluginID?: string;
  request?: HostEnumerateRequest;
  enabled?: boolean;
  /** Actual advisory native updates, never inferred from a finite page. */
  live?: boolean;
}

/** Acquire bounded pages and retain the existing explicitly BEST_EFFORT native live workflow. */
export const useResources = ({ pluginID: explicitPluginID, request, enabled = true, live = true }: UseResourcesOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const requestHash = hashKey([request]);
  const stableRequest = React.useMemo(() => request, [requestHash]);
  const queryKey = React.useMemo(() => resourceQueryKeys.list(pluginID, stableRequest), [pluginID, stableRequest]);
  const [watchState, setWatchState] = React.useState(WatchState.WatchStateIdle);
  const [watchFailure, setWatchFailure] = React.useState<unknown>();
  const [isLive, setIsLive] = React.useState(false);
  const enqueue = useEventBatcher(queryClient, queryKey, watchState);
  const resources = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<ResourceView> => {
      if (!stableRequest) throw new Error('Resource target is not resolved');
      let pending: CancellablePromise<HostSourcePage> | undefined;
      const cancel = () => { void pending?.cancel(); };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        let cursor = stableRequest.request.cursor;
        const records = new Map<string, HostRecord>();
        let page: HostSourcePage;
        do {
          signal.throwIfAborted();
          pending = Enumerate(pluginID, { ...stableRequest, request: { ...stableRequest.request, cursor } });
          page = await pending;
          for (const row of page.records) records.set(row.key, row);
          cursor = page.sourcePage.nextCursor;
        } while (cursor);
        return {
          records: [...records.values()],
          sourcePage: page.sourcePage,
        };
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
    enabled: enabled && !!stableRequest,
    retry: false,
  });

  React.useEffect(() => {
    setWatchState(WatchState.WatchStateIdle);
    setWatchFailure(undefined);
    setIsLive(false);
    if (!enabled || !live || !stableRequest) return;
    const target = stableRequest.request.target;
    const subscription: HostSubscriptionRequest = { targetId: stableRequest.targetId, target };
    let active = true;
    let subscribed = false;
    let stateEventSeen = false;
    let ensure: CancellablePromise<void> | undefined;
    const prefix = `${pluginID}/${target.route.connection}/${target.type}`;
    // Register listeners before the host admits membership and before starting native work.
    const close = [
      Events.On(`${prefix}/ADD`, (event) => {
        const payload = event.data as AddPayload;
        if (active && payload.record.targetId === subscription.targetId) enqueue({ type: 'ADD', payload });
      }),
      Events.On(`${prefix}/UPDATE`, (event) => {
        const payload = event.data as UpdatePayload;
        if (active && payload.record.targetId === subscription.targetId) enqueue({ type: 'UPDATE', payload });
      }),
      Events.On(`${prefix}/DELETE`, (event) => {
        const payload = event.data as DeletePayload;
        if (active && payload.targetId === subscription.targetId) enqueue({ type: 'DELETE', payload });
      }),
      Events.On(`${pluginID}/${target.route.connection}/watch/STATE`, (event) => {
        const payload = event.data as WatchStateEvent;
        if (!active || payload.type !== target.type || payload.route.connection !== target.route.connection) return;
        stateEventSeen = true;
        setWatchState(payload.state);
        setWatchFailure(payload.error);
      }),
    ];
    const state = GetWatchState(pluginID, target.route);
    void state.then((summary) => {
      if (active && !stateEventSeen && summary?.resources[target.type] !== undefined) setWatchState(summary.resources[target.type]);
    }).catch((error: unknown) => { if (active) setWatchFailure(error); });
    void SubscribeResource(pluginID, subscription).then(async () => {
      subscribed = true;
      if (!active) { await UnsubscribeResource(pluginID, subscription); return; }
      ensure = EnsureResourceWatch(pluginID, target);
      await ensure;
      if (active) setIsLive(true);
    }).catch((error: unknown) => {
      if (active) { setWatchFailure(error); setWatchState(WatchState.WatchStateError); }
    });
    return () => {
      active = false;
      for (const cancelListener of close) cancelListener();
      void state.cancel();
      void ensure?.cancel();
      if (subscribed) void UnsubscribeResource(pluginID, subscription).catch(() => undefined);
    };
  }, [pluginID, stableRequest, enabled, live, enqueue]);

  return {
    resources,
    view: resources.data?.view,
    watchState,
    isLive,
    isSyncing: watchState === WatchState.WatchStateSyncing,
    /** Native cache readiness only; not proof of gap-free snapshot continuity. */
    isSynced: watchState === WatchState.WatchStateSynced,
    watchError: watchFailure ?? (watchState === WatchState.WatchStateError || watchState === WatchState.WatchStateFailed || watchState === WatchState.WatchStateForbidden ? true : undefined),
    guarantee: isLive ? 'bestEffort' as const : undefined,
  };
};
