import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GetResourceMetricsCatalog } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/servicewrapper';
import type { MetricUnit, NumericPoint } from '@omniviewdev/base-ui/metrics';
import type { MetricSourceRef, ResourceMetricTarget, ResourceMetricsCatalog } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import type { MetricsObservationSnapshot, MetricsObservationSpec } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/models';
import { observeMetrics, type MetricObservationLease } from './observationClient';
import { targetIdentity } from './targetIdentity';
import type { ResourceReference, AccessRoute, ScopeEntry } from '../../resource/v2/domain';
export type { ResourceMetricTarget } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
export type { ResourceMetricsCatalog } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';

/** Targets come from admitted resource-v2 observations, never synthesized bodies. */
export interface UseMetricObservationOptions {
  ownerPluginID: string;
  ownerConnectionID: string;
  resourceKey: string;
  /** Explicit routing is separate from presentation preferences. */
  bindingID?: MetricsObservationSpec['binding_id'];
  source?: MetricsObservationSpec['source'];
  targets: readonly ResourceMetricTarget[];
  metricIDs: readonly string[];
  shape?: 'current' | 'range';
  startTime?: string;
  endTime?: string;
  /** Host resolves a moving relative range; mutually exclusive with fixed bounds. */
  durationMs?: number;
  stepMs?: number;
  /** Host refresh cadence. Zero means initial/manual collection only. */
  intervalMs?: number;
  enabled?: boolean;
}
/** Discover admitted source metadata without opening a second metric query path. */
export function useMetricCatalog(options: Pick<UseMetricObservationOptions, 'ownerPluginID' | 'ownerConnectionID' | 'resourceKey' | 'bindingID' | 'source' | 'enabled'>) {
  const request = {
    owner_plugin_id: options.ownerPluginID, owner_connection_id: options.ownerConnectionID,
    resource_key: options.resourceKey, binding_id: options.bindingID ?? '', source: options.source ?? null,
  };
  return useQuery({
    queryKey: ['metric', 'catalog', request],
    queryFn: () => GetResourceMetricsCatalog(request),
    enabled: options.enabled !== false && !!options.ownerConnectionID,
  });
}
type DeepReadonly<T> = T extends readonly (infer Item)[] ? readonly DeepReadonly<Item>[]
  : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> } : T;

export interface PreparedMetricResult {
  readonly id: string;
  readonly resourceIdentity: string;
  readonly resourceToken: string;
  /** Copied admitted identity; series dimensions never supply resource identity. */
  readonly resourceReference: DeepReadonly<ResourceReference>;
  readonly resourceRoute: Readonly<AccessRoute>;
  readonly metricID: string;
  readonly status: string;
  readonly value: number | null;
  readonly points: readonly NumericPoint[];
  readonly observedAt: number | null;
  readonly windowMs: number;
  readonly freshUntilMs: number | null;
  readonly freshness: 'fresh' | 'delayed' | 'unknown';
  readonly dimensions: Readonly<Record<string, string>>;
  readonly message: string;
  readonly unit: MetricUnit | null;
  readonly source: Readonly<MetricSourceRef> | null;
  /** Name-scoped samples cannot prove the sampled resource's UID. */
  readonly identityScope: string;
}
const EMPTY: readonly PreparedMetricResult[] = Object.freeze([]);
const epoch = (value: unknown): number | null => {
  if (typeof value !== 'string') return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
};
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const units: Readonly<Record<string, MetricUnit>> = {
  cores: { kind: 'cpu', base: 'cores' }, bytes: { kind: 'bytes', display: 'binary' },
  seconds: { kind: 'duration', base: 'seconds' }, count: { kind: 'count' },
  ratio: { kind: 'ratio' }, percent: { kind: 'percent' },
  bytes_per_second: { kind: 'rate', numerator: 'bytes' }, count_per_second: { kind: 'rate', numerator: 'count' },
};

/** Copied admitted identity of one target, built once per target object rather than once per delivered snapshot. */
interface AdmittedTarget {
  readonly identity: string;
  readonly reference: PreparedMetricResult['resourceReference'];
  readonly route: PreparedMetricResult['resourceRoute'];
}
const admissions = new WeakMap<ResourceMetricTarget, AdmittedTarget>();
/** Cache a frozen copy of the target's reference and route; callers must keep target objects immutable. */
function admittedTarget(target: ResourceMetricTarget): AdmittedTarget {
  let admitted = admissions.get(target);
  if (!admitted) {
    const reference: ResourceReference = {
      incarnation: target.reference.incarnation ?? undefined,
      address: {
        provider: target.reference.address.provider,
        authority: target.reference.address.authority,
        type: target.reference.address.type,
        id: target.reference.address.id,
        scope: Object.freeze((target.reference.address.scope ?? []).map((scope: ScopeEntry) =>
          Object.freeze({ dimension: scope.dimension, value: scope.value }))),
      },
    };
    const route: AccessRoute = { connection: target.route.connection };
    admitted = {
      identity: targetIdentity(target),
      reference: Object.freeze({ incarnation: reference.incarnation, address: Object.freeze(reference.address) }),
      route: Object.freeze(route),
    };
    admissions.set(target, admitted);
  }
  return admitted;
}
function sourceKey(source: MetricSourceRef | null | undefined): string {
  return JSON.stringify(source ? [source.plugin_id, source.connection_id, source.datasource_uid, source.datasource_kind, source.native === true] : null);
}
/** The source each described metric resolves to: its own lane, else the catalog default. */
function laneSources(catalog: ResourceMetricsCatalog | null | undefined): Map<string, string> {
  return new Map((catalog?.metrics ?? []).map(metric => [metric.id, sourceKey(metric.source ?? catalog?.source)] as const));
}
/**
 * An incomplete frame can precede its first result. It still answers a request that
 * shares one of its targets and metrics; a result-less frame for any other request
 * is not shown.
 */
function sharesRequest(displayed: DisplayedSnapshot, targets: readonly ResourceMetricTarget[], metricIDs: readonly string[]): boolean {
  const held = new Set(displayed.targets.map(targetIdentity));
  return targets.some(target => held.has(targetIdentity(target))) && metricIDs.some(id => displayed.metricIDs.includes(id));
}

/**
 * Prepare one delivered snapshot using the targets to which its tokens belong.
 * Series IDs use canonical resource incarnation, source and dimensions, not caller
 * tokens or result order. Unknown targets are not delivered. Values keep physical
 * catalog units; wire timestamps become epoch milliseconds and nulls remain gaps.
 */
export function prepareMetricResults(snapshot: MetricsObservationSnapshot | null, catalog: ResourceMetricsCatalog | null, targets: readonly ResourceMetricTarget[]): readonly PreparedMetricResult[] {
  if (!snapshot?.data || snapshot.invalidated) return EMPTY;
  const admitted = new Map(targets.map(target => [target.token, admittedTarget(target)] as const));
  const descriptors = new Map(catalog?.metrics?.map(metric => [metric.id, metric]));
  const results: PreparedMetricResult[] = [];
  for (const result of snapshot.data.results ?? []) {
    const target = admitted.get(result.resource_token);
    if (!target) continue;
    const descriptor = descriptors.get(result.metric_id);
    const resultSource = result.source ?? descriptor?.source ?? catalog?.source ?? null;
    const source = sourceKey(resultSource);
    const dimensionEntries = Object.entries(result.dimensions ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .sort(([a], [b]) => a.localeCompare(b));
    const dimensions = Object.freeze(Object.fromEntries(dimensionEntries));
    const observedAt = epoch(result.observed_at);
    const maxAgeMs = (catalog?.max_sample_age ?? 0) / 1_000_000;
    const freshUntilMs = result.status === 'ok' && result.value != null && !(result.points?.length) && observedAt !== null && maxAgeMs > 0
      ? observedAt + maxAgeMs : null;
    const points = Object.freeze((result.points ?? []).flatMap(point => {
      const timeMs = epoch(point.time);
      return timeMs === null ? [] : [Object.freeze({ timeMs, value: finite(point.value) })];
    }));
    results.push(Object.freeze({
      id: JSON.stringify([source, target.identity, result.metric_id, dimensionEntries]),
      resourceIdentity: target.identity, resourceToken: result.resource_token, metricID: result.metric_id, status: result.status,
      resourceReference: target.reference,
      resourceRoute: target.route,
      value: result.status === 'ok' ? finite(result.value) : null,
      points, observedAt, windowMs: result.window / 1_000_000,
      freshUntilMs, freshness: 'unknown',
      dimensions, message: result.message, unit: units[descriptor?.unit ?? ''] ?? null,
      identityScope: result.identity_scope,
      source: resultSource ? Object.freeze({ ...resultSource }) : null,
    }));
  }
  return Object.freeze(results);
}

function sameDimensions(a: PreparedMetricResult['dimensions'], b: PreparedMetricResult['dimensions']): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}
function samePoints(a: readonly NumericPoint[], b: readonly NumericPoint[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index].timeMs !== b[index].timeMs || a[index].value !== b[index].value) return false;
  }
  return true;
}
function sameReference(a: PreparedMetricResult['resourceReference'], b: PreparedMetricResult['resourceReference']): boolean {
  if (a === b) return true;
  return a.incarnation === b.incarnation && a.address.provider === b.address.provider
    && a.address.authority === b.address.authority && a.address.type === b.address.type && a.address.id === b.address.id
    && a.address.scope.length === b.address.scope.length
    && a.address.scope.every((scope, index) => scope.dimension === b.address.scope[index].dimension && scope.value === b.address.scope[index].value);
}
/** Every field a reader can observe. Freshness is evaluated later, so it is equal by construction. */
function sameResult(a: PreparedMetricResult, b: PreparedMetricResult): boolean {
  return a.resourceIdentity === b.resourceIdentity && a.resourceToken === b.resourceToken && a.metricID === b.metricID
    && a.status === b.status && a.value === b.value && a.observedAt === b.observedAt && a.windowMs === b.windowMs
    && a.freshUntilMs === b.freshUntilMs && a.message === b.message && a.identityScope === b.identityScope
    && a.unit === b.unit && a.resourceRoute.connection === b.resourceRoute.connection
    && sameReference(a.resourceReference, b.resourceReference)
    && (a.source === b.source || (a.source !== null && b.source !== null && a.source.plugin_id === b.source.plugin_id
      && a.source.connection_id === b.source.connection_id && a.source.datasource_uid === b.source.datasource_uid
      && a.source.datasource_kind === b.source.datasource_kind && a.source.native === b.source.native))
    && sameDimensions(a.dimensions, b.dimensions) && samePoints(a.points, b.points);
}
/**
 * A newer snapshot repeats most results unchanged. A result equal to the one displayed for the same
 * series keeps that object, and a snapshot that changed nothing keeps the whole array, so readers can
 * tell which samples actually moved. Nothing is ever kept that differs in a field a reader can observe.
 */
function reusePrepared(previous: readonly PreparedMetricResult[] | undefined, next: readonly PreparedMetricResult[]): readonly PreparedMetricResult[] {
  if (!previous?.length || !next.length) return next;
  const held = new Map<string, PreparedMetricResult>();
  for (const result of previous) if (!held.has(result.id)) held.set(result.id, result);
  let identical = previous.length === next.length;
  const merged = next.map((result, index) => {
    const prior = held.get(result.id);
    const chosen = prior !== undefined && sameResult(prior, result) ? prior : result;
    if (chosen !== previous[index]) identical = false;
    return chosen;
  });
  return identical ? previous : Object.freeze(merged);
}
const evaluations = new WeakMap<PreparedMetricResult, PreparedMetricResult>();
/** A result as presented under the current clock and request token. An unchanged presentation keeps one identity. */
function evaluate(result: PreparedMetricResult, token: string, freshness: PreparedMetricResult['freshness']): PreparedMetricResult {
  if (token === result.resourceToken && freshness === result.freshness) return result;
  const held = evaluations.get(result);
  if (held?.resourceToken === token && held.freshness === freshness) return held;
  const evaluated = Object.freeze({ ...result, resourceToken: token, freshness });
  evaluations.set(result, evaluated);
  return evaluated;
}

interface DisplayedSnapshot {
  snapshot: MetricsObservationSnapshot;
  prepared: readonly PreparedMetricResult[];
  targets: readonly ResourceMetricTarget[];
  /** Selection and resolution of the request that produced the snapshot stay with its data. */
  metricIDs: readonly string[];
  stepMs: number | null;
  receivedAtMs: number;
}
interface ObservationState {
  authority: string;
  displayed: DisplayedSnapshot | null;
  catalog: ResourceMetricsCatalog | null;
  requestIdentity: string;
  settled: boolean;
  fetching: boolean;
  error: Error | null;
}

/**
 * A metric whose own lane source changed (a mixed catalog's per-metric override, which
 * the catalog's default source does not show) belongs to the old provider. Its retained
 * history leaves before a partial frame is weighed against what stays on display. The
 * raw snapshot stays whole; `prepared` is the exposed view. A data frame that carried no
 * catalog is judged against the last catalog the observation held (`observed`).
 */
function withoutChangedSources(displayed: DisplayedSnapshot | null, observed: ResourceMetricsCatalog | null, catalog: ResourceMetricsCatalog | null): DisplayedSnapshot | null {
  const heldCatalog = displayed?.snapshot.catalog ?? observed;
  if (!displayed || !catalog || !heldCatalog) return displayed;
  const held = laneSources(heldCatalog), next = laneSources(catalog);
  // A result without a descriptor resolves to its catalog's default source.
  const heldDefault = sourceKey(heldCatalog.source), nextDefault = sourceKey(catalog.source);
  let prepared: PreparedMetricResult[] | null = null;
  for (let index = 0; index < displayed.prepared.length; index++) {
    const result = displayed.prepared[index];
    if ((held.get(result.metricID) ?? heldDefault) !== (next.get(result.metricID) ?? nextDefault)) {
      prepared ??= displayed.prepared.slice(0, index);
    } else {
      prepared?.push(result);
    }
  }
  if (!prepared) return displayed;
  return prepared.length ? { ...displayed, prepared: Object.freeze(prepared) } : null;
}

/**
 * Pending intervals must not erase samples already visible in the requested window.
 * Only selected history obliges a frame: another Pod's or metric's samples are not the
 * request's to keep. A frame on a new step cannot keep samples of the old one, so
 * selected history on the old step holds the display until a complete frame arrives.
 */
function preservesDisplayedRange(previous: DisplayedSnapshot, incoming: readonly PreparedMetricResult[], snapshot: MetricsObservationSnapshot, input: UseMetricObservationOptions): boolean {
  const start = epoch(snapshot.domain_start), end = epoch(snapshot.domain_end);
  const resampled = previous.stepMs !== (input.stepMs ?? null);
  const targets = new Set(input.targets.map(targetIdentity));
  const metrics = new Set(input.metricIDs);
  const candidates = new Map(incoming.map(result => [result.id, result]));
  for (const held of previous.prepared) {
    if (!targets.has(held.resourceIdentity) || !metrics.has(held.metricID)) continue;
    const next = candidates.get(held.id);
    let cursor = 0;
    for (const point of held.points) {
      if (point.value === null || (start !== null && end !== null && (point.timeMs < start || point.timeMs > end))) continue;
      if (resampled || start === null || end === null || !next) return false;
      while (cursor < next.points.length && next.points[cursor].timeMs < point.timeMs) cursor++;
      if (next.points[cursor]?.timeMs !== point.timeMs) return false;
    }
  }
  return true;
}

/**
 * Observe finite resource metrics. The host alone schedules network work.
 * Compatible range/step changes retain one displayed snapshot and its original
 * domain and step. Resource incarnations and metric selection are intersected
 * synchronously: a newly opened Pod never displays another Pod's retained sample.
 * Source changes (the catalog default or one metric's own lane), denied/invalidated
 * delivery, and failed observation setup clear incompatible data.
 *
 * A host that is still collecting may publish incomplete frames (`isPartial`) that
 * omit pairs it has not reached: an absent result is pending, never missing. Such a
 * frame replaces the displayed snapshot unless it would erase selected samples that
 * are still inside its window; history of other Pods, other metrics or a replaced
 * source never obliges it. While such a frame holds no result yet, `isLoading` stays
 * true and `domain` and `stepMs` already describe it. `isFetching` alone says whether
 * collection continues, so a final incomplete frame stays partial without loading.
 *
 * A host that repeats the failure it already reported keeps one `Error` object while the
 * owner, binding and source stay the same, so a reader that compares it can tell a repeated
 * failure from a new one. A frame without a failure clears `error`; a different message, or
 * a change of owner, binding or source, gives a new `Error`.
 *
 * @example
 * useMetricObservation({ ownerPluginID: 'kubernetes', ownerConnectionID: connectionID,
 *   resourceKey: 'k8s:/pods', targets: observedTargets,
 *   metricIDs: ['kubernetes.pod.cpu.usage'], intervalMs: 30000 });
 */
export function useMetricObservation(options: UseMetricObservationOptions) {
  const { ownerPluginID, ownerConnectionID, resourceKey, bindingID, source, targets, metricIDs, shape, startTime, endTime, durationMs, stepMs, intervalMs, enabled } = options;
  const metricKey = JSON.stringify([...new Set(metricIDs)].sort());
  // Canonical sets prevent presentation reordering from reopening observations. The serialization
  // is rebuilt only when an input changes: a table renders far more often than its targets change.
  const identity = useMemo(() => JSON.stringify({ ownerPluginID, ownerConnectionID, resourceKey, bindingID, source,
    targets: targets.map(target => [targetIdentity(target), target] as const)
      .sort(([a, left], [b, right]) => a.localeCompare(b) || left.token.localeCompare(right.token))
      .map(([, target]) => target),
    metricIDs: JSON.parse(metricKey) as string[], shape, startTime, endTime, durationMs, stepMs, intervalMs, enabled,
  }), [ownerPluginID, ownerConnectionID, resourceKey, bindingID, source, targets, metricKey, shape, startTime, endTime, durationMs, stepMs, intervalMs, enabled]);
  const request = useMemo(() => JSON.parse(identity) as UseMetricObservationOptions, [identity]);
  const authority = useMemo(() => JSON.stringify([request.ownerPluginID, request.ownerConnectionID, request.resourceKey, request.bindingID, request.source]), [request]);
  const lease = useRef<MetricObservationLease | null>(null);
  const [state, setState] = useState<ObservationState>({ authority: '', displayed: null, catalog: null, requestIdentity: '', settled: false, fetching: false, error: null });
  const [clockMs, setClockMs] = useState(Date.now);
  useEffect(() => {
    const input = request;
    const scope = JSON.stringify([input.ownerPluginID, input.ownerConnectionID, input.resourceKey, input.bindingID, input.source]);
    if (input.enabled === false || !input.ownerConnectionID || !input.targets.length || !input.metricIDs.length) return;
    let retired = false;
    const fail = (error: Error) => {
      if (!retired) setState({ authority: scope, displayed: null, catalog: null, requestIdentity: identity, settled: true, fetching: false, error });
    };
    const spec: MetricsObservationSpec = {
      owner_plugin_id: input.ownerPluginID, owner_connection_id: input.ownerConnectionID,
      resource_key: input.resourceKey, targets: [...input.targets], metric_ids: [...input.metricIDs],
      binding_id: input.bindingID ?? '', source: input.source ?? null,
      shape: input.shape ?? 'current', start_time: input.startTime ?? '0001-01-01T00:00:00Z',
      end_time: input.endTime ?? '0001-01-01T00:00:00Z', duration_ms: input.durationMs ?? 0,
      step_ms: input.stepMs ?? 0, interval_ms: input.intervalMs ?? 0,
    };
    let currentLease: MetricObservationLease | null = null;
    try {
      currentLease = observeMetrics(spec, snapshot => {
        if (retired) return;
        const receivedAtMs = Date.now();
        setState(previous => {
          const compatible = previous.authority === scope;
          let displayed = compatible ? withoutChangedSources(previous.displayed, previous.catalog, snapshot.catalog) : null;
          if (snapshot.invalidated) displayed = null;
          else if (snapshot.data != null) {
            const prepared = reusePrepared(displayed?.prepared, prepareMetricResults(snapshot, snapshot.catalog, input.targets));
            if (!displayed || input.shape !== 'range' || !snapshot.fetching || snapshot.data.complete !== false ||
                preservesDisplayedRange(displayed, prepared, snapshot, input)) {
              displayed = { snapshot, prepared, targets: input.targets, metricIDs: input.metricIDs, stepMs: input.stepMs ?? null, receivedAtMs };
            }
          }
          // A frame that repeats the failure already reported under this owner, binding and source keeps its Error,
          // so readers can tell a repeated failure from a new one. A frame without a failure clears it.
          const error = !snapshot.error ? null : compatible && previous.error?.message === snapshot.error ? previous.error : new Error(snapshot.error);
          return { authority: scope, displayed, catalog: snapshot.invalidated ? null : snapshot.catalog ?? (compatible ? previous.catalog : null), requestIdentity: identity,
            settled: snapshot.data != null || !!snapshot.error || snapshot.invalidated,
            fetching: snapshot.fetching, error };
        });
      }, fail);
      lease.current = currentLease;
    } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    return () => { retired = true; currentLease?.close(); if (lease.current === currentLease) lease.current = null; };
  }, [identity]);
  const current = state.authority === authority ? state : null;
  const displayed = current?.displayed ?? null;
  const prepared = displayed?.prepared ?? EMPTY;
  useEffect(() => {
    // Presentation expiry only. No network fetch, retry or cache deadline lives here.
    const now = Date.now();
    const evaluatedAt = Math.max(clockMs, displayed?.receivedAtMs ?? clockMs);
    let next = Infinity;
    for (const result of prepared) {
      if (result.freshUntilMs !== null && result.freshUntilMs > evaluatedAt) next = Math.min(next, result.freshUntilMs);
    }
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setClockMs(Date.now()), Math.min(2_147_483_647, Math.max(1, next - now + 1)));
    return () => clearTimeout(timer);
  }, [prepared, clockMs, displayed?.receivedAtMs]);
  const results = useMemo(() => {
    const tokens = new Map(request.targets.map(target => [targetIdentity(target), target.token]));
    const metrics = new Set(request.metricIDs);
    const evaluatedAt = Math.max(clockMs, displayed?.receivedAtMs ?? clockMs);
    let changed = false;
    const selected: PreparedMetricResult[] = [];
    for (const result of prepared) {
      const token = tokens.get(result.resourceIdentity);
      if (token === undefined || !metrics.has(result.metricID)) { changed = true; continue; }
      const freshness = result.freshUntilMs === null ? 'unknown' : evaluatedAt >= result.freshUntilMs ? 'delayed' : 'fresh';
      const evaluated = evaluate(result, token, freshness);
      if (evaluated !== result) changed = true;
      selected.push(evaluated);
    }
    return changed ? Object.freeze(selected) : prepared;
  }, [prepared, request, clockMs, displayed?.receivedAtMs]);
  const refresh = useCallback(async () => {
    const requestedLease = lease.current;
    try { await requestedLease?.refresh(); }
    catch (error) {
      if (lease.current === requestedLease) setState(previous => ({ ...previous, error: error instanceof Error ? error : new Error(String(error)) }));
    }
  }, []);
  const active = request.enabled !== false && !!request.ownerConnectionID && request.targets.length > 0 && request.metricIDs.length > 0;
  const settled = current?.requestIdentity === identity && current.settled;
  const error = current?.requestIdentity === identity ? current.error : null;
  const fetching = active && (!settled || !!current?.fetching);
  // Data, domain and step travel together. An incomplete frame can precede its first result and still owns the view.
  const owned = displayed && (results.length > 0 || (displayed.snapshot.data?.complete === false && sharesRequest(displayed, request.targets, request.metricIDs))) ? displayed : null;
  const partial = owned?.snapshot.data?.complete === false;
  return { results, catalog: current?.catalog ?? null,
    domain: owned ? { startMs: epoch(owned.snapshot.domain_start), endMs: epoch(owned.snapshot.domain_end) } : null,
    stepMs: owned?.stepMs ?? null,
    isPartial: partial,
    isLoading: active && !results.length && !error && (!settled || (partial && fetching)),
    isFetching: fetching, error, refresh };
}
