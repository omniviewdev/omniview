import { MenuHost } from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { HostConnection } from './connections';
import { homePage } from './homePage';
import { connection, connectionStore, hostConnections, pluginSource, readyEntry, type FakeHost, type FakePlugins } from './homeTesting';
import { NoTabs } from './NoTabs';

// Home as the window makes it (homePage.tsx): what it reads of the plugins and the connections, what a choice does, the menu of a row, the Retry, and what it tells a person who cannot see it. The tab's page and the empty window are one
// component (decision A17), so each thing here is held in both. What a page draws of the rows it is given is `Home.test.tsx`; what the rows are made of is `homeModel.test.ts`.

const acme = readyEntry('acme', 'Acme', { order: 1, icon: 'layers', accent: 'green' });
const beta = readyEntry('beta', 'Beta', { order: 2, icon: 'box' });

const STARTING = [
  connection('acme', 'a1', 'staging', 'connected', { detail: 'managed · north-1' }),
  connection('acme', 'a2', 'production'),
  connection('beta', 'b1', 'sandbox', 'disconnected'),
];

type Surface = 'tab' | 'window';
type Mounted = {
  readonly plugins: FakePlugins;
  readonly host: FakeHost;
  readonly openPlugin: Mock<(plugin: string, event: unknown) => void>;
};

/** What the window knows: `connections: null` is a window with no connection API; `menu: false` mounts no menu host. */
type Options = { readonly connections?: readonly HostConnection[] | null; readonly loaded?: boolean; readonly failed?: boolean; readonly menu?: boolean };

/** Home in the surface, over fake stores. */
function mount(surface: Surface, options: Options = {}): Mounted {
  const plugins = pluginSource([acme, beta]);
  const host = hostConnections(connectionStore(options.connections ?? STARTING, { loaded: options.loaded ?? true, failed: options.failed ?? false }));
  const openPlugin = vi.fn<(plugin: string, event: unknown) => void>();
  const connections = options.connections === null ? undefined : host;
  const { Page } = homePage;
  const content =
    surface === 'tab' ? (
      <Page tabs={undefined as never} tabId="tab-1" plugins={plugins} onRetry={vi.fn()} openPlugin={openPlugin} connections={connections} />
    ) : (
      <NoTabs
        plugins={plugins}
        connections={connections}
        onOpen={(id) => {
          openPlugin(id, undefined);
        }}
      />
    );
  render(options.menu === false ? content : <MenuHost>{content}</MenuHost>);
  return { plugins, host, openPlugin };
}

const connections = () => screen.getByRole('region', { name: 'Connections' });
const recent = () => screen.getByRole('region', { name: 'Recent' });
const rowsOf = (region: HTMLElement): HTMLElement[] => [...region.querySelectorAll<HTMLElement>('[data-home-part="connection"]')];
const nameOf = (row: HTMLElement): string | null | undefined => row.querySelector('[data-ov-clip]')?.textContent;
/** The row of the connection called `name`, in `region` (the whole page by default): by its name, so that a test of what a row does does not depend on what else the row says. */
const row = (name: string, region: HTMLElement = document.body): HTMLElement => {
  const found = rowsOf(region).find((each) => nameOf(each) === name);
  if (found === undefined) {
    throw new Error(`no row is called ${name}`);
  }

  return found;
};

const announced = (): string => document.querySelector('[data-home-part="announcement"]')?.textContent ?? '';
const menu = (name: string) => screen.queryByRole('menu', { name });
const item = (name: string) => screen.getByRole('menuitem', { name });
const focus = (element: HTMLElement) => {
  act(() => {
    element.focus();
  });
};

const rightClick = (element: Element) => fireEvent.contextMenu(element, { button: 2, clientX: 30, clientY: 40 });

let shown: HTMLStyleElement;

beforeEach(() => {
  // jsdom has no Popover API: the setup's stand-in marks an element and nothing shows it, and a popover is `display: none` until a rule says otherwise, which makes it inaccessible to the queries (the terminal's menu tests do the same).
  shown = document.createElement('style');
  shown.textContent = '[popover] { display: block !important; }';
  document.head.append(shown);
});

afterEach(() => {
  cleanup();
  shown.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('one component for the tab and for the empty window', () => {
  const column = (name: string): string => (document.querySelector(`[data-home-part="${name}"]`)?.outerHTML ?? '').replace(/ data-ov-menu="[^"]*"/g, '');
  /** What the two columns of the page hold. The ids that the menu's hook makes for each mounted component are left out: they say nothing of what is drawn. */
  const drawn = (): string[] => [column('main'), column('side')];

  it('draws the same two columns in both, whatever the connections, Recent and the Retry hold', () => {
    const drawnWith = (surface: Surface, state: Options): string[] => {
      const { host } = mount(surface, { ...state, menu: false });
      act(() => {
        host.recents.touch('beta', 'b1');
      });
      const columns = drawn();
      cleanup();
      return columns;
    };

    for (const state of [{}, { failed: true }, { loaded: false, connections: [] }, { connections: null }] as const) {
      const tab = drawnWith('tab', state);
      expect(tab[0], 'the plugins').toContain('Plugins you can open');
      expect(drawnWith('window', state)).toEqual(tab);
    }
  });

  it('says that no tab is open in the window, and not in the tab', () => {
    mount('window', { menu: false });
    expect(screen.getByText('No tabs are open.')).toBeInTheDocument();
    cleanup();

    mount('tab', { menu: false });
    expect(screen.queryByText('No tabs are open.')).toBeNull();
  });
});

describe.each<Surface>(['tab', 'window'])('Home in the %s', (surface) => {
  it('lists the connections of every plugin that contributes, by name, with the plugin\'s own text under it and the state each is in, and follows the store', () => {
    const { host } = mount(surface);

    expect(rowsOf(connections()).map((each) => each.textContent)).toEqual(['staging managed · north-1 Connected', 'production Connected', 'sandbox Disconnected']);
    expect(rowsOf(connections()).map((each) => each.getAttribute('data-home-plugin'))).toEqual(['acme', 'acme', 'beta']);

    act(() => {
      host.store.set({ connections: [...STARTING.slice(0, 1), connection('acme', 'a2', 'production', 'unauthorized', { reason: 'The connection needs you to sign in.' }), ...STARTING.slice(2)] });
    });

    expect(rowsOf(connections()).map((each) => each.textContent)).toEqual(['staging managed · north-1 Connected', 'production The connection needs you to sign in. Needs sign-in', 'sandbox Disconnected']);
  });

  it('lists a plugin that arrives later with its connections, where the rail puts it', () => {
    const { plugins } = mount(surface, { connections: [...STARTING, connection('gamma', 'g1', 'elsewhere')] });
    expect(rowsOf(connections()).map(nameOf)).toEqual(['staging', 'production', 'sandbox']);

    act(() => {
      plugins.set([acme, readyEntry('gamma', 'Gamma', { order: 1.5 }), beta]);
    });

    expect(rowsOf(connections()).map(nameOf)).toEqual(['staging', 'production', 'elsewhere', 'sandbox']);
  });

  it('draws no connections for a window that has no connection API, and says nothing of them', () => {
    mount(surface, { connections: null, menu: false });

    expect(screen.getByRole('region', { name: 'Plugins you can open' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Connections' })).toBeNull();
    expect(screen.queryByText('Reading connections…')).toBeNull();
  });

  it('opens a connection through the window\'s actions: its plugin, its key, from Home, and the disposition the click chose', () => {
    const { host } = mount(surface);

    fireEvent.click(row('staging'));
    expect(host.go).toHaveBeenLastCalledWith('acme', 'a1', { how: 'smart', source: 'home' });
    fireEvent.click(row('production'), { ctrlKey: true });
    expect(host.go).toHaveBeenLastCalledWith('acme', 'a2', { how: 'background', source: 'home' });
    fireEvent.click(row('sandbox'), { ctrlKey: true, shiftKey: true });
    expect(host.go).toHaveBeenLastCalledWith('beta', 'b1', { how: 'new', source: 'home' });
    fireEvent.click(row('sandbox'), { shiftKey: true });
    expect(host.go).toHaveBeenLastCalledWith('beta', 'b1', { how: 'window', source: 'home' });
    expect(host.go).toHaveBeenCalledTimes(4);
  });

  it('opens nothing, and starts nothing, for a connection that is connecting: its row says so and a press on it does nothing', () => {
    const { host } = mount(surface, { connections: [connection('acme', 'a1', 'staging', 'connecting'), connection('acme', 'a2', 'production')] });

    fireEvent.click(row('staging'));

    expect(host.go).not.toHaveBeenCalled();
    expect(row('staging')).toHaveAttribute('aria-busy', 'true');
  });

  it('opens a plugin through the window', () => {
    const { openPlugin } = mount(surface);

    fireEvent.click(within(screen.getByRole('region', { name: 'Plugins you can open' })).getByRole('button', { name: 'Beta' }));

    expect(openPlugin).toHaveBeenCalledTimes(1);
    expect(openPlugin.mock.calls[0]?.[0]).toBe('beta');
  });

  describe('Recent', () => {
    it('lists the connections the window used last, most recent first, above the others and not among them, and follows the window\'s uses', () => {
      const { host } = mount(surface);
      expect(screen.queryByRole('region', { name: 'Recent' })).toBeNull();

      act(() => {
        host.recents.touch('acme', 'a2');
      });
      expect(rowsOf(recent()).map(nameOf)).toEqual(['production']);
      expect(rowsOf(connections()).map(nameOf)).toEqual(['staging', 'sandbox']);

      act(() => {
        host.recents.touch('beta', 'b1');
      });
      expect(rowsOf(recent()).map(nameOf)).toEqual(['sandbox', 'production']);
      expect(rowsOf(connections()).map(nameOf)).toEqual(['staging']);
      // The plugin's name stands over the list as before: the person has the connections of two plugins, whatever Recent took.
      expect(within(connections()).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Acme']);
    });

    it('skips a use of a connection that is not listed any more, and shows it again when it is', () => {
      const { host } = mount(surface);

      act(() => {
        host.recents.touch('acme', 'gone');
      });
      expect(screen.queryByRole('region', { name: 'Recent' })).toBeNull();
      expect(rowsOf(connections())).toHaveLength(3);

      act(() => {
        host.store.set({ connections: [...STARTING, connection('acme', 'gone', 'returned')] });
      });
      expect(rowsOf(recent()).map(nameOf)).toEqual(['returned']);
    });

    it('shows five connections at the most', () => {
      const six = Array.from({ length: 6 }, (_, at) => connection('acme', `k${String(at)}`, `connection ${String(at)}`));
      const { host } = mount(surface, { connections: six });

      act(() => {
        for (const each of six) {
          host.recents.touch('acme', each.key);
        }
      });

      expect(rowsOf(recent()).map(nameOf)).toEqual(['connection 5', 'connection 4', 'connection 3', 'connection 2', 'connection 1']);
      expect(rowsOf(connections()).map(nameOf)).toEqual(['connection 0']);
    });
  });

  describe('a store that could not be read', () => {
    it('says so, with a Retry that reads the connections again', () => {
      const { host } = mount(surface, { connections: [], failed: true });

      expect(within(connections()).getByText('Connections could not be read.')).toBeInTheDocument();
      fireEvent.click(within(connections()).getByRole('button', { name: 'Retry' }));

      expect(host.store.refresh).toHaveBeenCalledTimes(1);
    });

    it('says that it is reading them until the first read has come back, and then lists them', () => {
      const { host } = mount(surface, { connections: [], loaded: false });
      expect(within(connections()).getByText('Reading connections…')).toBeInTheDocument();
      expect(connections()).toHaveAttribute('aria-busy', 'true');

      act(() => {
        host.store.set({ loaded: true, connections: STARTING });
      });

      expect(screen.queryByText('Reading connections…')).toBeNull();
      expect(rowsOf(connections())).toHaveLength(3);
    });
  });

  describe('the menu of a row', () => {
    it('opens on a right click, with Open, Open in new tab and Copy name, named after the connection', () => {
      mount(surface);

      rightClick(row('staging'));

      expect(menu('staging actions')).toBeInTheDocument();
      expect(screen.getAllByRole('menuitem').map((each) => each.getAttribute('aria-label'))).toEqual(['Open', 'Open in new tab', 'Copy name']);
    });

    it('opens on the Menu key and on Shift+F10 with the focus on the row, and gives the focus back to the row when it closes', () => {
      mount(surface);
      const staging = row('staging');
      focus(staging);

      fireEvent.keyDown(staging, { key: 'ContextMenu' });
      expect(menu('staging actions')).toBeInTheDocument();
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(staging).toHaveFocus();

      fireEvent.keyDown(staging, { key: 'F10', shiftKey: true });
      expect(menu('staging actions')).toBeInTheDocument();
    });

    it('opens on a row of Recent as on any other', () => {
      const { host } = mount(surface);
      act(() => {
        host.recents.touch('beta', 'b1');
      });

      rightClick(row('sandbox', recent()));

      expect(menu('sandbox actions')).toBeInTheDocument();
    });

    it('Open opens the connection the menu is of, as a press on the row does, and closes the menu', () => {
      const { host } = mount(surface);
      rightClick(row('production'));

      fireEvent.click(item('Open'));

      expect(host.go).toHaveBeenCalledExactlyOnceWith('acme', 'a2', { how: 'smart', source: 'home' });
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('Open in new tab opens it in a tab of its own', () => {
      const { host } = mount(surface);
      rightClick(row('sandbox'));

      fireEvent.click(item('Open in new tab'));

      expect(host.go).toHaveBeenCalledExactlyOnceWith('beta', 'b1', { how: 'new', source: 'home' });
    });

    it('is of the record that was pointed at, not of the row\'s place: two plugins that use one key are two connections', () => {
      const { host } = mount(surface, { connections: [connection('acme', 'same', 'north'), connection('beta', 'same', 'north')] });
      const [, second] = rowsOf(connections());
      rightClick(second);

      fireEvent.click(item('Open'));

      expect(host.go).toHaveBeenCalledExactlyOnceWith('beta', 'same', { how: 'smart', source: 'home' });
    });

    it('Copy name puts the name on the clipboard and says Copied <name> politely, and says it again when it is told again', async () => {
      const writeText = vi.fn(async (_text: string) => Promise.resolve());
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      mount(surface);
      expect(announced()).toBe('');

      rightClick(row('staging'));
      await act(async () => {
        fireEvent.click(item('Copy name'));
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledExactlyOnceWith('staging');
      expect(announced()).toBe('Copied staging');
      const live = document.querySelector('[data-home-part="announcement"]');
      expect(live).toHaveAttribute('aria-live', 'polite');
      const first = live?.firstElementChild;

      rightClick(row('staging'));
      await act(async () => {
        fireEvent.click(item('Copy name'));
        await Promise.resolve();
      });
      expect(announced()).toBe('Copied staging');
      expect(live?.firstElementChild).not.toBe(first);
    });

    it('does not say Copied when the clipboard refused: it says it could not copy', async () => {
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) } });
      mount(surface);

      rightClick(row('staging'));
      await act(async () => {
        fireEvent.click(item('Copy name'));
        await Promise.resolve();
      });

      expect(announced()).toBe('Couldn\'t copy the name. The clipboard isn\'t available here.');
    });

    it('refuses Open and Open in new tab on a connection that is connecting, with the reason on the items, and still copies the name', () => {
      const { host } = mount(surface, { connections: [connection('acme', 'a1', 'staging', 'connecting'), connection('acme', 'a2', 'production')] });
      rightClick(row('staging'));

      for (const name of ['Open', 'Open in new tab']) {
        expect(item(name)).toHaveAttribute('aria-disabled', 'true');
        expect(item(name)).toHaveAttribute('data-ov-tip', 'This connection is still connecting. Open it when it has connected.');
        fireEvent.click(item(name));
      }

      expect(host.go).not.toHaveBeenCalled();
      expect(item('Copy name')).not.toHaveAttribute('aria-disabled');
    });

    it('offers Open again for the connection that has connected since: the items are made when the menu opens', () => {
      const { host } = mount(surface, { connections: [connection('acme', 'a1', 'staging', 'connecting'), connection('acme', 'a2', 'production')] });
      rightClick(row('staging'));
      expect(item('Open')).toHaveAttribute('aria-disabled', 'true');
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

      act(() => {
        host.store.set({ connections: [connection('acme', 'a1', 'staging', 'connected'), connection('acme', 'a2', 'production')] });
      });
      rightClick(row('staging'));

      expect(item('Open')).not.toHaveAttribute('aria-disabled');
    });

    it('puts away a menu that is open when its connection starts connecting: what it offered is not so any more', () => {
      const { host } = mount(surface);
      rightClick(row('production'));
      expect(menu('production actions')).toBeInTheDocument();

      act(() => {
        host.store.set({ connections: [STARTING[0], connection('acme', 'a2', 'production', 'connecting'), STARTING[2]] });
      });

      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('stays open while a connection that it is not about changes its state: only a start puts it away', () => {
      const { host } = mount(surface);
      rightClick(row('production'));

      act(() => {
        host.store.set({ connections: [connection('acme', 'a1', 'staging', 'unauthorized', { reason: 'The connection needs you to sign in.' }), ...STARTING.slice(1)] });
      });

      expect(menu('production actions')).toBeInTheDocument();
    });
  });

  describe('what a store update costs', () => {
    it('keeps the rows of the connections that did not change: the same elements, and only the changed one says its new state', () => {
      const { host } = mount(surface);
      const before = rowsOf(connections());

      act(() => {
        host.store.set({ connections: [STARTING[0], connection('acme', 'a2', 'production', 'failed', { reason: 'It did not start.' }), STARTING[2]] });
      });

      const after = rowsOf(connections());
      expect(after[0]).toBe(before[0]);
      expect(after[1]).toBe(before[1]);
      expect(after[2]).toBe(before[2]);
      expect(after[1]).toHaveTextContent('production It did not start. Connection failed');
    });
  });
});
