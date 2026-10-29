import React from 'react';
import { hashKey, useQuery, useQueryClient } from '@tanstack/react-query';
import { Events } from '@wailsio/runtime';
import { Enumerate, EnsureResourceWatch, GetWatchState, SubscribeResource, UnsubscribeResource } from '../../resource/v2/client';
import type { CancellablePromise } from '@wailsio/runtime';
import type { HostEnumerateRequest, HostSubscriptionRequest, ResourceView } from '../../resource/v2/host';
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
export interface AcquiredResourcePage {
  /** Exact successful request, including its actual source cursor. */
  request: HostEnumerateRequest;
  page: ResourceView;
}

async function acquirePage(pluginID: string, request: HostEnumerateRequest | undefined, signal: AbortSignal): Promise<ResourceView> {
  if (!request) throw new Error('Resource target is not resolved');
  signal.throwIfAborted();
  const pending = Enumerate(pluginID, request);
  const cancel = () => { void pending.cancel(); };
  signal.addEventListener('abort', cancel, { once: true });
  try { return await pending; }
  finally { signal.removeEventListener('abort', cancel); }
}

/** One attempted acquisition and one displayed successful page; never accumulated row history. */
export const useResources = ({ pluginID: explicitPluginID, request, enabled = true, live = true }: UseResourcesOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const requestHash = hashKey([request]);
  const stableRequest = React.useMemo(() => request, [requestHash]);
  const targetIdentity = stableRequest ? hashKey([pluginID, stableRequest.targetId, stableRequest.request.target]) : undefined;
  const queryKey = React.useMemo(() => resourceQueryKeys.list(pluginID, stableRequest), [pluginID, stableRequest]);
  const resources = useQuery({
    queryKey,
    queryFn: ({ signal }) => acquirePage(pluginID, stableRequest, signal),
    enabled: enabled && !!stableRequest,
    retry: false,
    gcTime: 0,
    placeholderData: undefined,
  });
  const [successful, setSuccessful] = React.useState<{ identity: string; requestHash: string; request: HostEnumerateRequest }>();
  // Identity changes clear the displayed page in this render, before effects run.
  const acquiredRequest = targetIdentity && successful?.identity === targetIdentity ? successful.request : undefined;
  React.useEffect(() => {
    if (targetIdentity && stableRequest && resources.isSuccess && resources.data) {
      setSuccessful((previous) => previous?.identity === targetIdentity && previous.requestHash === requestHash
        ? previous : { identity: targetIdentity, requestHash, request: stableRequest });
    } else {
      setSuccessful((previous) => previous?.identity === targetIdentity ? previous : undefined);
    }
  }, [targetIdentity, requestHash, stableRequest, resources.isSuccess, resources.dataUpdatedAt, resources.data]);
  const acquiredQueryKey = React.useMemo(() => resourceQueryKeys.list(pluginID, acquiredRequest), [pluginID, acquiredRequest]);
  // A disabled observer retains just the displayed page while a different cursor is attempted.
  // Its explicit refetch is a real native acquisition, not a synthetic cached response.
  const acquiredResources = useQuery({
    queryKey: acquiredQueryKey,
    queryFn: ({ signal }) => acquirePage(pluginID, acquiredRequest, signal),
    enabled: false,
    retry: false,
    gcTime: 0,
    placeholderData: undefined,
  });
  const acquired = React.useMemo<AcquiredResourcePage | undefined>(() => acquiredRequest && acquiredResources.data
    ? { request: acquiredRequest, page: acquiredResources.data } : undefined, [acquiredRequest, acquiredResources.data]);
  const [watchState, setWatchState] = React.useState(WatchState.WatchStateIdle);
  const [watchFailure, setWatchFailure] = React.useState<unknown>();
  const [isLive, setIsLive] = React.useState(false);
  const enqueue = useEventBatcher(queryClient, acquiredQueryKey, watchState);

  React.useEffect(() => {
    setWatchState(WatchState.WatchStateIdle);
    setWatchFailure(undefined);
    setIsLive(false);
    if (!enabled || !live || !acquiredRequest) return;
    const target = acquiredRequest.request.target;
    const subscription: HostSubscriptionRequest = { targetId: acquiredRequest.targetId, target };
    let active = true;
    let subscribed = false;
    let stateEventSeen = false;
    let ensure: CancellablePromise<void> | undefined;
    const prefix = `${pluginID}/${target.route.connection}/${target.type}`;
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
  }, [pluginID, acquiredRequest, enabled, live, enqueue]);

  const hasAcquired = acquired !== undefined;
  return {
    /** Attempted request state; an error does not rename or replace the acquired page. */
    resources,
    acquired,
    /** Gate acquired readiness when a consumer chooses to display the attempted page instead. */
    isAcquiredRequestCurrent: hasAcquired && successful?.requestHash === requestHash,
    refreshAcquiredPage: acquiredResources.refetch,
    view: acquired?.page.view,
    membershipStale: acquired?.page.view?.membershipStale ?? false,
    watchState: hasAcquired ? watchState : WatchState.WatchStateIdle,
    isLive: hasAcquired && isLive,
    isSyncing: hasAcquired && watchState === WatchState.WatchStateSyncing,
    /** Native cache readiness only, not snapshot/update continuity. */
    isSynced: hasAcquired && watchState === WatchState.WatchStateSynced,
    watchError: hasAcquired ? watchFailure ?? (watchState === WatchState.WatchStateError || watchState === WatchState.WatchStateFailed || watchState === WatchState.WatchStateForbidden ? true : undefined) : undefined,
    guarantee: hasAcquired && isLive ? 'bestEffort' as const : undefined,
  };
};
