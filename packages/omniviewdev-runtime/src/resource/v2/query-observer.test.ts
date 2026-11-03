import { describe, expect, it } from 'vitest';
import { QueryLeaseObserver } from './query-observer';
import type { QueryLeaseEvent, ResultRow } from './query-lease';

const metadata = { coverage: 'complete', limitations: [], freshness: 'current', count: { kind: 'exact', value: '9007199254740993' } } as const;
const row = (key: string): ResultRow => ({ key, targetId: 't', resource: { address: { provider: 'p', authority: 'a', type: 't', scope: [], id: key } }, representation: { id: 'r', revision: '1' }, provenance: { source: 's', coverage: 'complete', stale: false }, values: { n: { state: 'value', value: { kind: 'uint64', value: '18446744073709551615' } } } });
function deepFreeze<T>(object: T): T { if (object && typeof object === 'object') { Object.values(object).forEach(deepFreeze); Object.freeze(object); } return object; }
function data(generation: string, sequence: string, payload: Extract<QueryLeaseEvent, { lane: 'data' }>['payload']): QueryLeaseEvent { return deepFreeze({ lane: 'data', leaseId: 'l', generation, sequence, payload }); }
function reset(generation: string, nextGeneration: string, reason: 'overflow' | 'bindingChanged' = 'overflow'): QueryLeaseEvent { return deepFreeze({ lane: 'control', leaseId: 'l', payload: { kind: 'reset', generation, nextGeneration, reason } }); }
function observer() { const o = new QueryLeaseObserver('l', 3); o.attach('g1'); return o; }

describe('passive query observer', () => {
  it('accepts absent or nonempty optional tokens and recovers on explicit empty tokens', () => {
    for (const field of ['continuation', 'incarnation'] as const) {
      for (const value of [undefined, '', 'token']) {
        const item = row('a');
        const frameMetadata = { ...metadata, limitations: [...metadata.limitations] };
        if (value !== undefined) {
          if (field === 'incarnation') item.resource.incarnation = value;
          else Object.assign(frameMetadata, { continuation: value });
        }
        const o = observer();
        expect(o.apply(data('g1', '1', { kind: 'open', rows: [item], metadata: frameMetadata })).kind)
          .toBe(value === '' ? 'recover' : 'none');
        if (value !== '') {
          expect(o.getSnapshot().rows).toHaveLength(1);
          expect(o.getSnapshot().metadata?.count).toEqual(metadata.count);
        }
      }
    }
  });
  it('applies ordered changes atomically without mutating inputs or previous snapshots', () => {
    const o = observer(); const a = row('a'); const b = row('b');
    o.apply(data('g1', '1', { kind: 'open', rows: [a, b], metadata: metadata as never }));
    const old = o.getSnapshot();
    o.apply(data('g1', '2', { kind: 'changes', changes: [{ kind: 'update', key: 'a', row: row('a') }, { kind: 'move', key: 'b', index: 0 }, { kind: 'enter', index: 1, row: row('c') }, { kind: 'delete', key: 'a' }], metadata: metadata as never }));
    expect(o.getSnapshot().rows.map(r => r.key)).toEqual(['b', 'c']);
    expect(old.rows.map(r => r.key)).toEqual(['a', 'b']);
    expect(Object.isFrozen(o.getSnapshot().rows[0].values)).toBe(true);
    expect(old.metadata?.count).toEqual({ kind: 'exact', value: '9007199254740993' });
    expect(old.rows[0].values.n).toEqual({ state: 'value', value: { kind: 'uint64', value: '18446744073709551615' } });
  });
  it('recovers once on gaps or invalid atomic batches and replaces the image', () => {
    const o = observer(); o.apply(data('g1', '1', { kind: 'open', rows: [row('a')], metadata: metadata as never }));
    expect(o.apply(data('g1', '3', { kind: 'changes', changes: [], metadata: metadata as never }))).toEqual({ kind: 'recover', generation: 'g1' });
    expect(o.apply(data('g1', '4', { kind: 'changes', changes: [], metadata: metadata as never })).kind).toBe('none');
    o.apply(reset('g1', 'g2')); o.apply(reset('g1', 'g2')); o.apply(reset('g2', 'g3'));
    o.apply(data('g2', '1', { kind: 'open', rows: [row('old')], metadata: metadata as never }));
    o.apply(data('g3', '1', { kind: 'open', rows: [row('new')], metadata: metadata as never }));
    expect(o.getSnapshot().rows.map(r => r.key)).toEqual(['new']);
    expect(o.apply(data('g3', '2', { kind: 'changes', changes: [{ kind: 'leave', key: 'new' }, { kind: 'delete', key: 'missing' }], metadata: metadata as never })).kind).toBe('recover');
    expect(o.getSnapshot().rows.map(r => r.key)).toEqual(['new']);
  });
  it('erases protected rows at binding barrier and on close or reconnect', () => {
    const o = observer(); o.apply(data('g1', '1', { kind: 'open', rows: [row('a')], metadata: metadata as never }));
    o.apply(reset('g1', 'g2', 'bindingChanged')); expect(o.getSnapshot().rows).toEqual([]); expect(o.getSnapshot().metadata).toBeUndefined();
    o.apply(data('g2', '1', { kind: 'open', rows: [row('b')], metadata: metadata as never }));
    o.apply({ lane: 'control', leaseId: 'l', payload: { kind: 'close', reason: 'accessInvalidated' } });
    expect(o.getSnapshot().rows).toEqual([]); expect(o.disconnected()).toEqual({ kind: 'reopen' });
  });
  it('clears ready rows and metadata on a lost drain response', () => {
    const o = observer(); o.apply(data('g1', '1', { kind: 'open', rows: [row('a')], metadata: metadata as never }));
    expect(o.getSnapshot().status).toBe('ready');
    expect(o.disconnected()).toEqual({ kind: 'reopen' });
    expect(o.getSnapshot()).toEqual({ status: 'closed', rows: [], stale: false });
  });
  it('rejects unbounded windows, duplicate keys, noncanonical numbers and oversized frames', () => {
    for (const payload of [
      { kind: 'open', rows: [row('a'), row('b'), row('c'), row('d')], metadata },
      { kind: 'open', rows: [row('a'), row('a')], metadata },
      { kind: 'open', rows: [], metadata: { ...metadata, count: { kind: 'exact', value: '01' } } },
      { kind: 'open', rows: [], metadata: { ...metadata, limitations: ['x'.repeat(262144)] } },
    ]) { const o = observer(); expect(o.apply(data('g1', '1', payload as never)).kind).toBe('recover'); expect(o.getSnapshot().rows).toEqual([]); }
    const o = observer(); expect(o.apply(data('g1', '01', { kind: 'open', rows: [], metadata: metadata as never })).kind).toBe('recover');
  });
  it('erases source invalidation and preserves safe terminal error', () => {
    const o = observer(); o.apply(data('g1', '1', { kind: 'open', rows: [row('a')], metadata: metadata as never }));
    o.apply({ lane: 'control', leaseId: 'l', payload: { kind: 'reset', generation: 'g1', nextGeneration: 'g2', reason: 'sourceInvalidated' } });
    expect(o.getSnapshot().rows).toEqual([]); expect(o.getSnapshot().metadata).toBeUndefined();
    const error = { type: 'error', title: 'Failed', status: 500, detail: 'Unavailable', code: 'UNAVAILABLE' };
    o.apply({ lane: 'control', leaseId: 'l', payload: { kind: 'close', reason: 'failed', error } });
    expect(o.getSnapshot()).toMatchObject({ status: 'closed', rows: [], error });
  });
  it('reopens instead of recovering after finite completion', () => {
    for (const event of [data('g1', '2', { kind: 'changes', changes: [], metadata: metadata as never }), reset('g1', 'g2')]) {
      const o = observer(); o.apply(data('g1', '1', { kind: 'open', rows: [row('a')], metadata: metadata as never }));
      o.apply({ lane: 'control', leaseId: 'l', payload: { kind: 'control', state: 'complete', generation: 'g1' } });
      expect(o.getSnapshot().status).toBe('complete');
      expect(o.apply(event)).toEqual({ kind: 'reopen' }); expect(o.getSnapshot().rows).toEqual([]);
    }
  });
  it('enforces window and move bounds without partial publication', () => {
    for (const changes of [[{ kind: 'enter', index: 3, row: row('d') }], [{ kind: 'move', key: 'a', index: 3 }], [{ kind: 'move', key: 'a', index: -1 }]]) {
      const o = observer(); o.apply(data('g1', '1', { kind: 'open', rows: [row('a'), row('b'), row('c')], metadata: metadata as never }));
      expect(o.apply(data('g1', '2', { kind: 'changes', changes: changes as never, metadata: metadata as never })).kind).toBe('recover');
      expect(o.getSnapshot().rows.map(r => r.key)).toEqual(['a', 'b', 'c']);
    }
  });
  it('checks signed integer bounds and canonical spelling', () => {
    for (const [value, valid] of [['-9223372036854775808', true], ['9223372036854775807', true], ['-9223372036854775809', false], ['9223372036854775808', false], ['-0', false], ['01', false], ['-01', false]] as const) {
      const o = observer(); const item = row('a'); item.values.n = { state: 'value', value: { kind: 'int64', value } };
      expect(o.apply(data('g1', '1', { kind: 'open', rows: [item], metadata: metadata as never })).kind).toBe(valid ? 'none' : 'recover');
    }
  });
  it('rejects malformed wire variants and clears protected rows', () => {
    const malformed: unknown[] = [
      { lane: 'other', leaseId: 'l', payload: {} },
      { lane: 'control', leaseId: 'l', payload: { kind: 'other', generation: 'g1', nextGeneration: 'g2' } },
      { lane: 'control', leaseId: 'l', payload: { kind: 'reset', generation: 'g1', nextGeneration: 'g2', reason: 'other' } },
      { lane: 'control', leaseId: 'l', payload: { kind: 'reset', generation: 'g1', reason: 'bindingChanged' } },
      { lane: 'control', leaseId: 'l', payload: { kind: 'control', state: 'other', generation: 'g1' } },
      { lane: 'data', leaseId: 'l', generation: 'g1', sequence: '2', payload: { kind: 'other', metadata } },
      { lane: 'data', leaseId: 'l', generation: 'g1', sequence: '2', payload: { kind: 'changes', metadata } },
      { lane: 'data', leaseId: 'l', generation: 'g1', sequence: '2', payload: { kind: 'open', rows: [{ ...row('x'), resource: {} }], metadata } },
      { lane: 'data', leaseId: 'l', generation: 'g1', sequence: '2', payload: { kind: 'open', rows: [{ ...row('x'), provenance: { source: 's', coverage: 'bad', stale: false } }], metadata } },
      { lane: 'data', leaseId: 'l', generation: 'g1', sequence: '2', payload: { kind: 'open', rows: [], metadata: { ...metadata, freshness: 'bad' } } },
    ];
    for (const frame of malformed) {
      const o = observer(); o.apply(data('g1', '1', { kind: 'open', rows: [row('a')], metadata: metadata as never }));
      expect(o.apply(deepFreeze(frame) as QueryLeaseEvent).kind).toBe('recover');
      expect(o.getSnapshot().rows).toEqual([]); expect(o.getSnapshot().metadata).toBeUndefined();
    }
    const o = observer(); o.apply(data('g1', '1', { kind: 'open', rows: [row('a')], metadata: metadata as never }));
    expect(o.apply({ lane: 'control', leaseId: 'other', payload: { kind: 'close', reason: 'accessInvalidated' } }).kind).toBe('none');
    expect(o.getSnapshot().rows).toHaveLength(1);
  });
});
