import type { HostRecord } from '@omniviewdev/runtime';

export type PodName = { readonly key: string; readonly namespace: string; readonly name: string };

export function podNames(_records: readonly HostRecord[]): PodName[] {
  throw new Error('podNames is not written yet');
}
