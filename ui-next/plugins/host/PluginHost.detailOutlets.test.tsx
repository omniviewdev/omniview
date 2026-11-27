import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { MenuHost } from '@omniviewdev/kit';
import type * as RuntimeApi from '@omniviewdev/runtime/api';
import type { ExtensionEdge, ExtensionOffer, ExtensionPoint } from '@omniviewdev/runtime/internal/extensions-v1';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { useSyncExternalStore } from 'react';
import { STATE_VERSION, type TabsStore } from '../../shell/core/tabs';
import { installPopover, teardown } from '../../shell/notices/testing';
import { installDialog } from '../../shell/palette/testing';
import { openSession, SESSION_VERSION } from '../../shell/session';
import { memoryStorage } from '../../shell/session/testing';
import type { DetailPageV1, DetailSource, DetailView } from '../contract/v1';
import { acme } from '../testing';
import { ExtensionAuthority, type ExtensionGrant, type ExtensionPolicy, type ExtensionSource } from './extensionAuthority';
import { ExtensionAuthorityContext } from './extensionAuthorityContext';
import { detailMenuTarget, subscribeDetailTarget } from './detailMenuTarget';
import { pluginSource, unusedVerbs } from './homeTesting';
import { PluginHost } from './PluginHost';
import { NO_ROUTE } from './route';

// Everything from manifest decoding through named System.register dispatch and the real page/kit is live.
const readAsset = vi.hoisted(() => vi.fn());
vi.mock('@omniviewdev/runtime/api', async load => {
  const api = await load<typeof RuntimeApi>();
  return { ...api, PluginManager: { ...api.PluginManager, ReadExtensionAsset: readAsset } };
});
const views = `System.register(['react/jsx-runtime'],function(ex){var jsx;return {setters:[function(m){jsx=m.jsx;}],execute:function(){
  ex('inspect',function Inspect(p){return jsx('button',{children:'Inspect '+JSON.stringify(p)});});
  ex('notes',function Notes(p){return jsx('p',{children:'Peer notes: '+p.related.state});});
}};});`;
const features = `System.register([],function(ex){return {execute:function(){
  ex('describe',function(p){return {text:'About '+p.tag};});
  ex('usage',function(p){return {label:'Measured',value:String(p.used)+'/'+String(p.capacity)};});
}};});`;
const locator = (name: string) => ({ package: '@unit/points', version: '1.0.0', export: name });
const vp = { kind: 'view', protocol: 'owner/item@1', fields: { note: 'string', tag: 'string' }, optional: ['note', 'tag'], read: { id: 'owner/edges@1', row: { direction: 'string' } } } as const;
const mp = { kind: 'menu', protocol: 'owner/actions@1', fields: { tag: 'string' }, optional: ['tag'] } as const;
const sp = { kind: 'section', protocol: 'visuals/utilization@1' } as const;
const points: readonly ExtensionPoint[] = [
  { ...vp, id: 'panels', label: 'Panels', placement: 'detail-tab', contract: locator('panels') },
  { ...mp, id: 'actions', label: 'Item actions', placement: 'context-menu', contract: locator('actions') },
  { ...sp, id: 'facts', label: 'Measurements', placement: 'overview-section', contract: locator('facts') },
  { ...sp, id: 'a-facts', label: 'Other measurements', placement: 'overview-section', contract: locator('moreFacts') },
];
const offers = [
  { ...vp, id: 'notes', label: 'Peer panel', requests: [], requestRead: true },
  { ...vp, id: 'inspect', label: 'Peer panel', requests: ['note', 'tag'] },
  { ...mp, id: 'describe', label: 'Describe item', requests: ['tag'], action: { kind: 'info' } },
  { ...mp, id: 'show', label: 'Show inspection', requests: [], action: { kind: 'openView', point: 'owner/panels', offer: 'inspect' } },
  { ...sp, id: 'usage', label: 'Usage', requests: ['capacity', 'used'] },
] as const satisfies readonly ExtensionOffer[];
const edges: readonly ExtensionEdge[] = [
  { target: 'owner/panels', offer: 'notes' }, { target: 'owner/panels', offer: 'inspect', when: [{ field: 'tag', equals: 'enabled' }] },
  { target: 'owner/actions', offer: 'describe' }, { target: 'owner/actions', offer: 'show' }, { target: 'owner/facts', offer: 'usage' },
];
const owner: ExtensionSource = { id: 'owner', pin: `sha256:${'1'.repeat(64)}`, generation: 'owner-life', features: [], views: [], ordinaryReady: true,
  manifest: JSON.stringify({ schemaVersion: 1, id: 'owner', points, offers: [], bindings: [] }) };
const peer: ExtensionSource = { id: 'peer', pin: `sha256:${'2'.repeat(64)}`, generation: 'peer-life', features: ['describe', 'usage'], views: ['inspect', 'notes'], ordinaryReady: false,
  manifest: JSON.stringify({ schemaVersion: 1, id: 'peer', points: [], offers, bindings: edges }) };
const route = { plugin: 'owner', contribution: 'item', params: { name: 'wheel', connection: 'west' } };
const origin = { owner: 'owner', connection: 'west', extensionScopeKey: 'first', route: { page: 'item', params: { name: 'wheel' } } };
const tab = (name: string) => screen.getByRole('tab', { name });
const scope = { tag: 'enabled' };
function view(key = 'first', context: Readonly<Record<string, string>> = scope, overview = false): DetailView {
  return { extensionScopeKey: key, tabOutlet: { point: 'panels', context }, tabs: {
    main: { kind: 'overview', sections: [{ kind: 'kv', id: 'info', title: 'Owner facts', rows: [{ label: 'Type', value: 'Wheel' }] }],
      ...(overview ? { outlets: [{ point: 'facts', context: { used: 0, capacity: 3 } }, { point: 'facts', context: { used: 9, capacity: 10 } }], menuOutlet: { point: 'actions', context } } : {}) },
    activity: { kind: 'custom', content: 'Owner activity' },
  } };
}

const ready = (v: DetailView): DetailSource => ({ state: { kind: 'ready' }, refreshing: false, refresh: async () => undefined, view: v });
const noShells: readonly never[] = [];
async function mount(initial = view()) {
  const authority = new ExtensionAuthority();
  await authority.replaceSources([peer, owner]);
  const grants: ExtensionGrant[] = edges.map(edge => ({ point: edge.target, offer: `peer/${edge.offer}`, fields: offers.find(o => o.id === edge.offer)!.requests,
    contract: authority.declaredPoint(edge.target)!.contract, ownerPin: owner.pin, contributorPin: peer.pin, continuity: 'initial',
    ...(edge.offer === 'notes' ? { read: authority.declaredPoint(edge.target)!.read! } : {}) }));
  const policy: ExtensionPolicy = { known: true, disabled: false, revision: 'initial', grants, disabledBindings: [], disabledOffers: [] };
  authority.replacePolicy(policy);
  let source = ready(initial);
  const listeners = new Set<() => void>();
  const subscribe = (fn: () => void) => {
    listeners.add(fn); return () => {
      listeners.delete(fn);
    };
  };

  const set = (next: DetailSource) => {
    act(() => {
      source = next; for (const fn of listeners) {
        fn();
      }
    });
  };

  const page: DetailPageV1 = { kind: 'detail', definition: { kind: 'Item', tile: { icon: 'box' }, identity: { name: 'name', facets: ['region'] }, list: { page: 'widgets', label: 'Widgets' },
    tabs: [{ id: 'main', label: 'Overview' }, { id: 'activity', label: 'Activity' }, { id: '~view/owner/panels/peer/inspect', label: 'Owner reserved' }] },
  usePage: () => ({ scope: [], source: useSyncExternalStore(subscribe, () => source) }) };
  const contribution = acme({ pages: { ...acme().pages, item: page } });
  const plugins = pluginSource([{ id: 'owner', phase: 'ready', name: 'Owner', contribution, artifact: { pin: owner.pin, generation: owner.generation } }]);
  const text = JSON.stringify({ version: SESSION_VERSION, tabs: { version: STATE_VERSION, active: 'T', tabs: [{ id: 'T', pinned: false, preview: false, route, history: { entries: [route], index: 0 } }] } });
  const session = openSession(memoryStorage(text).storage, text);
  let tabs!: TabsStore;
  let listed = 'west';
  const connectionEvents = new Set<() => void>();
  const changeConnection = (key: string) => {
    act(() => {
      listed = key; connectionEvents.forEach(fn => {
        fn();
      });
    });
  };

  render(<MenuHost><ExtensionAuthorityContext.Provider value={authority}><PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={vi.fn()} onRetryInventory={vi.fn()}
    terminals={{ shells: { getSnapshot: () => noShells, subscribe: () => () => undefined } }}
    session={{ ...session, attach: parts => {
      tabs = parts.tabs as TabsStore; return session.attach(parts);
    } }}
    connections={{ ...unusedVerbs, states: async () => ({ owner: [{ connection: { id: listed, name: listed }, readiness: 'CONNECTED' }] }),
      start: async () => ({ status: 'CONNECTED' }), onSync: () => () => undefined, onStatus: notify => {
        connectionEvents.add(notify); return () => {
          connectionEvents.delete(notify);
        };
      } }} /></ExtensionAuthorityContext.Provider></MenuHost>);
  await screen.findByRole('tab', { name: 'Peer panel (peer/inspect)' });
  return { tabs, set, authority, policy, changeConnection };
}

beforeAll(() => {
  installDialog(); installPopover(); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('TextEncoder', TextEncoder);
});
afterAll(() => {
  teardown(); vi.unstubAllGlobals();
});
function assetRead(text: string | Promise<string>, cancel: () => Promise<void> = async () => undefined): PromiseLike<string> & { cancel(): Promise<void> } {
  return Object.assign(Promise.resolve(text), { cancel });
}

beforeEach(() => {
  readAsset.mockReset().mockImplementation((_id, _pin, _generation, role) => assetRead(role === 'features' ? features : views));
});
afterEach(cleanup);

it('lists ordered rich tabs without code, avoids owner IDs and mounts only on selection inside the existing document', async () => {
  const { tabs, authority, policy } = await mount();
  const strip = screen.getByRole('tablist', { name: 'Item sections' });
  const faces = within(strip).getAllByRole('tab');
  expect(faces.map(f => f.textContent)).toEqual(['Overview', 'Activity', 'Owner reserved', 'Peer panel (peer/inspect)', 'Peer panel (peer/notes)']);
  expect(new Set(faces.map(f => f.id)).size).toBe(faces.length);
  act(() => {
    faces[3].focus();
  });
  expect(readAsset).not.toHaveBeenCalled();
  const activity = tab('Activity');
  fireEvent.click(activity);
  const ownerState = tabs.getSnapshot().tabs.T;
  fireEvent.keyDown(activity, { key: 'End' });
  expect(await screen.findByText('Peer notes: unavailable')).toBeVisible();
  fireEvent.keyDown(faces[4], { key: 'ArrowLeft' });
  const button = await screen.findByRole('button', { name: 'Inspect {"input":{"tag":"enabled"}}' });
  expect(within(screen.getByRole('tabpanel', { name: 'Peer panel (peer/inspect)' })).getByRole('button')).toBe(button);
  act(() => {
    button.focus();
  });
  act(() => {
    authority.replacePolicy({ ...policy, grants: policy.grants.filter(g => g.offer !== 'peer/notes') });
  });
  expect(tab('Peer panel')).toBe(faces[3]);
  expect(button).toHaveFocus();
  const after = tabs.getSnapshot().tabs.T;
  expect(after.location).toBe(ownerState.location);
  expect(after.history).toBe(ownerState.history);
  expect(after.pageState).toBe(ownerState.pageState);
  act(() => {
    authority.clearPolicy();
  });
  expect(activity).toHaveAttribute('aria-selected', 'true');
  expect(activity).toHaveFocus();
  act(() => {
    authority.replacePolicy(policy);
  });
  expect(activity).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByText(/^Inspect /)).toBeNull();
});

it('rejects hidden, retained, malformed and replacement contexts without reselecting a returning offer', async () => {
  const { set, authority } = await mount();
  const select = detailMenuTarget(authority, origin, 'owner/panels', 'peer/inspect');
  expect(select).toBeDefined();
  expect(detailMenuTarget(authority, { ...origin, connection: 'east' }, 'owner/panels', 'peer/inspect')).toBeUndefined();
  expect(detailMenuTarget(authority, { ...origin, route: { page: 'item', params: { name: 'other' } } }, 'owner/panels', 'peer/inspect')).toBeUndefined();
  expect(detailMenuTarget(authority, { ...origin, route: { page: 'item', params: { name: 'wheel', region: 'elsewhere' } } }, 'owner/panels', 'peer/inspect')).toBeUndefined();
  expect(detailMenuTarget(authority, { ...origin, route: { page: 'item', params: { name: 'wheel', container: 'private' } } }, 'owner/panels', 'peer/inspect')).toBeDefined();
  expect(select!(() => false)).toBe(false);
  act(() => {
    select!();
  });
  expect(await screen.findByText(/^Inspect /)).toBeVisible();
  set(ready(view('second')));
  expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
  expect(select!()).toBe(false);
  set(ready(view('second', {})));
  expect(tab('Peer panel')).toBeVisible();
  expect(screen.queryByRole('tab', { name: /peer\/inspect/ })).toBeNull();
  for (const next of [{ ...ready(view()), state: { kind: 'failed' } }, { ...ready(view()), refreshing: true }, ready(view('x'.repeat(257)))] as const) {
    set(next);
    expect(screen.queryByRole('tab', { name: /Peer panel/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Owner facts' })).toBeVisible();
  }

  set(ready(view()));
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  try {
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.queryByRole('tab', { name: /Peer panel/ })).toBeNull();
    expect(detailMenuTarget(authority, origin, 'owner/panels', 'peer/inspect')).toBeUndefined();
  } finally {
    Reflect.deleteProperty(document, 'hidden');
  }

  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
});

it('puts only the first section after owner sections, runs info on choice, and rechecks an independent menu destination', async () => {
  const { set, authority, policy } = await mount(view('first', scope, true));
  expect(await screen.findByText('0/3')).toBeVisible();
  expect(screen.queryByText('9/10')).toBeNull();
  const ownerHeading = screen.getByRole('heading', { name: 'Owner facts' });
  const usage = screen.getByRole('heading', { name: 'Usage' });
  expect(ownerHeading.compareDocumentPosition(usage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const trigger = screen.getByRole('button', { name: 'Item actions' });
  const user = userEvent.setup();
  await user.click(trigger);
  expect(screen.getByRole('menuitem', { name: 'Describe item' })).toBeVisible();
  await user.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
  expect(screen.queryByText('About enabled')).toBeNull();
  await user.click(trigger);
  await user.click(screen.getByRole('menuitem', { name: 'Describe item' }));
  expect(await screen.findByText('About enabled')).toBeVisible();
  expect(trigger).toHaveFocus();
  act(() => {
    authority.replacePolicy({ ...policy, grants: policy.grants.filter(g => g.offer !== 'peer/inspect') });
  });
  await user.click(trigger);
  expect(screen.queryByRole('menuitem', { name: 'Show inspection' })).toBeNull();
  await user.keyboard('{Escape}');
  act(() => {
    authority.replacePolicy(policy);
  });
  await user.click(trigger);
  await user.click(screen.getByRole('menuitem', { name: 'Show inspection' }));
  expect(await screen.findByText(/^Inspect /)).toBeVisible();
  expect(screen.getByRole('tabpanel', { name: /peer\/inspect/ })).toHaveFocus();
  set(ready(view('replacement', {}, true)));
  expect(screen.queryByText('About enabled')).toBeNull();
  expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
});

it('preserves a continuously selected view but remounts its private state on a read-only withdrawal', async () => {
  const { authority, policy } = await mount();
  const notes = tab('Peer panel (peer/notes)');
  fireEvent.click(notes);
  // Even the initial read grant cannot substitute for the missing native record witness.
  const first = await screen.findByText('Peer notes: unavailable');
  act(() => {
    authority.retireGrants([{ point: 'owner/panels', offer: 'peer/notes', readOnly: true }], 'remove-read');
    authority.replacePolicy({ ...policy, revision: 'remove-read', grants: policy.grants.map(g => g.offer === 'peer/notes' ? { ...g, read: undefined, continuity: 'remove-read' } : g) });
  });
  expect(notes).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByText('Peer notes: unavailable')).not.toBe(first);
});

it('caps visible cards across points in owner order without displacing surviving cards or owner content', async () => {
  const { authority, policy, set } = await mount();
  const target = 'owner/a-facts';
  const others: ExtensionSource[] = ['z', 'y', 'x', 'w'].map((id, i) => ({
    id, pin: `sha256:${String(3 + i).repeat(64)}`, generation: 'extra', views: [], features: ['fact'], ordinaryReady: false,
    manifest: JSON.stringify({ schemaVersion: 1, id, points: [], offers: [{ ...sp, id: 'fact', label: 'Extra', requests: [] }], bindings: [{ offer: 'fact', target }] }),
  }));
  const grants = others.map(p => ({ point: target, offer: `${p.id}/fact`, ownerPin: owner.pin, contributorPin: p.pin,
    fields: [], contract: authority.declaredPoint(target)!.contract, continuity: 'extra' }));
  await act(async () => {
    await authority.replaceSources([...others, peer, owner]);
  });
  act(() => {
    authority.replacePolicy({ ...policy, grants: [...grants, ...policy.grants] });
  });
  readAsset.mockImplementation((id, _pin, _generation, role) => assetRead(id === 'peer' ? (role === 'features' ? features : views) :
    `System.register([],function(ex){return {execute:function(){ex('fact',function(){return ${id === 'w' ? '{label:\'Bad\',value:13}' : `{label:'Observed',value:'Answer ${id}'}`};});}};});`));
  const normal = view();
  const main = normal.tabs.main;
  if (main.kind !== 'overview') {
    throw new Error('Expected owner Overview');
  }

  const ownerHeading = screen.getByRole('heading', { name: 'Owner facts' });
  set(ready({ ...normal, tabs: { ...normal.tabs, main: { ...main, outlets: [{ point: 'facts', context: { used: 0, capacity: 3 } }, { point: 'a-facts', context: {} }] } } }));
  expect(await screen.findByText('Answer y')).toBeVisible();
  expect(screen.getByRole('status', { name: 'Extra (w/fact)' })).toHaveTextContent('Information unavailable.');
  const headings = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent);
  expect(headings.slice(headings.indexOf('Owner facts'))).toEqual(['Owner facts', 'Usage', 'Extra (w/fact)', 'Extra (x/fact)', 'Extra (y/fact)']);
  expect(readAsset.mock.calls.some(([id]) => id === 'z')).toBe(false);
  const survivor = screen.getByText('Answer x');
  act(() => {
    authority.replacePolicy({ ...policy, grants: [...grants.filter(g => g.offer !== 'w/fact'), ...policy.grants] });
  });
  expect(await screen.findByText('Answer z')).toBeVisible();
  expect(screen.getByText('Answer x')).toBe(survivor);
  expect(screen.getByRole('heading', { name: 'Owner facts' })).toBe(ownerHeading);
});

it.each(['success', 'failure'])('retires an in-flight info choice across A → B → A and fences late %s', async outcome => {
  const object = view();
  const menuOnly = { ...object, tabs: { ...object.tabs, main: { kind: 'overview', sections: [], menuOutlet: { point: 'actions', context: scope } } } } as const;
  const { set } = await mount(menuOnly);
  const read = Promise.withResolvers<string>();
  const cancel = vi.fn(async () => undefined);
  readAsset.mockReturnValueOnce(assetRead(read.promise, cancel));
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Item actions' }));
  await user.click(screen.getByRole('menuitem', { name: 'Describe item' }));
  await waitFor(() => {
    expect(readAsset).toHaveBeenCalledTimes(1);
  });
  set(ready({ ...menuOnly, extensionScopeKey: 'other' }));
  set(ready(menuOnly));
  await act(async () => {
    if (outcome === 'success') {
      read.resolve(features);
    } else {
      read.reject(new Error('Private failure'));
    }
  });
  expect(cancel).toHaveBeenCalled();
  expect(screen.queryByText('About enabled')).toBeNull();
  expect(screen.queryByText(/Private failure|Information unavailable/)).toBeNull();
  expect(readAsset).toHaveBeenCalledTimes(1);
});

it('refreshes an admitted selection on changed effective facts without retaining old Body state', async () => {
  const { set } = await mount();
  const face = tab('Peer panel (peer/inspect)');
  fireEvent.click(face);
  const before = await screen.findByRole('button', { name: 'Inspect {"input":{"tag":"enabled"}}' });
  set(ready(view('first', { tag: 'enabled', note: 'new' })));
  const updated = await screen.findByRole('button', { name: /^Inspect .*"note":"new"/ });
  expect(updated).not.toBe(before);
  expect(face).toHaveAttribute('aria-selected', 'true');
  set(ready(view('first', { tag: 'enabled', note: 'new' })));
  expect(screen.getByRole('button', { name: updated.textContent })).toBe(updated);
  expect(readAsset).toHaveBeenCalledTimes(1);
});

it('does not run adapter getters or let malformed, foreign or misplaced publications break owner commands', async () => {
  const { set } = await mount();
  const run = vi.fn();
  const base = { ...view(), commands: { primary: { id: 'owner-run', label: 'Owner command', onSelect: run } } };
  const trap = vi.fn(() => {
    throw new Error('Private adapter failure');
  });
  for (const adapter of [{ point: 'peer/panels', context: scope }, { point: 'actions', context: scope },
    { point: 'panels', context: scope, extra: true }, Object.defineProperty({ point: 'panels' }, 'context', { enumerable: true, get: trap })]) {
    set(ready({ ...base, tabOutlet: adapter as NonNullable<DetailView['tabOutlet']> }));
    expect(screen.queryByRole('tab', { name: /Peer panel/ })).toBeNull();
  }

  set(ready(Object.defineProperty({ ...base }, 'tabOutlet', { enumerable: true, get: trap })));
  fireEvent.click(screen.getByRole('button', { name: 'Owner command' }));
  expect(run).toHaveBeenCalledOnce();
  expect(trap).not.toHaveBeenCalled();
  expect(readAsset).not.toHaveBeenCalled();
});

it('returns focus to the owner strip when the open menu loses its trigger', async () => {
  const { set } = await mount(view('first', scope, true));
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Item actions' }));
  await user.keyboard('{ArrowDown}');
  expect(document.activeElement?.closest('[role="menu"]')).not.toBeNull();
  set(ready(view()));
  await waitFor(() => expect(tab('Overview')).toHaveFocus());
  expect(screen.queryByRole('menu')).toBeNull();
});

it('does not let unavailable openView destinations consume the visible menu quota or block a later info choice', async () => {
  const { authority, policy } = await mount(view('first', scope, true));
  const closed = Array.from({ length: 12 }, (_, i) => ({ ...mp, id: `closed${i}`, label: `Unreachable ${i}`, requests: [],
    action: { kind: 'openView', point: 'owner/panels', offer: 'missing' } }));
  const source: ExtensionSource = { id: 'aaa', pin: `sha256:${'9'.repeat(64)}`, generation: 'a', features: [], views: ['missing'], ordinaryReady: false,
    manifest: JSON.stringify({ schemaVersion: 1, id: 'aaa', points: [], offers: [...closed, { ...vp, id: 'missing', label: 'Ungranted destination', requests: [] }],
      bindings: [...closed.map(o => ({ offer: o.id, target: 'owner/actions' })), { offer: 'missing', target: 'owner/panels' }] }) };
  const grants = closed.map(o => ({ point: 'owner/actions', offer: `aaa/${o.id}`, fields: [], ownerPin: owner.pin, contributorPin: source.pin,
    contract: authority.declaredPoint('owner/actions')!.contract, continuity: 'extra' }));
  await act(async () => {
    await authority.replaceSources([source, peer, owner]);
  });
  act(() => {
    authority.replacePolicy({ ...policy, grants: [...grants, ...policy.grants] });
  });
  expect(authority.point('owner/actions')).toHaveLength(14);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Item actions' }));
  expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Describe item', 'Show inspection']);
  await user.click(screen.getByRole('menuitem', { name: 'Describe item' }));
  expect(await screen.findByText('About enabled')).toBeVisible();
  expect(readAsset.mock.calls.some(([id]) => id === 'aaa')).toBe(false);
});

it('notifies an open menu of actual detail membership changes and retires the old connection', async () => {
  const { set, changeConnection, authority } = await mount();
  const notify = vi.fn();
  const unsubscribe = subscribeDetailTarget(authority, notify);
  const choose = detailMenuTarget(authority, origin, 'owner/panels', 'peer/inspect')!;
  set(ready(view('first', { tag: 'enabled' })));
  await act(async () => Promise.resolve());
  expect(notify).not.toHaveBeenCalled();
  set(ready(view('first', {})));
  await waitFor(() => {
    expect(notify).toHaveBeenCalledTimes(1);
  });
  expect(choose()).toBe(false);
  set(ready(view()));
  fireEvent.click(tab('Peer panel (peer/inspect)'));
  expect(await screen.findByText(/^Inspect /)).toBeVisible();
  changeConnection('east');
  await waitFor(() => {
    expect(screen.queryByText(/^Inspect /)).toBeNull();
  });
  expect(detailMenuTarget(authority, origin, 'owner/panels', 'peer/inspect')).toBeUndefined();
  unsubscribe();
});

it('isolates one contributor load failure and preserves an independently installed sibling', async () => {
  const { authority, policy } = await mount();
  const rival: ExtensionSource = { id: 'rival', pin: `sha256:${'a'.repeat(64)}`, generation: 'r', features: [], views: ['bad'], ordinaryReady: false,
    manifest: JSON.stringify({ schemaVersion: 1, id: 'rival', points: [], offers: [{ ...vp, id: 'bad', label: 'Peer panel', requests: [] }],
      bindings: [{ offer: 'bad', target: 'owner/panels' }] }) };
  const grant = { point: 'owner/panels', offer: 'rival/bad', fields: [], ownerPin: owner.pin, contributorPin: rival.pin,
    contract: authority.declaredPoint('owner/panels')!.contract, continuity: 'r' };
  await act(async () => {
    await authority.replaceSources([rival, peer, owner]);
  });
  act(() => {
    authority.replacePolicy({ ...policy, grants: [grant, ...policy.grants] });
  });
  const ownerTab = tab('Overview');
  const sibling = tab('Peer panel (peer/inspect)');
  expect(readAsset).not.toHaveBeenCalled();
  readAsset.mockImplementationOnce(() => assetRead(Promise.reject(new Error('Private contributor failure'))));
  fireEvent.click(tab('Peer panel (rival/bad)'));
  expect(await screen.findByText('View unavailable', { selector: 'strong' })).toBeVisible();
  expect(screen.queryByText('Private contributor failure')).toBeNull();
  fireEvent.click(sibling);
  expect(await screen.findByText(/^Inspect /)).toBeVisible();
  expect(tab('Overview')).toBe(ownerTab);
  expect(tab('Peer panel (peer/inspect)')).toBe(sibling);
});
