import { describe, expect, it } from 'vitest';
import { valueToJSON, type Value } from '@omniviewdev/runtime';
import { resourceExecOptions } from './resourceExecOptions';

describe('resource exec Wails JSON arguments', () => {
  it('serializes generated session options with exact nested canonical integers', () => {
    const body: Value = { kind: 'map', value: {
      metadata: { kind: 'map', value: { generation: { kind: 'int64', value: '9223372036854775807' } } },
      spec: { kind: 'list', value: [
        { kind: 'uint64', value: '18446744073709551615' },
        { kind: 'uint64', value: '7' },
        { kind: 'double', value: 1 },
        { kind: 'string', value: '18446744073709551615' },
      ] },
    } };
    const reference = { address: { provider: 'kubernetes', authority: 'cluster', type: 'pods', id: 'pod-1', scope: [] } };
    const route = { connection: 'connection' };
    const opts = resourceExecOptions(body, { container: 'app' }, ['/bin/sh'], reference, route);
    // Wails serializes the full argument array, not just resource_data.
    const wire = JSON.stringify(['alternate-kubernetes-installation', 'connection', opts]);
    const decoded = JSON.parse(wire);
    expect(decoded[2].resource_plugin).toBe(reference.address.provider);
    expect(decoded[2].resource_key).toBe(reference.address.type);
    expect(decoded[2].resource_data).toEqual(body);
    expect(decoded[2].reference).toEqual(reference);
    expect(decoded[2].route).toEqual(route);
    expect(decoded[2].params).toEqual({ container: 'app' });
    expect(decoded[2].command).toEqual(['/bin/sh']);
    expect(valueToJSON(decoded[2].resource_data)).toEqual(valueToJSON(body));
  });
});
