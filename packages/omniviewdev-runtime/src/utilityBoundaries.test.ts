import { describe, expect, it, vi } from 'vitest';
import type { Value } from './resource/v2/domain';
import type { LogSessionRequest, MetricQueryRequest, PortForwardSessionRequest } from './models';

const transport = vi.hoisted(() => ({ frames: [] as string[] }));
vi.mock('@wailsio/runtime', () => ({
  Call: { ByName: (method: string, ...args: unknown[]) => {
    transport.frames.push(JSON.stringify({ method, args }));
    return Promise.reject(new Error('Transport stopped after serialization'));
  } },
  Create: { Any: (value: unknown) => value, Nullable: (fn: unknown) => fn, Map: (_key: unknown, fn: unknown) => fn, Array: (fn: unknown) => fn },
}));

import { CreateSession } from './logs';
import { Query, QueryAll, Subscribe } from './metric';
import { StartResourcePortForwardingSession } from './networker';

const body: Value = { kind: 'map', value: {
  nested: { kind: 'list', value: [
    { kind: 'int64', value: '-9223372036854775808' },
    { kind: 'uint64', value: '18446744073709551615' },
    { kind: 'double', value: -0 },
  ] },
} };
const reference = { address: { provider: 'test', authority: 'cluster', type: 'pods', id: 'pod', scope: [] } };
const route = { connection: 'connection' };

describe('canonical resource utility Wails adapters', () => {
  it('serializes handwritten canonical utility inputs through the real JSON boundary', async () => {
    const resource = { resource_key: 'pods', resource_id: 'pod', resource_data: body, reference, route };
    const params = { prometheus_service_name: 'owned-prometheus', prometheus_service_namespace: 'observability', prometheus_service_port: '9090' };
    const query: MetricQueryRequest = {
      ...resource, resource_namespace: '', params, metric_ids: [], shape: 0,
      start_time: '2026-01-01T00:00:00Z', end_time: '2026-01-01T01:00:00Z', step: 1000000000,
    };
    const logs: LogSessionRequest = {
      ...resource,
      options: {
        target: 'container', follow: true, include_previous: false, include_timestamps: true,
        tail_lines: 1000, since_seconds: 0, limit_bytes: 0, include_source_events: true,
        params: { source: 'selected-container' },
      },
    };
    const forwarding: PortForwardSessionRequest = {
      connection_type: 'RESOURCE', connection: { ...resource, connection_id: 'connection', plugin_id: 'test' },
      local_port: 0, remote_port: 80, protocol: 'TCP', labels: { owner: 'pod' }, params: { target: 'container' },
    };
    const calls = [
      () => CreateSession('test', 'connection', logs),
      () => Query('test', 'connection', query),
      () => QueryAll('connection', query),
      () => Subscribe('test', 'connection', { ...resource, resource_namespace: '', metric_ids: [], interval: 1000000000, params }),
      () => StartResourcePortForwardingSession('test', 'connection', forwarding),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toThrow('Transport stopped after serialization');
      const frame = JSON.parse(transport.frames[transport.frames.length - 1]);
      const request = JSON.parse(frame.args[frame.args.length - 1]);
      const target = request.connection ?? request;
      expect(target.resource_data).toEqual(body);
      expect(Object.is(target.resource_data.value.nested.value[2].value, -0)).toBe(true);
      expect(target.reference).toEqual(reference);
      expect(target.route).toEqual(route);
      if (frame.method.endsWith('.Query') || frame.method.endsWith('.QueryAll') || frame.method.endsWith('.Subscribe')) expect(request.params).toEqual(params);
      if (frame.method.endsWith('.CreateSession')) expect(request.options).toEqual(logs.options);
      if (frame.method.endsWith('.StartResourcePortForwardingSession')) {
        expect(request.labels).toEqual(forwarding.labels);
        expect(request.params).toEqual(forwarding.params);
        expect(request.protocol).toBe('TCP');
        expect(request.remote_port).toBe(80);
      }
    }
  });
  it('keeps cluster metric configuration in params without inventing resource intent', async () => {
    const params = { prometheus_service_port: '9090' };
    const request: MetricQueryRequest = {
      resource_key: 'cluster::metrics', resource_id: '', resource_namespace: '',
      metric_ids: [], shape: 0, start_time: '2026-01-01T00:00:00Z',
      end_time: '2026-01-01T01:00:00Z', step: 1000000000, params,
    };
    for (const call of [
      () => Query('test', 'connection', request),
      () => QueryAll('connection', request),
      () => Subscribe('test', 'connection', {
        resource_key: request.resource_key, resource_id: '', resource_namespace: '',
        metric_ids: [], interval: 1000000000, params,
      }),
    ]) {
      await expect(call()).rejects.toThrow('Transport stopped after serialization');
      const frame = JSON.parse(transport.frames[transport.frames.length - 1]);
      const payload = JSON.parse(frame.args[frame.args.length - 1]);
      expect(payload.params).toEqual(params);
      expect(payload).not.toHaveProperty('resource_data');
      expect(payload).not.toHaveProperty('reference');
      expect(payload).not.toHaveProperty('route');
      expect(payload).not.toHaveProperty('catalog_revision');
    }
  });

  it('preserves static forwarding configuration without a fabricated resource target', async () => {
    const request: PortForwardSessionRequest = {
      connection_type: 'STATIC', connection: { address: '127.0.0.1' },
      local_port: 0, remote_port: 53, protocol: 'UDP',
      labels: { service: 'dns' }, params: { target: 'local' },
      encryption: { algorithm: 'test-algorithm', key: 'test-key', enabled: true },
    };
    await expect(StartResourcePortForwardingSession('test', 'connection', request))
      .rejects.toThrow('Transport stopped after serialization');
    const frame = JSON.parse(transport.frames[transport.frames.length - 1]);
    const payload = JSON.parse(frame.args[frame.args.length - 1]);
    expect(payload).toEqual(request);
    expect(payload.connection).not.toHaveProperty('resource_data');
    expect(payload.connection).not.toHaveProperty('reference');
    expect(payload.connection).not.toHaveProperty('route');
  });
});
