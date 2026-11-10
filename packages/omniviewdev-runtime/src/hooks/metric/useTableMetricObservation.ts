import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { HostRecord } from '../../resource/v2/host';
import { useMetricObservation, type PreparedMetricResult, type ResourceMetricTarget, type UseMetricObservationOptions } from './useMetricObservation';
import { targetIdentity } from './targetIdentity';

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
   * the previous incarnation. The function is replaced whenever an answer it gives can change.
   */
  tokenFor: (body: object) => string | undefined;
  /**
   * Initial collection: upstream discovery is pending, or demand is published and nothing has
   * been answered yet: no cell holds a sample and no completed request answered one. Cells should
   * ask `isLoadingFor` instead; this ignores a pending cell that sits beside displayed samples
   * or answered cells.
   */
  isLoading: boolean;
  /**
   * Whether one cell still awaits its first answer. True for an admitted, selected cell that has
   * no sample while demand is awaiting publication, collection is paused by a hidden document or
   * no request that included the cell has answered yet. False once the cell holds any sample
   * (unavailable and failed samples are answers), once a request that included it has answered
   * without one, after an error, and when the cell can never be collected: disabled collection,
   * an unselected metric or a body the table did not admit. Upstream `loading` keeps every such
   * cell pending. An answer outlives its request while the table asks for other targets or
   * metrics, so a settled cell does not load again because its neighbours changed. It does not
   * outlive a change of plugin, connection, resource type, binding or source, or the recreation
   * of its resource, and a target or metric that no completed request included still loads. The
   * function is replaced whenever any cell's answer can change, so memoized cells that depend on
   * it re-render.
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

const targetsByRecord = new WeakMap<HostRecord, ResourceMetricTarget>();
/** The target an admitted record asks the host for: its host token, reference and route, never anything reconstructed from a body. */
function targetOf(record: HostRecord): ResourceMetricTarget {
  let target = targetsByRecord.get(record);
  if (!target) {
    target = { token: record.key, reference: record.record.reference, route: record.route };
    targetsByRecord.set(record, target);
  }
  return target;
}
/** Admitted resource identity, incarnation included. A recreated resource keeps its host token, never its samples. */
const identityOf = (record: HostRecord): string => targetIdentity(targetOf(record));

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

/** What the host is asked for: each admitted record once, under its host token. */
interface AdmittedTargets {
  readonly targets: readonly ResourceMetricTarget[];
  /** Host token to the admitted identity it is requested under. */
  readonly requested: ReadonlyMap<string, string>;
}

/**
 * The current map answers first. A body it has dropped keeps the record it was published with
 * until the next publication, but never for another owner's table.
 */
function resolveTargets(published: PublishedDemand, records: WeakMap<object, HostRecord>, owner: string): AdmittedTargets {
  const resolved: ResourceMetricTarget[] = [];
  const requested = new Map<string, string>();
  for (const [body, retained] of published.members) {
    const record = records.get(body) ?? (published.owner === owner ? retained : undefined);
    if (!record || requested.has(record.key)) continue;
    const target = targetOf(record);
    resolved.push(target);
    requested.set(record.key, targetIdentity(target));
  }
  return { targets: resolved, requested };
}

/** Equal when the host would be asked for the same tokens and identities, whichever record objects carry them. */
function sameTargets(a: AdmittedTargets, b: AdmittedTargets): boolean {
  if (a === b) return true;
  if (a.targets.length !== b.targets.length) return false;
  return a.targets.every((target, index) => target === b.targets[index]
    || (target.token === b.targets[index].token && targetIdentity(target) === targetIdentity(b.targets[index])));
}

/**
 * The request whose answer completed last, kept as the cells it covered: each admitted target, by host
 * token and admitted identity, under each metric it selected. Requests for other targets or metrics leave
 * those cells answered, so a cell answered without a sample does not load again because its neighbours
 * changed. The next request to complete replaces it, so only one request's cells are ever held and a
 * target that left the table is forgotten.
 */
interface AnsweredRequest {
  /** The request in canonical form: its scope, metric selection and requested targets. */
  readonly key: string;
  /** Plugin, connection, resource type, binding and source it was made under. Nothing answered carries across another. */
  readonly scope: string;
  readonly requested: ReadonlyMap<string, string>;
  readonly selected: ReadonlySet<string>;
}

/** Everything a cell's answer derives from; replaced as a whole when any part changes. */
interface CellInputs {
  readonly recordsByBody: WeakMap<object, HostRecord>;
  readonly requested: ReadonlyMap<string, string>;
  readonly metrics: ReadonlyMap<string, ReadonlyMap<string, PreparedMetricResult>>;
  readonly selected: ReadonlySet<string>;
  readonly allowed: boolean;
  readonly loading: boolean;
  /** The last completed request, when it was made under the table's current scope. */
  readonly answered: AnsweredRequest | null;
  readonly error: unknown;
}

/**
 * The host token a body's samples are read under. A recreated resource keeps its token, so it is
 * withheld while the only samples held under it belong to the previous incarnation.
 */
function tokenOf(record: HostRecord, requested: ReadonlyMap<string, string>, metrics: CellInputs['metrics']): string | undefined {
  const held = requested.get(record.key);
  return held !== undefined && held !== identityOf(record) && metrics.has(record.key) ? undefined : record.key;
}

/** The sample held for one admitted record and metric, unless its token is withheld. */
function sampleOf(inputs: CellInputs, record: HostRecord, metricID: string): PreparedMetricResult | undefined {
  const token = tokenOf(record, inputs.requested, inputs.metrics);
  return token === undefined ? undefined : inputs.metrics.get(token)?.get(metricID);
}

/** Whether a completed request answered any cell the table currently asks for. */
function answersAny(answered: AnsweredRequest | null, requested: ReadonlyMap<string, string>, selected: ReadonlySet<string>): boolean {
  if (answered === null) return false;
  let metric = false;
  for (const metricID of selected) {
    if (answered.selected.has(metricID)) { metric = true; break; }
  }
  if (!metric) return false;
  for (const [token, identity] of requested) {
    if (answered.requested.get(token) === identity) return true;
  }
  return false;
}

/**
 * Whether the cell of one admitted record still awaits its first answer for a metric. A completed
 * request answers it when it asked for this host token under this admitted identity, and this metric.
 */
function isAwaiting(inputs: CellInputs, record: HostRecord, hasSample: boolean, metricID: string): boolean {
  if (inputs.error || !inputs.selected.has(metricID) || hasSample) return false;
  if (inputs.loading) return true;
  if (!inputs.allowed) return false;
  const identity = identityOf(record);
  const { answered } = inputs;
  const isAnswered = answered !== null && answered.selected.has(metricID) && answered.requested.get(record.key) === identity;
  return inputs.requested.get(record.key) !== identity || !isAnswered;
}


/**
 * Headless current-metric observation for any resource table. Cells register presentation
 * bodies; only admitted HostRecords supply references and routes. Demand publishes after
 * 120 ms without change, and at the latest 250 ms after its first unpublished change, so
 * continuous scrolling still publishes. Published demand outlives a replaced `recordsByBody`
 * and the bodies it replaced until the next publication, so rows keep their samples while the
 * table swaps its map. It never outlives its owner (plugin, connection, resource type), and a
 * recreated resource never shows the previous incarnation's samples. Collection pauses in
 * hidden documents. A cell that a completed request answered, even without a sample, stays
 * answered through background refresh and while the table asks for other targets or metrics, so
 * it does not load again because its neighbours changed. A newly admitted target or metric still
 * loads, and a change of plugin, connection, resource type, binding or source, or a recreated
 * resource, loads it again. Only the request that completed last is remembered, so a target that
 * left the table is forgotten. The timers batch view demand only: the host still owns polling and
 * result reuse.
 *
 * Cells register their body in an effect and read their sample and loading state from this
 * observation. Answers are delivered in the same React update as the owning table; a second
 * external-store publication from a layout effect would force another synchronous commit.
 * A target set equal to the published one keeps its identity, and repeated samples reuse
 * prepared results.
 */
export function useTableMetricObservation(options: UseTableMetricObservationOptions): TableMetricObservation {
  const { ownerPluginID, ownerConnectionID, resourceKey, bindingID, source, recordsByBody, metricIDs, loading } = options;
  const visible = useSyncExternalStore(subscribeVisibility, readVisibility, serverVisibility);
  const owner = JSON.stringify([ownerPluginID, ownerConnectionID, resourceKey]);
  const [published, setPublished] = useState(NO_DEMAND);
  const [demand] = useState(() => new DemandRegistry(setPublished));
  useEffect(() => demand.attach(), [demand]);
  useEffect(() => { demand.retarget(recordsByBody, owner); }, [demand, recordsByBody, owner]);
  const resolved = useMemo(() => resolveTargets(published, recordsByBody, owner), [published, recordsByBody, owner]);
  // A replaced map that admits the same targets keeps the targets it had: nothing downstream is recomputed.
  const [admitted, setAdmitted] = useState(resolved);
  let current = admitted;
  if (!sameTargets(admitted, resolved)) {
    current = resolved;
    setAdmitted(resolved);
  }
  const { targets: admittedTargets, requested } = current;
  const allowed = options.enabled !== false && !!ownerConnectionID && metricIDs.length > 0;
  const enabled = allowed && visible && !options.error && admittedTargets.length > 0;
  const observation = useMetricObservation({ ownerPluginID, ownerConnectionID, resourceKey, bindingID, source,
    targets: admittedTargets, metricIDs, shape: 'current', intervalMs: options.intervalMs ?? 30_000, enabled });
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
  // Plugin, connection, resource type, binding and source. Nothing answered carries across a change of any.
  const scope = useMemo(() => JSON.stringify([owner, bindingID ?? null, source ?? null]), [owner, bindingID, source]);
  const requestKey = useMemo(() => JSON.stringify([scope, selectedKey,
    [...requested].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))]), [scope, selectedKey, requested]);
  // A request is answered once, when its first answer arrives with collection idle, and that answer is
  // kept as the cells it covered until the next request completes. Background refresh and visibility
  // pauses answer nothing new. Other targets or metrics leave the covered cells answered; they do not
  // cover a target or metric the request never included, a recreated resource, or another scope.
  const [answered, setAnswered] = useState<AnsweredRequest | null>(null);
  if (enabled && !isFetching && answered?.key !== requestKey) setAnswered({ key: requestKey, scope, requested, selected });
  const covering = answered?.scope === scope ? answered : null;
  const inputs = useMemo<CellInputs>(() => ({ recordsByBody, requested, metrics, selected, allowed, loading: !!loading, answered: covering, error }),
    [recordsByBody, requested, metrics, selected, allowed, loading, covering, error]);
  // Replace accessors only when an answer they expose can change.
  const tokenFor = useCallback((body: object) => {
    const record = recordsByBody.get(body);
    return record ? tokenOf(record, requested, metrics) : undefined;
  }, [recordsByBody, requested, metrics]);
  const isLoadingFor = useCallback((body: object, metricID: string) => {
    const record = inputs.recordsByBody.get(body);
    return !!record && isAwaiting(inputs, record, sampleOf(inputs, record, metricID) !== undefined, metricID);
  }, [inputs]);
  const isLoading = !error && (!!loading || (allowed && admittedTargets.length > 0 && metrics.size === 0 && !answersAny(covering, requested, selected)));
  return useMemo(() => ({ metrics, register: demand.register, tokenFor, error, isLoading, isLoadingFor, isFetching,
    refresh: observation.refresh }),
  [metrics, demand, tokenFor, error, isLoading, isLoadingFor, isFetching, observation.refresh]);
}
