import { hashKey, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { resourceQueryKeys } from '../../resourceQueryKeys';
import type { ReadTarget, ResourceAddress, ResourceReference } from '../../resource/v2/domain';
import type { HostEnumerateRequest, HostGetRequest, HostNativeQueryRequest } from '../../resource/v2/host';

const base: ResourceAddress = { provider: 'provider', authority: 'authority', type: 'opaque/type', scope: [], id: 'same' };
const addresses: ResourceAddress[] = [
  base,
  { ...base, scope: [{ dimension: 'namespace', value: 'one' }] },
  { ...base, scope: [{ dimension: 'namespace', value: 'two' }] },
  ...['a/b', 'a::b', 'a|b', '雪/é::🚀|', '雪/e\u0301::🚀|'].map(id => ({ ...base, id })),
  ...['pve-one', 'pve-two'].map(node => ({ ...base, provider: 'proxmox', type: 'qemu', scope: [{ dimension: 'node', value: node }], id: '100' })),
  { ...base, provider: 'other' },
  { ...base, authority: 'other' },
  { ...base, type: 'other/type' },
  { ...base, scope: [{ dimension: 'a|b', value: 'c/d::雪' }] },
  { ...base, scope: [{ dimension: 'a', value: 'b|c/d::雪' }] },
];
const references: ResourceReference[] = [
  ...addresses.map(address => ({ address })),
  { address: base, incarnation: 'first/::|雪' },
  { address: base, incarnation: 'second' },
];

function targetOf(address: ResourceAddress): ReadTarget {
  return {
    route: { connection: 'route' },
    provider: address.provider,
    authority: address.authority,
    type: address.type,
    scope: address.scope.map(({ dimension, value }) => ({ dimension, match: 'oneOf', values: [value] })),
    representation: 'native',
  };
}

function detail(reference: ResourceReference): HostGetRequest {
  return { targetId: 'host-target', request: { route: { connection: 'route' }, reference, representation: 'native' } };
}

function native(reference: ResourceReference): HostNativeQueryRequest {
  return { targetId: 'host-target', request: {
    target: targetOf(reference.address), language: 'provider-query', pageSize: 30,
    query: { kind: 'map', value: {
      id: { kind: 'string', value: reference.address.id },
      ...(reference.incarnation === undefined ? {} : { incarnation: { kind: 'string' as const, value: reference.incarnation } }),
    } },
  } };
}

function list(address: ResourceAddress): HostEnumerateRequest {
  return { targetId: 'host-target', request: { target: targetOf(address), pageSize: 30 } };
}

it('keeps opaque addresses and optional incarnations distinct in detail and bound native query caches', () => {
  for (const key of [
    (reference: ResourceReference) => resourceQueryKeys.resource('plugin', detail(reference)),
    (reference: ResourceReference) => resourceQueryKeys.nativeQuery('plugin', native(reference)),
  ]) {
    const hashes = references.map(reference => hashKey(key(reference)));
    expect(new Set(hashes).size).toBe(references.length);
    references.forEach((reference, index) => {
      const roundtrip = JSON.parse(JSON.stringify(reference)) as ResourceReference;
      expect(hashKey(key(roundtrip))).toBe(hashes[index]);
    });
  }
});

it('partitions list keys by structured collection identity, not object ID or incarnation', () => {
  const collections = [addresses[0], addresses[1], addresses[2], ...addresses.slice(8)];
  const hashes = collections.map(address => hashKey(resourceQueryKeys.list('plugin', list(address))));
  expect(new Set(hashes).size).toBe(collections.length);
  for (const address of addresses.slice(3, 8)) {
    expect(hashKey(resourceQueryKeys.list('plugin', list(address)))).toBe(hashes[0]);
  }
});

it('isolates access routes, host targets, representations and acquisition kinds', () => {
  const request = detail(references[0]);
  const requests: HostGetRequest[] = [
    request,
    { ...request, targetId: 'another-host-target' },
    { ...request, request: { ...request.request, route: { connection: 'another-route' } } },
    { ...request, request: { ...request.request, representation: 'model' } },
  ];
  const hashes = requests.map(input => hashKey(resourceQueryKeys.resource('plugin', input)));
  hashes.push(hashKey(resourceQueryKeys.resource('another-plugin', request)));
  hashes.push(hashKey(resourceQueryKeys.list('plugin', list(base))));
  hashes.push(hashKey(resourceQueryKeys.nativeQuery('plugin', native(references[0]))));
  expect(new Set(hashes).size).toBe(hashes.length);
});

describe('operation invalidation uses the shared resource prefix', () => {
  it('invalidates list, detail and native query entries without crossing the plugin boundary', async () => {
    const client = new QueryClient();
    const keys = references.flatMap(reference => [
      resourceQueryKeys.resource('plugin', detail(reference)),
      resourceQueryKeys.list('plugin', list(reference.address)),
      resourceQueryKeys.nativeQuery('plugin', native(reference)),
    ]);
    keys.forEach((key, index) => client.setQueryData(key, index));
    const other = resourceQueryKeys.resource('other-plugin', detail(references[0]));
    client.setQueryData(other, 'unchanged');
    await client.invalidateQueries({ queryKey: resourceQueryKeys.all('plugin') });
    keys.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
    client.clear();
  });
});
