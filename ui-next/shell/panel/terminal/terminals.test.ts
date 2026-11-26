import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPanelStore, HOST, PANEL_VERSION, restorePanel, type PanelState, type PanelStore, type Session } from '../../core/panel';
import { focusTab } from '../focus';
import type { EngineAppearance } from './engine';
import type { TerminalBusy, TerminalDirectory, TerminalFeedHandle, TerminalTarget } from './feed';
import { localHereTarget, localProfileTarget, localShellTarget } from './localShell';
import { shellsOf, type ShellChoice, type ShellList } from './profiles';
import { createScreen } from './screen';
import { createScreenReaderChoice } from './screenReader';
import { stateWords } from './state';
import { ASK_MS, createTerminals, type TerminalsOptions } from './terminals';
import { fakeEngineLoader, fakeTerminalFeed, type FakeEngineLoader, type FakeTerminalFeed, type FakeTerminalFeedOptions } from './testing';
import { TERMINAL_TOOL } from './tool';

vi.mock('../focus', () => ({ focusTab: vi.fn(), focusPage: vi.fn(), focusPanel: vi.fn() }));
// What `New terminal` starts when nothing else is given is the host's own shell: a test says what it is asked for, and what it answers.
vi.mock('./localShell', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, localShellTarget: vi.fn(), localProfileTarget: vi.fn(), localHereTarget: vi.fn() };
});

// The terminal's one listener on the window: Command K clears a terminal that has the focus, ahead of the palette that also has it for a chord (docs/ui-next/status/T1.md, decision 13). It is added before the
// palette's, so it sees the key first and, when it takes it, nothing after it does. Against a real screen over a fake emulator.

const APPEARANCE: EngineAppearance = {
  theme: { background: '#000', foreground: '#fff', cursor: '#fff', cursorAccent: '#000', selectionBackground: '#222', selectionInactiveBackground: '#111', palette: Array.from({ length: 16 }, () => '#888') },
  fontFamily: 'monospace',
  fontSize: 12,
  lineHeight: 1.33,
};

const command = (key: string, init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key, code: `Key${key.toUpperCase()}`, metaKey: true, bubbles: true, cancelable: true, ...init });

async function shownScreen(): Promise<{ readonly host: HTMLElement; readonly loader: FakeEngineLoader }> {
  const loader = fakeEngineLoader({ deferred: false, auto: true });
  const host = document.createElement('div');
  document.body.append(host);
  const screen = createScreen({
    feed: fakeTerminalFeed(),
    load: loader.load,
    appearance: () => APPEARANCE,
    platform: 'mac',
    label: 'Terminal input, Terminal',
    descriptionId: 'hint-1',
    screenReader: createScreenReaderChoice(),
    frame: () => () => undefined,
    observe: () => () => undefined,
    fontsReady: async () => Promise.resolve(),
    copy: async () => Promise.resolve(true),
    warn: () => undefined,
  });
  screen.mount(host);
  screen.show();
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }

  return { host, loader };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'platform');
  document.body.replaceChildren();
});

describe('the terminal\'s window key listener', () => {
  it('takes Command K on a Mac when it comes to a terminal screen: that screen is cleared, the key is cancelled and the listeners added after it never see it', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    const stop = createTerminals(createPanelStore()).takeKeys();
    const later = vi.fn();
    window.addEventListener('keydown', later, true);
    const { host, loader } = await shownScreen();
    const input = document.createElement('textarea');
    host.append(input);
    const event = command('k');
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(later).not.toHaveBeenCalled();
    expect(loader.engines[0]?.clears()).toBe(1);
    window.removeEventListener('keydown', later, true);
    stop();
  });

  it('leaves every other key to the window: Command K elsewhere (the palette\'s), Control K, another letter, and any key once it has stopped', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    const stop = createTerminals(createPanelStore()).takeKeys();
    const later = vi.fn();
    window.addEventListener('keydown', later, true);
    const { host, loader } = await shownScreen();
    const input = document.createElement('textarea');
    host.append(input);
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    for (const [target, event] of [[elsewhere, command('k')], [input, command('k', { metaKey: false, ctrlKey: true })], [input, command('j')]] as const) {
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    expect(later).toHaveBeenCalledTimes(3);
    stop();
    const after = command('k');
    input.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    expect(loader.engines[0]?.clears()).toBe(0);
    window.removeEventListener('keydown', later, true);
  });

  it('does nothing on Windows and Linux, where Command K is not a chord and Control K is the shell\'s', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true });
    const stop = createTerminals(createPanelStore()).takeKeys();
    const { host, loader } = await shownScreen();
    const input = document.createElement('textarea');
    host.append(input);
    const event = command('k', { metaKey: false, ctrlKey: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(loader.engines[0]?.clears()).toBe(0);
    stop();
  });
});

describe('the close question as a modal the window must tell its notices about', () => {
  it('is open from the moment a running terminal is asked to close, and tells its listeners: a timed notice must not run out behind a dialog nobody can leave to read it', () => {
    const store = createPanelStore();
    store.registerTool(TERMINAL_TOOL);
    const terminals = createTerminals(store);
    const stop = terminals.sessions.attach();
    const heard = vi.fn();
    const unsubscribe = terminals.modal.subscribe(heard);
    expect(terminals.modal.open()).toBe(false);
    const feed = fakeTerminalFeed();
    const opened = terminals.sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => feed });
    terminals.store.closeSession(opened?.id ?? '');
    expect(terminals.modal.open()).toBe(true);
    expect(heard).toHaveBeenCalled();
    unsubscribe();
    stop();
  });
});

describe('the screen reader choice of the window', () => {
  it('is off when nothing restored it, and on when the window restored it on: the choice the session saved', () => {
    expect(createTerminals(createPanelStore()).screenReader.getSnapshot()).toBe(false);
    expect(createTerminals(createPanelStore(), {}, { screenReader: true }).screenReader.getSnapshot()).toBe(true);
  });

  it('is the one choice every terminal of the window follows: each body is made with it, and each emulator is changed when it changes', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
    const store = createPanelStore();
    store.registerTool(TERMINAL_TOOL);
    const loader = fakeEngineLoader();
    const terminals = createTerminals(store, { load: loader.load }, { screenReader: true });
    const stop = terminals.sessions.attach();
    const bodies = ['one', 'two'].map((title) => {
      const opened = terminals.sessions.open({ plugin: HOST, id: title, title, open: () => fakeTerminalFeed() });
      return store.getSnapshot().sessions[opened?.id ?? ''];
    });
    for (const session of bodies) {
      render(terminals.bodyOf(session, true));
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(loader.engines.map((engine) => engine.options.screenReaderMode)).toEqual([true, true]);
    act(() => {
      terminals.screenReader.toggle();
    });
    expect(loader.engines.map((engine) => engine.screenReaderModes)).toEqual([[false], [false]]);
    act(() => {
      stop();
    });
  });
});

describe('the close question follows what runs in the session (IsBusy: the host is asked when the person closes)', () => {
  beforeAll(() => {
    // jsdom has the element and not its modal: the browser's `showModal` makes the dialog open and puts it in the top layer.
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };

    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });

  beforeEach(() => {
    vi.mocked(focusTab).mockClear();
  });

  const settle = async () =>
    act(async () => {
      for (let turn = 0; turn < 12; turn += 1) {
        await Promise.resolve();
      }
    });

  /** What a producer may leave out or say differently of its typing: `inputs` (it cannot count) and `inputsSettled` (what it says of what is on its way). */
  type TypingMembers = Partial<Pick<TerminalFeedHandle, 'inputs' | 'inputsSettled'>>;

  function withTerminal(busy?: () => Promise<TerminalBusy>, typing: TypingMembers = {}) {
    const store = createPanelStore();
    store.registerTool(TERMINAL_TOOL);
    const terminals = createTerminals(store);
    const stop = terminals.sessions.attach();
    const made = fakeTerminalFeed(busy === undefined ? {} : { busy });
    const feed = { ...made, ...typing };
    const opened = terminals.sessions.open({ plugin: HOST, id: 'local', title: 'zsh', open: () => feed });
    render(terminals.prompt);
    return { store, terminals, feed, id: opened?.id ?? '', stop };
  }

  it('does not ask for a terminal whose shell is at its prompt: the host says idle, and the session closes, with no dialog, a moment after the press', async () => {
    const r = withTerminal(async () => Promise.resolve({ state: 'idle' }));
    expect(r.terminals.store.closeSession(r.id).status).toBe('refused');
    expect(r.store.getSnapshot().sessions[r.id]).toBeDefined();
    await settle();
    expect(r.store.getSnapshot().sessions[r.id]).toBeUndefined();
    expect(r.feed.closed()).toBe(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(r.terminals.modal.open()).toBe(false);
    r.stop();
  });

  it('asks, and names the program, when the host says something runs; the session is still there until the person says yes, and then it closes', async () => {
    const r = withTerminal(async () => Promise.resolve({ state: 'busy', name: 'sleep' }));
    r.terminals.store.closeSession(r.id);
    await settle();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('Terminate session?');
    expect(dialog.textContent).toContain('sleep is running in this terminal. This ends the terminal session and stops it.');
    expect(r.store.getSnapshot().sessions[r.id]).toBeDefined();
    expect(r.terminals.modal.open()).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Terminate session' }));
    expect(r.store.getSnapshot().sessions[r.id]).toBeUndefined();
    expect(r.feed.closed()).toBe(1);
    r.stop();
  });

  it('names a twin as its tab does: the second terminal of the same shell is asked about as `zsh (2)`, and its body is given that name, so the person can tell which of two terminals ends', async () => {
    const store = createPanelStore();
    store.registerTool(TERMINAL_TOOL);
    const terminals = createTerminals(store);
    const stop = terminals.sessions.attach();
    const busy = async (): Promise<TerminalBusy> => Promise.resolve({ state: 'busy', name: 'sleep' });
    terminals.sessions.open({ plugin: HOST, id: 'one', title: 'zsh', open: () => fakeTerminalFeed({ busy }) });
    const second = terminals.sessions.open({ plugin: HOST, id: 'two', title: 'zsh', open: () => fakeTerminalFeed({ busy }) });
    render(terminals.prompt);
    const body = terminals.bodyOf(store.getSnapshot().sessions[second?.id ?? ''], true) as ReactElement<{ readonly name?: string }>;
    expect(body.props.name).toBe('zsh (2)');
    terminals.store.closeSession(second?.id ?? '');
    await settle();
    expect(screen.getByRole('alertdialog').textContent).toContain('zsh (2)');
    stop();
  });

  it('asks the general question when the host cannot tell, or the producer has no way to ask: the shell is a running process, and "may be running" is the truthful answer', async () => {
    const unknown = withTerminal(async () => Promise.resolve({ state: 'unknown' }));
    act(() => {
      unknown.terminals.store.closeSession(unknown.id);
    });
    await settle();
    expect(screen.getByRole('alertdialog').textContent).toContain('This ends the terminal session. Programs it left running in the background may keep running.');
    unknown.stop();
    cleanup();
    const mute = withTerminal();
    act(() => {
      mute.terminals.store.closeSession(mute.id);
    });
    await settle();
    expect(screen.getByRole('alertdialog').textContent).toContain('Programs it left running in the background may keep running.');
    expect(mute.terminals.modal.open()).toBe(true);
    mute.stop();
  });

  it('asks the general question when the answer does not come: a close that waits for a host that does not answer would be a button that does nothing', async () => {
    vi.useFakeTimers();
    const r = withTerminal(async () => new Promise<TerminalBusy>(() => undefined));
    r.terminals.store.closeSession(r.id);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ASK_MS - 1);
    });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(screen.getByRole('alertdialog').textContent).toContain('Programs it left running in the background may keep running.');
    r.stop();
  });

  it('asks the general question when the question fails, and never closes a terminal on an answer it did not get', async () => {
    const r = withTerminal(async () => Promise.reject(new Error('the host did not answer')));
    r.terminals.store.closeSession(r.id);
    await settle();
    expect(screen.getByRole('alertdialog').textContent).toContain('Programs it left running in the background may keep running.');
    expect(r.store.getSnapshot().sessions[r.id]).toBeDefined();
    r.stop();
  });

  it('does not ask for a session that ended while the host was thinking: nothing is left to end, and it closes', async () => {
    let answer: (value: TerminalBusy) => void = () => undefined;
    const r = withTerminal(async () => new Promise<TerminalBusy>((resolve) => {
      answer = resolve;
    }));
    r.terminals.store.closeSession(r.id);
    r.feed.set({ state: 'ended', exit: { code: 0 } });
    answer({ state: 'busy', name: 'sleep' });
    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(r.store.getSnapshot().sessions[r.id]).toBeUndefined();
    r.stop();
  });

  it('closes a session that has ended with no question and no wait, as it always did', () => {
    const r = withTerminal(async () => Promise.resolve({ state: 'busy', name: 'sleep' }));
    r.feed.set({ state: 'ended', exit: { code: 0 } });
    expect(r.terminals.store.closeSession(r.id).status).toBe('done');
    expect(r.store.getSnapshot().sessions[r.id]).toBeUndefined();
    r.stop();
  });

  describe('the focus after a close that waited for the host follows only when it belongs to the session that closes, at the press and when the close is made: that session\'s own tab and close button, or its body while it is on screen', () => {
    /**
     * The panel as the shell draws it, as far as a close reads it: the region, with the tool's tab, the strip of session tabs (for each session a tab and, beside it, the pointer's close button, both in the session's own item), the
     * `+`, and the body of the session on screen with its toolbar and its input; the splitter, which is beside the region and not in it; and a control of the page.
     */
    function drawPanel(ids: readonly string[], onScreen: string) {
      const region = document.createElement('div');
      region.dataset.shellRegion = 'panel';
      const tabs = ids
        .map((id) => `<div data-shell-part="sessionTab" data-tab-id="${id}"><button type="button" role="tab" data-tab-id="${id}"></button><button type="button" tabindex="-1" aria-hidden="true" data-shell-part="sessionClose" data-close-of="${id}"></button></div>`)
        .join('');
      region.innerHTML = `<div data-shell-part="panelTools" role="tablist"><button type="button" role="tab" data-tab-id="terminal"></button></div><div data-shell-part="sessionTabs" role="tablist">${tabs}</div><button type="button" data-shell-part="sessionAdd"></button><div data-shell-part="panelBody" data-session-id="${onScreen}"><div data-shell-part="terminalBody"><button type="button" data-shell-part="terminalTools"></button><textarea></textarea></div></div>`;
      const splitter = document.createElement('div');
      splitter.dataset.shellPart = 'panelHandle';
      splitter.tabIndex = 0;
      const page = document.createElement('button');
      document.body.append(region, splitter, page);
      const find = (selector: string): HTMLElement => {
        const found = region.querySelector<HTMLElement>(selector);
        if (found === null) {
          throw new Error(`the panel has no ${selector}`);
        }

        return found;
      };

      return {
        tab: (id: string) => find(`[data-shell-part="sessionTabs"] [role="tab"][data-tab-id="${id}"]`),
        closeButton: (id: string) => find(`[data-close-of="${id}"]`),
        toolTab: () => find('[data-shell-part="panelTools"] [role="tab"]'),
        add: () => find('[data-shell-part="sessionAdd"]'),
        toolbar: () => find('[data-shell-part="terminalTools"]'),
        input: () => find('textarea'),
        splitter: () => splitter,
        page: () => page,
      };
    }

    /** Two terminals, the second on screen, in the panel as it is drawn; the host of each says that nothing runs when the test says so. */
    function twoSessions() {
      const store = createPanelStore();
      store.registerTool(TERMINAL_TOOL);
      const terminals = createTerminals(store);
      const stop = terminals.sessions.attach();
      const hosts = [Promise.withResolvers<TerminalBusy>(), Promise.withResolvers<TerminalBusy>()];
      const [first = '', second = ''] = hosts.map((host, index) => terminals.sessions.open({ plugin: HOST, id: `local-${String(index)}`, title: 'zsh', open: () => fakeTerminalFeed({ busy: async () => host.promise }) })?.id ?? '');
      store.activateSession(second);
      const panel = drawPanel([first, second], second);
      const say = (session: string) => {
        hosts[session === first ? 0 : 1]?.resolve({ state: 'idle' });
      };

      return { store, terminals, stop, first, second, panel, say };
    }

    it('moves it when it was on the closing session\'s own tab, where a keyboard close (Delete on the tab) leaves it: to the neighbour tab', async () => {
      const t = twoSessions();
      t.panel.tab(t.second).focus();
      t.terminals.store.closeSession(t.second);
      t.say(t.second);
      await settle();
      expect(t.store.getSnapshot().sessions[t.second]).toBeUndefined();
      expect(focusTab).toHaveBeenCalledWith('sessionTabs', t.first);
      t.stop();
    });

    it('moves it to the tool\'s own tab when the session that closes was the last one', async () => {
      const r = withTerminal(async () => Promise.resolve({ state: 'idle' }));
      drawPanel([r.id], r.id).tab(r.id).focus();
      r.terminals.store.closeSession(r.id);
      await settle();
      expect(r.store.getSnapshot().sessions[r.id]).toBeUndefined();
      expect(focusTab).toHaveBeenCalledWith('panelTools', 'terminal');
      r.stop();
    });

    it.each(['input', 'toolbar'] as const)('moves it when it was inside the body of the session on screen, where the close chord leaves it (%s): to the neighbour tab', async (place) => {
      const t = twoSessions();
      t.panel[place]().focus();
      t.terminals.store.closeSession(t.second);
      t.say(t.second);
      await settle();
      expect(t.store.getSnapshot().sessions[t.second]).toBeUndefined();
      expect(focusTab).toHaveBeenCalledWith('sessionTabs', t.first);
      t.stop();
    });

    it('leaves it alone when it was on the tab of another session: the person is on that tab, and it is still there', async () => {
      const t = twoSessions();
      t.panel.tab(t.first).focus();
      t.terminals.store.closeSession(t.second);
      t.say(t.second);
      await settle();
      expect(t.store.getSnapshot().sessions[t.second]).toBeUndefined();
      expect(focusTab).not.toHaveBeenCalled();
      t.stop();
    });

    it('leaves it alone when it was inside the body of the session on screen and the session that closes is another one: the body is not the closing session\'s', async () => {
      const t = twoSessions();
      t.panel.input().focus();
      t.terminals.store.closeSession(t.first);
      t.say(t.first);
      await settle();
      expect(t.store.getSnapshot().sessions[t.first]).toBeUndefined();
      expect(focusTab).not.toHaveBeenCalled();
      t.stop();
    });

    it('moves it when it was on the closing session\'s own close button, where a mouse press leaves it: the button is part of the session\'s tab and goes with it, so the focus goes on to the neighbour tab and is not dropped', async () => {
      const t = twoSessions();
      t.panel.closeButton(t.second).focus();
      t.terminals.store.closeSession(t.second);
      t.say(t.second);
      await settle();
      expect(t.store.getSnapshot().sessions[t.second]).toBeUndefined();
      expect(focusTab).toHaveBeenCalledWith('sessionTabs', t.first);
      t.stop();
    });

    it('leaves it alone when it was on the close button of another session\'s tab: that button is not the closing session\'s', async () => {
      const t = twoSessions();
      t.panel.closeButton(t.first).focus();
      t.terminals.store.closeSession(t.second);
      t.say(t.second);
      await settle();
      expect(t.store.getSnapshot().sessions[t.second]).toBeUndefined();
      expect(focusTab).not.toHaveBeenCalled();
      t.stop();
    });

    it.each(['toolTab', 'add', 'splitter', 'page'] as const)('leaves it alone when it was on something else than the session: %s', async (place) => {
      const t = twoSessions();
      const element = t.panel[place]();
      element.focus();
      expect(document.activeElement).toBe(element);
      t.terminals.store.closeSession(t.second);
      t.say(t.second);
      await settle();
      expect(t.store.getSnapshot().sessions[t.second]).toBeUndefined();
      expect(focusTab).not.toHaveBeenCalled();
      t.stop();
    });

    it('leaves it alone when nothing had it (a click on a button that never took it)', async () => {
      const t = twoSessions();
      (document.activeElement as HTMLElement | null)?.blur();
      t.terminals.store.closeSession(t.second);
      t.say(t.second);
      await settle();
      expect(t.store.getSnapshot().sessions[t.second]).toBeUndefined();
      expect(focusTab).not.toHaveBeenCalled();
      t.stop();
    });

    it.each(['the tab of another session', 'the tool\'s own tab', 'the close button of another session\'s tab', 'the splitter', 'a control of the page'] as const)(
      'leaves it alone when the person moved it from the session\'s tab to %s while the host was asked: it belonged to the session at the press and does not when the close is made',
      async (place) => {
        const t = twoSessions();
        t.panel.tab(t.second).focus();
        t.terminals.store.closeSession(t.second);
        const destination = {
          'the tab of another session': t.panel.tab(t.first),
          'the tool\'s own tab': t.panel.toolTab(),
          'the close button of another session\'s tab': t.panel.closeButton(t.first),
          'the splitter': t.panel.splitter(),
          'a control of the page': t.panel.page(),
        }[place];
        destination.focus();
        expect(document.activeElement).toBe(destination);
        t.say(t.second);
        await settle();
        expect(t.store.getSnapshot().sessions[t.second]).toBeUndefined();
        expect(focusTab).not.toHaveBeenCalled();
        t.stop();
      },
    );

    it('leaves it alone when it came to the session\'s tab after the press: it did not belong to the session when the close was pressed', async () => {
      const t = twoSessions();
      t.panel.page().focus();
      t.terminals.store.closeSession(t.second);
      t.panel.tab(t.second).focus();
      t.say(t.second);
      await settle();
      expect(t.store.getSnapshot().sessions[t.second]).toBeUndefined();
      expect(focusTab).not.toHaveBeenCalled();
      t.stop();
    });
  });

  it('asks the general question when the person typed while the host was asked: an idle answer is true of the moment the host looked, and a program may have been started since', async () => {
    const { promise, resolve } = Promise.withResolvers<TerminalBusy>();
    const r = withTerminal(async () => promise);
    r.terminals.store.closeSession(r.id);
    r.feed.write('sleep 100\r');
    resolve({ state: 'idle' });
    await settle();
    expect(screen.getByRole('alertdialog').textContent).toContain('Programs it left running in the background may keep running.');
    expect(r.store.getSnapshot().sessions[r.id]).toBeDefined();
    expect(r.feed.closed()).toBe(0);
    r.stop();
  });

  it('does not count what was typed before the press against an idle answer: the host looked after it, and the session closes with no question', async () => {
    const r = withTerminal(async () => Promise.resolve({ state: 'idle' }));
    r.feed.write('ls\r');
    r.terminals.store.closeSession(r.id);
    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(r.store.getSnapshot().sessions[r.id]).toBeUndefined();
    expect(r.feed.closed()).toBe(1);
    r.stop();
  });

  it('keeps what the host said when it names a program, typing or not: only an idle answer can be out of date by what was typed after it', async () => {
    const { promise, resolve } = Promise.withResolvers<TerminalBusy>();
    const r = withTerminal(async () => promise);
    r.terminals.store.closeSession(r.id);
    r.feed.write('x');
    resolve({ state: 'busy', name: 'sleep' });
    await settle();
    expect(screen.getByRole('alertdialog').textContent).toContain('sleep is running in this terminal.');
    r.stop();
  });

  it('asks the general question for an idle answer from a feed that cannot count what was typed: nothing says that nothing was typed meanwhile, so the answer cannot be trusted', async () => {
    const r = withTerminal(async () => Promise.resolve({ state: 'idle' }), { inputs: undefined });
    r.terminals.store.closeSession(r.id);
    await settle();
    expect(screen.getByRole('alertdialog').textContent).toContain('Programs it left running in the background may keep running.');
    expect(r.store.getSnapshot().sessions[r.id]).toBeDefined();
    expect(r.feed.closed()).toBe(0);
    r.stop();
  });

  it('still keeps what the host said when it names a program, for a feed that cannot count what was typed: only an idle answer is in doubt', async () => {
    const busy = withTerminal(async () => Promise.resolve({ state: 'busy', name: 'sleep' }), { inputs: undefined });
    busy.terminals.store.closeSession(busy.id);
    await settle();
    expect(screen.getByRole('alertdialog').textContent).toContain('sleep is running in this terminal.');
    busy.stop();
  });

  it('asks the general question when what was typed is on its way at the answer, even if nothing was when the host was asked: the answer is read at the moment it comes', async () => {
    let settled = true;
    const { promise, resolve } = Promise.withResolvers<TerminalBusy>();
    const r = withTerminal(async () => promise, { inputsSettled: () => settled });
    r.terminals.store.closeSession(r.id);
    settled = false;
    resolve({ state: 'idle' });
    await settle();
    expect(screen.getByRole('alertdialog').textContent).toContain('Programs it left running in the background may keep running.');
    expect(r.feed.closed()).toBe(0);
    r.stop();
  });

  it('asks the general question when what was typed is on its way both when the host was asked and at the answer: the host looked before it was applied, so an idle answer says nothing of it', async () => {
    const r = withTerminal(async () => Promise.resolve({ state: 'idle' }), { inputsSettled: () => false });
    r.terminals.store.closeSession(r.id);
    await settle();
    expect(screen.getByRole('alertdialog').textContent).toContain('Programs it left running in the background may keep running.');
    expect(r.store.getSnapshot().sessions[r.id]).toBeDefined();
    expect(r.feed.closed()).toBe(0);
    r.stop();
  });

  it('asks the general question when what was typed had not reached the host when it was asked, even if it has by the answer: the host may have looked before the shell had it', async () => {
    let settled = false;
    const { promise, resolve } = Promise.withResolvers<TerminalBusy>();
    const r = withTerminal(async () => promise, { inputsSettled: () => settled });
    r.terminals.store.closeSession(r.id);
    settled = true;
    resolve({ state: 'idle' });
    await settle();
    expect(screen.getByRole('alertdialog').textContent).toContain('Programs it left running in the background may keep running.');
    expect(r.feed.closed()).toBe(0);
    r.stop();
  });

  it('closes with no question when all that was typed has reached the host, both when it was asked and at the answer: nothing is on its way that the answer could not have seen', async () => {
    const r = withTerminal(async () => Promise.resolve({ state: 'idle' }), { inputsSettled: () => true });
    r.feed.write('ls\r');
    r.terminals.store.closeSession(r.id);
    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(r.store.getSnapshot().sessions[r.id]).toBeUndefined();
    expect(r.feed.closed()).toBe(1);
    r.stop();
  });
});

// ---- a window that was reloaded (T2-go): its terminals are found again when it attaches, and left when it goes ---------------------------------------------------------------------------------------------------

type SavedTab = { readonly id: string; readonly title: string };

/** The panel a reloaded window starts from: what the last run saved, read back by the real restore, so every session is `ended` and none has a feed. `active` is the session the person had on screen. */
function savedPanel(tabs: readonly SavedTab[], active?: string): PanelState {
  const restored = restorePanel(
    { version: PANEL_VERSION, open: false, height: null, tool: 'terminal', active: active === undefined ? {} : { terminal: active }, sessions: tabs.map((tab) => ({ ...tab, tool: 'terminal', plugin: HOST, scope: '' })) },
    { now: 500 },
  );
  if (!restored.ok) {
    throw new Error(restored.detail);
  }

  return restored.state;
}

/** The feed of a terminal that has a key: besides being closed it can be left (`left` counts it), which holds the shell for its lease so that the page that comes back finds it. */
const keyedFeed = (options: FakeTerminalFeedOptions = {}): FakeTerminalFeed => fakeTerminalFeed({ ...options, leave: true });

/** What the host lists for a window that was reloaded: a terminal whose session has the id of the terminal. */
const found = (sessionId: string, feed: TerminalFeedHandle = keyedFeed()): TerminalTarget => ({ plugin: HOST, id: 'local', title: 'Terminal', sessionId, open: () => feed });

/** Lets the answers that are ready run, and what follows them. */
async function turns(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }
}

describe('a window that was reloaded finds its terminals again (T2-go)', () => {
  /** A reloaded window: the panel its last run saved, the Terminal tool over it. */
  function reloaded(options: TerminalsOptions, tabs: readonly SavedTab[] = [], active?: string) {
    const store = createPanelStore(tabs.length === 0 ? {} : { initial: savedPanel(tabs, active) });
    store.registerTool(TERMINAL_TOOL);
    const terminals = createTerminals(store, options);
    return { store, terminals };
  }

  const zsh = (id: string): SavedTab => ({ id, title: 'zsh' });
  const stateOf = (store: PanelStore, id: string) => store.getSnapshot().sessions[id]?.state;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(localShellTarget).mockReset();
    vi.mocked(localProfileTarget).mockReset();
    vi.mocked(localHereTarget).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks the host for its terminals once, when the window attaches and not before, and gives each the saved tab of its id', async () => {
    const [a, b] = [keyedFeed(), keyedFeed()];
    const restore = vi.fn(async () => Promise.resolve([found('term-b', b), found('term-a', a)]));
    const r = reloaded({ restore }, [zsh('term-a'), { id: 'term-b', title: 'bash' }]);
    expect(restore).not.toHaveBeenCalled();
    const stop = r.terminals.attach();
    expect(restore).toHaveBeenCalledTimes(1);
    await turns();
    expect(r.terminals.sessions.feedOf('term-a')).toBe(a);
    expect(r.terminals.sessions.feedOf('term-b')).toBe(b);
    expect([stateOf(r.store, 'term-a'), stateOf(r.store, 'term-b')]).toEqual(['running', 'running']);
    expect(r.store.getSnapshot().order).toEqual(['term-a', 'term-b']);
    stop();
  });

  it('tells whoever follows the feeds when the host lists a terminal for a saved tab, once for each: a body drawn before the answer had no feed for its session, and finds it now', async () => {
    const gate = Promise.withResolvers<readonly TerminalTarget[]>();
    const r = reloaded({ restore: async () => gate.promise }, [zsh('term-a'), zsh('term-b')]);
    const seen: Array<readonly [TerminalFeedHandle | undefined, TerminalFeedHandle | undefined]> = [];
    r.terminals.sessions.subscribeFeeds(() => {
      seen.push([r.terminals.sessions.feedOf('term-a'), r.terminals.sessions.feedOf('term-b')]);
    });
    const stop = r.terminals.attach();
    expect(r.terminals.sessions.feedOf('term-a')).toBeUndefined();
    await turns();
    expect(seen).toEqual([]);
    const [a, b] = [keyedFeed(), keyedFeed()];
    gate.resolve([found('term-a', a), found('term-b', b)]);
    await turns();
    expect(seen).toHaveLength(2);
    expect(seen[0]?.[0]).toBe(a);
    expect(seen[0]?.[1]).toBeUndefined();
    expect(seen[1]?.[0]).toBe(a);
    expect(seen[1]?.[1]).toBe(b);
    stop();
  });

  it('moves nothing the person sees: the tab on screen stays on screen and the panel stays shut', async () => {
    const restore = async () => Promise.resolve([found('term-c'), found('term-a'), found('term-b')]);
    const r = reloaded({ restore }, [zsh('term-a'), zsh('term-b'), zsh('term-c')], 'term-b');
    const stop = r.terminals.attach();
    await turns();
    const state = r.store.getSnapshot();
    expect(['term-a', 'term-b', 'term-c'].map((id) => state.sessions[id]?.state)).toEqual(['running', 'running', 'running']);
    expect(state.open).toBe(false);
    expect(r.store.selectors.activeSession(state, 'terminal')).toBe('term-b');
    expect(['term-a', 'term-b', 'term-c'].map((id) => r.terminals.sessions.takeFocus(id))).toEqual([false, false, false]);
    stop();
  });

  it('leaves a saved tab that the host lists no terminal for as it was, ended with no feed (an app restart: the host\'s terminals are gone, and nothing is offered)', async () => {
    const restore = vi.fn(async () => Promise.resolve([]));
    const r = reloaded({ restore }, [zsh('term-a')]);
    const stop = r.terminals.attach();
    await turns();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(stateOf(r.store, 'term-a')).toBe('ended');
    expect(r.terminals.sessions.feedOf('term-a')).toBeUndefined();
    expect(console.warn).not.toHaveBeenCalled();
    stop();
  });

  it('shows a terminal the host lists that no tab was saved for as a tab of its own, in the strip, and does not cover the page for it', async () => {
    const restore = async () => Promise.resolve([found('lost-1')]);
    const r = reloaded({ restore });
    const stop = r.terminals.attach();
    await turns();
    expect(stateOf(r.store, 'lost-1')).toBe('running');
    expect(r.store.getSnapshot().open).toBe(false);
    expect(r.store.getSnapshot().active).toEqual({});
    expect(r.terminals.sessions.takeFocus('lost-1')).toBe(false);
    stop();
  });

  describe('a terminal the host lists as ended (it keeps the output of one for the rest of its lease, and closing its tab does not dismiss it)', () => {
    /** The host's listing of a terminal whose shell had ended: the feed says how it ended, and the target says that it did. */
    const ended = (sessionId: string, feed: FakeTerminalFeed = keyedFeed({ state: 'ended' })): TerminalTarget => ({ ...found(sessionId, feed), ended: true });

    it('gives it to the saved tab that holds its id, which then says how it ended in the host\'s words and not the restore\'s: the person still has that tab', async () => {
      const feed = keyedFeed({ state: 'ended' });
      feed.set({ exit: { code: 3 } });
      const open = vi.fn(() => feed);
      const r = reloaded({ restore: async () => Promise.resolve([{ ...ended('term-a', feed), open }]) }, [zsh('term-a')]);
      const stop = r.terminals.attach();
      await turns();
      expect(open).toHaveBeenCalledTimes(1);
      expect(r.terminals.sessions.feedOf('term-a')).toBe(feed);
      expect(r.store.getSnapshot().sessions['term-a']).toMatchObject({ state: 'ended', cause: '' });
      expect(r.terminals.sessions.recordOf('term-a')?.snapshot).toMatchObject({ state: 'ended', exit: { code: 3 } });
      expect(console.warn).not.toHaveBeenCalled();
      stop();
    });

    it('skips it when no saved tab holds its id: it is not opened, so nothing is attached at the host, no tab is made and nothing is said, and a tab the person closed does not come back with the next reload', async () => {
      const open = vi.fn(() => keyedFeed({ state: 'ended' }));
      const r = reloaded({ restore: async () => Promise.resolve([{ ...ended('closed-1'), open }]) }, [zsh('term-a')]);
      const stop = r.terminals.attach();
      await turns();
      expect(open).not.toHaveBeenCalled();
      expect(Object.keys(r.store.getSnapshot().sessions)).toEqual(['term-a']);
      expect(r.terminals.sessions.feedOf('closed-1')).toBeUndefined();
      expect(console.warn).not.toHaveBeenCalled();
      stop();
    });

    it('does not bring back a tab the person closed while the host was asked: the tab was saved, and is gone when the answer comes', async () => {
      const gate = Promise.withResolvers<readonly TerminalTarget[]>();
      const open = vi.fn(() => keyedFeed({ state: 'ended' }));
      const r = reloaded({ restore: async () => gate.promise }, [zsh('term-a'), zsh('term-b')]);
      const stop = r.terminals.attach();
      expect(r.terminals.store.closeSession('term-a').status).toBe('done');
      gate.resolve([{ ...ended('term-a'), open }, ended('term-b')]);
      await turns();
      expect(open).not.toHaveBeenCalled();
      expect(Object.keys(r.store.getSnapshot().sessions)).toEqual(['term-b']);
      expect(r.terminals.sessions.feedOf('term-b')).toBeDefined();
      expect(console.warn).not.toHaveBeenCalled();
      stop();
    });

    it('skips it when it names no session at all: no tab can hold it', async () => {
      const open = vi.fn(() => keyedFeed({ state: 'ended' }));
      const r = reloaded({ restore: async () => Promise.resolve([{ ...ended('nameless'), sessionId: undefined, open }]) }, [zsh('term-a')]);
      const stop = r.terminals.attach();
      await turns();
      expect(open).not.toHaveBeenCalled();
      expect(Object.keys(r.store.getSnapshot().sessions)).toEqual(['term-a']);
      expect(console.warn).not.toHaveBeenCalled();
      stop();
    });

    it('is decided for each terminal of the answer, in the order it gave: a skipped one does not stop the rest, and a terminal that runs is opened whether a tab holds its id or not', async () => {
      const calls: string[] = [];
      const listed = (sessionId: string, over: boolean): TerminalTarget => ({
        ...found(sessionId),
        ended: over,
        open: () => {
          calls.push(sessionId);
          return keyedFeed({ state: over ? 'ended' : 'running' });
        },
      });
      const restore = async () => Promise.resolve([listed('closed-1', true), listed('term-a', true), listed('lost-1', false), listed('term-c', false)]);
      const r = reloaded({ restore }, [zsh('term-a'), zsh('term-c')]);
      const stop = r.terminals.attach();
      await turns();
      expect(calls).toEqual(['term-a', 'lost-1', 'term-c']);
      expect(r.store.getSnapshot().order).toEqual(['term-a', 'term-c', 'lost-1']);
      expect(['term-a', 'term-c', 'lost-1'].map((id) => stateOf(r.store, id))).toEqual(['ended', 'running', 'running']);
      expect(r.store.getSnapshot().open).toBe(false);
      expect(console.warn).not.toHaveBeenCalled();
      stop();
    });
  });

  it('says once, on the console, when the host cannot list its terminals, and does nothing else: the saved tabs stay ended, and the window attaches again and does not ask again', async () => {
    const restore = vi.fn(async () => Promise.reject(new Error('the host did not answer')));
    const r = reloaded({ restore }, [zsh('term-a')]);
    const stop = r.terminals.attach();
    await turns();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(stateOf(r.store, 'term-a')).toBe('ended');
    expect(r.terminals.sessions.feedOf('term-a')).toBeUndefined();
    stop();
    r.terminals.attach()();
    await turns();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('says once when what it asks the host for throws before it answers, as well', async () => {
    const restore = vi.fn((): never => {
      throw new Error('no client');
    });
    const r = reloaded({ restore }, [zsh('term-a')]);
    const stop = r.terminals.attach();
    await turns();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(stateOf(r.store, 'term-a')).toBe('ended');
    stop();
  });

  it('asks the host once however many times the window attaches (a development build runs its effects twice), and opens what it was told once, in the attach that is on', async () => {
    const gate = Promise.withResolvers<readonly TerminalTarget[]>();
    const restore = vi.fn(async () => gate.promise);
    const open = vi.fn(() => keyedFeed());
    const r = reloaded({ restore }, [zsh('term-a')]);
    const first = r.terminals.attach();
    first();
    const second = r.terminals.attach();
    gate.resolve([{ ...found('term-a'), open }]);
    await turns();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(stateOf(r.store, 'term-a')).toBe('running');
    second();
    r.terminals.attach()();
    await turns();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('takes no terminal for a window that went away before the host answered: nothing is attached to a page that is gone', async () => {
    const gate = Promise.withResolvers<readonly TerminalTarget[]>();
    const open = vi.fn(() => keyedFeed());
    const r = reloaded({ restore: async () => gate.promise }, [zsh('term-a')]);
    r.terminals.attach()();
    gate.resolve([{ ...found('term-a'), open }]);
    await turns();
    expect(open).not.toHaveBeenCalled();
    expect(stateOf(r.store, 'term-a')).toBe('ended');
  });

  it('asks nothing when there is nothing to ask: a window with no way to list its terminals (a probe, a test) attaches as it always did', () => {
    const r = reloaded({}, [zsh('term-a')]);
    const stop = r.terminals.attach();
    expect(stateOf(r.store, 'term-a')).toBe('ended');
    stop();
  });

  describe('when the page goes away', () => {
    it('leaves the terminals that have a key at pagehide, once, and closes nothing: the shells live on for their lease, and the tabs stay', () => {
      const r = reloaded({});
      const stop = r.terminals.attach();
      const keyed = keyedFeed();
      const plain = fakeTerminalFeed();
      r.terminals.sessions.open(found('term-a', keyed));
      r.terminals.sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => plain });
      window.dispatchEvent(new Event('pagehide'));
      window.dispatchEvent(new Event('pagehide'));
      expect(keyed.left()).toBe(1);
      expect(keyed.closed()).toBe(0);
      expect(plain.closed()).toBe(0);
      expect(plain.listeners()).toBe(1);
      expect(Object.keys(r.store.getSnapshot().sessions)).toHaveLength(2);
      stop();
    });

    it('listens for it from the moment the window attaches until it stops, and again when it attaches again', () => {
      const add = vi.spyOn(window, 'addEventListener');
      const remove = vi.spyOn(window, 'removeEventListener');
      const r = reloaded({});
      const listeners = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === 'pagehide').map(([, listener]) => listener);
      const stop = r.terminals.attach();
      expect(listeners(add)).toHaveLength(1);
      expect(listeners(remove)).toHaveLength(0);
      stop();
      expect(listeners(remove)).toEqual(listeners(add));
      const again = r.terminals.attach();
      const keyed = keyedFeed();
      r.terminals.sessions.open(found('term-a', keyed));
      window.dispatchEvent(new Event('pagehide'));
      expect(keyed.left()).toBe(1);
      again();
    });

    it('leaves the terminals that have a key, and closes the others, when the window stops: it unmounts, and a shell with no key cannot be found again', () => {
      const r = reloaded({});
      const stop = r.terminals.attach();
      const keyed = keyedFeed();
      const plain = fakeTerminalFeed();
      r.terminals.sessions.open(found('term-a', keyed));
      r.terminals.sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => plain });
      stop();
      expect(keyed.left()).toBe(1);
      expect(keyed.closed()).toBe(0);
      expect(plain.closed()).toBe(1);
    });

    it('does not leave again, or close, at the stop that follows a pagehide', () => {
      const r = reloaded({});
      const stop = r.terminals.attach();
      const keyed = keyedFeed();
      r.terminals.sessions.open(found('term-a', keyed));
      window.dispatchEvent(new Event('pagehide'));
      stop();
      expect(keyed.left()).toBe(1);
      expect(keyed.closed()).toBe(0);
    });

    it('closes the terminal when the person closes its tab, as always: a tab is a shell, and closing it ends the shell', () => {
      const r = reloaded({});
      const stop = r.terminals.attach();
      const keyed = keyedFeed({ state: 'ended' });
      const opened = r.terminals.sessions.open(found('term-a', keyed));
      r.terminals.store.closeSession(opened?.id ?? '');
      expect(keyed.closed()).toBe(1);
      expect(keyed.left()).toBe(0);
      stop();
      expect(keyed.left()).toBe(0);
    });
  });

  describe('what `New terminal` starts', () => {
    it('is the host\'s own shell, and its session is the terminal\'s id: the next reload finds the tab by it', () => {
      const feed = keyedFeed();
      vi.mocked(localShellTarget).mockReturnValue({ plugin: HOST, id: 'local', title: 'Terminal', sessionId: 'term-9', open: () => feed });
      const r = reloaded({});
      const stop = r.terminals.attach();
      r.terminals.newSession.start();
      expect(localShellTarget).toHaveBeenCalledTimes(1);
      expect(vi.mocked(localShellTarget).mock.calls).toEqual([[]]);
      expect(Object.keys(r.store.getSnapshot().sessions)).toEqual(['term-9']);
      expect(r.terminals.sessions.feedOf('term-9')).toBe(feed);
      expect(r.terminals.sessions.takeFocus('term-9')).toBe(true);
      expect(r.store.getSnapshot().open).toBe(true);
      stop();
    });

    it('is the host\'s own shell made with nothing from this window: the channel holds what the terminal needs, and a target a probe gives is used as it is', () => {
      vi.mocked(localShellTarget).mockReturnValue({ plugin: HOST, id: 'local', title: 'Terminal', open: () => fakeTerminalFeed() });
      const without = reloaded({});
      const stopWithout = without.terminals.attach();
      without.terminals.newSession.start();
      expect(vi.mocked(localShellTarget).mock.calls).toEqual([[]]);
      stopWithout();
      vi.mocked(localShellTarget).mockClear();
      const given = reloaded({ target: () => ({ plugin: HOST, id: 'synthetic', title: 'Synthetic', open: () => fakeTerminalFeed() }) });
      const stopGiven = given.terminals.attach();
      given.terminals.newSession.start();
      expect(localShellTarget).not.toHaveBeenCalled();
      expect(Object.values(given.store.getSnapshot().sessions).map((session) => session.title)).toEqual(['Synthetic']);
      stopGiven();
    });
  });

  describe('what `New terminal here` starts (the menu\'s item, `openHere`)', () => {
    const SHELL: TerminalDirectory = { state: 'known', path: '/usr', source: 'shell' };
    let counter = 0;
    /** A target of the host's own shell, under an id of its own, that opens a feed. */
    const targetFor = (): TerminalTarget => {
      counter += 1;
      return { plugin: HOST, id: 'local', title: 'Terminal', sessionId: `term-here-${String(counter)}`, open: () => keyedFeed() };
    };

    beforeEach(() => {
      counter = 0;
      vi.mocked(localHereTarget).mockReset();
      vi.mocked(localHereTarget).mockImplementation(targetFor);
    });

    /** A window with a terminal whose feed says where it is by `directory`. */
    function withTerminal(directory: (() => Promise<TerminalDirectory>) | undefined, options: TerminalsOptions = {}) {
      const r = reloaded(options);
      const stop = r.terminals.attach();
      const opened = r.terminals.sessions.open(found('term-a', keyedFeed(directory === undefined ? {} : { directory })));
      return { ...r, stop, id: opened?.id ?? '' };
    }

    it('opens a terminal in the directory the feed of the session says, on screen and focused, and asks the feed and nothing else where it is', async () => {
      const directory = vi.fn(async () => Promise.resolve(SHELL));
      const r = withTerminal(directory);
      await r.terminals.openHere(r.id);
      expect(directory).toHaveBeenCalledTimes(1);
      expect(vi.mocked(localHereTarget).mock.calls.map(([where]) => where)).toEqual([SHELL]);
      expect(Object.keys(r.store.getSnapshot().sessions)).toEqual(['term-a', 'term-here-1']);
      expect(r.terminals.sessions.takeFocus('term-here-1')).toBe(true);
      expect(r.store.getSnapshot().open).toBe(true);
      expect(localShellTarget).not.toHaveBeenCalled();
      r.stop();
    });

    it('gives the target what the feed said as it said it, an unknown directory included: the target is the one that starts in home and says so, and the window does not choose a directory', async () => {
      const unknown: TerminalDirectory = { state: 'unknown', reason: 'query-failed' };
      const r = withTerminal(async () => Promise.resolve(unknown));
      await r.terminals.openHere(r.id);
      expect(vi.mocked(localHereTarget).mock.calls.map(([where]) => where)).toEqual([unknown]);
      expect(Object.keys(r.store.getSnapshot().sessions)).toEqual(['term-a', 'term-here-1']);
      r.stop();
    });

    it('opens the terminal only when the feed has answered: nothing is opened for a question still out, and what the host says at the answer is what is used', async () => {
      const answer = Promise.withResolvers<TerminalDirectory>();
      const r = withTerminal(async () => answer.promise);
      const opening = r.terminals.openHere(r.id);
      await turns();
      expect(localHereTarget).not.toHaveBeenCalled();
      expect(Object.keys(r.store.getSnapshot().sessions)).toEqual(['term-a']);
      answer.resolve({ state: 'known', path: '/var', source: 'shell' });
      await opening;
      expect(vi.mocked(localHereTarget).mock.calls.map(([where]) => where)).toEqual([{ state: 'known', path: '/var', source: 'shell' }]);
      r.stop();
    });

    it('opens nothing for a session whose feed cannot say where it is, and for a session that has no feed or does not exist: no target is made', async () => {
      const r = withTerminal(undefined);
      await r.terminals.openHere(r.id);
      await r.terminals.openHere('no-such-session');
      expect(localHereTarget).not.toHaveBeenCalled();
      expect(Object.keys(r.store.getSnapshot().sessions)).toEqual(['term-a']);
      r.stop();
    });

    it('takes a feed that throws for one that could not say, which is how it is told: the terminal still opens, in home, and the throw is not the person\'s to read', async () => {
      const r = withTerminal(async () => Promise.reject(new Error('boom')));
      await r.terminals.openHere(r.id);
      expect(vi.mocked(localHereTarget).mock.calls.map(([where]) => where)).toEqual([{ state: 'unknown', reason: 'unanswered' }]);
      r.stop();
    });

    it('opens one terminal for each press, each under an id of its own: the same terminal can be the place of two', async () => {
      const r = withTerminal(async () => Promise.resolve(SHELL));
      await Promise.all([r.terminals.openHere(r.id), r.terminals.openHere(r.id)]);
      expect(Object.keys(r.store.getSnapshot().sessions)).toEqual(['term-a', 'term-here-1', 'term-here-2']);
      r.stop();
    });

    it('uses the target a probe gives, as the `+` does, and then makes none of its own', async () => {
      const given = vi.fn((_where: TerminalDirectory): TerminalTarget => ({ plugin: HOST, id: 'synthetic', title: 'Synthetic', open: () => fakeTerminalFeed() }));
      const r = withTerminal(async () => Promise.resolve(SHELL), { here: given });
      await r.terminals.openHere(r.id);
      expect(given.mock.calls.map(([where]) => where)).toEqual([SHELL]);
      expect(localHereTarget).not.toHaveBeenCalled();
      expect(Object.values(r.store.getSnapshot().sessions).map((session) => session.title)).toEqual(['Terminal', 'Synthetic']);
      r.stop();
    });

    it('is what the body\'s menu item runs: the body is given it by the window, for the session it shows', async () => {
      const directory = vi.fn(async () => Promise.resolve(SHELL));
      const r = withTerminal(directory);
      const session = r.store.getSnapshot().sessions[r.id];
      expect(session).toBeDefined();
      const body = r.terminals.bodyOf(session, true);
      // The element's props are the body's own (`onNewHere`); the cast says so once, in a named constant.
      const props = body.props as { readonly session: Session; readonly onNewHere: (id: string) => void };
      expect(props.session.id).toBe(r.id);
      props.onNewHere(r.id);
      await turns();
      expect(directory).toHaveBeenCalledTimes(1);
      r.stop();
    });
  });

  describe('the shells `New terminal` offers', () => {
    /** A list of shells the test changes, as the page's store of what the host lists does when the settings change. */
    function shellList(initial: unknown) {
      let choices: readonly ShellChoice[] = shellsOf(initial);
      const listeners = new Set<() => void>();
      const shells: ShellList = {
        subscribe: (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        getSnapshot: () => choices,
      };
      return {
        shells,
        set: (next: unknown) => {
          choices = shellsOf(next);
          listeners.forEach((listener) => {
            listener(); 
          });
        },
      };
    }

    const BASH = { name: 'bash', path: '/bin/bash', default: false };
    const ZSH = { name: 'zsh', path: '/usr/bin/zsh', default: true };
    const menuOf = (r: ReturnType<typeof reloaded>) => {
      const { menu } = r.terminals.newSession;
      expect(menu, 'the tool offers a choice').toBeDefined();
      return menu!;
    };

    it('lists the shells the host found, each with its path, and marks the default the host marked', () => {
      const r = reloaded({ shells: shellList([BASH, ZSH]).shells });
      const items = menuOf(r).getSnapshot();
      expect(items.map((item) => (item.kind === 'action' ? item.label : item.kind))).toEqual(['bash', 'zsh']);
      expect(items[0]).toMatchObject({ metadata: '/bin/bash' });
      expect(items[1]).toMatchObject({ metadata: { icon: 'check' } });
    });

    it('starts a terminal from the profile of the item chosen, not the default one, under the target the profile makes', () => {
      const feed = keyedFeed();
      vi.mocked(localProfileTarget).mockReturnValue({ plugin: HOST, id: 'local', title: 'bash', sessionId: 'term-5', open: () => feed });
      const r = reloaded({ shells: shellList([BASH, ZSH]).shells });
      const stop = r.terminals.attach();
      const [bash] = menuOf(r).getSnapshot();
      expect(bash?.kind).toBe('action');
      if (bash?.kind === 'action') {
        bash.onSelect();
      }

      expect(vi.mocked(localProfileTarget).mock.calls.map(([profile]) => profile)).toEqual([{ name: 'bash', path: '/bin/bash' }]);
      expect(localShellTarget).not.toHaveBeenCalled();
      expect(Object.keys(r.store.getSnapshot().sessions)).toEqual(['term-5']);
      expect(r.terminals.sessions.takeFocus('term-5')).toBe(true);
      stop();
    });

    it('keeps the `+` for the host\'s default: it names no shell', () => {
      vi.mocked(localShellTarget).mockReturnValue({ plugin: HOST, id: 'local', title: 'Terminal', open: () => fakeTerminalFeed() });
      const r = reloaded({ shells: shellList([BASH, ZSH]).shells });
      const stop = r.terminals.attach();
      r.terminals.newSession.start();
      expect(vi.mocked(localShellTarget).mock.calls).toEqual([[]]);
      expect(localProfileTarget).not.toHaveBeenCalled();
      stop();
    });

    it('follows the list: a change of the settings moves the default, and the same list is the same items', () => {
      const list = shellList([BASH, ZSH]);
      const r = reloaded({ shells: list.shells });
      const menu = menuOf(r);
      const before = menu.getSnapshot();
      expect(menu.getSnapshot()).toBe(before);
      const heard = vi.fn();
      const stop = menu.subscribe(heard);
      list.set([{ ...BASH, default: true }, { ...ZSH, default: false }]);
      expect(heard).toHaveBeenCalledTimes(1);
      const after = menu.getSnapshot();
      expect(after).not.toBe(before);
      expect(after[0]).toMatchObject({ metadata: { icon: 'check' } });
      expect(after[1]).toMatchObject({ metadata: '/usr/bin/zsh' });
      stop();
    });
  });

  describe('when the page\'s events connection comes back (a gap in the events lane, deleted with the lane)', () => {
    it('is not listened to: every feed connects its own stream again, so the window has no connection to subscribe to and no feed to ask', () => {
      const subscribe = vi.fn((): (() => void) => () => undefined);
      // The option is deleted: a window that is still given one (an old caller) must not use it.
      const r = reloaded({ reconnect: subscribe } as unknown as TerminalsOptions);
      const feed = keyedFeed();
      const stop = r.terminals.attach();
      r.terminals.sessions.open(found('term-a', feed));
      stop();
      expect(subscribe).not.toHaveBeenCalled();
      expect(Object.hasOwn(r.terminals.sessions, 'rejoin')).toBe(false);
    });
  });

  describe('learning that the tab that took a terminal has gone (the host says `released`: nothing is asked)', () => {
    const visibility = (state: 'visible' | 'hidden'): void => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    };

    beforeEach(() => {
      vi.useFakeTimers();
      visibility('visible');
    });
    afterEach(() => {
      vi.useRealTimers();
      visibility('visible');
    });

    it('asks the host nothing, on a timer, when the page is shown or when the window gets the focus, however long a terminal stays lost, and runs no timer', async () => {
      const r = reloaded({ reattach: (id) => found(id) }, [zsh('term-a')]);
      const feed = { ...keyedFeed(), refresh: vi.fn(async (): Promise<void> => undefined) };
      const stop = r.terminals.attach();
      r.terminals.sessions.open(found('term-a', feed));
      feed.set({ state: 'ended', detached: { by: 'taken-over' } });
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      expect(feed.refresh).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      stop();
    });

    it('offers the way back the moment the feed says the terminal is free, with nobody clicking and nothing asked', async () => {
      const r = reloaded({ reattach: (id) => found(id) }, [zsh('term-a')]);
      const feed = { ...keyedFeed(), refresh: vi.fn(async (): Promise<void> => undefined) };
      const stop = r.terminals.attach();
      r.terminals.sessions.open(found('term-a', feed));
      feed.set({ state: 'ended', detached: { by: 'taken-over' } });
      expect(r.terminals.sessions.canTakeBack('term-a')).toBe(false);
      feed.set({ detached: { by: 'taken-over', free: true } });
      const snapshot = r.terminals.sessions.recordOf('term-a')?.snapshot;
      expect(stateWords(snapshot)).toBe('The tab that took this terminal has closed.');
      expect(r.terminals.sessions.canTakeBack('term-a')).toBe(true);
      expect(feed.refresh).not.toHaveBeenCalled();
      stop();
    });

    it('asks a terminal whose watcher was lost once when the person comes back to the tab (visible), and not when it is hidden, on the focus or on a timer', async () => {
      const r = reloaded({ reattach: (id) => found(id) }, [zsh('term-a')]);
      const feed = { ...keyedFeed(), refresh: vi.fn(async (_options?: { readonly fresh?: boolean }): Promise<void> => undefined) };
      const stop = r.terminals.attach();
      r.terminals.sessions.open(found('term-a', feed));
      feed.set({ state: 'ended', detached: { by: 'taken-over', unwatched: true } });
      await vi.advanceTimersByTimeAsync(60_000);
      window.dispatchEvent(new Event('focus'));
      visibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(feed.refresh).not.toHaveBeenCalled();
      visibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(feed.refresh).toHaveBeenCalledTimes(1);
      expect(feed.refresh).toHaveBeenCalledWith({ fresh: true });
      expect(vi.getTimerCount()).toBe(0);
      const asked = vi.spyOn(r.terminals.sessions, 'refreshUnwatched');
      stop();
      document.dispatchEvent(new Event('visibilitychange'));
      expect(asked).not.toHaveBeenCalled();
      expect(feed.refresh).toHaveBeenCalledTimes(1);
    });

    it('does not export the poll interval', async () => {
      expect(await import('./terminals')).not.toHaveProperty('LOST_REFRESH_MS');
    });
  });

  describe('a terminal this window lost to another tab (T2d)', () => {
    /** A window with a terminal `term-a` that another tab took over: its tab is `ended`, and its feed says why. */
    function lost(options: TerminalsOptions) {
      const old = keyedFeed();
      const r = reloaded(options);
      const stop = r.terminals.attach();
      r.terminals.sessions.open(found('term-a', old));
      old.set({ state: 'ended', detached: { by: 'taken-over', free: true } });
      return { r, old, stop };
    }

    it('is taken back through the way the window was given to attach it again: the registry is made with it, and the feed it answers is the session\'s from then on', async () => {
      const again = keyedFeed({ state: 'starting' });
      const reattach = vi.fn((id: string): TerminalTarget => found(id, again));
      const { r, old, stop } = lost({ reattach });
      expect(r.terminals.sessions.canTakeBack('term-a')).toBe(true);
      await expect(r.terminals.sessions.takeBack('term-a')).resolves.toBe(true);
      expect(reattach).toHaveBeenCalledTimes(1);
      expect(reattach).toHaveBeenCalledWith('term-a');
      expect(r.terminals.sessions.feedOf('term-a')).toBe(again);
      expect(old.closed()).toBe(1);
      expect(stateOf(r.store, 'term-a')).toBe('starting');
      stop();
    });

    it('cannot be taken back in a window that was given no way to attach it again', async () => {
      const { r, old, stop } = lost({});
      expect(r.terminals.sessions.canTakeBack('term-a')).toBe(false);
      await expect(r.terminals.sessions.takeBack('term-a')).resolves.toBe(false);
      expect(r.terminals.sessions.feedOf('term-a')).toBe(old);
      expect(old.closed()).toBe(0);
      stop();
    });
  });
});

describe('the way to open an address outside the app that the window gives the Terminal tool (T3a)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is the registry\'s: what a link opens through is the window\'s option, once for each address, and without one the registry cannot open a link at all', () => {
    const open = vi.fn();
    const terminals = createTerminals(createPanelStore(), { openExternal: open });
    expect(terminals.sessions.canOpenExternal()).toBe(true);
    expect(open).not.toHaveBeenCalled();
    terminals.sessions.openExternal('https://example.com/docs');
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('https://example.com/docs');
    expect(createTerminals(createPanelStore()).sessions.canOpenExternal()).toBe(false);
  });

  it('refuses what is not an http or https address before the window is asked, with one warning on the console', () => {
    const open = vi.fn();
    const terminals = createTerminals(createPanelStore(), { openExternal: open });
    terminals.sessions.openExternal('file:///etc/passwd');
    expect(open).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
