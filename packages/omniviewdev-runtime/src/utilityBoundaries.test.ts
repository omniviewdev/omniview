import { describe, expect, it, vi } from 'vitest';
import type { Value } from './resource/v2/domain';
import { CreateSessionOptions } from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/logs/models';
import { QueryRequest } from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import { PortForwardSessionOptions } from './bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/networker/models';

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
  it('serializes logs, metric query/stream, and networker using exact generated option shapes', async () => {
    const resource = { resource_key: 'pods', resource_id: 'pod', resource_data: body, reference, route };
    const query = QueryRequest.createFrom(resource);
    const calls = [
      () => CreateSession('test', 'connection', CreateSessionOptions.createFrom(resource)),
      () => Query('test', 'connection', query),
      () => QueryAll('connection', query),
      () => Subscribe('test', 'connection', { ...resource, resource_namespace: '', metric_ids: [], interval: 1000000000 }),
      () => StartResourcePortForwardingSession('test', 'connection', PortForwardSessionOptions.createFrom({ connection_type: 'RESOURCE', connection: { ...resource, connection_id: 'connection', plugin_id: 'test' }, remote_port: 80, protocol: 'TCP' })),
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
    }
  });
});
