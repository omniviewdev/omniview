import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, type PanelStore } from '../../shell';
import { fakeFeed, type FakeFeed } from '../../shell/panel/logs/testing';
import type { ContextV1, LogSessionV1, LogTargetV1, PanelHostV1 } from '../contract/v1';
import { acme, answering, startedOn, widgetPage, WIDGETS } from '../testing';
import { PluginHost } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE } from './route';

// The Logs tool through the host, against an invented plugin (Acme): the host registers the tool, hands a plugin's page `ctx.panel`, and a session a plugin opens from there is drawn by the host (the
// kit's log view over the feed), carries the card the host describes, and ends with its tab or its plugin. The registry, the body and the card are tested in ui-next/shell/panel/logs, and the plugin's
// handle in panelHost.test.ts; what is under test here is that they are wired into the window: the right objects reach the right places.

type Seen = { context: ContextV1 | undefined };

function mount(options: { readonly strict?: boolean; readonly plugins?: (seen: Seen) => readonly PluginEntry[] } = {}) {
  const seen: Seen = { context: undefined };
  const panel: PanelStore = createPanelStore();
  const watching = widgetPage('Widgets', (context) => {
    seen.context = context;
    return answering(WIDGETS)(context);
  });
  const first: readonly PluginEntry[] = options.plugins?.(seen) ?? [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme({ pages: { widgets: watching }, home: 'widgets' }) }];
  let entries = first;
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
  const host = <PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} panel={panel} session={startedOn(entries)} />;
  const view = render(options.strict === true ? <StrictMode>{host}</StrictMode> : host);
  return {
    ...view,
    panel,
    seen,
    /** The plugins the window started with: what comes back when a test sets them again after it removed them. */
    first,
    user: userEvent.setup(),
    /** The plugins now, as the plugin store tells the host. */
    set: (next: readonly PluginEntry[]) => {
      act(() => {
        entries = next;
        for (const listener of [...listeners]) {
          listener();
        }
      });
    },
  };
}

/** The handle the page was given. The page runs after the first frames, so a test waits for it. */
async function handle(seen: Seen): Promise<PanelHostV1> {
  await waitFor(() => {
    expect(seen.context?.panel).toBeDefined();
  });
  const found = seen.context?.panel;
  if (found === undefined) {
    throw new Error('the page was given no panel handle');
  }

  return found;
}

const ITEM_ROUTE = { page: 'widgets', params: {} } as const;

const target = (feed: FakeFeed, patch: Partial<LogTargetV1> = {}): LogTargetV1 => ({
  id: 'widget/alpha/app',
  title: 'alpha/app',
  scope: 'north',
  resource: { label: 'Widget alpha', kind: 'Widget', route: ITEM_ROUTE },
  open: () => feed,
  ...patch,
});

/** How long a test waits for the view's status strip to say what the list holds: the strip is told on its own clock, at most four times a second, so a quarter of a second and a frame, with room for a starved runner, inside the test's own 5 s. */
const STRIP_WAIT_MS = 3_000;

const toggle = () => screen.getByRole('button', { name: 'Panel' });
const tab = (name: string | RegExp) => screen.getByRole('tab', { name });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A stream that tells its listeners it ended as it closes, as the runtime's does: the view hears the end of a stream the host closed. */
function closingFeed(): FakeFeed {
  const feed: FakeFeed = fakeFeed({
    state: 'streaming',
    close: () => {
      feed.set({ state: 'ended' });
    },
  });
  return feed;
}

/** Opens a session on `feed` through the plugin's handle, and waits until the host's view has drawn `lines` lines of it. */
async function follow(logs: PanelHostV1['logs'], feed: FakeFeed, lines: number): Promise<{ readonly session: LogSessionV1 | undefined; readonly log: HTMLElement }> {
  let session: LogSessionV1 | undefined;
  act(() => {
    session = logs.open(target(feed));
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

describe('the Logs tool of the host', () => {
  it('is in the panel\'s strip without any plugin bringing it, and says how a session arrives: no button, no `+`', async () => {
    const { user } = mount({ plugins: () => [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() }] });
    await user.click(toggle());
    // The Terminal tool is first (the mock's order, 10) and is the one on screen until the person chooses another.
    await user.click(tab('Logs'));
    expect(tab('Logs')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No log sessions')).toBeInTheDocument();
    expect(screen.getByText('Open the logs of a resource to follow them here.')).toBeInTheDocument();
    const deck = document.querySelector<HTMLElement>('[data-shell-part="panelDeck"]');
    expect(within(deck ?? document.body).queryAllByRole('button')).toEqual([]);
    expect(document.querySelector('[data-shell-part="sessionAdd"]')).toBeNull();
  });

  it('is in the strip while no plugin is ready: it is the host\'s', async () => {
    const { user } = mount({ plugins: () => [] });
    await user.click(toggle());
    expect(tab('Logs')).toBeInTheDocument();
  });
});

describe('a plugin that opens a Logs session', () => {
  it('reaches the handle through the context of its page, and the panel opens on the session', async () => {
    const { seen, panel } = mount();
    const feed = fakeFeed({ state: 'streaming' });
    const logs = (await handle(seen)).logs;
    let session: LogSessionV1 | undefined;
    act(() => {
      session = logs.open(target(feed));
    });
    expect(session?.id).toBeDefined();
    expect(panel.getSnapshot().open).toBe(true);
    expect(tab('alpha/app')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Logs')).toHaveAttribute('aria-selected', 'true');
  });

  it('draws the lines of the feed in the host\'s log view: its find bar, its level filter and its strip, in the panel\'s body', async () => {
    const { seen } = mount();
    const feed = fakeFeed({ state: 'streaming' });
    const logs = (await handle(seen)).logs;
    act(() => {
      logs.open(target(feed));
    });
    const log = await screen.findByRole('group', { name: 'Log, alpha/app · north' });
    expect(within(log).getByRole('searchbox', { name: 'Search logs' })).toBeInTheDocument();
    expect(within(log).getByRole('radiogroup', { name: 'Minimum level' })).toBeInTheDocument();
    // The lines come after the view's first frame, which has read nothing: the order a slow runner has and a quick machine may not (the first frame is a timer's, and a role query that takes longer than the
    // timer lets it run before the next line of this test), so the test makes it its own. The list takes the lines in the frame that reads them; the strip counts on its own clock, told at most four times a
    // second (the kit's `StatusStrip`), so it is WAITED for, as its reader does: asserting it in the same breath as the list raced the first frame (CI: the strip still said "0 lines").
    await waitFor(() => {
      expect(feed.reads()).toBeGreaterThan(0);
    });
    act(() => {
      feed.push(40);
    });
    await waitFor(() => {
      expect(within(log).getByRole('grid').getAttribute('aria-rowcount')).toBe('41');
    });
    expect(await within(log).findByText(/40 lines/, undefined, { timeout: STRIP_WAIT_MS })).toBeInTheDocument();
  });

  it('draws the lines a stream already held when the view first appeared, and its strip counts them with the first frame', async () => {
    const { seen } = mount();
    const feed = fakeFeed({ state: 'streaming' });
    feed.push(25);
    const logs = (await handle(seen)).logs;
    act(() => {
      logs.open(target(feed));
    });
    const log = await screen.findByRole('group', { name: 'Log, alpha/app · north' });
    await waitFor(() => {
      expect(within(log).getByRole('grid').getAttribute('aria-rowcount')).toBe('26');
    });
    expect(await within(log).findByText(/25 lines/, undefined, { timeout: STRIP_WAIT_MS })).toBeInTheDocument();
  });

  it('puts the session in its own tool\'s strip, named for its title and nothing else (its scope is for twins), with its state in its name when it is not running', async () => {
    const { seen } = mount();
    const logs = (await handle(seen)).logs;
    const ended = fakeFeed({ state: 'streaming' });
    act(() => {
      logs.open(target(fakeFeed({ state: 'streaming' })));
      logs.open(target(ended, { id: 'widget/beta/app', title: 'beta/app' }));
    });
    act(() => {
      ended.set({ state: 'ended' });
    });
    expect(tab('alpha/app')).toBeInTheDocument();
    expect(tab('beta/app, ended')).toBeInTheDocument();
  });

  it('says why a stream failed on the tab, in the words of the failure', async () => {
    const { seen, panel } = mount();
    const logs = (await handle(seen)).logs;
    const feed = fakeFeed({ state: 'streaming' });
    let session: LogSessionV1 | undefined;
    act(() => {
      session = logs.open(target(feed));
    });
    act(() => {
      feed.set({ state: 'failed', cause: { stage: 'source', message: 'Failed to reconnect after 5 attempts' } });
    });
    expect(panel.getSnapshot().sessions[session?.id ?? '']).toMatchObject({ state: 'failed', cause: 'The log stream stopped. Failed to reconnect after 5 attempts.' });
    expect(tab('alpha/app, failed')).toBeInTheDocument();
    expect(await screen.findByText(/The log stream stopped\./)).toBeInTheDocument();
  });

  it('closes the stream, and every listener it held, when the session\'s tab closes', async () => {
    const { seen, user, panel } = mount();
    const logs = (await handle(seen)).logs;
    const feed = fakeFeed({ state: 'streaming' });
    act(() => {
      logs.open(target(feed));
    });
    await screen.findByRole('group', { name: 'Log, alpha/app · north' });
    expect(feed.listeners()).toBeGreaterThan(1);
    tab('alpha/app').focus();
    await user.keyboard('{Delete}');
    expect(Object.keys(panel.getSnapshot().sessions)).toEqual([]);
    expect(feed.closed()).toBe(1);
    await waitFor(() => {
      expect(feed.listeners()).toBe(0);
    });
    expect(screen.getByText('No log sessions')).toBeInTheDocument();
  });

  // A21: what a plugin's unload ends in the host's Logs tool is kept. The stream is closed (the runtime drops what it held and tells its listeners it ended), the session stays ended with the cause, and the
  // view keeps the lines it had read, in the very same view, until the tab closes.
  it('closes the stream of a plugin that goes away and KEEPS the session: the tab stays, ended, and the same view keeps the lines it had read, saying the stream ended (A21)', async () => {
    const { seen, set, panel } = mount();
    const logs = (await handle(seen)).logs;
    const feed = closingFeed();
    const { session, log } = await follow(logs, feed, 40);
    set([]);
    expect(panel.getSnapshot().sessions[session?.id ?? '']).toMatchObject({ state: 'ended', cause: 'The plugin was unloaded.', held: true });
    expect(feed.closed()).toBe(1);
    expect(screen.getByRole('tab', { name: 'alpha/app, ended' })).toBeInTheDocument();
    // Not a view made again over nothing: the same element, with its lines.
    expect(screen.getByRole('group', { name: 'Log, alpha/app · north' })).toBe(log);
    expect(within(log).getByRole('grid').getAttribute('aria-rowcount')).toBe('41');
    expect(await within(log).findByText('Stream ended')).toBeInTheDocument();
    expect(screen.queryByText('The earlier lines are gone')).toBeNull();
  });

  it('frees the stream and the view when the tab of a held session closes: nothing is closed twice, no listener is left, and the tool is empty again', async () => {
    const { seen, set, panel, user } = mount();
    const logs = (await handle(seen)).logs;
    const feed = closingFeed();
    await follow(logs, feed, 40);
    set([]);
    tab('alpha/app, ended').focus();
    await user.keyboard('{Delete}');
    expect(Object.keys(panel.getSnapshot().sessions)).toEqual([]);
    // It was closed once, at the unload.
    expect(feed.closed()).toBe(1);
    await waitFor(() => {
      expect(feed.listeners()).toBe(0);
    });
    expect(feed.stats().held).toBe(0);
    expect(screen.queryByRole('group', { name: 'Log, alpha/app · north' })).toBeNull();
    expect(screen.getByText('No log sessions')).toBeInTheDocument();
  });

  it('keeps the held session, ended and with its lines, when the plugin comes back, and a new press of Logs opens a new session beside it with a stream of its own: nothing resumes', async () => {
    const { seen, set, first, panel, user } = mount();
    const logs = (await handle(seen)).logs;
    const old = closingFeed();
    const { session: heldSession } = await follow(logs, old, 40);
    set([]);
    set(first);
    expect(panel.getSnapshot().sessions[heldSession?.id ?? '']).toMatchObject({ state: 'ended', held: true, cause: 'The plugin was unloaded.' });
    expect(old.closed()).toBe(1);
    // The press of Logs again: the plugin's page asks for the stream anew, through the handle it had.
    const fresh = closingFeed();
    let pressed: LogSessionV1 | undefined;
    act(() => {
      pressed = logs.open(target(fresh));
    });
    expect(pressed?.id).not.toBe(heldSession?.id);
    expect(tab('alpha/app, ended')).toBeInTheDocument();
    expect(tab('alpha/app (2)')).toHaveAttribute('aria-selected', 'true');
    expect(panel.getSnapshot().sessions[pressed?.id ?? '']).toMatchObject({ state: 'running' });
    expect(panel.getSnapshot().sessions[pressed?.id ?? '']?.held).toBeUndefined();
    expect(fresh.closed()).toBe(0);
    expect(fresh.listeners()).toBeGreaterThan(0);
    // The old session still has its lines: choosing it shows them, ended; the new one goes on.
    await user.click(tab('alpha/app, ended'));
    const log = await screen.findByRole('group', { name: 'Log, alpha/app · north' });
    expect(within(log).getByRole('grid').getAttribute('aria-rowcount')).toBe('41');
    expect(await within(log).findByText('Stream ended')).toBeInTheDocument();
    expect(old.closed()).toBe(1);
  });

  it('keeps a session that had ended on its own before the plugin left, exactly as it was: its tab stays with its own words and the same view keeps its lines (A21: whatever the state)', async () => {
    const { seen, set, first, panel } = mount();
    const logs = (await handle(seen)).logs;
    const feed = closingFeed();
    const { session, log } = await follow(logs, feed, 40);
    act(() => {
      feed.set({ state: 'ended' });
    });
    const before = panel.getSnapshot().sessions[session?.id ?? ''];
    set([]);
    expect(panel.getSnapshot().sessions[session?.id ?? '']).toMatchObject({ state: 'ended', cause: '', since: before?.since, held: true });
    expect(screen.getByRole('tab', { name: 'alpha/app, ended' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Log, alpha/app · north' })).toBe(log);
    expect(within(log).getByRole('grid').getAttribute('aria-rowcount')).toBe('41');
    expect(feed.closed()).toBe(1);
    set(first);
    expect(screen.getByRole('group', { name: 'Log, alpha/app · north' })).toBe(log);
    expect(screen.queryByText('The earlier lines are gone')).toBeNull();
    // Nothing started again for it.
    expect(feed.closed()).toBe(1);
  });

  it('works in a development build, which runs the host\'s effects twice: a session opens and closes as in a production one', async () => {
    const { seen, panel } = mount({ strict: true });
    const logs = (await handle(seen)).logs;
    const feed = fakeFeed({ state: 'streaming' });
    let session: LogSessionV1 | undefined;
    act(() => {
      session = logs.open(target(feed));
    });
    await screen.findByRole('group', { name: 'Log, alpha/app · north' });
    act(() => {
      session?.close();
    });
    expect(Object.keys(panel.getSnapshot().sessions)).toEqual([]);
    expect(feed.closed()).toBe(1);
  });
});

// A session is its plugin's and its target's id (P1b3b-01, P1b-3d): a command that opens the same target again is a press for the session that is open, which the panel shows, and the plugin's `open` is not
// called again, so no second stream starts. Two targets of one title and two scopes are twins, and their tabs say which is which.
describe('a plugin that opens the same target again (P1b-3d)', () => {
  const sessionTabs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-shell-part="sessionTab"] [role="tab"]')];

  it('shows the session it has and starts no second stream: one tab, one call to the plugin\'s `open`, and the panel opens on it again when it was hidden', async () => {
    const { seen, panel, user } = mount();
    const logs = (await handle(seen)).logs;
    const feed = fakeFeed({ state: 'streaming' });
    const open = vi.fn(() => feed);
    let first: LogSessionV1 | undefined;
    let second: LogSessionV1 | undefined;
    act(() => {
      first = logs.open(target(feed, { open }));
    });
    await user.click(screen.getByRole('button', { name: 'Hide panel' }));
    expect(panel.getSnapshot().open).toBe(false);
    const again = vi.fn(() => fakeFeed({ state: 'streaming' }));
    act(() => {
      second = logs.open(target(feed, { open: again }));
    });
    expect(second?.id).toBe(first?.id);
    expect(again).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    expect(panel.getSnapshot().open).toBe(true);
    expect(sessionTabs()).toHaveLength(1);
    expect(tab('alpha/app')).toHaveAttribute('aria-selected', 'true');
    expect(feed.closed()).toBe(0);
    expect(feed.listeners()).toBeGreaterThan(1);
  });

  it('moves no focus: the control that had it keeps it, on the press that opens the session and on the press that shows it (the mock shows the panel with `focus: false`)', async () => {
    const { seen } = mount();
    const logs = (await handle(seen)).logs;
    const feed = fakeFeed({ state: 'streaming' });
    act(() => {
      toggle().focus();
    });
    expect(toggle()).toHaveFocus();
    act(() => {
      logs.open(target(feed));
    });
    expect(toggle()).toHaveFocus();
    act(() => {
      logs.open(target(feed));
    });
    expect(toggle()).toHaveFocus();
  });

  it('shows the session it has when another session of the tool is on screen, and starts nothing for either: the press is for the session', async () => {
    const { seen, panel, user } = mount();
    const logs = (await handle(seen)).logs;
    act(() => {
      logs.open(target(fakeFeed({ state: 'streaming' })));
      logs.open(target(fakeFeed({ state: 'streaming' }), { id: 'widget/beta/app', title: 'beta/app' }));
    });
    expect(tab('beta/app')).toHaveAttribute('aria-selected', 'true');
    act(() => {
      logs.open(target(fakeFeed(), { open: vi.fn(() => fakeFeed()) }));
    });
    expect(tab('alpha/app')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Logs')).toHaveAttribute('aria-selected', 'true');
    expect(sessionTabs()).toHaveLength(2);
    expect(Object.keys(panel.getSnapshot().sessions)).toHaveLength(2);
    await user.click(tab('beta/app'));
    expect(tab('beta/app')).toHaveAttribute('aria-selected', 'true');
  });

  // A22: a stream that ended is not shown again (the host has no Reconnect): the press opens a new session beside it, and the two tabs, which differ in neither title nor scope, are told apart by the ordinal and by
  // the ended state, in the name and in what is drawn (the mock's rule for the same title: an ordinal in the tab, shell-panel.js:219-220, and the info glyph of an exited session, S116's table).
  it('opens a new session when the stream of the session it has has ended: two tabs of one title and one scope, told apart by the ordinal and the ended state, the ended one readable', async () => {
    const { seen, panel } = mount();
    const logs = (await handle(seen)).logs;
    const old = fakeFeed({ state: 'streaming' });
    let first: LogSessionV1 | undefined;
    act(() => {
      first = logs.open(target(old));
    });
    act(() => {
      old.set({ state: 'ended' });
    });
    const fresh = fakeFeed({ state: 'streaming' });
    const open = vi.fn(() => fresh);
    let second: LogSessionV1 | undefined;
    act(() => {
      second = logs.open(target(fresh, { open }));
    });
    expect(second?.id).not.toBe(first?.id);
    expect(open).toHaveBeenCalledTimes(1);
    expect(sessionTabs().map((one) => one.getAttribute('aria-label'))).toEqual(['alpha/app, ended', 'alpha/app (2)']);
    expect(tab('alpha/app (2)')).toHaveAttribute('aria-selected', 'true');
    expect(sessionTabs().map((one) => one.textContent)).toEqual(['alpha/app', 'alpha/app (2)']);
    expect(document.querySelector(`[data-shell-part="sessionTab"][data-tab-id="${first?.id ?? ''}"] [data-shell-part="sessionLead"]`)?.getAttribute('data-state')).toBe('ended');
    expect(old.closed()).toBe(0);
    expect(panel.getSnapshot().sessions[first?.id ?? '']).toMatchObject({ state: 'ended' });
  });

  it('draws the scope on the tab of each of two targets that share a title and not a scope, and takes it off the one that is left when the other closes', async () => {
    const { seen, user } = mount();
    const logs = (await handle(seen)).logs;
    act(() => {
      logs.open(target(fakeFeed({ state: 'streaming' })));
      logs.open(target(fakeFeed({ state: 'streaming' }), { id: 'widget/alpha/app@south', scope: 'south' }));
    });
    expect(sessionTabs().map((one) => one.getAttribute('aria-label'))).toEqual(['alpha/app · north', 'alpha/app · south']);
    expect([...document.querySelectorAll('[data-shell-part="sessionScope"]')].map((one) => one.textContent)).toEqual(['north', 'south']);
    tab('alpha/app · south').focus();
    await user.keyboard('{Delete}');
    expect(sessionTabs().map((one) => one.getAttribute('aria-label'))).toEqual(['alpha/app']);
    expect(document.querySelector('[data-shell-part="sessionScope"]')).toBeNull();
  });
});
