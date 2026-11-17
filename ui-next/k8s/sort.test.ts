import { describe, expect, it } from 'vitest';
import { podRow, type PodRow } from './row';
import { sortPodRows, type PodSort } from './sort';
import { hostRecord } from './testing';

// Sorting as the mock does it (MOCK k8s-resources.js:387-421): the column's kind picks the comparison, a missing value is always last
// whatever the direction, and a tie is broken by the host key, ascending.

interface Shape {
  readonly name: string;
  readonly ready?: [number, number];
  readonly word?: string;
  readonly restarts?: number;
  readonly created?: string;
  readonly node?: string;
  readonly ip?: string;
}

function make(key: string, shape: Shape): PodRow {
  const containers = shape.ready ? Array.from({ length: shape.ready[1] }, (_, index) => ({ name: `c${index}` })) : undefined;
  const containerStatuses = shape.ready
    ? containers!.map((container, index) => ({ name: container.name, ready: index < shape.ready![0], restartCount: index === 0 ? (shape.restarts ?? 0) : 0, state: { running: {} } }))
    : shape.restarts === undefined ? undefined : [{ name: 'c0', restartCount: shape.restarts, state: { running: {} } }];
  return podRow(hostRecord({
    metadata: { name: shape.name, namespace: 'ns', ...(shape.created ? { creationTimestamp: shape.created } : {}) },
    spec: { ...(containers ? { containers } : {}), ...(shape.node ? { nodeName: shape.node } : {}) },
    status: { phase: shape.word ?? 'Running', ...(shape.ip ? { podIP: shape.ip } : {}), ...(containerStatuses ? { containerStatuses } : {}) },
  }, key));
}

const names = (rows: readonly PodRow[]) => rows.map((row) => row.name);
const sorted = (rows: readonly PodRow[], id: PodSort['id'], direction: PodSort['direction'] = 'asc') => names(sortPodRows(rows, { id, direction }));

describe('sortPodRows', () => {
  it('orders names as people read them: digits as numbers', () => {
    const rows = [make('k1', { name: 'pod-10' }), make('k2', { name: 'pod-2' }), make('k3', { name: 'pod-1' })];

    expect(sorted(rows, 'name')).toEqual(['pod-1', 'pod-2', 'pod-10']);
    expect(sorted(rows, 'name', 'desc')).toEqual(['pod-10', 'pod-2', 'pod-1']);
  });

  it('breaks a tie by the host key, ascending, in both directions', () => {
    const rows = [make('row:b', { name: 'same' }), make('row:a', { name: 'same' })];

    expect(sortPodRows(rows, { id: 'name', direction: 'asc' }).map((row) => row.key)).toEqual(['row:a', 'row:b']);
    expect(sortPodRows(rows, { id: 'name', direction: 'desc' }).map((row) => row.key)).toEqual(['row:a', 'row:b']);
  });

  it('puts the unhealthiest first in Ready, ascending (the mock: a ratio sorts by its fraction)', () => {
    const rows = [make('k1', { name: 'full', ready: [2, 2] }), make('k2', { name: 'none', ready: [0, 1] }), make('k3', { name: 'half', ready: [1, 2] })];

    expect(sorted(rows, 'ready')).toEqual(['none', 'half', 'full']);
    expect(sorted(rows, 'ready', 'desc')).toEqual(['full', 'half', 'none']);
  });

  it('sorts Restarts as numbers', () => {
    const rows = [make('k1', { name: 'a', restarts: 10 }), make('k2', { name: 'b', restarts: 9 }), make('k3', { name: 'c', restarts: 100 })];

    expect(sorted(rows, 'restarts')).toEqual(['b', 'a', 'c']);
    expect(sorted(rows, 'restarts', 'desc')).toEqual(['c', 'a', 'b']);
  });

  it('puts the oldest first in Age, ascending', () => {
    const rows = [make('k1', { name: 'new', created: '2026-11-16T10:00:00Z' }), make('k2', { name: 'old', created: '2026-10-01T10:00:00Z' }), make('k3', { name: 'mid', created: '2026-11-01T10:00:00Z' })];

    expect(sorted(rows, 'age')).toEqual(['old', 'mid', 'new']);
    expect(sorted(rows, 'age', 'desc')).toEqual(['new', 'mid', 'old']);
  });

  it('sorts Status, Node and IP as text, digits as numbers', () => {
    const rows = [
      make('k1', { name: 'a', word: 'Running', node: 'node-10', ip: '10.244.0.10' }),
      make('k2', { name: 'b', word: 'Pending', node: 'node-2', ip: '10.244.0.9' }),
      make('k3', { name: 'c', word: 'Failed', node: 'node-1', ip: '10.244.0.2' }),
    ];

    expect(sorted(rows, 'status')).toEqual(['c', 'b', 'a']);
    expect(sorted(rows, 'node')).toEqual(['c', 'b', 'a']);
    expect(sorted(rows, 'ip')).toEqual(['c', 'b', 'a']);
  });

  it('puts a missing value last, whatever the direction', () => {
    const rows = [make('k1', { name: 'none' }), make('k2', { name: 'low', restarts: 1 }), make('k3', { name: 'high', restarts: 5 })];

    expect(sorted(rows, 'restarts')).toEqual(['low', 'high', 'none']);
    expect(sorted(rows, 'restarts', 'desc')).toEqual(['high', 'low', 'none']);
  });

  it('does not touch the rows it is given', () => {
    const rows = [make('k1', { name: 'b' }), make('k2', { name: 'a' })];
    const copy = [...rows];

    sortPodRows(rows, { id: 'name', direction: 'asc' });

    expect(rows).toEqual(copy);
  });
});
