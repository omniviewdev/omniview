import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extensionRootOf, type ExtensionRootV1 } from '../../ui/v1';
import { extensionRootProof, subscribeExtensionRoot } from '../../ui/extensions/wire';
import type { HostRecord, HostSourceStatus, HostSourceViewEvent, HostSourceViewRequest } from './host';
import { openSourceView, type SourceViewClient } from './sourceView';

// Exercise real collection delivery, structural sharing, owner accessor and broker entry. Only the native transport is substituted.
const io = vi.hoisted(() => ({ on: vi.fn(), open: vi.fn(), sync: vi.fn(), refresh: vi.fn(), close: vi.fn() }));
vi.mock('@wailsio/runtime', async original => ({ ...(await original<object>()), Events: { On: io.on } }));
vi.mock('./client', async original => ({ ...(await original<object>()),
  OpenSourceView: io.open, SyncSourceView: io.sync, RefreshSourceView: io.refresh, CloseSourceView: io.close,
}));

const request: HostSourceViewRequest = { targetId: 'collection', updates: 'ifSupported', target: {
  route: { connection: 'west' }, provider: 'api', authority: 'host-authority', type: 'object', representation: 'native', scope: [],
} };
const ready: HostSourceStatus = { state: 'following', mode: 'snapshotAndUpdates', count: { kind: 'exact', value: '1' } };
function record(key = 'row-1', incarnation = 'uid-1', version = 'a'): HostRecord {
  return { key, addressKey: 'host-key', targetId: 'collection', route: { connection: 'west' }, record: {
    reference: { address: { provider: 'api', authority: 'host-authority', type: 'object', scope: [{ dimension: 'area', value: 'one' }], id: 'same-name' }, incarnation },
    representation: { id: 'native', revision: '1' }, body: { kind: 'string', value: version }, coverage: { kind: 'complete', paths: [] },
  } };
}
let deliver: (event: { data: HostSourceViewEvent }) => void;
let client: SourceViewClient;
const send = (kind: HostSourceViewEvent['kind'], sequence: string, other: Partial<HostSourceViewEvent> = {}) =>
  deliver({ data: { viewId: 'view', viewGeneration: 'first', sequence, kind,
    memberRevisions: (other.records ?? other.upserts)?.map(() => sequence), ...other } });
async function open(snapshotOnly = false) {
  io.open.mockResolvedValue({ viewId: 'view', topic: 'topic', mode: snapshotOnly ? 'snapshot' : 'snapshotAndUpdates' });
  client = await openSourceView('owner', request);
  return client;
}
function snapshot(row: HostRecord, status = ready) {
  send('snapshot', '1', { records: [row] });
  send('snapshotEnd', '2', { status });
}
beforeEach(() => {
  io.sync.mockResolvedValue(undefined);
  io.refresh.mockResolvedValue(undefined);
  io.close.mockResolvedValue(undefined);
  io.on.mockImplementation((_topic, callback) => { deliver = callback; return () => {}; });
});
afterEach(() => client?.close());

describe('native extension root', () => {
  it('issues stable, opaque handles only for actual current records; proof is immutable down to the scope entries', async () => {
    await open();
    const row = record();
    send('snapshot', '1', { records: [row] });
    expect(extensionRootOf(row)).toBeUndefined();
    send('snapshotEnd', '2', { status: ready });
    const root = extensionRootOf(client.getSnapshot().records.get(row.key)!);
    expect(root).toBeDefined();
    expect(extensionRootOf(row)).toBe(root);
    expect(Object.isFrozen(root)).toBe(true);
    expect(Reflect.ownKeys(root!)).toEqual([]);
    const proof = extensionRootProof(root!);
    expect(proof).toEqual({ owner: 'owner', connection: 'west', reference: row.record.reference,
      viewId: 'view', viewGeneration: 'first:1', rowKey: row.key });
    expect(extensionRootProof(root!)).toBe(proof);
    for (const object of [proof, proof!.reference, proof!.reference.address, proof!.reference.address.scope, proof!.reference.address.scope[0]]) {
      expect(Object.isFrozen(object)).toBe(true);
    }
    expect(Reflect.set(proof!.reference.address, 'id', 'another')).toBe(false);
    for (const impostor of [{ ...row }, structuredClone(row), Object.create(row)]) expect(extensionRootOf(impostor)).toBeUndefined();
    for (const fake of [{}, { ...root }, Object.create(root!), structuredClone(root)]) {
      expect(extensionRootProof(fake as ExtensionRootV1)).toBeUndefined();
    }
    expect(Reflect.set(row.record, 'reference', { ...row.record.reference, incarnation: 'substituted' })).toBe(false);
    expect(Reflect.set(row.route, 'connection', 'substituted')).toBe(false);
    expect(Reflect.defineProperty(row, 'key', { get: () => 'substituted' })).toBe(false);
    expect(extensionRootProof(root!)).toBe(proof);
  });

  it('resolves and rechecks a selected member without traversing or copying the collection', async () => {
    await open();
    const row = record();
    send('snapshot', '1', { records: [row, record('sibling', 'sibling-uid')] });
    send('snapshotEnd', '2', { status: ready });
    const scans = [vi.spyOn(Map.prototype, Symbol.iterator), vi.spyOn(Map.prototype, 'keys'), vi.spyOn(Map.prototype, 'values'),
      vi.spyOn(Map.prototype, 'entries'), vi.spyOn(Map.prototype, 'forEach')];
    const before = scans.map(scan => scan.mock.calls.length);
    const root = extensionRootOf(row)!;
    const stop = subscribeExtensionRoot(root, () => {});
    const proof = extensionRootProof(root);
    const next = extensionRootOf(row);
    stop();
    const traversals = scans.map((scan, i) => scan.mock.calls.length - before[i]);
    for (const scan of scans) scan.mockRestore();
    expect(traversals).toEqual([0, 0, 0, 0, 0]);
    expect(proof?.rowKey).toBe(row.key);
    expect(next).toBe(root);
  });

  it('does not let a page reinsert a stale row into the native membership index', async () => {
    await open();
    const old = record();
    snapshot(old);
    const root = extensionRootOf(old)!;
    send('changes', '3', { upserts: [record(old.key, 'uid-1', 'replaced')] });
    const current = client.getSnapshot();
    expect(Reflect.set(current, 'records', new Map([[old.key, old]]))).toBe(false);
    current.records.forEach((_record, _key, rows) => {
      expect(rows).toBe(current.records);
      expect(() => Map.prototype.set.call(rows, old.key, old)).toThrow(TypeError);
    });
    expect(extensionRootOf(old)).toBeUndefined();
    expect(extensionRootProof(root)).toBeUndefined();
  });

  it('ignores equal and unrelated updates, but invalidates a replaced member before coalesced page delivery', async () => {
    await open();
    const row = record();
    snapshot(row);
    const root = extensionRootOf(row)!;
    const dropped = vi.fn();
    const clear = vi.fn(() => expect(extensionRootProof(root)).toBeUndefined());
    const page = vi.fn();
    client.subscribe(page);
    subscribeExtensionRoot(root, clear);
    const unsubscribe = subscribeExtensionRoot(root, dropped);
    unsubscribe();
    send('changes', '3', { upserts: [structuredClone(row), record('sibling', 'sibling-uid')], memberRevisions: ['1', '3'] });
    expect(extensionRootOf(row)).toBe(root);
    expect(clear).not.toHaveBeenCalled();
    send('changes', '4', { upserts: [record(row.key, 'uid-1', 'changed')] });
    expect(clear).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
    expect(page).not.toHaveBeenCalled();
    expect(extensionRootOf(row)).toBeUndefined();
    const changed = client.getSnapshot().records.get(row.key)!;
    const next = extensionRootOf(changed)!;
    expect(next).toBeDefined();
    expect(next).not.toBe(root);
    expect(extensionRootProof(next)?.viewGeneration).toBe('first:4');
    const replaced = record('row-2', 'uid-2');
    send('changes', '5', { removes: [{ key: row.key, addressKey: row.addressKey }], upserts: [replaced] });
    expect(extensionRootProof(next)).toBeUndefined();
    expect(extensionRootProof(extensionRootOf(replaced)!)?.reference.incarnation).toBe('uid-2');
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it.each(['gap', 'reset', 'failure', 'opening', 'refresh', 'native close', 'client close'])('clears on %s even when the page retains its last ready record', async reason => {
    await open();
    const row = record();
    snapshot(row);
    const root = extensionRootOf(row)!;
    const notified = vi.fn();
    const unsubscribe = subscribeExtensionRoot(root, notified);
    switch (reason) {
      case 'gap': send('changes', '4'); break;
      case 'reset': send('reset', '3', { reset: { reason: 'sourceReset', message: '' } }); break;
      case 'failure': send('status', '3', { status: { ...ready, state: 'failed' } }); break;
      case 'opening': send('status', '3', { status: { ...ready, state: 'opening' } }); break;
      case 'refresh': void client.refresh(); break;
      case 'native close': send('reset', '3', { reset: { reason: 'closed', message: '' } }); break;
      case 'client close': client.close(); break;
    }
    expect(notified).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot().records.get(row.key)).toBe(row);
    expect(extensionRootOf(row)).toBeUndefined();
    expect(extensionRootProof(root)).toBeUndefined();
    if (reason === 'failure' || reason === 'opening') {
      send('status', '4', { status: ready });
      expect(extensionRootOf(row)).toBeUndefined(); // Status alone cannot re-authorize the retained snapshot.
    }
    if (reason === 'native close') {
      send('snapshot', '1', { records: [structuredClone(row)], viewGeneration: 'late' });
      send('snapshotEnd', '2', { status: ready, viewGeneration: 'late' });
      expect(extensionRootOf(row)).toBeUndefined();
    }
    if (reason === 'gap' || reason === 'reset') {
      send('snapshot', '1', { records: [structuredClone(row)], viewGeneration: 'replacement' });
      expect(extensionRootOf(row)).toBeUndefined();
      send('snapshotEnd', '2', { status: ready, viewGeneration: 'replacement' });
      expect(client.getSnapshot().records.get(row.key)).toBe(row);
      expect(extensionRootProof(root)).toBeUndefined();
      expect(extensionRootProof(extensionRootOf(row)!)?.viewGeneration).toBe('replacement:1');
    }
    unsubscribe();
  });

  it('rejects old receipts for identical payloads and malformed or absent native receipt vectors', async () => {
    await open();
    const row = record();
    snapshot(row);
    const old = extensionRootOf(row)!;
    const same = structuredClone(row);
    send('changes', '3', { upserts: [same] });
    expect(extensionRootOf(row)).toBeUndefined();
    expect(extensionRootProof(old)).toBeUndefined();
    const next = extensionRootOf(same)!;
    expect(extensionRootProof(next)?.viewGeneration).toBe('first:3');
    send('changes', '4', { upserts: [structuredClone(same)], memberRevisions: [] });
    expect(extensionRootProof(next)).toBeUndefined();
    expect(extensionRootOf(client.getSnapshot().records.get(row.key)!)).toBeUndefined();
    send('changes', '5', { upserts: [structuredClone(same)], memberRevisions: ['0'] });
    expect(extensionRootOf(client.getSnapshot().records.get(row.key)!)).toBeUndefined();
  });

  it('refuses snapshot-only sources, missing incarnations, and envelopes outside the exact view target', async () => {
    await open(true);
    const row = record();
    snapshot(row, { ...ready, mode: 'snapshot', state: 'finished' });
    expect(extensionRootOf(row)).toBeUndefined();
    client.close();
    await open();
    const other = record('other');
    other.route.connection = 'east';
    const wrongTarget = record('unexpected');
    wrongTarget.targetId = 'another';
    const noUID = record('unbound', '');
    send('snapshot', '1', { records: [other, wrongTarget, noUID] });
    send('snapshotEnd', '2', { status: ready });
    for (const retained of client.getSnapshot().records.values()) expect(extensionRootOf(retained)).toBeUndefined();
  });
});
