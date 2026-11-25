import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PANEL_HOST, type TerminalsOptions, type TerminalTarget } from '../../shell';
import { fakeEngineLoader, fakeTerminalFeed, type FakeEngineLoader, type FakeTerminalFeed } from '../../shell/panel/terminal/testing';
import { openSession, SESSION_VERSION, type LoadedSession } from '../../shell/session';
import { acme } from '../testing';
import { PluginHost } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE } from './route';

// A window that was reloaded finds its terminals again (T2-go), through the real host: the saved panel has two terminal tabs, the window asks the host for the terminals it left when it attaches, and the tab of each terminal the
// host lists is given its terminal back, where it stands and under the name it had. The emulator is a fake and the host's own shell is a fake feed (what the real ones do is the probe's and the seam's); the host, the shell,
// the panel and the registry are the real ones.

const entries: readonly PluginEntry[] = [{ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme() }];
const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };

// jsdom has no modal dialog: a stand-in that opens the element, as the attribute does (what a modal does in a real engine is the probe's).
const dialog = HTMLDialogElement.prototype as unknown as { showModal?: () => void };
dialog.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The feed of a terminal that has a key: besides being closed it can be left (`left` counts it), which holds the shell for its lease so that the page that comes back finds it. */
const keyedFeed = (): FakeTerminalFeed => fakeTerminalFeed({ leave: true });

/** What the host lists for a window that was reloaded: a terminal whose session has the id of the terminal. */
const found = (sessionId: string, feed: FakeTerminalFeed): TerminalTarget => ({ plugin: PANEL_HOST, id: 'local', title: 'Terminal', sessionId, open: () => feed });

/**
 * The window as the last run left it: two terminal tabs, `bash` the one that was on screen, and the panel open or closed as the person left it. A restored session opens no panel ("Sessions restored at startup ... do not open it", S116), and a panel
 * that was left open is not a restored session: it comes back open (T2d).
 */
function savedWindow(open = false): LoadedSession {
  const sessions = [
    { id: 'term-1', tool: 'terminal', plugin: PANEL_HOST, title: 'zsh', scope: '' },
    { id: 'term-2', tool: 'terminal', plugin: PANEL_HOST, title: 'bash', scope: '' },
  ];
  const text = JSON.stringify({ version: SESSION_VERSION, tabs: { version: 1, active: null, tabs: [] }, rail: null, panel: { version: 1, open, height: null, tool: 'terminal', active: { terminal: 'term-2' }, sessions } });
  return openSession({ read: async () => Promise.resolve(text), write: async () => Promise.resolve(), keep: async () => Promise.resolve() }, text);
}

/** The host's list of shells, which is not what these tests are about: none, and no question to a host that is not there. */
const NONE: readonly never[] = [];
const NO_SHELLS = { subscribe: () => () => undefined, getSnapshot: () => NONE };

function mount(options: TerminalsOptions, open = false) {
  const loader: FakeEngineLoader = fakeEngineLoader();
  const view = render(<PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} session={savedWindow(open)} terminals={{ load: loader.load, shells: NO_SHELLS, ...options }} />);
  return { ...view, loader, user: userEvent.setup() };
}

describe('a window that was reloaded, through the real host', () => {
  it('gives the saved tab of a terminal the host lists its terminal back: the tab is no longer ended, and its body is the terminal and not the note that the earlier output is gone', async () => {
    const feed = keyedFeed();
    const { user, loader } = mount({ restore: async () => Promise.resolve([found('term-2', feed)]) });
    await user.click(screen.getByRole('button', { name: 'Panel' }));
    await waitFor(() => {
      expect(loader.engines).toHaveLength(1);
    });
    expect(screen.queryByText('The earlier output is gone')).toBeNull();
    expect(screen.getByRole('tab', { name: 'bash' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'zsh, ended' })).toBeInTheDocument();
    expect(feed.listeners()).toBeGreaterThan(0);
  });

  it('comes back with the panel open when the window was left with it open: the tab it was on is on screen with no press of the toggle, and nothing takes the keyboard (T2d)', async () => {
    const feed = keyedFeed();
    mount({ restore: async () => Promise.resolve([found('term-2', feed)]) }, true);
    await waitFor(() => {
      expect(feed.listeners()).toBeGreaterThan(0);
    });
    expect(screen.getByRole('button', { name: 'Panel' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('tab', { name: 'bash', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'zsh, ended' })).toBeInTheDocument();
    // The registry never takes the keyboard for a terminal it finds again, and the panel takes none when it opens with the window: the focus is where the page left it.
    expect(screen.getByRole('region', { name: 'Panel' }).contains(document.activeElement)).toBe(false);
  });

  it('draws the terminal the host lists in a panel that was open when the window was drawn, though the host was asked after: the note that the earlier output is gone gives way to the terminal (T2d)', async () => {
    const feed = keyedFeed();
    const { loader } = mount({ restore: async () => Promise.resolve([found('term-2', feed)]) }, true);
    await waitFor(() => {
      expect(loader.engines).toHaveLength(1);
    });
    expect(screen.queryByText('The earlier output is gone')).toBeNull();
    expect(feed.listeners()).toBeGreaterThan(0);
  });

  it('comes back open all the same when the host lists no terminal for it (the app restarted): the tabs are ended and the body says the earlier output is gone, where the person can see it', async () => {
    const restore = vi.fn(async (): Promise<readonly TerminalTarget[]> => Promise.resolve([]));
    const { loader } = mount({ restore }, true);
    await waitFor(() => {
      expect(restore).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('button', { name: 'Panel' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('The earlier output is gone')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'bash, ended', selected: true })).toBeInTheDocument();
    expect(loader.engines).toHaveLength(0);
  });

  it('stays closed when the window was left with the panel closed, and finds the terminal all the same: a restored session opens nothing, and its screen waits for the panel (T2d)', async () => {
    const feed = keyedFeed();
    const { loader } = mount({ restore: async () => Promise.resolve([found('term-2', feed)]) });
    await waitFor(() => {
      expect(feed.listeners()).toBeGreaterThan(0);
    });
    expect(screen.getByRole('button', { name: 'Panel' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('tab', { name: 'bash' })).toBeNull();
    expect(loader.engines).toHaveLength(0);
  });

  it('keeps the tab ended, with the note, when the host lists no terminal for it (the app restarted, and a terminal does not outlive it): nothing is offered', async () => {
    const restore = vi.fn(async (): Promise<readonly TerminalTarget[]> => Promise.resolve([]));
    const { user, loader } = mount({ restore });
    await user.click(screen.getByRole('button', { name: 'Panel' }));
    await waitFor(() => {
      expect(restore).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('The earlier output is gone')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'bash, ended' })).toBeInTheDocument();
    expect(loader.engines).toHaveLength(0);
  });

  it('keeps the tabs ended and says so once on the console when the host cannot list its terminals', async () => {
    const restore = vi.fn(async (): Promise<readonly TerminalTarget[]> => Promise.reject(new Error('the host did not answer')));
    const { user } = mount({ restore });
    await user.click(screen.getByRole('button', { name: 'Panel' }));
    await waitFor(() => {
      expect(console.warn).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('tab', { name: 'bash, ended' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'zsh, ended' })).toBeInTheDocument();
  });

  it('asks the host for its terminals once, however often the host component is drawn again', async () => {
    const restore = vi.fn(async (): Promise<readonly TerminalTarget[]> => Promise.resolve([]));
    const { rerender } = mount({ restore });
    await waitFor(() => {
      expect(restore).toHaveBeenCalledTimes(1);
    });
    rerender(<PluginHost plugins={plugins} inventory="loading" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} session={savedWindow()} terminals={{ restore }} />);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('asks the host once and still finds the terminal when the effects run twice (a development build mounts the window, unmounts it and mounts it again)', async () => {
    const feed = keyedFeed();
    const restore = vi.fn(async () => Promise.resolve([found('term-2', feed)]));
    const loader: FakeEngineLoader = fakeEngineLoader();
    render(
      <StrictMode>
        <PluginHost plugins={plugins} inventory="ready" link={NO_ROUTE} onRetry={() => undefined} onRetryInventory={() => undefined} session={savedWindow()} terminals={{ load: loader.load, restore }} />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(feed.listeners()).toBeGreaterThan(0);
    });
    expect(restore).toHaveBeenCalledTimes(1);
    expect(feed.closed()).toBe(0);
    expect(feed.left()).toBe(0);
  });

  it('leaves the terminal, and does not close it, when the window unmounts: the shell lives on for its lease and the next window finds it', async () => {
    const feed = keyedFeed();
    const { unmount } = mount({ restore: async () => Promise.resolve([found('term-2', feed)]) });
    await waitFor(() => {
      expect(feed.listeners()).toBeGreaterThan(0);
    });
    unmount();
    expect(feed.left()).toBe(1);
    expect(feed.closed()).toBe(0);
    expect(feed.listeners()).toBe(0);
  });

  it('leaves the terminal at pagehide, once, while the window is still there', async () => {
    const feed = keyedFeed();
    const { unmount } = mount({ restore: async () => Promise.resolve([found('term-2', feed)]) });
    await waitFor(() => {
      expect(feed.listeners()).toBeGreaterThan(0);
    });
    window.dispatchEvent(new Event('pagehide'));
    expect(feed.left()).toBe(1);
    expect(feed.closed()).toBe(0);
    unmount();
    expect(feed.left()).toBe(1);
    expect(feed.closed()).toBe(0);
  });
});
