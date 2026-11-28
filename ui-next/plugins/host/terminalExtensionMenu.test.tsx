import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { MenuHost } from '@omniviewdev/kit';
import { extensionRootOf, type HostRecord } from '@omniviewdev/runtime/ui/v1';
import type * as RuntimeApi from '@omniviewdev/runtime/api';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { CollectionRootSource } from '../../../packages/omniviewdev-runtime/src/resource/v2/extensionRoot';
import { createPanelStore, HOST } from '../../shell/core/panel';
import { installPopover, teardown } from '../../shell/notices/testing';
import { staticPanel } from '../../shell/panel/testing';
import { createTerminals } from '../../shell/panel/terminal/terminals';
import { TERMINAL_TOOL } from '../../shell/panel/terminal/tool';
import { fakeEngineLoader, fakeTerminalFeed } from '../../shell/panel/terminal/testing';
import { DEFAULT_PREFERENCES_SOURCE } from '../../shell/panel/terminal/preferences';
import type { ResourceShellFrame, ResourceShellTransport } from '../../shell/panel/terminal/resourceShellFeed';
import { StaticShell, staticTabs } from '../../shell/testing';
import type { DetailPageV1, ResourceShellRequestV1, TerminalMenuOriginV1 } from '../contract/v1';
import { acme } from '../testing';
import { ExtensionAuthority, type ExtensionSource } from './extensionAuthority';
import { pluginSource } from './homeTesting';
import { createResourceShells } from './resourceShells';
import { createTerminalExtensionMenu } from './terminalExtensionMenu';
import { TerminalMenuContent } from './TerminalMenuContent';
import type { evaluateExtensionFeature, ExtensionFeatureResult } from './extensionFeature';
import { ExtensionMenuNavigationContext, type ExtensionMenuNavigation } from './extensionMenuNavigation';
import type { ConnectionsState } from './connections/store';
const readAsset = vi.hoisted(() => vi.fn());
vi.mock('@omniviewdev/runtime/api', async load => {
  const api = await load<typeof RuntimeApi>();
  return { ...api, PluginManager: { ...api.PluginManager, ReadExtensionAsset: readAsset } };
});


const owner = 'unit-owner', connection = 'west', point = `${owner}/header`, peer = 'unit-peer';
const definition = { kind: 'menu', protocol: 'unit-owner/info@1', fields: { kind: 'string', mark: 'string' } } as const;
const detailPoint = `${owner}/details`;
const view = { kind: 'view', protocol: 'unit-owner/detail@1', fields: {} } as const;
const ownerRow: ExtensionSource = { id: owner, generation: 'owner-life', pin: `sha256:${'a'.repeat(64)}`, features: [], views: [], ordinaryReady: true,
  manifest: JSON.stringify({ schemaVersion: 1, id: owner, offers: [], bindings: [], points: [{ ...definition, id: 'header', label: 'Header', placement: 'context-menu',
    contract: { package: '@unit/points', version: '1.0.0', export: 'header' } }, { ...view, id: 'details', label: 'Detail panels', placement: 'detail-tab',
    contract: { package: '@unit/points', version: '1.0.0', export: 'details' } }] }) };
const peerRow: ExtensionSource = { id: peer, generation: 'peer-life', pin: `sha256:${'b'.repeat(64)}`, features: ['describe'], views: ['inspect'], ordinaryReady: false,
  manifest: JSON.stringify({ schemaVersion: 1, id: peer, points: [], offers: [{ ...definition, id: 'describe', label: 'Describe item', action: { kind: 'info' }, requests: ['mark'] },
    { ...definition, id: 'show', label: 'Open inspection', action: { kind: 'openView', point: detailPoint, offer: 'inspect' }, requests: [] },
    { ...view, id: 'inspect', label: 'Inspection', requests: [] }],
  bindings: [{ target: point, offer: 'describe', when: [{ field: 'mark', equals: 'managed' }] }, { target: point, offer: 'show' }, { target: detailPoint, offer: 'inspect' }] }) };
const page: DetailPageV1 = { kind: 'detail', definition: { kind: 'Item', tile: { icon: 'box' }, identity: { name: 'name' }, list: { page: 'widgets', label: 'Widgets' }, tabs: [{ id: 'main', label: 'Overview' }] },
  usePage: () => {
    throw new Error('Terminal menu must not mount the foreground page');
  } };
function source<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return { getSnapshot: () => state, subscribe(fn: () => void) {
    listeners.add(fn); return () => {
      listeners.delete(fn);
    };
  },
  set(next: T) {
    state = next; for (const fn of listeners) {
      fn();
    }
  } };
}

function record(key: string): HostRecord {
  return { key, addressKey: key, targetId: 'target', route: { connection }, record: {
    reference: { address: { id: 'twin', provider: 'provider', authority: 'cluster', type: 'item', scope: [] }, incarnation: key },
    representation: { id: 'native', revision: 'one' }, coverage: { kind: 'complete', paths: [] }, body: { kind: 'string', value: 'private resource body' },
  } };
}

const detach: Array<() => void> = [];
beforeAll(() => {
  installPopover(); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('TextEncoder', TextEncoder);
});
afterEach(() => {
  cleanup(); for (const fn of detach.splice(0)) {
    fn();
  }
});
afterAll(() => {
  teardown(); vi.unstubAllGlobals();
});

async function workspace(surface: TerminalMenuOriginV1['surface'] = 'session-tab', realFeature = false, navigation = false) {
  const panel = createPanelStore(); panel.registerTool(TERMINAL_TOOL); panel.syncPlugins([{ id: owner, tools: [] }]);
  const terminals = createTerminals(panel, {
    load: fakeEngineLoader().load, preferences: DEFAULT_PREFERENCES_SOURCE,
    here: () => ({ plugin: HOST, id: 'local', title: 'Local terminal', open: () => fakeTerminalFeed() }),
  });
  const { sessions } = terminals; detach.push(sessions.attach());
  const authority = new ExtensionAuthority();
  await authority.replaceSources([ownerRow, peerRow]);
  const pair = (target: string, offer: string, fields: string[]) => ({ point: target, offer: `${peer}/${offer}`, ownerPin: ownerRow.pin,
    contributorPin: peerRow.pin, fields, continuity: 'initial', contract: authority.declaredPoint(target)!.contract });
  const policy = { known: true, disabled: false, revision: 'consent', disabledBindings: [], disabledOffers: [],
    grants: [pair(point, 'describe', ['mark']), pair(point, 'show', []), pair(detailPoint, 'inspect', [])] };
  authority.replacePolicy(policy);
  // A targeted menu opens a new, independent source. Its row version, not the original launch view, authorizes disclosure.
  const factSource = new CollectionRootSource(owner, connection, 'facts-view', 'target', 'provider', 'cluster', 'item');
  const currentRecord = record('b');
  factSource.remember(currentRecord, '7'); factSource.publish('facts-generation', new Map([[currentRecord.key, currentRecord]]));
  const facts = source({ key: 'b', mark: 'managed', record: currentRecord });
  const seen = vi.fn<(o: TerminalMenuOriginV1) => void>();
  function useOutlet(origin: TerminalMenuOriginV1) {
    seen(origin);
    const fact = useSyncExternalStore(facts.subscribe, facts.getSnapshot);
    if (origin.surface !== surface || origin.extensionScopeKey !== fact.key) {
      return undefined;
    }

    const extensionRoot = extensionRootOf(fact.record);
    return extensionRoot && { extensionScopeKey: fact.key, extensionRoot, outlet: { point: 'header', context: { kind: 'item', mark: fact.mark } } };
  }

  const entry = { id: owner, name: 'Owner', phase: 'ready' as const, artifact: { pin: ownerRow.pin, generation: ownerRow.generation },
    contribution: acme({ pages: { item: page }, panel: { sessions: { terminal: { useMenuOutlet: useOutlet } } } }) };
  const plugins = pluginSource([entry]);
  const connections = source<ConnectionsState>({ loaded: true, failed: false, connections: [{ plugin: owner, key: connection, name: 'West', state: 'connected', reason: undefined }] });
  const frames = new Map<string, (frame: ResourceShellFrame) => void>();
  const transport = { create: vi.fn(async (_owner: string, encoded: string) => {
    const { id } = JSON.parse(encoded) as { id: string }; return { id, attachment: id + '-lease', replay: '' };
  }),
  check: vi.fn<ResourceShellTransport['check']>().mockResolvedValue(true),
  close: vi.fn<ResourceShellTransport['close']>().mockResolvedValue(undefined),
  write: vi.fn<ResourceShellTransport['write']>().mockResolvedValue(undefined),
  resize: vi.fn<ResourceShellTransport['resize']>().mockResolvedValue(undefined),
  read(id: string): PromiseLike<ResourceShellFrame> {
    const pending = Promise.withResolvers<ResourceShellFrame>(); frames.set(id, pending.resolve); return pending.promise;
  } };
  const activated = vi.fn(() => true);
  const shells = createResourceShells({ plugins, connections, sessions, activated, transport });
  const rootSource = new CollectionRootSource(owner, connection, 'native-view', 'target', 'provider', 'cluster', 'item');
  const a = record('a'), b = record('b');
  rootSource.remember(a, '1'); rootSource.remember(b, '2'); rootSource.publish('native-generation', new Map([[a.key, a], [b.key, b]]));
  const handle = shells.handle(owner, connection)!;
  const request = (r: HostRecord): ResourceShellRequestV1 => ({ record: r, route: { page: 'item', params: { name: 'twin', child: r.key, privateSelector: 'owner only' } }, params: { child: r.key } });
  await handle.open(request(a)); await handle.open(request(b));
  const [first, second] = panel.getSnapshot().order as readonly [string, string];
  panel.activateSession(first);
  const pending = Promise.withResolvers<ExtensionFeatureResult>();
  const evaluate = vi.fn<typeof evaluateExtensionFeature>().mockReturnValue(pending.promise);
  const tabs = staticTabs([{ title: 'Other resource', icon: 'box', path: ['Other'] }, { title: 'Another visit', icon: 'box', path: ['Next'] }]);
  const menu = createTerminalExtensionMenu({ authority, sessions, shells, panel, tabs, ...(realFeature ? {} : { evaluate }) });
  const openDetail = vi.fn<ExtensionMenuNavigation['openDetail']>((_row, _origin, allowed) => allowed());
  const dispatch: ExtensionMenuNavigation = { canOpenDetail: () => navigation, openDetail, canOpenSidebar: () => false, openSidebar: () => false, onDetailReady: vi.fn() };
  const bindings = {
    ...staticPanel({ store: panel, renderBody: (session, visible) => surface === 'terminal-body' ? terminals.bodyOf(session, visible) : null }),
    terminalMenu: menu.open, terminalMenuContent: <TerminalMenuContent menu={menu} />,
  };
  render(<ExtensionMenuNavigationContext.Provider value={dispatch}><MenuHost><StaticShell tabs={tabs} registration={{ plugin: { name: 'Terminal test' } }} panel={bindings} /></MenuHost></ExtensionMenuNavigationContext.Provider>);
  const tab = (id: string) => document.querySelector<HTMLElement>(`[data-tab-id="${id}"] [role="tab"]`)!;
  const body = (id: string) => document.querySelector<HTMLElement>(`[data-session-id="${id}"] [data-shell-part="terminalScreen"]`)!;
  return { panel, terminals, sessions, authority, policy, evaluate, pending, frames, transport, rootSource, factSource, handle, request, activated, shells, a, b, first, second, facts, seen, tab, body, menu, plugins, entry, connections, tabs, openDetail };
}

const row = async () => screen.findByRole('menuitem', { name: 'Describe item' });
const open = (trigger: HTMLElement) => fireEvent.contextMenu(trigger, { button: 2 });

async function openAndSettle(trigger: HTMLElement) {
  await act(async () => {
    open(trigger);
  });
}

it('right-clicks the inactive same-title second shell without activating it; the peer gets only granted scalars', async () => {
  const w = await workspace();
  w.rootSource.publish(); // The launch view went away. It is not the source of the current menu facts.
  expect(w.seen).not.toHaveBeenCalled();
  const b = w.tab(w.second); open(b);
  expect(screen.getByRole('menuitem', { name: 'Rename session…' })).toBeVisible();
  const info = await row();
  expect(w.seen.mock.calls.every(([origin]) => origin.surface === 'session-tab' && origin.extensionScopeKey === 'b' && origin.route.params.child === 'b')).toBe(true);
  expect(Object.keys(w.seen.mock.calls[0][0]).sort()).toEqual(['connection', 'extensionScopeKey', 'route', 'surface']);
  expect(w.panel.getSnapshot().active.terminal).toBe(w.first);
  expect(w.evaluate).not.toHaveBeenCalled();
  fireEvent.click(info);
  await waitFor(() => {
    expect(w.evaluate).toHaveBeenCalledTimes(1);
  });
  const demand = w.evaluate.mock.calls[0][1];
  expect(w.transport.check.mock.calls[0][2]).toBe('');
  expect(JSON.parse(w.transport.check.mock.calls[1][2])).toMatchObject({ owner, connection, viewId: 'facts-view', viewGeneration: 'facts-generation:7', reference: { incarnation: 'b' } });
  expect(demand.input).toEqual({ mark: 'managed' }); expect(Object.isFrozen(demand.input)).toBe(true);
  expect(b).toHaveFocus(); expect(w.panel.getSnapshot().active.terminal).toBe(w.first);
  await act(async () => {
    w.pending.resolve({ text: '<a href="https://not-a-link">managed</a>' });
  });
  const result = await screen.findByText('<a href="https://not-a-link">managed</a>');
  expect(result.closest('[role="status"]')).toHaveAttribute('aria-atomic', 'true');
  expect(result.querySelector('a')).toBeNull();
  act(() => {
    w.authority.clearPolicy();
  });
  expect(result).not.toBeInTheDocument(); expect(demand.signal.aborted).toBe(true);
  expect(w.transport.write).not.toHaveBeenCalled(); expect(w.transport.resize).not.toHaveBeenCalled(); expect(w.transport.close).not.toHaveBeenCalled();
  expect(w.transport.create).toHaveBeenCalledTimes(2);
});

it.each(['ContextMenu', 'F10'])('opens the clicked header with %s, preserves focus as approval arrives, and Escape never invokes code', async key => {
  const w = await workspace(); const b = w.tab(w.second);
  act(() => {
    b.focus();
  });
  fireEvent.keyDown(b, { key, shiftKey: key === 'F10' });
  const native = screen.getByRole('menuitem', { name: 'Rename session…' });
  const focused = document.activeElement;
  await row(); expect(document.activeElement).toBe(focused); expect(native).toBeVisible();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull(); expect(b).toHaveFocus();
  expect(w.evaluate).not.toHaveBeenCalled(); expect(w.panel.getSnapshot().active.terminal).toBe(w.first);
});

it('chooses a keyboard row once and retires pending output on same-name resource replacement', async () => {
  const w = await workspace(); const b = w.tab(w.second);
  act(() => {
    b.focus();
  });
  fireEvent.keyDown(b, { key: 'F10', shiftKey: true }); await row();
  fireEvent.keyDown(document.activeElement!, { key: 'End' }); fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
  await waitFor(() => {
    expect(w.evaluate).toHaveBeenCalledTimes(1);
  });
  act(() => {
    w.facts.set({ ...w.facts.getSnapshot(), key: 'replacement-uid' });
  });
  expect(w.evaluate.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => {
    w.pending.resolve({ text: 'late private text' });
  });
  expect(screen.queryByText('late private text')).toBeNull();
  await openAndSettle(b);
  expect(screen.queryByRole('menuitem', { name: 'Describe item' })).toBeNull();
  expect(screen.getByRole('menuitem', { name: 'Close session' })).toBeVisible();
});

it('keeps a body-only point off session tabs and verifies the visible xterm before composing it', async () => {
  const w = await workspace('terminal-body');
  await openAndSettle(w.tab(w.second));
  expect(screen.queryByRole('menuitem', { name: 'Describe item' })).toBeNull(); fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await act(async () => {
    w.panel.activateSession(w.second);
  });
  open(w.body(w.second));
  expect(await row()).toBeVisible(); expect(screen.getByRole('menuitem', { name: /^Find/ })).toBeVisible();
  const reply = await w.transport.create.mock.results[1].value;
  await act(async () => {
    w.frames.get(reply.id)!({ state: 'detached', data: '' });
  });
  expect(screen.queryByRole('menu')).toBeNull(); expect(w.evaluate).not.toHaveBeenCalled();
});

it('keeps a body result bound to its visible split pane, not its active sibling', async () => {
  const w = await workspace('terminal-body');
  await act(async () => {
    w.sessions.open({ plugin: HOST, id: 'local', sessionId: 'local', title: 'Local terminal',
      open: () => fakeTerminalFeed({ directory: async () => ({ state: 'known', path: '/home/user', source: 'shell' }) }) });
    await w.terminals.splitHere('local', 400);
    w.panel.activateSession(w.second); // Put the resource shell in the new pane.
    w.panel.activateSession('local');
  });
  const target = w.body(w.second);
  expect(target).toBeVisible(); expect(w.body('local')).toBeVisible();
  await openAndSettle(target);
  const info = await row();
  expect(w.panel.getSnapshot().active.terminal).toBe('local');
  expect(w.seen).toHaveBeenLastCalledWith(expect.objectContaining({ surface: 'terminal-body', extensionScopeKey: 'b' }));
  fireEvent.click(info);
  await waitFor(() => {
    expect(w.evaluate).toHaveBeenCalledTimes(1);
  });
  const signal = w.evaluate.mock.calls[0][1].signal;
  await act(async () => {
    w.panel.activateSession('local');
  });
  expect(signal.aborted).toBe(false);
  await act(async () => {
    w.panel.activateSession(w.second);
    w.panel.activateSession(w.first);
  });
  expect(target).not.toBeVisible(); expect(w.body('local')).toBeVisible();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    w.pending.resolve({ text: 'Late result from the hidden terminal' });
  });
  expect(screen.queryByText('Late result from the hidden terminal')).toBeNull();
});

it('screens before mounting owner hooks; restored labels or forged target metadata do not bind a feed', async () => {
  const w = await workspace();
  act(() => {
    w.authority.clearPolicy();
  });
  await openAndSettle(w.tab(w.second));
  expect(w.seen).not.toHaveBeenCalled(); expect(w.transport.check).not.toHaveBeenCalled();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  act(() => {
    w.authority.replacePolicy(w.policy);
  });
  const fake = fakeTerminalFeed(); let local!: string;
  act(() => {
    local = w.sessions.open({ id: 'forged', title: 'twin', plugin: owner, resource: { label: 'twin', route: { plugin: owner, contribution: 'item', params: { connection, name: 'twin' } } }, open: () => fake })!.id;
  });
  await openAndSettle(w.tab(local));
  expect(screen.getByRole('menuitem', { name: 'Close session' })).toBeVisible(); expect(w.seen).not.toHaveBeenCalled();
  expect(fake.reads()).toBe(0); expect(fake.typed()).toEqual([]);
});

it('refuses cloned records, cross-connection locators, arbitrary pages, mismatched selectors and old owner handles before exec', async () => {
  const w = await workspace(); const original = w.request(w.b);
  for (const req of [{ ...original, record: { ...w.b } }, { ...original, route: { ...original.route, connection: 'elsewhere' } },
    { ...original, route: { page: 'missing', params: {} } }, { ...original, params: { child: 'elsewhere' } },
    { ...original, route: { page: 'item', params: { connection: 'elsewhere' } } }]) {
    await expect(w.handle.open(req)).rejects.toThrow('unavailable');
  }

  w.activated.mockReturnValue(false); await expect(w.handle.open(original)).rejects.toThrow('unavailable'); w.activated.mockReturnValue(true);
  act(() => {
    w.plugins.set([{ ...w.entry, artifact: { ...w.entry.artifact, generation: 'new-owner' } }]);
  });
  await expect(w.handle.open(original)).rejects.toThrow('unavailable'); expect(w.transport.create).toHaveBeenCalledTimes(2);
  const data = JSON.parse(w.transport.create.mock.calls[1][1]); expect(Object.keys(data).sort()).toEqual(['id', 'params', 'root']);
  expect(data.params).toEqual({ child: 'b' }); expect(data.root.reference.incarnation).toBe('b');
  expect(JSON.stringify(data)).not.toMatch(/owner only|private resource body/);
});

it('loads only the named scalar feature after selection; real feature code receives no terminal or connection authority', async () => {
  readAsset.mockReset().mockReturnValue(Object.assign(Promise.resolve(
    'System.register([],function(ex){return {execute:function(){ex(\'describe\',function(input,signal){return {text:Object.keys(input).join(\',\')+\':\'+input.mark+\':\'+Object.isFrozen(input)+\':\'+signal.aborted};});}};});',
  ), { cancel: async () => undefined }));
  const w = await workspace('session-tab', true);
  open(w.tab(w.second)); const info = await row(); expect(readAsset).not.toHaveBeenCalled();
  fireEvent.click(info);
  expect(await screen.findByText('mark:managed:true:false')).toBeVisible();
  expect(readAsset).toHaveBeenCalledExactlyOnceWith(peer, peerRow.pin, peerRow.generation, 'features');
  expect(w.transport.write).not.toHaveBeenCalled(); expect(w.transport.close).not.toHaveBeenCalled();
});

it('does not invoke a removed row or a row whose native attachment failed the final recheck', async () => {
  const w = await workspace(); open(w.tab(w.second)); const stale = await row();
  act(() => {
    w.authority.clearPolicy();
  }); fireEvent.click(stale); expect(w.evaluate).not.toHaveBeenCalled();
  act(() => {
    w.authority.replacePolicy(w.policy);
  }); open(w.tab(w.second)); const fresh = await row();
  w.transport.check.mockResolvedValue(false);
  await act(async () => {
    fireEvent.click(fresh);
  });
  expect(w.evaluate).not.toHaveBeenCalled(); expect(screen.queryByRole('menu')).toBeNull();
});

it('withdraws a pending result on disconnect, never revives it on reconnect, and does not touch the shell', async () => {
  const w = await workspace(); open(w.tab(w.second)); fireEvent.click(await row());
  await waitFor(() => {
    expect(w.evaluate).toHaveBeenCalledTimes(1);
  });
  const prior = w.connections.getSnapshot();
  act(() => {
    w.connections.set({ ...prior, connections: [] });
  });
  act(() => {
    w.connections.set(prior);
  });
  expect(w.evaluate.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => {
    w.pending.resolve({ text: 'obsolete' });
  });
  expect(screen.queryByText('obsolete')).toBeNull(); expect(w.transport.close).not.toHaveBeenCalled();
  expect(w.sessions.feedOf(w.second)?.getSnapshot().state).toBe('running');
  await openAndSettle(w.tab(w.second));
  expect(screen.queryByRole('menuitem', { name: 'Describe item' })).toBeNull();
});

it('never replays a detached menu action after session reorder or a pending attachment check after close', async () => {
  const w = await workspace();
  open(w.tab(w.second)); const stale = await row();
  act(() => {
    w.panel.reorderSession(w.second, 0);
  });
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(stale); expect(w.evaluate).not.toHaveBeenCalled();
  expect(w.panel.getSnapshot().active.terminal).toBe(w.first);
  open(w.tab(w.second)); const fresh = await row();
  const checking = Promise.withResolvers<boolean>();
  w.transport.check.mockReturnValueOnce(checking.promise);
  fireEvent.click(fresh);
  const signal = w.transport.check.mock.calls.at(-1)![3];
  act(() => {
    w.panel.closeSession(w.second);
  });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    checking.resolve(true);
  });
  expect(w.evaluate).not.toHaveBeenCalled();
});

it('hands navigation the clicked shell only; target withdrawal and another workspace visit cancel any pending handoff', async () => {
  const w = await workspace('session-tab', false, true);
  const button = async () => screen.findByRole('menuitem', { name: 'Open inspection' });
  open(w.tab(w.second)); const stale = await button();
  act(() => {
    w.authority.replacePolicy({ ...w.policy, grants: w.policy.grants.filter(grant => grant.point !== detailPoint), revision: 'withdrawn' });
  });
  expect(screen.queryByRole('menu')).toBeNull(); fireEvent.click(stale); expect(w.openDetail).not.toHaveBeenCalled();
  act(() => {
    w.authority.replacePolicy(w.policy);
  });
  open(w.tab(w.second)); const fresh = await button();
  const checking = Promise.withResolvers<boolean>();
  w.transport.check.mockReturnValueOnce(checking.promise);
  fireEvent.click(fresh); act(() => {
    w.tabs.goto(2);
  });
  expect(w.transport.check.mock.calls.at(-1)![3].aborted).toBe(true);
  await act(async () => {
    checking.resolve(true);
  }); expect(w.openDetail).not.toHaveBeenCalled();
  open(w.tab(w.second)); fireEvent.click(await button());
  await waitFor(() => {
    expect(w.openDetail).toHaveBeenCalledTimes(1);
  });
  const [binding, origin, allowed] = w.openDetail.mock.calls[0];
  expect(binding.offer).toBe(`${peer}/show`); expect(origin).toBe(w.shells.originOf(w.sessions.feedOf(w.second)!));
  expect(origin.extensionScopeKey).toBe('b'); expect(allowed()).toBe(true);
  expect(w.panel.getSnapshot().active.terminal).toBe(w.first);
  act(() => {
    w.authority.clearPolicy();
  }); expect(allowed()).toBe(false);
  expect(w.evaluate).not.toHaveBeenCalled(); expect(w.transport.write).not.toHaveBeenCalled(); expect(w.transport.close).not.toHaveBeenCalled();
});

it('retires an old row on native publication before the owner hook coalesces its next render', async () => {
  const w = await workspace(); open(w.tab(w.second)); const stale = await row();
  const replacement = record('b'); // Same UID, address, source and names. Only the rendered row revision changed.
  act(() => {
    w.factSource.remember(replacement, '8'); w.factSource.publish('facts-generation', new Map([[replacement.key, replacement]]));
  });
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(stale); expect(w.evaluate).not.toHaveBeenCalled();
  await openAndSettle(w.tab(w.second));
  expect(screen.getByRole('menuitem', { name: 'Close session' })).toBeVisible();
  expect(screen.queryByRole('menuitem', { name: 'Describe item' })).toBeNull();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  act(() => {
    w.facts.set({ ...w.facts.getSnapshot(), record: replacement });
  });
  open(w.tab(w.second)); fireEvent.click(await row());
  await waitFor(() => {
    expect(w.evaluate).toHaveBeenCalledTimes(1);
  });
  expect(JSON.parse(w.transport.check.mock.calls.at(-1)![2]).viewGeneration).toBe('facts-generation:8');
  act(() => {
    w.factSource.publish();
  });
  expect(w.evaluate.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => {
    w.pending.resolve({ text: 'expired before delivery' });
  });
  expect(screen.queryByText('expired before delivery')).toBeNull();
});

it('rejects a genuine row witness with the same UID but a different resource address', async () => {
  const w = await workspace(), raw = record('b');
  const other = { ...raw, record: { ...raw.record, reference: { ...raw.record.reference,
    address: { ...raw.record.reference.address, scope: [{ dimension: 'zone', value: 'elsewhere' }] } } } };
  w.factSource.remember(other, '8'); w.factSource.publish('facts-generation', new Map([[other.key, other]]));
  act(() => {
    w.facts.set({ ...w.facts.getSnapshot(), record: other });
  });
  await openAndSettle(w.tab(w.second));
  expect(w.seen).toHaveBeenCalled();
  expect(screen.getByRole('menuitem', { name: 'Close session' })).toBeVisible();
  expect(screen.queryByRole('menuitem', { name: 'Describe item' })).toBeNull();
  expect(w.transport.check.mock.calls.map(([, , proof]) => proof)).toEqual(['']);
  expect(w.evaluate).not.toHaveBeenCalled(); expect(w.transport.write).not.toHaveBeenCalled();
});
