import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ExtensionRootV1 } from '@omniviewdev/runtime/ui/v1';
import type * as Wire from '@omniviewdev/runtime/internal/extensions-v1';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ExtensionAuthority, type ExtensionSource } from './extensionAuthority';
import { useExtensionRelated } from './extensionRelated';

// Replace the native transport and its private source witness. Use the real
// manifest decoder, binding consent, lease, demand and React commit fences.
const native = vi.hoisted(() => ({ call: vi.fn(), proof: vi.fn(), subscribe: vi.fn() }));
vi.mock('@omniviewdev/runtime/runtime', () => ({ Call: { ByName: native.call } }));
vi.mock('@omniviewdev/runtime/internal/extensions-v1', async original => ({
  ...await original<typeof Wire>(), extensionRootProof: native.proof, subscribeExtensionRoot: native.subscribe,
}));

const protocol = { kind: 'view', protocol: 'owner/detail@1', fields: {}, read: { id: 'owner/edges@1', row: { direction: 'string', value: 'number' } } };
const owner: ExtensionSource = { id: 'owner', pin: `sha256:${'1'.repeat(64)}`, generation: 'owner-one', views: [], features: [], ordinaryReady: true,
  manifest: JSON.stringify({ schemaVersion: 1, id: 'owner', offers: [], bindings: [], points: [{ ...protocol, id: 'tabs', label: 'Details', placement: 'detail-tab',
    contract: { package: '@test/points', version: '1.0.0', export: 'tabs' } }] }) };
const peer: ExtensionSource = { id: 'peer', pin: `sha256:${'2'.repeat(64)}`, generation: 'peer-one', views: ['edges'], features: [], ordinaryReady: false,
  manifest: JSON.stringify({ schemaVersion: 1, id: 'peer', points: [], offers: [{ ...protocol, id: 'edges', label: 'Edges', requests: [], requestRead: true }],
    bindings: [{ offer: 'edges', target: 'owner/tabs' }] }) };
const point = 'owner/tabs', offer = 'peer/edges';

async function selected(read: boolean) {
  const authority = new ExtensionAuthority();
  await authority.replaceSources([peer, owner]);
  const declaration = authority.declaredPoint(point)!;
  const policy = { known: true, disabled: false, disabledBindings: [], disabledOffers: [], revision: 'one', grants: [
    { point, offer, ownerPin: owner.pin, contributorPin: peer.pin, contract: declaration.contract, fields: [], continuity: 'granted',
      ...(read && declaration.read ? { read: declaration.read } : {}) },
  ] };
  authority.replacePolicy(policy);
  function visit(uid = 'original', connection = 'west') {
    const placement = authority.setPlacement({}, { owner: owner.id, point, placement: 'detail-tab', ready: true, visible: true,
      context: {}, visit: {}, subject: 'authenticated', scopeKey: uid, connection })!;
    return authority.beginDemand(placement, authority.eligible(placement)[0])!;
  }

  return { authority, visit, policy, declaration };
}

function witnesses() {
  const listeners = new Map<ExtensionRootV1, () => void>();
  const proofs = new WeakMap<ExtensionRootV1, Wire.ExtensionRootProof>();
  native.proof.mockImplementation((root: ExtensionRootV1) => proofs.get(root));
  native.subscribe.mockImplementation((root: ExtensionRootV1, fn: () => void) => {
    listeners.set(root, fn); return () => listeners.delete(root);
  });
  function root(uid = 'original', connection = 'west') {
    const handle: ExtensionRootV1 = Object.freeze(Object.create(null));
    const proof = { owner: 'owner', connection, rowKey: 'opaque row', viewId: 'native view', viewGeneration: 'visit',
      reference: { address: { id: 'same-name', scope: [], authority: 'private authority', provider: 'private provider', type: 'record' }, incarnation: uid } };
    proofs.set(handle, proof);
    return { handle, proof, retire: () => {
      proofs.delete(handle); listeners.get(handle)?.();
    } };
  }

  return root;
}

function pending() {
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  const cancel = vi.fn(async () => undefined);
  return { call: Object.assign(promise, { cancel }), resolve, reject, cancel };
}

const ready = (rows: Array<Record<string, unknown>>, coverage: 'partial' | 'complete' = 'complete', truncated = false) => ({ state: 'ready', page: { rows, coverage, truncated } });
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeAll(() => {
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('TextEncoder', TextEncoder);
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.clearAllMocks();
});
afterAll(() => vi.unstubAllGlobals());

describe('related data on a selected view only', () => {
  it('does not call native for a missing read grant, missing proof, clone, wrong connection or same-name replacement UID', async () => {
    const make = witnesses(), good = make();
    const denied = await selected(false);
    const d = denied.visit();
    const h = renderHook(() => useExtensionRelated(denied.authority, d, good.handle));
    expect(h.result.current.related).toEqual({ state: 'unavailable' });
    h.unmount();
    const { authority, visit } = await selected(true);
    const demand = visit();
    const clone = Object.assign({}, good.handle);
    for (const root of [undefined, clone, make('original', 'east').handle, make('replaced').handle]) {
      const hook = renderHook(() => useExtensionRelated(authority, demand, root));
      expect(hook.result.current.related).toEqual({ state: 'unavailable' });
      hook.unmount();
    }

    await settle();
    expect(native.call).not.toHaveBeenCalled();
  });

  it('sends only a native binding selector and attested root, and publishes only immutable validated rows', async () => {
    const w = witnesses()(), p = pending();
    native.call.mockReturnValue(p.call);
    const { authority, visit, declaration } = await selected(true);
    const demand = visit();
    const hook = renderHook(() => useExtensionRelated(authority, demand, w.handle));
    expect(hook.result.current.related).toEqual({ state: 'loading' });
    await settle();
    expect(native.call).toHaveBeenCalledTimes(1);
    expect(native.call.mock.calls[0][0]).toMatch(/\.ExtensionReadService\.ReadRelatedV1$/);
    expect(JSON.parse(native.call.mock.calls[0][1] as string)).toEqual({ root: w.proof, binding: { point, offer, ownerPin: owner.pin, ownerGeneration: owner.generation,
      contributorPin: peer.pin, contributorGeneration: peer.generation, read: declaration.read, continuity: 'granted' } });
    const rows = [{ direction: 'in', value: 1 }, { direction: 'out', value: 2 }];
    await act(async () => {
      p.resolve(ready(rows, 'partial', true));
    });
    const snapshot = hook.result.current;
    expect(snapshot.related).toEqual({ state: 'ready', coverage: 'partial', truncated: true, rows });
    if (snapshot.related.state !== 'ready') {
      throw Error('Expected ready rows');
    }

    expect(Object.isFrozen(snapshot.related)).toBe(true);
    expect(Object.isFrozen(snapshot.related.rows)).toBe(true);
    expect(Object.isFrozen(snapshot.related.rows[0])).toBe(true);
    expect(snapshot.related.rows[0]).not.toBe(rows[0]);
    act(w.retire);
    expect(hook.result.current.related).toEqual({ state: 'unavailable' });
    expect(hook.result.current.revision).not.toBe(snapshot.revision);
  });

  it.each([false, true])('cancels across A → B → A and never publishes a stale settlement (reject=%s)', async reject => {
    const make = witnesses(), a = make(), b = make('other');
    const calls = [pending(), pending(), pending()];
    for (const { call } of calls) {
      native.call.mockReturnValueOnce(call);
    }

    const { authority, visit } = await selected(true);
    const d = visit();
    const h = renderHook(({ demand, root }) => useExtensionRelated(authority, demand, root), { initialProps: { demand: d, root: a.handle } });
    await settle();
    act(() => {
      h.rerender({ demand: visit('other'), root: b.handle });
    });
    await settle();
    act(() => {
      h.rerender({ demand: visit(), root: a.handle });
    });
    await settle();
    expect(native.call).toHaveBeenCalledTimes(3);
    expect(calls[0].cancel).toHaveBeenCalled();
    expect(calls[1].cancel).toHaveBeenCalled();
    await act(async () => {
      if (reject) {
        calls[0].reject({ get message() {
          throw Error('Do not inspect');
        } });
      } else {
        calls[0].resolve(ready([{ direction: 'old', value: 1 }]));
      }

      calls[1].resolve(ready([{ direction: 'other', value: 2 }]));
    });
    expect(h.result.current.related).toEqual({ state: 'loading' });
    await act(async () => {
      calls[2].resolve(ready([]));
    });
    expect(h.result.current.related).toEqual({ state: 'ready', rows: [], coverage: 'complete', truncated: false });
  });

  it('clears both successes and raw errors after revocation; a timeout aborts and a still stuck generation cannot start again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const root = witnesses()(), call = pending();
    native.call.mockReturnValue(call.call);
    const { authority, visit } = await selected(true);
    const demand = visit();
    const h = renderHook(({ d }) => useExtensionRelated(authority, d, root.handle), { initialProps: { d: demand } });
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(h.result.current.related).toEqual({ state: 'failed' });
    expect(call.cancel).toHaveBeenCalled();
    act(() => {
      h.rerender({ d: visit() });
    });
    await settle();
    expect(native.call).toHaveBeenCalledTimes(1);
    expect(h.result.current.related).toEqual({ state: 'unavailable' });
    act(() => {
      authority.clearPolicy();
    });
    await act(async () => {
      call.resolve(ready([{ direction: 'old', value: 1 }]));
    });
    expect(h.result.current.related).toEqual({ state: 'unavailable' });
  });

  it('rejects surplus, accessor, wrong-type, over-count, over-text and over-byte rows rather than painting a smaller complete page', async () => {
    const root = witnesses()();
    const { authority, visit } = await selected(true);
    const get = vi.fn(() => 'private');
    const row = { direction: 'x', value: 1 };
    const filled = Array.from({ length: 15 }, () => ({ ...row, direction: 'x'.repeat(4096) }));
    const overhead = JSON.stringify({ state: 'ready', rows: [...filled, { ...row, direction: '' }], coverage: 'complete', truncated: false }).length;
    const overEnvelope = [...filled, { ...row, direction: 'x'.repeat(65536 - overhead + 1) }];
    for (const data of [ready([{ ...row, private: 3 }]), ready([Object.defineProperty({ value: 1 }, 'direction', { get, enumerable: true })]),
      ready([{ ...row, value: '1' }]), ready(Array.from({ length: 129 }, () => row)), ready([{ ...row, direction: 'x'.repeat(4097) }]),
      ready(Array.from({ length: 17 }, () => ({ ...row, direction: 'x'.repeat(4096) }))), ready(overEnvelope)]) {
      const call = pending();
      native.call.mockReturnValue(call.call);
      const d = visit();
      const h = renderHook(() => useExtensionRelated(authority, d, root.handle));
      await settle();
      await act(async () => {
        call.resolve(data);
      });
      expect(h.result.current.related).toEqual({ state: 'failed' });
      h.unmount();
    }

    expect(get).not.toHaveBeenCalled();
  });
});
