import { useConnectionReadiness, useResolvedResourceTarget, useResourceTypes, useResources } from '@omniviewdev/runtime';
import { useCallback, useMemo } from 'react';
import { podDefinition } from './definition';
import { podRows, type PodRow } from './row';
import { sortPodRows, type PodSort } from './sort';
import { readPodsState, type PodsFailure, type PodsState } from './state';

export const PLUGIN_ID = 'kubernetes';

/**
 * The first set: the rows that paint before the complete snapshot (owner decision A10, plan E10). 256 is the largest page the plugin
 * serves and the runtime's batch size.
 */
export const FIRST_SET = 256;

/** The descriptor the footer takes (MOCK core.js `count`): exact, an estimate, or unknown with how many are loaded so far. */
export type PodsCount =
  | { readonly kind: 'exact'; readonly value: string }
  | { readonly kind: 'estimate'; readonly value: string }
  | { readonly kind: 'unknown'; readonly loaded: string };

export type PodsView = {
  readonly state: PodsState;
  /** Set beside rows that are kept: a read failed after rows were shown. Without rows the failure is the `state`. */
  readonly failure: PodsFailure | undefined;
  /**
   * The rows to show, already in order. While `complete` is false the order is PROVISIONAL: the first set sorted once, then left alone
   * (a live update never moves a row under the user); it changes only when the user changes `sort`, and once when the complete set
   * arrives. Hand it to the table as it is, with the table's own sorting off.
   */
  readonly rows: readonly PodRow[];
  /** `rows.length`: how many Pods are loaded. */
  readonly loaded: number;
  /** The whole set has arrived. Until then the count and the sort order are provisional. */
  readonly complete: boolean;
  readonly count: PodsCount;
  /** The source follows the cluster. */
  readonly live: boolean;
  /** A refresh or a resynchronisation is running on a set that is shown. */
  readonly refreshing: boolean;
  /** Starts the connection. Only the caller decides to call it: a read never connects (plan D4). */
  connect(): Promise<void>;
  /** Asks again for what failed: the connection check, the catalog, the target, or the collection. */
  retry(): Promise<void>;
  /** The user's Refresh: the rows stay while the collection is refreshed. */
  refresh(): Promise<void>;
};

export type UsePodsOptions = {
  readonly connectionID: string;
  /** The order the user chose; the definition's default when absent. */
  readonly sort?: PodSort;
};

const NO_ROWS: readonly PodRow[] = [];

function countOf(source: { readonly kind: string; readonly value?: string } | undefined, loaded: number): PodsCount {
  if ((source?.kind === 'exact' || source?.kind === 'estimate') && source.value !== undefined) {
    return { kind: source.kind, value: source.value };
  }

  // The set is complete, so what is loaded is all there is.
  return { kind: 'exact', value: String(loaded) };
}

/** The runtime's own errors are the state; a command that fails does not throw into an event handler. */
async function settled(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch {
    // The failure is in the hooks' state, where `state` and `failure` read it.
  }
}

/**
 * The Pods of a connection, read through the runtime's fenced hooks only: the catalog, the resolved target, then the collection of
 * its source view (live when the type advertises `sourceUpdates`), exactly as the old table reads them.
 *
 * The collection publishes nothing before its snapshot is complete (`useResources`), which takes 2.5 s at 5,025 Pods. A first explicit
 * page of 256 records is read beside it and shown until the collection completes; both give a record the same key, so the hand-over
 * re-keys nothing. Measured and decided in docs/ui-next/status/1a.2.md.
 */
export function usePods({ connectionID, sort = podDefinition.list.defaultSort }: UsePodsOptions): PodsView {
  const route = useMemo(() => ({ connection: connectionID }), [connectionID]);
  const readiness = useConnectionReadiness({ pluginID: PLUGIN_ID, connectionID });
  const { resourceTypes } = useResourceTypes({ pluginID: PLUGIN_ID, route });
  const podType = resourceTypes.data?.find((type) => type.type === podDefinition.type);
  const target = useResolvedResourceTarget({ pluginID: PLUGIN_ID, route, type: podDefinition.type, enabled: podType !== undefined });
  const request = target.data === undefined ? undefined : { targetId: target.data.targetId, request: { target: target.data.target, pageSize: FIRST_SET } };
  const live = podType?.capabilities.some((capability) => capability.operation === 'sourceUpdates') ?? false;

  const collection = useResources({ pluginID: PLUGIN_ID, request, collection: true, live });
  const everything = collection.resources.data;
  const firstSet = useResources({ pluginID: PLUGIN_ID, request: everything === undefined ? request : undefined, collection: false });

  const connected = readiness.phase === 'connected';
  const records = connected ? (everything ?? firstSet.resources.data)?.records : undefined;
  const complete = connected && everything !== undefined;
  const unordered = records === undefined ? NO_ROWS : podRows(records);
  const { id, direction } = sort;
  const rows = useMemo(() => sortPodRows(unordered, { id, direction }), [unordered, id, direction]);

  const { state, failure } = readPodsState({
    phase: readiness.phase,
    message: readiness.message,
    catalog: { loaded: resourceTypes.data !== undefined, offersPods: podType !== undefined, error: resourceTypes.error },
    target: { error: target.error },
    read: { error: collection.resources.error, source: collection.source },
    rows: rows.length,
    complete,
  });

  const { connect, retry: retryConnection } = readiness;
  const refetchCatalog = resourceTypes.refetch;
  const refetchTarget = target.refetch;
  const refetchCollection = collection.resources.refetch;
  const catalogFailed = resourceTypes.error !== null && resourceTypes.error !== undefined;
  const targetFailed = target.error !== null && target.error !== undefined;

  const retry = useCallback(
    async () => settled(async () => {
      if (!connected) {
        return retryConnection();
      }

      if (catalogFailed) {
        return refetchCatalog();
      }

      return targetFailed ? refetchTarget() : refetchCollection();
    }),
    [connected, catalogFailed, targetFailed, retryConnection, refetchCatalog, refetchTarget, refetchCollection],
  );
  const refresh = useCallback(async () => settled(async () => refetchCollection()), [refetchCollection]);

  return {
    state,
    failure,
    rows,
    loaded: rows.length,
    complete,
    count: complete ? countOf(collection.view?.count, rows.length) : { kind: 'unknown', loaded: String(rows.length) },
    live: collection.isLive,
    refreshing: complete && (collection.resources.isFetching || collection.isSyncing),
    connect,
    retry,
    refresh,
  };
}
