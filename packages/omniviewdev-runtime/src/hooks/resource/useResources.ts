import React from 'react';
import { CancelledError, hashKey, replaceEqualDeep, skipToken, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { Enumerate } from '../../resource/v2/client';
import { openSourceView, type SourceViewClient, type SourceViewSnapshot } from '../../resource/v2/sourceView';
import { MAX_LINGERING_VIEWS, VIEW_LINGER_MS } from '../../resource/v2/sourceViewLimits';
import type { HostEnumerateRequest, HostRecord, HostSourceStatus, ResourceView } from '../../resource/v2/host';
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


/** `view` is set once the open resolves. */
type ViewAttempt = { client: Promise<SourceViewClient>; state: 'pending' | 'opened' | 'failed'; view?: SourceViewClient };
type ViewEntry = {
  refs: number;
  attempt: ViewAttempt;
  listeners: Set<(attempt: ViewAttempt) => void>;
  /** Where the view was opened: it is never asked for again once the connection generation has moved on. */
  pluginID: string;
  connectionID: string;
  generation: number;
  /** Closes the view if nobody has acquired it again by then. */
  lingerTimer?: ReturnType<typeof setTimeout>;
};
const views = new Map<string, ViewEntry>();
/**
 * Views whose last observer left but that are still open, in the order they were released. A remount reuses
 * one instead of opening and streaming the collection again. It keeps applying updates that no component
 * renders, so its snapshot stays current.
 */
const lingering = new Map<string, ViewEntry>();

function openViewAttempt(key: string, pluginID: string, request: HostEnumerateRequest, live: boolean): ViewAttempt {
  const attempt: ViewAttempt = {
    client: openSourceView(pluginID, {
      targetId: request.targetId, target: request.request.target, updates: live ? 'ifSupported' : 'none',
    }),
    state: 'pending',
  };
  void attempt.client.then((client) => {
    attempt.state = 'opened';
    attempt.view = client;
  }, () => {
    attempt.state = 'failed';
    // A failed open leaves nothing to return to: a released entry holding it must not linger.
    const entry = views.get(key);
    if (entry?.refs === 0 && entry.attempt === attempt) closeView(key, entry);
  });
  return attempt;
}

function acquireView(key: string, pluginID: string, request: HostEnumerateRequest, live: boolean, generation: number): ViewEntry {
  let entry = views.get(key);
  // A released view whose source went down while it lingered has nothing to return to: close it and open afresh.
  if (entry && lingering.get(key) === entry && isSourceDown(entry)) {
    closeView(key, entry);
    entry = undefined;
  }
  if (!entry) {
    entry = {
      refs: 0, attempt: openViewAttempt(key, pluginID, request, live), listeners: new Set(),
      pluginID, connectionID: request.request.target.route.connection, generation,
    };
    views.set(key, entry);
  } else stopLingering(key, entry);
  entry.refs++;
  return entry;
}

function stopLingering(key: string, entry: ViewEntry) {
  clearTimeout(entry.lingerTimer);
  entry.lingerTimer = undefined;
  if (lingering.get(key) === entry) lingering.delete(key);
}

/** Retire a view nobody observes. Its client closes exactly once, however late its open settles. */
function closeView(key: string, entry: ViewEntry) {
  stopLingering(key, entry);
  if (views.get(key) === entry) views.delete(key);
  void entry.attempt.client.then((client) => client.close(), () => {});
}

/** A failed or closed source has nothing left to serve: its view is not kept once its last observer leaves, nor reused after. */
function isSourceDown(entry: ViewEntry): boolean {
  const state = entry.attempt.view?.getSnapshot().status?.state;
  return state === 'failed' || state === 'closed';
}

function releaseView(key: string, entry: ViewEntry) {
  if (--entry.refs !== 0) return;
  // A view that lingers is never asked for again once its connection generation has moved on. Any release finds it out,
  // and it must not count toward the cap.
  for (const [heldKey, held] of lingering) {
    if (!isConnectionReadinessCurrent(held.pluginID, held.connectionID, held.generation)) closeView(heldKey, held);
  }
  // A failed open or a source that is down leaves nothing to return to, and neither does a replaced connection generation.
  if (views.get(key) !== entry || entry.attempt.state === 'failed' || isSourceDown(entry)
    || !isConnectionReadinessCurrent(entry.pluginID, entry.connectionID, entry.generation)) {
    closeView(key, entry);
    return;
  }
  lingering.set(key, entry);
  entry.lingerTimer = setTimeout(() => {
    if (views.get(key) === entry && entry.refs === 0) closeView(key, entry);
  }, VIEW_LINGER_MS);
  for (const [oldestKey, oldest] of lingering) {
    if (lingering.size <= MAX_LINGERING_VIEWS) break;
    closeView(oldestKey, oldest);
  }
}

/** Refresh the shared owner, coalescing failed-open retries before notifying every subscriber. */
async function refreshView(key: string, expected: ViewEntry, pluginID: string, request: HostEnumerateRequest, live: boolean, generation: number) {
  const entry = views.get(key);
  const current = () => views.get(key) === expected
    && isConnectionReadinessCurrent(pluginID, request.request.target.route.connection, generation);
  if (!entry || entry !== expected || !current()) throw new CancelledError({ revert: true });
  let attempt = entry.attempt;
  const refreshOpened = attempt.state === 'opened';
  if (attempt.state === 'failed') {
    attempt = openViewAttempt(key, pluginID, request, live);
    entry.attempt = attempt;
    for (const observe of entry.listeners) observe(attempt);
  }
  const client = await attempt.client;
  if (!current()) throw new CancelledError({ revert: true });
  if (refreshOpened) {
    await client.refresh();
    if (!current()) throw new CancelledError({ revert: true });
  }
}

const recordLists = new WeakMap<ReadonlyMap<string, HostRecord>, readonly HostRecord[]>();

/** One records array per published map, shared by every page built from that snapshot. */
function recordsOf(records: ReadonlyMap<string, HostRecord>): readonly HostRecord[] {
  let list = recordLists.get(records);
  if (!list) {
    list = [...records.values()];
    recordLists.set(records, list);
  }
  return list;
}

function pageFromSnapshot(snapshot: SourceViewSnapshot): ResourceView {
  const status = snapshot.status;
  return {
    records: recordsOf(snapshot.records),
    sourcePage: { count: status?.count ?? { kind: 'unknown' }, coverage: { kind: 'unknown', paths: [] }, consistency: 'unknown' },
    view: snapshot.viewGeneration ? {
      viewGeneration: snapshot.viewGeneration,
      continuity: status?.continuity ?? 'notApplicable',
      coverage: status?.coverage,
      count: status?.count ?? { kind: 'unknown' },
    } : undefined,
  };
}

/** The page an already open view holds, or undefined while it has no complete snapshot of a source that is up. */
function settledPage(key: string): ResourceView | undefined {
  const snapshot = views.get(key)?.attempt.view?.getSnapshot();
  // The same condition as the cache write in the observing effect.
  if (!snapshot?.complete || snapshot.status?.state === 'failed' || snapshot.status?.state === 'closed') return undefined;
  return pageFromSnapshot(snapshot);
}

/**
 * The source view keeps every unchanged record as the same object, so a collection page needs no deep
 * comparison. It keeps the previous records array when it holds the same objects in the same order, and
 * the previous `sourcePage` and `view` when equal. A positional deep comparison would instead pair each
 * record after a delete with whichever record now stands at its old index, and replace everything it
 * could not match with copies that no decoded row, selection or metric target recognizes.
 */
function sharePage(previous: unknown, next: unknown): unknown {
  const before = previous as ResourceView | undefined;
  const after = next as ResourceView;
  if (!before) return after;
  const isSameList = before.records === after.records
    || (before.records.length === after.records.length && before.records.every((record, index) => record === after.records[index]));
  const records = isSameList ? before.records : after.records;
  const sourcePage = replaceEqualDeep(before.sourcePage, after.sourcePage);
  const view = replaceEqualDeep(before.view, after.view);
  if (records === before.records && sourcePage === before.sourcePage && view === before.view) return before;
  if (records === after.records && sourcePage === after.sourcePage && view === after.view) return after;
  return { ...after, records, sourcePage, view };
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

/**
 * Acquire an explicit source page, or opt into a complete collection acquisition.
 * Collection updates preserve unchanged record objects and reuse the records array when its
 * members and order are unchanged. Collection refetch refreshes an opened shared source view,
 * or retries its failed open. Either acquisition or refresh failure rejects the refetch promise.
 * A collection's source view outlives its last observer by VIEW_LINGER_MS, so a remount in that window
 * reuses it and renders the snapshot it already holds in its first commit.
 */
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
  // Rows that a view kept open since its last observer left already holds are there from the first render.
  const initialPage = React.useCallback(
    () => collection && queryEnabled ? settledPage(viewKey) : undefined, [collection, queryEnabled, viewKey]);
  const [activeView, setActiveView] = React.useState<{ key: string; entry: ViewEntry }>();
  const [sourceSnapshot, setSourceSnapshot] = React.useState<{ key: string; status?: HostSourceStatus }>();

  React.useEffect(() => {
    if (!collection || !queryEnabled || !stableRequest || generation === undefined) return;
    const entry = acquireView(viewKey, pluginID, stableRequest, live, generation);
    let active = true;
    let unsubscribe = () => {};
    let hasPublishedView = false;
    const observe = (attempt: ViewAttempt) => {
      unsubscribe();
      const current = () => active && entry.attempt === attempt
        && isConnectionReadinessCurrent(pluginID, connectionID, generation);
      // A failed open still enables the query, exposing the acquisition error without retrying it.
      const publish = () => {
        if (!current() || hasPublishedView) return;
        hasPublishedView = true;
        setActiveView({ key: viewKey, entry });
      };
      void attempt.client.then((client) => {
        if (!current()) return;
        publish();
        let hasPublishedStatus = false;
        let publishedStatus: HostSourceStatus | undefined;
        const update = () => {
          if (!current()) return;
          const snapshot = client.getSnapshot();
          // Avoid dispatching even an equal state: React may render once before bailing out.
          if (!hasPublishedStatus || publishedStatus !== snapshot.status) {
            hasPublishedStatus = true;
            publishedStatus = snapshot.status;
            setSourceSnapshot({ key: viewKey, status: snapshot.status });
          }
          if (snapshot.complete && snapshot.status?.state !== 'failed' && snapshot.status?.state !== 'closed') {
            // A cache write notifies every observer, so a page equal to the healthy one held is not written.
            // An errored or invalidated entry is written even then: a source that recovered clears it.
            const state = queryClient.getQueryState<ResourceView>(queryKey);
            const held = state?.status === 'success' && !state.isInvalidated ? state.data : undefined;
            const page = sharePage(held, pageFromSnapshot(snapshot)) as ResourceView;
            if (page !== held) queryClient.setQueryData(queryKey, page);
          }
        };
        unsubscribe = client.subscribe(update);
        update();
      }, publish);
    };
    entry.listeners.add(observe);
    observe(entry.attempt);
    return () => { active = false; entry.listeners.delete(observe); unsubscribe(); releaseView(viewKey, entry); };
  }, [collection, queryEnabled, stableRequest, generation, viewKey, pluginID, connectionID, live, queryClient, queryKey]);

  const currentEntry = activeView?.key === viewKey && queryEnabled && collection ? activeView.entry : undefined;
  const enumerate = React.useCallback((input: HostEnumerateRequest, signal: AbortSignal, key: QueryKey) =>
    guardQuery(key, signal, () => Enumerate(pluginID, input)), [guardQuery, pluginID]);
  const collectionQuery = React.useCallback((entry: ViewEntry, signal: AbortSignal, key: QueryKey) =>
    guardQuery(key, signal, async () => firstSnapshot(await entry.attempt.client, signal)), [guardQuery]);
  const queryFn = queryEnabled && stableRequest && (!collection || currentEntry)
    ? ({ signal, queryKey: key }: { signal: AbortSignal; queryKey: QueryKey }) => collection
      ? collectionQuery(currentEntry!, signal, key) : enumerate(stableRequest, signal, key)
    : skipToken;
  const resourcesQuery = useQuery({ queryKey, queryFn, enabled: queryEnabled && (!collection || !!currentEntry), retry: false, gcTime: 0, placeholderData: undefined,
    structuralSharing: collection ? sharePage : true, initialData: initialPage });
  const refetchResources = resourcesQuery.refetch;
  const refresh = React.useCallback(async (...args: Parameters<typeof refetchResources>) => {
    if (collection && currentEntry && stableRequest && generation !== undefined) {
      await refreshView(viewKey, currentEntry, pluginID, stableRequest, live, generation);
    }
    return refetchResources(...args);
  }, [collection, currentEntry, stableRequest, generation, viewKey, pluginID, live, refetchResources]);
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
    enabled: false, retry: false, gcTime: 0, placeholderData: undefined, structuralSharing: collection ? sharePage : true,
    // The acquired page shares the collection's query. Should it ever build that query, it starts from the same rows.
    initialData: acquiredRequest === stableRequest ? initialPage : undefined,
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
