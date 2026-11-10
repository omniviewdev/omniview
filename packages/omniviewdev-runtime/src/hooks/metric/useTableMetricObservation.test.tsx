import { StrictMode, createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { act, cleanup, render, renderHook, type RenderResult } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HostRecord } from '../../resource/v2/host';
import type { MetricsObservationSnapshot, MetricsObservationSpec } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/models';
import type { ResourceMetricsCatalog } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import { useTableMetricCell, useTableMetricObservation, type TableMetricCells, type TableMetricObservation, type UseTableMetricObservationOptions } from './useTableMetricObservation';

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
/** A complete answer holding both metrics for every token; `[]` answers without any sample. */
function frame(token: string | readonly string[], status = 'ok', fetching = false): MetricsObservationSnapshot {
  const tokens = typeof token === 'string' ? [token] : token;
  return { client_token: 'client', generation: 1, sequence: 1, invalidated: false, error: '', fetching, catalog,
    domain_start: null, domain_end: null, data: { complete: true, warnings: [], results: tokens.flatMap(resource_token => [
      { resource_token, metric_id: 'cpu', status, value: status === 'ok' ? 0 : null, observed_at: null, window: 0, dimensions: {}, points: [], identity_scope: 'incarnation', message: '' },
      { resource_token, metric_id: 'memory', status, value: status === 'ok' ? 2048 : null, observed_at: null, window: 0, dimensions: {}, points: [], identity_scope: 'incarnation', message: '' },
    ]) } } as MetricsObservationSnapshot;
}
const renderTable = (initialProps: UseTableMetricObservationOptions = base) => renderHook(
  (options: UseTableMetricObservationOptions) => useTableMetricObservation(options), { initialProps });
/** Mounts one cell, lets its demand publish and answers the request it opened. */
function publishAnswered(result: { current: TableMetricObservation }, body: object, token: string | readonly string[]) {
  let release!: () => void;
  act(() => { release = result.current.register(body); vi.advanceTimersByTime(120); });
  const lease = transport.leases[transport.leases.length - 1];
  act(() => lease.receive(frame(token)));
  return { lease, release };
}

// Cells shaped like a real consumer: they register in an effect and read state while rendering.
const Observation = createContext<TableMetricObservation | null>(null);
interface Row { id: string; body: object }
const firstRow: Row = { id: 'first', body: first };
const secondRow: Row = { id: 'second', body: second };
function Cell({ row, metricID }: { row: Row; metricID: string }) {
  const observation = useContext(Observation)!;
  const { register } = observation;
  useEffect(() => register(row.body), [register, row.body]);
  const token = observation.tokenFor(row.body);
  const sample = token ? observation.metrics.get(token)?.get(metricID) : undefined;
  return <output data-cell={`${row.id}:${metricID}`}>
    {sample ? sample.status : observation.isLoadingFor(row.body, metricID) ? 'loading' : 'unavailable'}
  </output>;
}
function Table({ options, rows }: { options: UseTableMetricObservationOptions; rows: readonly Row[] }) {
  const observation = useTableMetricObservation(options);
  return <Observation.Provider value={observation}>
    {rows.flatMap(row => ['cpu', 'memory'].map(metricID => <Cell key={`${row.id}:${metricID}`} row={row} metricID={metricID} />))}
  </Observation.Provider>;
}
const read = (view: RenderResult, row: string, metric = 'cpu') => view.container.querySelector(`[data-cell="${row}:${metric}"]`)?.textContent;

/** One cell read both ways: through the table-wide accessors and through its own subscription. */
function PairedCell({ row, metricID }: { row: Row; metricID: string }) {
  const observation = useContext(Observation)!;
  const { register } = observation;
  useEffect(() => register(row.body), [register, row.body]);
  const token = observation.tokenFor(row.body);
  const sample = token ? observation.metrics.get(token)?.get(metricID) : undefined;
  const own = useTableMetricCell(observation.cells, row.body, metricID);
  return <output data-cell={`${row.id}:${metricID}`} data-own={own.sample ? own.sample.status : own.isLoading ? 'loading' : 'unavailable'}
    data-error={own.error instanceof Error ? own.error.message : ''}>
    {sample ? sample.status : observation.isLoadingFor(row.body, metricID) ? 'loading' : 'unavailable'}
  </output>;
}
function PairedTable({ options, rows }: { options: UseTableMetricObservationOptions; rows: readonly Row[] }) {
  const observation = useTableMetricObservation(options);
  return <Observation.Provider value={observation}>
    <output data-table={observation.isLoading ? 'loading' : 'idle'} />
    {rows.flatMap(row => ['cpu', 'memory'].map(metricID => <PairedCell key={`${row.id}:${metricID}`} row={row} metricID={metricID} />))}
  </Observation.Provider>;
}
/** What a paired cell shows. Fails unless the table-wide accessors and the cell's own subscription agree. */
function shown(view: RenderResult, row: string, metric = 'cpu') {
  const cell = view.container.querySelector(`[data-cell="${row}:${metric}"]`);
  expect(cell?.getAttribute('data-own')).toBe(cell?.textContent);
  return cell?.textContent;
}
const failureOf = (view: RenderResult, row: string, metric = 'cpu') => view.container.querySelector(`[data-cell="${row}:${metric}"]`)?.getAttribute('data-error');
const tableOf = (view: RenderResult) => view.container.querySelector('[data-table]')?.getAttribute('data-table');

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

it('publishes continuous demand churn no later than the maximum wait, then restarts the window', () => {
  const { result } = renderTable();
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  // Every change lands inside the previous change's quiet period, so a pure debounce would never publish.
  act(() => { releaseFirst = result.current.register(first); });
  act(() => { vi.advanceTimersByTime(100); releaseSecond = result.current.register(second); });
  act(() => { vi.advanceTimersByTime(100); releaseFirst(); });
  act(() => { vi.advanceTimersByTime(49); });
  expect(transport.leases).toHaveLength(0);
  act(() => { vi.advanceTimersByTime(1); });
  expect(transport.leases).toHaveLength(1);
  expect(transport.leases[0].spec.targets.map(target => target.token)).toEqual([secondRecord.key]);
  expect(vi.getTimerCount()).toBe(0);
  // The maximum wait counts from the next unpublished change, not from the previous publication.
  act(() => { result.current.register(first); });
  act(() => { vi.advanceTimersByTime(100); releaseSecond(); });
  act(() => { vi.advanceTimersByTime(100); result.current.register(second); });
  act(() => { vi.advanceTimersByTime(49); });
  expect(transport.leases).toHaveLength(1);
  act(() => { vi.advanceTimersByTime(1); });
  expect(transport.leases).toHaveLength(2);
  expect(transport.leases[1].spec.targets.map(target => target.token).sort()).toEqual([firstRecord.key, secondRecord.key]);
});

it('keeps published demand and its samples while a replaced map and replaced bodies wait for publication', () => {
  const replacement = Object.freeze({ name: 'replacement-body' });
  const { result, rerender } = renderTable();
  const { lease, release } = publishAnswered(result, first, firstRecord.key);
  // The table decodes a new body for the same admitted record, swaps its map, and the cell re-registers.
  rerender({ ...base, recordsByBody: new WeakMap([[replacement, member(firstRecord.key)]]) });
  let releaseReplacement!: () => void;
  act(() => { release(); releaseReplacement = result.current.register(replacement); });
  expect(lease.close).not.toHaveBeenCalled();
  expect(result.current.metrics.get(firstRecord.key)?.get('cpu')?.value).toBe(0);
  expect(result.current.tokenFor(replacement)).toBe(firstRecord.key);
  expect(result.current.isLoadingFor(replacement, 'cpu')).toBe(false);
  expect(result.current.isLoading).toBe(false);
  act(() => { vi.advanceTimersByTime(119); });
  expect(lease.close).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(1); });
  expect(transport.leases).toHaveLength(1);
  expect(lease.close).not.toHaveBeenCalled();
  expect(result.current.metrics.get(firstRecord.key)?.get('memory')?.value).toBe(2048);
  // Demand now belongs to the replacement body alone.
  act(() => { releaseReplacement(); vi.advanceTimersByTime(120); });
  expect(lease.close).toHaveBeenCalledTimes(1);
  expect(result.current.metrics.size).toBe(0);
});

it('does not republish or reopen when the table swaps in an equal map', () => {
  const { result, rerender } = renderTable();
  const { lease } = publishAnswered(result, first, firstRecord.key);
  rerender({ ...base, recordsByBody: new WeakMap<object, HostRecord>([[first, member(firstRecord.key)], [second, secondRecord]]) });
  expect(vi.getTimerCount()).toBe(0);
  expect(lease.close).not.toHaveBeenCalled();
  expect(transport.leases).toHaveLength(1);
  expect(result.current.metrics.get(firstRecord.key)?.get('cpu')?.value).toBe(0);
});

it('never answers a recreated resource with the previous incarnation\'s sample while old demand is retained', () => {
  const recreated = Object.freeze({ name: 'recreated-body' });
  const { result, rerender } = renderTable();
  const { lease, release } = publishAnswered(result, first, firstRecord.key);
  // Same host token, new incarnation: the sample the retained demand holds belongs to the resource that was deleted.
  rerender({ ...base, recordsByBody: new WeakMap([[recreated, member(firstRecord.key, 'incarnation-2')]]) });
  act(() => { release(); result.current.register(recreated); });
  expect(lease.close).not.toHaveBeenCalled();
  expect(result.current.tokenFor(recreated)).toBeUndefined();
  expect(result.current.isLoadingFor(recreated, 'cpu')).toBe(true);
  act(() => { vi.advanceTimersByTime(120); });
  expect(lease.close).toHaveBeenCalledTimes(1);
  expect(transport.leases[1].spec.targets[0].reference.incarnation).toBe('incarnation-2');
  expect(result.current.metrics.size).toBe(0);
  expect(result.current.tokenFor(recreated)).toBe(firstRecord.key);
  expect(result.current.isLoadingFor(recreated, 'cpu')).toBe(true);
  act(() => transport.leases[1].receive(frame(firstRecord.key)));
  expect(result.current.isLoadingFor(recreated, 'cpu')).toBe(false);
  expect(result.current.metrics.get(firstRecord.key)?.get('cpu')?.value).toBe(0);
});

it('never sends retained demand under another connection', () => {
  const other = Object.freeze({ name: 'other-connection-body' });
  const { result, rerender } = renderTable();
  const { lease, release } = publishAnswered(result, first, firstRecord.key);
  rerender({ ...base, ownerConnectionID: 'other-tenant', recordsByBody: new WeakMap([[other, member('host-other')]]) });
  expect(lease.close).toHaveBeenCalledTimes(1);
  expect(transport.leases).toHaveLength(1);
  expect(result.current.metrics.size).toBe(0);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  expect(result.current.isLoadingFor(other, 'cpu')).toBe(true);
  act(() => { release(); result.current.register(other); vi.advanceTimersByTime(120); });
  expect(transport.leases).toHaveLength(2);
  expect(transport.leases[1].spec).toMatchObject({ owner_connection_id: 'other-tenant', targets: [{ token: 'host-other' }] });
});

it('reopens retained demand under a new source without showing the old source\'s samples', () => {
  const replacement = Object.freeze({ name: 'replacement-body' });
  const source = { ...catalog.source, datasource_uid: 'other-source' };
  const { result, rerender } = renderTable();
  const { lease } = publishAnswered(result, first, firstRecord.key);
  rerender({ ...base, source, recordsByBody: new WeakMap([[replacement, member(firstRecord.key)]]) });
  expect(lease.close).toHaveBeenCalledTimes(1);
  expect(transport.leases).toHaveLength(2);
  expect(transport.leases[1].spec.source).toEqual(source);
  expect(transport.leases[1].spec.targets.map(target => target.token)).toEqual([firstRecord.key]);
  expect(result.current.metrics.size).toBe(0);
  expect(result.current.isLoadingFor(replacement, 'cpu')).toBe(true);
  act(() => transport.leases[1].receive({ ...frame(firstRecord.key), catalog: { ...catalog, source } }));
  expect(result.current.isLoadingFor(replacement, 'cpu')).toBe(false);
  expect(result.current.metrics.get(firstRecord.key)?.get('cpu')?.value).toBe(0);
});

it('starts hidden without collecting and keeps unavailable cells settled through background refresh and visibility pauses', () => {
  let visibility: DocumentVisibilityState = 'hidden';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  const { result } = renderHook(() => useTableMetricObservation(base));
  act(() => { result.current.register(first); vi.advanceTimersByTime(120); });
  expect(transport.leases).toHaveLength(0);
  // Paused before its first answer, a cell is pending rather than unavailable.
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(true);
  expect(result.current.isLoading).toBe(true);
  act(() => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  const lease = transport.leases[0];
  expect(result.current.isLoading).toBe(true);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(true);
  act(() => lease.receive(frame(firstRecord.key, 'failed')));
  expect(result.current.metrics.get(firstRecord.key)?.get('cpu')).toMatchObject({ status: 'failed', value: null });
  expect(result.current.isLoading).toBe(false);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  act(() => lease.receive({ ...frame(firstRecord.key), data: null, fetching: true }));
  expect(result.current.isFetching).toBe(true);
  expect(result.current.isLoading).toBe(false);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  act(() => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  expect(lease.close).toHaveBeenCalledTimes(1);
  expect(result.current.isFetching).toBe(false);
  expect(result.current.metrics.get(firstRecord.key)?.get('cpu')?.status).toBe('failed');
  // A row published while paused waits beside the retained samples; it is pending, not unavailable.
  act(() => { result.current.register(second); vi.advanceTimersByTime(120); });
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  expect(result.current.isLoadingFor(second, 'cpu')).toBe(true);
  act(() => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
  act(() => transport.leases[1].receive(frame([firstRecord.key, secondRecord.key])));
  expect(result.current.metrics.get(firstRecord.key)?.get('cpu')?.value).toBe(0);
  expect(result.current.isLoadingFor(second, 'cpu')).toBe(false);
  expect(result.current.isLoading).toBe(false);
});

it('pauses disabled and unselected demand while preserving selected samples across a pause', () => {
  const { result, rerender } = renderTable();
  act(() => { result.current.register(first); vi.advanceTimersByTime(120); });
  act(() => transport.leases[0].receive(frame(firstRecord.key)));
  expect(result.current.isLoadingFor(second, 'cpu')).toBe(true);
  rerender({ ...base, enabled: false });
  expect(transport.leases[0].close).toHaveBeenCalledTimes(1);
  expect(result.current.isLoading).toBe(false);
  expect(result.current.metrics.get(firstRecord.key)?.get('memory')?.value).toBe(2048);
  // Nothing can arrive for a disabled table, an unselected metric or a body the table did not admit.
  expect(result.current.isLoadingFor(second, 'cpu')).toBe(false);
  expect(result.current.isLoadingFor(first, 'disk')).toBe(false);
  expect(result.current.isLoadingFor({ name: 'not-admitted' }, 'cpu')).toBe(false);
  rerender({ ...base, metricIDs: [] });
  expect(result.current.metrics.size).toBe(0);
  expect(transport.leases).toHaveLength(1);
  rerender({ ...base, metricIDs: ['memory'] });
  act(() => transport.leases[1].receive(frame(firstRecord.key)));
  expect(result.current.metrics.get(firstRecord.key)?.has('cpu')).toBe(false);
  expect(result.current.metrics.get(firstRecord.key)?.get('memory')?.value).toBe(2048);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
});

it('clears old source and incarnation samples and lets upstream failures block collection without perpetual loading', () => {
  const pending: UseTableMetricObservationOptions = { ...base, enabled: false, loading: true };
  const { result, rerender } = renderTable(pending);
  act(() => { result.current.register(first); vi.advanceTimersByTime(120); });
  expect(result.current.isLoading).toBe(true);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(true);
  expect(transport.leases).toHaveLength(0);
  rerender(base);
  act(() => transport.leases[0].receive(frame(firstRecord.key)));
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  const source = { ...catalog.source, datasource_uid: 'other-source' };
  rerender({ ...base, source });
  expect(result.current.metrics.size).toBe(0);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(true);
  act(() => transport.leases[1].receive({ ...frame(firstRecord.key), catalog: { ...catalog, source } }));
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  const replacement = new WeakMap([[first, member(firstRecord.key, 'incarnation-2')]]);
  rerender({ ...base, source, recordsByBody: replacement });
  expect(result.current.metrics.size).toBe(0);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(true);
  act(() => transport.leases[2].fail(new Error('Metrics endpoint unavailable')));
  expect(result.current.isLoading).toBe(false);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  expect(result.current.error).toMatchObject({ message: 'Metrics endpoint unavailable' });
  const error = new Error('Source discovery failed');
  rerender({ ...base, loading: true, error });
  expect(result.current.error).toBe(error);
  expect(result.current.isLoading).toBe(false);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  expect(transport.leases).toHaveLength(3);
});

it('settles a request answered without a sample instead of spinning, and replaces isLoadingFor when an answer can change', () => {
  const { result } = renderTable();
  act(() => { result.current.register(first); vi.advanceTimersByTime(120); });
  const pending = result.current.isLoadingFor;
  expect(pending(first, 'cpu')).toBe(true);
  act(() => transport.leases[0].receive(frame([])));
  expect(result.current.isLoadingFor).not.toBe(pending);
  expect(result.current.metrics.size).toBe(0);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  expect(result.current.isLoadingFor(first, 'memory')).toBe(false);
  expect(result.current.isLoading).toBe(false);
  // A background refresh of a settled request does not restart its loading state.
  act(() => transport.leases[0].receive({ ...frame([]), data: null, fetching: true }));
  expect(result.current.isFetching).toBe(true);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  expect(result.current.isLoading).toBe(false);
});

it('shows a cell as loading from its first render until its request settles, beside samples that are already displayed', () => {
  const view = render(<Table options={base} rows={[firstRow]} />);
  // Initial batching: nothing is published yet, and the cell must not look unavailable.
  expect(read(view, 'first')).toBe('loading');
  expect(read(view, 'first', 'memory')).toBe('loading');
  act(() => { vi.advanceTimersByTime(120); });
  expect(transport.leases).toHaveLength(1);
  expect(read(view, 'first')).toBe('loading');
  act(() => transport.leases[0].receive(frame(firstRecord.key)));
  expect(read(view, 'first')).toBe('ok');
  // A second row mounts while the first row's samples are on screen.
  view.rerender(<Table options={base} rows={[firstRow, secondRow]} />);
  expect(read(view, 'first')).toBe('ok');
  expect(read(view, 'second')).toBe('loading');
  act(() => { vi.advanceTimersByTime(119); });
  expect(transport.leases).toHaveLength(1);
  expect(read(view, 'second')).toBe('loading');
  act(() => { vi.advanceTimersByTime(1); });
  expect(transport.leases).toHaveLength(2);
  expect(read(view, 'first')).toBe('ok');
  expect(read(view, 'second')).toBe('loading');
  act(() => transport.leases[1].receive(frame([firstRecord.key, secondRecord.key], 'failed')));
  expect(read(view, 'first')).toBe('failed');
  expect(read(view, 'second')).toBe('failed');
});

it('stops loading a row whose request answered without a sample for it', () => {
  const view = render(<Table options={base} rows={[firstRow, secondRow]} />);
  act(() => { vi.advanceTimersByTime(120); });
  expect(read(view, 'second')).toBe('loading');
  act(() => transport.leases[0].receive(frame(firstRecord.key)));
  expect(read(view, 'first')).toBe('ok');
  expect(read(view, 'second')).toBe('unavailable');
  expect(read(view, 'second', 'memory')).toBe('unavailable');
});

it('keeps a cell that was answered without a sample settled while the table grows, and loads only the row it admits', () => {
  const view = render(<PairedTable options={base} rows={[firstRow]} />);
  expect(shown(view, 'first')).toBe('loading');
  act(() => { vi.advanceTimersByTime(120); });
  expect(tableOf(view)).toBe('loading');
  act(() => transport.leases[0].receive(frame([])));
  expect(shown(view, 'first')).toBe('unavailable');
  expect(shown(view, 'first', 'memory')).toBe('unavailable');
  expect(tableOf(view)).toBe('idle');
  view.rerender(<PairedTable options={base} rows={[firstRow, secondRow]} />);
  expect(shown(view, 'first')).toBe('unavailable');
  expect(shown(view, 'second')).toBe('loading');
  act(() => { vi.advanceTimersByTime(120); });
  expect(transport.leases).toHaveLength(2);
  expect(transport.leases[1].spec.targets.map(target => target.token)).toEqual([firstRecord.key, secondRecord.key]);
  // The request that carries the new row is still collecting. The answered cell is not asked about again.
  expect(shown(view, 'first')).toBe('unavailable');
  expect(shown(view, 'first', 'memory')).toBe('unavailable');
  expect(shown(view, 'second')).toBe('loading');
  expect(shown(view, 'second', 'memory')).toBe('loading');
  expect(tableOf(view)).toBe('idle');
  act(() => transport.leases[1].receive({ ...frame([]), data: null, fetching: true }));
  expect(shown(view, 'first')).toBe('unavailable');
  expect(shown(view, 'second')).toBe('loading');
  act(() => transport.leases[1].receive(frame(secondRecord.key)));
  expect(shown(view, 'first')).toBe('unavailable');
  expect(shown(view, 'second')).toBe('ok');
  expect(shown(view, 'second', 'memory')).toBe('ok');
});

it('keeps cells settled through an unreachable provider while the table grows, and loads only the new row until its failure arrives', () => {
  const unreachable = { ...frame([]), data: null, error: 'Metrics endpoint unavailable' };
  const view = render(<PairedTable options={base} rows={[firstRow]} />);
  act(() => { vi.advanceTimersByTime(120); });
  act(() => transport.leases[0].receive(unreachable));
  expect(shown(view, 'first')).toBe('unavailable');
  expect(failureOf(view, 'first')).toBe('Metrics endpoint unavailable');
  view.rerender(<PairedTable options={base} rows={[firstRow, secondRow]} />);
  act(() => { vi.advanceTimersByTime(120); });
  expect(transport.leases).toHaveLength(2);
  // Nothing has been reported for the request that carries the new row, and the answered cell is not asked about again.
  expect(shown(view, 'first')).toBe('unavailable');
  expect(shown(view, 'second')).toBe('loading');
  expect(failureOf(view, 'second')).toBe('');
  expect(tableOf(view)).toBe('idle');
  act(() => transport.leases[1].receive({ ...unreachable, error: '', fetching: true }));
  expect(shown(view, 'first')).toBe('unavailable');
  expect(shown(view, 'second')).toBe('loading');
  act(() => transport.leases[1].receive(unreachable));
  expect(shown(view, 'first')).toBe('unavailable');
  expect(shown(view, 'second')).toBe('unavailable');
  expect(failureOf(view, 'second')).toBe('Metrics endpoint unavailable');
});

it('forgets a row once it has left the table, so it loads again when it returns', () => {
  const view = render(<PairedTable options={base} rows={[firstRow]} />);
  act(() => { vi.advanceTimersByTime(120); });
  act(() => transport.leases[0].receive(frame([])));
  expect(shown(view, 'first')).toBe('unavailable');
  // The table scrolls on: nothing the first request answered is still asked for.
  view.rerender(<PairedTable options={base} rows={[secondRow]} />);
  act(() => { vi.advanceTimersByTime(120); });
  expect(transport.leases[1].spec.targets.map(target => target.token)).toEqual([secondRecord.key]);
  expect(shown(view, 'second')).toBe('loading');
  expect(tableOf(view)).toBe('loading');
  act(() => transport.leases[1].receive(frame([])));
  expect(shown(view, 'second')).toBe('unavailable');
  expect(tableOf(view)).toBe('idle');
  // Only the request that completed last is remembered, so the row that returns is new again.
  view.rerender(<PairedTable options={base} rows={[firstRow, secondRow]} />);
  act(() => { vi.advanceTimersByTime(120); });
  expect(transport.leases[2].spec.targets.map(target => target.token)).toEqual([firstRecord.key, secondRecord.key]);
  expect(shown(view, 'first')).toBe('loading');
  expect(shown(view, 'second')).toBe('unavailable');
  act(() => transport.leases[2].receive(frame([])));
  expect(shown(view, 'first')).toBe('unavailable');
});

it.each<[string, Partial<UseTableMetricObservationOptions>]>([
  ['plugin', { ownerPluginID: 'other-plugin' }],
  ['connection', { ownerConnectionID: 'other-tenant' }],
  ['resource type', { resourceKey: 'other-machines' }],
  ['binding', { bindingID: 'other-binding' }],
  ['source', { source: { ...catalog.source, datasource_uid: 'other-source' } }],
])('never carries an answer across a change of %s', (_change, change) => {
  const { result, rerender } = renderTable();
  publishAnswered(result, first, []);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  expect(result.current.cells.read(first, 'cpu').isLoading).toBe(false);
  expect(result.current.isLoading).toBe(false);
  rerender({ ...base, ...change });
  expect(transport.leases).toHaveLength(2);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(true);
  expect(result.current.isLoadingFor(first, 'memory')).toBe(true);
  expect(result.current.cells.read(first, 'cpu').isLoading).toBe(true);
  expect(result.current.isLoading).toBe(true);
  act(() => transport.leases[1].receive(frame([])));
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  expect(result.current.cells.read(first, 'cpu').isLoading).toBe(false);
  expect(result.current.isLoading).toBe(false);
});

it('never carries an answer to a recreated resource that keeps its host token', () => {
  const recreated = Object.freeze({ name: 'recreated-body' });
  const { result, rerender } = renderTable();
  const { release } = publishAnswered(result, first, []);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  rerender({ ...base, recordsByBody: new WeakMap([[recreated, member(firstRecord.key, 'incarnation-2')]]) });
  act(() => { release(); result.current.register(recreated); });
  expect(result.current.isLoadingFor(recreated, 'cpu')).toBe(true);
  act(() => { vi.advanceTimersByTime(120); });
  expect(transport.leases[1].spec.targets[0].reference.incarnation).toBe('incarnation-2');
  expect(result.current.isLoadingFor(recreated, 'cpu')).toBe(true);
  expect(result.current.cells.read(recreated, 'cpu').isLoading).toBe(true);
  expect(result.current.isLoading).toBe(true);
  act(() => transport.leases[1].receive(frame([])));
  expect(result.current.isLoadingFor(recreated, 'cpu')).toBe(false);
  expect(result.current.cells.read(recreated, 'cpu').isLoading).toBe(false);
});

it('loads a newly selected metric while the other metrics stay answered, and asks again about one a completed request left out', () => {
  const { result, rerender } = renderTable({ ...base, metricIDs: ['cpu'] });
  publishAnswered(result, first, []);
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  rerender({ ...base, metricIDs: ['cpu', 'memory'] });
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  expect(result.current.isLoadingFor(first, 'memory')).toBe(true);
  expect(result.current.cells.read(first, 'cpu').isLoading).toBe(false);
  expect(result.current.cells.read(first, 'memory').isLoading).toBe(true);
  expect(result.current.isLoading).toBe(false);
  act(() => transport.leases[1].receive(frame([])));
  expect(result.current.isLoadingFor(first, 'memory')).toBe(false);
  rerender({ ...base, metricIDs: ['cpu'] });
  act(() => transport.leases[2].receive(frame([])));
  rerender({ ...base, metricIDs: ['cpu', 'memory'] });
  expect(result.current.isLoadingFor(first, 'cpu')).toBe(false);
  expect(result.current.isLoadingFor(first, 'memory')).toBe(true);
  expect(result.current.cells.read(first, 'memory').isLoading).toBe(true);
});

it('cancels pending demand when the owning hook unmounts and arms nothing for late cell cleanup', () => {
  const { result, unmount } = renderTable();
  let release!: () => void;
  act(() => { release = result.current.register(first); });
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  release();
  result.current.register(second)();
  expect(vi.getTimerCount()).toBe(0);
  act(() => { vi.advanceTimersByTime(1_000); });
  expect(transport.leases).toHaveLength(0);
});

it('leaves no timer behind when a parent unmounts before its cells, including after a StrictMode replay', () => {
  const view = render(<StrictMode><Table options={base} rows={[firstRow]} /></StrictMode>);
  // The replay cleaned the owner and then its cells; demand that was still unpublished must be armed again.
  act(() => { vi.advanceTimersByTime(120); });
  expect(transport.leases).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
  const lease = transport.leases[0];
  act(() => lease.receive(frame(firstRecord.key)));
  expect(read(view, 'first')).toBe('ok');
  view.rerender(<StrictMode><Table options={base} rows={[firstRow, secondRow]} /></StrictMode>);
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  // React runs the parent's cleanup first; the cells' cleanup afterwards must not arm a new publication.
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
  act(() => { vi.advanceTimersByTime(1_000); });
  expect(transport.leases).toHaveLength(1);
  expect(lease.close).toHaveBeenCalledTimes(1);
});

// Cell by cell: the additive subscription API reads the same observation and the same registry
// as the table-wide accessors above, so the two can never disagree.
const Cells = createContext<TableMetricCells | null>(null);
const renderCounts = new Map<string, number>();
let latestCells: TableMetricCells | undefined;
function CellView({ row, metricID }: { row: Row; metricID: string }) {
  const cells = useContext(Cells)!;
  const { sample, isLoading } = useTableMetricCell(cells, row.body, metricID);
  const id = `${row.id}:${metricID}`;
  renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1);
  return <output data-cell={id}>{sample ? sample.status : isLoading ? 'loading' : 'unavailable'}</output>;
}
const cellViewsOf = (rows: readonly Row[]) => rows.flatMap(row => ['cpu', 'memory'].map(metricID => <CellView key={`${row.id}:${metricID}`} row={row} metricID={metricID} />));
/** Like a real table, the cells arrive as children: the table can render without re-rendering them. */
function CellOwner({ options, children }: { options: UseTableMetricObservationOptions; children: ReactNode }) {
  const observation = useTableMetricObservation(options);
  latestCells = observation.cells;
  return <Cells.Provider value={observation.cells}>{children}</Cells.Provider>;
}
beforeEach(() => {
  renderCounts.clear();
  latestCells = undefined;
});

it('answers a cell exactly as the table-wide accessors do, through loading, an answer, a recreated resource and an error', () => {
  const recreated = Object.freeze({ name: 'recreated-body' });
  const recreatedMap = new WeakMap([[recreated, member(firstRecord.key, 'incarnation-2')]]);
  const { result, rerender } = renderTable();
  const agree = (body: object) => {
    for (const metricID of ['cpu', 'memory', 'disk']) {
      const answer = result.current.cells.read(body, metricID);
      const token = result.current.tokenFor(body);
      expect(answer.sample).toBe(token ? result.current.metrics.get(token)?.get(metricID) : undefined);
      expect(answer.isLoading).toBe(result.current.isLoadingFor(body, metricID));
      expect(answer.error).toBe(result.current.error);
    }
  };
  const everyone = [first, second, recreated, { name: 'not-admitted' }];
  // Mounted, and awaiting publication.
  act(() => { result.current.register(first); });
  everyone.forEach(agree);
  expect(result.current.cells.read(first, 'cpu').isLoading).toBe(true);
  // Published, then answered.
  act(() => { vi.advanceTimersByTime(120); });
  everyone.forEach(agree);
  act(() => transport.leases[0].receive(frame(firstRecord.key)));
  everyone.forEach(agree);
  expect(result.current.cells.read(first, 'cpu').sample?.value).toBe(0);
  expect(result.current.cells.read(first, 'cpu').isLoading).toBe(false);
  // The resource is recreated under the same host token while its old demand is retained: neither reader
  // shows the previous incarnation's sample, and both keep the cell pending until the new request answers.
  rerender({ ...base, recordsByBody: recreatedMap });
  act(() => { result.current.register(recreated); });
  everyone.forEach(agree);
  expect(result.current.tokenFor(recreated)).toBeUndefined();
  expect(result.current.cells.read(recreated, 'cpu').sample).toBeUndefined();
  expect(result.current.cells.read(recreated, 'cpu').isLoading).toBe(true);
  act(() => { vi.advanceTimersByTime(120); });
  everyone.forEach(agree);
  act(() => transport.leases[1].receive(frame(firstRecord.key)));
  everyone.forEach(agree);
  expect(result.current.cells.read(recreated, 'cpu').sample?.value).toBe(0);
  // An upstream error blocks collection and loading for both.
  const failure = new Error('Source discovery failed');
  rerender({ ...base, recordsByBody: recreatedMap, loading: true, error: failure });
  everyone.forEach(agree);
  expect(result.current.cells.read(recreated, 'cpu').isLoading).toBe(false);
  expect(result.current.cells.read(recreated, 'cpu').error).toBe(failure);
});

it('keeps one cells object and one answer object while nothing a cell can see changes', () => {
  const { result, rerender } = renderTable();
  const { cells } = result.current;
  const { lease } = publishAnswered(result, first, firstRecord.key);
  const answer = cells.read(first, 'cpu');
  expect(answer.sample?.value).toBe(0);
  // A table-level change, a repeated frame and a swapped map: the observation moves, no answer does.
  act(() => lease.receive({ ...frame(firstRecord.key), fetching: true }));
  expect(result.current.isFetching).toBe(true);
  rerender({ ...base, recordsByBody: new WeakMap<object, HostRecord>([[first, member(firstRecord.key)], [second, secondRecord]]) });
  expect(result.current.cells).toBe(cells);
  expect(cells.read(first, 'cpu')).toBe(answer);
});

it('serves a table-wide reader and a cell of the same body from one registry and one observation', () => {
  function Mixed({ legacy }: { legacy: boolean }) {
    const observation = useTableMetricObservation(base);
    return <Observation.Provider value={observation}>
      <Cells.Provider value={observation.cells}>
        {legacy && <Cell row={firstRow} metricID="cpu" />}
        <CellView row={firstRow} metricID="memory" />
      </Cells.Provider>
    </Observation.Provider>;
  }
  const view = render(<Mixed legacy />);
  act(() => { vi.advanceTimersByTime(120); });
  expect(transport.leases).toHaveLength(1);
  const lease = transport.leases[0];
  expect(read(view, 'first', 'cpu')).toBe('loading');
  expect(read(view, 'first', 'memory')).toBe('loading');
  act(() => lease.receive(frame(firstRecord.key)));
  expect(read(view, 'first', 'cpu')).toBe('ok');
  expect(read(view, 'first', 'memory')).toBe('ok');
  // The body stays requested until the last of its registrations, from either kind of reader, is cleaned up.
  view.rerender(<Mixed legacy={false} />);
  act(() => { vi.advanceTimersByTime(500); });
  expect(lease.close).not.toHaveBeenCalled();
  expect(transport.leases).toHaveLength(1);
  expect(read(view, 'first', 'memory')).toBe('ok');
  view.unmount();
  expect(lease.close).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('re-renders only the cells whose own answer changed, however often the table renders', () => {
  const children = cellViewsOf([firstRow, secondRow]);
  const view = render(<CellOwner options={base}>{children}</CellOwner>);
  act(() => { vi.advanceTimersByTime(120); });
  expect(transport.leases).toHaveLength(1);
  act(() => transport.leases[0].receive(frame([firstRecord.key, secondRecord.key])));
  expect(read(view, 'first')).toBe('ok');
  expect(read(view, 'second')).toBe('ok');
  renderCounts.clear();
  // The table swaps in a map for the same admitted records and the host repeats its answer: no answer moved.
  view.rerender(<CellOwner options={{ ...base, recordsByBody: new WeakMap<object, HostRecord>([[first, member(firstRecord.key)], [second, secondRecord]]) }}>{children}</CellOwner>);
  act(() => transport.leases[0].receive(frame([firstRecord.key, secondRecord.key])));
  expect(renderCounts.size).toBe(0);
  // One sample moves: its cell renders again and no other does.
  const moved = frame([firstRecord.key, secondRecord.key]);
  moved.data!.results.find(result => result.resource_token === secondRecord.key && result.metric_id === 'cpu')!.value = 0.5;
  act(() => transport.leases[0].receive(moved));
  expect([...renderCounts]).toEqual([['second:cpu', 1]]);
  expect(latestCells!.read(second, 'cpu').sample?.value).toBe(0.5);
  expect(latestCells!.read(second, 'memory').sample?.value).toBe(2048);
  expect(latestCells!.read(first, 'cpu').sample?.value).toBe(0);
});

it('keeps every cell as it was when the host repeats a failure, and shows a failure that changes or clears', () => {
  const failed = (error: string) => ({ ...frame([]), data: null, error });
  const children = cellViewsOf([firstRow, secondRow]);
  const view = render(<CellOwner options={base}>{children}</CellOwner>);
  act(() => { vi.advanceTimersByTime(120); });
  const lease = transport.leases[0];
  act(() => lease.receive(failed('Metrics endpoint unavailable')));
  const reported = latestCells!.read(first, 'cpu');
  expect(reported.error).toMatchObject({ message: 'Metrics endpoint unavailable' });
  expect(reported.isLoading).toBe(false);
  expect(read(view, 'first')).toBe('unavailable');
  renderCounts.clear();
  // The same failure again moves nothing a cell can see.
  act(() => lease.receive(failed('Metrics endpoint unavailable')));
  expect(renderCounts.size).toBe(0);
  expect(latestCells!.read(first, 'cpu')).toBe(reported);
  // A different failure reaches every cell once, and so does its clearing.
  act(() => lease.receive(failed('Metrics endpoint timed out')));
  expect([...renderCounts.values()]).toEqual([1, 1, 1, 1]);
  expect(latestCells!.read(first, 'cpu').error).toMatchObject({ message: 'Metrics endpoint timed out' });
  renderCounts.clear();
  act(() => lease.receive({ ...frame([]), data: null, fetching: true }));
  expect([...renderCounts.values()]).toEqual([1, 1, 1, 1]);
  expect(latestCells!.read(first, 'cpu').error).toBeNull();
});

it('leaves no cell subscription or timer behind when rows or the table unmount', () => {
  let active = 0;
  function Counted({ rows }: { rows: readonly Row[] }) {
    const { cells } = useTableMetricObservation(base);
    const counted = useMemo<TableMetricCells>(() => ({
      register: cells.register,
      read: cells.read,
      subscribe: (listener) => {
        active++;
        const stop = cells.subscribe(listener);
        return () => { active--; stop(); };
      },
    }), [cells]);
    return <Cells.Provider value={counted}>{cellViewsOf(rows)}</Cells.Provider>;
  }
  const view = render(<Counted rows={[firstRow, secondRow]} />);
  expect(active).toBe(4);
  view.rerender(<Counted rows={[firstRow]} />);
  expect(active).toBe(2);
  view.unmount();
  expect(active).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
