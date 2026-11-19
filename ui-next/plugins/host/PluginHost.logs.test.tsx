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

describe('the Logs tool of the host', () => {
  it('is in the panel\'s strip without any plugin bringing it, and says how a session arrives: no button, no `+`', async () => {
    const { user } = mount({ plugins: () => [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() }] });
    await user.click(toggle());
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
    expect(tab('alpha/app · north')).toHaveAttribute('aria-selected', 'true');
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

  it('puts the session in its own tool\'s strip, named for its title and scope, with its state in its name when it is not running', async () => {
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
    expect(tab('alpha/app · north')).toBeInTheDocument();
    expect(tab('beta/app · north, ended')).toBeInTheDocument();
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
    expect(tab('alpha/app · north, failed')).toBeInTheDocument();
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
    tab('alpha/app · north').focus();
    await user.keyboard('{Delete}');
    expect(Object.keys(panel.getSnapshot().sessions)).toEqual([]);
    expect(feed.closed()).toBe(1);
    await waitFor(() => {
      expect(feed.listeners()).toBe(0);
    });
    expect(screen.getByText('No log sessions')).toBeInTheDocument();
  });

  it('closes the streams of a plugin that goes away, and the panel hides its sessions and ends them (a plugin that is off contributes nothing); the host keeps no line of them', async () => {
    const { seen, set, panel } = mount();
    const logs = (await handle(seen)).logs;
    const feed = fakeFeed({ state: 'streaming' });
    let session: LogSessionV1 | undefined;
    act(() => {
      session = logs.open(target(feed));
    });
    await screen.findByRole('group', { name: 'Log, alpha/app · north' });
    act(() => {
      feed.push(40);
    });
    set([]);
    expect(panel.getSnapshot().sessions[session?.id ?? '']).toMatchObject({ state: 'ended', cause: 'The plugin was unloaded.' });
    expect(feed.closed()).toBe(1);
    expect(screen.queryByRole('tab', { name: /alpha\/app/ })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Log, alpha/app · north' })).toBeNull();
    await waitFor(() => {
      expect(feed.listeners()).toBe(0);
    });
  });

  it('gives the session back when the plugin does, as it was left and honestly: ended, because the plugin was unloaded, with the earlier lines gone and the way to get logs again said in its body', async () => {
    const { seen, set, first, panel } = mount();
    const logs = (await handle(seen)).logs;
    const feed = fakeFeed({ state: 'streaming' });
    let session: LogSessionV1 | undefined;
    act(() => {
      session = logs.open(target(feed));
    });
    await screen.findByRole('group', { name: 'Log, alpha/app · north' });
    set([]);
    set(first);
    expect(await screen.findByRole('tab', { name: 'alpha/app · north, ended' })).toBeInTheDocument();
    expect(panel.getSnapshot().sessions[session?.id ?? '']).toMatchObject({ state: 'ended', cause: 'The plugin was unloaded.' });
    expect(screen.getByText('The earlier lines are gone')).toBeInTheDocument();
    expect(screen.getByText('Open logs from the resource to follow them again.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Log, alpha/app · north' })).toBeNull();
    // Nothing started again for it.
    expect(feed.closed()).toBe(1);
    expect(feed.listeners()).toBe(0);
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
