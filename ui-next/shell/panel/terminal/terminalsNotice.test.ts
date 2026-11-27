import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeNotices } from '../../core/notices/testing';
import { createPanelStore, HOST } from '../../core/panel';
import type { TerminalFinished } from './feed';
import { createTerminals, type TerminalsOptions } from './terminals';
import { fakeTerminalFeed, type FakeTerminalFeed } from './testing';
import { TERMINAL_TOOL } from './tool';

// THE FINISHED-COMMAND NOTICE IN THE WINDOW (issue #694 step 6): the Terminal tool tells the window's notices of a command that ran long in a terminal that is not in front, and its Show brings that terminal forward and asks its
// body to move to the command. Real panel model, real registry, the shell's real notices store; the feeds are fakes.

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const long = (id: string, extra: Partial<TerminalFinished> = {}): TerminalFinished => ({ id, exit: 0, durationMs: 45_000, command: 'make test', timeMs: 7, ...extra });

function rig(options: Partial<TerminalsOptions> = {}, withNotices = true) {
  const fixture = makeNotices();
  const store = createPanelStore();
  store.registerTool(TERMINAL_TOOL);
  const terminals = createTerminals(store, { ...(withNotices ? { notices: fixture.store } : {}), ...options });
  terminals.attach();
  const open = (title: string): { readonly id: string; readonly feed: FakeTerminalFeed } => {
    const feed = fakeTerminalFeed();
    const opened = terminals.sessions.open({ plugin: HOST, id: 'local', title, open: () => feed });
    return { id: opened?.id ?? '', feed };
  };

  return { fixture, store, terminals, open, records: () => fixture.store.selectors.recent() };
}

describe('a command that finished in a terminal', () => {
  it('is told to the notices when the terminal is not the one in front, in the words of its tab, and is not when it is', () => {
    const { open, records, store } = rig();
    const back = open('zsh');
    const front = open('bash');
    expect(store.selectors.isShown(store.getSnapshot(), front.id), 'the session opened last is the one on screen').toBe(true);
    front.feed.set({ finished: long('c1') });
    expect(records(), 'the terminal the person is looking at').toHaveLength(0);
    back.feed.set({ finished: long('c2') });
    expect(records()).toHaveLength(1);
    expect(records()[0]).toMatchObject({ title: 'Command finished in zsh', text: 'make test · took 45 s' });
  });

  it('is told when the person is looking at the terminal in a window that is not shown (minimised, another desktop), and not when the panel is closed over it', () => {
    let windowShown = true;
    const { open, records, store } = rig({ windowShown: () => windowShown });
    const only = open('zsh');
    windowShown = false;
    only.feed.set({ finished: long('c1') });
    expect(records(), 'in front, but nobody is looking').toHaveLength(1);
    windowShown = true;
    store.hide();
    only.feed.set({ finished: long('c2', { timeMs: 8, command: 'make lint' }) });
    expect(records(), 'the panel is closed: the terminal is not in front').toHaveLength(2);
  });

  it('is not told for a short command, however many there are', () => {
    const { open, records } = rig();
    open('bash');
    const back = open('zsh');
    const other = open('fish');
    for (let at = 0; at < 20; at += 1) {
      back.feed.set({ finished: long(`c${String(at)}`, { durationMs: 2_000 + at, timeMs: at }) });
    }

    expect(records()).toHaveLength(0);
    expect(other.id).not.toBe('');
  });

  it('is nothing in a window that gave the tool no notices: it never throws and says nothing', () => {
    const { open } = rig({}, false);
    const back = open('zsh');
    open('bash');
    expect(() => {
      back.feed.set({ finished: long('c1') });
    }).not.toThrow();
  });
});

describe('Show, on the notice', () => {
  it('brings the terminal forward in the panel and asks its body to move to the command', () => {
    const { open, records, fixture, store, terminals } = rig();
    const back = open('zsh');
    open('bash');
    back.feed.set({ finished: long('c5') });
    expect(store.selectors.isShown(store.getSnapshot(), back.id)).toBe(false);
    const record = records()[0];
    expect(fixture.store.run(record?.id ?? '', 'show').status).toBe('done');
    expect(store.selectors.isShown(store.getSnapshot(), back.id)).toBe(true);
    expect(terminals.sessions.pendingJump(back.id)).toBe('c5');
  });

  it('opens a closed panel on the terminal', () => {
    const { open, records, fixture, store, terminals } = rig();
    const back = open('zsh');
    open('bash');
    store.hide();
    back.feed.set({ finished: long('c5') });
    fixture.store.run(records()[0]?.id ?? '', 'show');
    expect(store.getSnapshot().open).toBe(true);
    expect(store.selectors.isShown(store.getSnapshot(), back.id)).toBe(true);
    expect(terminals.sessions.pendingJump(back.id)).toBe('c5');
  });

  it('does nothing for a terminal whose tab was closed since: no request is left behind and nothing throws', () => {
    const { open, records, fixture, store, terminals } = rig();
    const back = open('zsh');
    open('bash');
    back.feed.set({ finished: long('c5') });
    store.closeSession(back.id);
    expect(() => fixture.store.run(records()[0]?.id ?? '', 'show')).not.toThrow();
    expect(terminals.sessions.pendingJump(back.id)).toBeUndefined();
  });
});
