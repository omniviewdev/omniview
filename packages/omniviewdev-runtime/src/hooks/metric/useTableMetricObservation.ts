import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { HostRecord } from '../../resource/v2/host';
import { useMetricObservation, type PreparedMetricResult, type ResourceMetricTarget, type UseMetricObservationOptions } from './useMetricObservation';

/** Cell demand publishes once it has been still for this long... */
const QUIET_MS = 120;
/** ...and never later than this after its first unpublished change, so continuous scrolling still publishes. */
const MAX_WAIT_MS = 250;

export interface UseTableMetricObservationOptions extends Pick<UseMetricObservationOptions,
  'ownerPluginID' | 'ownerConnectionID' | 'resourceKey' | 'bindingID' | 'source' | 'metricIDs' | 'intervalMs' | 'enabled'> {
  /**
   * Current admitted membership, indexed by presentation body. Replace this map when records or
   * membership change, never mutate it in place. Demand published before a replacement keeps
   * its records until the next publication, within the same plugin, connection and resource type.
   */
  recordsByBody: WeakMap<object, HostRecord>;
  /** Pending source/catalog discovery, separate from background sample refresh. */
  loading?: boolean;
  /** A source/catalog failure prevents collection and takes precedence over observation errors. */
  error?: unknown;
}

export interface TableMetricObservation {
  metrics: ReadonlyMap<string, ReadonlyMap<string, PreparedMetricResult>>;
  /** Register in a cell effect. Multiple cells for one body share one target. Cleanup is idempotent. */
  register: (body: object) => () => void;
  /**
   * Host-issued membership token, never an identity reconstructed from the body. A recreated
   * resource keeps its token, so it is withheld while the only samples held under it belong to
   * the previous incarnation.
   */
  tokenFor: (body: object) => string | undefined;
  /**
   * Initial collection: upstream discovery is pending, or demand is published and nothing has
   * been answered yet. Cells should ask `isLoadingFor` instead; this ignores a pending cell
   * that sits beside displayed samples.
   */
  isLoading: boolean;
  /**
   * Whether one cell still awaits its first answer. True for an admitted, selected cell that has
   * no sample while demand is awaiting publication, collection is paused by a hidden document or
   * the request has not answered yet. False once the cell holds any sample (unavailable and
   * failed samples are answers), once the request has answered without one, after an error, and
   * when the cell can never be collected: disabled collection, an unselected metric or a body
   * the table did not admit. Upstream `loading` keeps every such cell pending.
   */
  isLoadingFor: (body: object, metricID: string) => boolean;
  isFetching: boolean;
  error: unknown;
  refresh: () => Promise<void>;
}

const visibilityListeners = new Set<() => void>();
const readVisibility = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
const serverVisibility = () => true;
const notifyVisibility = () => visibilityListeners.forEach(listener => listener());
function subscribeVisibility(listener: () => void) {
  if (!visibilityListeners.size && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', notifyVisibility);
  }
  visibilityListeners.add(listener);
  return () => {
    visibilityListeners.delete(listener);
    if (!visibilityListeners.size && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', notifyVisibility);
    }
  };
}

const identityCache = new WeakMap<HostRecord, string>();
/** Admitted resource identity, incarnation included. A recreated resource keeps its host token, never its samples. */
function identityOf(record: HostRecord): string {
  let identity = identityCache.get(record);
  if (identity === undefined) {
    const { address, incarnation } = record.record.reference;
    identity = JSON.stringify([record.route.connection, address.provider, address.authority, address.type,
      [...(address.scope ?? [])].map(entry => [entry.dimension, entry.value]).sort(([a], [b]) => a.localeCompare(b)),
      address.id, incarnation ?? null]);
    identityCache.set(record, identity);
  }
  return identity;
}

/** Mounted bodies at one publication, each with the admitted record the table held for it then. */
interface PublishedDemand {
  readonly members: ReadonlyMap<object, HostRecord | undefined>;
  /** Plugin, connection and resource type that admitted those records. */
  readonly owner: string;
}
const NO_DEMAND: PublishedDemand = Object.freeze({ members: new Map<object, HostRecord | undefined>(), owner: '' });
const NO_RECORDS = new WeakMap<object, HostRecord>();

function samePublished(a: PublishedDemand, b: PublishedDemand): boolean {
  if (!a.members.size || !b.members.size) return a.members.size === b.members.size;
  if (a.owner !== b.owner || a.members.size !== b.members.size) return false;
  for (const [body, record] of b.members) {
    if (!a.members.has(body)) return false;
    const held = a.members.get(body);
    if (held === record) continue;
    // A refreshed record object for the same membership and incarnation changes nothing.
    if (!held || !record || held.key !== record.key || identityOf(held) !== identityOf(record)) return false;
  }
  return true;
}

/**
 * Mounted-cell registry and its bounded publication. Timers exist only while the owning
 * hook is attached. React cleans a parent up before its cells, so a cell that cleans up
 * after its owner must not arm one; a StrictMode replay re-arms the demand that was still
 * unpublished when the owner attaches again.
 */
class DemandRegistry {
  private readonly mounted = new Map<object, number>();
  private readonly publish: (demand: PublishedDemand) => void;
  private latest: { records: WeakMap<object, HostRecord>; owner: string } | undefined;
  private published = NO_DEMAND;
  private attached = false;
  private pending = false;
  private quiet: number | undefined;
  private deadline: number | undefined;

  constructor(publish: (demand: PublishedDemand) => void) {
    this.publish = publish;
  }

  register = (body: object): (() => void) => {
    const count = this.mounted.get(body) ?? 0;
    this.mounted.set(body, count + 1);
    if (!count) this.touch();
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      const remaining = (this.mounted.get(body) ?? 1) - 1;
      if (remaining > 0) this.mounted.set(body, remaining);
      else {
        this.mounted.delete(body);
        this.touch();
      }
    };
  };

  /** The table's current admitted membership. Published demand keeps its own records until the next publication. */
  retarget(records: WeakMap<object, HostRecord>, owner: string) {
    this.latest = { records, owner };
    if (!samePublished(this.published, this.snapshot())) this.touch();
  }

  attach(): () => void {
    this.attached = true;
    if (this.pending) this.arm();
    return () => {
      this.attached = false;
      this.disarm();
    };
  }

  private snapshot(): PublishedDemand {
    if (!this.mounted.size) return NO_DEMAND;
    const { records, owner } = this.latest ?? { records: NO_RECORDS, owner: '' };
    const members = new Map<object, HostRecord | undefined>();
    for (const body of this.mounted.keys()) members.set(body, records.get(body));
    return { members, owner };
  }

  private touch() {
    this.pending = true;
    this.arm();
  }

  private arm() {
    if (!this.attached) return;
    window.clearTimeout(this.quiet);
    this.quiet = window.setTimeout(this.flush, QUIET_MS);
    this.deadline ??= window.setTimeout(this.flush, MAX_WAIT_MS);
  }

  private disarm() {
    window.clearTimeout(this.quiet);
    window.clearTimeout(this.deadline);
    this.quiet = this.deadline = undefined;
  }

  private flush = () => {
    this.disarm();
    this.pending = false;
    const next = this.snapshot();
    if (samePublished(this.published, next)) return;
    this.published = next;
    this.publish(next);
  };
}

/**
 * Headless current-metric observation for any resource table. Cells register
 * presentation bodies; only admitted HostRecords supply references and routes.
 * Demand publishes after 120 ms without change, and at the latest 250 ms after
 * its first unpublished change, so continuous scrolling still publishes. Published
 * demand outlives a replaced `recordsByBody` and the bodies it replaced until the
 * next publication, so rows keep their samples while the table swaps its map. It
 * never outlives its owner (plugin, connection, resource type), and a recreated
 * resource never shows the previous incarnation's samples. Collection pauses in
 * hidden documents, and settled cells are retained during background refresh. The
 * timers batch view demand only: the host still owns polling and result reuse.
 */
export function useTableMetricObservation(options: UseTableMetricObservationOptions): TableMetricObservation {
  const { ownerPluginID, ownerConnectionID, resourceKey, bindingID, source, recordsByBody, metricIDs, loading } = options;
  const visible = useSyncExternalStore(subscribeVisibility, readVisibility, serverVisibility);
  const owner = JSON.stringify([ownerPluginID, ownerConnectionID, resourceKey]);
  const [published, setPublished] = useState(NO_DEMAND);
  const [demand] = useState(() => new DemandRegistry(setPublished));
  useEffect(() => demand.attach(), [demand]);
  useEffect(() => { demand.retarget(recordsByBody, owner); }, [demand, recordsByBody, owner]);
  // The current map answers first. A body it has dropped keeps the record it was published with
  // until the next publication, but never for another owner's table.
  const { targets, requested } = useMemo(() => {
    const resolved: ResourceMetricTarget[] = [];
    const byToken = new Map<string, string>();
    for (const [body, retained] of published.members) {
      const record = recordsByBody.get(body) ?? (published.owner === owner ? retained : undefined);
      if (!record || byToken.has(record.key)) continue;
      resolved.push({ token: record.key, reference: record.record.reference, route: record.route });
      byToken.set(record.key, identityOf(record));
    }
    return { targets: resolved, requested: byToken };
  }, [published, recordsByBody, owner]);
  const allowed = options.enabled !== false && !!ownerConnectionID && metricIDs.length > 0;
  const enabled = allowed && visible && !options.error && targets.length > 0;
  const observation = useMetricObservation({ ownerPluginID, ownerConnectionID, resourceKey, bindingID, source,
    targets, metricIDs, shape: 'current', intervalMs: options.intervalMs ?? 30_000, enabled });
  const metrics = useMemo(() => {
    const map = new Map<string, Map<string, PreparedMetricResult>>();
    for (const result of observation.results) {
      let values = map.get(result.resourceToken);
      if (!values) { values = new Map(); map.set(result.resourceToken, values); }
      values.set(result.metricID, result);
    }
    return map;
  }, [observation.results]);
  // Callers may pass a fresh array every render: equal selections share one identity.
  const selectedKey = JSON.stringify([...new Set(metricIDs)].sort());
  const selected = useMemo(() => new Set<string>(JSON.parse(selectedKey) as string[]), [selectedKey]);
  const error = options.error ?? observation.error;
  const isFetching = observation.isFetching;
  // A request settles once, when its first answer arrives with collection idle. Background refresh
  // and visibility pauses do not unsettle it; a new target set, metric selection, source or owner does.
  const requestKey = useMemo(() => JSON.stringify([owner, bindingID ?? null, source ?? null, selectedKey,
    [...requested].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))]), [owner, bindingID, source, selectedKey, requested]);
  const [settledKey, setSettledKey] = useState('');
  if (enabled && !isFetching && settledKey !== requestKey) setSettledKey(requestKey);
  const isSettled = settledKey === requestKey;
  const tokenFor = useCallback((body: object) => {
    const record = recordsByBody.get(body);
    if (!record) return undefined;
    const held = requested.get(record.key);
    return held !== undefined && held !== identityOf(record) && metrics.has(record.key) ? undefined : record.key;
  }, [recordsByBody, requested, metrics]);
  const isLoadingFor = useCallback((body: object, metricID: string) => {
    if (error || !selected.has(metricID)) return false;
    const record = recordsByBody.get(body);
    if (!record) return false;
    const token = tokenFor(body);
    if (token !== undefined && metrics.get(token)?.has(metricID)) return false;
    if (loading) return true;
    if (!allowed) return false;
    return requested.get(record.key) !== identityOf(record) || !isSettled;
  }, [error, selected, recordsByBody, tokenFor, metrics, loading, allowed, requested, isSettled]);
  const isLoading = !error && (!!loading || (allowed && targets.length > 0 && !isSettled && metrics.size === 0));
  return useMemo(() => ({ metrics, register: demand.register, tokenFor, error, isLoading, isLoadingFor,
    isFetching, refresh: observation.refresh }),
  [metrics, demand, tokenFor, error, isLoading, isLoadingFor, isFetching, observation.refresh]);
}
