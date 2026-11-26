import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore } from '../../shell';
import { openSession, SESSION_VERSION } from '../../shell/session';
import { memoryStorage } from '../../shell/session/testing';
import type { ConnectionVerbResultV1, ContributionV1, CustomPageContextV1, SidebarContextV1, SidebarNodeV1 } from '../contract/v1';
import { acme } from '../testing';
import type { ConnectionsApi, StateRecord } from './connections/api';
import { PluginHost, type PluginHostProps } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE, type HostRoute } from './route';

Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

// jsdom has no modal dialog: stand-ins that open and close the element, as the attribute does (what a modal does in a real engine is the browser's to show).
const modal = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
modal.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

modal.close ??= function close(this: HTMLDialogElement) {
  this.removeAttribute('open');
};

// The plugin's landing through the host (KL2), against an invented plugin (Acme) that declares one: a custom page of scope `plugin` that lists the plugin's connections from `context.connections` and opens one. The host's connection API is a fake with two
// connections of Acme and a start that connects; the list can be held on its way, so that an open that waits for it is seen to wait.

const NORTH = 'north-1';
const SOUTH = 'south-2';

function fakeHost() {
  const readiness: Record<string, string> = { [NORTH]: 'DISCONNECTED', [SOUTH]: 'CONNECTED' };
  let gate: PromiseWithResolvers<void> | undefined;
  const record = (id: string, name: string): StateRecord => ({ connection: { id, name }, readiness: readiness[id] ?? 'DISCONNECTED' });
  const api: ConnectionsApi = {
    check: vi.fn(async () => Promise.resolve({ status: 'CONNECTED' })),
    stop: vi.fn(async (_plugin: string, key: string) => {
      readiness[key] = 'DISCONNECTED';
      return Promise.resolve(undefined);
    }),
    remove: vi.fn(async () => Promise.resolve()),
    load: vi.fn(async () => Promise.resolve([])),
    states: vi.fn(async () => {
      await gate?.promise;
      return { acme: [record(NORTH, 'north'), record(SOUTH, 'south')] };
    }),
    start: vi.fn(async (_plugin: string, key: string) => {
      readiness[key] = 'CONNECTED';
      return Promise.resolve({ status: 'CONNECTED' });
    }),
    onStatus: () => () => undefined,
    onSync: () => () => undefined,
  };
  return {
    api,
    hold: () => {
      gate = Promise.withResolvers<void>();
    },
    release: () => {
      gate?.resolve();
    },
  };
}

function Landing({ context }: { readonly context: CustomPageContextV1 }) {
  const { connections } = context;
  const view = useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  const [answer, setAnswer] = useState('');
  const said = (result: ConnectionVerbResultV1) => {
    setAnswer(result.ok ? 'done' : result.cancelled === true ? 'cancelled' : result.reason);
  };

  return (
    <section aria-label="Acme landing">
      <h1>Acme home</h1>
      <p>{`Filter: ${context.route.params.filter ?? 'all'}`}</p>
      <p role="status">{view.loaded ? `${String(view.connections.length)} connections` : 'Reading the connections…'}</p>
      <p aria-label="Last answer">{answer}</p>
      {view.connections.map((connection) => (
        <div key={connection.key}>
          <button
            type="button"
            onClick={() => {
              void connections.open(connection.key);
            }}
          >
            {`Open ${connection.name}`}
          </button>
          <button
            type="button"
            onClick={() => {
              void connections.disconnect(connection.key).then(said);
            }}
          >
            {`Disconnect ${connection.name}`}
          </button>
        </div>
      ))}
    </section>
  );
}

/** Acme, with a landing or without one: the same plugin otherwise. */
const entry = (landing: boolean, sidebar: ContributionV1['sidebar'] = acme().sidebar): PluginEntry => ({
  id: 'acme',
  name: 'Acme plugin',
  phase: 'ready',
  contribution: landing ? acme({ pages: { ...acme().pages, landing: { kind: 'custom', scope: 'plugin', title: 'Acme home', icon: 'house', Body: Landing } }, landing: 'landing', sidebar }) : acme(),
});

const link = (page: string | undefined): HostRoute => ({ plugin: 'acme', page, connection: undefined, params: {} });

/** A saved window whose tabs are these, the last on screen: `[id, plugin, page, title, params?]`. */
const saved = (...tabs: ReadonlyArray<readonly [string, string, string, string, Readonly<Record<string, string>>?]>) =>
  openSession(
    memoryStorage().storage,
    JSON.stringify({
      version: SESSION_VERSION,
      tabs: {
        version: 1,
        active: tabs.at(-1)?.[0] ?? null,
        tabs: tabs.map(([id, plugin, page, title, params = {}]) => ({
          id,
          route: { plugin, contribution: page, params },
          key: Object.keys(params).length === 0 ? `${plugin}:${page}` : `${plugin}:${page}?${JSON.stringify(params)}`,
          face: { title, icon: 'box', path: [], facets: [], pluginName: plugin === 'host' ? '' : 'Acme plugin', singleton: false, identity: 'key' },
          pinned: false,
          preview: false,
          history: { entries: [{ plugin, contribution: page, params }], index: 0 },
        })),
      },
      rail: null,
      panel: { version: 1 },
    }),
  );

function mount(plugin: PluginEntry, over: Partial<PluginHostProps> = {}, host = fakeHost()) {
  const entries: readonly PluginEntry[] = [plugin];
  const props: PluginHostProps = { plugins: { getSnapshot: () => entries, subscribe: () => () => undefined }, inventory: 'ready', link: NO_ROUTE, onRetry: vi.fn(), onRetryInventory: vi.fn(), panel: createPanelStore(), connections: host.api, ...over };
  render(<PluginHost {...props} />);
  return { host, user: userEvent.setup() };
}

const faces = (): Array<string | null> => screen.queryAllByRole('tab').map((tab) => tab.textContent);
const heading = async () => screen.findByRole('heading', { level: 1, name: 'Acme home' });
const row = (container: HTMLElement) => within(container).getByRole('button', { name: /Acme/ });
const rail = () => within(screen.getByRole('group', { name: 'Plugins' }));

afterEach(cleanup);

describe('a plugin that declares a landing', () => {
  it('is what Home\'s row, the rail and + open, with no choosing of a connection and without waiting for the list of connections', async () => {
    const host = fakeHost();
    host.hold();
    const { user } = mount(entry(true), { session: saved(['h', 'host', 'home', 'Home']) }, host);

    await user.click(row(await screen.findByRole('region', { name: 'Plugins you can open' })));
    expect(await heading()).toBeInTheDocument();
    expect(faces()).toEqual(['Home', 'Acme home']);
    expect(screen.queryByText(/Choose one of the connections/)).toBeNull();
    // The list has not come back, and the landing is open and says so.
    expect(within(screen.getByRole('region', { name: 'Acme landing' })).getByRole('status')).toHaveTextContent('Reading the connections…');
    host.release();

    await user.click(screen.getByRole('tab', { name: 'Home' }));
    await user.click(rail().getByRole('button', { name: 'Acme' }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Acme home' })).toHaveAttribute('aria-selected', 'true');
    });

    await user.click(screen.getByRole('button', { name: 'New tab' }));
    expect(faces()).toEqual(['Home', 'Acme home', 'Acme home']);
  });

  it('is what a route to a page of a connection that names no connection opens, with two connections and none used: the plugin chooses nothing for the person', async () => {
    mount(entry(true), { link: link('widgets') });

    expect(await heading()).toBeInTheDocument();
    expect(faces()).toEqual(['Acme home']);
  });

  it('opens a connection as Home\'s row does: the host starts it first, and the plugin\'s home opens in it in a new tab, where the landing stays', async () => {
    const { user, host } = mount(entry(true), { link: link(undefined) });

    await user.click(await screen.findByRole('button', { name: 'Open north' }));

    await waitFor(() => {
      expect(faces()).toEqual(['Acme home', 'Widgets']);
    });
    expect(host.api.start).toHaveBeenCalledExactlyOnceWith('acme', NORTH);
    expect(screen.getByRole('tab', { name: /Widgets/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('has no scope lane and no sidebar while it is on screen, and the plugin\'s rail entry is current; a page of a connection has the sidebar back', async () => {
    const { user } = mount(entry(true), { link: link(undefined) });
    await heading();

    expect(screen.queryByRole('group', { name: 'Acme scope' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Acme navigation' })).toBeNull();
    expect(rail().getByRole('button', { name: 'Acme' })).toHaveAttribute('aria-current', 'true');

    await user.click(await screen.findByRole('button', { name: 'Open south' }));
    expect(await screen.findByRole('navigation', { name: 'Acme navigation' })).toBeInTheDocument();
  });

  it('comes back with a saved window: drawn from the face it was saved with until its plugin has loaded, and then as the page', () => {
    let entries: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'loading' }];
    const listeners = new Set<() => void>();
    const plugins = {
      getSnapshot: () => entries,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    mount(entry(true), { plugins, session: saved(['l', 'acme', 'landing', 'Acme home']) });
    expect(faces()).toEqual(['Acme home']);
    expect(screen.queryByRole('heading', { level: 1, name: 'Acme home' })).toBeNull();

    act(() => {
      entries = [entry(true)];
      for (const listener of [...listeners]) {
        listener();
      }
    });

    expect(screen.getByRole('heading', { level: 1, name: 'Acme home' })).toBeInTheDocument();
    expect(faces()).toEqual(['Acme home']);
  });
});

describe('the verbs of a landing', () => {
  it('asks the person in the host\'s own dialog before it stops a connection, naming the connection and the tabs of it that are open: a no stops nothing and the plugin is told so, a yes stops it', async () => {
    const { user, host } = mount(entry(true), { link: link(undefined) });
    await user.click(await screen.findByRole('button', { name: 'Open south' }));
    await waitFor(() => {
      expect(faces()).toEqual(['Acme home', 'Widgets']);
    });
    await user.click(screen.getByRole('tab', { name: 'Acme home' }));

    await user.click(await screen.findByRole('button', { name: 'Disconnect south' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect' });

    expect(within(dialog).getByText('south')).toBeInTheDocument();
    expect(within(dialog).getByText('1 open tab of south will lose the connection. You can connect again at any time.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Last answer')).toHaveTextContent('cancelled');
    expect(host.api.stop).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Disconnect south' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Disconnect' })).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Last answer')).toHaveTextContent('done');
    });
    expect(host.api.stop).toHaveBeenCalledExactlyOnceWith('acme', SOUTH);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('a plugin that declares none', () => {
  it('is completed as it was: Home\'s row opens Home, where the window would choose', async () => {
    const { user } = mount(entry(false));

    await user.click(row(screen.getByRole('region', { name: 'Plugins you can open' })));

    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(faces()).toEqual(['Home']);
  });
});

// The plugin's sidebar on its landing (KL5): Acme's hook answers a navigator for the landing from the connections it is given (an entry that opens the landing, one that opens it with a parameter, and a group of its connections, each a leaf that opens that connection, with a badge on the
// ones that are not connected), and nothing for a page of a connection, where its skeleton stands.
const seen: SidebarContextV1[] = [];

function useNavigator(context: SidebarContextV1): readonly SidebarNodeV1[] | undefined {
  seen.push(context);
  const { connections, route } = context;
  const view = useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  return useMemo(
    () =>
      route.page === 'landing'
        ? [
          { id: 'landing', label: 'All', icon: 'layers', count: view.connections.length },
          { id: 'attention', label: 'Needs attention', icon: 'bell', count: view.connections.filter((connection) => connection.role === 'attention').length, page: 'landing', params: { filter: 'attention' } },
          {
            id: 'connections',
            label: 'Connections',
            icon: 'server',
            children: view.connections.map((connection): SidebarNodeV1 => ({
              id: `connection-${connection.key}`,
              label: connection.name,
              icon: 'server',
              tone: 'green',
              connection: connection.key,
              ...(connection.role === 'healthy' ? {} : { status: { role: connection.role, label: connection.word } }),
            })),
          },
        ]
        : undefined,
    [route.page, view],
  );
}

describe('a plugin whose sidebar answers on its landing', () => {
  const navigated = () => entry(true, { ...acme().sidebar, useNodes: useNavigator });
  const sidebar = async () => within(await screen.findByRole('navigation', { name: 'Acme navigation' }));

  it('draws what its hook answers for the landing and no skeleton under it, and the hook is given a route that names no connection and the plugin\'s connections; a badge is part of what its row says', async () => {
    seen.length = 0;
    const { user } = mount(navigated(), { link: link(undefined) });
    const tree = await sidebar();

    expect(await tree.findByRole('treeitem', { name: 'All 2' })).toBeInTheDocument();
    expect(tree.queryByRole('treeitem', { name: 'Group' })).toBeNull();
    await user.click(tree.getByRole('treeitem', { name: 'Connections' }));
    expect(tree.getAllByRole('treeitem').map((item) => item.textContent)).toEqual(['All 2', 'Needs attention 0', 'Connections', 'north Disconnected', 'south']);
    expect(seen.at(-1)?.route).toEqual({ page: 'landing', connection: undefined, params: {} });
    expect(seen.at(-1)?.connections.open).toEqual(expect.any(Function));
  });

  it('opens the landing with the parameters of an entry, in the tab on screen, and selects that entry and no other: the page is drawn again with the parameters it reads', async () => {
    const { user } = mount(navigated(), { link: link(undefined) });
    const tree = await sidebar();
    expect(await tree.findByRole('treeitem', { name: 'All 2' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Filter: all')).toBeInTheDocument();

    await user.click(tree.getByRole('treeitem', { name: 'Needs attention 0' }));

    expect(await screen.findByText('Filter: attention')).toBeInTheDocument();
    expect(tree.getByRole('treeitem', { name: 'Needs attention 0' })).toHaveAttribute('aria-selected', 'true');
    expect(tree.getByRole('treeitem', { name: 'All 2' })).toHaveAttribute('aria-selected', 'false');
    expect(faces()).toEqual(['Acme home']);
  });

  it('opens a connection from the entry that names it, as a press on one of Home\'s rows does: the host starts it first, and the plugin\'s home opens in it, in a tab beside the landing', async () => {
    const { user, host } = mount(navigated(), { link: link(undefined) });
    const tree = await sidebar();
    await user.click(await tree.findByRole('treeitem', { name: 'Connections' }));

    await user.click(tree.getByRole('treeitem', { name: /^north/ }));

    await waitFor(() => {
      expect(faces()).toEqual(['Acme home', 'Widgets']);
    });
    expect(host.api.start).toHaveBeenCalledExactlyOnceWith('acme', NORTH);
  });

  it('says why when the connection cannot be opened, as the host says it of a row of Problems: an error notice that names the connection, with the host\'s sentence, and no tab opens', async () => {
    const { user, host } = mount(navigated(), { link: link(undefined) });
    vi.mocked(host.api.start).mockResolvedValueOnce({ status: 'UNAUTHORIZED' });
    const tree = await sidebar();
    await user.click(await tree.findByRole('treeitem', { name: 'Connections' }));

    await user.click(tree.getByRole('treeitem', { name: /^north/ }));

    const notice = await screen.findByRole('alert', { name: 'Error: Couldn\'t open north' });
    expect(within(notice).getByText('The connection needs you to sign in.')).toBeInTheDocument();
    expect(faces()).toEqual(['Acme home']);
  });

  it('comes back from a saved window at the place it was saved at: the parameters of the landing are kept, the page reads them and the entry that opens them is selected', async () => {
    mount(navigated(), { session: saved(['l', 'acme', 'landing', 'Acme home', { filter: 'attention' }]) });

    expect(await screen.findByText('Filter: attention')).toBeInTheDocument();
    expect(await (await sidebar()).findByRole('treeitem', { name: 'Needs attention 0' })).toHaveAttribute('aria-selected', 'true');
  });
});
