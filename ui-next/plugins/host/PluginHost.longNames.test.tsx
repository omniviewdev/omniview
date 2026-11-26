import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore } from '../../shell';
import type { ContextV1, OverviewPageV1 } from '../contract/v1';
import { acme, answering, startedOn, widgetPage, WIDGETS } from '../testing';
import type { ConnectionsApi } from './connections/api';
import { NAME_MAX } from './connectionName';
import { unusedVerbs } from './homeTesting';
import { PluginHost, type PluginHostProps } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE, type HostRoute } from './route';

// A connection NAME of 1,000,000 characters (N2 of the review of HM3b): in WebKit, the native app's engine, the overview's heading alone stalled the window for more than 45 s (the tab clipped the name at `LIMITS.scopeLabel`, the heading did not). A name is clipped once,
// where it comes in (`connectionName.ts`, `connections/words.ts`), so that no surface draws an unclipped one: this is the window drawing every surface that reaches jsdom (the heading, the status path, the tab, a row of Home, the picker's option and the lane's face) from a
// plugin whose connection has such a name, said by its page's lane and by the host's own list. What a number of characters costs a layout is the engine's; what is asserted here is that nothing the window draws carries the name whole.

Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

const LONG = 'long-0123456789';
const SOUTH = 'south-9876543210';
const HUGE = 'n'.repeat(1_000_000);
const NORMAL = 'gke_project-123456_europe-west1-b_production-cluster-1';
const NAMES: Readonly<Record<string, string>> = { [LONG]: HUGE, [SOUTH]: NORMAL };

/** How much of a window's text one name may take: the name clipped, and everything else a window says around it, with room to spare. */
const ROOM = 12_000;

const overviewPage: OverviewPageV1 = {
  kind: 'overview',
  definition: { title: 'Overview', tile: { icon: 'server', tone: 'blue' }, tabs: [{ id: 'overview', label: 'Overview' }] },
  usePage: (context: ContextV1) => ({
    scope: [{ label: 'Zone', icon: 'server', text: NAMES[context.route.connection ?? ''] ?? 'all', role: 'connection' }],
    source: {
      state: { kind: 'ready' },
      refreshing: false,
      refresh: async () => undefined,
      view: { tabs: { overview: { kind: 'overview', sections: [{ id: 'details', kind: 'kv', title: 'Details', rows: [{ label: 'Region', value: 'one' }] }] } } },
    },
  }),
};

const ready = (): PluginEntry => {
  const base = acme();
  return {
    id: 'acme',
    name: 'Acme plugin',
    phase: 'ready',
    contribution: acme({
      sidebar: { ...base.sidebar, nodes: [{ id: 'overview', label: 'Overview', icon: 'server' }, { id: 'widgets', label: 'Widgets', icon: 'box' }] },
      pages: { overview: overviewPage, widgets: widgetPage('Widgets', answering(WIDGETS)) },
      home: 'overview',
    }),
  };
};

const at = (connection?: string): HostRoute => ({ plugin: 'acme', page: 'overview', connection, params: {} });

const entries: readonly PluginEntry[] = [ready()];
const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };

/** The host's own list of the plugin's connections: the long one, and one a person could have given. */
const api: ConnectionsApi = {
  ...unusedVerbs,
  states: async () => ({
    acme: [
      { connection: { id: LONG, name: HUGE, description: HUGE }, readiness: 'CONNECTED' },
      { connection: { id: SOUTH, name: NORMAL }, readiness: 'CONNECTED' },
    ],
  }),
  start: async () => ({ status: 'CONNECTED' }),
  onStatus: () => () => undefined,
  onSync: () => () => undefined,
};

function mount(over: Partial<PluginHostProps> = {}) {
  const props: PluginHostProps = { plugins, inventory: 'ready', link: NO_ROUTE, onRetry: vi.fn(), onRetryInventory: vi.fn(), session: over.link === undefined ? startedOn(entries) : undefined, connections: api, panel: createPanelStore(), ...over };
  const view = render(<PluginHost {...props} />);
  return {
    ...view,
    user: userEvent.setup(),
    again: (next: Partial<PluginHostProps>) => {
      view.rerender(<PluginHost {...props} {...next} />);
    },
  };
}

/** What the window knows once the host has answered its list. */
const settled = async (): Promise<void> => {
  await act(async () => Promise.resolve());
};

const tabs = () => screen.queryAllByRole('tab', { name: /./ }).filter((tab) => tab.closest('[aria-label="Open tabs"]') !== null);
/** The number of characters the window carries, in its whole text: one name drawn whole would be a million of them. */
const carried = (): number => document.body.textContent?.length ?? 0;

// jsdom hides a `[popover]` that no rule shows (the Popover API is the setup's stand-in, which marks an element and shows nothing), and a hidden element is inaccessible to the queries.
let shown: HTMLStyleElement | undefined;
beforeEach(() => {
  shown = document.createElement('style');
  shown.textContent = '[popover] { display: block !important; }';
  document.head.append(shown);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  shown?.remove();
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('a connection name of a million characters, in the window', () => {
  it('is clipped in the overview\'s heading, the status path and the tab, and nothing of the window carries it whole', async () => {
    mount({ link: at(LONG) });
    await settled();

    expect(document.querySelector('h1')?.textContent).toHaveLength(NAME_MAX);
    const path = within(screen.getByRole('navigation', { name: 'Current resource' })).getAllByRole('listitem').map((item) => item.textContent?.length);
    expect(path).toEqual(['Acme'.length, NAME_MAX]);
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]?.getAttribute('aria-label')?.length).toBeLessThan(ROOM);
    expect(carried()).toBeLessThan(ROOM);
  });

  it('is clipped in the label of a tab that is told from another of its page by it, and in its accessible name', async () => {
    const { again } = mount({ link: at(SOUTH) });
    await settled();
    again({ link: at(LONG) });
    await settled();

    expect(tabs()).toHaveLength(2);
    for (const tab of tabs()) {
      expect(tab.textContent?.length).toBeLessThan(ROOM);
      expect(tab.getAttribute('aria-label')?.length).toBeLessThan(ROOM);
    }

    expect(tabs().some((tab) => tab.textContent?.includes(NORMAL))).toBe(true);
    expect(tabs().some((tab) => tab.textContent?.includes(`${'n'.repeat(NAME_MAX - 1)}…`))).toBe(true);
    expect(carried()).toBeLessThan(ROOM);
  });

  it('is clipped in the row of Home: the name and the line under it are what the host\'s list says, held to their limits', async () => {
    mount({ session: undefined });
    await settled();

    const rows = [...document.querySelectorAll<HTMLElement>('[data-home-part="connection"]')];
    expect(rows).toHaveLength(2);
    const names = rows.map((row) => row.querySelector('[data-ov-clip]')?.textContent);
    // The rows are in the list's order, by name.
    expect(names.map((name) => name?.length)).toEqual([NORMAL.length, NAME_MAX]);
    expect(names[0]).toBe(NORMAL);
    expect(carried()).toBeLessThan(ROOM);
  });

  it('is clipped in the option of the connection picker and in the lane\'s face, and the option of a name that fits is whole', async () => {
    const { user } = mount({ link: at(SOUTH) });
    await settled();
    await user.click(await screen.findByRole('button', { name: `Zone: ${NORMAL}` }));

    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.textContent?.length).every((length) => (length ?? 0) < ROOM)).toBe(true);
    expect(options.some((option) => option.textContent?.includes(NORMAL))).toBe(true);
    expect(options.some((option) => option.textContent?.includes(`${'n'.repeat(NAME_MAX - 1)}…`))).toBe(true);
    expect(carried()).toBeLessThan(ROOM);
  });

  it('is clipped when the person chooses it: the tab goes to the connection and its heading, its path and its lane say the clipped name', async () => {
    const { user } = mount({ link: at(SOUTH) });
    await settled();
    await user.click(await screen.findByRole('button', { name: `Zone: ${NORMAL}` }));
    await user.click(await screen.findByRole('option', { name: (name) => name.startsWith('n') }));

    await waitFor(() => {
      expect(document.querySelector('h1')?.textContent).toHaveLength(NAME_MAX);
    });
    expect(carried()).toBeLessThan(ROOM);
  });

  it('leaves a name a person could have given a connection whole, wherever it is drawn', async () => {
    mount({ link: at(SOUTH) });
    await settled();

    expect(document.querySelector('h1')?.textContent).toBe(NORMAL);
    expect(within(screen.getByRole('navigation', { name: 'Current resource' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Acme', NORMAL]);
    expect(screen.getByRole('button', { name: `Zone: ${NORMAL}` })).toBeInTheDocument();
  });
});
