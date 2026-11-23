import { act, cleanup, render, screen as page, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, HOST, type PanelStore, type Session } from '../../core/panel';
import type { TerminalFeedSnapshot, TerminalTarget } from './feed';
import { createScreenReaderChoice, SCREEN_READER_COMMAND, type ScreenReaderChoice } from './screenReader';
import { fakeEngineLoader, fakeTerminalFeed, type FakeEngineLoader, type FakeTerminalFeed } from './testing';
import { TerminalBody } from './TerminalBody';
import { createTerminalSessions, type TerminalSessions } from './TerminalSessions';
import { TERMINAL_GONE, TERMINAL_TOOL } from './tool';

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

function mount(options: { readonly focus?: boolean; readonly visible?: boolean; readonly state?: TerminalFeedSnapshot['state']; readonly screenReader?: boolean; readonly retitle?: boolean; readonly name?: string } = {}): Rig {
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
  const session = () => store.getSnapshot().sessions[id];
  const ui = (visible: boolean) => <TerminalBody sessions={sessions} session={session()} visible={visible} load={loader.load} screenReader={counted} {...(options.name === undefined ? {} : { name: options.name })} />;
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
    expect(page.getByText(TERMINAL_GONE.title)).toBeInTheDocument();
    expect(page.getByText(TERMINAL_GONE.hint)).toBeInTheDocument();
    expect(page.queryByRole('toolbar')).toBeNull();
  });
});

describe('a session with a feed', () => {
  it('draws the toolbar (Clear and Copy selection), the screen and the lane, and loads no emulator while it is not on screen', async () => {
    const { loader } = mount({ visible: false });
    await flush();
    const toolbar = page.getByRole('toolbar', { name: 'Terminal tools' });
    expect(within(toolbar).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Clear', 'Copy selection']);
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

  it('says that the emulator could not load, and what the person can do: the terminal view is the one thing that loads late', async () => {
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
