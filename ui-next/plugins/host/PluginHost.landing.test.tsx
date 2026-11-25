import { Link, MenuHost, menuTrigger, useMenu } from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore } from '../../shell';
import { openSession, SESSION_VERSION } from '../../shell/session';
import { memoryStorage } from '../../shell/session/testing';
import type { CustomPageContextV1, CustomPageV1 } from '../contract/v1';
import { acme } from '../testing';
import type { ConnectionsApi, StateRecord } from './connections/api';
import { PluginHost, type PluginHostProps } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import type { PortForwardNetwork } from './portForward';
import { NO_ROUTE, type HostRoute } from './route';

Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

// The plugin's landing through the host (KL2), against an invented plugin (Acme) that declares one: a custom page of scope `plugin` that the plugin draws itself from the kit, and a way to open a connection from it. What is under test is what the host does
// with a `custom` contribution and a `landing`: where every connection-less open of the plugin goes (Home's row, the rail, `+`, a link), what the Body is told (its context and the plugin's connections), what the frame draws around it (no lane, no sidebar, the plugin's rail entry
// current), what opening a connection from it does, and that a saved window brings its tab back. The host's connection API is a fake with one table of what the host says.

const NORTH = 'north-1';
const SOUTH = 'south-2';

type Answer = Readonly<Record<string, readonly StateRecord[]>>;

/** What the host says, and the order it says it in: the connections of Acme and of another plugin, a start that connects, and a read the test can hold. */
function fakeHost(over: { readonly acme?: readonly string[] } = {}) {
  const readiness: Record<string, string> = { [NORTH]: 'DISCONNECTED', [SOUTH]: 'CONNECTED', 'east-9': 'CONNECTED' };
  const heard = new Set<() => void>();
  let gate: PromiseWithResolvers<void> | undefined;
  const record = (id: string, name: string, description?: string): StateRecord => ({ connection: { id, name, description }, readiness: readiness[id] ?? 'DISCONNECTED' });
  const answer = (): Answer => {
    const own = [record(NORTH, 'north', 'Acme · region one'), record(SOUTH, 'south')].filter((entry) => over.acme === undefined || over.acme.includes(entry.connection.id));
    return { acme: own, other: [record('east-9', 'east')] };
  };

  const api: ConnectionsApi = {
    states: vi.fn(async () => {
      await gate?.promise;
      return answer();
    }),
    start: vi.fn(async (_plugin: string, key: string) => {
      readiness[key] = 'CONNECTED';
      return Promise.resolve({ status: 'CONNECTED' });
    }),
    onStatus: (listener) => {
      heard.add(listener);
      return () => {
        heard.delete(listener);
      };
    },
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
    say: () => {
      for (const listener of [...heard]) {
        listener();
      }
    },
  };
}

/** The contexts the Body was drawn with, in order. */
let seen: CustomPageContextV1[] = [];

function Landing({ context }: { readonly context: CustomPageContextV1 }) {
  seen.push(context);
  const { connections } = context;
  const view = useSyncExternalStore(connections.subscribe, connections.getSnapshot);
  const menu = useMenu((key) =>
    key === undefined
      ? undefined
      : [
        {
          kind: 'action',
          id: 'open',
          label: 'Open',
          onSelect: () => {
            void connections.open(key);
          },
        },
        {
          kind: 'action',
          id: 'open-new',
          label: 'Open in new tab',
          onSelect: () => {
            void connections.open(key, { newTab: true });
          },
        },
      ],
  );
  return (
    <section aria-label="Acme landing">
      <h1>Acme home</h1>
      <p role="status">{view.loaded ? (view.failed ? 'The connections could not be read.' : `${String(view.connections.length)} connections`) : 'Reading the connections…'}</p>
      <ul aria-label="Connections">
        {view.connections.map((connection) => (
          <li key={connection.key}>
            <button
              type="button"
              aria-label={`Open ${connection.name}`}
              {...menuTrigger(menu, connection.key, 'context')}
              data-ov-menu-label={`${connection.name} actions`}
              onClick={() => {
                void connections.open(connection.key);
              }}
            >
              {`${connection.name}, ${connection.word}${connection.description === undefined ? '' : `, ${connection.description}`}`}
            </button>
            <button
              type="button"
              aria-label={`Open ${connection.name} in a new tab`}
              onClick={() => {
                void connections.open(connection.key, { newTab: true });
              }}
            >
              New tab
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          void connections.refresh();
        }}
      >
        Refresh connections
      </button>
      <Link to={{ page: 'all' }}>All connections</Link>
    </section>
  );
}

const Elsewhere = ({ context }: { readonly context: CustomPageContextV1 }) => {
  seen.push(context);
  return <h1>All connections page</h1>;
};

const Settings = ({ context }: { readonly context: CustomPageContextV1 }) => {
  seen.push(context);
  return <h1 data-connection={context.route.connection}>Settings page</h1>;
};

const Boom = (): never => {
  throw new Error('SECRET the Body of the plugin');
};

const custom = (patch: Partial<CustomPageV1>): CustomPageV1 => ({ kind: 'custom', scope: 'plugin', title: 'Acme home', icon: 'house', Body: Landing, ...patch });

/** A plugin that declares a landing, beside the list pages Acme has. */
const withLanding = (): PluginEntry => {
  const base = acme();
  return {
    id: 'acme',
    name: 'Acme plugin',
    phase: 'ready',
    contribution: acme({
      pages: {
        ...base.pages,
        landing: custom({}),
        all: custom({ title: 'All', Body: Elsewhere }),
        settings: custom({ scope: 'connection', title: 'Settings', Body: Settings }),
        boom: custom({ title: 'Boom', Body: Boom }),
      },
      landing: 'landing',
    }),
  };
};

const withoutLanding = (): PluginEntry => ({ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() });

const link = (page: string | undefined, connection?: string): HostRoute => ({ plugin: 'acme', page, connection, params: {} });

const face = (title: string, pluginName = 'Acme plugin') => ({ title, icon: 'box', path: [pluginName, title], facets: [], pluginName, singleton: false, identity: 'key' });
const savedTab = (id: string, plugin: string, page: string, title: string) => ({
  id,
  route: { plugin, contribution: page, params: {} },
  key: `${plugin}:${page}`,
  face: face(title),
  pinned: false,
  preview: false,
  history: { entries: [{ plugin, contribution: page, params: {} }], index: 0 },
});
const savedWindow = (tabs: readonly unknown[], active: string | null) => JSON.stringify({ version: SESSION_VERSION, tabs: { version: 1, active, tabs }, rail: null, panel: { version: 1 } });

function mount(entry: PluginEntry = withLanding(), over: Partial<PluginHostProps> = {}, host = fakeHost()) {
  const entries: readonly PluginEntry[] = [entry];
  const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };
  const props: PluginHostProps = { plugins, inventory: 'ready', link: NO_ROUTE, onRetry: vi.fn(), onRetryInventory: vi.fn(), panel: createPanelStore(), connections: host.api, ...over };
  const view = render(
    <MenuHost>
      <PluginHost {...props} />
    </MenuHost>,
  );
  return { ...view, host, user: userEvent.setup() };
}

const faces = (): Array<string | null> => screen.queryAllByRole('tab').map((tab) => tab.textContent);
const home = () => screen.getByRole('region', { name: 'Plugins you can open' });
const rail = () => within(screen.getByRole('group', { name: 'Plugins' }));
const landingStatus = () => within(screen.getByRole('region', { name: 'Acme landing' })).getByRole('status');
const rightClick = (element: Element) => fireEvent.contextMenu(element, { button: 2, clientX: 30, clientY: 40 });

// jsdom has no Popover API: the setup's stand-in marks an element and nothing shows it, and a popover is `display: none` until a rule says otherwise, which makes it inaccessible to the queries (Home's menu tests do the same).
let shown: HTMLStyleElement;

beforeEach(() => {
  seen = [];
  shown = document.createElement('style');
  shown.textContent = '[popover] { display: block !important; }';
  document.head.append(shown);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  shown.remove();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('opening a plugin that declares a landing', () => {
  it('opens the landing from the empty window\'s row for the plugin, with two connections and none used, where the window would have opened Home, and without waiting for the list of connections', async () => {
    const host = fakeHost();
    host.hold();
    const { user } = mount(withLanding(), {}, host);

    await user.click(within(home()).getByRole('button', { name: /Acme/ }));

    // The list has not come back, and the landing is open and says so: nothing waited for it.
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme home' })).toBeInTheDocument();
    expect(faces()).toEqual(['Acme home']);
    expect(landingStatus()).toHaveTextContent('Reading the connections…');

    host.release();
    expect(await screen.findByRole('list', { name: 'Connections' })).toBeInTheDocument();
    expect(landingStatus()).toHaveTextContent('2 connections');
  });

  it('opens the landing from the row of a Home tab, which announces no choosing of a connection, and from the plugin\'s entry in the rail while Home is on screen', async () => {
    const session = openSession(memoryStorage().storage, savedWindow([{ ...savedTab('h', 'host', 'home', 'Home'), face: { ...face('Home', ''), path: [] } }], 'h'));
    const { user } = mount(withLanding(), { session });
    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();

    await user.click(within(home()).getByRole('button', { name: /Acme/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme home' })).toBeInTheDocument();
    expect(faces()).toEqual(['Home', 'Acme home']);
    expect(screen.queryByText(/Choose one of the connections/)).toBeNull();

    // Smart open shows the tab that already shows the landing: the rail opened it, and the tab on screen is the landing's.
    await user.click(screen.getByRole('tab', { name: 'Home' }));
    await user.click(rail().getByRole('button', { name: 'Acme' }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Acme home' })).toHaveAttribute('aria-selected', 'true');
    });
    expect(faces()).toEqual(['Home', 'Acme home']);
  });

  it('opens the same plugin on Home when it declares no landing: a plugin with none is completed as it was', async () => {
    const { user } = mount(withoutLanding());

    await user.click(within(home()).getByRole('button', { name: /Acme/ }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(faces()).toEqual(['Home']);
  });

  it('opens a new tab at the landing with +, from the landing and from a page of a connection, and a link that names no page and no connection opens it without waiting for the list', async () => {
    const host = fakeHost();
    host.hold();
    const { user } = mount(withLanding(), { link: link(undefined) }, host);
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme home' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New tab' }));
    expect(faces()).toEqual(['Acme home', 'Acme home']);
    host.release();
  });

  it('opens the landing with + from a page of a connection: the new tab is not another page of that connection', async () => {
    const { user } = mount(withLanding(), { link: link('widgets', NORTH) });
    expect(await screen.findByText('alpha')).toBeInTheDocument();
    expect(faces()).toEqual(['Widgets']);

    await user.click(screen.getByRole('button', { name: 'New tab' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Acme home' })).toBeInTheDocument();
    expect(faces()).toEqual(['Widgets', 'Acme home']);
  });
});

describe('the frame of a page read in no connection', () => {
  it('has no scope lane and no sidebar, and the plugin\'s entry in the rail is the current one; a page of a connection of the same plugin has both back', async () => {
    const { user } = mount(withLanding(), { link: link(undefined) });
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme home' })).toBeInTheDocument();

    expect(screen.queryByRole('group', { name: 'Acme scope' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Acme navigation' })).toBeNull();
    expect(rail().getByRole('button', { name: 'Acme' })).toHaveAttribute('aria-current', 'true');
    expect(document.querySelector('[data-page-slot]')).toHaveAttribute('data-layout', 'document');
    // The tab says the page and the plugin, and no connection.
    expect(screen.getByRole('tab', { name: 'Acme home' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation', { name: 'Current resource' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Acme', 'Acme home']);

    await user.click(within(await screen.findByRole('list', { name: 'Connections' })).getByRole('button', { name: 'Open south' }));
    expect(await screen.findByRole('navigation', { name: 'Acme navigation' })).toBeInTheDocument();
  });

  it('is told its context: the plugin, the page and no connection and no parameters, the panel handle, and the plugin\'s connections, the same handle each time', async () => {
    mount(withLanding(), { link: link(undefined) });
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme home' })).toBeInTheDocument();
    await screen.findByRole('list', { name: 'Connections' });

    expect(seen.length).toBeGreaterThan(0);
    for (const context of seen) {
      expect(context.plugin).toBe('acme');
      expect(context.route).toEqual({ page: 'landing', connection: undefined, params: {} });
      expect(context.panel?.logs.open).toBeTypeOf('function');
    }

    expect(new Set(seen.map((context) => context.connections)).size).toBe(1);
  });

  it('is given no ports handle, though the plugin has one connection and a page of that connection is: the plugin\'s only connection is not the one a page read in none is read in', async () => {
    const networker: PortForwardNetwork = { start: async () => Promise.resolve(null), stop: async () => Promise.resolve(undefined), onClosed: () => () => undefined };
    mount(withLanding(), { link: link(undefined), networker }, fakeHost({ acme: [NORTH] }));
    await screen.findByRole('heading', { level: 1, name: 'Acme home' });
    await screen.findByRole('list', { name: 'Connections' });

    expect(seen.at(-1)?.panel).toBeDefined();
    expect(seen.at(-1)?.panel?.ports).toBeUndefined();
  });

  it('contains a Body that throws: the page says it failed with a Retry and the words are the host\'s, and the landing beside it stays', async () => {
    const { user } = mount(withLanding(), { link: link('boom') });

    expect(await screen.findByText('This page failed to display.')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('SECRET');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Boom' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme home' })).toBeInTheDocument();
  });
});

describe('what a landing does with the plugin\'s connections', () => {
  it('lists the plugin\'s connections with the host\'s words and no other plugin\'s, and follows what the host says: a connection that changed is said again', async () => {
    const { host } = mount(withLanding(), { link: link(undefined) });
    const list = await screen.findByRole('list', { name: 'Connections' });

    expect(within(list).getAllByRole('button').filter((button) => /^Open \w+$/.test(button.getAttribute('aria-label') ?? '')).map((button) => button.textContent)).toEqual([
      'north, Disconnected, Acme · region one',
      'south, Connected',
    ]);
    expect(within(list).queryByText(/east/)).toBeNull();

    vi.mocked(host.api.states).mockImplementation(async () => Promise.resolve({ acme: [{ connection: { id: NORTH, name: 'north' }, readiness: 'CONNECTED' }, { connection: { id: SOUTH, name: 'south' }, readiness: 'FAILED' }] }));
    act(() => {
      host.say();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open north' })).toHaveTextContent('north, Connected');
    });
    expect(screen.getByRole('button', { name: 'Open south' })).toHaveTextContent('south, Connection failed');
  });

  it('opens a connection as Home\'s row does: the host starts it first, then the plugin\'s home opens in it in a tab of its own, and the landing stays where it was', async () => {
    const { user, host } = mount(withLanding(), { link: link(undefined) });
    await user.click(await screen.findByRole('button', { name: 'Open north' }));

    await waitFor(() => {
      expect(faces()).toEqual(['Acme home', 'Widgets']);
    });
    expect(host.api.start).toHaveBeenCalledExactlyOnceWith('acme', NORTH);
    expect(screen.getByRole('tab', { name: /Widgets/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens a connection in a new tab, from a button and from the menu a Body registers with the kit\'s useMenu, and starts a connection that is already connected no more than once', async () => {
    const { user, host } = mount(withLanding(), { link: link(undefined) });
    await user.click(await screen.findByRole('button', { name: 'Open south in a new tab' }));
    await waitFor(() => {
      expect(faces()).toEqual(['Acme home', 'Widgets']);
    });

    await user.click(screen.getByRole('tab', { name: 'Acme home' }));
    rightClick(await screen.findByRole('button', { name: 'Open south' }));
    expect(screen.getByRole('menu', { name: 'south actions' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Open in new tab' }));

    await waitFor(() => {
      expect(faces()).toEqual(['Acme home', 'Widgets', 'Widgets']);
    });
    expect(host.api.start).not.toHaveBeenCalled();
  });

  it('reads the connections again when asked', async () => {
    const { user, host } = mount(withLanding(), { link: link(undefined) });
    await screen.findByRole('list', { name: 'Connections' });
    expect(host.api.states).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Refresh connections' }));

    await waitFor(() => {
      expect(host.api.states).toHaveBeenCalledTimes(2);
    });
  });

  it('goes to another page of its own that is read in no connection with the kit\'s Link, in the same tab, and keeps no connection', async () => {
    const { user } = mount(withLanding(), { link: link(undefined) });
    await user.click(await screen.findByRole('link', { name: 'All connections' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'All connections page' })).toBeInTheDocument();
    expect(faces()).toEqual(['All']);
    expect(seen.at(-1)?.route).toEqual({ page: 'all', connection: undefined, params: {} });
    expect(screen.queryByRole('link', { name: 'All connections' })).toBeNull();
  });
});

describe('a custom page that is read in a connection', () => {
  it('is a page of the connection as the others are: its route names it, the tab and the lane say it by its name, and the panel handle is that connection\'s', async () => {
    const networker: PortForwardNetwork = { start: async () => Promise.resolve(null), stop: async () => Promise.resolve(undefined), onClosed: () => () => undefined };
    mount(withLanding(), { link: link('settings', NORTH), networker });

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings page' })).toHaveAttribute('data-connection', NORTH);
    expect(seen.at(-1)?.route).toEqual({ page: 'settings', connection: NORTH, params: {} });
    expect(seen.at(-1)?.panel?.ports?.forward).toBeTypeOf('function');
    // The name comes from the window's list, not from the page: the page publishes no lane of its own, and the key is drawn nowhere.
    const lane = await screen.findByRole('group', { name: 'Acme scope' });
    expect(within(lane).getByRole('button', { name: 'Connection: north' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Settings/ })).toHaveAccessibleName('Settings, north');
    expect(document.body.textContent).not.toContain(NORTH);
  });

  it('is the landing when it is opened with no connection named: the plugin chooses nothing for the person, whichever page the route names', async () => {
    const { user } = mount(withLanding(), { link: link('settings') });
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme home' })).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Open south' }));
    await waitFor(() => {
      expect(faces()).toEqual(['Acme home', 'Widgets']);
    });
  });
});

describe('a saved window with a landing', () => {
  it('writes the landing as a tab of its own, with its route and no connection, and brings it back drawn when its plugin has loaded', async () => {
    const memory = memoryStorage();
    const session = openSession(memory.storage, undefined);
    const first = mount(withLanding(), { link: link(undefined), session });
    await screen.findByRole('heading', { level: 1, name: 'Acme home' });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await waitFor(() => {
      expect(memory.writes.length).toBeGreaterThan(0);
    });
    const saved = JSON.parse(memory.writes.at(-1) ?? 'null') as { readonly tabs: { readonly tabs: ReadonlyArray<{ readonly route: unknown; readonly face: { readonly title: string; readonly scope?: unknown } }> } };
    expect(saved.tabs.tabs.map((tab) => tab.route)).toEqual([{ plugin: 'acme', contribution: 'landing', params: {} }]);
    expect(saved.tabs.tabs[0]?.face).toMatchObject({ title: 'Acme home' });
    expect(saved.tabs.tabs[0]?.face.scope).toBeUndefined();
    first.unmount();
    cleanup();

    const restored = openSession(memoryStorage(memory.text()).storage, memory.text());
    mount(withLanding(), { session: restored });
    expect(faces()).toEqual(['Acme home']);
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme home' })).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Connections' })).toBeInTheDocument();
  });

  it('draws a restored landing from the face it was saved with until the plugin registers, and then draws the page', () => {
    const session = openSession(memoryStorage().storage, savedWindow([savedTab('l', 'acme', 'landing', 'Acme home')], 'l'));
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
    render(
      <MenuHost>
        <PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={vi.fn()} onRetryInventory={vi.fn()} panel={createPanelStore()} connections={fakeHost().api} session={session} />
      </MenuHost>,
    );
    expect(faces()).toEqual(['Acme home']);
    expect(screen.queryByRole('heading', { level: 1, name: 'Acme home' })).toBeNull();

    act(() => {
      entries = [withLanding()];
      for (const listener of [...listeners]) {
        listener();
      }
    });

    expect(screen.getByRole('heading', { level: 1, name: 'Acme home' })).toBeInTheDocument();
    expect(faces()).toEqual(['Acme home']);
  });
});
