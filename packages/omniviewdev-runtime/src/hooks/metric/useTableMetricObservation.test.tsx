import { StrictMode, useEffect } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HostRecord } from '../../resource/v2/host';
import type { MetricsObservationSnapshot, MetricsObservationSpec } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/models';
import type { ResourceMetricsCatalog } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import { useTableMetricObservation, type UseTableMetricObservationOptions } from './useTableMetricObservation';

const transport = vi.hoisted(() => ({ leases: [] as Array<{
  spec: MetricsObservationSpec;
  receive: (snapshot: MetricsObservationSnapshot) => void;
  fail: (error: Error) => void;
  close: () => void;
}> }));
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/servicewrapper', () => ({ GetResourceMetricsCatalog: vi.fn() }));
vi.mock('./observationClient', () => ({ observeMetrics: (spec: MetricsObservationSpec,
  receive: (snapshot: MetricsObservationSnapshot) => void, fail: (error: Error) => void) => {
  const close = vi.fn();
  transport.leases.push({ spec, receive, fail, close });
  return { close, refresh: async () => {} };
} }));

function member(key: string, incarnation = 'incarnation-1'): HostRecord {
  return {
    key, targetId: 'host-target', addressKey: key, route: { connection: 'tenant' },
    record: {
      reference: { incarnation, address: { provider: 'inventory', authority: 'admitted-authority', type: 'machines', id: key, scope: [] } },
      body: { kind: 'map', value: {} }, coverage: { kind: 'complete', paths: [] },
      representation: { id: 'json', revision: '1', schema: { state: 'absent' } },
    },
  };
}
const first = Object.freeze({ name: 'presentation-only-name' });
const second = Object.freeze({ name: 'another-presentation-name' });
const firstRecord = member('host-first');
const secondRecord = member('host-second');
const recordsByBody = new WeakMap<object, HostRecord>([[first, firstRecord], [second, secondRecord]]);
const base: UseTableMetricObservationOptions = {
  ownerPluginID: 'inventory', ownerConnectionID: 'tenant', resourceKey: 'machines',
  recordsByBody, metricIDs: ['cpu', 'memory'], intervalMs: 0,
};
const catalog = { source: { plugin_id: 'monitor', connection_id: 'metrics', datasource_uid: 'source', datasource_kind: 'prometheus', native: false },
  metrics: [{ id: 'cpu', unit: 'cores' }, { id: 'memory', unit: 'bytes' }], max_targets: 256, max_sample_age: 0 } as ResourceMetricsCatalog;
function frame(token: string, status = 'ok', fetching = false): MetricsObservationSnapshot {
  return { client_token: 'client', generation: 1, sequence: 1, invalidated: false, error: '', fetching, catalog,
    domain_start: null, domain_end: null, data: { complete: true, warnings: [], results: [
      { resource_token: token, metric_id: 'cpu', status, value: status === 'ok' ? 0 : null, observed_at: null, window: 0, dimensions: {}, points: [], identity_scope: 'incarnation', message: '' },
      { resource_token: token, metric_id: 'memory', status, value: status === 'ok' ? 2048 : null, observed_at: null, window: 0, dimensions: {}, points: [], identity_scope: 'incarnation', message: '' },
    ] } } as MetricsObservationSnapshot;
}
beforeEach(() => {
  vi.useFakeTimers();
  transport.leases.length = 0;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('batches cells by admitted membership and keeps a target until its last idempotent cleanup', () => {
  const { result } = renderHook(() => useTableMetricObservation(base));
  let releaseCPU!: () => void;
  let releaseMemory!: () => void;
  act(() => {
    releaseCPU = result.current.register(first);
    releaseMemory = result.current.register(first);
    const releaseTransient = result.current.register(second);
    result.current.register({ name: 'not-admitted' });
    releaseTransient();
    vi.advanceTimersByTime(119);
  });
  expect(transport.leases).toHaveLength(0);
  act(() => { vi.advanceTimersByTime(1); });
  expect(transport.leases).toHaveLength(1);
  const lease = transport.leases[0];
  expect(lease.spec.targets).toEqual([{ token: firstRecord.key, reference: firstRecord.record.reference, route: firstRecord.route }]);
  act(() => lease.receive(frame(firstRecord.key)));
  expect(result.current.metrics.get(firstRecord.key)?.get('cpu')?.value).toBe(0);
  expect(result.current.metrics.get(firstRecord.key)?.get('memory')?.value).toBe(2048);
  expect(result.current.tokenFor(first)).toBe(firstRecord.key);
  expect(result.current.tokenFor(second)).toBe(secondRecord.key);
  act(() => { releaseCPU(); releaseCPU(); vi.advanceTimersByTime(120); });
  expect(lease.close).not.toHaveBeenCalled();
  expect(result.current.metrics.get(firstRecord.key)?.get('cpu')?.value).toBe(0);
  act(() => { releaseMemory(); vi.advanceTimersByTime(120); });
  expect(lease.close).toHaveBeenCalledTimes(1);
  expect(result.current.metrics.size).toBe(0);
});

it('keeps the current observation through scroll churn and discards retired-row delivery after the quiet period', () => {
  const { result } = renderHook(() => useTableMetricObservation(base));
  let release!: () => void;
  act(() => { release = result.current.register(first); vi.advanceTimersByTime(120); });
  const previous = transport.leases[0];
  act(() => previous.receive(frame(firstRecord.key)));
  act(() => { release(); result.current.register(second); vi.advanceTimersByTime(119); });
  expect(previous.close).not.toHaveBeenCalled();
  expect(result.current.metrics.get(firstRecord.key)?.get('memory')?.value).toBe(2048);
  act(() => { vi.advanceTimersByTime(1); });
  expect(previous.close).toHaveBeenCalledTimes(1);
  expect(result.current.metrics.has(firstRecord.key)).toBe(false);
  expect(result.current.isLoading).toBe(true);
  act(() => previous.receive(frame(firstRecord.key)));
  expect(result.current.metrics.has(firstRecord.key)).toBe(false);
  act(() => transport.leases[1].receive(frame(secondRecord.key)));
  expect(result.current.metrics.get(secondRecord.key)?.get('memory')?.value).toBe(2048);
  expect(result.current.isLoading).toBe(false);
});

it('starts hidden without collecting and keeps unavailable cells settled through background refresh and visibility pauses', () => {
  let visibility: DocumentVisibilityState = 'hidden';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const { result } = renderHook(() => useTableMetricObservation(base));
  act(() => { result.current.register(first); vi.advanceTimersByTime(120); });
  expect(transport.leases).toHaveLength(0);
  act(() => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  const lease = transport.leases[0];
  expect(result.current.isLoading).toBe(true);
  act(() => lease.receive(frame(firstRecord.key, 'failed')));
  expect(result.current.metrics.get(firstRecord.key)?.get('cpu')).toMatchObject({ status: 'failed', value: null });
  expect(result.current.isLoading).toBe(false);
  act(() => lease.receive({ ...frame(firstRecord.key), data: null, fetching: true }));
  expect(result.current.isFetching).toBe(true);
  expect(result.current.isLoading).toBe(false);
  act(() => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  expect(lease.close).toHaveBeenCalledTimes(1);
  expect(result.current.isFetching).toBe(false);
  expect(result.current.metrics.get(firstRecord.key)?.get('cpu')?.status).toBe('failed');
  act(() => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  act(() => transport.leases[1].receive(frame(firstRecord.key)));
  expect(result.current.metrics.get(firstRecord.key)?.get('cpu')?.value).toBe(0);
  expect(result.current.isLoading).toBe(false);
});

it('pauses disabled and unselected demand while preserving selected samples across a pause', () => {
  const { result, rerender } = renderHook((options: UseTableMetricObservationOptions) => useTableMetricObservation(options), { initialProps: base });
  act(() => { result.current.register(first); vi.advanceTimersByTime(120); });
  act(() => transport.leases[0].receive(frame(firstRecord.key)));
  rerender({ ...base, enabled: false });
  expect(transport.leases[0].close).toHaveBeenCalledTimes(1);
  expect(result.current.isLoading).toBe(false);
  expect(result.current.metrics.get(firstRecord.key)?.get('memory')?.value).toBe(2048);
  rerender({ ...base, metricIDs: [] });
  expect(result.current.metrics.size).toBe(0);
  expect(transport.leases).toHaveLength(1);
  rerender({ ...base, metricIDs: ['memory'] });
  act(() => transport.leases[1].receive(frame(firstRecord.key)));
  expect(result.current.metrics.get(firstRecord.key)?.has('cpu')).toBe(false);
  expect(result.current.metrics.get(firstRecord.key)?.get('memory')?.value).toBe(2048);
});

it('clears old source and incarnation samples and lets upstream failures block collection without perpetual loading', () => {
  const pending: UseTableMetricObservationOptions = { ...base, enabled: false, loading: true };
  const { result, rerender } = renderHook((options: UseTableMetricObservationOptions) => useTableMetricObservation(options), { initialProps: pending });
  act(() => { result.current.register(first); vi.advanceTimersByTime(120); });
  expect(result.current.isLoading).toBe(true);
  expect(transport.leases).toHaveLength(0);
  rerender(base);
  act(() => transport.leases[0].receive(frame(firstRecord.key)));
  const source = { ...catalog.source, datasource_uid: 'other-source' };
  rerender({ ...base, source });
  expect(result.current.metrics.size).toBe(0);
  act(() => transport.leases[1].receive({ ...frame(firstRecord.key), catalog: { ...catalog, source } }));
  const replacement = new WeakMap([[first, member(firstRecord.key, 'incarnation-2')]]);
  rerender({ ...base, source, recordsByBody: replacement });
  expect(result.current.metrics.size).toBe(0);
  act(() => transport.leases[2].fail(new Error('Metrics endpoint unavailable')));
  expect(result.current.isLoading).toBe(false);
  expect(result.current.error).toMatchObject({ message: 'Metrics endpoint unavailable' });
  const error = new Error('Source discovery failed');
  rerender({ ...base, loading: true, error });
  expect(result.current.error).toBe(error);
  expect(result.current.isLoading).toBe(false);
  expect(transport.leases).toHaveLength(3);
});

it('survives StrictMode effect replay and cancels pending demand on unmount', () => {
  const hook = renderHook(() => {
    const observation = useTableMetricObservation(base);
    useEffect(() => observation.register(first), [observation.register]);
    return observation;
  }, { wrapper: ({ children }) => <StrictMode>{children}</StrictMode> });
  act(() => { vi.advanceTimersByTime(120); });
  expect(transport.leases).toHaveLength(1);
  act(() => transport.leases[0].receive(frame(firstRecord.key)));
  expect(hook.result.current.metrics.get(firstRecord.key)?.get('cpu')?.value).toBe(0);
  act(() => { hook.result.current.register(second); vi.advanceTimersByTime(119); });
  hook.unmount();
  act(() => { vi.advanceTimersByTime(1_000); });
  expect(transport.leases).toHaveLength(1);
  expect(transport.leases[0].close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
