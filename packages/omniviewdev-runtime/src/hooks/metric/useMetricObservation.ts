import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MetricUnit, NumericPoint } from '@omniviewdev/base-ui/metrics';
import type { ResourceMetricTarget, ResourceMetricsCatalog } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import type { MetricsObservationSnapshot, MetricsObservationSpec } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/models';
import { observeMetrics, type MetricObservationLease } from './observationClient';
export type { ResourceMetricTarget } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';

/** Targets come from admitted resource-v2 observations, never synthesized bodies. */
export interface UseMetricObservationOptions {
  ownerPluginID: string;
  ownerConnectionID: string;
  resourceKey: string;
  targets: readonly ResourceMetricTarget[];
  metricIDs: readonly string[];
  shape?: 'current' | 'range';
  startTime?: string;
  endTime?: string;
  stepMs?: number;
  /** Host refresh cadence. Zero means initial/manual collection only. */
  intervalMs?: number;
  enabled?: boolean;
}
export interface PreparedMetricResult {
  readonly id: string;
  readonly resourceIdentity: string;
  readonly resourceToken: string;
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
const unitFor = (unit?: string): MetricUnit | null => unit === 'cores' ? { kind: 'cpu', base: 'cores' } : unit === 'bytes' ? { kind: 'bytes', display: 'binary' } : null;

function targetIdentity(target: ResourceMetricTarget): string {
  const address = target.reference.address;
  return JSON.stringify([target.route.connection, address.provider, address.authority, address.type,
    [...(address.scope ?? [])].map(scope => [scope.dimension, scope.value]).sort(([a], [b]) => a.localeCompare(b)),
    address.id, target.reference.incarnation ?? null]);
}
function sourceIdentity(catalog: ResourceMetricsCatalog | null | undefined): string {
  const source = catalog?.source;
  return JSON.stringify(source ? [source.plugin_id, source.connection_id, source.datasource_uid, source.datasource_kind] : null);
}

/**
 * Prepare one delivered snapshot using the targets to which its tokens belong.
 * Series IDs use canonical resource incarnation, source and dimensions, not caller
 * tokens or result order. Unknown targets are not delivered. Values keep physical
 * catalog units; wire timestamps become epoch milliseconds and nulls remain gaps.
 */
export function prepareMetricResults(snapshot: MetricsObservationSnapshot | null, catalog: ResourceMetricsCatalog | null, targets: readonly ResourceMetricTarget[]): readonly PreparedMetricResult[] {
  if (!snapshot?.data || snapshot.invalidated) return EMPTY;
  const identities = new Map(targets.map(target => [target.token, targetIdentity(target)]));
  const descriptors = new Map(catalog?.metrics?.map(metric => [metric.id, metric]));
  const source = sourceIdentity(catalog);
  const results: PreparedMetricResult[] = [];
  for (const result of snapshot.data.results ?? []) {
    const resourceIdentity = identities.get(result.resource_token);
    if (!resourceIdentity) continue;
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
      id: JSON.stringify([source, resourceIdentity, result.metric_id, dimensionEntries]),
      resourceIdentity, resourceToken: result.resource_token, metricID: result.metric_id, status: result.status,
      value: result.status === 'ok' ? finite(result.value) : null,
      points, observedAt, windowMs: result.window / 1_000_000,
      freshUntilMs, freshness: 'unknown',
      dimensions, message: result.message, unit: unitFor(descriptors.get(result.metric_id)?.unit),
      identityScope: result.identity_scope,
    }));
  }
  return Object.freeze(results);
}

interface DisplayedSnapshot {
  snapshot: MetricsObservationSnapshot;
  targets: readonly ResourceMetricTarget[];
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
 * Observe finite resource metrics. The host alone schedules network work.
 * Compatible range/step changes retain one displayed snapshot and its original
 * domain. Resource incarnations and metric selection are intersected synchronously:
 * a newly opened Pod never displays another Pod's retained sample. Source changes,
 * denied/invalidated delivery, and failed observation setup clear incompatible data.
 *
 * @example
 * useMetricObservation({ ownerPluginID: 'kubernetes', ownerConnectionID: connectionID,
 *   resourceKey: 'k8s:/pods', targets: observedTargets,
 *   metricIDs: ['kubernetes.pod.cpu.usage'], intervalMs: 30000 });
 */
export function useMetricObservation(options: UseMetricObservationOptions) {
  // Canonical sets prevent presentation reordering from reopening observations.
  const identity = JSON.stringify({ ...options,
    targets: [...options.targets].sort((a, b) => targetIdentity(a).localeCompare(targetIdentity(b)) || a.token.localeCompare(b.token)),
    metricIDs: [...new Set(options.metricIDs)].sort(),
  });
  const request = useMemo(() => JSON.parse(identity) as UseMetricObservationOptions, [identity]);
  const authority = JSON.stringify([request.ownerPluginID, request.ownerConnectionID, request.resourceKey]);
  const lease = useRef<MetricObservationLease | null>(null);
  const [state, setState] = useState<ObservationState>({ authority: '', displayed: null, catalog: null, requestIdentity: '', settled: false, fetching: false, error: null });
  const [clockMs, setClockMs] = useState(Date.now);
  useEffect(() => {
    const input = JSON.parse(identity) as UseMetricObservationOptions;
    const scope = JSON.stringify([input.ownerPluginID, input.ownerConnectionID, input.resourceKey]);
    if (input.enabled === false || !input.ownerConnectionID || !input.targets.length || !input.metricIDs.length) return;
    let retired = false;
    const fail = (error: Error) => {
      if (!retired) setState({ authority: scope, displayed: null, catalog: null, requestIdentity: identity, settled: true, fetching: false, error });
    };
    const spec: MetricsObservationSpec = {
      owner_plugin_id: input.ownerPluginID, owner_connection_id: input.ownerConnectionID,
      resource_key: input.resourceKey, targets: [...input.targets], metric_ids: [...input.metricIDs],
      shape: input.shape ?? 'current', start_time: input.startTime ?? '0001-01-01T00:00:00Z',
      end_time: input.endTime ?? '0001-01-01T00:00:00Z', step_ms: input.stepMs ?? 0, interval_ms: input.intervalMs ?? 0,
    };
    let currentLease: MetricObservationLease | null = null;
    try {
      currentLease = observeMetrics(spec, snapshot => {
        if (retired) return;
        const receivedAtMs = Date.now();
        setState(previous => {
          const compatible = previous.authority === scope && (!snapshot.catalog || !previous.catalog || sourceIdentity(snapshot.catalog) === sourceIdentity(previous.catalog));
          let displayed = compatible ? previous.displayed : null;
          if (snapshot.invalidated) displayed = null;
          else if (snapshot.data != null) displayed = { snapshot, targets: input.targets, receivedAtMs };
          return { authority: scope, displayed, catalog: snapshot.catalog ?? (compatible ? previous.catalog : null), requestIdentity: identity,
            settled: snapshot.data != null || !!snapshot.error || snapshot.invalidated,
            fetching: snapshot.fetching, error: snapshot.error ? new Error(snapshot.error) : null };
        });
      }, fail);
      lease.current = currentLease;
    } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    return () => { retired = true; currentLease?.close(); if (lease.current === currentLease) lease.current = null; };
  }, [identity]);
  const current = state.authority === authority ? state : null;
  const displayed = current?.displayed ?? null;
  const prepared = useMemo(() => prepareMetricResults(displayed?.snapshot ?? null, displayed?.snapshot.catalog ?? null, displayed?.targets ?? []), [displayed]);
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
      if (token === result.resourceToken && result.freshness === freshness) selected.push(result);
      else { changed = true; selected.push(Object.freeze({ ...result, resourceToken: token, freshness })); }
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
  return { results, catalog: current?.catalog ?? null,
    domain: displayed && results.length ? { startMs: epoch(displayed.snapshot.domain_start), endMs: epoch(displayed.snapshot.domain_end) } : null,
    isLoading: active && !results.length && !settled && !error,
    isFetching: fetching, error, refresh };
}
