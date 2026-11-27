import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtensionAuthority, type ExtensionSource } from './extensionAuthority';
import { evaluateExtensionFeature } from './extensionFeature';
import { EXTENSION_DEADLINE_MS } from './extensionRoleLoader';

const native = vi.hoisted(() => vi.fn());
vi.mock('@omniviewdev/runtime/api', () => ({ PluginManager: { ReadExtensionAsset: native } }));
const invoke = vi.fn<(name: string, input: Readonly<Record<string, string | number>>, signal: AbortSignal, moduleIdentity: unknown) => unknown>();
const facts = ['first', 'fourth', 'second', 'third'];
const names = [...facts, 'describe'].sort();
const code = `System.register([], function (publish) { return { execute: function () {
  const identity = {}; publish({ ${names.map(name => `${name}: (input, signal) => __roleInvocation('${name}', input, signal, identity)`).join(',')} });
} }; });`;
const fact = { kind: 'section', protocol: 'owner/data@1', fields: { number: 'number' }, schema: { label: 'string', value: 'string' } };
const menu = { kind: 'menu', protocol: 'owner/menu@1', fields: { fact: 'string', hidden: 'string' } };
const view = { kind: 'view', protocol: 'owner/view@1', fields: {} };
const points = [
  { ...fact, id: 'facts', label: 'Facts', placement: 'overview-section' }, { ...menu, id: 'actions', label: 'Actions', placement: 'context-menu' },
  { ...view, id: 'views', label: 'Views', placement: 'detail-tab' },
].map(p => ({ ...p, contract: { package: '@unit/points', version: '1.0.0', export: p.id } }));
const offers = [
  ...facts.map(id => ({ ...fact, id, label: 'Number', requests: ['number'] })),
  { ...menu, id: 'describe', label: 'Describe', action: { kind: 'info' }, requests: ['fact', 'hidden'] },
  { ...menu, id: 'jump', label: 'Open view', action: { kind: 'openView', point: 'owner/views', offer: 'panel' }, requests: [] },
  { ...view, id: 'panel', label: 'Panel', requests: [] },
];
const bindings = offers.map(o => ({ offer: o.id, target: `owner/${o.kind === 'section' ? 'facts' : o.kind === 'menu' ? 'actions' : 'views'}`,
  ...(o.id === 'describe' ? { when: [{ field: 'fact', equals: 'yes' }] } : {}) }));
const owner: ExtensionSource = { id: 'owner', pin: `sha256:${'a'.repeat(64)}`, generation: 'owner-one', ordinaryReady: true, features: [], views: [],
  manifest: JSON.stringify({ schemaVersion: 1, id: 'owner', points, offers: [], bindings: [] }) };
const peer: ExtensionSource = { id: 'peer', pin: `sha256:${'b'.repeat(64)}`, generation: 'peer-one', ordinaryReady: false, features: names, views: ['panel'],
  manifest: JSON.stringify({ schemaVersion: 1, id: 'peer', points: [], offers, bindings }) };
function response(source: string | Promise<string>): PromiseLike<string> & { readonly cancel: () => Promise<void> } {
  return Object.assign(Promise.resolve(source), { cancel: vi.fn(async () => undefined) });
}

async function host() {
  const a = new ExtensionAuthority();
  await a.replaceSources([peer, owner]);
  const policy = { known: true, revision: 'p1', disabled: false, disabledOffers: [], disabledBindings: [],
    grants: bindings.map(({ offer, target }) => ({ point: target, offer: `peer/${offer}`, ownerPin: owner.pin, contributorPin: peer.pin,
      contract: a.declaredPoint(target)!.contract, fields: ['number', 'fact'], continuity: 'issued' })) };
  a.replacePolicy(policy);
  const placements = points.map(point => a.setPlacement({}, { owner: owner.id, point: `owner/${point.id}`, visible: true, ready: true,
    placement: point.placement as 'overview-section' | 'context-menu' | 'detail-tab', visit: {}, connection: 'private', scopeKey: 'opaque', subject: 'object',
    context: { fact: 'yes', number: 7, get hidden() {
      throw new Error('denied descriptor');
    } } })!);
  const rows = placements.flatMap(p => a.eligible(p).map(row => ({ p, row })));
  const demand = (name: string) => {
    const { p, row } = rows.find(({ row }) => row.declaration.id === name)!;
    return a.beginDemand(p, row)!;
  };

  return { a, policy, placements, demand };
}

beforeAll(() => {
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('TextEncoder', TextEncoder);
  vi.stubGlobal('__roleInvocation', invoke);
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  native.mockReset().mockImplementation(() => response(code));
  invoke.mockReset().mockImplementation((name, input) => name === 'describe' ? { text: input.fact } : { label: name, value: String(input.number) });
});
afterEach(() => {
  vi.restoreAllMocks(); vi.useRealTimers();
});

describe('foreground scalar execution', () => {
  it('lists and selects openView without reading code; shares pinned feature code, never a projection, invocation or result', async () => {
    const { a, demand } = await host();
    await expect(evaluateExtensionFeature(a, demand('jump'))).rejects.toThrow('Feature unavailable');
    await expect(evaluateExtensionFeature(a, demand('panel'))).rejects.toThrow('Feature unavailable');
    expect(native).not.toHaveBeenCalled();
    const one = demand('first');
    const two = demand('describe');
    const result = await Promise.all([evaluateExtensionFeature(a, one), evaluateExtensionFeature(a, two)]);
    expect(native.mock.calls).toEqual([['peer', peer.pin, peer.generation, 'features']]);
    expect(invoke.mock.calls[0][3]).toBe(invoke.mock.calls[1][3]); // One evaluated module, not just one native read.
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ label: 'first', value: '7' }, { text: 'yes' }]);
    expect(result.every(Object.isFrozen)).toBe(true);
    expect(one.input).toEqual({ number: 7 });
    expect(two.input).toEqual({ fact: 'yes' });
    expect(Object.getPrototypeOf(two.input)).toBeNull();
    await expect(evaluateExtensionFeature(a, two)).rejects.toThrow('Feature unavailable');
    expect(invoke).toHaveBeenCalledTimes(2);
    a.dispose();
  });

  it.each(['allow', 'deny', 'retire', 'expire'] as const)('requires fresh host authorization after a cold role load: %s', async outcome => {
    const { a, demand } = await host();
    const reading = Promise.withResolvers<void>(), bytes = Promise.withResolvers<string>();
    const checking = Promise.withResolvers<void>(), permission = Promise.withResolvers<boolean>();
    native.mockImplementationOnce(() => {
      reading.resolve();
      return response(bytes.promise);
    });
    const authorize = vi.fn(async () => {
      checking.resolve(); return permission.promise;
    });
    if (outcome === 'expire') {
      vi.useFakeTimers();
    }

    const token = demand('describe');
    const result = evaluateExtensionFeature(a, token, authorize);
    const assertion = outcome === 'allow' ? expect(result).resolves.toEqual({ text: 'yes' }) : expect(result).rejects.toThrow('Feature unavailable');
    await reading.promise;
    expect(authorize).not.toHaveBeenCalled();
    bytes.resolve(code);
    await checking.promise;
    expect(invoke).not.toHaveBeenCalled();
    if (outcome === 'retire') {
      a.endDemand(token);
    }

    if (outcome === 'expire') {
      await vi.advanceTimersByTimeAsync(EXTENSION_DEADLINE_MS);
    }

    permission.resolve(outcome !== 'deny');
    await assertion;
    expect(authorize).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledTimes(outcome === 'allow' ? 1 : 0);
    a.dispose();
  });

  it('closes each scalar call at settlement and rechecks consent after cooperative cleanup', async () => {
    const { a, demand } = await host();
    const stop = vi.fn();
    const first = demand('describe');
    invoke.mockImplementationOnce((_name, _input, signal) => {
      signal.addEventListener('abort', stop, { once: true });
      return { text: 'First result' };
    });
    await expect(evaluateExtensionFeature(a, first)).resolves.toEqual({ text: 'First result' });
    expect(stop).toHaveBeenCalledOnce();
    expect(first.signal.aborted).toBe(false); // The surface, not the completed callable, still owns the result.
    invoke.mockImplementationOnce((_name, _input, signal) => {
      signal.addEventListener('abort', () => {
        a.clearPolicy();
      }, { once: true });
      return { text: 'Already withdrawn' };
    });
    await expect(evaluateExtensionFeature(a, demand('describe'))).rejects.toThrow('Feature unavailable');
    a.dispose();
  });

  it('reserves two automatic slots before I/O; queued or retired sections cannot consume the foreground lane', async () => {
    const { a, demand } = await host();
    const started = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<unknown>();
    let calls = 0;
    invoke.mockImplementation((name): { text: string } | Promise<unknown> => {
      if (name === 'describe') {
        return { text: name };
      }

      if (++calls === 2) {
        started.resolve();
      }

      return pending.promise;
    });
    const automatic = facts.map(demand);
    const running = automatic.map(async d => evaluateExtensionFeature(a, d));
    await started.promise;
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(facts.slice(0, 2));
    const withdrawn = expect(running[2]).rejects.toThrow('Feature unavailable');
    a.endDemand(automatic[2]);
    await withdrawn;
    await expect(evaluateExtensionFeature(a, demand('describe'))).resolves.toEqual({ text: 'describe' });
    expect(invoke).toHaveBeenCalledTimes(3);
    pending.resolve({ label: 'Done', value: '7' });
    await Promise.all([running[0], running[1], running[3]]);
    expect(invoke.mock.calls.map(([name]) => name)).toEqual([facts[0], facts[1], 'describe', facts[3]]);
    expect(native).toHaveBeenCalledOnce();
    a.dispose();
  });

  it.each(['success', 'failure'])('fences late %s after reissue without inspecting a rejected object or inspecting a stale result', async outcome => {
    const h = await host();
    const started = Promise.withResolvers<void>();
    const delayed = Promise.withResolvers<unknown>();
    const inspected = vi.fn(() => {
      throw Error('private');
    });
    invoke.mockImplementationOnce((): PromiseLike<unknown> => {
      started.resolve();
      return delayed.promise;
    });
    const d = h.demand('describe');
    const wait = expect(evaluateExtensionFeature(h.a, d)).rejects.toThrow('Feature unavailable');
    await started.promise;
    h.a.clearPolicy();
    h.a.replacePolicy(h.policy);
    await wait;
    expect(invoke.mock.calls[0][2].aborted).toBe(true);
    if (outcome === 'success') {
      delayed.resolve(new Proxy({ text: 'old value' }, { getOwnPropertyDescriptor: inspected, ownKeys: inspected }));
    } else {
      delayed.reject({ get message() {
        return inspected();
      }, get cause() {
        return inspected();
      } });
    }

    await Promise.resolve();
    expect(inspected).not.toHaveBeenCalled();
    expect(h.a.current(d)).toBe(false);
    h.a.dispose();
  });

  it('quarantines a timed-out invocation until the noncooperative provider settles, then permits a new explicit choice', async () => {
    const h = await host();
    const started = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<unknown>();
    invoke.mockImplementationOnce((): PromiseLike<unknown> => {
      started.resolve();
      return pending.promise;
    });
    vi.useFakeTimers();
    const expired = expect(evaluateExtensionFeature(h.a, h.demand('describe'))).rejects.toThrow('Feature unavailable');
    await started.promise;
    await vi.advanceTimersByTimeAsync(EXTENSION_DEADLINE_MS);
    await expired;
    expect(invoke.mock.calls[0][2].aborted).toBe(true);
    const withheld = h.demand('first');
    await expect(evaluateExtensionFeature(h.a, withheld)).rejects.toThrow('Feature unavailable');
    expect(invoke).toHaveBeenCalledOnce();
    pending.resolve({ text: 'stale' });
    await vi.advanceTimersByTimeAsync(0);
    await expect(evaluateExtensionFeature(h.a, withheld)).rejects.toThrow('Feature unavailable'); // No replay when quarantine lifts.
    await expect(evaluateExtensionFeature(h.a, h.demand('describe'))).resolves.toEqual({ text: 'yes' });
    expect(native).toHaveBeenCalledOnce();
    h.a.dispose();
  });

  it('refuses scalar imports and surplus executable exports without falling back to views or pages', async () => {
    const h = await host();
    for (const bytes of [code.replace('register([]', 'register([\'react\']'), code.replace('publish({', 'publish({extra: () => 1,')]) {
      native.mockReturnValueOnce(response(bytes));
      await expect(evaluateExtensionFeature(h.a, h.demand('describe'))).rejects.toThrow('Feature unavailable');
    }

    expect(native.mock.calls.map(call => call[3])).toEqual(['features', 'features']);
    expect(invoke).not.toHaveBeenCalled();
    h.a.dispose();
  });

  it('validates exact own text and compact UTF-8 bounds without running getters or formatting thrown values', async () => {
    const h = await host();
    const touch = vi.fn(() => {
      throw Error('private');
    });
    for (const result of [Object.create({ text: 'inherited' }), Object.defineProperty({}, 'text', { enumerable: true, get: touch }),
      { text: 'ok', extra: 1 }, { text: 'ok', [Symbol()]: true }, { text: 0 }, { text: '\u0001'.repeat(3000) }, { text: 'a'.repeat(4097) }]) {
      invoke.mockReturnValueOnce(result);
      await expect(evaluateExtensionFeature(h.a, h.demand('describe'))).rejects.toThrow('Feature unavailable');
    }

    invoke.mockReturnValueOnce({ label: 'x'.repeat(257), value: 'ok' });
    await expect(evaluateExtensionFeature(h.a, h.demand('first'))).rejects.toThrow('Feature unavailable');
    const failure: unknown = {
      get message() {
        return touch();
      },
    };
    invoke.mockImplementationOnce(() => {
      throw failure;
    });
    await expect(evaluateExtensionFeature(h.a, h.demand('describe'))).rejects.toThrow('Feature unavailable');
    expect(touch).not.toHaveBeenCalled();
    h.a.dispose();
  });

  it('never assimilates a surplus or stale thenable after a reentrant result descriptor', async () => {
    const h = await host();
    const then = vi.fn(() => {
      throw Error('ungranted callback');
    });
    invoke.mockReturnValueOnce(Object.defineProperty({ text: 'ok' }, 'then', { get: then }));
    await expect(evaluateExtensionFeature(h.a, h.demand('describe'))).rejects.toThrow('Feature unavailable');
    invoke.mockReturnValueOnce(new Proxy({}, {
      getOwnPropertyDescriptor() {
        h.a.clearPolicy(); return undefined;
      },
      get: then,
    }));
    await expect(evaluateExtensionFeature(h.a, h.demand('describe'))).rejects.toThrow('Feature unavailable');
    expect(then).not.toHaveBeenCalled();
    h.a.dispose();
  });

  it('aborts hidden work and refuses a hidden or cloned demand before reading any role', async () => {
    const h = await host();
    let hidden = true;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const d = h.demand('describe');
    await expect(evaluateExtensionFeature(h.a, d)).rejects.toThrow('Feature unavailable');
    hidden = false;
    await expect(evaluateExtensionFeature(h.a, { ...d })).rejects.toThrow('Feature unavailable');
    expect(native).not.toHaveBeenCalled();
    const started = Promise.withResolvers<void>();
    const bytes = Promise.withResolvers<string>();
    const request = response(bytes.promise);
    native.mockImplementationOnce(() => {
      started.resolve();
      return request;
    });
    const current = h.demand('describe');
    const wait = expect(evaluateExtensionFeature(h.a, current)).rejects.toThrow('Feature unavailable');
    await started.promise;
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await wait;
    expect(current.signal.aborted).toBe(true);
    expect(request.cancel).toHaveBeenCalledOnce();
    bytes.resolve(code);
    await bytes.promise;
    expect(invoke).not.toHaveBeenCalled();
    h.a.dispose();
  });
});
