import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, HOST } from '../../core/panel';
import type { EngineAppearance } from './engine';
import { createScreen } from './screen';
import { createScreenReaderChoice } from './screenReader';
import { createTerminals } from './terminals';
import { fakeEngineLoader, fakeTerminalFeed, type FakeEngineLoader } from './testing';
import { TERMINAL_TOOL } from './tool';

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
