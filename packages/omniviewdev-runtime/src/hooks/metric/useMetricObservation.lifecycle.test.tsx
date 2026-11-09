import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ResourceMetricTarget, ResourceMetricsCatalog } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import type { MetricsObservationSnapshot, MetricsObservationSpec } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/models';
import { Duration } from '../../bindings/time/models';
import { useMetricObservation } from './useMetricObservation';

const transport = vi.hoisted(() => ({ receivers: [] as Array<(value: MetricsObservationSnapshot) => void>, specs: [] as MetricsObservationSpec[],
  failures: [] as Array<(error: Error) => void> }));
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/servicewrapper', () => ({ GetResourceMetricsCatalog: vi.fn() }));
vi.mock('./observationClient', () => ({ observeMetrics: (spec: MetricsObservationSpec, receive: (value: MetricsObservationSnapshot) => void, fail: (error: Error) => void) => {
  transport.specs.push(spec);
  transport.receivers.push(receive);
  transport.failures.push(fail);
  return { close() {}, refresh: () => Promise.resolve() };
} }));

const target = (name: string, incarnation = 'uid-1'): ResourceMetricTarget => ({
  token: name, route: { connection: 'cluster' }, reference: { incarnation,
    address: { provider: 'kubernetes', authority: 'authority', type: 'k8s:/pods', scope: [{ dimension: 'namespace', value: 'apps' }], id: name } },
}) as ResourceMetricTarget;
const catalog = { source: { plugin_id: 'inventory', connection_id: 'tenant', datasource_uid: '', datasource_kind: '', native: true },
  metrics: [{ id: 'cpu', unit: 'cores' }], max_targets: 256, max_sample_age: 2 * Duration.Minute } as ResourceMetricsCatalog;
function frame(name: string, extra: Partial<MetricsObservationSnapshot> = {}): MetricsObservationSnapshot {
  return { client_token: 'test', generation: 1, sequence: 1, invalidated: false, error: '', fetching: false, catalog,
    domain_start: '2026-11-05T09:00:00Z', domain_end: '2026-11-05T10:00:00Z',
    data: { complete: true, warnings: [], results: [{ resource_token: name, metric_id: 'cpu', status: 'ok', value: 0.25,
      observed_at: '2026-11-05T10:00:00Z', window: 15 * Duration.Second, dimensions: {}, points: [], identity_scope: 'name', message: '' }] },
    ...extra } as MetricsObservationSnapshot;
}
const base = { ownerPluginID: 'kubernetes', ownerConnectionID: 'cluster', resourceKey: 'k8s:/pods', metricIDs: ['cpu'], intervalMs: 0 };
beforeEach(() => { transport.receivers.length = 0; transport.specs.length = 0; transport.failures.length = 0; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T10:00:01Z')); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('removes another Pod and an old incarnation before a replacement response arrives', () => {
  const { result, rerender } = renderHook(({ targets }) => useMetricObservation({ ...base, targets }), { initialProps: { targets: [target('pod-a')] } });
  act(() => transport.receivers[0](frame('pod-a')));
  expect(result.current.results[0].value).toBe(0.25);
  rerender({ targets: [target('pod-b')] });
  expect(result.current.results).toEqual([]);
  expect(result.current.domain).toBeNull();
  act(() => transport.receivers[1](frame('pod-b')));
  expect(result.current.results[0].resourceToken).toBe('pod-b');
  rerender({ targets: [target('pod-b', 'uid-2')] });
  expect(result.current.results).toEqual([]);
  act(() => transport.receivers[0](frame('pod-a', { sequence: 999 })));
  expect(result.current.results).toEqual([]);
});

it('retains compatible displayed data and domain through a nil-data range acknowledgment', () => {
  const { result, rerender } = renderHook(({ startTime }) => useMetricObservation({ ...base, targets: [target('pod-a')], shape: 'range',
    startTime, endTime: '2026-11-05T10:00:00Z', stepMs: 15000 }), { initialProps: { startTime: '2026-11-05T09:00:00Z' } });
  const range = frame('pod-a');
  range.data!.results[0].value = null;
  range.data!.results[0].points = [
    { time: '2026-11-05T09:00:00Z', value: null },
    { time: '2026-11-05T10:00:00Z', value: 0.25 },
  ];
  act(() => transport.receivers[0](range));
  const id = result.current.results[0].id;
  rerender({ startTime: '2026-11-05T08:00:00Z' });
  act(() => transport.receivers[1](frame('pod-a', { data: null, fetching: false, domain_start: null, domain_end: null })));
  expect(result.current.results[0].id).toBe(id);
  expect(result.current.results[0].value).toBeNull();
  expect(result.current.results[0].points).toEqual([
    { timeMs: Date.parse('2026-11-05T09:00:00Z'), value: null },
    { timeMs: Date.parse('2026-11-05T10:00:00Z'), value: 0.25 },
  ]);
  expect(result.current.results[0].freshness).toBe('unknown');
  expect(result.current.domain).toEqual({ startMs: Date.parse('2026-11-05T09:00:00Z'), endMs: Date.parse('2026-11-05T10:00:00Z') });
  expect(result.current.isFetching).toBe(true);
  act(() => transport.receivers[1](frame('pod-a', { data: { complete: true, warnings: [], results: [{ resource_token: 'pod-a', metric_id: 'cpu', status: 'missing', value: null, points: [], dimensions: {}, observed_at: null, window: Duration.$zero, identity_scope: '', message: '' }] } })));
  expect(result.current.results[0].value).toBeNull();
  expect(result.current.results[0].status).toBe('missing');
});

it('delegates relative bounds to the host without a frontend collection timer', () => {
  const { result } = renderHook(() => useMetricObservation({
    ...base, targets: [target('pod-a')], shape: 'range', durationMs: 3600000, stepMs: 15000,
  }));
  expect(transport.specs[0]).toMatchObject({
    duration_ms: 3600000, start_time: '0001-01-01T00:00:00Z', end_time: '0001-01-01T00:00:00Z',
  });
  expect(result.current.domain).toBeNull();
  act(() => vi.advanceTimersByTime(60000));
  expect(transport.specs).toHaveLength(1);
  act(() => transport.receivers[0](frame('pod-a')));
  expect(result.current.domain).toEqual({
    startMs: Date.parse('2026-11-05T09:00:00Z'), endMs: Date.parse('2026-11-05T10:00:00Z'),
  });
});

it('ages actual source samples without fetching or renewing their timestamp', () => {
  const { result } = renderHook(() => useMetricObservation({ ...base, targets: [target('pod-a')] }));
  act(() => transport.receivers[0](frame('pod-a')));
  expect(result.current.results[0].freshness).toBe('fresh');
  act(() => vi.advanceTimersByTime(120_000));
  expect(result.current.results[0].freshness).toBe('delayed');
  expect(result.current.results[0].observedAt).toBe(Date.parse('2026-11-05T10:00:00Z'));
  act(() => transport.receivers[0](frame('pod-a', { sequence: 2 })));
  expect(result.current.results[0].freshness).toBe('delayed');
  expect(result.current.isFetching).toBe(false);
});

it('keeps freshness unknown when source policy or observation time is unknown', () => {
  const { result } = renderHook(() => useMetricObservation({ ...base, targets: [target('pod-a')] }));
  act(() => transport.receivers[0](frame('pod-a', { catalog: { ...catalog, max_sample_age: Duration.$zero } })));
  expect(result.current.results[0].freshness).toBe('unknown');
  act(() => vi.advanceTimersByTime(600_000));
  expect(result.current.results[0].freshness).toBe('unknown');
  const withoutTime = frame('pod-a');
  withoutTime.data!.results[0].observed_at = null;
  act(() => transport.receivers[0](withoutTime));
  expect(result.current.results[0].observedAt).toBeNull();
  expect(result.current.results[0].freshness).toBe('unknown');
});

it('sends explicit generated source and binding without caller query bodies, and clears old source data immediately', () => {
  const source = { plugin_id: 'grafana', connection_id: 'observability', datasource_uid: 'prometheus', datasource_kind: 'prometheus', native: false };
  const { result, rerender } = renderHook(({ bindingID }) => useMetricObservation({
    ...base, targets: [target('pod-a')], bindingID, source,
  }), { initialProps: { bindingID: 'binding-a' } });
  expect(transport.specs[0]).toMatchObject({ binding_id: 'binding-a', source });
  expect(transport.specs[0]).not.toHaveProperty('resource_data');
  expect(transport.specs[0]).not.toHaveProperty('params');
  act(() => transport.receivers[0](frame('pod-a')));
  expect(result.current.results).toHaveLength(1);
  rerender({ bindingID: 'binding-b' });
  expect(result.current.results).toEqual([]);
  expect(result.current.catalog).toBeNull();
});

it('retains same-authority values through transient errors but clears denied snapshots', () => {
  const { result, rerender } = renderHook(({ intervalMs }) => useMetricObservation({
    ...base, intervalMs, targets: [target('pod-a')],
  }), { initialProps: { intervalMs: 0 } });
  act(() => transport.receivers[0](frame('pod-a')));
  const original = result.current.results[0];
  rerender({ intervalMs: 30000 });
  act(() => transport.receivers[1](frame('pod-a', {
    data: null, catalog: null, error: 'Provider temporarily unavailable',
  })));
  expect(result.current.results[0]).toEqual(original);
  expect(result.current.catalog).toEqual(catalog);
  expect(result.current.error?.message).toBe('Provider temporarily unavailable');
  act(() => transport.receivers[1](frame('pod-a', {
    data: null, catalog: null, invalidated: true, error: 'Permission denied',
  })));
  expect(result.current.results).toEqual([]);
  expect(result.current.domain).toBeNull();
  expect(result.current.catalog).toBeNull();
  expect(result.current.error?.message).toBe('Permission denied');
});

it('clears retained values when inherited routing resolves to a different source', () => {
  const { result } = renderHook(() => useMetricObservation({ ...base, targets: [target('pod-a')] }));
  act(() => transport.receivers[0](frame('pod-a')));
  expect(result.current.results).toHaveLength(1);
  const external = { ...catalog, source: { plugin_id: 'grafana', connection_id: 'monitor',
    datasource_uid: 'prometheus', datasource_kind: 'prometheus', native: false } } as ResourceMetricsCatalog;
  act(() => transport.receivers[0](frame('pod-a', { data: null, catalog: external, fetching: true })));
  expect(result.current.results).toEqual([]);
  expect(result.current.catalog).toEqual(external);
  expect(result.current.domain).toBeNull();
});

it('does not retain old samples after an unacknowledged reentry setup failure', () => {
  const { result, rerender } = renderHook(({ intervalMs }) => useMetricObservation({
    ...base, intervalMs, targets: [target('pod-a')],
  }), { initialProps: { intervalMs: 0 } });
  act(() => transport.receivers[0](frame('pod-a')));
  expect(result.current.results).toHaveLength(1);
  rerender({ intervalMs: 30000 });
  act(() => transport.failures[1](new Error('Session admission failed')));
  expect(result.current.results).toEqual([]);
  expect(result.current.catalog).toBeNull();
  expect(result.current.error?.message).toBe('Session admission failed');
});

const hour = ['2026-11-05T09:00:00Z', '2026-11-05T09:30:00Z', '2026-11-05T10:00:00Z'];
const rangeFrame = (name: string, times: readonly string[], extra: Partial<MetricsObservationSnapshot> = {}, complete = true) => frame(name, {
  data: { complete, warnings: [], results: [{ resource_token: name, metric_id: 'cpu', status: 'ok', value: null,
    points: times.map(time => ({ time, value: 0.25 })), observed_at: null, window: Duration.$zero, dimensions: {}, identity_scope: 'name', message: '' }] },
  ...extra,
});
const emptyFrame = (name: string, extra: Partial<MetricsObservationSnapshot> = {}) => frame(name, { data: { complete: false, warnings: [], results: [] }, ...extra });

it('shows an incomplete range as partial until its final frame, retaining data and domain until a new-domain frame arrives', () => {
  const { result, rerender } = renderHook(({ startTime }) => useMetricObservation({ ...base, targets: [target('pod-a')], shape: 'range',
    startTime, endTime: '2026-11-05T10:00:00Z', stepMs: 15000 }), { initialProps: { startTime: '2026-11-05T09:00:00Z' } });
  act(() => transport.receivers[0](rangeFrame('pod-a', hour)));
  const id = result.current.results[0].id;
  expect(result.current.isPartial).toBe(false);
  rerender({ startTime: '2026-11-05T08:00:00Z' });
  act(() => transport.receivers[1](frame('pod-a', { data: null, fetching: true, domain_start: null, domain_end: null })));
  expect(result.current.isPartial).toBe(false);
  expect(result.current.domain).toEqual({ startMs: Date.parse('2026-11-05T09:00:00Z'), endMs: Date.parse('2026-11-05T10:00:00Z') });
  const domain = { domain_start: '2026-11-05T08:00:00Z', domain_end: '2026-11-05T10:00:00Z' };
  act(() => transport.receivers[1](rangeFrame('pod-a', hour, { fetching: true, ...domain }, false)));
  expect(result.current).toMatchObject({ isPartial: true, isFetching: true, isLoading: false,
    domain: { startMs: Date.parse('2026-11-05T08:00:00Z'), endMs: Date.parse('2026-11-05T10:00:00Z') } });
  expect(result.current.results[0].id).toBe(id);
  expect(result.current.results[0].points.map(point => point.timeMs)).toEqual(hour.map(time => Date.parse(time)));
  act(() => transport.receivers[1](rangeFrame('pod-a', ['2026-11-05T08:00:00Z', ...hour], { fetching: false, ...domain })));
  expect(result.current).toMatchObject({ isPartial: false, isFetching: false });
  expect(result.current.results[0].points).toHaveLength(4);
});

it('keeps a final incomplete range partial without reporting it as loading', () => {
  const { result } = renderHook(() => useMetricObservation({ ...base, targets: [target('pod-a')], shape: 'range',
    startTime: '2026-11-05T09:00:00Z', endTime: '2026-11-05T10:00:00Z', stepMs: 15000 }));
  act(() => transport.receivers[0](rangeFrame('pod-a', hour)));
  act(() => transport.receivers[0](rangeFrame('pod-a', hour.slice(2), { fetching: false }, false)));
  expect(result.current).toMatchObject({ isPartial: true, isFetching: false, isLoading: false });
  expect(result.current.results[0].points.map(point => point.timeMs)).toEqual(hour.slice(2).map(time => Date.parse(time)));
});

it('treats an incomplete frame without results as loading and shows it only for the request it answers', () => {
  const { result, rerender } = renderHook(({ targets }) => useMetricObservation({ ...base, targets, shape: 'range',
    startTime: '2026-11-05T09:00:00Z', endTime: '2026-11-05T10:00:00Z', stepMs: 15000 }), { initialProps: { targets: [target('pod-a')] } });
  act(() => transport.receivers[0](emptyFrame('pod-a', { fetching: true })));
  expect(result.current.results).toEqual([]);
  expect(result.current).toMatchObject({ isPartial: true, isLoading: true, isFetching: true,
    domain: { startMs: Date.parse('2026-11-05T09:00:00Z'), endMs: Date.parse('2026-11-05T10:00:00Z') } });
  act(() => transport.receivers[0](emptyFrame('pod-a', { fetching: false })));
  expect(result.current).toMatchObject({ isPartial: true, isLoading: false, isFetching: false });
  rerender({ targets: [target('pod-b')] });
  expect(result.current.domain).toBeNull();
  expect(result.current.isPartial).toBe(false);
});

it('keeps the resolution of displayed history until a frame for the new request arrives', () => {
  const { result, rerender } = renderHook(({ stepMs }) => useMetricObservation({ ...base, targets: [target('pod-a')], shape: 'range',
    startTime: '2026-11-05T09:00:00Z', endTime: '2026-11-05T10:00:00Z', stepMs }), { initialProps: { stepMs: 86_400 } });
  expect(result.current.stepMs).toBeNull();
  act(() => transport.receivers[0](rangeFrame('pod-a', hour)));
  expect(result.current.stepMs).toBe(86_400);
  rerender({ stepMs: 15_000 });
  act(() => transport.receivers[1](frame('pod-a', { data: null, fetching: true })));
  expect(result.current.stepMs).toBe(86_400);
  act(() => transport.receivers[1](rangeFrame('pod-a', hour)));
  expect(result.current.stepMs).toBe(15_000);
});

it('does not remove loaded history while a refresh collects omitted intervals', () => {
  const { result } = renderHook(() => useMetricObservation({ ...base, targets: [target('pod-a')], shape: 'range',
    durationMs: 3600000, stepMs: 15000 }));
  act(() => transport.receivers[0](rangeFrame('pod-a', hour)));
  const oldDomain = result.current.domain;
  const domain = { domain_start: '2026-11-05T09:00:15Z', domain_end: '2026-11-05T10:00:15Z' };
  act(() => transport.receivers[0](rangeFrame('pod-a', hour.slice(2), { fetching: true, ...domain }, false)));
  expect(result.current.results[0].points.map(point => point.timeMs)).toEqual(hour.map(time => Date.parse(time)));
  expect(result.current.domain).toEqual(oldDomain);
  expect(result.current.isFetching).toBe(true);
  act(() => transport.receivers[0](rangeFrame('pod-a', hour.slice(1), { fetching: true, ...domain }, false)));
  expect(result.current.results[0].points.map(point => point.timeMs)).toEqual(hour.slice(1).map(time => Date.parse(time)));
  expect(result.current).toMatchObject({ isPartial: true,
    domain: { startMs: Date.parse(domain.domain_start), endMs: Date.parse(domain.domain_end) } });
  act(() => transport.receivers[0](rangeFrame('pod-a', hour.slice(2), { fetching: true, ...domain }, false)));
  expect(result.current.results[0].points.map(point => point.timeMs)).toEqual(hour.slice(1).map(time => Date.parse(time)));
  act(() => transport.receivers[0](rangeFrame('pod-a', [...hour.slice(1), domain.domain_end], { fetching: false, ...domain })));
  expect(result.current.results[0].points.map(point => point.timeMs)).toEqual([...hour.slice(1), domain.domain_end].map(time => Date.parse(time)));
  expect(result.current).toMatchObject({ isPartial: false, isFetching: false });
});

const fixedHour = { startTime: '2026-11-05T09:00:00Z', endTime: '2026-11-05T10:00:00Z' };

it('shows a new Pod\'s partial frame through a step change when only another Pod\'s history is retained', () => {
  const { result, rerender } = renderHook(({ targets, stepMs }) => useMetricObservation({ ...base, targets, shape: 'range', ...fixedHour, stepMs }),
    { initialProps: { targets: [target('pod-a')], stepMs: 15000 } });
  act(() => transport.receivers[0](rangeFrame('pod-a', hour)));
  rerender({ targets: [target('pod-b')], stepMs: 30000 });
  act(() => transport.receivers[1](frame('pod-b', { data: null, fetching: true, domain_start: null, domain_end: null })));
  expect(result.current.results).toEqual([]);
  expect(result.current).toMatchObject({ isLoading: true, domain: null, stepMs: null });
  act(() => transport.receivers[1](rangeFrame('pod-b', hour.slice(1), { fetching: true }, false)));
  expect(result.current.results.map(item => item.resourceToken)).toEqual(['pod-b']);
  expect(result.current.results[0].points.map(point => point.timeMs)).toEqual(hour.slice(1).map(time => Date.parse(time)));
  expect(result.current).toMatchObject({ isPartial: true, isFetching: true, isLoading: false, stepMs: 30000,
    domain: { startMs: Date.parse('2026-11-05T09:00:00Z'), endMs: Date.parse('2026-11-05T10:00:00Z') } });
  // The new Pod's own samples are selected history from now on.
  act(() => transport.receivers[1](rangeFrame('pod-b', hour.slice(2), { fetching: true }, false)));
  expect(result.current.results[0].points).toHaveLength(2);
  act(() => transport.receivers[1](rangeFrame('pod-b', hour, { fetching: false })));
  expect(result.current).toMatchObject({ isPartial: false, isFetching: false, stepMs: 30000 });
  expect(result.current.results[0].points).toHaveLength(3);
});

it('keeps selected history on its original step while a partial frame on a new step collects', () => {
  const { result, rerender } = renderHook(({ stepMs }) => useMetricObservation({ ...base, targets: [target('pod-a')], shape: 'range', ...fixedHour, stepMs }),
    { initialProps: { stepMs: 15000 } });
  act(() => transport.receivers[0](rangeFrame('pod-a', hour)));
  rerender({ stepMs: 30000 });
  act(() => transport.receivers[1](rangeFrame('pod-a', hour, { fetching: true }, false)));
  expect(result.current).toMatchObject({ isPartial: false, isFetching: true, stepMs: 15000 });
  expect(result.current.results[0].points).toHaveLength(3);
  act(() => transport.receivers[1](rangeFrame('pod-a', hour.slice(1), { fetching: false })));
  expect(result.current).toMatchObject({ isPartial: false, isFetching: false, stepMs: 30000 });
  expect(result.current.results[0].points).toHaveLength(2);
});

it('does not hold a recreated Pod to its previous incarnation\'s history through a step change', () => {
  const { result, rerender } = renderHook(({ targets, stepMs }) => useMetricObservation({ ...base, targets, shape: 'range', ...fixedHour, stepMs }),
    { initialProps: { targets: [target('pod-a')], stepMs: 15000 } });
  act(() => transport.receivers[0](rangeFrame('pod-a', hour)));
  rerender({ targets: [target('pod-a', 'uid-2')], stepMs: 30000 });
  act(() => transport.receivers[1](rangeFrame('pod-a', hour.slice(2), { fetching: true }, false)));
  expect(result.current.results.map(item => [item.resourceReference.incarnation, item.points.length])).toEqual([['uid-2', 1]]);
  expect(result.current).toMatchObject({ isPartial: true, isFetching: true, stepMs: 30000 });
});

const nativeLane = { plugin_id: 'inventory', connection_id: 'tenant', datasource_uid: '', datasource_kind: '', native: true };
const externalLane = (datasource_uid: string) => ({ plugin_id: 'grafana', connection_id: 'observability', datasource_uid, datasource_kind: 'prometheus', native: false });
// The catalog default stays native while one metric's own lane resolves to another provider.
const mixedCatalog = (provider: string) => ({ ...catalog, source: nativeLane, metrics: [
  { id: 'cpu', unit: 'cores', source: nativeLane }, { id: 'memory', unit: 'bytes', source: externalLane(provider) }] }) as ResourceMetricsCatalog;
const mixedFrame = (provider: string, series: Record<string, readonly string[]>, extra: Partial<MetricsObservationSnapshot> = {}, complete = true) => frame('pod-a', {
  catalog: mixedCatalog(provider),
  data: { complete, warnings: [], results: Object.entries(series).map(([metric_id, times]) => ({ resource_token: 'pod-a', metric_id, status: 'ok', value: null,
    points: times.map(time => ({ time, value: 0.25 })), observed_at: null, window: Duration.$zero, dimensions: {}, identity_scope: 'name', message: '' })) },
  ...extra,
});

it('shows the replacement lease\'s partial frame instead of retaining history from a metric\'s previous source', () => {
  const { result, rerender } = renderHook(({ intervalMs }) => useMetricObservation({ ...base, intervalMs, metricIDs: ['memory'],
    targets: [target('pod-a')], shape: 'range', ...fixedHour, stepMs: 15000 }), { initialProps: { intervalMs: 0 } });
  act(() => transport.receivers[0](mixedFrame('prom-a', { memory: hour })));
  expect(result.current.results[0].source).toEqual(externalLane('prom-a'));
  rerender({ intervalMs: 30000 });
  act(() => transport.receivers[1](mixedFrame('prom-b', { memory: hour.slice(2) }, { fetching: true }, false)));
  expect(result.current.results).toHaveLength(1);
  expect(result.current.results[0].source).toEqual(externalLane('prom-b'));
  expect(result.current.results[0].points.map(point => point.timeMs)).toEqual([Date.parse(hour[2])]);
  expect(result.current).toMatchObject({ isPartial: true, isFetching: true, isLoading: false });
});

it('drops only the history of the metric whose own source changed and keeps the rest at its original domain and step', () => {
  const { result, rerender } = renderHook(({ intervalMs }) => useMetricObservation({ ...base, intervalMs, metricIDs: ['cpu', 'memory'],
    targets: [target('pod-a')], shape: 'range', ...fixedHour, stepMs: 15000 }), { initialProps: { intervalMs: 0 } });
  const shown = () => result.current.results.map(item => [item.metricID, item.source?.datasource_uid, item.points.length]);
  act(() => transport.receivers[0](mixedFrame('prom-a', { cpu: hour, memory: hour })));
  const domain = result.current.domain;
  expect(shown()).toEqual([['cpu', '', 3], ['memory', 'prom-a', 3]]);
  rerender({ intervalMs: 30000 });
  // Unchanged sources keep their history while a partial frame omits it.
  act(() => transport.receivers[1](mixedFrame('prom-a', { memory: hour.slice(2) }, { fetching: true }, false)));
  expect(shown()).toEqual([['cpu', '', 3], ['memory', 'prom-a', 3]]);
  // The acknowledgement already names the new provider; the old provider's history leaves.
  act(() => transport.receivers[1](frame('pod-a', { data: null, fetching: true, catalog: mixedCatalog('prom-b'), domain_start: null, domain_end: null })));
  expect(shown()).toEqual([['cpu', '', 3]]);
  expect(result.current.catalog).toEqual(mixedCatalog('prom-b'));
  expect(result.current).toMatchObject({ domain, stepMs: 15000, isLoading: false });
  // A partial frame that lacks cpu neither replaces cpu's history nor brings the old memory back.
  act(() => transport.receivers[1](mixedFrame('prom-b', { memory: hour.slice(2) }, { fetching: true }, false)));
  expect(shown()).toEqual([['cpu', '', 3]]);
  expect(result.current).toMatchObject({ domain, stepMs: 15000, isPartial: false });
  act(() => transport.receivers[1](mixedFrame('prom-b', { cpu: hour, memory: hour.slice(2) }, { fetching: true }, false)));
  expect(shown()).toEqual([['cpu', '', 3], ['memory', 'prom-b', 1]]);
  expect(result.current.isPartial).toBe(true);
  act(() => transport.receivers[1](mixedFrame('prom-b', { cpu: hour, memory: hour })));
  expect(shown()).toEqual([['cpu', '', 3], ['memory', 'prom-b', 3]]);
  expect(result.current).toMatchObject({ isPartial: false, isFetching: false });
});
