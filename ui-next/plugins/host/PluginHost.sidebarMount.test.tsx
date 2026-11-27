import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { MenuHost } from '@omniviewdev/kit';
import type * as RuntimeApi from '@omniviewdev/runtime/api';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useContext } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATE_VERSION, type ExtensionViewRoute, type PersistedTab, type Route, type TabRoute, type TabsStore } from '../../shell/core/tabs';
import { installPopover, teardown } from '../../shell/notices/testing';
import { installDialog } from '../../shell/palette/testing';
import { openSession, SESSION_VERSION, type LoadedSession } from '../../shell/session';
import { memoryStorage } from '../../shell/session/testing';
import type { ContributionV1, CustomPageV1, DetailPageV1, SidebarContextV1 } from '../contract/v1';
import { acme } from '../testing';
import { ExtensionAuthority, type ExtensionGrant, type ExtensionPolicy, type ExtensionSource } from './extensionAuthority';
import { ExtensionAuthorityContext } from './extensionAuthorityContext';
import { ExtensionMenuNavigationContext } from './extensionMenuNavigation';
import type { ShellOrigin } from './resourceShells';
import { pluginSource, unusedVerbs } from './homeTesting';
import { PluginHost, type PluginHostProps } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE, parseRoute } from './route';
import type { WindowService } from './windows';

// Only the native role read is replaced. Admission, policy, System.register linking, host page rendering and tab history are real.
const readRole = vi.hoisted(() => vi.fn());
vi.mock('@omniviewdev/runtime/api', async (load) => {
  const api = await load<typeof RuntimeApi>();
  return { ...api, PluginManager: { ...api.PluginManager, ReadExtensionAsset: readRole } };
});
const moduleText = `System.register(['react/jsx-runtime'],function(ex){var jsx;return {setters:[function(m){jsx=m.jsx;}],execute:function(){
  ex('manager',function Manager(props){return jsx('p',{children:'Manager Body '+JSON.stringify(props)});});
  ex('audit',function Audit(){return jsx('p',{children:'Audit Body'});});
}};});`;
const owner = 'inventory';
const peer = 'peer-tools';
const point = 'sidebar-pages';
const target = `${owner}/${point}`;
const protocol = { protocol: 'inventory/sidebar-view@1', kind: 'view', fields: {} };
const menuPoint = { id: 'actions', label: 'Resource actions', protocol: 'inventory/actions@1', kind: 'menu', placement: 'context-menu', fields: {},
  contract: { package: '@unit/points', version: '1.0.0', export: 'actions' } };
const pointRow = { ...protocol, id: point, placement: 'sidebar', label: 'Extensions', contract: { package: '@unit/points', version: '1.0.0', export: 'sidebarPages' } };
type Offer = { readonly id: string; readonly label: string };
const offers: readonly Offer[] = [{ id: 'manager', label: 'Tool Manager' }, { id: 'audit', label: 'Audit' }];
const ownerSource: ExtensionSource = { id: owner, pin: `sha256:${'a'.repeat(64)}`, generation: 'owner-generation', features: [], views: [], ordinaryReady: true,
  manifest: JSON.stringify({ schemaVersion: 1, id: owner, points: [pointRow], offers: [], bindings: [] }) };
function peerWith(roles: readonly Offer[]): ExtensionSource {
  return { id: peer, pin: `sha256:${'b'.repeat(64)}`, generation: 'peer-generation', features: [], views: roles.map(o => o.id).sort(), ordinaryReady: false,
    manifest: JSON.stringify({ schemaVersion: 1, id: peer, points: [], offers: roles.map(o => ({ ...protocol, ...o, requests: [] })), bindings: roles.map(o => ({ offer: o.id, target })) }) };
}

const peerSource = peerWith(offers);
const view = (id = 'manager', connection: string | null = 'west'): ExtensionViewRoute => ({ kind: 'extension-view', plugin: owner, point, offer: `${peer}/${id}`, ...(connection === null ? {} : { connection }) });
const list: Route = { plugin: owner, contribution: 'deployments', params: { connection: 'west' } };
const detail: Route = { plugin: owner, contribution: 'deployment', params: { connection: 'west', name: 'gateway-sample' } };
const standalone: Route = { plugin: peer, contribution: 'manager', params: { connection: 'foreign' } };
const managerBody = 'Manager Body {"input":{}}';
const custom = (title: string, scope: 'plugin' | 'connection' = 'connection'): CustomPageV1 => ({ kind: 'custom', title, scope, icon: 'box', Body: () => <p>{title} standalone</p> });
const deployment: DetailPageV1 = {
  kind: 'detail', definition: { kind: 'Deployment', tile: { icon: 'box' }, identity: { name: 'name' }, list: { page: 'deployments', label: 'Deployments' },
    tabs: [{ id: 'overview', label: 'Overview' }, { id: 'notes', label: 'Notes' }] },
  usePage: () => ({ scope: [{ role: 'connection', label: 'Connection', icon: 'server', text: 'West cluster' }], source: { state: { kind: 'ready' }, refreshing: false, refresh: async () => undefined,
    view: { tabs: { overview: { kind: 'overview', sections: [] }, notes: { kind: 'custom', content: 'Owner notes' } } } } }),
};
const nodes = [{ id: 'workloads', label: 'Workloads', icon: 'layers', expanded: true, children: [{ id: 'deployments', label: 'Deployments', icon: 'box' }] }] as const;
const contribution = acme({ plugin: { name: 'Inventory' }, home: 'deployments', pages: { deployments: acme().pages.widgets, deployment, manager: custom('Owner manager') },
  sidebar: { label: 'Inventory navigation', title: 'Resources', outlet: point, nodes, useNodes: () => nodes } });
const peerEntry: PluginEntry = { id: peer, name: 'Peer Tools', phase: 'ready', contribution: acme({ plugin: { name: 'Peer Tools' }, home: 'manager', pages: { manager: custom('Independent manager') },
  sidebar: { label: 'Peer Tools navigation', title: 'Peer Tools', nodes: [{ id: 'manager', icon: 'box', label: 'Independent manager' }] } }) };
const saved = (id: string, entries: TabRoute[]): PersistedTab => ({ id, route: entries.at(-1)!, pinned: false, preview: false, history: { entries, index: entries.length - 1 } });
const navigation = (name: 'Back' | 'Forward') => within(screen.getByRole('group', { name: 'Navigation' })).getByRole('button', { name });
const item = (name: string) => screen.getByRole('treeitem', { name });
const shells: readonly never[] = [];
const noShells = { getSnapshot: () => shells, subscribe: () => () => undefined };

beforeAll(() => {
  installDialog(); installPopover(); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('TextEncoder', TextEncoder);
});
afterAll(() => {
  teardown(); vi.unstubAllGlobals();
});
beforeEach(() => {
  readRole.mockReset().mockReturnValue(Object.assign(Promise.resolve(moduleText), { cancel: async () => undefined }));
});
afterEach(cleanup);

type Options = { owner?: ContributionV1; documents?: readonly PersistedTab[]; active?: string | null; link?: PluginHostProps['link']; roles?: readonly Offer[]; routeLess?: boolean; noConnections?: boolean; windows?: WindowService; unknownPolicy?: boolean; menu?: 'sidebar' | 'detail-tab' };
async function workspace(options: Options = {}) {
  const authority = new ExtensionAuthority();
  const roles = options.roles ?? offers;
  const contributor = peerWith(roles);
  const menuTarget = `${owner}/${menuPoint.id}`;
  if (options.menu) {
    const menu = { id: 'open-admin', label: 'Open administration', protocol: menuPoint.protocol, kind: 'menu', fields: {}, requests: [],
      action: { kind: 'openView', point: target, offer: 'manager' } };
    const manifest = { schemaVersion: 1, id: peer, points: [], offers: [...roles.map(role => ({ ...protocol, ...role, requests: [] })), menu],
      bindings: [...roles.map(role => ({ offer: role.id, target })), { offer: menu.id, target: menuTarget }] };
    await authority.replaceSources([
      { ...ownerSource, manifest: JSON.stringify({ schemaVersion: 1, id: owner, points: [{ ...pointRow, placement: options.menu }, menuPoint], offers: [], bindings: [] }) },
      { ...contributor, manifest: JSON.stringify(manifest) },
    ]);
  } else {
    await authority.replaceSources([ownerSource, contributor]);
  }

  const grants: ExtensionGrant[] = roles.map(o => ({ point: target, offer: `${peer}/${o.id}`, ownerPin: ownerSource.pin, contributorPin: peerSource.pin,
    contract: authority.declaredPoint(target)!.contract, fields: [], continuity: 'granted' }));
  if (options.menu) {
    grants.push({ point: menuTarget, offer: `${peer}/open-admin`, ownerPin: ownerSource.pin, contributorPin: peerSource.pin,
      contract: authority.declaredPoint(menuTarget)!.contract, fields: [], continuity: 'granted' });
  }

  const policy: ExtensionPolicy = { known: true, revision: 'issued', disabled: false, disabledOffers: [], disabledBindings: [], grants };
  if (!options.unknownPolicy) {
    authority.replacePolicy(policy);
  }

  const entry: PluginEntry = { id: owner, name: 'Inventory', artifact: { pin: ownerSource.pin, generation: ownerSource.generation }, phase: 'ready', contribution: options.owner ?? contribution };
  const peers = options.routeLess ? [] : [peerEntry];
  const plugins = pluginSource([entry, ...peers]);
  const setOwner = (next: PluginEntry | undefined) => {
    act(() => {
      plugins.set(next ? [next, ...peers] : peers);
    });
  };

  const text = JSON.stringify({ version: SESSION_VERSION, tabs: { version: STATE_VERSION, active: options.active === undefined ? 'T' : options.active,
    tabs: options.documents ?? [saved('T', [list, detail]), saved('peer', [standalone]), saved('matching', [view()])] } });
  const session = openSession(memoryStorage(text).storage, text);
  let tabs!: TabsStore;
  const capture: LoadedSession = { ...session, attach: (parts) => {
    tabs = parts.tabs as TabsStore; return session.attach(parts);
  } };
  const connected = (id: string, name: string) => ({ connection: { id, name }, readiness: 'CONNECTED' });
  const start = vi.fn(async () => ({ status: 'CONNECTED' }));
  const props: PluginHostProps = { plugins, session: capture, inventory: 'ready', link: options.link ?? NO_ROUTE, windows: options.windows, onRetry: vi.fn(), onRetryInventory: vi.fn(),
    terminals: { shells: noShells },
    connections: { ...unusedVerbs, states: async () => ({ [owner]: options.noConnections ? [] : [connected('west', 'West cluster'), connected('east', 'East cluster')], [peer]: [connected('foreign', 'Other account')] }),
      start, onSync: () => () => undefined, onStatus: () => () => undefined } };
  const host = (link: PluginHostProps['link']) => <ExtensionAuthorityContext.Provider value={authority}><PluginHost {...props} link={link} /></ExtensionAuthorityContext.Provider>;
  const page = render(host(props.link), { wrapper: MenuHost });
  await act(async () => Promise.resolve());
  const expand = async () => {
    const group = await screen.findByRole('treeitem', { name: 'Extensions' });
    if (group.getAttribute('aria-expanded') !== 'true') {
      fireEvent.click(group);
    }

    return item('Tool Manager');
  };

  return { authority, policy, tabs, start, expand, page, entry, setOwner, hash: (hash: string) => {
    page.rerender(host(parseRoute(hash)));
  } };
}

describe('the owner-hosted sidebar location', () => {
  it('requires a separate destination grant for a menu action and opens the route-less peer inside the owner tab', async () => {
    const withMenu: DetailPageV1 = { ...deployment, usePage: () => ({
      source: { state: { kind: 'ready' }, refreshing: false, refresh: async () => undefined,
        view: { extensionScopeKey: 'object-incarnation', tabs: { overview: { kind: 'overview', sections: [], menuOutlet: { point: 'actions', context: {} } } } } },
    }) };
    const { tabs, authority, policy } = await workspace({ menu: 'sidebar', routeLess: true,
      owner: { ...contribution, pages: { ...contribution.pages, deployment: withMenu } }, documents: [saved('T', [list, detail])] });
    const trigger = await screen.findByRole('button', { name: 'Resource actions' });
    expect(readRole).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    const command = await screen.findByRole('menuitem', { name: 'Open administration' });
    fireEvent.click(command);
    await screen.findByText(managerBody);
    expect(tabs.getSnapshot().order).toEqual(['T']);
    expect(tabs.getSnapshot().tabs.T?.location.route).toEqual(view());
    fireEvent.click(navigation('Back'));
    await screen.findByRole('button', { name: 'Resource actions' });
    act(() => {
      authority.replacePolicy({ ...policy, revision: 'dest-removed', grants: policy.grants.filter(grant => grant.offer !== `${peer}/manager`) });
    });
    expect(screen.queryByRole('button', { name: 'Resource actions' })).not.toBeInTheDocument();
    expect(tabs.getSnapshot().tabs.T?.location.route).toEqual(detail);
  });

  it.each([true, false])('opens only the terminal’s ordinary resource locator; matching incarnation: %s', async matching => {
    let origin: ShellOrigin;
    function TerminalAction() {
      const menu = useContext(ExtensionMenuNavigationContext);
      const authority = useContext(ExtensionAuthorityContext);
      return <button onClick={() => {
        const binding = authority?.point(`${owner}/actions`)[0];
        if (binding) {
          menu?.openDetail(binding, origin, () => true);
        }
      }}>Open resource tab</button>;
    }

    const shell: CustomPageV1 = { ...custom('Console'), Body: TerminalAction };
    const object: DetailPageV1 = { ...deployment, usePage: () => ({
      source: { state: { kind: 'ready' }, refreshing: false, refresh: async () => undefined, view: {
        extensionScopeKey: matching ? 'original-uid' : 'replacement-uid', tabOutlet: { point, context: {} },
        tabs: { overview: { kind: 'overview', sections: [] } },
      } },
    }) };
    const start: Route = { plugin: owner, contribution: 'console', params: { connection: 'west' } };
    const { tabs, entry } = await workspace({ menu: 'detail-tab', routeLess: true,
      owner: { ...contribution, pages: { ...contribution.pages, console: shell, deployment: object } }, documents: [saved('T', [start])] });
    origin = { entry, connection: 'west', extensionScopeKey: 'original-uid', route: { page: 'deployment', params: {
      name: 'gateway-sample', containerID: 'private-container',
    } }, current: () => true, verify: async () => true, onRetire: () => () => undefined };
    fireEvent.click(await screen.findByRole('button', { name: 'Open resource tab' }));
    await screen.findByRole('tab', { name: 'Tool Manager' });
    expect(tabs.getSnapshot().tabs.T?.history.entries).toEqual([start, detail]);
    if (matching) {
      await screen.findByText(managerBody);
    } else {
      expect(readRole).not.toHaveBeenCalled();
    }

    fireEvent.click(navigation('Back'));
    await screen.findByRole('button', { name: 'Open resource tab' });
    fireEvent.click(navigation('Forward'));
    expect(await screen.findByRole('tab', { name: 'Overview', selected: true })).toBeVisible();
  });

  it('pushes in the resource tab, Back restores its exact subtab/scroll, Forward remounts; neither sibling moves', async () => {
    const useNodes = vi.fn((_context: SidebarContextV1) => nodes);
    const { tabs, expand } = await workspace({ owner: { ...contribution, sidebar: { ...contribution.sidebar, useNodes } } });
    const before = tabs.getSnapshot();
    const tree = screen.getByRole('tree', { name: 'Inventory navigation' });
    const rail = screen.getByRole('button', { name: 'Inventory' });
    expect(screen.getByRole('heading', { name: 'gateway-sample' })).toBeVisible();
    expect(item('Deployments')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }));
    const region = document.querySelector<HTMLElement>('[data-shell-part="page"]')!;
    region.scrollTop = 174;
    fireEvent.scroll(region);
    expect(tabs.getSnapshot().tabs.T.history.entries).toEqual([list, detail]);
    const leaf = await expand();
    const ownerContext = useNodes.mock.lastCall![0];
    expect(ownerContext).toMatchObject({ route: { page: 'deployment', connection: 'west', params: { name: 'gateway-sample' } }, open: ['workloads'] });
    expect(readRole).not.toHaveBeenCalled();
    fireEvent.click(leaf);
    const firstBody = await screen.findByText(managerBody);
    expect(firstBody).toBeVisible();
    expect(readRole).toHaveBeenCalledWith(peer, peerSource.pin, peerSource.generation, 'views');
    expect(tree).toBe(screen.getByRole('tree', { name: 'Inventory navigation' }));
    expect(useNodes.mock.lastCall![0]).toBe(ownerContext);
    expect(rail).toHaveAttribute('aria-current', 'true');
    expect(leaf).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Connection: West cluster' })).toBeVisible();
    expect(tabs.getSnapshot().tabs.T.face.path.map(c => c.label)).toEqual(['Inventory', 'West cluster', 'Tool Manager']);
    expect(tabs.getSnapshot()).toMatchObject({ active: 'T', order: before.order, tabs: { T: { history: { index: 2, entries: [list, detail, view()] } } } });
    expect(region.scrollTop).toBe(0);
    fireEvent.click(navigation('Back'));
    expect(screen.getByRole('heading', { name: 'gateway-sample' })).toBeVisible();
    expect(item('Deployments')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
    expect(region.scrollTop).toBe(174);
    expect(tabs.getSnapshot().tabs.T.history.index).toBe(1);
    fireEvent.click(navigation('Forward'));
    expect(await screen.findByText(managerBody)).not.toBe(firstBody);
    expect(item('Tool Manager')).toHaveAttribute('aria-selected', 'true');
    expect(tabs.getSnapshot().active).toBe('T');
    expect(tabs.getSnapshot().tabs.peer.history).toBe(before.tabs.peer.history);
    expect(tabs.getSnapshot().tabs.matching.history).toBe(before.tabs.matching.history);
    fireEvent.click(item('Tool Manager'), { altKey: true });
    expect(tabs.getSnapshot().tabs.T.history.entries).toHaveLength(3);
    fireEvent.click(navigation('Back'));
    fireEvent.click(item('Audit'));
    expect(await screen.findByText('Audit Body')).toBeVisible();
    expect(tabs.getSnapshot().tabs.T.history.entries).toEqual([list, detail, view('audit')]);
    expect(tabs.canForward('T')).toBe(false);
  });

  it('uses the displayed owner scope even beside a peer document; the peer page and matching mount are not smart-open destinations', async () => {
    const { tabs, expand } = await workspace({ active: 'peer' });
    expect(screen.getByText('Independent manager standalone')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Inventory' }));
    const leaf = await expand();
    act(() => {
      leaf.focus();
    });
    await userEvent.setup().keyboard('{Enter}');
    expect(await screen.findByText(managerBody)).toBeVisible();
    expect(tabs.getSnapshot()).toMatchObject({ active: 'peer', tabs: { peer: { history: { entries: [standalone, view()], index: 1 } }, T: { history: { entries: [list, detail] } } } });
  });

  it('maps explicit tab/window gestures once; background and refused windows do not consume the source', async () => {
    const { tabs, expand } = await workspace({ documents: [saved('T', [list, detail])] });
    const leaf = await expand();
    const before = tabs.getSnapshot().tabs.T;
    fireEvent.click(leaf, { shiftKey: true });
    expect(tabs.getSnapshot().order).toEqual(['T']);
    expect(await screen.findByText('A new window opens in the desktop app.')).toBeVisible();
    fireEvent.click(leaf, { ctrlKey: true });
    fireEvent(leaf, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
    const background = tabs.getSnapshot();
    expect(background.order).toHaveLength(3);
    expect(background.active).toBe('T');
    for (const tab of Object.values(background.tabs).filter(tab => tab.id !== 'T')) {
      expect(tab.history).toEqual({ entries: [view()], index: 0 });
    }

    expect(item('Deployments')).toHaveAttribute('aria-selected', 'true');
    expect(readRole).not.toHaveBeenCalled();
    fireEvent.click(leaf, { ctrlKey: true, shiftKey: true });
    expect(await screen.findByText(managerBody)).toBeVisible();
    expect(tabs.getSnapshot().order).toHaveLength(4);
    expect(tabs.getSnapshot().active).not.toBe('T');
    expect(tabs.getSnapshot().tabs.T.history).toBe(before.history);
  });

  it('sends only the locator to a new desktop window without claiming a sibling tab or starting its Body here', async () => {
    const open = vi.fn<WindowService['open']>(async () => 'other');
    const unused = async () => {
      throw new Error('Unexpected native operation');
    };

    const windows: WindowService = { name: async () => 'main', list: async () => [{ name: 'main', kind: 'workspace' }], open, on: () => () => undefined,
      viewport: async () => undefined, close: unused, focus: unused, place: unused, beginDrag: unused, moveDrag: unused, endDrag: unused, cancelDrag: unused, respondDrop: unused, emit: unused };
    const { tabs, expand } = await workspace({ windows });
    const before = tabs.getSnapshot();
    fireEvent.click(await expand(), { shiftKey: true });
    expect(open).toHaveBeenCalledTimes(1);
    const session = JSON.parse(open.mock.calls[0][0]) as { tabs: { active: string; tabs: unknown[] } };
    expect(session.tabs.tabs).toEqual([{ id: session.tabs.active, route: view() }]);
    expect(tabs.getSnapshot().active).toBe('T');
    expect(tabs.getSnapshot().order).toBe(before.order);
    expect(tabs.getSnapshot().tabs.T.history).toBe(before.tabs.T.history);
    expect(readRole).not.toHaveBeenCalled();
  });

  it('never commits a cancelled press, a stale tab confirmation, or consent revoked and reissued during confirmation', async () => {
    const { tabs, expand, authority, policy } = await workspace();
    const leaf = await expand();
    act(() => {
      tabs.setUnsaved('T', true);
    });
    const before = tabs.getSnapshot().tabs.T.history;
    fireEvent.click(leaf);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(tabs.getSnapshot().tabs.T.history).toBe(before);
    fireEvent.click(leaf);
    act(() => {
      tabs.activate('peer'); tabs.activate('T');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(tabs.getSnapshot().tabs.T.history).toBe(before);
    fireEvent.click(await expand());
    act(() => {
      tabs.activate('peer');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(tabs.getSnapshot().active).toBe('peer');
    expect(tabs.getSnapshot().tabs.T.history).toBe(before);
    act(() => {
      tabs.activate('T');
    });
    fireEvent.click(await expand());
    act(() => {
      authority.clearPolicy(); authority.replacePolicy(policy);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(tabs.getSnapshot().tabs.T.history).toBe(before);
    expect(readRole).not.toHaveBeenCalled();
    fireEvent.click(item('Tool Manager'));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(await screen.findByText(managerBody)).toBeVisible();
  });

  it('retains the location on withdrawal: Back works, denied Forward never executes, and regrant needs a fresh press', async () => {
    const { tabs, expand, authority, policy } = await workspace();
    const demand = vi.spyOn(authority, 'beginDemand');
    fireEvent.click(await expand());
    const body = await screen.findByText(managerBody);
    const started = demand.mock.calls.length;
    act(() => {
      authority.replacePolicy({ ...policy, grants: policy.grants.filter(g => g.offer !== `${peer}/audit`) });
    });
    expect(screen.getByText(managerBody)).toBe(body);
    expect(item('Tool Manager')).toHaveAttribute('aria-selected', 'true');
    expect(demand).toHaveBeenCalledTimes(started);
    const history = tabs.getSnapshot().tabs.T.history;
    act(() => {
      authority.clearPolicy();
    });
    expect(screen.queryByText(managerBody)).toBeNull();
    expect(screen.queryByRole('treeitem', { name: 'Tool Manager' })).toBeNull();
    expect(screen.getByText('View unavailable', { selector: 'strong' })).toBeVisible();
    expect(tabs.getSnapshot().tabs.T.history).toBe(history);
    fireEvent.click(navigation('Back'));
    readRole.mockClear();
    fireEvent.click(navigation('Forward'));
    expect(screen.getByText('View unavailable', { selector: 'strong' })).toBeVisible();
    expect(readRole).not.toHaveBeenCalled();
    fireEvent.click(navigation('Back'));
    act(() => {
      authority.replacePolicy(policy);
    });
    fireEvent.click(navigation('Forward'));
    expect(await screen.findByText(managerBody)).toBeVisible();
    act(() => {
      authority.retireSource(peer);
    });
    expect(screen.queryByText(managerBody)).toBeNull();
    await act(async () => authority.replaceSources([ownerSource, peerSource]));
    expect(screen.queryByText(managerBody)).toBeNull();
    fireEvent.click(await expand());
    expect(await screen.findByText(managerBody)).toBeVisible();
    expect(tabs.getSnapshot().tabs.T.history.entries).toEqual([list, detail, view()]);
  });

  it('keeps a withdrawn owner’s document and uses the ordinary unavailable-owner page, never the peer’s frame', async () => {
    const { tabs, expand, authority, entry, setOwner } = await workspace();
    fireEvent.click(await expand());
    await screen.findByText(managerBody);
    const history = tabs.getSnapshot().tabs.T.history;
    act(() => {
      authority.retireSource(owner);
    });
    setOwner(undefined);
    expect(screen.getByText('This plugin is not installed, or is turned off.')).toBeVisible();
    expect(screen.queryByRole('tree', { name: 'Peer Tools navigation' })).toBeNull();
    expect(screen.queryByText(managerBody)).toBeNull();
    expect(tabs.getSnapshot().tabs.T.history).toBe(history);
    await act(async () => authority.replaceSources([ownerSource, peerSource]));
    setOwner(entry);
    expect(screen.queryByText(managerBody)).toBeNull();
    fireEvent.click(await expand());
    expect(await screen.findByText(managerBody)).toBeVisible();
  });

  it('preserves owner rows, limits offers in ASCII ID order, distinguishes equal labels and reserves nested owner IDs', async () => {
    const roles = Array.from({ length: 18 }, (_, i) => ({ id: `row${String(i).padStart(2, '0')}`, label: i < 2 ? 'Twin' : `Item ${i}` })).reverse();
    const group = `~view/${target}`;
    const collision = (id: string) => ({ ...contribution, sidebar: { ...contribution.sidebar,
      nodes: [{ id: 'reserved', label: 'Reserved', icon: 'layers' as const, children: [{ id, label: 'Owner link', icon: 'box' as const, page: 'deployments' }] }],
      useNodes: () => nodes } });
    const { page } = await workspace({ roles, owner: collision(`${group}/${peer}/row07`) });
    fireEvent.click(await screen.findByRole('treeitem', { name: 'Extensions' }));
    const visible = screen.getAllByRole('treeitem').map(el => el.textContent);
    expect(visible).toEqual(['Workloads', 'Deployments', 'Extensions', ...roles.toReversed().slice(0, 16).filter(o => o.id !== 'row07')
      .map(o => o.label === 'Twin' ? `Twin (${peer}/${o.id})` : o.label)]);
    expect(item(`Twin (${peer}/row00)`)).toHaveAccessibleName(`Twin (${peer}/row00)`);
    page.unmount();
    await workspace({ roles, owner: collision(group) });
    expect(item('Deployments')).toBeVisible();
    expect(screen.queryByRole('treeitem', { name: 'Extensions' })).toBeNull();
    expect(readRole).not.toHaveBeenCalled();
  });

  it('switches the owner connection by replacing this entry or showing its matching sibling', async () => {
    const { tabs, expand } = await workspace();
    const sheet = document.createElement('style');
    sheet.textContent = '[popover] { display: block !important; }';
    document.head.append(sheet);
    try {
      fireEvent.click(await expand());
      const west = await screen.findByText(managerBody);
      fireEvent.click(screen.getByRole('button', { name: 'Connection: West cluster' }));
      fireEvent.click(await screen.findByRole('option', { name: /East cluster/ }));
      await waitFor(() => {
        expect(tabs.getSnapshot().tabs.T.history.entries).toEqual([list, detail, view('manager', 'east')]);
      });
      expect(await screen.findByText(managerBody)).not.toBe(west);
      fireEvent.click(screen.getByRole('button', { name: 'Connection: East cluster' }));
      fireEvent.click(await screen.findByRole('option', { name: /West cluster/ }));
      await waitFor(() => {
        expect(tabs.getSnapshot().active).toBe('matching');
      });
      expect(tabs.getSnapshot().tabs.T.location.route).toEqual(view('manager', 'east'));
    } finally {
      sheet.remove();
    }
  });

  it('restores a locator without trusting its presentation; the background tab has neither a demand nor hidden peer DOM', async () => {
    const forged = { ...saved('T', [list, view()]), key: 'peer:manager', face: { title: 'Forged face', path: [], facets: [], pluginName: 'Spoof', icon: 'box', scope: undefined, singleton: true, identity: 'key' as const } };
    const { tabs, authority, policy } = await workspace({ active: 'peer', unknownPolicy: true, documents: [forged, saved('peer', [standalone])] });
    expect(tabs.getSnapshot().tabs.T.face.title).toBe('View unavailable');
    expect(readRole).not.toHaveBeenCalled();
    act(() => {
      tabs.activate('T');
    });
    expect(screen.getByText('View unavailable', { selector: 'strong' })).toBeVisible();
    expect(screen.queryByText('Forged face')).toBeNull();
    expect(readRole).not.toHaveBeenCalled();
    act(() => {
      authority.replacePolicy(policy);
    });
    const body = await screen.findByText(managerBody);
    act(() => {
      tabs.activate('peer');
    });
    expect(body.isConnected).toBe(false);
    expect(tabs.getSnapshot().tabs.T.history.entries).toEqual([list, view()]);
    act(() => {
      tabs.activate('T');
    });
    expect(await screen.findByText(managerBody)).not.toBe(body);
  });

  it('consumes a mounted hash once, never guesses an omitted scoped connection, and never falls through a malformed hash', async () => {
    const { tabs, hash, start } = await workspace({ routeLess: true, documents: [saved('T', [list, detail])] });
    const valid = '#~view/1/inventory/sidebar-pages/peer-tools/manager?connection=west';
    hash(valid);
    expect(await screen.findByText(managerBody)).toBeVisible();
    fireEvent.click(navigation('Back'));
    hash(valid);
    expect(tabs.getSnapshot().tabs.T.location.route).toEqual(detail);
    hash(`${valid}&connection=east`);
    expect(tabs.getSnapshot().tabs.T.location.route).toEqual(detail);
    readRole.mockClear();
    hash(valid.split('?')[0]);
    expect(screen.getByText('View unavailable', { selector: 'strong' })).toBeVisible();
    expect(tabs.getSnapshot().tabs.T.location.route).toEqual(view('manager', null));
    expect(start).not.toHaveBeenCalled();
    expect(readRole).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Peer Tools' })).toBeNull();
  });

  it('permits an explicitly unscoped workspace with no document, not a scoped owner’s connection-picker landing', async () => {
    const unscoped = acme({ ...contribution, home: 'help', pages: { help: custom('Help', 'plugin') }, sidebar: { label: 'Guide', title: 'Guide', nodes: [], outlet: point } });
    const { tabs, expand, page } = await workspace({ routeLess: true, noConnections: true, documents: [], active: null, owner: unscoped });
    fireEvent.click(await expand());
    expect(await screen.findByText(managerBody)).toBeVisible();
    expect(Object.values(tabs.getSnapshot().tabs).map(tab => tab.history.entries)).toEqual([[view('manager', null)]]);
    page.unmount();
    readRole.mockClear();
    const mixed = { ...contribution, pages: { ...contribution.pages, picker: custom('Choose cluster', 'plugin') }, landing: 'picker' };
    await workspace({ routeLess: true, owner: mixed, documents: [saved('T', [{ plugin: owner, contribution: 'picker', params: {} }])] });
    expect(screen.getByText('Choose cluster standalone')).toBeVisible();
    expect(screen.queryByRole('treeitem', { name: 'Extensions' })).toBeNull();
    expect(readRole).not.toHaveBeenCalled();
  });
});
