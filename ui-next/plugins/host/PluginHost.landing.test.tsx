import { Link } from '@omniviewdev/kit';
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
  // What the person typed: the page's own state, which a change of the page's parameters must not take from it (KL7).
  const [typed, setTyped] = useState('');
  const said = (result: ConnectionVerbResultV1) => {
    setAnswer(result.ok ? 'done' : result.cancelled === true ? 'cancelled' : result.reason);
  };

  return (
    <section aria-label="Acme landing">
      <h1>Acme home</h1>
      <p>{`Filter: ${context.route.params.filter ?? 'all'}`}</p>
      <input
        aria-label="Search"
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />
      <button
        type="button"
        onClick={() => {
          context.setParams({ filter: 'attention' });
        }}
      >
        Set the filter
      </button>
      <button
        type="button"
        onClick={() => {
          context.setParams({ filter: 'connected' }, { history: 'push' });
        }}
      >
        Push the filter
      </button>
      <button
        type="button"
        onClick={() => {
          // Plugin code that is not typed as the contract asks: the host reads what it is given.
          context.setParams({ filter: 3 } as unknown as Readonly<Record<string, string>>);
        }}
      >
        Ask for a number
      </button>
      <Link to={{ page: 'landing', params: { filter: 'connected' } }}>Link to connected</Link>
      <Link to={{ page: 'all' }}>Link to all</Link>
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

/** A second page of the plugin that is read in no connection, with a state of its own. */
function All() {
  const [typed, setTyped] = useState('');
  return (
    <section aria-label="Acme all">
      <h1>Acme all</h1>
      <input
        aria-label="Search all"
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />
      <Link to={{ page: 'landing' }}>Link to the landing</Link>
    </section>
  );
}

/** A page of a connection (scope `connection`): it reads the connection and a parameter, and changes the parameter itself. */
function Settings({ context }: { readonly context: CustomPageContextV1 }) {
  const [typed, setTyped] = useState('');
  return (
    <section aria-label="Acme settings">
      <h1>Acme settings</h1>
      <p>{`Connection: ${context.route.connection ?? 'none'}`}</p>
      <p>{`Tab: ${context.route.params.tab ?? 'none'}`}</p>
      <input
        aria-label="Note"
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />
      <button
        type="button"
        onClick={() => {
          context.setParams({ tab: 'logs' });
        }}
      >
        Show the logs
      </button>
    </section>
  );
}

/** Acme, with a landing or without one: the same plugin otherwise. */
const entry = (landing: boolean, sidebar: ContributionV1['sidebar'] = acme().sidebar): PluginEntry => ({
  id: 'acme',
  name: 'Acme plugin',
  phase: 'ready',
  contribution: landing ? acme({ pages: { ...acme().pages, landing: { kind: 'custom', scope: 'plugin', title: 'Acme home', icon: 'house', Body: Landing }, all: { kind: 'custom', scope: 'plugin', title: 'Acme all', icon: 'server', Body: All }, settings: { kind: 'custom', scope: 'connection', title: 'Acme settings', icon: 'settings-2', Body: Settings } }, landing: 'landing', sidebar }) : acme(),
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

  it('opens the landing with the parameters of an entry, in the tab on screen, and selects that entry and no other: the page reads the parameters', async () => {
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

// A custom page changes its own parameters in place (KL7): `context.setParams`, a link, an entry of the sidebar, and Back and Forward all move the tab to the same page with other parameters, and the Body, with what it keeps in state, is the same one before and after.
describe('a custom page that changes its own parameters', () => {
  const navigated = () => entry(true, { ...acme().sidebar, useNodes: useNavigator });
  const tree = async () => within(await screen.findByRole('navigation', { name: 'Acme navigation' }));
  const search = () => screen.getByRole('textbox', { name: 'Search' });
  const back = () => screen.getByRole('button', { name: 'Back' });
  const forward = () => screen.getByRole('button', { name: 'Forward' });

  it('is given the new parameters by setParams while its Body stays, with what it keeps in state: the sidebar\'s current entry follows, and nothing is added to the tab\'s history', async () => {
    const { user } = mount(navigated(), { link: link(undefined) });
    await user.type(await screen.findByRole('textbox', { name: 'Search' }), 'abc');
    const field = search();

    await user.click(screen.getByRole('button', { name: 'Set the filter' }));

    expect(await screen.findByText('Filter: attention')).toBeInTheDocument();
    expect(search()).toBe(field);
    expect(field).toHaveValue('abc');
    expect((await tree()).getByRole('treeitem', { name: 'Needs attention 0' })).toHaveAttribute('aria-selected', 'true');
    expect(back()).toHaveAttribute('aria-disabled', 'true');
  });

  it('steps through the parameters it pushed with Back and Forward, in place: the Body is the one it started with at every step', async () => {
    const { user } = mount(navigated(), { link: link(undefined) });
    await user.type(await screen.findByRole('textbox', { name: 'Search' }), 'abc');
    const field = search();

    await user.click(screen.getByRole('button', { name: 'Push the filter' }));
    expect(await screen.findByText('Filter: connected')).toBeInTheDocument();
    expect(back()).not.toHaveAttribute('aria-disabled');
    await user.click(back());
    expect(await screen.findByText('Filter: all')).toBeInTheDocument();
    await user.click(forward());

    expect(await screen.findByText('Filter: connected')).toBeInTheDocument();
    expect(search()).toBe(field);
    expect(field).toHaveValue('abc');
  });

  it('keeps the Body when a link or an entry of the sidebar opens the same page with other parameters, as setParams does: the place is one tab, and the tab\'s Body is not drawn again', async () => {
    const { user } = mount(navigated(), { link: link(undefined) });
    await user.type(await screen.findByRole('textbox', { name: 'Search' }), 'abc');
    const field = search();

    await user.click(screen.getByRole('link', { name: 'Link to connected' }));
    expect(await screen.findByText('Filter: connected')).toBeInTheDocument();
    await user.click((await tree()).getByRole('treeitem', { name: 'Needs attention 0' }));

    expect(await screen.findByText('Filter: attention')).toBeInTheDocument();
    expect(search()).toBe(field);
    expect(field).toHaveValue('abc');
    expect(faces()).toEqual(['Acme home']);
  });

  it('is kept by tab and not by place: two tabs of one page with different parameters have a Body each, and a change in one leaves the other as it was', async () => {
    const { user } = mount(navigated(), { link: link(undefined) });
    await user.type(await screen.findByRole('textbox', { name: 'Search' }), 'abc');
    await user.click(screen.getByRole('button', { name: 'Set the filter' }));
    expect(await screen.findByText('Filter: attention')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New tab' }));
    expect(await screen.findByText('Filter: all')).toBeInTheDocument();
    expect(search()).toHaveValue('');
    await user.type(search(), 'xyz');
    await user.click(screen.getByRole('button', { name: 'Push the filter' }));
    expect(await screen.findByText('Filter: connected')).toBeInTheDocument();

    await user.click(screen.getAllByRole('tab')[0]);
    expect(await screen.findByText('Filter: attention')).toBeInTheDocument();
    expect(search()).toHaveValue('abc');
    await user.click(screen.getAllByRole('tab')[1]);
    expect(await screen.findByText('Filter: connected')).toBeInTheDocument();
    expect(search()).toHaveValue('xyz');
  });

  it('is drawn again from scratch when the tab goes to another page: the page it left has none of what it kept when the tab comes back to it', async () => {
    const { user } = mount(navigated(), { link: link(undefined) });
    await user.type(await screen.findByRole('textbox', { name: 'Search' }), 'abc');

    await user.click(screen.getByRole('link', { name: 'Link to all' }));
    expect(await screen.findByRole('heading', { name: 'Acme all' })).toBeInTheDocument();
    await user.click(back());

    expect(await screen.findByRole('heading', { name: 'Acme home' })).toBeInTheDocument();
    expect(search()).toHaveValue('');
  });

  it('ignores a call that holds anything but text, with one line in the console: the route stays as it was', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { user } = mount(navigated(), { session: saved(['l', 'acme', 'landing', 'Acme home', { filter: 'attention' }]) });
    await user.click(await screen.findByRole('button', { name: 'Ask for a number' }));

    expect(screen.getByText('Filter: attention')).toBeInTheDocument();
    expect(back()).toHaveAttribute('aria-disabled', 'true');
    expect(warn.mock.calls.filter(([line]) => typeof line === 'string' && line.startsWith('[plugins]'))).toEqual([['[plugins] acme page landing: setParams was ignored: the parameter "filter" is not text']]);
    warn.mockRestore();
  });

  it('does nothing for a call that names the parameters the page has: no entry is added to the tab\'s history, even for a push', async () => {
    const { user } = mount(navigated(), { session: saved(['l', 'acme', 'landing', 'Acme home', { filter: 'connected' }]) });
    await user.click(await screen.findByRole('button', { name: 'Push the filter' }));

    expect(screen.getByText('Filter: connected')).toBeInTheDocument();
    expect(back()).toHaveAttribute('aria-disabled', 'true');
  });

  it('keeps the connection a page of a connection is read in when it sets its own parameters, and its Body with them: a call never changes the scope', async () => {
    const { user } = mount(navigated(), { link: { plugin: 'acme', page: 'settings', connection: NORTH, params: {} } });
    await user.type(await screen.findByRole('textbox', { name: 'Note' }), 'abc');
    const field = screen.getByRole('textbox', { name: 'Note' });

    await user.click(screen.getByRole('button', { name: 'Show the logs' }));

    expect(await screen.findByText('Tab: logs')).toBeInTheDocument();
    expect(screen.getByText(`Connection: ${NORTH}`)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Note' })).toBe(field);
    expect(field).toHaveValue('abc');
  });
});

// The sidebar's hook is told the route's parameters (KL7): the navigator of a landing carries the ones the page keeps in its route (here `sort`) to the entries it opens, so the entry of the place on screen is the one that is selected. A group that says `expanded` starts open.
describe('the sidebar hook of a plugin on its landing, told the route\'s parameters', () => {
  const heard: SidebarContextV1[] = [];

  function useCarrying(context: SidebarContextV1): readonly SidebarNodeV1[] | undefined {
    heard.push(context);
    const { connections, route } = context;
    const view = useSyncExternalStore(connections.subscribe, connections.getSnapshot);
    const { sort } = route.params;
    return useMemo(
      () =>
        route.page === 'landing'
          ? [
            { id: 'landing', label: 'All', icon: 'layers' },
            { id: 'attention', label: 'Needs attention', icon: 'bell', page: 'landing', params: { filter: 'attention', ...(sort === undefined ? {} : { sort }) } },
            { id: 'connections', label: 'Connections', icon: 'server', expanded: true, children: view.connections.map((connection): SidebarNodeV1 => ({ id: `connection-${connection.key}`, label: connection.name, icon: 'server', connection: connection.key })) },
          ]
          : undefined,
      [route.page, sort, view],
    );
  }

  it('is given them as text, so that the entry that carries them is the one selected, and the group that says it starts open is open, with the hook told so', async () => {
    heard.length = 0;
    mount(entry(true, { ...acme().sidebar, useNodes: useCarrying }), { session: saved(['l', 'acme', 'landing', 'Acme home', { filter: 'attention', sort: 'state' }]) });
    const tree = within(await screen.findByRole('navigation', { name: 'Acme navigation' }));

    expect(await tree.findByRole('treeitem', { name: 'Needs attention' })).toHaveAttribute('aria-selected', 'true');
    expect(tree.getByRole('treeitem', { name: 'All' })).toHaveAttribute('aria-selected', 'false');
    expect(heard.at(-1)?.route).toEqual({ page: 'landing', connection: undefined, params: { filter: 'attention', sort: 'state' } });
    expect(await tree.findByRole('treeitem', { name: /^north/ })).toBeInTheDocument();
    expect(heard.at(-1)?.open).toEqual(['connections']);
  });
});

// What the sidebar is called on a page that is read in no connection (KL7): the plugin may say, and a member it leaves out is the sidebar's own.
describe('the words of a sidebar on a page read in no connection', () => {
  const scoped = (pluginScope: NonNullable<ContributionV1['sidebar']['pluginScope']>) => entry(true, { ...acme().sidebar, pluginScope, useNodes: useNavigator });

  it('are the plugin\'s own on the landing, for the heading and the landmark, and the sidebar\'s own on a page of a connection', async () => {
    const { user } = mount(scoped({ title: 'Connections', label: 'Acme connections' }), { link: link(undefined) });
    const landing = within(await screen.findByRole('navigation', { name: 'Acme connections' }));
    expect(landing.getByRole('heading', { level: 2, name: 'Connections' })).toBeInTheDocument();

    await user.click(await landing.findByRole('treeitem', { name: 'Connections' }));
    await user.click(landing.getByRole('treeitem', { name: /^north/ }));

    const own = within(await screen.findByRole('navigation', { name: 'Acme navigation' }));
    expect(own.getByRole('heading', { level: 2, name: 'Acme' })).toBeInTheDocument();
  });

  it('fall back to the sidebar\'s own for a member the plugin leaves out', async () => {
    mount(scoped({ title: 'Connections' }), { link: link(undefined) });

    const landing = within(await screen.findByRole('navigation', { name: 'Acme navigation' }));
    expect(landing.getByRole('heading', { level: 2, name: 'Connections' })).toBeInTheDocument();
  });
});
