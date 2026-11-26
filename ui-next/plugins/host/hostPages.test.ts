import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openSession, SESSION_VERSION } from '../../shell/session';
import { createTabsStore, type Contributions, type Route, type TabsStore } from '../../shell';
import { acme } from '../testing';
import { createContributions, type PluginSource } from './contributions';
import { allHostPages, HOST_PLUGIN, hostPageOf, registerHostPage, type HostPageDefinition } from './hostPages';
import { createHostPalette, type HostPalette } from './palette';
import type * as Host from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { Published } from './published';
import { NO_ROUTE } from './route';

// The registry of the host's own pages and the three places that read it: the tab model's `describe` and `availability` (contributions.ts), and the palette's commands (palette.ts). The registry is module state with no way to
// remove a page, and a test file has its own module graph, so the first describe runs before any page is registered and every later one registers pages of its own ids. The pages are invented (alpha, beta, gamma).

const page = (id: string, title: string, icon: HostPageDefinition['icon'] = 'box'): HostPageDefinition => ({ id, title, icon, Page: () => null });

const route = (contribution: string, plugin: string = HOST_PLUGIN, params: Route['params'] = {}): Route => ({ plugin, contribution, params });

/** Two tabs, so that none of the three tab commands is left out for want of another tab. */
function openTwo(tabs: TabsStore): void {
  tabs.open({ route: route('widgets', 'acme') }, { how: 'new' });
  tabs.open({ route: route('gadgets', 'acme') }, { how: 'new' });
}

const ids = (): string[] => allHostPages().map((registered) => registered.id);

const ACME: PluginEntry = { id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() };

/** The plugin source and the tab model the palette and the contributions are built over: one invented plugin that can open two tabs, so that the tab commands are all available. */
function world(entries: readonly PluginEntry[] = [ACME]) {
  const plugins: PluginSource = { getSnapshot: () => entries, subscribe: () => () => undefined };
  const contributions = createContributions({ plugins, frames: new Published() });
  let counter = 0;
  const tabs = createTabsStore({
    contributions,
    newId: () => {
      counter += 1;
      return `t${String(counter)}`;
    },
  });
  return { plugins, contributions, tabs };
}

/** The palette's command rows, as the palette store lists them with no query: the host's own commands. */
function commandsOf(palette: HostPalette): Array<{ readonly title: string; readonly context: string; readonly icon: string | undefined; readonly command: string | undefined }> {
  palette.store.open({ kind: 'commands' });
  const section = palette.store.getSnapshot().sections.find((candidate) => candidate.id === 'commands');
  return (section?.rows ?? []).map((row) => ({ title: row.title.text, context: row.context.text, icon: row.tile?.icon, command: row.action.type === 'run' ? row.action.command.id : undefined }));
}

function paletteOver(tabs: TabsStore, contributions: Contributions, plugins: PluginSource): HostPalette {
  return createHostPalette({ tabs, plugins, contributions, nodes: new Published(), panel: undefined, platform: 'mac', onCloseWindow: undefined });
}

describe('with no host page registered', () => {
  it('finds none, and the palette offers the tab commands it always did and no more', () => {
    const { plugins, contributions, tabs } = world();
    openTwo(tabs);

    expect(allHostPages()).toEqual([]);
    expect(hostPageOf(route('alpha'))).toBeUndefined();
    expect(commandsOf(paletteOver(tabs, contributions, plugins)).map((command) => command.title)).toEqual(['Close tab', 'Close other tabs', 'Close tabs to the left', 'Close all but pinned', 'Duplicate tab', 'Pin tab', 'Reload tab', 'Next tab', 'Previous tab']);
  });
});

describe('the registry', () => {
  it('finds a registered page by the route that names it, and lists it', () => {
    const alpha = page('alpha', 'Alpha');
    registerHostPage(alpha);

    expect(hostPageOf(route('alpha'))).toBe(alpha);
    expect(allHostPages()).toContain(alpha);
  });

  it('finds a page for a route of the host and for no route of a plugin, whatever contribution it names', () => {
    registerHostPage(page('alpha', 'Alpha'));

    expect(hostPageOf(route('alpha', 'acme'))).toBeUndefined();
    expect(hostPageOf(route('alpha', 'alpha'))).toBeUndefined();
  });

  it('finds no page for a host route nothing is registered for', () => {
    registerHostPage(page('alpha', 'Alpha'));

    expect(hostPageOf(route('nothing-is-registered-here'))).toBeUndefined();
  });

  it('keeps the two pages of two ids, in the order they were registered', () => {
    const beta = page('beta', 'Beta');
    const gamma = page('gamma', 'Gamma');
    registerHostPage(beta);
    registerHostPage(gamma);

    expect(hostPageOf(route('beta'))).toBe(beta);
    expect(hostPageOf(route('gamma'))).toBe(gamma);
    expect(ids().filter((id) => id === 'beta' || id === 'gamma')).toEqual(['beta', 'gamma']);
  });

  it('replaces the page of an id registered again, and lists one page for it: a test or a probe registers a fake over the real one', () => {
    const first = page('delta', 'Delta');
    const fake = page('delta', 'Delta, faked');
    registerHostPage(first);
    const before = ids().length;

    registerHostPage(fake);

    expect(hostPageOf(route('delta'))).toBe(fake);
    expect(allHostPages()).not.toContain(first);
    expect(ids().filter((id) => id === 'delta')).toEqual(['delta']);
    expect(ids()).toHaveLength(before);
  });
});

describe('what the tab model asks the host about a host route', () => {
  it('describes it as the page: its title and glyph, one singleton tab, no path, no scope and no plugin name', () => {
    registerHostPage(page('epsilon', 'Epsilon', 'layers'));
    const { contributions } = world();

    expect(contributions.describe(route('epsilon'))).toEqual({ title: 'Epsilon', icon: 'layers', singleton: true, path: [] });
  });

  it('is available, whether or not any plugin is installed', () => {
    registerHostPage(page('epsilon', 'Epsilon'));

    expect(world().contributions.availability?.(route('epsilon'))).toEqual({ state: 'available' });
    expect(world([{ id: 'acme', name: 'Acme plugin', phase: 'loading' }]).contributions.availability?.(route('epsilon'))).toEqual({ state: 'available' });
  });

  it('does not describe a host route no page is registered for as a page, and does not open it', () => {
    registerHostPage(page('epsilon', 'Epsilon'));
    const { contributions } = world();

    expect(contributions.describe(route('zeta'))).toBeUndefined();
    expect(contributions.availability?.(route('zeta'))).toEqual({ state: 'unavailable', reason: 'This plugin is not installed, or is turned off.' });
  });

  it('keeps ONE tab for the page however often it is opened: the second open shows the first', () => {
    registerHostPage(page('epsilon', 'Epsilon'));
    const { tabs } = world();

    const first = tabs.open({ route: route('epsilon') }, { how: 'new' });
    const second = tabs.open({ route: route('epsilon') }, { how: 'new' });

    expect(first.status).toBe('done');
    expect(second.status).toBe('done');
    const state = tabs.getSnapshot();
    expect(state.order).toHaveLength(1);
    expect(state.tabs[state.order[0] ?? '']?.face).toMatchObject({ title: 'Epsilon', icon: 'box' });
  });
});

describe('the palette\'s commands for the host\'s pages', () => {
  it('has exactly one command for each registered page: host.<id>, its title, the Window context and its glyph, placed after Previous tab', () => {
    registerHostPage(page('alpha', 'Alpha', 'layers'));
    registerHostPage(page('beta', 'Beta', 'server'));
    const { plugins, contributions, tabs } = world();
    openTwo(tabs);

    const commands = commandsOf(paletteOver(tabs, contributions, plugins));

    const own = commands.filter((command) => command.command?.startsWith('host.') === true && !command.command.startsWith('host.tab.'));
    expect(own).toEqual(allHostPages().map((registered) => ({ title: registered.title, context: 'Window', icon: registered.icon, command: `host.${registered.id}` })));
    expect(own.map((command) => command.command)).toEqual(expect.arrayContaining(['host.alpha', 'host.beta']));
    const titles = commands.map((command) => command.title);
    expect(titles[0]).toBe('Close tab');
    expect(titles.indexOf('Alpha')).toBeGreaterThan(titles.indexOf('Previous tab'));
    expect(titles.indexOf('Beta')).toBeGreaterThan(titles.indexOf('Previous tab'));
  });

  it('opens the page\'s singleton tab through the tab model, as a smart open from a command, and shows the same tab the next time', () => {
    registerHostPage(page('gamma', 'Gamma'));
    const { plugins, contributions, tabs } = world();
    const open = vi.spyOn(tabs, 'open');
    const palette = paletteOver(tabs, contributions, plugins);
    commandsOf(palette);
    const row = palette.store.getSnapshot().rows.find((candidate) => candidate.title.text === 'Gamma');

    expect(palette.store.activate(row?.id ?? '')).toMatchObject({ status: 'ran', outcome: 'done' });
    expect(open).toHaveBeenCalledWith({ route: { plugin: HOST_PLUGIN, contribution: 'gamma' } }, { how: 'smart', source: 'command' });
    expect(tabs.getSnapshot().order).toHaveLength(1);

    commandsOf(palette);
    const again = palette.store.getSnapshot().rows.find((candidate) => candidate.title.text === 'Gamma');
    expect(palette.store.activate(again?.id ?? '')).toMatchObject({ status: 'ran', outcome: 'done' });
    expect(tabs.getSnapshot().order).toHaveLength(1);
  });
});

describe('the window\'s frame for a host page', () => {
  // PluginHost registers the product's own page when it is imported, so it is imported here, after the tests above that need the registry empty; the page is then replaced by a stand-in with the same id, which draws a word.
  let PluginHost: typeof Host.PluginHost;
  const BETA: PluginEntry = { id: 'beta', name: 'Beta plugin', phase: 'ready', contribution: acme({ plugin: { name: 'Beta' }, rail: { icon: 'server', order: 2 } }) };
  const entries: readonly PluginEntry[] = [ACME, BETA];

  beforeAll(async () => {
    ({ PluginHost } = await import('./PluginHost'));
    registerHostPage({ id: 'plugins', title: 'Plugins', icon: 'blocks', Page: () => createElement('p', null, 'the page of the host') });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /** A window saved with one tab, the page of the host's own, on screen. */
  function saved() {
    const route = { plugin: HOST_PLUGIN, contribution: 'plugins', params: {} };
    const text = JSON.stringify({ version: SESSION_VERSION, tabs: { version: 1, active: 'host-tab', tabs: [{ id: 'host-tab', route, key: 'host:plugins', pinned: false, preview: false }] }, rail: null, panel: { version: 1 } });
    return openSession({ read: async () => text, write: async () => undefined, keep: async () => undefined }, text);
  }

  const mount = () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const plugins: PluginSource = { getSnapshot: () => entries, subscribe: () => () => undefined };
    render(createElement(PluginHost, { plugins, inventory: 'ready', link: NO_ROUTE, onRetry: vi.fn(), onRetryInventory: vi.fn(), session: saved() }));
  };

  const frame = (): HTMLElement => {
    const found = document.querySelector<HTMLElement>('[data-shell-part="frame"]');
    if (found === null) {
      throw new Error('the window draws no frame');
    }

    return found;
  };

  const railButtons = (): HTMLElement[] => within(screen.getByRole('group', { name: 'Plugins' })).getAllByRole('button');

  it('has the rail, no sidebar and no scope lane, draws the page as a pane, and marks no entry of the rail current', () => {
    mount();

    expect(screen.getByText('the page of the host')).toBeInTheDocument();
    expect(within(screen.getByRole('tablist', { name: 'Open tabs' })).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Plugins']);
    expect(frame()).toHaveAttribute('data-rail');
    expect(frame()).not.toHaveAttribute('data-sidebar');
    expect(screen.queryByRole('navigation', { name: /navigation$/ })).toBeNull();
    expect(screen.queryByRole('group', { name: /scope$/ })).toBeNull();
    const layouts = [...document.querySelectorAll('[data-layout]')].map((element) => element.getAttribute('data-layout'));
    expect(layouts.length).toBeGreaterThan(0);
    expect(new Set(layouts)).toEqual(new Set(['pane']));
    expect(railButtons()).toHaveLength(2);
    expect(railButtons().filter((button) => button.hasAttribute('aria-current'))).toEqual([]);
  });

  it('opens the plugin\'s home in a tab when its rail entry is chosen, instead of changing a sidebar, and keeps the page\'s tab', async () => {
    mount();
    const entry = railButtons().find((button) => button.getAttribute('aria-label') === 'Beta');
    expect(entry).toBeDefined();

    await act(async () => {
      await userEvent.setup().click(entry ?? document.body);
    });

    const tabs = within(screen.getByRole('tablist', { name: 'Open tabs' })).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Plugins', 'Widgets']);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(frame()).toHaveAttribute('data-sidebar');
    expect(screen.getByRole('navigation', { name: 'Acme navigation' })).toBeInTheDocument();
    expect(railButtons().filter((button) => button.hasAttribute('aria-current')).map((button) => button.getAttribute('aria-label'))).toEqual(['Beta']);
  });
});
