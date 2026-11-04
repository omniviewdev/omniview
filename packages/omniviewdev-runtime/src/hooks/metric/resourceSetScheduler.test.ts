import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResourceSetScheduler } from './resourceSetScheduler';
import type { ResourceSetQueryResponse } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import type { ResourceSetQueryRequest } from '../../metric';

function request(tokens: string[], connection = 'cluster-a'): ResourceSetQueryRequest {
  return {
    resource_plugin_id: 'kubernetes', resource_connection_id: connection, binding_id: 'binding',
    source: { plugin_id: 'grafana', connection_id: 'prometheus', datasource_uid: 'primary', datasource_kind: 'prometheus' },
    resources: tokens.map(token => ({ token, resource_key: 'core::v1::Pod', resource_id: token, resource_namespace: 'default' })),
    metric_ids: ['cpu', 'memory'], definitions: [], public_scope: {}, shape: 0,
    start_time: '1970-01-01T00:00:00Z', end_time: '1970-01-01T00:00:00Z', step: 0, mapping_revision: '1',
  } as ResourceSetQueryRequest;
}
function response(tokens: string[]): ResourceSetQueryResponse {
  return { results: tokens.map(resource_token => ({ resource_token, metric_id: 'cpu', status: 'missing' })), warnings: ['partial source'] } as ResourceSetQueryResponse;
}

describe('finite resource metric scheduling', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('coalesces table and sidebar, preserves missing status, and reuses fresh cache', async () => {
    const execute = vi.fn(async (query: ResourceSetQueryRequest) => response(query.resources.map(item => item.token)));
    const scheduler = new ResourceSetScheduler(execute);
    const table = scheduler.subscribe(request(['a', 'b']), 0, () => {});
    const sidebar = scheduler.subscribe(request(['a']), 0, () => {});
    await vi.advanceTimersByTimeAsync(8);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].resources.map(item => item.token)).toEqual(['a', 'b']);
    expect(sidebar.snapshot().data?.results).toEqual([{ resource_token: 'a', metric_id: 'cpu', status: 'missing' }]);
    sidebar.unsubscribe();
    const reopened = scheduler.subscribe(request(['a']), 0, () => {});
    await vi.advanceTimersByTimeAsync(8);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(reopened.snapshot().data?.warnings).toEqual(['partial source']);
    table.unsubscribe(); reopened.unsubscribe();
  });

  it('keeps a late sidebar on the active table polling schedule beyond detached-cache retention', async () => {
    const execute = vi.fn(async (query: ResourceSetQueryRequest) => response(query.resources.map(item => item.token)));
    const scheduler = new ResourceSetScheduler(execute);
    const table = scheduler.subscribe(request(['a', 'b']), 30_000, () => {});
    await vi.advanceTimersByTimeAsync(8);
    await vi.advanceTimersByTimeAsync(8_000);
    const sidebar = scheduler.subscribe(request(['a']), 30_000, () => {});
    await vi.advanceTimersByTimeAsync(8);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(sidebar.snapshot().data?.results).toEqual([{ resource_token: 'a', metric_id: 'cpu', status: 'missing' }]);
    await vi.advanceTimersByTimeAsync(22_000);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0].resources.map(item => item.token)).toEqual(['a', 'b']);
    table.unsubscribe(); sidebar.unsubscribe();
  });

  it('bounds batches and isolates owner, datasource and projection identities', async () => {
    const execute = vi.fn(async (query: ResourceSetQueryRequest) => response(query.resources.map(item => item.token)));
    const scheduler = new ResourceSetScheduler(execute);
    scheduler.subscribe(request(Array.from({ length: 260 }, (_, i) => String(i))), 0, () => {});
    scheduler.subscribe(request(['0'], 'cluster-b'), 0, () => {});
    const alternate = request(['0']); alternate.source = { ...alternate.source, datasource_uid: 'other' };
    scheduler.subscribe(alternate, 0, () => {});
    const projection = request(['0']); projection.resources[0] = { ...projection.resources[0], resource_namespace: 'other' };
    scheduler.subscribe(projection, 0, () => {});
    await vi.advanceTimersByTimeAsync(108);
    expect(execute).toHaveBeenCalledTimes(5);
    expect(execute.mock.calls.every(([query]) => query.resources.length <= 128)).toBe(true);
    expect(execute.mock.calls.every(([query]) => new Set(query.resources.map(item => item.token)).size === query.resources.length)).toBe(true);
  });

  it('cancels only after final interested subscriber leaves and fences late results', async () => {
    const { promise, resolve } = Promise.withResolvers<ResourceSetQueryResponse>();
    const cancel = vi.fn();
    const pending = Object.assign(promise, { cancel });
    const scheduler = new ResourceSetScheduler(() => pending);
    const first = scheduler.subscribe(request(['a']), 0, () => {});
    const second = scheduler.subscribe(request(['a']), 0, () => {});
    await vi.advanceTimersByTimeAsync(8);
    first.unsubscribe(); expect(cancel).not.toHaveBeenCalled();
    second.unsubscribe(); expect(cancel).toHaveBeenCalledTimes(1);
    resolve(response(['a']));
    await Promise.resolve(); await Promise.resolve();
    const reopened = scheduler.subscribe(request(['a']), 0, () => {});
    expect(reopened.snapshot().data).toBeUndefined();
    reopened.unsubscribe();
  });

  it('shares polling and exposes failures without zero-valued fallback', async () => {
    const execute = vi.fn(async () => { throw new Error('access denied'); });
    const scheduler = new ResourceSetScheduler(execute);
    const table = scheduler.subscribe(request(['a']), 1000, () => {});
    scheduler.subscribe(request(['a']), 1000, () => {});
    await vi.advanceTimersByTimeAsync(8);
    expect(table.snapshot().error?.message).toBe('access denied');
    expect(table.snapshot().data).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('rejects scope and retained-resource overflow without dispatching fallback queries', () => {
    const execute = vi.fn(async () => response([]));
    const scheduler = new ResourceSetScheduler(execute);
    expect(() => scheduler.subscribe(request(Array.from({ length: 513 }, (_, i) => String(i))), 0, () => {})).toThrow('512 resources');
    scheduler.subscribe(request(Array.from({ length: 512 }, (_, i) => String(i))), 0, () => {});
    expect(() => scheduler.subscribe(request(['extra']), 0, () => {})).toThrow('512 retained resources');
    for (let i = 1; i < 128; i++) scheduler.subscribe(request(['a'], `cluster-${i}`), 0, () => {});
    expect(() => scheduler.subscribe(request(['a'], 'overflow'), 0, () => {})).toThrow('128 retained scopes');
    expect(execute).not.toHaveBeenCalled();
  });

  it('caps global flights at four and starts queued scopes after capacity returns', async () => {
    const flights = Array.from({ length: 5 }, () => Promise.withResolvers<ResourceSetQueryResponse>());
    let next = 0;
    const execute = vi.fn(() => flights[next++].promise);
    const scheduler = new ResourceSetScheduler(execute);
    for (let i = 0; i < 5; i++) scheduler.subscribe(request(['a'], `cluster-${i}`), 0, () => {});
    await vi.advanceTimersByTimeAsync(8);
    expect(execute).toHaveBeenCalledTimes(4);
    flights[0].resolve(response(['a']));
    await vi.advanceTimersByTimeAsync(100);
    expect(execute).toHaveBeenCalledTimes(5);
  });
});
