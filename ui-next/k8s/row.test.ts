import { describe, expect, it } from 'vitest';
import { podRow, podRows, podSearchText } from './row';
import { hostRecord } from './testing';

// The row model: one PodRow per HostRecord object, computed once (a WeakMap, plan 3.3), keyed by the host's key.

const cartApi = {
  metadata: { name: 'cart-api-86bf766589-78whc', namespace: 'checkout', creationTimestamp: '2026-11-16T19:54:00Z', resourceVersion: '937' },
  spec: { nodeName: 'ui1a2-control-plane', containers: [{ name: 'app' }, { name: 'proxy' }] },
  status: {
    phase: 'Running',
    podIP: '10.244.0.6',
    containerStatuses: [
      { name: 'app', ready: true, restartCount: 0, state: { running: { startedAt: '2026-11-16T19:54:05Z' } } },
      { name: 'proxy', ready: true, restartCount: 2, state: { running: { startedAt: '2026-11-16T19:54:06Z' } } },
    ],
  },
};

describe('podRow', () => {
  it('derives every field the list shows, and keeps the host key as its identity', () => {
    const row = podRow(hostRecord(cartApi, 'row:04b0bc2b'));

    expect(row).toEqual({
      key: 'row:04b0bc2b',
      name: 'cart-api-86bf766589-78whc',
      namespace: 'checkout',
      nameTail: '-78whc'.length,
      ready: { ready: 2, total: 2 },
      status: { word: 'Running', role: 'running' },
      restarts: 2,
      createdAt: Date.UTC(2026, 10, 16, 19, 54, 0),
      node: 'ui1a2-control-plane',
      ip: '10.244.0.6',
    });
  });

  it('holds a missing value as undefined, field by field', () => {
    const row = podRow(hostRecord({ metadata: { name: 'unschedulable', namespace: 'checkout' }, spec: { containers: [{ name: 'app' }] }, status: { phase: 'Pending' } }, 'row:1'));

    expect(row).toMatchObject({ name: 'unschedulable', ready: { ready: 0, total: 1 }, status: { word: 'Pending', role: 'progress' } });
    expect(row.restarts).toBeUndefined();
    expect(row.node).toBeUndefined();
    expect(row.ip).toBeUndefined();
    expect(row.createdAt).toBeUndefined();
  });

  it('carries a status word that has no role without one', () => {
    const gated = { metadata: { name: 'gated', namespace: 'states' }, spec: { containers: [{ name: 'app' }] }, status: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False', reason: 'SchedulingGated' }] } };

    expect(podRow(hostRecord(gated, 'row:2')).status).toEqual({ word: 'SchedulingGated', role: undefined });
  });

  it('does not throw on a body that is not a Pod: empty identity, nothing else', () => {
    for (const body of [{}, null, 'text', 7, [], { metadata: { name: 7 } }]) {
      const row = podRow(hostRecord(body, 'row:x'));

      expect(row).toMatchObject({ key: 'row:x', name: '', namespace: '', nameTail: 0 });
      expect(row.ready).toBeUndefined();
      expect(row.status).toBeUndefined();
    }
  });

  it('computes a row once per record object, and a changed record gets a new row', () => {
    const record = hostRecord(cartApi, 'row:a');
    const changed = hostRecord({ ...cartApi, status: { ...cartApi.status, phase: 'Failed' } }, 'row:a');

    expect(podRow(record)).toBe(podRow(record));
    expect(podRow(changed)).not.toBe(podRow(record));
    expect(podRow(changed).key).toBe(podRow(record).key);
  });
});

describe('podRows', () => {
  it('maps records to rows in their order, reusing the row of a record object it has seen', () => {
    const first = hostRecord(cartApi, 'row:a');
    const second = hostRecord({ metadata: { name: 'crashloop', namespace: 'checkout' } }, 'row:b');
    const before = podRows([first, second]);
    const third = hostRecord({ metadata: { name: 'zeta', namespace: 'batch' } }, 'row:c');
    const after = podRows([first, second, third]);

    expect(after.map((row) => row.name)).toEqual(['cart-api-86bf766589-78whc', 'crashloop', 'zeta']);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it('returns the same array for the same records array, so an unchanged page re-renders nothing', () => {
    const records = [hostRecord(cartApi, 'row:a')];

    expect(podRows(records)).toBe(podRows(records));
  });
});

describe('podSearchText: what a person can read in the row, lower case, built once', () => {
  it('holds the name, namespace, ready, status, restarts, node and address', () => {
    const text = podSearchText(podRow(hostRecord(cartApi, 'row:a')));

    expect(text).toContain('cart-api-86bf766589-78whc');
    expect(text).toContain('checkout');
    expect(text).toContain('2/2');
    expect(text).toContain('running');
    expect(text).toContain('ui1a2-control-plane');
    expect(text).toContain('10.244.0.6');
    expect(text).toBe(text.toLowerCase());
  });

  it('is the same string for the same row', () => {
    const row = podRow(hostRecord(cartApi, 'row:a'));

    expect(podSearchText(row)).toBe(podSearchText(row));
  });
});
