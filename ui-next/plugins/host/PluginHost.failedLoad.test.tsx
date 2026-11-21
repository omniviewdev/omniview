import { act, cleanup, render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, type PanelStore } from '../../shell';
import { fakeFeed, type FakeFeed } from '../../shell/panel/logs/testing';
import { CONTRIBUTION_EXPORT_V1 } from '../contract/admit';
import type { ContextV1, ContributionV1, LogSessionV1, PanelBodyPropsV1 } from '../contract/v1';
import { acme, answering, fakeEvents, startedOn, widgetPage, WIDGETS, type FakeEvents } from '../testing';
import { listenForLifecycle } from './lifecycle';
import { PluginHost } from './PluginHost';
import { MAX_CONCURRENT_LOADS, PluginStore, type HostRetry } from './pluginStore';
import { NO_ROUTE } from './route';

// A plugin whose load fails (PU2, findings PU1-01 and PU1-02), through the real chain: what the host says (`plugin/unloaded` with the cause `reloaded`, then `failed` or `timeout`) is delivered to the window's listener, which hands
// it to the plugin store, which the host reads; the Retry of the tab asks the host (a fake that answers what each test says, and says what a real one does: its events) and the store shows progress for as long as the host takes.
// No test calls the store to make a plugin fail: the surfaces change because the host said so. Two invented plugins (Acme, Beta), so what one's failure leaves alone can be seen.

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

const COULD_NOT_START = 'The plugin could not start, so its pages can\'t load data.';
const TOOK_TOO_LONG = 'The plugin took too long to start, so its pages can\'t load data.';
const CRASHED = 'The plugin process stopped unexpectedly, so its pages can\'t load data.';

function StreamBody({ session }: PanelBodyPropsV1) {
  return <p>{`the body of ${session.title}`}</p>;
}

type Seen = { context: ContextV1 | undefined };

/** What the host does when it is asked to start a plugin again. */
type Behaviour = (id: string, host: Host) => Promise<boolean>;

/** The host's side as a test plays it: the events it sends and the retries it was asked for. */
type Host = {
  /** The host says a plugin stopped, or that its load failed. */
  readonly unloaded: (id: string, cause: string) => void;
  /** The host says a plugin runs: the window reads its files again. */
  readonly running: (id: string) => Promise<void>;
};

type Mounted = RenderResult &
  Host & {
    readonly store: PluginStore;
    readonly events: FakeEvents;
    readonly panel: PanelStore;
    readonly seen: Seen;
    /** How many times each plugin's bundle was read. */
    readonly imported: ReadonlyMap<string, number>;
    /** The plugins the window asked the host to start again, in order. */
    readonly retries: readonly string[];
    /** What the host does from now on when it is asked to start a plugin again. */
    readonly hostDoes: (next: Behaviour) => void;
    readonly user: UserEvent;
  };

/** The window over two plugins read through the real store, with the host's events a table the test calls. It opens on Acme's page, or empty (the window of a person who closed every tab) when `tab` is false. */
async function mount(tab = true): Promise<Mounted> {
  const events = fakeEvents();
  const seen: Seen = { context: undefined };
  const imported = new Map<string, number>();
  const retries: string[] = [];
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
        panel: { tools: { streams: { label: 'Streams', icon: 'server', order: 40, Body: StreamBody } } },
      }),
    beta: () => acme({ plugin: { name: 'Beta' }, sidebar: { label: 'Beta navigation', title: 'Beta', nodes: [{ id: 'bolts', label: 'Bolts', icon: 'box' }] }, pages: { bolts: widgetPage('Bolts', answering([{ key: 'b', name: 'bolt' }], 'Bolts')) }, home: 'bolts' }),
  };
  const behaviour: { current: Behaviour } = { current: async () => true };
  const host: Host = {
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
  const askHost: HostRetry = async (id) => {
    retries.push(id);
    return behaviour.current(id, host);
  };

  const store = new PluginStore(
    {
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
    askHost,
  );
  await store.load({ id: 'acme', name: 'Acme plugin' });
  await store.load({ id: 'beta', name: 'Beta plugin' });
  listenForLifecycle(store, events.source);
  const panel = createPanelStore();
  const view = render(
    <PluginHost
      plugins={store}
      inventory="ready"
      link={NO_ROUTE}
      // What the window does for the Retry of a plugin that did not come up (`PluginHostScreen`): the store asks the host, or reads the interface again, as the plugin's state says.
      onRetry={(id) => {
        const entry = store.getSnapshot().find((candidate) => candidate.id === id);
        if (entry !== undefined) {
          void store.retry({ id, name: entry.name });
        }
      }}
      onRetryInventory={() => undefined}
      panel={panel}
      session={tab ? startedOn(store.getSnapshot()) : undefined}
    />,
  );
  return {
    ...view,
    ...host,
    store,
    events,
    panel,
    seen,
    imported,
    retries,
    hostDoes: (next) => {
      behaviour.current = next;
    },
    user: userEvent.setup(),
  };
}

/** The rail's entries, by name: the plugins that contribute, then the ones that did not load, did not start or stopped. */
const rail = () => within(screen.getByRole('group', { name: 'Plugins' })).getAllByRole('button').map((button) => button.getAttribute('aria-label'));
/** The tabs of the window's strip, left to right (the panel has tabs of its own). */
const faces = () => within(screen.getByRole('tablist', { name: 'Open tabs' })).queryAllByRole('tab').map((tab) => tab.textContent);
const phases = (store: PluginStore) => store.getSnapshot().map((entry) => `${entry.id}:${entry.phase}`);
/** The loading states on screen: the kit's skeleton is a status that is busy. */
const spinners = () => document.querySelectorAll('[role="status"][aria-busy="true"]').length;
const toolNames = () => screen.getAllByRole('tab', { name: /^(Logs|Streams)$/ }).map((one) => one.textContent);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a reload whose load fails', () => {
  it('is starting again until the host says otherwise, and then a failed plugin: its rail entry says it did not start, its sidebar goes, its open tab says why with a Retry, and no spinner is left', async () => {
    const { unloaded, store } = await mount();
    expect(rail()).toEqual(['Acme', 'Beta']);
    expect(faces()).toEqual(['Widgets']);
    expect(screen.getByRole('heading', { name: 'Widgets' })).toBeInTheDocument();

    // The host stopped the plugin to start it again: the tab is the loading state, which has no Retry because there is nothing to retry yet.
    unloaded('acme', 'reloaded');
    expect(rail()).toEqual(['Beta', 'Acme plugin, starting again']);
    expect(spinners()).toBe(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    // And its load failed: what the host says ends the wait.
    unloaded('acme', 'failed');

    expect(rail()).toEqual(['Beta', 'Acme plugin, did not start']);
    expect(within(screen.getByRole('group', { name: 'Plugins' })).getByRole('button', { name: 'Acme plugin, did not start' })).toHaveAttribute('data-ov-tip', `Acme plugin, did not start\n${COULD_NOT_START}`);
    expect(screen.queryByRole('navigation', { name: 'Acme navigation' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Beta navigation' })).toBeInTheDocument();
    expect(faces()).toEqual(['Acme plugin']);
    const notice = screen.getByRole('alert');
    expect(within(notice).getByText(COULD_NOT_START)).toBeInTheDocument();
    expect(within(notice).getByText(/Couldn't load Acme plugin/)).toBeInTheDocument();
    expect(within(notice).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(spinners()).toBe(0);
    expect(screen.queryByRole('heading', { name: 'Widgets' })).toBeNull();
    expect(phases(store)).toEqual(['acme:failed', 'beta:ready']);
  });

  it('says it took too long when the host says it ran out of time', async () => {
    const { unloaded } = await mount();

    unloaded('acme', 'reloaded');
    unloaded('acme', 'timeout');

    expect(rail()).toEqual(['Beta', 'Acme plugin, timed out']);
    expect(within(screen.getByRole('group', { name: 'Plugins' })).getByRole('button', { name: 'Acme plugin, timed out' })).toHaveAttribute('data-ov-tip', `Acme plugin, timed out\n${TOOK_TOO_LONG}`);
    expect(within(screen.getByRole('alert')).getByText(TOOK_TOO_LONG)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(spinners()).toBe(0);
  });

  it('reads nothing of what the host sends beside the plugin\'s id and the cause: the words on the page are the host\'s, whatever else the event carries', async () => {
    const { events } = await mount();

    act(() => {
      events.emit('plugin/unloaded', { pluginID: 'acme', cause: 'reloaded' });
      events.emit('plugin/unloaded', { pluginID: 'acme', cause: 'failed', error: 'panic at /Users/me/.omniview/plugins/acme: token=abc123', message: 'SECRET words of the plugin' });
    });

    expect(screen.getByText(COULD_NOT_START)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SECRET|abc123|\/Users\/me/);
  });

  it('is listed in the empty window with a caption that says what happened, and its row opens the tab with the Retry', async () => {
    const { unloaded, user } = await mount(false);
    expect(screen.getByText('No tabs are open.')).toBeInTheDocument();

    unloaded('acme', 'reloaded');
    unloaded('acme', 'failed');
    const row = within(screen.getByRole('region', { name: 'Plugins you can open' })).getByRole('button', { name: /Acme plugin/ });
    expect(row).toHaveTextContent('Did not start');
    await user.click(row);

    expect(faces()).toEqual(['Acme plugin']);
    expect(within(screen.getByRole('alert')).getByText(COULD_NOT_START)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('the Retry of a plugin that did not start', () => {
  it('asks the host to start the plugin again, shows it starting again at once, and has the plugin back on its page when the host says it runs: the bundle is read once more and nothing reloads the window', async () => {
    const world = await mount();
    const { unloaded, store, user, imported } = world;
    unloaded('acme', 'reloaded');
    unloaded('acme', 'failed');
    const answer = Promise.withResolvers<boolean>();
    world.hostDoes(async () => answer.promise);

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(world.retries).toEqual(['acme']);
    // Progress: the plugin is starting again, in the rail and in the tab, with no Retry to press twice.
    expect(rail()).toEqual(['Beta', 'Acme plugin, starting again']);
    expect(spinners()).toBe(1);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(imported.get('acme')).toBe(1);

    await act(async () => {
      answer.resolve(true);
      await answer.promise;
    });
    await world.running('acme');

    await waitFor(() => {
      expect(phases(store)).toEqual(['acme:ready', 'beta:ready']);
    });
    expect(imported.get('acme')).toBe(2);
    expect(rail()).toEqual(['Acme', 'Beta']);
    expect(faces()).toEqual(['Widgets']);
    expect(screen.getAllByRole('heading', { name: 'Widgets' })).toHaveLength(1);
    expect(screen.getAllByRole('navigation', { name: 'Acme navigation' })).toHaveLength(1);
    expect(spinners()).toBe(0);
  });

  it('returns to the failed state when the load fails again, with the Retry in the tab: never a spinner with no exit', async () => {
    const world = await mount();
    const { unloaded, user } = world;
    unloaded('acme', 'reloaded');
    unloaded('acme', 'failed');
    // What the host does: it reloads the plugin, which it says, the load fails, which it says, and the call answers that the plugin does not run.
    world.hostDoes(async (id, host) => {
      await Promise.resolve();
      host.unloaded(id, 'reloaded');
      host.unloaded(id, 'timeout');
      return false;
    });

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(rail()).toEqual(['Beta', 'Acme plugin, timed out']);
    });
    expect(within(screen.getByRole('alert')).getByText(TOOK_TOO_LONG)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(spinners()).toBe(0);
  });

  it('returns to the failed state when the host\'s call fails and the host says nothing: the call ending is the exit, and its words are nowhere on the page', async () => {
    const world = await mount();
    const { unloaded, user } = world;
    unloaded('acme', 'reloaded');
    unloaded('acme', 'failed');
    world.hostDoes(async () => Promise.reject(new Error('{"detail":"Failed to load plugin: panic at /Users/me/.omniview/plugins/acme: token=abc123"}')));

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    expect(rail()).toEqual(['Beta', 'Acme plugin, did not start']);
    expect(within(screen.getByRole('alert')).getByText(COULD_NOT_START)).toBeInTheDocument();
    expect(spinners()).toBe(0);
    expect(document.body.textContent).not.toMatch(/abc123|\/Users\/me|panic/);
  });

  it('asks the host for a plugin that crashed too: the process is the host\'s to start, and reading the interface again would show a page that has no plugin behind it', async () => {
    const world = await mount();
    const { unloaded, user, store } = world;
    unloaded('acme', 'crashed');
    expect(screen.getByText(CRASHED)).toBeInTheDocument();
    world.hostDoes(async (id, host) => {
      await Promise.resolve();
      host.unloaded(id, 'reloaded');
      return true;
    });

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await world.running('acme');

    await waitFor(() => {
      expect(phases(store)).toEqual(['acme:ready', 'beta:ready']);
    });
    expect(world.retries).toEqual(['acme']);
    expect(screen.getByRole('heading', { name: 'Widgets' })).toBeInTheDocument();
  });

  it('ends ready once with one of everything after fail, retry, fail, retry, succeed', async () => {
    const world = await mount();
    const { unloaded, user, store, imported } = world;

    // The reload fails.
    unloaded('acme', 'reloaded');
    unloaded('acme', 'failed');
    // The first retry fails again, and the second runs.
    const runs = [false, true];
    world.hostDoes(async (id, host) => {
      const runsNow = runs.shift() ?? true;
      if (!runsNow) {
        await Promise.resolve();
        host.unloaded(id, 'reloaded');
        host.unloaded(id, 'failed');
      }

      return runsNow;
    });

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(rail()).toEqual(['Beta', 'Acme plugin, did not start']);
    });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await world.running('acme');

    await waitFor(() => {
      expect(phases(store)).toEqual(['acme:ready', 'beta:ready']);
    });
    expect(world.retries).toEqual(['acme', 'acme']);
    expect(imported.get('acme')).toBe(2);
    expect(rail()).toEqual(['Acme', 'Beta']);
    expect(faces()).toEqual(['Widgets']);
    expect(screen.getAllByRole('heading', { name: 'Widgets' })).toHaveLength(1);
    expect(screen.getAllByRole('navigation', { name: 'Acme navigation' })).toHaveLength(1);
  });
});

describe('what a plugin that did not start contributed to the window', () => {
  it('takes its panel tool with it and brings it back with the plugin; the host\'s own Logs tool is not the plugin\'s and stays', async () => {
    const world = await mount();
    const { unloaded, user, store } = world;
    await user.click(screen.getByRole('button', { name: 'Panel' }));
    expect(toolNames()).toEqual(['Logs', 'Streams']);

    unloaded('acme', 'reloaded');
    unloaded('acme', 'failed');
    expect(toolNames()).toEqual(['Logs']);
    world.hostDoes(async () => true);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await world.running('acme');

    await waitFor(() => {
      expect(phases(store)).toEqual(['acme:ready', 'beta:ready']);
    });
    expect(toolNames()).toEqual(['Logs', 'Streams']);
  });
});

// A21 and A22, through the real events: the sessions of a tool of the host stay listed when their plugin stops, whatever comes of its reload, with the lines the view had read, and nothing resumes when the plugin returns.
describe('the Logs sessions of a plugin whose reload failed', () => {
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

  it('stay, ended, in the same view with their lines, through a failed reload, two retries and a plugin that runs: the stream closed once, one session, and nothing resumed', async () => {
    const world = await mount();
    const { unloaded, user, store } = world;
    const feed = closingFeed();
    await waitFor(() => {
      expect(world.seen.context?.panel).toBeDefined();
    });
    let session: LogSessionV1 | undefined;
    act(() => {
      session = world.seen.context?.panel?.logs.open({ id: 'widget/alpha/app', title: 'alpha/app', scope: 'north', resource: { label: 'Widget alpha', kind: 'Widget', route: { page: 'widgets', params: {} } }, open: () => feed });
    });
    const log = await screen.findByRole('group', { name: 'Log, alpha/app · north' });
    await waitFor(() => {
      expect(feed.reads()).toBeGreaterThan(0);
    });
    act(() => {
      feed.push(40);
    });
    await waitFor(() => {
      expect(within(log).getByRole('grid').getAttribute('aria-rowcount')).toBe('41');
    });

    unloaded('acme', 'reloaded');
    unloaded('acme', 'failed');
    expect(world.panel.getSnapshot().sessions[session?.id ?? '']).toMatchObject({ state: 'ended', cause: 'The plugin was unloaded.', held: true });
    expect(feed.closed()).toBe(1);
    expect(screen.getByRole('group', { name: 'Log, alpha/app · north' })).toBe(log);

    const runs = [false, true];
    world.hostDoes(async (id, host) => {
      const runsNow = runs.shift() ?? true;
      if (!runsNow) {
        await Promise.resolve();
        host.unloaded(id, 'reloaded');
        host.unloaded(id, 'timeout');
      }

      return runsNow;
    });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await world.running('acme');

    await waitFor(() => {
      expect(phases(store)).toEqual(['acme:ready', 'beta:ready']);
    });
    expect(Object.keys(world.panel.getSnapshot().sessions)).toEqual([session?.id]);
    expect(world.panel.getSnapshot().sessions[session?.id ?? '']).toMatchObject({ state: 'ended', held: true });
    expect(screen.getByRole('group', { name: 'Log, alpha/app · north' })).toBe(log);
    expect(within(log).getByRole('grid').getAttribute('aria-rowcount')).toBe('41');
    expect(feed.closed()).toBe(1);
    expect(screen.getAllByRole('tab', { name: 'alpha/app, ended' })).toHaveLength(1);
  });
});

describe('a plugin that fails and is retried twenty times', () => {
  it('leaves one of everything at the end: one entry, one tab, one page, one tool, the listeners the window started with, and a stopped session that stays as it was', async () => {
    const world = await mount();
    const { unloaded, user, store } = world;
    const held = world.events.held();
    expect(held).toBe(2);
    const outcomes = ['failed', 'timeout', 'rejects', 'refuses'] as const;
    let outcome: (typeof outcomes)[number] = 'failed';
    world.hostDoes(async (id, host) => {
      if (outcome === 'rejects') {
        return Promise.reject(new Error('no'));
      }

      if (outcome === 'failed' || outcome === 'timeout') {
        await Promise.resolve();
        host.unloaded(id, 'reloaded');
        host.unloaded(id, outcome);
      }

      return false;
    });
    unloaded('acme', 'reloaded');
    unloaded('acme', 'failed');

    for (let cycle = 0; cycle < 20; cycle += 1) {
      outcome = outcomes[cycle % outcomes.length] ?? 'failed';
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      });
      expect(spinners()).toBe(0);
      expect(phases(store)).toEqual(['acme:failed', 'beta:ready']);
      expect(faces()).toEqual(['Acme plugin']);
      expect(world.events.held()).toBe(held);
    }

    // The host starts it, at last.
    world.hostDoes(async () => true);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await world.running('acme');
    await waitFor(() => {
      expect(phases(store)).toEqual(['acme:ready', 'beta:ready']);
    });
    expect(rail()).toEqual(['Acme', 'Beta']);
    expect(faces()).toEqual(['Widgets']);
    expect(screen.getAllByRole('heading', { name: 'Widgets' })).toHaveLength(1);
    expect(screen.getAllByRole('navigation', { name: 'Acme navigation' })).toHaveLength(1);
    expect(world.events.held()).toBe(held);
    expect(world.retries).toHaveLength(21);
    // The plugin's interface was read when the window opened and once more when the plugin ran: a plugin that did not start has nothing to read.
    expect(world.imported.get('acme')).toBe(2);
    expect(world.imported.get('beta')).toBe(1);
  });
});
