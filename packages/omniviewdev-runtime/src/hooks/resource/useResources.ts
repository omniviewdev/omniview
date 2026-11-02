import React from 'react';
import { CancelledError, hashKey, skipToken, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Enumerate } from '../../resource/v2/client';
import { openSourceView, type SourceViewClient, type SourceViewSnapshot } from '../../resource/v2/sourceView';
import type { HostEnumerateRequest, HostSourceStatus, ResourceView } from '../../resource/v2/host';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import { useResolvedPluginId } from '../useResolvedPluginId';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionQueryGuard } from './useConnectionQueryGuard';
import { connectionReadinessStore, getConnectionReadinessGeneration, isConnectionReadinessCurrent } from '../../connection/connectionReadiness';

export interface UseResourcesOptions {
  pluginID?: string;
  request?: HostEnumerateRequest;
  enabled?: boolean;
  /** Acquire a complete collection through a source view. */
  collection?: boolean;
  /** Request updates for a collection when supported. Ignored for explicit pages. */
  live?: boolean;
}
export interface AcquiredResourcePage {
  /** Exact successful request, including its actual source cursor. */
  request: HostEnumerateRequest;
  page: ResourceView;
}

const inactiveGenerationStore = { getSnapshot: () => undefined, subscribe: () => () => {} };

type ViewEntry = { refs: number; client: Promise<SourceViewClient> };
const views = new Map<string, ViewEntry>();

function acquireView(key: string, pluginID: string, request: HostEnumerateRequest, live: boolean): ViewEntry {
  let entry = views.get(key);
  if (!entry) {
    entry = { refs: 0, client: openSourceView(pluginID, {
      targetId: request.targetId, target: request.request.target, updates: live ? 'ifSupported' : 'none',
    }) };
    views.set(key, entry);
  }
  entry.refs++;
  return entry;
}

function releaseView(key: string, entry: ViewEntry) {
  if (--entry.refs !== 0) return;
  if (views.get(key) === entry) views.delete(key);
  void entry.client.then((client) => client.close(), () => {});
}

function pageFromSnapshot(snapshot: SourceViewSnapshot): ResourceView {
  const status = snapshot.status;
  return {
    records: [...snapshot.records.values()],
    sourcePage: { count: status?.count ?? { kind: 'unknown' }, coverage: { kind: 'unknown', paths: [] }, consistency: 'unknown' },
    view: snapshot.viewGeneration ? {
      viewGeneration: snapshot.viewGeneration,
      continuity: status?.continuity ?? 'notApplicable',
      coverage: status?.coverage,
      count: status?.count ?? { kind: 'unknown' },
    } : undefined,
  };
}

function firstSnapshot(client: SourceViewClient, signal: AbortSignal): Promise<ResourceView> {
  let resolve!: (value: ResourceView) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ResourceView>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  let unsubscribe = () => {};
  const finish = (error?: unknown, page?: ResourceView) => {
    unsubscribe();
    signal.removeEventListener('abort', abort);
    if (error) reject(error); else resolve(page!);
  };
  const abort = () => finish(new CancelledError({ revert: true }));
  const check = () => {
    const snapshot = client.getSnapshot();
    if (snapshot.status?.state === 'failed' || snapshot.status?.state === 'closed') {
      finish(snapshot.status.error ?? new Error('Source view closed before its snapshot completed'));
    } else if (snapshot.complete) finish(undefined, pageFromSnapshot(snapshot));
  };
  unsubscribe = client.subscribe(check);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort(); else check();
  return promise;
}

/** Acquire an explicit source page, or opt into a complete collection acquisition. */
export const useResources = ({ pluginID: explicitPluginID, request, enabled = true, live = true, collection = false }: UseResourcesOptions) => {
  const pluginID = useResolvedPluginId(explicitPluginID);
  const queryClient = useQueryClient();
  const requestHash = hashKey([request]);
  const [requestSnapshot, setRequestSnapshot] = React.useState({ hash: requestHash, request });
  if (requestSnapshot.hash !== requestHash) setRequestSnapshot({ hash: requestHash, request });
  const stableRequest = requestSnapshot.hash === requestHash ? requestSnapshot.request : request;
  const connectionID = stableRequest?.request.target.route.connection ?? '';
  const readinessEnabled = enabled && !!stableRequest;
  const readiness = useConnectionReadiness({ pluginID, connectionID, enabled: readinessEnabled });
  const generationStore = React.useMemo(() => readinessEnabled ? {
    subscribe: connectionReadinessStore(pluginID, connectionID).subscribe,
    getSnapshot: () => getConnectionReadinessGeneration(pluginID, connectionID),
  } : inactiveGenerationStore, [pluginID, connectionID, readinessEnabled]);
  const generation = React.useSyncExternalStore(generationStore.subscribe, generationStore.getSnapshot, generationStore.getSnapshot);
  const guardQuery = useConnectionQueryGuard(pluginID, connectionID);
  const queryEnabled = readinessEnabled && readiness.phase === 'connected';
  const targetIdentity = stableRequest ? hashKey([pluginID, stableRequest.targetId, stableRequest.request.target, collection]) : undefined;
  const listKey = React.useCallback((input?: HostEnumerateRequest) => collection
    ? [...resourceQueryKeys.list(pluginID, input), 'collection', live ? 'ifSupported' : 'none']
    : resourceQueryKeys.list(pluginID, input), [pluginID, collection, live]);
  const queryKey = React.useMemo(() => listKey(stableRequest), [listKey, stableRequest]);
  const viewKey = hashKey([queryKey, generation]);
  const [activeView, setActiveView] = React.useState<{ key: string; entry: ViewEntry }>();
  const [sourceSnapshot, setSourceSnapshot] = React.useState<{ key: string; status?: HostSourceStatus }>();

  React.useEffect(() => {
    if (!collection || !queryEnabled || !stableRequest || generation === undefined) return;
    const entry = acquireView(viewKey, pluginID, stableRequest, live);
    let active = true;
    let unsubscribe = () => {};
    // Publish the view once its open settles; a failed open still enables the
    // query so the rejection surfaces as a query error.
    const publish = () => {
      if (active) setActiveView({ key: viewKey, entry });
    };
    void entry.client.then((client) => {
      if (!active) return;
      publish();
      const update = () => {
        if (!active || !isConnectionReadinessCurrent(pluginID, connectionID, generation)) return;
        const snapshot = client.getSnapshot();
        setSourceSnapshot({ key: viewKey, status: snapshot.status });
        if (snapshot.complete && snapshot.status?.state !== 'failed' && snapshot.status?.state !== 'closed') {
          queryClient.setQueryData(queryKey, pageFromSnapshot(snapshot));
        }
      };
      unsubscribe = client.subscribe(update);
      update();
    }, publish);
    return () => { active = false; unsubscribe(); releaseView(viewKey, entry); };
  }, [collection, queryEnabled, stableRequest, generation, viewKey, pluginID, connectionID, live, queryClient, queryKey]);

  const currentEntry = activeView?.key === viewKey && queryEnabled && collection ? activeView.entry : undefined;
  const enumerate = React.useCallback((input: HostEnumerateRequest, signal: AbortSignal, key: QueryKey) =>
    guardQuery(key, signal, () => Enumerate(pluginID, input)), [guardQuery, pluginID]);
  const collectionQuery = React.useCallback((entry: ViewEntry, signal: AbortSignal, key: QueryKey) =>
    guardQuery(key, signal, async () => firstSnapshot(await entry.client, signal)), [guardQuery]);
  const queryFn = queryEnabled && stableRequest && (!collection || currentEntry)
    ? ({ signal, queryKey: key }: { signal: AbortSignal; queryKey: QueryKey }) => collection
      ? collectionQuery(currentEntry!, signal, key) : enumerate(stableRequest, signal, key)
    : skipToken;
  const resourcesQuery = useQuery({ queryKey, queryFn, enabled: queryEnabled && (!collection || !!currentEntry), retry: false, gcTime: 0, placeholderData: undefined });
  const refetchResources = resourcesQuery.refetch;
  const refresh = React.useCallback(async (...args: Parameters<typeof refetchResources>) => {
    if (collection && currentEntry) await (await currentEntry.client).refresh();
    return refetchResources(...args);
  }, [collection, currentEntry, refetchResources]);
  const resources = collection ? { ...resourcesQuery, refetch: refresh } : resourcesQuery;
  const [successful, setSuccessful] = React.useState<{ identity: string; requestHash: string; request: HostEnumerateRequest }>();
  let acquisition = successful;
  if (targetIdentity && stableRequest && resources.isSuccess && resources.data) {
    if (successful?.identity !== targetIdentity || successful.requestHash !== requestHash) {
      acquisition = { identity: targetIdentity, requestHash, request: stableRequest };
      setSuccessful(acquisition);
    }
  } else if (successful && successful.identity !== targetIdentity) {
    acquisition = undefined;
    setSuccessful(undefined);
  }
  const acquiredRequest = targetIdentity && acquisition?.identity === targetIdentity ? acquisition.request : undefined;
  const acquiredQueryKey = React.useMemo(() => listKey(acquiredRequest), [listKey, acquiredRequest]);
  const acquiredResources = useQuery({
    queryKey: acquiredQueryKey,
    queryFn: queryEnabled && acquiredRequest && !collection ? ({ signal, queryKey: key }) => enumerate(acquiredRequest, signal, key) : skipToken,
    enabled: false, retry: false, gcTime: 0, placeholderData: undefined,
  });
  const acquired = React.useMemo<AcquiredResourcePage | undefined>(() => acquiredRequest && acquiredResources.data
    ? { request: acquiredRequest, page: acquiredResources.data } : undefined, [acquiredRequest, acquiredResources.data]);
  const source = currentEntry && sourceSnapshot?.key === viewKey ? sourceSnapshot.status : undefined;
  return {
    resources, acquired,
    isAcquiredRequestCurrent: !!acquired && acquisition?.requestHash === requestHash,
    refreshAcquiredPage: collection ? refresh : acquiredResources.refetch,
    view: acquired?.page.view,
    source,
    isLive: source?.state === 'following',
    isSyncing: source?.state === 'opening' || source?.state === 'snapshotting' || source?.state === 'resetRequired',
    isSynced: source?.state === 'following' || source?.state === 'finished',
    sourceError: source?.state === 'failed',
  };
};
