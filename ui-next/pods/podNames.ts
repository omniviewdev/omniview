import { valueToJSON, type HostRecord } from '@omniviewdev/runtime';

export type PodName = { readonly key: string; readonly namespace: string; readonly name: string };

type PodIdentity = { readonly metadata?: { readonly name?: unknown; readonly namespace?: unknown } } | null;

// A record body is an exact `Value` tree, not a Kubernetes object: valueToJSON is the presentation projection.
// `key` is the host's identity of the record; neither the route nor a display field mints one.
export function podNames(records: readonly HostRecord[]): PodName[] {
  return records.map((host) => {
    const metadata = (valueToJSON(host.record.body) as PodIdentity)?.metadata;
    return {
      key: host.key,
      namespace: typeof metadata?.namespace === 'string' ? metadata.namespace : '',
      name: typeof metadata?.name === 'string' ? metadata.name : '',
    };
  });
}
