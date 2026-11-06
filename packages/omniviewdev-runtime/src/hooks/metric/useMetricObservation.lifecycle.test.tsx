import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ResourceMetricTarget, ResourceMetricsCatalog } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import type { MetricsObservationSnapshot } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/models';
import { Duration } from '../../bindings/time/models';
import { useMetricObservation } from './useMetricObservation';

const transport = vi.hoisted(() => ({ receivers: [] as Array<(value: MetricsObservationSnapshot) => void> }));
vi.mock('./observationClient', () => ({ observeMetrics: (_spec: unknown, receive: (value: MetricsObservationSnapshot) => void) => {
  transport.receivers.push(receive);
  return { close() {}, refresh: () => Promise.resolve() };
} }));

const target = (name: string, incarnation = 'uid-1'): ResourceMetricTarget => ({
  token: name, route: { connection: 'cluster' }, reference: { incarnation,
    address: { provider: 'kubernetes', authority: 'authority', type: 'k8s:/pods', scope: [{ dimension: 'namespace', value: 'apps' }], id: name } },
}) as ResourceMetricTarget;
const catalog = { source: { plugin_id: 'kubernetes', connection_id: 'cluster', datasource_uid: '', datasource_kind: 'metrics-server' },
  metrics: [{ id: 'cpu', unit: 'cores' }], max_targets: 256, max_sample_age: 2 * Duration.Minute } as ResourceMetricsCatalog;
function frame(name: string, extra: Partial<MetricsObservationSnapshot> = {}): MetricsObservationSnapshot {
  return { client_token: 'test', generation: 1, sequence: 1, invalidated: false, error: '', fetching: false, catalog,
    domain_start: '2026-11-05T09:00:00Z', domain_end: '2026-11-05T10:00:00Z',
    data: { complete: true, warnings: [], results: [{ resource_token: name, metric_id: 'cpu', status: 'ok', value: 0.25,
      observed_at: '2026-11-05T10:00:00Z', window: 15 * Duration.Second, dimensions: {}, points: [], identity_scope: 'name', message: '' }] },
    ...extra } as MetricsObservationSnapshot;
}
const base = { ownerPluginID: 'kubernetes', ownerConnectionID: 'cluster', resourceKey: 'k8s:/pods', metricIDs: ['cpu'], intervalMs: 0 };
beforeEach(() => { transport.receivers.length = 0; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-05T10:00:01Z')); });
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
