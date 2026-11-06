import { expect, it } from 'vitest';
import { MetricsObservationSnapshot } from '../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/metric/models';
import type { ResourceMetricTarget, ResourceMetricsCatalog } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import { Duration } from '../../bindings/time/models';
import { prepareMetricResults } from './useMetricObservation';

const target = {
  token: 'pod-row',
  route: { connection: 'cluster' },
  reference: { address: { provider: 'kubernetes', authority: 'authority', type: 'k8s:/pods',
    scope: [{ dimension: 'namespace', value: 'apps' }], id: 'pod-1' }, incarnation: 'uid-1' },
} as ResourceMetricTarget;

it('preserves unknown values, actual source time, window and name-scoped attribution', () => {
  const snapshot = new MetricsObservationSnapshot({ invalidated: false, data: { complete: true, warnings: [], results: [{
    resource_token: 'pod-row', metric_id: 'cpu', status: 'ok', value: null,
    observed_at: '2026-11-05T10:00:00Z', window: 30 * Duration.Second,
    identity_scope: 'name', dimensions: { container: 'app' }, message: '',
    points: [{ time: '2026-11-05T09:59:00Z', value: null }, { time: '2026-11-05T10:00:00Z', value: 0.125 }],
  }, { resource_token: 'pod-row', metric_id: 'memory', status: 'missing', value: null,
    observed_at: null, window: Duration.$zero, identity_scope: '', dimensions: {}, points: [], message: 'No sample' }],
  } });
  const catalog = { source: { plugin_id: 'inventory', connection_id: 'tenant', datasource_uid: '', datasource_kind: '', native: true },
    metrics: [{ id: 'cpu', unit: 'cores' }, { id: 'memory', unit: 'bytes' }] } as ResourceMetricsCatalog;
  const [cpu, memory] = prepareMetricResults(snapshot, catalog, [target]);
  expect(cpu.value).toBeNull();
  expect(cpu.unit).toEqual({ kind: 'cpu', base: 'cores' });
  expect(cpu.observedAt).toBe(Date.parse('2026-11-05T10:00:00Z'));
  expect(cpu.windowMs).toBe(30_000);
  expect(cpu.identityScope).toBe('name');
  expect(cpu.points[0].value).toBeNull();
  expect(cpu.points[1].value).toBe(0.125);
  expect(memory.value).toBeNull();
  expect(memory.observedAt).toBeNull();
  expect(memory.status).toBe('missing');
  expect(Object.isFrozen(cpu.points)).toBe(true);
  expect(prepareMetricResults({ ...snapshot, invalidated: true }, catalog, [target])).toEqual([]);
});

it('keys series by canonical incarnation rather than caller tokens or scope ordering', () => {
  const catalog = { source: { plugin_id: 'inventory', connection_id: 'tenant', datasource_uid: '', datasource_kind: '', native: true },
    metrics: [{ id: 'cpu', unit: 'cores' }] } as ResourceMetricsCatalog;
  const make = (token: string) => new MetricsObservationSnapshot({ data: { complete: true, warnings: [], results: [{
    resource_token: token, metric_id: 'cpu', status: 'ok', value: 0, observed_at: null, dimensions: {},
    points: [], window: Duration.$zero, identity_scope: 'name', message: '',
  }] } });
  const first = prepareMetricResults(make('pod-row'), catalog, [target])[0];
  const rebound = { ...target, token: 'another-observer' };
  expect(prepareMetricResults(make(rebound.token), catalog, [rebound])[0].id).toBe(first.id);
  expect(first.value).toBe(0);
  const recreated = { ...target, reference: { ...target.reference, incarnation: 'uid-2' } };
  expect(prepareMetricResults(make('pod-row'), catalog, [recreated])[0].id).not.toBe(first.id);
  const scoped = { ...target, reference: { ...target.reference, address: { ...target.reference.address,
    scope: [{ dimension: 'namespace', value: 'apps' }, { dimension: 'region', value: 'west' }] } } };
  const reordered = { ...scoped, reference: { ...scoped.reference, address: { ...scoped.reference.address,
    scope: [...scoped.reference.address.scope].reverse() } } };
  expect(prepareMetricResults(make('pod-row'), catalog, [scoped])[0].id)
    .toBe(prepareMetricResults(make('pod-row'), catalog, [reordered])[0].id);
  expect(prepareMetricResults(make('unknown-token'), catalog, [target])).toEqual([]);
});

it.each([
  ['seconds', { kind: 'duration', base: 'seconds' }],
  ['count', { kind: 'count' }],
  ['ratio', { kind: 'ratio' }],
  ['percent', { kind: 'percent' }],
  ['bytes_per_second', { kind: 'rate', numerator: 'bytes' }],
  ['count_per_second', { kind: 'rate', numerator: 'count' }],
])('preserves declared external physical unit %s without scaling samples', (unit, displayUnit) => {
  const catalog = { source: { plugin_id: 'grafana', connection_id: 'observability', datasource_uid: 'prom', datasource_kind: 'prometheus' },
    metrics: [{ id: 'external', unit }] } as ResourceMetricsCatalog;
  const snapshot = new MetricsObservationSnapshot({ data: { complete: true, warnings: [], results: [{
    resource_token: target.token, metric_id: 'external', status: 'ok', value: 0.125, observed_at: null,
    dimensions: {}, points: [], window: Duration.$zero, identity_scope: 'name', message: '',
  }] } });
  const [result] = prepareMetricResults(snapshot, catalog, [target]);
  expect(result.unit).toEqual(displayUnit);
  expect(result.value).toBe(0.125);
});

it('retains exact per-result source provenance when a catalog contains supplemented lanes', () => {
  const native = { plugin_id: 'inventory', connection_id: 'tenant', datasource_uid: '', datasource_kind: '', native: true };
  const external = { plugin_id: 'grafana', connection_id: 'observability', datasource_uid: 'prom', datasource_kind: 'prometheus', native: false };
  const catalog = { source: external, metrics: [{ id: 'cpu', unit: 'cores' }] } as ResourceMetricsCatalog;
  const snapshot = (source: typeof native) => new MetricsObservationSnapshot({ data: { complete: true, warnings: [], results: [{
    resource_token: target.token, metric_id: 'cpu', status: 'ok', value: 0.125, observed_at: null,
    source, dimensions: {}, points: [], window: Duration.$zero, identity_scope: 'name', message: '',
  }] } });
  const [nativeResult] = prepareMetricResults(snapshot(native), catalog, [target]);
  const [externalResult] = prepareMetricResults(snapshot(external), catalog, [target]);
  expect(nativeResult.source).toEqual(native);
  expect(externalResult.source).toEqual(external);
  expect(nativeResult.id).not.toBe(externalResult.id);
});

it('uses descriptor provenance for omitted result sources in a mixed native/external catalog', () => {
  const native = { plugin_id: 'inventory', connection_id: 'tenant', datasource_uid: '', datasource_kind: '', native: true };
  const external = { plugin_id: 'grafana', connection_id: 'observability', datasource_uid: 'prom', datasource_kind: 'prometheus', native: false };
  const catalog = { source: external, metrics: [
    { id: 'native-cpu', unit: 'cores', source: native },
    { id: 'external-cpu', unit: 'cores', source: external },
  ] } as ResourceMetricsCatalog;
  const snapshot = new MetricsObservationSnapshot({ data: { complete: true, warnings: [], results: ['native-cpu', 'external-cpu'].map(metric_id => ({
    resource_token: target.token, metric_id, status: 'ok', value: 0.125, observed_at: null,
    dimensions: {}, points: [], window: Duration.$zero, identity_scope: 'name', message: '',
  })) } });
  const [nativeResult, externalResult] = prepareMetricResults(snapshot, catalog, [target]);
  expect(nativeResult.source).toEqual(native);
  expect(externalResult.source).toEqual(external);
  expect(JSON.parse(nativeResult.id)[0]).toBe(JSON.stringify(['inventory', 'tenant', '', '', true]));
  expect(JSON.parse(externalResult.id)[0]).toBe(JSON.stringify(['grafana', 'observability', 'prom', 'prometheus', false]));
});
