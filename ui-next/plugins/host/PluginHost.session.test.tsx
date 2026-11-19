import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { openSession, SESSION_VERSION, type LoadedSession } from '../../shell/session';
import { memoryStorage, type Memory } from '../../shell/session/testing';
import { acme } from '../testing';
import { PluginHost, type PluginHostProps } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE } from './route';

// jsdom lays nothing out: the table's region gets the size a browser would give it, so rows are in view.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get: function get(this: HTMLElement) {
    return this.getAttribute('role') === 'region' ? 600 : 0;
  },
});
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get: function get(this: HTMLElement) {
    return this.getAttribute('role') === 'region' ? 1117 : 0;
  },
});

// The window as a saved session opens it (S3a): the tabs, the rail's choice and the panel come back, a tab of a plugin that has not loaded is pending and then resolves, one whose plugin never
// comes says so and stays, the rail and the sidebar wait until every plugin has settled so that nothing moves for a late one, and a window with no session is the empty window (decision A17),
// not the first plugin's page. The session's own rules are tested in ui-next/shell/session; what is under test here is what the host does with one.

const ready = (id = 'acme', name = 'Acme plugin', contribution = acme()): PluginEntry => ({ id, name, phase: 'ready', contribution });
const loading = (id = 'acme', name = 'Acme plugin'): PluginEntry => ({ id, name, phase: 'loading' });

const face = (title: string, plugin = 'Acme plugin') => ({ title, icon: 'box', path: [plugin, title], facets: [], pluginName: plugin, singleton: false, identity: 'key' });
const savedTab = (id: string, plugin: string, page: string, title: string, pluginName = 'Acme plugin') => ({
  id,
  route: { plugin, contribution: page, params: {} },
  key: `${plugin}:${page}`,
  face: face(title, pluginName),
  pinned: false,
  preview: false,
  history: { entries: [{ plugin, contribution: page, params: {} }], index: 0 },
});
const savedWindow = (tabs: readonly unknown[], active: string | null, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ version: SESSION_VERSION, tabs: { version: 1, active, tabs }, rail: null, panel: { version: 1 }, ...extra });

type World = {
  readonly memory: Memory;
  readonly log: Mock<(message: string, detail?: unknown) => void>;
  readonly session: LoadedSession;
};

/** A session over text a previous run left (`undefined`: nothing was saved), and the notes it writes. */
function sessionOf(text: string | undefined): World {
  const memory = memoryStorage(text);
  const log = vi.fn<(message: string, detail?: unknown) => void>();
  return { memory, log, session: openSession(memory.storage, text, { log, now: () => 1_700_000_000_000 }) };
}

function mount(initial: readonly PluginEntry[], over: Partial<PluginHostProps> = {}) {
  let entries = initial;
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
  const props: PluginHostProps = { plugins, inventory: 'ready', link: NO_ROUTE, onRetry: vi.fn(), onRetryInventory: vi.fn(), ...over };
  const view = render(<PluginHost {...props} />);
  return {
    ...view,
    props,
    user: userEvent.setup({
      advanceTimers: (ms) => {
        if (vi.isFakeTimers()) {
          vi.advanceTimersByTime(ms);
        }
      },
    }),
    set: (next: readonly PluginEntry[]) => {
      act(() => {
        entries = next;
        for (const listener of [...listeners]) {
          listener();
        }
      });
    },
    again: (next: Partial<PluginHostProps>) => {
      view.rerender(<PluginHost {...props} {...next} />);
    },
  };
}

const tabs = () => screen.queryAllByRole('tab');
const faces = () => tabs().map((tab) => tab.textContent);
const selectedTab = () => tabs().find((tab) => tab.getAttribute('aria-selected') === 'true');
const railEntries = () => within(screen.getByRole('group', { name: 'Plugins' })).getAllByRole('button').map((button) => button.getAttribute('aria-label'));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a saved window', () => {
  it('comes back with its tabs, the one on screen on screen, and no tab opened by anyone but the session', () => {
    const { session } = sessionOf(savedWindow([savedTab('a', 'acme', 'widgets', 'Widgets'), savedTab('b', 'acme', 'gadgets', 'Gadgets')], 'b'));
    mount([ready()], { session });

    expect(faces()).toEqual(['Widgets', 'Gadgets']);
    expect(selectedTab()).toHaveTextContent('Gadgets');
    expect(screen.getByRole('treeitem', { name: 'Gadgets', selected: true })).toBeInTheDocument();
    expect(screen.getByText('gizmo')).toBeInTheDocument();
    // Only the tab on screen has a page.
    expect(screen.queryByText('alpha')).toBeNull();
  });

  it('keeps a tab of a plugin that has not loaded as it was drawn, with the kit\'s loading state in its page, until the plugin registers: then it is the plugin\'s page', () => {
    const { session } = sessionOf(savedWindow([savedTab('a', 'acme', 'gadgets', 'Gadgets')], 'a'));
    const { set, again } = mount([], { session, inventory: 'loading' });

    expect(faces()).toEqual(['Gadgets']);
    expect(screen.getByRole('status', { name: 'Loading Acme plugin' })).toBeInTheDocument();
    expect(screen.queryByText(/not installed/)).toBeNull();

    again({ inventory: 'ready' });
    set([loading()]);
    expect(faces()).toEqual(['Gadgets']);
    expect(screen.getByRole('status', { name: 'Loading Acme plugin' })).toBeInTheDocument();

    set([ready()]);
    expect(faces()).toEqual(['Gadgets']);
    expect(screen.getByText('gizmo')).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Gadgets', selected: true })).toBeInTheDocument();
  });

  it('says that a plugin is not installed, or is turned off, in the page of the tab that was saved with it, and keeps the tab: it is a plugin that may come back', () => {
    const { session } = sessionOf(savedWindow([savedTab('a', 'gone', 'items', 'Items', 'Gone plugin'), savedTab('b', 'acme', 'widgets', 'Widgets')], 'a'));
    const { set } = mount([ready()], { session });

    expect(faces()).toEqual(['Items', 'Widgets']);
    expect(selectedTab()).toHaveTextContent('Items');
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn\'t load Gone plugin');
    expect(screen.getByRole('alert')).toHaveTextContent('This plugin is not installed, or is turned off.');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    // The plugin is installed while the window is open: the tab is its page now.
    set([ready(), ready('gone', 'Gone plugin', acme({ plugin: { name: 'Gone plugin' }, pages: { items: acme().pages.widgets }, home: 'items', sidebar: { ...acme().sidebar, nodes: [{ id: 'items', label: 'Items', icon: 'box' }] } }))]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });

  it('says that the list of plugins could not be read in the page of a tab whose plugin it would have named, with a Retry that asks again', async () => {
    const { session } = sessionOf(savedWindow([savedTab('a', 'acme', 'widgets', 'Widgets')], 'a'));
    const { props, user } = mount([], { session, inventory: 'failed' });

    expect(faces()).toEqual(['Widgets']);
    expect(screen.getByRole('alert')).toHaveTextContent('The list of installed plugins could not be read.');
    await act(async () => user.click(screen.getByRole('button', { name: 'Retry' })));

    expect(props.onRetryInventory).toHaveBeenCalledTimes(1);
  });

  it('shows the sidebar of the plugin the user had chosen on the rail, not the tab\'s, and is not moved off it by the tab that is on screen', () => {
    const second = ready('b-second', 'Second', acme({ plugin: { name: 'Second' }, sidebar: { label: 'Second navigation', title: 'Second', nodes: acme().sidebar.nodes } }));
    const { session } = sessionOf(savedWindow([savedTab('a', 'acme', 'widgets', 'Widgets')], 'a', { rail: 'b-second' }));
    mount([ready(), second], { session });

    expect(screen.getByRole('navigation', { name: 'Second navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Second' })).toHaveAttribute('aria-current', 'true');
    // The page on screen is still the tab's: the user's choice moved the sidebar, not the tab.
    expect(screen.getByRole('main', { name: 'Acme workspace' })).toBeInTheDocument();
    expect(faces()).toEqual(['Widgets']);
  });

  it('falls back to the tab\'s plugin when the plugin that was chosen on the rail is gone', () => {
    const { session } = sessionOf(savedWindow([savedTab('a', 'acme', 'widgets', 'Widgets')], 'a', { rail: 'gone' }));
    mount([ready()], { session });

    expect(screen.getByRole('navigation', { name: 'Acme navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acme' })).toHaveAttribute('aria-current', 'true');
  });
});

describe('while the plugins load', () => {
  const second = () => ready('b-second', 'Second', acme({ plugin: { name: 'Second' }, rail: { icon: 'layers', label: 'Second plugin', order: 5 }, sidebar: { label: 'Second navigation', title: 'Second', nodes: acme().sidebar.nodes } }));
  const first = () => ready('a-first', 'First', acme({ plugin: { name: 'First' }, rail: { icon: 'layers', label: 'First plugin', order: 10 }, sidebar: { label: 'First navigation', title: 'First', nodes: acme().sidebar.nodes } }));

  it('holds the rail and the sidebar, empty at their rectangles, until every plugin has settled, so a plugin that registers late and sorts first moves no entry', () => {
    const { session } = sessionOf(savedWindow([savedTab('a', 'a-first', 'widgets', 'Widgets', 'First')], 'a'));
    const { set, container } = mount([first(), loading('b-second', 'Second')], { session });

    // The page of the tab is there as soon as its plugin is; the rail and the sidebar are not chosen yet.
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(container.querySelector('[data-shell-part="rail"]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryAllByRole('button', { name: /plugin$/ })).toHaveLength(0);
    expect(screen.getByRole('navigation', { name: 'Loading navigation' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('tree')).toBeNull();
    // The scope lane is the page's, which is known: nothing is reserved for it that the page does not have.
    expect(container.querySelector('[data-shell-part="lane"]')).not.toHaveAttribute('aria-hidden');

    set([first(), second()]);

    // Both entries at once, in the declared order, with the tab's plugin current.
    expect(railEntries()).toEqual(['Second plugin', 'First plugin']);
    expect(screen.getByRole('button', { name: 'First plugin' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('navigation', { name: 'First navigation' })).toBeInTheDocument();
  });

  it('does not hold them again when a plugin loads again after the window has settled (a retry)', () => {
    const { session } = sessionOf(savedWindow([savedTab('a', 'a-first', 'widgets', 'Widgets', 'First')], 'a'));
    const { set } = mount([first(), second()], { session });
    expect(railEntries()).toEqual(['Second plugin', 'First plugin']);

    set([first(), loading('b-second', 'Second')]);

    expect(railEntries()).toEqual(['First plugin']);
    expect(screen.getByRole('navigation', { name: 'First navigation' })).toBeInTheDocument();
  });
});

describe('a window with no session', () => {
  const closedOver = (text?: string) => sessionOf(text);

  it('is the empty window, and opens no page by itself, not the first plugin\'s: it says so, lists the plugins, and shows the first plugin of the rail\'s sidebar', () => {
    const { session } = closedOver();
    mount([ready()], { session });

    expect(tabs()).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
    expect(screen.getByText('No tabs are open.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Plugins you can open' })).getByRole('button', { name: /Acme/ })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Acme navigation' })).toBeInTheDocument();
    expect(screen.queryByText('alpha')).toBeNull();
  });

  it('is the empty window with no session at all, as in a browser with no host', () => {
    mount([ready()]);

    expect(tabs()).toHaveLength(0);
    expect(screen.getByText('No tabs are open.')).toBeInTheDocument();
  });

  it('is loading while a plugin is on its way, with the rail and the sidebar held and no lane reserved: no tab is coming for one', () => {
    const { session } = closedOver();
    const { container } = mount([ready(), loading('b-slow', 'Slow plugin')], { session });

    expect(screen.queryByText('No tabs are open.')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading Slow plugin' })).toBeInTheDocument();
    expect(container.querySelector('[data-shell-part="rail"]')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('navigation', { name: 'Loading navigation' })).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('[data-shell-part="lane"]')).toBeNull();
  });

  it('comes back as the empty window when it was saved empty: the user closed the last tab', () => {
    const { session, log } = closedOver(savedWindow([], null, { rail: 'acme' }));
    mount([ready()], { session });

    expect(tabs()).toHaveLength(0);
    expect(screen.getByText('No tabs are open.')).toBeInTheDocument();
    expect(log).not.toHaveBeenCalled();
  });

  it('is the empty window, with a note, when the saved text cannot be used, and the text is kept aside', async () => {
    const { session, log, memory } = closedOver('{"version":');
    mount([ready()], { session });
    await act(async () => {
      await Promise.resolve();
    });

    expect(tabs()).toHaveLength(0);
    expect(screen.getByText('No tabs are open.')).toBeInTheDocument();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('kept aside'), expect.anything());
    expect([...memory.kept.keys()]).toHaveLength(1);
  });
});

type Written = {
  readonly tabs: { readonly active: string | null; readonly tabs: ReadonlyArray<{ readonly id: string; readonly route: { readonly plugin: string; readonly contribution: string }; readonly face: { readonly title: string } }> };
  readonly rail: string | null;
  readonly panel: { readonly open: boolean };
};

describe('saving the window', () => {
  /** The last document the session wrote. */
  const lastWrite = (memory: Memory): Written => JSON.parse(memory.writes.at(-1) ?? 'null') as Written;
  const settle = async (ms = 400) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it('writes the tabs, the rail and the panel after the user changes them, and nothing before: the window as it was restored is what is saved already', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { session, memory } = sessionOf(undefined);
    const second = ready('b-second', 'Second', acme({ plugin: { name: 'Second' }, sidebar: { label: 'Second navigation', title: 'Second', nodes: acme().sidebar.nodes } }));
    const { user } = mount([ready(), second], { session });
    await settle(1000);
    expect(memory.writes).toEqual([]);

    await user.click(within(screen.getByRole('region', { name: 'Plugins you can open' })).getByRole('button', { name: /Acme/ }));
    await user.click(screen.getByRole('button', { name: 'Second' }));
    await user.click(screen.getByRole('button', { name: 'Panel' }));
    await settle(1000);

    // However the bursts fell, the last document holds all three: the tab, the rail's choice and the open panel.
    expect(memory.writes.length).toBeGreaterThan(0);
    const saved = lastWrite(memory);
    expect(saved.tabs.tabs.map((tab) => tab.route.contribution)).toEqual(['widgets']);
    expect(saved.tabs.active).toBe(saved.tabs.tabs[0]?.id);
    expect(saved.rail).toBe('b-second');
    expect(saved.panel.open).toBe(true);
  });

  it('writes what is pending when the window is hidden, and nothing after the window is gone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { session, memory } = sessionOf(undefined);
    const { user, unmount } = mount([ready()], { session });

    await user.click(within(screen.getByRole('region', { name: 'Plugins you can open' })).getByRole('button', { name: /Acme/ }));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await settle(0);
    expect(memory.writes.length).toBeGreaterThan(0);

    unmount();
    await settle(0);
    const written = memory.writes.length;
    window.dispatchEvent(new Event('pagehide'));
    await settle(1000);
    expect(memory.writes).toHaveLength(written);
  });

  it('writes a tab that was restored as it was: the saved face and route of a tab whose plugin never came are not lost', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { session, memory } = sessionOf(savedWindow([savedTab('a', 'gone', 'items', 'Items', 'Gone plugin'), savedTab('b', 'acme', 'widgets', 'Widgets')], 'b'));
    const { user } = mount([ready()], { session });
    await user.click(screen.getByRole('button', { name: 'New tab' }));
    await settle();

    const saved = lastWrite(memory);
    expect(saved.tabs.tabs.map((tab) => [tab.route.plugin, tab.route.contribution, tab.face.title])).toEqual([
      ['gone', 'items', 'Items'],
      ['acme', 'widgets', 'Widgets'],
      ['acme', 'widgets', 'Widgets'],
    ]);
  });
});
