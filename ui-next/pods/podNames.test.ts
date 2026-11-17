import { jsonToValue, type HostRecord } from '@omniviewdev/runtime';
import { describe, expect, it } from 'vitest';
import { podNames } from './podNames';

// The shape of a record the host hands to the UI: the key is the host's identity, the body an exact `Value` tree.
// The body below is trimmed from a Pod read through the real host and the Kubernetes plugin 0.21.2 from a kind v1.35 cluster
// (docs/ui-next/slices/1a-pods-list.md, "What ran"): integers arrive as int64 strings, the object keeps its Kubernetes field names.
function podRecord(key: string, body: unknown): HostRecord {
  return {
    key,
    addressKey: `address:${key}`,
    targetId: 'cef913f2-41be-4c9c-83af-f964a65c0ce5',
    route: { connection: 'kind-n11b-slice1a' },
    record: {
      reference: {
        address: { provider: 'kubernetes', authority: 'local:a7cafb30', type: 'k8s:/pods', scope: [{ dimension: 'namespace', value: 'checkout' }], id: 'cart-api-7867f4b5c-gb47q' },
        incarnation: 'c59985fc-4d17-4437-b0e1-ff62f5348a36',
      },
      body: jsonToValue(body),
      representation: { id: 'kubernetes.object.v1/v1', revision: 'kubernetes.object.v1/v1' },
      coverage: { kind: 'complete', paths: [] },
      sourceRevision: '937',
    },
  };
}

const cartApi = {
  metadata: { name: 'cart-api-7867f4b5c-gb47q', namespace: 'checkout', creationTimestamp: '2026-11-17T00:26:13Z', resourceVersion: '937' },
  status: { phase: 'Running', containerStatuses: [{ name: 'app', ready: true, restartCount: 0 }, { name: 'proxy', ready: true, restartCount: 0 }] },
  spec: { nodeName: 'n11b-slice1a-control-plane', containers: [{ name: 'app' }, { name: 'proxy' }] },
};

describe('podNames', () => {
  it('projects a host record to its namespace and name, keeping the host key as identity', () => {
    const key = 'row:04b0bc2b2461b132c3aa919530396b01c7863b4cbf9bbe9d8e0f65feebe1a6b8';

    expect(podNames([podRecord(key, cartApi)])).toEqual([{ key, namespace: 'checkout', name: 'cart-api-7867f4b5c-gb47q' }]);
  });

  it('keeps the order of the records it is given', () => {
    const named = (name: string) => ({ metadata: { name, namespace: 'batch' } });

    const rows = podNames([podRecord('a', named('zeta')), podRecord('b', named('alpha'))]);

    expect(rows.map((row) => row.name)).toEqual(['zeta', 'alpha']);
  });

  it('answers empty strings for a body without the identity fields, and does not throw', () => {
    expect(podNames([podRecord('x', {}), podRecord('y', null), podRecord('z', { metadata: { name: 7 } })])).toEqual([
      { key: 'x', namespace: '', name: '' },
      { key: 'y', namespace: '', name: '' },
      { key: 'z', namespace: '', name: '' },
    ]);
  });
});
