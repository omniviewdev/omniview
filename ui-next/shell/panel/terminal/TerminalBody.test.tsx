import { act, cleanup, render, screen as page, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSyncExternalStore } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, HOST, type PanelStore, type Session } from '../../core/panel';
import { RenamingProvider, type Renaming } from '../renaming';
import type { TerminalFeedHandle, TerminalFeedSnapshot, TerminalRestart, TerminalTarget } from './feed';
import { createScreenReaderChoice, SCREEN_READER_COMMAND, type ScreenReaderChoice } from './screenReader';
import { sessionStateOf } from './state';
import { fakeEngineLoader, fakeTerminalFeed, type FakeEngineLoader, type FakeTerminalFeed } from './testing';
import { TerminalBody } from './TerminalBody';
import { createTerminalSessions, type TerminalSessions } from './TerminalSessions';
import { TERMINAL_GONE, TERMINAL_TOOL, TERMINAL_TOOL_ID } from './tool';

// The body of a terminal session in the panel: the tool's toolbar, the screen the emulator draws in, the lane under it, and the words for a person who cannot see them. Against the real panel model, the real
// registry and screen, and a fake emulator (what a real one does is the probes' to prove, in a real engine): what is checked here is that the body hands the screen its host, shows and hides it with the panel,
// reads the look from the theme, says in words what the session is, and moves the keyboard in only for a session the user started.

type Rig = {
  readonly store: PanelStore;
  readonly sessions: TerminalSessions;
  readonly loader: FakeEngineLoader;
  readonly feed: FakeTerminalFeed;
  readonly session: () => Session;
  readonly show: (visible: boolean) => void;
  readonly frame: () => Promise<void>;
  /** The window's one screen reader choice, as the body is given it, and how many listeners the body and its screen have on it now. */
  readonly reader: ScreenReaderChoice;
  readonly readerListeners: () => number;
};

let counter = 0;

function mount(options: { readonly focus?: boolean; readonly visible?: boolean; readonly state?: TerminalFeedSnapshot['state']; readonly screenReader?: boolean; readonly retitle?: boolean; readonly name?: string; readonly renaming?: Renaming; readonly held?: boolean } = {}): Rig {
  counter = 0;
  const store = createPanelStore({ now: () => 1_000, newId: () => `s${String(++counter)}` });
  store.registerTool(TERMINAL_TOOL);
  const sessions = createTerminalSessions(store, { newId: () => `term-${String(++counter)}` });
  sessions.attach();
  const feed = fakeTerminalFeed({ state: options.state ?? 'running' });
  const loader = fakeEngineLoader();
  const reader = createScreenReaderChoice(options.screenReader);
  let readerHeard = 0;
  const counted = {
    getSnapshot: reader.getSnapshot,
    subscribe: (listener: () => void) => {
      readerHeard += 1;
      const stop = reader.subscribe(listener);
      return () => {
        readerHeard -= 1;
        stop();
      };
    },
  };
  const target: TerminalTarget = { plugin: HOST, id: 'local', title: 'Terminal', open: () => feed, ...(options.retitle === true ? { retitle: (status: TerminalFeedSnapshot) => status.program } : {}) };
  const opened = sessions.open(target, { focus: options.focus === true });
  const id = opened?.id ?? '';
  const session = () => {
    const found = store.getSnapshot().sessions[id];
    return options.held === true && found !== undefined ? { ...found, held: true as const } : found;
  };

  const body = (visible: boolean) => <TerminalBody sessions={sessions} session={session()} visible={visible} load={loader.load} screenReader={counted} {...(options.name === undefined ? {} : { name: options.name })} />;
  const ui = (visible: boolean) => (options.renaming === undefined ? body(visible) : <RenamingProvider renaming={options.renaming}>{body(visible)}</RenamingProvider>);
  const view = render(ui(options.visible ?? true));
  return {
    store,
    sessions,
    loader,
    feed,
    session,
    reader,
    readerListeners: () => readerHeard,
    show: (visible) => {
      view.rerender(ui(visible));
    },
    frame: async () => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  document.documentElement.removeAttribute('data-ov-theme');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

describe('a session with no feed', () => {
  it('says that its output is gone and how to get a shell again: a terminal restored from the last run has no process to draw', () => {
    const store = createPanelStore({ now: () => 1, newId: () => 's1' });
    store.registerTool(TERMINAL_TOOL);
    const sessions = createTerminalSessions(store);
    const restored: Session = { id: 'old', tool: 'terminal', plugin: HOST, title: 'Terminal', scope: '', state: 'ended', since: 1, cause: 'The session ended when the app restarted.' };
    render(<TerminalBody sessions={sessions} session={restored} visible screenReader={createScreenReaderChoice()} />);
    const status = within(page.getByRole('status'));
    expect(status.getByText(TERMINAL_GONE.title)).toBeInTheDocument();
    expect(status.getByText(TERMINAL_GONE.hint)).toBeInTheDocument();
    expect(status.queryByRole('button')).toBeNull();
    expect(page.queryByRole('toolbar')).toBeNull();
  });
});

describe('a session with a feed', () => {
  it('draws the toolbar (Find, Clear, Copy selection and Rename session), the screen and the lane, and loads no emulator while it is not on screen', async () => {
    const { loader } = mount({ visible: false });
    await flush();
    const toolbar = page.getByRole('toolbar', { name: 'Terminal tools' });
    expect(within(toolbar).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Find', 'Clear', 'Copy selection', 'Rename session']);
    expect(document.querySelector('[data-shell-part="terminalScreen"]')).not.toBeNull();
    expect(loader.loads()).toBe(0);
  });

  it('loads the emulator once it is shown, and opens it in the screen\'s own element', async () => {
    const { loader, show } = mount({ visible: false });
    show(true);
    await flush();
    expect(loader.loads()).toBe(1);
    expect(loader.engines[0]?.host()).toBe(document.querySelector('[data-shell-part="terminalScreen"]'));
  });

  it('shows and hides the emulator with the panel: hidden, the lane lets go of the feed and the screen of the GPU context, and the screen keeps reading the feed (a hidden session goes on parsing and acknowledging)', async () => {
    const { loader, feed, show } = mount();
    await flush();
    // The registry's own listener, the screen's, and the lane's.
    expect(feed.listeners()).toBe(3);
    const engine = loader.engines[0];
    show(false);
    await flush();
    expect(engine?.renderers.at(-1)).toBe('dom');
    expect(feed.listeners()).toBe(2);
    show(true);
    await flush();
    expect(engine?.renderers.at(-1)).toBe('gpu');
    expect(feed.listeners()).toBe(3);
    expect(loader.engines).toHaveLength(1);
  });

  it('disposes the emulator once, and lets go of its listener on the feed, when the body goes (its session closed)', async () => {
    const { loader, feed } = mount();
    await flush();
    // The registry's own listener, the screen's, and the lane's.
    expect(feed.listeners()).toBe(3);
    cleanup();
    expect(loader.engines[0]?.disposed()).toBe(1);
    // Only the registry's is left: it is the session's, and the session has not closed.
    expect(feed.listeners()).toBe(1);
  });

  it('names the terminal for assistive technology and says how to leave it: the shell keeps Escape and Tab, F6 moves on, and Command J hides the panel', async () => {
    const { loader } = mount();
    await flush();
    const [label, hintId] = loader.engines[0]?.labels[0] ?? ['', ''];
    expect(label).toBe('Terminal input, Terminal');
    const hint = document.getElementById(hintId);
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toMatch(/Escape and Tab go to the shell/);
    expect(hint?.textContent).toMatch(/F6/);
  });

  it('names the input again when the shell says its name and the tab is renamed: the label the emulator was given follows the title, and the description it points to stays the same', async () => {
    const { loader, feed, show, session } = mount({ retitle: true });
    await flush();
    const [first, hintId] = loader.engines[0]?.labels[0] ?? ['', ''];
    expect(first).toBe('Terminal input, Terminal');
    act(() => {
      feed.set({ program: 'zsh' });
    });
    expect(session().title).toBe('zsh');
    show(true);
    await flush();
    expect(loader.engines[0]?.labels.at(-1)).toEqual(['Terminal input, zsh', hintId]);
  });

  it('names the input as the tab is named when the panel gives the name: a twin is `zsh (2)`, and the input says which terminal it is', async () => {
    const { loader } = mount({ name: 'zsh (2)' });
    await flush();
    expect(loader.engines[0]?.labels[0]?.[0]).toBe('Terminal input, zsh (2)');
  });

  it('says in words, while screen reader mode is off, that the output is not read aloud until it is on and which command turns it on: the description the terminal\'s input points to', async () => {
    const { loader } = mount();
    await flush();
    const [, hintId] = loader.engines[0]?.labels[0] ?? ['', ''];
    const hint = document.getElementById(hintId)?.textContent ?? '';
    expect(hint).toMatch(/^Escape and Tab go to the shell\./);
    expect(hint).toContain('The output is not read aloud until screen reader mode is on.');
    expect(hint).toContain(SCREEN_READER_COMMAND);
  });

  it('says that it is on, that the output is read aloud and how to turn it off once the choice is on, and the first words again when it is off: one description whose words follow the choice', async () => {
    const { loader, reader } = mount();
    await flush();
    const [, hintId] = loader.engines[0]?.labels[0] ?? ['', ''];
    const hint = () => document.getElementById(hintId)?.textContent ?? '';
    act(() => {
      reader.set(true);
    });
    expect(hint()).toContain('Screen reader mode is on: the output is read aloud.');
    expect(hint()).toContain('To turn it off');
    expect(hint()).toContain(SCREEN_READER_COMMAND);
    expect(hint()).not.toContain('not read aloud');
    // The emulator was told which element describes it once: the element stays, its words change.
    expect(loader.engines[0]?.labels).toHaveLength(1);
    act(() => {
      reader.set(false);
    });
    expect(hint()).toContain('The output is not read aloud until screen reader mode is on.');
    expect(hint()).not.toContain('Screen reader mode is on');
  });

  it('makes the emulator in the mode the window has chosen, and says so: a terminal opened after the person chose reads aloud from its first line', async () => {
    const { loader } = mount({ screenReader: true });
    await flush();
    expect(loader.engines[0]?.options.screenReaderMode).toBe(true);
    expect(document.getElementById(loader.engines[0]?.labels[0]?.[1] ?? '')?.textContent).toContain('Screen reader mode is on');
  });

  it('hands a change of the choice to its emulator while it is on screen', async () => {
    const { loader, reader } = mount();
    await flush();
    act(() => {
      reader.toggle();
    });
    expect(loader.engines[0]?.screenReaderModes).toEqual([true]);
  });

  it('holds no listener on the choice while it is hidden, and has the choice made meanwhile when it is shown: its words and its emulator', async () => {
    const { loader, reader, readerListeners, show } = mount();
    await flush();
    expect(readerListeners()).toBeGreaterThanOrEqual(2);
    show(false);
    await flush();
    expect(readerListeners()).toBe(0);
    reader.set(true);
    expect(loader.engines[0]?.screenReaderModes).toEqual([]);
    show(true);
    await flush();
    expect(loader.engines[0]?.screenReaderModes).toEqual([true]);
    expect(document.getElementById(loader.engines[0]?.labels[0]?.[1] ?? '')?.textContent).toContain('Screen reader mode is on');
  });
});

describe('the lane', () => {
  it('is empty while the session runs', async () => {
    mount();
    await flush();
    expect(document.querySelector('[data-shell-part="terminalLane"]')?.textContent).toBe('');
  });

  it('says that the session is connecting', async () => {
    mount({ state: 'starting' });
    await flush();
    expect(page.getByRole('status')).toHaveTextContent('Connecting');
  });

  it('says in words that the terminal ended, that input is off and that its output stays readable, and how it ended when the producer told', async () => {
    const { feed } = mount();
    await flush();
    act(() => {
      feed.set({ state: 'ended' });
    });
    expect(page.getByRole('status')).toHaveTextContent('Ended');
    expect(page.getByRole('status')).toHaveTextContent('Input is off. Its output stays readable here.');
    act(() => {
      feed.set({ state: 'ended', exit: { code: 2 } });
    });
    expect(page.getByRole('status')).toHaveTextContent('Exited with code 2');
  });

  it('says what failed in the producer\'s words', async () => {
    const { feed } = mount();
    await flush();
    act(() => {
      feed.set({ state: 'failed', cause: { stage: 'session', message: 'The connection was closed' } });
    });
    expect(page.getByRole('status')).toHaveTextContent('Failed');
    expect(page.getByRole('status')).toHaveTextContent('The terminal stopped. The connection was closed.');
  });

  it('says that the page is taking the terminal back while its feed knows the shell but has not answered: a first start has no shell yet, and says that it is connecting', async () => {
    const { feed } = mount({ state: 'starting' });
    await flush();
    expect(page.getByRole('status')).toHaveTextContent('Connecting');
    act(() => {
      feed.set({ program: 'zsh' });
    });
    expect(page.getByRole('status')).toHaveTextContent('Reattaching');
    expect(page.getByRole('status')).not.toHaveTextContent('Connecting');
  });

  it('says in words that the terminal was taken over by another tab and that input is off, keeps the emulator\'s input off, and writes the same words as the last line of the transcript', async () => {
    const words = 'Taken over by another tab';
    const { feed, loader, frame } = mount();
    await flush();
    act(() => {
      feed.set({ state: 'ended', detached: { by: 'taken-over' } });
    });
    expect(page.getByRole('status')).toHaveTextContent(words);
    expect(page.getByRole('status')).toHaveTextContent('Input is off. The shell keeps running in the tab that took it.');
    expect(loader.engines[0]?.inputs.at(-1)).toBe(false);
    await frame();
    expect(loader.engines[0]?.text()).toContain(`[${words}]`);
  });

  it('says that no tab took the terminal back in time when its lease ran out, also when this page had lost it before, and writes both into the transcript', async () => {
    const { feed, loader, frame } = mount();
    await flush();
    act(() => {
      feed.set({ state: 'ended', detached: { by: 'taken-over' } });
    });
    await frame();
    act(() => {
      feed.set({ exit: { closedBy: 'detach-timeout' } });
    });
    expect(page.getByRole('status')).toHaveTextContent('Closed: no tab took it back in time');
    expect(page.getByRole('status')).toHaveTextContent('Input is off. Its output stays readable here.');
    await frame();
    const text = loader.engines[0]?.text() ?? '';
    expect(text).toContain('[Taken over by another tab]');
    expect(text).toContain('[Process closed: no tab took it back in time]');
  });

  it('says that the emulator could not load, and what the person can do: the terminal view is the one thing that loads late', async () => {
    const report = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createPanelStore({ now: () => 1, newId: () => 's1' });
    store.registerTool(TERMINAL_TOOL);
    const sessions = createTerminalSessions(store);
    const feed = fakeTerminalFeed();
    const opened = sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => feed });
    const loader = fakeEngineLoader({ deferred: true });
    render(<TerminalBody sessions={sessions} session={store.getSnapshot().sessions[opened?.id ?? '']} visible load={loader.load} screenReader={createScreenReaderChoice()} />);
    await flush();
    loader.fail(new Error('Failed to fetch'));
    await flush();
    expect(page.getByRole('status')).toHaveTextContent('The terminal view could not be loaded. Failed to fetch.');
    expect(report).toHaveBeenCalledExactlyOnceWith('[terminal] the terminal view could not be loaded', expect.any(Error));
    report.mockRestore();
  });
});

describe('the toolbar', () => {
  it('clears the emulator', async () => {
    const { loader } = mount();
    await flush();
    act(() => {
      page.getByRole('button', { name: 'Clear' }).click();
    });
    expect(loader.engines[0]?.clears()).toBe(1);
  });

  it('asks the panel to rename the tab of its session when Rename session is pressed (the mock\'s S117 table), and gives the keyboard to the field the tab draws', async () => {
    const request = vi.fn();
    const renaming: Renaming = { current: () => null, request, clear: vi.fn(), subscribe: () => () => undefined };
    const { session } = mount({ renaming });
    await flush();
    const button = page.getByRole('button', { name: 'Rename session' });
    expect(button).not.toHaveAttribute('aria-disabled');
    act(() => {
      button.click();
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(session().id);
  });

  it('cannot rename a session its plugin left behind, with the words of the tab\'s menu, and asks nobody', async () => {
    const request = vi.fn();
    const renaming: Renaming = { current: () => null, request, clear: vi.fn(), subscribe: () => () => undefined };
    mount({ renaming, held: true });
    await flush();
    const button = page.getByRole('button', { name: 'Rename session' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('The plugin was unloaded: this session stays as it is until it is closed.');
    act(() => {
      button.click();
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('cannot rename where there is no tab to draw the field in, says why, and stays reachable', async () => {
    mount();
    await flush();
    const button = page.getByRole('button', { name: 'Rename session' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('The session\'s tab is not on screen');
  });

  it('cannot copy before something is selected, says why, and stays reachable', async () => {
    const { loader } = mount();
    await flush();
    const copy = page.getByRole('button', { name: 'Copy selection' });
    expect(copy).toHaveAttribute('aria-disabled', 'true');
    expect(copy).toHaveAccessibleDescription('Select text in the terminal first');
    act(() => {
      loader.engines[0]?.select('hello');
    });
    expect(page.getByRole('button', { name: 'Copy selection' })).not.toHaveAttribute('aria-disabled');
  });

  it('copies the selection, confirms itself with a check for two seconds, and says so to a person who cannot see it', async () => {
    const write = vi.fn(async () => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: write }, platform: 'MacIntel' });
    const { loader } = mount();
    await flush();
    act(() => {
      loader.engines[0]?.select('hello');
    });
    await act(async () => {
      page.getByRole('button', { name: 'Copy selection' }).click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(write).toHaveBeenCalledWith('hello');
    expect(document.querySelector('[data-terminal-tool="copy"]')?.getAttribute('data-ov-icon') ?? document.querySelector('[data-terminal-tool="copy"] svg')).toBeTruthy();
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Selection copied');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    vi.unstubAllGlobals();
  });
});

describe('the keyboard', () => {
  const free = () => {
    (document.activeElement as HTMLElement | null)?.blur();
  };

  it('goes into the terminal of a session the user started, once, when it is running and the focus is nowhere in particular: the person pressed New terminal and types', async () => {
    free();
    const { loader } = mount({ focus: true });
    await flush();
    expect(loader.engines[0]?.focuses()).toBe(1);
    await flush();
    expect(loader.engines[0]?.focuses()).toBe(1);
  });

  it('waits for the session to leave Connecting: the request is kept until the process is there (S116a)', async () => {
    free();
    const { loader, feed } = mount({ focus: true, state: 'starting' });
    await flush();
    expect(loader.engines[0]?.focuses()).toBe(0);
    act(() => {
      feed.set({ state: 'running' });
    });
    await flush();
    expect(loader.engines[0]?.focuses()).toBe(1);
  });

  it('does not take it from a person who went somewhere else in the meantime: a field outside the panel keeps it', async () => {
    const field = document.createElement('input');
    document.body.append(field);
    field.focus();
    const { loader } = mount({ focus: true });
    await flush();
    expect(loader.engines[0]?.focuses()).toBe(0);
    field.remove();
  });

  it('does not take it for a session the user did not start: a restored or adopted terminal never takes the keyboard', async () => {
    free();
    const { loader } = mount({ focus: false });
    await flush();
    expect(loader.engines[0]?.focuses()).toBe(0);
  });
});

describe('the look', () => {
  it('is read from the swatches when the emulator is made, and again when the theme changes: the terminal follows the nine themes with no colour written in code', async () => {
    const { loader } = mount();
    await flush();
    const engine = loader.engines[0];
    expect(engine?.options.appearance.fontSize).toBeGreaterThan(0);
    expect(engine?.appearances).toHaveLength(0);
    act(() => {
      document.documentElement.setAttribute('data-ov-theme', 'light');
    });
    await flush();
    expect(engine?.appearances.length).toBeGreaterThanOrEqual(1);
    expect(loader.engines).toHaveLength(1);
  });

  it('renders one swatch for every colour the screen needs, hidden from everything', async () => {
    mount();
    await flush();
    const swatches = document.querySelectorAll('[data-swatch]');
    expect(swatches.length).toBe(23);
    expect(swatches[0]?.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

// The feed of a session, and Take it back (T2d). The registry owns the feed of each session and may change which feed a session has: it adopts a terminal that came back after a reload (the body of the saved tab rendered before it
// did), it swaps the feed for a fresh attach feed when the person takes the terminal back, and it lets it go. It says so to those who subscribed (`subscribeFeeds`), and the body follows it: a NEW feed object for the same session is
// a NEW screen, the old one disposed with its emulator, and the new feed's replay is applied on a fresh emulator as at a reload; a session with no feed says that the earlier output is gone. The lane offers the way back for a terminal
// whose taker has gone: a button at its right, drawn only when the registry says the terminal can be taken back, that asks the registry to take it (`takeBack`), and the keyboard goes into the new screen when it is ready, because the
// person pressed a control there. Against the real panel store, a registry whose feeds, `takeBack` and `canTakeBack` are the test's, and a fake emulator.

type Registry = {
  readonly store: PanelStore;
  readonly loader: FakeEngineLoader;
  /** The feed the session was opened with (for a registry that holds none yet, the one `adopt` gives it). */
  readonly feed: FakeTerminalFeed;
  readonly id: string;
  /** What `canTakeBack` answers now. */
  readonly allow: (on: boolean) => void;
  /** The ids `takeBack` was called with, in order. */
  readonly pressed: readonly string[];
  /** The registry adopts `feed` for the session it held none for: the saved tab of a terminal that came back after a reload. */
  readonly adopt: () => void;
  /** The registry replaces the session's feed by another one, by itself (not because of a press). */
  readonly swap: (next: FakeTerminalFeed) => void;
  /** The registry lets go of the session's feed. */
  readonly release: () => void;
  /**
   * The registry answers the press that `hold` kept waiting: `true` is its swap of the session's feed for `next` and its word that it made one, `false` is its word that the press left the feed as it was. It resolves when the
   * body has been given the answer.
   */
  readonly answer: (swapped: boolean) => Promise<void>;
  /** How many listeners the body has on the registry's feeds now (`subscribeFeeds`). */
  readonly feedListeners: () => number;
};

/**
 * The body in a harness that re-renders it as the panel does, from the store, over a registry that holds a feed for the session (none, with `none`: the saved tab of a terminal that came back) and answers `canTakeBack` as told.
 * Every change of the session's feed is said to the subscribers of `subscribeFeeds` and the status of a new feed is copied to the session, as the registry does; `silent` leaves the copy out, so that nothing but the registry's
 * word of the change tells the body. A press calls `takeBack`, which swaps in `next` when there is one and answers whether it did (`Promise<boolean>`); with `hold` it swaps and answers only when the test says (`answer`).
 */
function mountRegistry(options: { readonly next?: FakeTerminalFeed; readonly silent?: boolean; readonly none?: boolean; readonly hold?: boolean } = {}): Registry {
  counter = 0;
  const store = createPanelStore({ now: () => 1_000, newId: () => `s${String(++counter)}` });
  store.registerTool(TERMINAL_TOOL);
  const base = createTerminalSessions(store, { newId: () => `term-${String(++counter)}` });
  base.attach();
  const feed = fakeTerminalFeed({ state: 'running' });
  const loader = fakeEngineLoader();
  const reader = createScreenReaderChoice();
  let id = '';
  if (options.none === true) {
    const saved = store.openSession({ tool: TERMINAL_TOOL_ID, plugin: HOST, title: 'Terminal', state: 'ended', cause: 'The session ended when the app restarted.' });
    id = saved.status === 'refused' ? '' : saved.id;
  } else {
    id = base.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => feed })?.id ?? '';
  }

  let current: TerminalFeedHandle | undefined = options.none === true ? undefined : feed;
  let takeable = false;
  const pressed: string[] = [];
  const listeners = new Set<() => void>();
  /** The registry changed which feed the session has: the subscribers are told, and the new feed's status is the session's. */
  const changed = (copy: boolean) => {
    takeable = false;
    act(() => {
      if (copy && current !== undefined) {
        store.setSessionState(id, sessionStateOf(current.getSnapshot()));
      }

      for (const listener of [...listeners]) {
        listener();
      }
    });
  };

  /** What a press does: the registry swaps in `next` when there is one, and says whether it did. */
  const take = (): boolean => {
    if (options.next === undefined) {
      return false;
    }

    current = options.next;
    changed(options.silent !== true);
    return true;
  };

  let answering: PromiseWithResolvers<boolean> | undefined;

  const sessions: TerminalSessions = {
    ...base,
    feedOf: (session) => (session === id ? current : base.feedOf(session)),
    subscribeFeeds: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    canTakeBack: () => takeable,
    takeBack: async (session) => {
      pressed.push(session);
      if (options.hold === true) {
        answering = Promise.withResolvers<boolean>();
        return answering.promise;
      }

      return take();
    },
  };
  function Harness() {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const session = state.sessions[id];
    return session === undefined ? null : <TerminalBody sessions={sessions} session={session} visible load={loader.load} screenReader={reader} />;
  }

  render(<Harness />);
  return {
    store,
    loader,
    feed,
    id,
    allow: (on) => {
      takeable = on;
    },
    pressed,
    adopt: () => {
      current = feed;
      changed(options.silent !== true);
    },
    swap: (next) => {
      current = next;
      changed(options.silent !== true);
    },
    release: () => {
      current = undefined;
      changed(false);
    },
    answer: async (swapped) => {
      if (swapped) {
        take();
      }

      await act(async () => {
        answering?.resolve(swapped);
        await Promise.resolve();
      });
    },
    feedListeners: () => listeners.size,
  };
}

/** What the host says when the tab that took the terminal has closed: this page lost it to that tab, and nobody holds it now. */
const FREE: Partial<TerminalFeedSnapshot> = { state: 'ended', detached: { by: 'taken-over', free: true } };

const NO_MODES = { altScreen: false, bracketedPaste: false, applicationCursor: false, focusEvents: false, cursorHidden: false, mouseTracking: 0, mouseEncoding: 0, kittyKeyboard: [] };

/** The feed the registry swaps in after a press: a terminal the page is taking back, which knows its shell before the host has answered, and holds the replay it brings. */
const attaching = (): FakeTerminalFeed => {
  const kept = new TextEncoder().encode('kept\r\n');
  const next = fakeTerminalFeed({ state: 'starting', replay: { data: kept, startSize: { cols: 80, rows: 24 }, startModes: NO_MODES, size: { cols: 80, rows: 24 }, modes: NO_MODES, end: kept.length } });
  next.set({ program: 'zsh' });
  return next;
};

const TAKE_BACK = { name: 'Take it back' } as const;

describe('the lane\'s Take it back', () => {
  it('is not drawn while the registry says the terminal cannot be taken back: not for a terminal that runs, nor for one another tab still holds', async () => {
    const { feed } = mountRegistry();
    await flush();
    expect(page.queryByRole('button', TAKE_BACK)).toBeNull();
    act(() => {
      feed.set({ state: 'ended', detached: { by: 'taken-over' } });
    });
    expect(page.getByRole('status')).toHaveTextContent('Taken over by another tab');
    expect(page.queryByRole('button', TAKE_BACK)).toBeNull();
  });

  it('is not drawn while the tab that took the terminal still lives, whatever the registry says: beside "Taken over by another tab" there is no button, and it comes when the taker has gone (`free`)', async () => {
    const { feed, allow } = mountRegistry();
    await flush();
    allow(true);
    act(() => {
      feed.set({ state: 'ended', detached: { by: 'taken-over' } });
    });
    expect(page.getByRole('status')).toHaveTextContent('Taken over by another tab');
    expect(page.queryByRole('button', TAKE_BACK)).toBeNull();
    act(() => {
      feed.set({ detached: { by: 'taken-over', free: false } });
    });
    expect(page.queryByRole('button', TAKE_BACK)).toBeNull();
    act(() => {
      feed.set({ detached: { by: 'taken-over', free: true } });
    });
    expect(page.getByRole('status')).toHaveTextContent('The tab that took this terminal has closed.');
    expect(page.getByRole('button', TAKE_BACK)).toBeInTheDocument();
  });

  it('says in the lane that the tab that took the terminal has closed, and that the shell keeps running until its lease ends, and draws the button after those words, inside the lane', async () => {
    const { feed, allow } = mountRegistry();
    await flush();
    allow(true);
    act(() => {
      feed.set(FREE);
    });
    const lane = page.getByRole('status');
    expect(lane).toHaveTextContent('The tab that took this terminal has closed. The shell keeps running until its lease ends.');
    expect(lane).toBe(document.querySelector('[data-shell-part="terminalLane"]'));
    const button = within(lane).getByRole('button', TAKE_BACK);
    expect(button.tagName).toBe('BUTTON');
    // The words and the note come first, and the button is the last thing in the lane, at its end.
    const words = within(lane).getByText('The tab that took this terminal has closed.');
    expect(words.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(lane.lastElementChild?.contains(button)).toBe(true);
  });

  it('is drawn only while the registry says so, and follows it as the feed\'s status changes: it comes when the terminal can be taken back, and goes when the registry no longer says so', async () => {
    const { feed, allow } = mountRegistry();
    await flush();
    act(() => {
      feed.set(FREE);
    });
    expect(page.queryByRole('button', TAKE_BACK)).toBeNull();
    allow(true);
    act(() => {
      feed.set({ ...FREE });
    });
    expect(page.getByRole('button', TAKE_BACK)).toBeInTheDocument();
    // The lease runs out: the terminal is over, the registry can no longer take it back, and the lane says how it ended.
    allow(false);
    act(() => {
      feed.set({ exit: { closedBy: 'detach-timeout' } });
    });
    expect(page.queryByRole('button', TAKE_BACK)).toBeNull();
    expect(page.getByRole('status')).toHaveTextContent('Closed: no tab took it back in time');
  });

  it('is the only lane: one status, with its words and the button in it, so the lane is one row', async () => {
    const { feed, allow } = mountRegistry();
    await flush();
    allow(true);
    act(() => {
      feed.set(FREE);
    });
    expect(page.getAllByRole('status')).toHaveLength(1);
    expect(document.querySelectorAll('[data-shell-part="terminalLane"]')).toHaveLength(1);
    expect(within(page.getByRole('status')).getAllByRole('button')).toHaveLength(1);
  });

  it('asks the registry to take the terminal back, for the session of the body, once for a press', async () => {
    const { feed, allow, pressed, id } = mountRegistry();
    await flush();
    allow(true);
    act(() => {
      feed.set(FREE);
    });
    expect(pressed).toEqual([]);
    act(() => {
      page.getByRole('button', TAKE_BACK).click();
    });
    expect(pressed).toEqual([id]);
  });

  it('is a real button that Tab reaches, and Enter and Space press: the keys of every control', async () => {
    // The keyboard library and the testing library wait on timers of their own: this test runs on the real clock.
    vi.useRealTimers();
    const user = userEvent.setup();
    const { feed, allow, pressed, id } = mountRegistry();
    allow(true);
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      feed.set(FREE);
    });
    const button = page.getByRole('button', TAKE_BACK);
    expect(button.tabIndex).toBe(0);
    expect(button).not.toHaveAttribute('aria-disabled');
    for (let tabs = 0; tabs < 8 && document.activeElement !== button; tabs += 1) {
      await user.tab();
    }

    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    expect(pressed).toEqual([id]);
    await user.keyboard(' ');
    expect(pressed).toEqual([id, id]);
  });

  describe('after the press, when the registry swaps the session\'s feed for a fresh attach feed', () => {
    /** A registry that holds a terminal this page can take back, with the body drawn. */
    async function freed(options: Parameters<typeof mountRegistry>[0] = { next: attaching() }): Promise<Registry & { readonly next: FakeTerminalFeed }> {
      const r = mountRegistry(options);
      await flush();
      r.allow(true);
      act(() => {
        r.feed.set(FREE);
      });
      return { ...r, next: options.next ?? attaching() };
    }

    const press = async () => {
      act(() => {
        page.getByRole('button', TAKE_BACK).click();
      });
      await flush();
    };

    it('follows the replaced feed with a NEW screen: the old one is disposed, its emulator is thrown away, and the new feed\'s replay is applied on a fresh emulator as at a reload', async () => {
      const { loader, next } = await freed();
      expect(loader.engines).toHaveLength(1);
      const old = loader.engines[0];
      const oldHost = old?.host();
      await press();
      expect(loader.engines).toHaveLength(2);
      expect(old?.disposed()).toBe(1);
      expect(oldHost?.isConnected).toBe(false);
      const fresh = loader.engines[1];
      expect(fresh?.host()).not.toBe(oldHost);
      expect(fresh?.host()?.isConnected).toBe(true);
      expect(fresh?.disposed()).toBe(0);
      // The new screen draws in its next frame: the replay is taken then, and written on the fresh emulator before anything else.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });
      expect(next.replayTaken()).toBe(true);
      expect(fresh?.text()).toBe('\u001bc\u001b[?47h\u001b[?47lkept\r\n');
    });

    it('says Reattaching in the lane, with no button: the terminal is being taken back, and what is asked is done', async () => {
      await freed();
      await press();
      expect(page.getByRole('status')).toHaveTextContent('Reattaching');
      expect(page.queryByRole('button', TAKE_BACK)).toBeNull();
    });

    it('lets go of the old feed and listens to the new one: the screen and the lane are on the new feed alone', async () => {
      const { feed, next } = await freed();
      await press();
      // The old feed has the registry's own listener, which the registry lets go of, and nothing of the body.
      expect(feed.listeners()).toBe(1);
      // The new feed has the screen's listener and the lane's.
      expect(next.listeners()).toBeGreaterThanOrEqual(2);
    });

    it('puts the keyboard in the new screen when it is ready, once, because the person pressed a control there: the same rule as for a session the person started', async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      const { loader, next } = await freed();
      await press();
      const fresh = loader.engines[1];
      expect(fresh?.focuses()).toBe(0);
      act(() => {
        next.set({ state: 'running' });
      });
      await flush();
      expect(fresh?.focuses()).toBe(1);
      await flush();
      expect(fresh?.focuses()).toBe(1);
      expect(loader.engines[0]?.focuses()).toBe(0);
    });

    it('does not take the keyboard from a person who went to a field outside the panel meanwhile', async () => {
      const field = document.createElement('input');
      document.body.append(field);
      const { loader, next } = await freed();
      await press();
      field.focus();
      act(() => {
        next.set({ state: 'running' });
      });
      await flush();
      expect(loader.engines[1]?.focuses()).toBe(0);
      field.remove();
    });

    it('does not take the keyboard for a feed the registry swapped in by itself: nobody pressed anything', async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      const { loader, swap } = mountRegistry();
      await flush();
      const other = attaching();
      swap(other);
      await flush();
      expect(loader.engines).toHaveLength(2);
      act(() => {
        other.set({ state: 'running' });
      });
      await flush();
      expect(loader.engines[1]?.focuses()).toBe(0);
    });

    it('follows a swap that the registry announces to the subscribers of its feeds alone, with no change in the panel\'s store: the body does not wait for the panel to render it again', async () => {
      const { loader } = await freed({ next: attaching(), silent: true });
      await press();
      expect(loader.engines).toHaveLength(2);
      expect(loader.engines[0]?.disposed()).toBe(1);
    });

    describe('when the registry answers the press: whether it swapped the session\'s feed', () => {
      it('forgets the request for the keyboard when the registry answers that the press left the feed as it was: a feed the registry swaps in later, by itself, is not given the keyboard', async () => {
        (document.activeElement as HTMLElement | null)?.blur();
        const r = await freed({ hold: true });
        await press();
        expect(r.pressed).toEqual([r.id]);
        await r.answer(false);
        const other = attaching();
        r.swap(other);
        await flush();
        expect(r.loader.engines).toHaveLength(2);
        act(() => {
          other.set({ state: 'running' });
        });
        await flush();
        expect(r.loader.engines[1]?.focuses()).toBe(0);
      });

      it('keeps the request for the keyboard while the answer is not in, and when it is yes: the new screen takes the keyboard when it is ready', async () => {
        (document.activeElement as HTMLElement | null)?.blur();
        const r = await freed({ next: attaching(), hold: true });
        await press();
        expect(r.loader.engines).toHaveLength(1);
        await r.answer(true);
        expect(r.loader.engines).toHaveLength(2);
        expect(r.loader.engines[1]?.focuses()).toBe(0);
        act(() => {
          r.next.set({ state: 'running' });
        });
        await flush();
        expect(r.loader.engines[1]?.focuses()).toBe(1);
      });

      it('leaves the keyboard where the person has it when the answer is no: nothing is focused for the press, and the field they went to meanwhile keeps it', async () => {
        const field = document.createElement('input');
        document.body.append(field);
        const r = await freed({ hold: true });
        await press();
        field.focus();
        await r.answer(false);
        expect(document.activeElement).toBe(field);
        expect(r.loader.engines[0]?.focuses()).toBe(0);
        field.remove();
      });
    });
  });
});

describe('the feed of a session, as the registry holds it (the body follows the registry: it is not read once)', () => {
  it('says that the earlier output is gone while the registry holds no feed for the session, and starts the screen when the registry adopts one: a body that rendered before the registry had adopted the terminal', async () => {
    const { loader, adopt, feed } = mountRegistry({ none: true });
    await flush();
    expect(page.getByText(TERMINAL_GONE.title)).toBeInTheDocument();
    expect(page.queryByRole('toolbar', { name: 'Terminal tools' })).toBeNull();
    expect(loader.loads()).toBe(0);
    adopt();
    await flush();
    expect(page.queryByText(TERMINAL_GONE.title)).toBeNull();
    expect(page.getByRole('toolbar', { name: 'Terminal tools' })).toBeInTheDocument();
    expect(loader.loads()).toBe(1);
    expect(loader.engines).toHaveLength(1);
    expect(loader.engines[0]?.host()).toBe(document.querySelector('[data-shell-part="terminalScreen"]'));
    // The screen is on the feed that was adopted: it listens to it, and what it holds is drawn.
    expect(feed.listeners()).toBeGreaterThanOrEqual(2);
    feed.push('prompt $ ');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(loader.engines[0]?.text()).toBe('prompt $ ');
  });

  it('starts the screen when the registry adopts a feed with no change in the panel\'s store: the registry\'s word of the change is enough', async () => {
    const { loader, adopt } = mountRegistry({ none: true, silent: true });
    await flush();
    expect(page.getByText(TERMINAL_GONE.title)).toBeInTheDocument();
    adopt();
    await flush();
    expect(page.queryByText(TERMINAL_GONE.title)).toBeNull();
    expect(loader.engines).toHaveLength(1);
  });

  it('makes a second screen when the registry replaces the feed of the session with another, and disposes the first with its emulator: a new feed object for the same session is a new screen, and the first feed is let go of', async () => {
    const { loader, feed, swap } = mountRegistry();
    await flush();
    expect(loader.engines).toHaveLength(1);
    const first = loader.engines[0];
    const firstHost = first?.host();
    const other = attaching();
    swap(other);
    await flush();
    expect(loader.engines).toHaveLength(2);
    expect(first?.disposed()).toBe(1);
    expect(firstHost?.isConnected).toBe(false);
    expect(loader.engines[1]?.host()).not.toBe(firstHost);
    expect(loader.engines[1]?.disposed()).toBe(0);
    // The old feed keeps the registry's own listener and nothing of the body; the new one has the screen's and the lane's.
    expect(feed.listeners()).toBe(1);
    expect(other.listeners()).toBeGreaterThanOrEqual(2);
    // The new feed's replay is applied on the fresh emulator, as at a reload.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(other.replayTaken()).toBe(true);
    expect(loader.engines[1]?.text()).toBe('\u001bc\u001b[?47h\u001b[?47lkept\r\n');
  });

  it('keeps the screen it has while the registry answers with the same feed again: the screen is made for a feed, not for a render', async () => {
    const { loader, feed, swap } = mountRegistry();
    await flush();
    swap(feed);
    await flush();
    expect(loader.engines).toHaveLength(1);
    expect(loader.engines[0]?.disposed()).toBe(0);
  });

  it('says that the earlier output is gone again when the registry lets go of the feed, and disposes the screen with its emulator', async () => {
    const { loader, release } = mountRegistry();
    await flush();
    expect(loader.engines).toHaveLength(1);
    release();
    await flush();
    expect(page.getByText(TERMINAL_GONE.title)).toBeInTheDocument();
    expect(page.queryByRole('toolbar', { name: 'Terminal tools' })).toBeNull();
    expect(loader.engines[0]?.disposed()).toBe(1);
  });

  it('makes a new screen for a feed that comes back after the registry let go of it: A, nothing, B', async () => {
    const { loader, release, swap } = mountRegistry();
    await flush();
    release();
    await flush();
    swap(attaching());
    await flush();
    expect(loader.engines).toHaveLength(2);
    expect(loader.engines[0]?.disposed()).toBe(1);
    expect(loader.engines[1]?.disposed()).toBe(0);
    expect(page.queryByText(TERMINAL_GONE.title)).toBeNull();
  });

  it('listens to the registry\'s feeds while it is mounted, once, and lets go of it when it goes: no listener is left on the registry', async () => {
    const { feedListeners } = mountRegistry();
    await flush();
    expect(feedListeners()).toBe(1);
    cleanup();
    expect(feedListeners()).toBe(0);
  });
});

// Step 5 of #695: restart an ended terminal. The lane of a session whose terminal is over for good (the producer says a restart can be made from it) offers Restart, and Enter in the screen is its key. A press puts a new feed in the SAME
// session through the registry, and the screen goes on with it: the same emulator, so the transcript of the ended terminal stays above the new shell. Against the real registry and a fake emulator.

const RESTART = { name: 'Restart' } as const;

type Restartable = {
  readonly store: PanelStore;
  readonly sessions: TerminalSessions;
  readonly loader: FakeEngineLoader;
  readonly old: FakeTerminalFeed;
  readonly fresh: FakeTerminalFeed;
  readonly id: string;
  readonly asked: ReadonlyArray<readonly [TerminalRestart, string]>;
  /** The terminal's process is over for good, as the producer says it. */
  readonly end: (patch?: Partial<TerminalFeedSnapshot>) => void;
};

async function mountRestartable(): Promise<Restartable> {
  counter = 0;
  const store = createPanelStore({ now: () => 1_000, newId: () => `s${String(++counter)}` });
  store.registerTool(TERMINAL_TOOL);
  const fresh = fakeTerminalFeed({ state: 'starting' });
  const asked: Array<readonly [TerminalRestart, string]> = [];
  const spec: TerminalRestart = { id: 'term-old', command: ['/bin/zsh'], cwd: '/work' };
  const sessions = createTerminalSessions(store, {
    newId: () => `term-${String(++counter)}`,
    restart: (made, session) => {
      asked.push([made, session]);
      return { plugin: HOST, id: 'local', title: 'Terminal', sessionId: session, open: () => fresh };
    },
  });
  sessions.attach();
  let over = false;
  const old = fakeTerminalFeed({ state: 'running', restart: () => (over ? spec : undefined) });
  const loader = fakeEngineLoader();
  const reader = createScreenReaderChoice();
  const id = sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => old })?.id ?? '';
  function Harness() {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const session = state.sessions[id];
    return session === undefined ? null : <TerminalBody sessions={sessions} session={session} visible load={loader.load} screenReader={reader} />;
  }

  render(<Harness />);
  await flush();
  return {
    store,
    sessions,
    loader,
    old,
    fresh,
    id,
    asked,
    end: (patch = {}) => {
      over = true;
      act(() => {
        old.set({ state: 'ended', exit: { code: 0 }, ...patch });
      });
    },
  };
}

describe('the lane\'s Restart', () => {
  it('is not drawn while the terminal runs, and is drawn once the producer says its process is over for good: a button at the end of the lane, after the words of how it ended', async () => {
    const r = await mountRestartable();
    expect(page.queryByRole('button', RESTART)).toBeNull();
    r.end({ exit: { code: 3 } });
    const lane = page.getByRole('status');
    expect(lane).toHaveTextContent('Exited with code 3');
    const button = within(lane).queryByRole('button', RESTART);
    expect(button).toBeInTheDocument();
    expect(lane.lastElementChild?.contains(button)).toBe(true);
  });

  it('is not drawn for an ended terminal the producer says nothing of a restart for: a terminal another tab took, or whose connection was lost', async () => {
    const r = await mountRestartable();
    act(() => {
      r.old.set({ state: 'ended', detached: { by: 'taken-over' } });
    });
    expect(page.queryByRole('button', RESTART)).toBeNull();
    act(() => {
      r.old.set({ state: 'failed', cause: { stage: 'session', message: 'The connection to the terminal was lost.' } });
    });
    expect(page.queryByRole('button', RESTART)).toBeNull();
  });

  it('is drawn for a failed session whose process is over (a pty that failed) and the lane says why it stopped', async () => {
    const r = await mountRestartable();
    r.end({ state: 'failed', exit: undefined, cause: { stage: 'session', message: 'input/output error' } });
    expect(page.getByRole('status')).toHaveTextContent('input/output error');
    expect(page.queryByRole('button', RESTART)).toBeInTheDocument();
  });

  it('puts a new feed in the same session when pressed, and the screen goes on with it: the same emulator, and the transcript of the ended terminal stays above the new shell', async () => {
    const r = await mountRestartable();
    r.old.push('bye\r\n');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    r.end({ exit: { code: 3 } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    act(() => {
      page.queryByRole('button', RESTART)?.click();
    });
    await flush();
    expect(r.asked).toEqual([[{ id: 'term-old', command: ['/bin/zsh'], cwd: '/work' }, r.id]]);
    expect(r.sessions.feedOf(r.id)).toBe(r.fresh);
    expect(r.loader.engines).toHaveLength(1);
    expect(r.loader.engines[0]?.disposed()).toBe(0);
    act(() => {
      r.fresh.set({ state: 'running', program: 'zsh' });
      r.fresh.push('$ ');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(r.loader.engines[0]?.text()).toBe('bye\r\n\u001b[0m\r\n\u001b[90m[Process exited with code 3]\u001b[0m\r\n\u001b[!p\u001b[?1049l\u001b[0m\r\n\u001b[90m[Restarted]\u001b[0m\r\n$ ');
  });

  it('is the lane of the new feed afterwards: no button while the new shell starts or runs, and Connected when it does', async () => {
    const r = await mountRestartable();
    r.end();
    act(() => {
      page.queryByRole('button', RESTART)?.click();
    });
    await flush();
    expect(page.queryByRole('button', RESTART)).toBeNull();
    expect(page.getByRole('status')).toHaveTextContent('Connecting');
    act(() => {
      r.fresh.set({ state: 'running' });
    });
    expect(page.queryByRole('button', RESTART)).toBeNull();
    expect(page.getByRole('status').textContent).toBe('');
  });

  it('leaves the ended feed and listens to the new one alone, and the new feed is told the size of the screen so that it starts', async () => {
    const r = await mountRestartable();
    r.end();
    act(() => {
      page.queryByRole('button', RESTART)?.click();
    });
    await flush();
    expect(r.old.listeners()).toBe(0);
    expect(r.old.closed()).toBe(1);
    expect(r.fresh.sizes()).toEqual([[80, 24]]);
  });

  it('puts the keyboard in the screen when the new shell runs, once, because the person pressed a control there', async () => {
    (document.activeElement as HTMLElement | null)?.blur();
    const r = await mountRestartable();
    r.end();
    act(() => {
      page.queryByRole('button', RESTART)?.click();
    });
    await flush();
    expect(r.loader.engines[0]?.focuses()).toBe(0);
    act(() => {
      r.fresh.set({ state: 'running' });
    });
    await flush();
    expect(r.loader.engines[0]?.focuses()).toBe(1);
  });

  it('says why a restart that the host refused could not start, in the lane and in the transcript, and offers no second Restart: the same request would be refused the same way', async () => {
    const r = await mountRestartable();
    r.end();
    act(() => {
      page.queryByRole('button', RESTART)?.click();
    });
    await flush();
    act(() => {
      r.fresh.set({ state: 'failed', cause: { stage: 'start', message: 'No shell could be started.', code: 'SHELL_UNAVAILABLE' } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(page.getByRole('status')).toHaveTextContent('Failed to start');
    expect(page.queryByRole('button', RESTART)).toBeNull();
    expect(r.loader.engines[0]?.text()).toContain('[No shell could be started]');
  });

  it('says that the terminal started in the home directory because the one it started in was removed, and that another shell started because the shell was gone', async () => {
    const r = await mountRestartable();
    r.end();
    act(() => {
      page.queryByRole('button', RESTART)?.click();
    });
    await flush();
    act(() => {
      r.fresh.set({ state: 'running', startNote: 'home-for-removed-directory' });
    });
    expect(page.getByRole('status')).toHaveTextContent('Started in your home directory');
    expect(page.getByRole('status')).toHaveTextContent('The directory it started in is gone.');
    act(() => {
      r.fresh.set({ startNote: 'shell-replaced' });
    });
    expect(page.getByRole('status')).toHaveTextContent('Started another shell');
    expect(page.getByRole('status')).toHaveTextContent('The shell it ran before is not available.');
  });
});

describe('Enter in the screen of an ended terminal', () => {
  const ENTER = { key: 'Enter', code: 'Enter', keyCode: 13 } as const;

  it('restarts the session when its process is over for good: the key of Restart', async () => {
    const r = await mountRestartable();
    r.end();
    const engine = r.loader.engines[0];
    expect(engine?.key(ENTER)).toEqual({ handled: false, defaultPrevented: true });
    await flush();
    expect(r.sessions.feedOf(r.id)).toBe(r.fresh);
    expect(r.asked).toHaveLength(1);
  });

  it('is the shell\'s while it runs: Enter reaches the terminal and nothing restarts', async () => {
    const r = await mountRestartable();
    expect(r.loader.engines[0]?.key(ENTER)).toEqual({ handled: true, defaultPrevented: false });
    expect(r.asked).toEqual([]);
  });

  it('does nothing for an ended terminal the producer says nothing of a restart for: it is what it was', async () => {
    const r = await mountRestartable();
    act(() => {
      r.old.set({ state: 'ended', detached: { by: 'taken-over' } });
    });
    expect(r.loader.engines[0]?.key(ENTER)).toEqual({ handled: true, defaultPrevented: false });
    expect(r.asked).toEqual([]);
  });

  it('restarts once for two presses in a row: the second finds a terminal that starts', async () => {
    const r = await mountRestartable();
    r.end();
    r.loader.engines[0]?.key(ENTER);
    r.loader.engines[0]?.key(ENTER);
    await flush();
    expect(r.asked).toHaveLength(1);
  });
});
