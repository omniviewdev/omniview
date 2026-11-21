import { act, cleanup, render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, type PanelStore } from '../../shell';
import { fakeFeed, type FakeFeed } from '../../shell/panel/logs/testing';
import { CONTRIBUTION_EXPORT_V1 } from '../contract/admit';
import type { ContextV1, ContributionV1, LogSessionV1, PaletteRowV1, PanelBodyPropsV1 } from '../contract/v1';
import { acme, answering, fakeEvents, startedOn, widgetPage, WIDGETS, type FakeEvents } from '../testing';
import { listenForLifecycle } from './lifecycle';
import { PluginHost } from './PluginHost';
import { MAX_CONCURRENT_LOADS, PluginStore } from './pluginStore';
import { NO_ROUTE } from './route';

// A plugin that stops, through the real chain (PU1, decision A21): what the host says (`plugin/unloaded`, then `plugin/state_change` when the plugin runs again) is delivered to the window's listener,
// which hands it to the plugin store, which the host reads. No test calls the store to make a plugin leave: the surfaces change because the host said so, as in the window, and a plugin that comes back
// is loaded again from its files (the store counts the bundles it read) with no reload of the window. Two invented plugins (Acme, Beta), so what one's stop leaves alone can be seen.

// jsdom lays nothing out: the table's region gets the size a browser would give it, so rows are in view.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

// jsdom has no modal dialog: a stand-in that opens the element, as the attribute does.
const dialog = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
dialog.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

const CRASHED = 'The plugin process stopped unexpectedly, so its pages can\'t load data.';
const RELOADING = 'The plugin is starting again. The page opens when it is ready.';
const NOT_THERE = 'This plugin is not installed, or is turned off.';

function StreamBody({ session }: PanelBodyPropsV1) {
  return <p>{`the body of ${session.title}`}</p>;
}

const sprocket: PaletteRowV1 = { id: 's1', label: 'Sprocket box', secondary: 'Hardware', icon: 'box', route: { page: 'gadgets', params: {} } };

type Seen = { context: ContextV1 | undefined };

type Mounted = RenderResult & {
  readonly store: PluginStore;
  readonly events: FakeEvents;
  readonly panel: PanelStore;
  /** What Acme's page was last given: its `ctx.panel`. */
  readonly seen: Seen;
  /** How many times each plugin's bundle was read. */
  readonly imported: ReadonlyMap<string, number>;
  /** The plugins the window asked the host to start again, in order: the host's side of the Retry of a plugin that stopped. */
  readonly retried: readonly string[];
  readonly user: UserEvent;
  /** The host says a plugin stopped. */
  readonly unloaded: (id: string, cause: string) => void;
  /** The host says a plugin runs: the window reads its files again. */
  readonly running: (id: string) => Promise<void>;
};

/** The window over two plugins read through the real store, with the host's events a table the test calls. */
async function mount(): Promise<Mounted> {
  const events = fakeEvents();
  const seen: Seen = { context: undefined };
  const imported = new Map<string, number>();
  const retried: string[] = [];
  const bundles: Readonly<Record<string, () => ContributionV1>> = {
    acme: () =>
      acme({
        pages: {
          widgets: widgetPage('Widgets', (context) => {
            seen.context = context;
            return answering(WIDGETS)(context);
          }),
          gadgets: widgetPage('Gadgets', answering([{ key: 'g', name: 'gizmo' }], 'Gadgets')),
        },
        home: 'widgets',
        panel: { tools: { streams: { label: 'Streams', icon: 'server', order: 40, Body: StreamBody, newSession: { label: 'New stream', open: () => ({ title: 'alpha', scope: 'north', state: 'running' }) } } } },
        palette: { providers: { things: { kind: 'match', section: 'Hardware', match: () => [sprocket] } } },
      }),
    beta: () => acme({ plugin: { name: 'Beta' }, sidebar: { label: 'Beta navigation', title: 'Beta', nodes: [{ id: 'bolts', label: 'Bolts', icon: 'box' }] }, pages: { bolts: widgetPage('Bolts', answering([{ key: 'b', name: 'bolt' }], 'Bolts')) }, home: 'bolts' }),
  };
  const store = new PluginStore({
    importBundle: async (id) => {
      imported.set(id, (imported.get(id) ?? 0) + 1);
      const make = bundles[id];
      if (make === undefined) {
        throw new Error(`no bundle for ${id}`);
      }

      return { [CONTRIBUTION_EXPORT_V1]: make() };
    },
    clearBundle: () => undefined,
    log: () => undefined,
  },
  MAX_CONCURRENT_LOADS,
  // The host starts the plugin again when it is asked (PU2: the Retry of a plugin that stopped is the host's).
  async (id) => {
    retried.push(id);
    return true;
  });
  await store.load({ id: 'acme', name: 'Acme plugin' });
  await store.load({ id: 'beta', name: 'Beta plugin' });
  listenForLifecycle(store, events.source);
  const panel = createPanelStore();
  const view = render(
    <PluginHost
      plugins={store}
      inventory="ready"
      link={NO_ROUTE}
      // What the window does for the Retry of a plugin that failed (`PluginHostScreen`): its interface is read again.
      onRetry={(id) => {
        const entry = store.getSnapshot().find((candidate) => candidate.id === id);
        if (entry !== undefined) {
          void store.retry({ id, name: entry.name });
        }
      }}
      onRetryInventory={() => undefined}
      panel={panel}
      session={startedOn(store.getSnapshot())}
    />,
  );
  return {
    ...view,
    store,
    events,
    panel,
    seen,
    imported,
    retried,
    user: userEvent.setup(),
    unloaded: (id, cause) => {
      act(() => {
        events.emit('plugin/unloaded', { pluginID: id, cause });
      });
    },
    running: async (id) => {
      await act(async () => {
        events.emit('plugin/state_change', { pluginID: id, from: 'Starting', to: 'Running', reason: 'force: plugin loaded successfully', timestamp: '2026-11-20T21:00:00Z' });
      });
    },
  };
}

/** The rail's entries, by name: the plugins that contribute, then the ones that did not load or stopped. */
const rail = () => within(screen.getByRole('group', { name: 'Plugins' })).getAllByRole('button').map((button) => button.getAttribute('aria-label'));
/** The tabs of the window's strip, left to right (the panel has tabs of its own). */
const faces = () => within(screen.getByRole('tablist', { name: 'Open tabs' })).queryAllByRole('tab').map((tab) => tab.textContent);
const phases = (store: PluginStore) => store.getSnapshot().map((entry) => `${entry.id}:${entry.phase}`);
const toggle = () => screen.getByRole('button', { name: 'Panel' });
const toolNames = () => screen.getAllByRole('tab', { name: /^(Logs|Streams)$/ }).map((one) => one.textContent);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a plugin whose process crashed', () => {
  it('leaves through the paths of a plugin that failed: its rail entry says it stopped, its sidebar goes, its open tab says why with a Retry, and the other plugin is as it was', async () => {
    const { unloaded, store } = await mount();
    expect(rail()).toEqual(['Acme', 'Beta']);
    expect(screen.getByRole('navigation', { name: 'Acme navigation' })).toBeInTheDocument();
    expect(faces()).toEqual(['Widgets']);
    expect(screen.getByRole('heading', { name: 'Widgets' })).toBeInTheDocument();

    unloaded('acme', 'crashed');

    expect(rail()).toEqual(['Beta', 'Acme plugin, stopped']);
    expect(within(screen.getByRole('group', { name: 'Plugins' })).getByRole('button', { name: 'Acme plugin, stopped' })).toHaveAttribute('data-ov-tip', `Acme plugin, stopped\n${CRASHED}`);
    // The sidebar that shows is the other plugin's: the one that stopped has none.
    expect(screen.queryByRole('navigation', { name: 'Acme navigation' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Beta navigation' })).toBeInTheDocument();
    // The tab keeps its route and says what happened, in the host's words, with the Retry the mock has for a failed plugin (ch16 S89).
    expect(faces()).toEqual(['Acme plugin']);
    expect(screen.getByText(CRASHED)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Widgets' })).toBeNull();
    expect(phases(store)).toEqual(['acme:failed', 'beta:ready']);
  });

  it('shows the tab as the plugin\'s page again when the host says the plugin runs: its interface is read from its files and nothing reloads the window', async () => {
    const { unloaded, running, imported, store } = await mount();
    unloaded('acme', 'crashed');
    expect(imported.get('acme')).toBe(1);

    await running('acme');

    await waitFor(() => {
      expect(phases(store)).toEqual(['acme:ready', 'beta:ready']);
    });
    expect(imported.get('acme')).toBe(2);
    expect(rail()).toEqual(['Acme', 'Beta']);
    expect(faces()).toEqual(['Widgets']);
    expect(screen.getByRole('heading', { name: 'Widgets' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Acme navigation' })).toBeInTheDocument();
    expect(screen.queryByText(CRASHED)).toBeNull();
  });

  it('asks the host to start the plugin again from the tab\'s Retry, the one affordance the mock has for a failed plugin, and reads the interface when the host says it runs (PU2: reading it alone would show a page with no process behind it)', async () => {
    const { unloaded, user, store, imported, retried } = await mount();
    unloaded('acme', 'crashed');

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(phases(store)).toEqual(['acme:ready', 'beta:ready']);
    });
    expect(retried).toEqual(['acme']);
    expect(imported.get('acme')).toBe(2);
    expect(screen.getByRole('heading', { name: 'Widgets' })).toBeInTheDocument();
  });

  it('reads nothing of what the host sends beside the plugin\'s id and the cause: the words on the page are the host\'s, whatever else the event carries', async () => {
    const { events } = await mount();

    act(() => {
      events.emit('plugin/unloaded', { pluginID: 'acme', cause: 'crashed', error: 'panic at /Users/me/.omniview/plugins/acme: token=abc123', message: 'SECRET words of the plugin' });
    });

    expect(screen.getByText(CRASHED)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SECRET|abc123|\/Users\/me/);
  });
});

describe('a plugin that is reloading', () => {
  it('says it is starting again in its rail entry, and its tab draws the loading state with no Retry: nothing failed, and there is nothing to ask again (ch16 S89)', async () => {
    const { unloaded } = await mount();

    unloaded('acme', 'reloaded');

    expect(rail()).toEqual(['Beta', 'Acme plugin, starting again']);
    expect(within(screen.getByRole('group', { name: 'Plugins' })).getByRole('button', { name: 'Acme plugin, starting again' })).toHaveAttribute('data-ov-tip', `Acme plugin, starting again\n${RELOADING}`);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByText(CRASHED)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Widgets' })).toBeNull();
  });

  it('is loaded again from its files when it runs, and its tab is back on its page: the bundle is read once more', async () => {
    const { unloaded, running, imported, store } = await mount();
    unloaded('acme', 'reloaded');

    await running('acme');

    await waitFor(() => {
      expect(phases(store)).toEqual(['acme:ready', 'beta:ready']);
    });
    expect(imported.get('acme')).toBe(2);
    expect(imported.get('beta')).toBe(1);
    expect(screen.getByRole('heading', { name: 'Widgets' })).toBeInTheDocument();
  });

  it('keeps the cause a crash went away with while the host recovers it, which reloads the plugin and says so as well: stopped unexpectedly stands until it runs', async () => {
    const { unloaded, running, store } = await mount();

    unloaded('acme', 'crashed');
    unloaded('acme', 'reloaded');

    expect(rail()).toEqual(['Beta', 'Acme plugin, stopped']);
    expect(screen.getByText(CRASHED)).toBeInTheDocument();
    await running('acme');
    await waitFor(() => {
      expect(phases(store)).toEqual(['acme:ready', 'beta:ready']);
    });
  });
});

describe('a plugin that was uninstalled or turned off', () => {
  // What an OPEN TAB of such a plugin shows (ch16 PO1: "Its tabs keep route and state"; S19: the plugin is "disabled, stopped or not installed"): the tab stays where it is with the face it had, and its island is the kit's
  // failure notice in the host's words ("This plugin is not installed, or is turned off."), the state the host already draws for a tab restored from a session whose plugin is not there. It is not a spinner that nothing
  // will end and it offers no Retry: the plugin is not there to try again, and the person gets it back by installing or turning it on, which brings it to the window as any plugin it has not got.
  it.each(['uninstalled', 'disabled'])('is not in the rail, and its open tab says it is not installed or is turned off: no spinner, no Retry, the tab where it was: the window is as it would be if it had opened now (%s)', async (cause) => {
    const { unloaded, store } = await mount();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();

    unloaded('acme', cause);

    expect(rail()).toEqual(['Beta']);
    expect(screen.queryByRole('navigation', { name: 'Acme navigation' })).toBeNull();
    // The tab stays, with the face it had: the plugin may come back, and the tab is the person's.
    expect(faces()).toEqual(['Widgets']);
    const notice = screen.getByRole('alert');
    expect(within(notice).getByText(NOT_THERE)).toBeInTheDocument();
    expect(within(notice).getByText(/Couldn't load Acme/)).toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(phases(store)).toEqual(['beta:ready']);
  });

  it('is back, with its tab on its page, when the inventory names it again and the store loads it as any plugin it has not got', async () => {
    const { unloaded, store, imported } = await mount();
    unloaded('acme', 'disabled');

    await act(async () => store.load({ id: 'acme', name: 'Acme plugin' }));

    expect(rail()).toEqual(['Acme', 'Beta']);
    expect(imported.get('acme')).toBe(2);
    expect(screen.getByRole('heading', { name: 'Widgets' })).toBeInTheDocument();
  });
});

describe('what a plugin that stopped contributed to the window', () => {
  it('takes its panel tool with it and brings it back with the plugin; the host\'s own Logs tool is not the plugin\'s and stays', async () => {
    const { unloaded, running, user, store } = await mount();
    await user.click(toggle());
    expect(toolNames()).toEqual(['Logs', 'Streams']);

    unloaded('acme', 'crashed');
    expect(toolNames()).toEqual(['Logs']);

    await running('acme');
    await waitFor(() => {
      expect(phases(store)).toEqual(['acme:ready', 'beta:ready']);
    });
    expect(toolNames()).toEqual(['Logs', 'Streams']);
  });

  it('takes its section of the open palette with it, and brings it back with the plugin without a keystroke', async () => {
    const { unloaded, running, user, store } = await mount();
    await user.click(screen.getByRole('button', { name: /^Search/ }));
    await user.keyboard('sprocket');
    await screen.findByRole('option', { name: 'Page: Sprocket box, Hardware' });

    unloaded('acme', 'crashed');
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: 'Page: Sprocket box, Hardware' })).toBeNull();
    });
    expect(screen.getByRole('combobox')).toHaveValue('sprocket');

    await running('acme');
    await waitFor(() => {
      expect(phases(store)).toEqual(['acme:ready', 'beta:ready']);
    });
    await screen.findByRole('option', { name: 'Page: Sprocket box, Hardware' });
  });
});

// A21, through the real event: the sessions of a tool of the host stay listed when their plugin stops, ended with the cause, with the lines the view had read, and nothing resumes when the plugin returns. P1b-3c
// proved the rule against a plugin source the test changed; this is the same rule reached by what the host says.
describe('the Logs sessions of a plugin that stopped', () => {
  /** A stream that tells its listeners it ended as it closes, as the runtime's does. */
  function closingFeed(): FakeFeed {
    const feed: FakeFeed = fakeFeed({
      state: 'streaming',
      close: () => {
        feed.set({ state: 'ended' });
      },
    });
    return feed;
  }

  const target = (feed: FakeFeed) => ({ id: 'widget/alpha/app', title: 'alpha/app', scope: 'north', resource: { label: 'Widget alpha', kind: 'Widget', route: { page: 'widgets', params: {} } }, open: () => feed });

  /** Opens a session on `feed` through the plugin's own handle and waits until the host's view drew `lines` lines of it. */
  async function follow(world: Mounted, feed: FakeFeed, lines: number): Promise<{ readonly session: LogSessionV1 | undefined; readonly log: HTMLElement }> {
    await waitFor(() => {
      expect(world.seen.context?.panel).toBeDefined();
    });
    let session: LogSessionV1 | undefined;
    act(() => {
      session = world.seen.context?.panel?.logs.open(target(feed));
    });
    const log = await screen.findByRole('group', { name: 'Log, alpha/app · north' });
    await waitFor(() => {
      expect(feed.reads()).toBeGreaterThan(0);
    });
    act(() => {
      feed.push(lines);
    });
    await waitFor(() => {
      expect(within(log).getByRole('grid').getAttribute('aria-rowcount')).toBe(String(lines + 1));
    });
    return { session, log };
  }

  it('stay when the host says the plugin crashed: the tab, ended with the cause, the same view with its lines, the stream closed once; and nothing resumes when the plugin runs again', async () => {
    const world = await mount();
    const feed = closingFeed();
    const { session, log } = await follow(world, feed, 40);

    world.unloaded('acme', 'crashed');

    expect(world.panel.getSnapshot().sessions[session?.id ?? '']).toMatchObject({ state: 'ended', cause: 'The plugin was unloaded.', held: true });
    expect(feed.closed()).toBe(1);
    expect(screen.getByRole('tab', { name: 'alpha/app, ended' })).toBeInTheDocument();
    // Not a view made again over nothing: the same element, with its lines.
    expect(screen.getByRole('group', { name: 'Log, alpha/app · north' })).toBe(log);
    expect(within(log).getByRole('grid').getAttribute('aria-rowcount')).toBe('41');

    await world.running('acme');
    await waitFor(() => {
      expect(phases(world.store)).toEqual(['acme:ready', 'beta:ready']);
    });
    expect(world.panel.getSnapshot().sessions[session?.id ?? '']).toMatchObject({ state: 'ended', held: true });
    expect(screen.getByRole('group', { name: 'Log, alpha/app · north' })).toBe(log);
    expect(feed.closed()).toBe(1);
  });

  it('end once when the host says the plugin stopped twice, as it does when it recovers a crash by reloading the plugin', async () => {
    const world = await mount();
    const feed = closingFeed();
    const { session } = await follow(world, feed, 10);

    world.unloaded('acme', 'crashed');
    world.unloaded('acme', 'reloaded');

    expect(world.panel.getSnapshot().sessions[session?.id ?? '']).toMatchObject({ state: 'ended', cause: 'The plugin was unloaded.', held: true });
    expect(feed.closed()).toBe(1);
  });

  it('stay, with their lines, when the plugin was turned off: the host\'s tool keeps what the person was reading', async () => {
    const world = await mount();
    const feed = closingFeed();
    const { session, log } = await follow(world, feed, 40);

    world.unloaded('acme', 'disabled');

    expect(world.panel.getSnapshot().sessions[session?.id ?? '']).toMatchObject({ state: 'ended', cause: 'The plugin was unloaded.', held: true });
    expect(screen.getByRole('group', { name: 'Log, alpha/app · north' })).toBe(log);
    expect(feed.closed()).toBe(1);
  });
});

describe('a plugin that stops and returns twenty times', () => {
  it('leaves one of everything each time: one entry, one tab, one page, one tool, one section, the listeners the window started with, and a stopped session that stays as it was', async () => {
    const world = await mount();
    const feed = fakeFeed({
      state: 'streaming',
      close: () => {
        feed.set({ state: 'ended' });
      },
    });
    await waitFor(() => {
      expect(world.seen.context?.panel).toBeDefined();
    });
    let session: LogSessionV1 | undefined;
    act(() => {
      session = world.seen.context?.panel?.logs.open({ id: 'widget/alpha/app', title: 'alpha/app', scope: 'north', resource: { label: 'Widget alpha', kind: 'Widget', route: { page: 'widgets', params: {} } }, open: () => feed });
    });
    // Opening a session shows the panel on it.
    await screen.findByRole('group', { name: 'Log, alpha/app · north' });
    const held = world.events.held();
    expect(held).toBe(2);
    const causes = ['crashed', 'reloaded', 'crashed', 'disabled'] as const;

    for (let round = 0; round < 20; round += 1) {
      const cause = causes[round % causes.length] ?? 'crashed';
      world.unloaded('acme', cause);
      // A plugin that was turned off comes back by the inventory (the store has no entry for it); any other by the plugin running.
      if (cause === 'disabled') {
        await act(async () => world.store.load({ id: 'acme', name: 'Acme plugin' }));
      } else {
        await world.running('acme');
      }

      await waitFor(() => {
        expect(phases(world.store)).toEqual(['acme:ready', 'beta:ready']);
      });
      expect(rail()).toEqual(['Acme', 'Beta']);
      expect(faces()).toEqual(['Widgets']);
      expect(screen.getAllByRole('heading', { name: 'Widgets' })).toHaveLength(1);
      expect(screen.getAllByRole('navigation', { name: 'Acme navigation' })).toHaveLength(1);
      expect(toolNames()).toEqual(['Logs', 'Streams']);
      expect(Object.keys(world.panel.getSnapshot().sessions)).toEqual([session?.id]);
      expect(world.events.held()).toBe(held);
    }

    // Every round read the plugin's bundle once, and no other plugin's was touched.
    expect(world.imported.get('acme')).toBe(21);
    expect(world.imported.get('beta')).toBe(1);
    // The session was ended at the first stop and never again: one close, no listener of its stream left over, and it is as it was.
    expect(feed.closed()).toBe(1);
    expect(world.panel.getSnapshot().sessions[session?.id ?? '']).toMatchObject({ state: 'ended', cause: 'The plugin was unloaded.', held: true });
    expect(screen.getAllByRole('tab', { name: 'alpha/app, ended' })).toHaveLength(1);
  });
});
