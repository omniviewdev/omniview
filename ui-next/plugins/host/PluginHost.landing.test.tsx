import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore } from '../../shell';
import { openSession, SESSION_VERSION } from '../../shell/session';
import { memoryStorage } from '../../shell/session/testing';
import type { CustomPageContextV1 } from '../contract/v1';
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

// The plugin's landing through the host (KL2), against an invented plugin (Acme) that declares one: a custom page of scope `plugin` that lists the plugin's connections from `context.connections` and opens one. The host's connection API is a fake with two
// connections of Acme and a start that connects; the list can be held on its way, so that an open that waits for it is seen to wait.

const NORTH = 'north-1';
const SOUTH = 'south-2';

function fakeHost() {
  const readiness: Record<string, string> = { [NORTH]: 'DISCONNECTED', [SOUTH]: 'CONNECTED' };
  let gate: PromiseWithResolvers<void> | undefined;
  const record = (id: string, name: string): StateRecord => ({ connection: { id, name }, readiness: readiness[id] ?? 'DISCONNECTED' });
  const api: ConnectionsApi = {
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
  return (
    <section aria-label="Acme landing">
      <h1>Acme home</h1>
      <p role="status">{view.loaded ? `${String(view.connections.length)} connections` : 'Reading the connections…'}</p>
      {view.connections.map((connection) => (
        <button
          key={connection.key}
          type="button"
          onClick={() => {
            void connections.open(connection.key);
          }}
        >
          {`Open ${connection.name}`}
        </button>
      ))}
    </section>
  );
}

/** Acme, with a landing or without one: the same plugin otherwise. */
const entry = (landing: boolean): PluginEntry => ({
  id: 'acme',
  name: 'Acme plugin',
  phase: 'ready',
  contribution: landing ? acme({ pages: { ...acme().pages, landing: { kind: 'custom', scope: 'plugin', title: 'Acme home', icon: 'house', Body: Landing } }, landing: 'landing' }) : acme(),
});

const link = (page: string | undefined): HostRoute => ({ plugin: 'acme', page, connection: undefined, params: {} });

/** A saved window whose tabs are these, the last on screen: `[id, plugin, page, title]`. */
const saved = (...tabs: ReadonlyArray<readonly [string, string, string, string]>) =>
  openSession(
    memoryStorage().storage,
    JSON.stringify({
      version: SESSION_VERSION,
      tabs: {
        version: 1,
        active: tabs.at(-1)?.[0] ?? null,
        tabs: tabs.map(([id, plugin, page, title]) => ({
          id,
          route: { plugin, contribution: page, params: {} },
          key: `${plugin}:${page}`,
          face: { title, icon: 'box', path: [], facets: [], pluginName: plugin === 'host' ? '' : 'Acme plugin', singleton: false, identity: 'key' },
          pinned: false,
          preview: false,
          history: { entries: [{ plugin, contribution: page, params: {} }], index: 0 },
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

describe('a plugin that declares none', () => {
  it('is completed as it was: Home\'s row opens Home, where the window would choose', async () => {
    const { user } = mount(entry(false));

    await user.click(row(screen.getByRole('region', { name: 'Plugins you can open' })));

    expect(await screen.findByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(faces()).toEqual(['Home']);
  });
});
