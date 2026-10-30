import React from 'react';
import { hashKey, skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { Events } from '@wailsio/runtime';
import { Enumerate, EnsureResourceWatch, GetWatchState, SubscribeResource, UnsubscribeResource } from '../../resource/v2/client';
import type { CancellablePromise } from '@wailsio/runtime';
import type { HostEnumerateRequest, HostSubscriptionRequest, ResourceView } from '../../resource/v2/host';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import { WatchState, type WatchStateEvent } from '../../types/watch';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useEventBatcher, type AddPayload, type DeletePayload, type UpdatePayload } from './useEventBatcher';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';
import { getConnectionReadinessGeneration, isConnectionReadinessCurrent } from '../../connection/connectionReadiness';
import { useSnackbar } from '../snackbar/useSnackbar';
import { showAppError } from '../../errors/parseAppError';

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


/** One attempted acquisition and one displayed successful page; never accumulated row history. */
export const useResources = ({ pluginID: explicitPluginID, request, enabled = true, live = true }: UseResourcesOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const { showSnackbar } = useSnackbar();
  const showSnackbarRef = React.useRef(showSnackbar);
  React.useLayoutEffect(() => { showSnackbarRef.current = showSnackbar; }, [showSnackbar]);
  const requestHash = hashKey([request]);
  const stableRequest = React.useMemo(() => request, [requestHash]);
  const connectionID = stableRequest?.request.target.route.connection ?? '';
  const readiness = useConnectionReadiness({ pluginID, connectionID, enabled: enabled && !!stableRequest });
  const guardQuery = useConnectionQueryGuard(pluginID, connectionID);
  const queryEnabled = enabled && !!stableRequest && readiness.phase === 'connected';
  const targetIdentity = stableRequest ? hashKey([pluginID, stableRequest.targetId, stableRequest.request.target]) : undefined;
  const queryKey = React.useMemo(() => resourceQueryKeys.list(pluginID, stableRequest), [pluginID, stableRequest]);
  const resources = useQuery({
    queryKey,
    queryFn: queryEnabled ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => Enumerate(pluginID, stableRequest!)) : skipToken,
    enabled: queryEnabled,
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
    queryFn: queryEnabled && acquiredRequest ? ({ signal, queryKey }) => guardQuery(queryKey, signal, () => Enumerate(pluginID, acquiredRequest)) : skipToken,
    enabled: false,
    retry: false,
    gcTime: 0,
    placeholderData: undefined,
  });
  const acquired = React.useMemo<AcquiredResourcePage | undefined>(() => acquiredRequest && acquiredResources.data
    ? { request: acquiredRequest, page: acquiredResources.data } : undefined, [acquiredRequest, acquiredResources.data]);
  const generation = getConnectionReadinessGeneration(pluginID, connectionID);
  const watchEnabled = queryEnabled && live && !!acquiredRequest;
  const watchScope = React.useMemo(() => ({ pluginID, acquiredRequest, generation, enabled: watchEnabled }), [pluginID, acquiredRequest, generation, watchEnabled]);
  const [watchSnapshot, setWatchSnapshot] = React.useState<{ scope: typeof watchScope; state: WatchState; error?: unknown; live: boolean }>();
  const watchState = watchEnabled && watchSnapshot?.scope === watchScope ? watchSnapshot.state : WatchState.WatchStateIdle;
  const watchFailure = watchEnabled && watchSnapshot?.scope === watchScope ? watchSnapshot.error : undefined;
  const isLive = watchEnabled && watchSnapshot?.scope === watchScope && watchSnapshot.live;
  const enqueue = useEventBatcher(queryClient, acquiredQueryKey, watchState, { enabled: watchEnabled });
  const subscriptionTask = React.useRef<Promise<void>>(Promise.resolve());

  React.useEffect(() => {
    if (!watchEnabled || !acquiredRequest) return;
    const target = acquiredRequest.request.target;
    const subscription: HostSubscriptionRequest = { targetId: acquiredRequest.targetId, target };
    let active = true;
    let subscribed = false;
    let stateEventSeen = false;
    let ensure: CancellablePromise<void> | undefined;
    const current = () => active && generation !== undefined && isConnectionReadinessCurrent(pluginID, connectionID, generation);
    const publish = (patch: Partial<Omit<NonNullable<typeof watchSnapshot>, 'scope'>>) => {
      if (!current()) return;
      setWatchSnapshot((previous) => ({ state: WatchState.WatchStateIdle, live: false, ...(previous?.scope === watchScope ? previous : {}), ...patch, scope: watchScope }));
    };
    const prefix = `${pluginID}/${target.route.connection}/${target.type}`;
    const close = [
      Events.On(`${prefix}/ADD`, (event) => {
        const payload = event.data as AddPayload;
        if (current() && payload.record.targetId === subscription.targetId) enqueue({ type: 'ADD', payload });
      }),
      Events.On(`${prefix}/UPDATE`, (event) => {
        const payload = event.data as UpdatePayload;
        if (current() && payload.record.targetId === subscription.targetId) enqueue({ type: 'UPDATE', payload });
      }),
      Events.On(`${prefix}/DELETE`, (event) => {
        const payload = event.data as DeletePayload;
        if (current() && payload.targetId === subscription.targetId) enqueue({ type: 'DELETE', payload });
      }),
      Events.On(`${pluginID}/${target.route.connection}/watch/STATE`, (event) => {
        const payload = event.data as WatchStateEvent;
        if (!current() || payload.type !== target.type || payload.route.connection !== target.route.connection) return;
        stateEventSeen = true;
        publish({ state: payload.state, error: payload.error });
      }),
    ];
    const closeListeners = () => { for (const cancelListener of close) cancelListener(); };
    const state = GetWatchState(pluginID, target.route);
    void state.then((summary) => {
      if (!stateEventSeen && summary?.resources[target.type] !== undefined) publish({ state: summary.resources[target.type] });
    }).catch((error: unknown) => publish({ error }));
    // Reacquisition waits for prior acknowledgement and cleanup, even across disconnect.
    const subscribe = subscriptionTask.current.then(async () => {
      if (!current()) return;
      await SubscribeResource(pluginID, subscription);
      subscribed = true;
      if (!current()) return;
      ensure = EnsureResourceWatch(pluginID, target);
      await ensure;
      publish({ live: true });
    }).catch((error: unknown) => {
      closeListeners();
      publish({ error, state: WatchState.WatchStateError, live: false });
      if (current()) showAppError(showSnackbarRef.current, error, 'Failed to subscribe to resource updates');
    });
    subscriptionTask.current = subscribe;
    return () => {
      active = false;
      closeListeners();
      void state.cancel();
      void ensure?.cancel();
      subscriptionTask.current = subscribe.then(async () => {
        if (subscribed) await UnsubscribeResource(pluginID, subscription);
      }).catch((error: unknown) => {
        showAppError(showSnackbarRef.current, error, 'Failed to unsubscribe from resource updates');
      });
    };
  }, [pluginID, connectionID, acquiredRequest, watchEnabled, generation, watchScope, enqueue]);

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
