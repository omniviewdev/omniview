import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, HOST, type Session } from '../../core/panel';
import { focusTab } from '../focus';
import type { EngineAppearance } from './engine';
import type { TerminalBusy, TerminalFeedHandle } from './feed';
import { createScreen } from './screen';
import { createScreenReaderChoice } from './screenReader';
import { ASK_MS, createTerminals } from './terminals';
import { fakeEngineLoader, fakeTerminalFeed, type FakeEngineLoader } from './testing';
import { TERMINAL_TOOL } from './tool';

vi.mock('../focus', () => ({ focusTab: vi.fn(), focusPage: vi.fn(), focusPanel: vi.fn() }));

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
    stop();
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
    unknown.terminals.store.closeSession(unknown.id);
    await settle();
    expect(screen.getByRole('alertdialog').textContent).toContain('This ends the terminal session. Programs it left running in the background may keep running.');
    unknown.stop();
    cleanup();
    const mute = withTerminal();
    mute.terminals.store.closeSession(mute.id);
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
