import { createHash, webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExtensionEdge, ExtensionManifest, ExtensionOffer, ExtensionPoint } from '@omniviewdev/runtime/internal/extensions-v1';
import {
  ExtensionAuthority, type ExtensionBinding, type ExtensionGrant, type ExtensionOutlet, type ExtensionPolicy, type ExtensionSource,
} from './extensionAuthority';

// JSDOM does not implement Web Crypto digests. Exercise the real SHA-256 and UTF-8 implementations, not a canned pin.
beforeAll(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('TextEncoder', TextEncoder);
});
afterAll(() => vi.unstubAllGlobals());

const point = 'owner/tabs';
const offer = 'peer/detail';
const locator = { package: '@unit/points', version: '1.2.0', export: 'tabs' };
const definition = {
  protocol: 'owner/item@1', kind: 'view', fields: { kind: 'string', tag: 'string', count: 'number' }, optional: ['tag'],
  read: { id: 'owner/rows@1', row: { title: 'string', rank: 'number' } },
} as const;
const tabs = { ...definition, id: 'tabs', placement: 'detail-tab', label: 'Detail', contract: locator } as const satisfies ExtensionPoint;
const detail = { ...definition, id: 'detail', label: 'Shared label', requests: ['kind', 'tag', 'count'], requestRead: true } as const satisfies ExtensionOffer;
const edge: ExtensionEdge = { offer: 'detail', target: point };
const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const pin = (id: string) => `sha256:${digest(id)}`;

function source(id: string, points: readonly ExtensionPoint[], offers: readonly ExtensionOffer[], bindings: readonly ExtensionEdge[]): ExtensionSource {
  const manifest: ExtensionManifest = { schemaVersion: 1, id, points, offers, bindings };
  return { id, pin: pin(id), generation: 'one', manifest: JSON.stringify(manifest), ordinaryReady: points.length > 0,
    features: offers.filter(o => o.kind === 'section' || (o.kind === 'menu' && o.action.kind === 'info')).map(o => o.id).sort(),
    views: offers.filter(o => o.kind === 'view').map(o => o.id).sort() };
}

const owner = source('owner', [tabs], [], []);
const peer = source('peer', [], [detail], [edge]);

function grant(a: ExtensionAuthority, patch: Partial<ExtensionGrant> = {}): ExtensionGrant {
  return { point, offer, ownerPin: owner.pin, contributorPin: peer.pin, contract: a.declaredPoint(point)!.contract,
    fields: ['kind'], continuity: 'issued', ...patch };
}

function policy(grants: readonly ExtensionGrant[], patch: Partial<ExtensionPolicy> = {}): ExtensionPolicy {
  return { known: true, disabled: false, revision: 'rev-1', disabledBindings: [], disabledOffers: [], grants, ...patch };
}

const visit = {};
function outlet(patch: Partial<ExtensionOutlet> = {}): ExtensionOutlet {
  return { point, owner: 'owner', placement: 'detail-tab', ready: true, visible: true, subject: 'item', connection: 'west',
    visit, scopeKey: 'first-incarnation', context: { kind: 'item', count: 1 }, ...patch };
}

async function admitted(fields: readonly string[] = ['kind']) {
  const a = new ExtensionAuthority();
  await a.replaceSources([peer, owner]);
  const row = grant(a, { fields });
  a.replacePolicy(policy([row]));
  const binding = a.point(point)[0];
  const holder = {};
  const placement = a.setPlacement(holder, outlet())!;
  return { a, row, binding, holder, placement };
}

describe('static admission from the actual wire decoder and native pins', () => {
  it('parks an absent owner; exposes exact reproducible contract/read digests without loading pages or granting a binding', async () => {
    const a = new ExtensionAuthority();
    await a.replaceSources([peer]);
    expect(a.point(point)).toEqual([]);
    await a.replaceSources([peer, owner]);
    const read = ['owner/rows@1', [['rank', 'number'], ['title', 'string']]];
    const canonical = ['detail-tab', 'owner/item@1', 'view', [['count', 'number'], ['kind', 'string'], ['tag', 'string']], ['tag'], null, read];
    const info = a.declaredPoint(point)!;
    expect(info.contract).toBe(digest(JSON.stringify(canonical)));
    expect(info.read).toBe(digest(JSON.stringify(read)));
    expect(Object.isFrozen(info.declaration.fields)).toBe(true);
    expect(a.point(point)).toEqual([]);
    for (const patch of [{ ownerPin: pin('stale') }, { contributorPin: pin('stale') }, { contract: digest('look-alike') }]) {
      a.replacePolicy(policy([grant(a, patch)]));
      expect(a.point(point)).toEqual([]);
    }

    a.replacePolicy(policy([grant(a, { fields: [], read: digest('other') })]));
    expect(a.point(point)[0]).toMatchObject({ point, offer, fields: [] });
    expect(a.point(point)[0]).not.toHaveProperty('read');
    a.replacePolicy(policy([grant(a, { fields: [], read: info.read })]));
    expect(a.point(point)[0].read).toBe(info.read);
    a.setOrdinaryReady('owner', false);
    expect(a.declaredPoint(point)).toBe(info);
    expect(a.point(point)).toEqual([]);
    a.setOrdinaryReady('owner', true);
    expect(a.point(point).map(b => b.offer)).toEqual([offer]); // Route-less peer never passed ordinary admission.
  });

  it('matches by full private definition, not protocol name, npm locator, label, or map/optional order', async () => {
    const otherPoint: ExtensionPoint = { ...tabs, optional: ['kind', 'tag'] };
    const valid = { ...detail, optional: ['tag', 'kind'], fields: { tag: 'string', count: 'number', kind: 'string' },
      read: { id: definition.read.id, row: { rank: 'number', title: 'string' } } } as const satisfies ExtensionOffer;
    const variants: ExtensionOffer[] = [valid, { ...valid, protocol: 'owner/item@2' }, { ...valid, fields: { kind: 'string', count: 'string', tag: 'string' } },
      { ...valid, optional: ['tag'] }, { ...valid, read: { ...definition.read, id: 'owner/rows@2' } },
      { ...valid, read: { ...definition.read, row: { rank: 'string', title: 'string' } as const } },
      { kind: 'menu', protocol: valid.protocol, id: 'detail', label: valid.label, fields: valid.fields, optional: valid.optional,
        action: { kind: 'info' }, requests: valid.requests }];
    const peers = variants.map((v, i) => source(`peer${i}`, [], [v], [edge]));
    const a = new ExtensionAuthority();
    await a.replaceSources([...peers, source('owner', [otherPoint], [], [])]);
    a.replacePolicy(policy(peers.map(p => grant(a, { offer: `${p.id}/detail`, contributorPin: p.pin }))));
    expect(a.point(point).map(b => b.offer)).toEqual(['peer0/detail']);
  });

  it('uses the SDK publication without accepting an inline shadow or a surplus named export', async () => {
    const p: ExtensionPoint = { id: 'facts', label: 'Facts', protocol: 'visuals/utilization@1', kind: 'section', placement: 'overview-section', contract: locator };
    const o: ExtensionOffer = { id: 'fact', label: 'Fact', protocol: p.protocol, kind: 'section', requests: ['used', 'capacity'] };
    const e = { offer: o.id, target: 'owner/facts' };
    const good = source('good', [], [o], [e]);
    const shadow = source('bad', [], [{ ...o, fields: { used: 'number' }, schema: { label: 'string', value: 'string' } }], [e]);
    const extra = { ...source('extra', [], [o], [e]), features: ['extra', 'fact'] };
    const missing = { ...source('missing', [], [o], [e]), features: [] };
    const a = new ExtensionAuthority();
    await a.replaceSources([source('owner', [p], [], []), good, shadow, extra, missing]);
    a.replacePolicy(policy([good, shadow, extra, missing].map(s => ({ point: e.target, offer: `${s.id}/fact`, ownerPin: owner.pin,
      contributorPin: s.pin, contract: a.declaredPoint(e.target)!.contract, fields: ['capacity', 'used'], continuity: 'one' }))));
    const bindings = a.point(e.target);
    expect(bindings.map(b => b.offer)).toEqual(['good/fact']);
    const l = a.setPlacement({}, outlet({ point: e.target, placement: p.placement, context: { capacity: 3, used: 0 } }))!;
    expect(a.beginDemand(l, bindings[0])!.input).toEqual({ capacity: 3, used: 0 });
  });

  it('withdraws only the bad replacement immediately; no duplicate JSON member or changed evidence under an old digest can publish', async () => {
    const a = new ExtensionAuthority();
    const sibling = source('sibling', [], [detail], [edge]);
    await a.replaceSources([owner, peer, sibling]);
    a.replacePolicy(policy([grant(a), grant(a, { offer: 'sibling/detail', contributorPin: sibling.pin })]));
    const [old, survivor] = a.point(point);
    const l = a.setPlacement({}, outlet())!;
    const d = a.beginDemand(l, old)!;
    const malformed = { ...peer, pin: pin('new'), manifest: peer.manifest.replace('"id":"peer"', '"id":"wrong","id":"peer"') };
    const switched = a.replaceSources([owner, malformed, sibling]);
    expect(d.signal.aborted).toBe(true);
    expect(a.point(point)).toEqual([survivor]);
    await switched;
    expect(a.point(point)[0]).toBe(survivor);
    // Reapprove the new pin: the decoder must still have rejected the duplicate member, not just an obsolete grant.
    a.replacePolicy(policy([grant(a, { contributorPin: malformed.pin }), grant(a, { offer: 'sibling/detail', contributorPin: sibling.pin })]));
    expect(a.point(point)).toEqual([survivor]);
    await a.replaceSources([owner, peer, sibling]);
    a.replacePolicy(policy([grant(a)]));
    expect(a.point(point)).toHaveLength(1);
    await a.replaceSources([owner, { ...peer, manifest: `${peer.manifest} ` }, sibling]);
    expect(a.point(point)).toEqual([]);
    await a.replaceSources([owner, peer, sibling]);
    expect(a.point(point)).toEqual([]);
  });

  it('cannot install a source after its pending digest was retired, replaced, or disposed', async () => {
    const a = new ExtensionAuthority();
    const beforeStop = a.replaceSources([owner, peer]);
    a.retireSource('owner');
    await beforeStop;
    expect(a.declaredPoint(point)).toBeUndefined();
    const beforeReload = a.replaceSources([owner, peer]);
    const reload = a.replaceSources([{ ...owner, generation: 'two' }, peer]);
    await Promise.all([reload, beforeReload]);
    expect(a.declaredPoint(point)?.sourceGeneration).toBe('two');
    const beforeDispose = a.replaceSources([{ ...owner, generation: 'three' }, peer]);
    a.dispose();
    await beforeDispose;
    expect(a.declaredPoint(point)).toBeUndefined();
  });
});

describe('stable ordered, point-local authority', () => {
  it('keeps independently granted rows stable through grant reordering and unrelated reload, and fences only the targeted pair', async () => {
    const second = 'owner/second';
    const secondOwner = source('owner', [tabs, { ...tabs, id: 'second', contract: { ...locator, export: 'second' } }], [], []);
    const both = source('peer', [], [detail], [edge, { ...edge, target: second }]);
    const a = new ExtensionAuthority();
    await a.replaceSources([both, secondOwner]);
    const firstGrant = grant(a, { fields: ['tag', 'kind'] });
    const secondGrant = grant(a, { point: second, contract: a.declaredPoint(second)!.contract, fields: [] });
    a.replacePolicy(policy([firstGrant, secondGrant]));
    const firstList = a.point(point);
    const secondList = a.point(second);
    const changed = vi.fn();
    const other = vi.fn();
    const stop = a.subscribePoint(point, changed);
    a.subscribePoint(second, other);
    const l = a.setPlacement({}, outlet())!;
    const d = a.beginDemand(l, firstList[0])!;
    a.replacePolicy(policy([secondGrant, { ...firstGrant, fields: ['kind', 'tag', 'unrequested'] }], { revision: 'rev-2' }));
    expect(a.point(point)).toBe(firstList);
    await a.replaceSources([secondOwner, both, source('unrelated', [], [], [])]);
    expect(changed).not.toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    a.retireGrants([{ point: second, offer }]);
    expect(a.point(second)).toEqual([]);
    expect(other).toHaveBeenCalledTimes(1);
    expect(a.current(d)).toBe(true);
    expect(changed).not.toHaveBeenCalled();
    a.replacePolicy(policy([secondGrant, firstGrant]));
    expect(a.point(second)[0]).not.toBe(secondList[0]);
    expect(a.point(point)).toBe(firstList);
    a.replacePolicy(policy([secondGrant, firstGrant], { disabledOffers: [offer] }));
    expect(a.point(second)).toEqual([]);
    expect(a.point(point)).toEqual([]);
    expect(d.signal.aborted).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
    a.replacePolicy(policy([firstGrant, secondGrant], { disabledBindings: [{ point: second, offer }] }));
    expect(a.point(point)).toHaveLength(1);
    expect(a.point(second)).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('links edits of unrequested fields on this same row only through the exact native reread; a requested change fences immediately', async () => {
    const a = new ExtensionAuthority();
    await a.replaceSources([owner, source('peer', [], [{ ...detail, requests: ['kind'] }], [edge])]);
    const original = grant(a, { fields: ['kind', 'tag'] });
    a.replacePolicy(policy([original]));
    const before = a.point(point);
    const placement = a.setPlacement({}, outlet())!;
    const demand = a.beginDemand(placement, before[0])!;
    const changed = vi.fn();
    a.subscribePoint(point, changed);
    // Both are real owner fields. This contributor requested neither and has no authority to see either.
    a.retireGrants([{ point, offer, fields: ['count', 'tag'] }], 'file-2');
    expect(a.current(demand)).toBe(true);
    a.replacePolicy(policy([{ ...original, fields: ['count', 'kind'], continuity: 'file-2' }], { revision: 'file-2' }));
    expect(a.point(point)).toBe(before);
    a.retireGrants([{ point, offer, fields: ['count'] }], 'file-3');
    a.replacePolicy(policy([{ ...original, fields: ['kind'], continuity: 'file-3' }], { revision: 'file-3' }));
    expect(a.point(point)).toBe(before);
    expect(changed).not.toHaveBeenCalled();
    a.retireGrants([{ point, offer, fields: ['kind'] }], 'file-4');
    expect(demand.signal.aborted).toBe(true);
    expect(a.point(point)).toEqual([]);
    a.retireGrants([{ point, offer, fields: ['tag'] }], 'file-5');
    expect(a.beginDemand(placement, before[0])).toBeUndefined(); // No event grants or resurrects a row.
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['unexpected snapshot revision', 'later', 'next', ['kind', 'unused']],
    ['different row issuance', 'next', 'other', ['kind', 'unused']],
    ['different symmetric difference', 'next', 'next', ['kind', 'other']],
    ['old snapshot and old row', 'rev-1', 'issued', ['kind']],
  ] as const)('fences the old demand on %s, even though effective fields are identical', async (_why, revision, continuity, fields) => {
    const { a, row, binding, placement } = await admitted();
    const demand = a.beginDemand(placement, binding)!;
    a.retireGrants([{ point, offer, fields: ['unused'] }], 'next');
    a.replacePolicy(policy([{ ...row, continuity, fields }], { revision }));
    expect(demand.signal.aborted).toBe(true);
    expect(a.point(point)[0]).not.toBe(binding);
    expect(a.point(point)[0].fields).toEqual(['kind']);
  });

  it('takes the first 32 statically eligible bindings in ASCII order before predicates, then applies the actual surface cap', async () => {
    const offers = Array.from({ length: 33 }, (_, i) => ({ ...detail, id: i === 0 ? 'Z-first' : `a${String(i).padStart(2, '0')}` }));
    const edges = offers.map((o, i) => ({ target: point, offer: o.id,
      ...(i === 32 ? {} : { when: [{ field: 'kind', equals: 'match' }] }) }));
    const a = new ExtensionAuthority();
    await a.replaceSources([source('peer', [], [...offers].reverse(), [...edges].reverse()), owner]);
    const grants = offers.map(o => grant(a, { offer: `peer/${o.id}` }));
    a.replacePolicy(policy([...grants].reverse()));
    const bindings = a.point(point);
    expect(bindings.map(b => b.offer)).toEqual(grants.slice(0, 32).map(g => g.offer));
    const holder = {};
    const l = a.setPlacement(holder, outlet())!;
    expect(a.eligible(l)).toEqual([]); // Do not visit the unconditional 33rd offer on 32 nonmatches.
    a.replacePolicy(policy(grants.slice(1)));
    expect(a.eligible(l).map(b => b.offer)).toEqual([grants[32].offer]);
    a.setPlacement(holder, outlet({ context: { kind: 'match' } }));
    expect(a.eligible(l)).toEqual(a.point(point).slice(0, 4));
    expect(a.beginDemand(l, a.point(point)[4])).toBeUndefined();
    a.replacePolicy(policy(grants.slice(2)));
    const fourth = a.eligible(l)[3];
    const active = a.beginDemand(l, fourth)!;
    a.replacePolicy(policy(grants.slice(1)));
    expect(a.point(point)).toContain(fourth);
    expect(active.signal.aborted).toBe(true); // Still statically admitted, but no longer visible.
  });

  it('does not let unavailable menu destinations displace an actionable row at listing, selection or settlement', async () => {
    const target = 'owner/actions';
    const proto = { kind: 'menu', protocol: 'owner/menu@1', fields: { kind: 'string' } } as const;
    const actions = { ...proto, id: 'actions', label: 'Actions', placement: 'context-menu', contract: { ...locator, export: 'actions' } } as const;
    const open = { ...proto, label: 'Open', requests: ['kind'], action: { kind: 'openView', point, offer: 'detail' } } as const;
    const offers: ExtensionOffer[] = [
      ...Array.from({ length: 12 }, (_, i) => ({ ...open, id: `open-${i}` })),
      { ...proto, id: 'show', label: 'Info', requests: ['kind'], action: { kind: 'info' } } as const,
    ];
    const a = new ExtensionAuthority();
    await a.replaceSources([source('owner', [tabs, actions], [], []),
      source('peer', [], [detail, ...offers], [edge, ...offers.map(o => ({ target, offer: o.id }))])]);
    const grants = offers.map(o => grant(a, { point: target, contract: a.declaredPoint(target)!.contract, offer: `peer/${o.id}` }));
    a.replacePolicy(policy(grants));
    const read = vi.fn((record: { kind: string }, key: PropertyKey) => Object.getOwnPropertyDescriptor(record, key));
    const holder = {};
    const here = outlet({ point: target, placement: 'context-menu', context: new Proxy({ kind: 'item' }, { getOwnPropertyDescriptor: read }) });
    const placement = a.setPlacement(holder, here)!;
    const rows = a.point(target);
    const last = rows.at(-1)!;
    const screen = (b: ExtensionBinding) => b.declaration.kind === 'menu' &&
      (b.declaration.action.kind === 'info' || a.point(point).some(view => view.offer === offer));
    expect(a.eligible(placement)).toEqual(rows.slice(0, 12));
    expect(a.eligible(placement, screen)).toEqual([last]);
    expect(a.beginDemand(placement, rows[0], screen)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    const active = a.beginDemand(placement, last, screen)!;
    expect(active.input).toEqual({ kind: 'item' });
    a.replacePolicy(policy([...grants, grant(a)])); // The distinct destination grant makes all twelve earlier rows actionable.
    expect(a.eligible(placement, screen)).toEqual(rows.slice(0, 12));
    expect(a.current(active)).toBe(false);
    expect(active.signal.aborted).toBe(true);
    read.mockClear();
    const stale = vi.fn(() => {
      a.setPlacement(holder, here); return true;
    });
    expect(a.eligible(placement, stale)).toEqual([]);
    expect(stale).toHaveBeenCalledOnce();
    expect(a.beginDemand(placement, rows[0], stale)).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    a.dispose();
  });

  it('does not inspect any predicate fact with a missing grant, or the remaining projection on nonmatch', async () => {
    const tested = source('peer', [], [detail], [{ ...edge, when: [{ field: 'kind', equals: 'item' }, { field: 'tag', equals: 'ok' }] }]);
    const a = new ExtensionAuthority();
    await a.replaceSources([owner, tested]);
    const reads: PropertyKey[] = [];
    const target = { kind: 'different', tag: 'ok', count: 3 };
    const context = new Proxy(target, {
      ownKeys() {
        throw Error('enumerated'); 
      }, get() {
        throw Error('accessed a value'); 
      },
      getOwnPropertyDescriptor(obj, key) {
        reads.push(key); return Object.getOwnPropertyDescriptor(obj, key); 
      },
    });
    const l = a.setPlacement({}, outlet({ context }))!;
    a.replacePolicy(policy([grant(a, { fields: ['kind', 'count'] })]));
    expect(a.eligible(l)).toEqual([]);
    expect(reads).toEqual([]);
    a.replacePolicy(policy([grant(a, { fields: ['count', 'kind', 'tag'] })]));
    const binding = a.point(point)[0];
    expect(a.beginDemand(l, binding)).toBeUndefined();
    expect(reads).toEqual(['kind']);
    reads.length = 0;
    target.kind = 'item';
    expect(a.eligible(l)).toEqual([binding]);
    expect(reads).toEqual(['kind', 'tag']);
    reads.length = 0;
    const d = a.beginDemand(l, binding)!;
    expect(reads).toEqual(['kind', 'tag', 'count']);
    expect(Object.getPrototypeOf(d.input)).toBeNull();
    expect(Object.isFrozen(d.input)).toBe(true);
    expect(d.input).toEqual(target);
    target.tag = 'changed';
    expect(a.current(d)).toBe(false);
    expect(d.signal.aborted).toBe(true);
  });
});

describe('placement and demand lifetimes', () => {
  it('requires this ready visible owner/placement and exact incarnation; a stale disposer cannot close the replacement', async () => {
    const { a, binding, holder, placement } = await admitted();
    const d = a.beginDemand(placement, binding)!;
    const b = a.setPlacement(holder, outlet({ subject: 'B' }))!;
    const again = a.setPlacement(holder, outlet())!;
    expect(new Set([placement.generation, b.generation, again.generation]).size).toBe(3);
    expect(a.current(d)).toBe(false);
    a.endPlacement(placement);
    expect(a.beginDemand(again, binding)).toBeDefined();
    for (const patch of [{ visible: false }, { ready: false }, { owner: 'not-owner' }, { placement: 'sidebar' as const },
      { scopeKey: undefined }, { scopeKey: '' }, { scopeKey: 'x'.repeat(257) }]) {
      expect(a.setPlacement(holder, outlet(patch))).toBeUndefined();
      expect(a.beginDemand(again, binding)).toBeUndefined();
    }

    const west = a.setPlacement(holder, outlet())!;
    const east = a.setPlacement(holder, outlet({ connection: 'east' }))!;
    const other = a.setPlacement(holder, outlet({ connection: 'east', scopeKey: 'replacement' }))!;
    const newVisit = a.setPlacement(holder, outlet({ connection: 'east', scopeKey: 'replacement', visit: {} }))!;
    expect(new Set([west, east, other, newVisit]).size).toBe(4);
    expect(a.beginDemand(newVisit, { ...binding })).toBeUndefined();
    expect(a.beginDemand({ ...newVisit }, binding)).toBeUndefined();
  });

  it('needs explicit empty consent for a context-free sidebar and never passes its workspace locator to the contributor', async () => {
    const p: ExtensionPoint = { id: 'tools', label: 'Tools', kind: 'view', placement: 'sidebar', protocol: 'owner/tools@1', fields: {}, contract: locator };
    const o: ExtensionOffer = { id: 'tool', label: 'Tool', kind: 'view', protocol: p.protocol, fields: {}, requests: [] };
    const target = 'owner/tools';
    const a = new ExtensionAuthority();
    await a.replaceSources([source('owner', [p], [], []), source('peer', [], [o], [{ offer: o.id, target }])]);
    const neverRead = vi.fn(() => {
      throw Error('sidebar context inspected'); 
    });
    const l = a.setPlacement({}, outlet({ point: target, placement: 'sidebar', scopeKey: undefined, subject: 'workspace',
      context: new Proxy({}, { ownKeys: neverRead, get: neverRead, getOwnPropertyDescriptor: neverRead }) }))!;
    expect(a.eligible(l)).toEqual([]);
    a.replacePolicy(policy([{ point: target, offer: 'peer/tool', ownerPin: owner.pin, contributorPin: peer.pin,
      contract: a.declaredPoint(target)!.contract, fields: [], continuity: 'explicit-empty' }]));
    const [binding] = a.eligible(l);
    expect(a.beginDemand(l, binding)?.input).toEqual({});
    expect(neverRead).not.toHaveBeenCalled();
  });

  it('retires a reissued grant with identical fields, and retires formerly read-enabled state when only its read is withdrawn', async () => {
    const { a, row, binding, placement } = await admitted();
    const d = a.beginDemand(placement, binding)!;
    const reissued = { ...row, continuity: 'issued-again' };
    a.replacePolicy(policy([reissued]));
    expect(d.signal.aborted).toBe(true);
    expect(a.point(point)[0].generation).not.toBe(binding.generation);
    a.replacePolicy(policy([{ ...reissued, read: a.declaredPoint(point)!.read }]));
    const permitted = a.beginDemand(placement, a.point(point)[0])!;
    expect(permitted.binding.read).toBe(a.declaredPoint(point)!.read);
    a.replacePolicy(policy([reissued]));
    expect(permitted.signal.aborted).toBe(true);
    expect(a.beginDemand(placement, a.point(point)[0])?.binding).not.toHaveProperty('read');
  });

  it('withdraws read work immediately but preserves scalar selection only across the exact witnessed read-only edit', async () => {
    const { a, row, placement } = await admitted();
    const read = a.declaredPoint(point)!.read!;
    a.replacePolicy(policy([{ ...row, read }]));
    const selected = a.point(point)[0];
    const permitted = a.beginDemand(placement, selected)!;
    expect(a.readScope(permitted)).toEqual({ subject: 'item', connection: 'west', scopeKey: 'first-incarnation', continuity: 'issued' });
    a.retireGrants([{ point, offer, readOnly: true }], 'next');
    expect(permitted.signal.aborted).toBe(true);
    expect(a.readScope(permitted)).toBeUndefined();
    const withheld = a.point(point)[0];
    expect(withheld.generation).not.toBe(selected.generation);
    expect(withheld.selectionGeneration).toBe(selected.selectionGeneration);
    const scalar = a.beginDemand(placement, withheld)!;
    expect(a.readScope(scalar)).toBeUndefined();
    a.replacePolicy(policy([{ ...row, continuity: 'next' }], { revision: 'next' }));
    expect(a.point(point)[0]).toBe(withheld);
    expect(a.current(scalar)).toBe(true);
    a.retireGrants([{ point, offer, readOnly: true }], 'another');
    expect(a.readScope(scalar)).toBeUndefined(); // No invalidation can add consent.
    a.replacePolicy(policy([{ ...row, read, continuity: 'another' }], { revision: 'another' }));
    expect(a.point(point)[0].selectionGeneration).toBe(selected.selectionGeneration);
    expect(a.readScope(a.beginDemand(placement, a.point(point)[0])!)?.continuity).toBe('another');
    a.retireGrants([{ point, offer, readOnly: true }], 'claimed');
    a.replacePolicy(policy([{ ...row, continuity: 'different' }], { revision: 'different' }));
    expect(a.point(point)[0].selectionGeneration).not.toBe(selected.selectionGeneration);
  });

  it('screens only menu grants of the admitted ordinary owner generation, without accessing an outlet', async () => {
    const proto = { kind: 'menu', protocol: 'owner/menu@1', fields: { item: 'string' } } as const;
    const menu = { ...proto, id: 'actions', label: 'Actions', placement: 'context-menu', contract: { ...locator, export: 'actions' } } as const;
    const item = { ...proto, id: 'info', label: 'Info', requests: ['item'], action: { kind: 'info' } } as const;
    const a = new ExtensionAuthority();
    await a.replaceSources([source('owner', [tabs, menu], [], []), source('peer', [], [detail, item], [edge, { target: 'owner/actions', offer: 'info' }])]);
    a.replacePolicy(policy([grant(a)]));
    expect(a.hasMenuBindings('owner', 'one')).toBe(false);
    a.replacePolicy(policy([grant(a, { point: 'owner/actions', offer: 'peer/info', contract: a.declaredPoint('owner/actions')!.contract })]));
    expect(a.hasMenuBindings('owner', 'one')).toBe(true);
    expect(a.hasMenuBindings('owner', 'other')).toBe(false);
    const notify = vi.fn();
    const stop = a.subscribeMenuBindings('owner', 'one', notify);
    a.setOrdinaryReady('owner', false);
    expect(a.hasMenuBindings('owner', 'one')).toBe(false);
    expect(notify).toHaveBeenCalledOnce();
    stop();
    a.setOrdinaryReady('owner', true);
    expect(notify).toHaveBeenCalledOnce();
  });

  it('preserves equal effective scalars, fences changed ones and suppresses a late success AND failure through revoke/regrant', async () => {
    const { a, binding, row, holder, placement } = await admitted();
    const one = a.beginDemand(placement, binding)!;
    const two = a.beginDemand(placement, binding)!;
    expect(one.signal.aborted).toBe(true);
    expect(two.generation).not.toBe(one.generation);
    expect(a.setPlacement(holder, outlet({ context: { kind: 'item', count: 999 } }))).toBe(placement);
    expect(a.current(two)).toBe(true);
    a.setPlacement(holder, outlet({ context: { kind: 'changed' } }));
    expect(two.signal.aborted).toBe(true);
    const three = a.beginDemand(placement, binding)!;
    const shown = vi.fn();
    const success = Promise.resolve().then(() => {
      if (a.current(three)) {
        shown('value');
      } 
    });
    const failure = Promise.reject(new Error('stale failure')).catch(() => {
      if (a.current(three)) {
        shown('failure');
      } 
    });
    a.clearPolicy();
    a.replacePolicy(policy([row]));
    expect(three.signal.aborted).toBe(true);
    expect(a.point(point)[0]).not.toBe(binding);
    expect(a.beginDemand(placement, binding)).toBeUndefined();
    await Promise.all([success, failure]);
    expect(shown).not.toHaveBeenCalled();
    const active = a.beginDemand(placement, a.point(point)[0])!;
    a.replacePolicy(policy([row], { disabled: true }));
    expect(a.current(active)).toBe(false);
    a.replacePolicy(policy([row], { known: false }));
    expect(a.point(point)).toEqual([]);
  });

  it('retires both incoming and outgoing work on either source lifetime, even when pins stay identical', async () => {
    const { a, binding, placement } = await admitted();
    const d = a.beginDemand(placement, binding)!;
    const restart = a.replaceSources([owner, { ...peer, generation: 'two' }]);
    expect(d.signal.aborted).toBe(true);
    await restart;
    const afterPeer = a.point(point)[0];
    expect(afterPeer.contributorGeneration).toBe('two');
    const second = a.beginDemand(placement, afterPeer)!;
    const ownerRestart = a.replaceSources([{ ...owner, generation: 'two' }, { ...peer, generation: 'two' }]);
    expect(second.signal.aborted).toBe(true);
    await ownerRestart;
    expect(a.beginDemand(placement, a.point(point)[0])).toBeUndefined();
    const next = a.setPlacement({}, outlet())!;
    const last = a.beginDemand(next, a.point(point)[0])!;
    a.dispose();
    expect(last.signal.aborted).toBe(true);
    expect(a.current(last)).toBe(false);
  });

  it('rechecks after a reentrant descriptor trap, without touching another field under the old authority', async () => {
    const { a, row, holder, placement, binding } = await admitted(['kind', 'count']);
    const read: PropertyKey[] = [];
    const context = new Proxy({ kind: 'item', count: 9 }, {
      getOwnPropertyDescriptor(target, key) {
        read.push(key);
        a.retireGrants([row]);
        a.replacePolicy(policy([row]));
        return Object.getOwnPropertyDescriptor(target, key);
      },
    });
    a.setPlacement(holder, outlet({ context }));
    expect(a.beginDemand(placement, binding)).toBeUndefined();
    expect(read).toEqual(['kind']);
    expect(a.point(point)[0]).not.toBe(binding);
  });
});
