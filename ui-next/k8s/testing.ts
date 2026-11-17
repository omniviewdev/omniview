import { jsonToValue, type HostRecord } from '@omniviewdev/runtime/ui/v1';

// Test support only: nothing in the data layer imports this file.

let sequence = 0;

/**
 * A record the way the host hands it to the UI: the key is the host's identity (never derived from the body), and the body is
 * an exact `Value` tree, not a Kubernetes object (integers become int64 strings). `object` is the plain object a cluster served.
 */
export function hostRecord(object: unknown, key = `row:${++sequence}`): HostRecord {
  const metadata = (object as { metadata?: { name?: string; namespace?: string } } | null)?.metadata;
  return {
    key,
    addressKey: `address:${key}`,
    targetId: 'target-1',
    route: { connection: 'kind-test' },
    record: {
      reference: {
        address: {
          provider: 'kubernetes',
          authority: 'local:test',
          type: 'k8s:/pods',
          scope: [{ dimension: 'namespace', value: metadata?.namespace ?? '' }],
          id: metadata?.name ?? '',
        },
      },
      body: jsonToValue(object),
      representation: { id: 'kubernetes.object.v1/v1', revision: 'kubernetes.object.v1/v1' },
      coverage: { kind: 'complete', paths: [] },
    },
  };
}
