import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, HOST } from '../../core/panel';
import type { TerminalFinished } from './feed';
import { fakeTerminalFeed } from './testing';
import { createTerminalSessions, type TerminalSessionsOptions } from './TerminalSessions';
import { TERMINAL_TOOL } from './tool';

// A COMMAND THAT FINISHED, AND THE REQUEST TO SHOW IT (issue #694 step 6). The feed says the last command that finished live (`finished`); the registry passes each, once, to whoever the window gave (a notice), and keeps the request to
// move a terminal's view to a command until the body that shows the session takes it. Against the real panel model, with invented feeds.

afterEach(() => {
  vi.restoreAllMocks();
});


const done = (id: string, extra: Partial<TerminalFinished> = {}): TerminalFinished => ({ id, exit: 0, durationMs: 20_000, timeMs: 1_000, ...extra });

function rig(options: TerminalSessionsOptions = {}) {
  const store = createPanelStore({ now: () => 1_000, newId: () => 'store-1' });
  store.registerTool(TERMINAL_TOOL);
  store.syncPlugins([]);
  const warn = vi.fn<(message: string, error?: unknown) => void>();
  const sessions = createTerminalSessions(store, { newId: () => 'term-1', warn, ...options });
  sessions.attach();
  return { store, sessions, warn };
}

describe('a command that finished (`finished`)', () => {
  function told() {
    const calls: Array<readonly [string, TerminalFinished, number]> = [];
    const r = rig({
      finished: (session, finished, generation) => {
        calls.push([session, finished, generation]);
      },
    });
    return { ...r, calls };
  }

  it('is told to the window once for each command, with the session it finished in, in the order the feed said them', () => {
    const { sessions, calls } = told();
    const feed = fakeTerminalFeed();
    const opened = sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => feed });
    expect(calls).toEqual([]);
    const first = done('c1');
    feed.set({ finished: first });
    feed.set({ finished: done('c2', { exit: 2 }) });
    expect(calls.map(([session, finished]) => [session, finished.id])).toEqual([[opened?.id, 'c1'], [opened?.id, 'c2']]);
    expect(calls[0]?.[1]).toBe(first);
  });

  it('is not told again for a status that changed in another way, nor for the same finished command said again', () => {
    const { sessions, calls } = told();
    const feed = fakeTerminalFeed();
    sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => feed });
    const first = done('c1');
    feed.set({ finished: first });
    feed.set({ program: 'zsh' });
    feed.set({ finished: first });
    feed.wake();
    expect(calls).toHaveLength(1);
  });

  it('is not told of a command the feed had said before the registry listened to it', () => {
    const { sessions, calls } = told();
    const feed = fakeTerminalFeed();
    feed.set({ finished: done('c0') });
    sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => feed });
    expect(calls).toEqual([]);
    feed.set({ finished: done('c1') });
    expect(calls.map(([, finished]) => finished.id)).toEqual(['c1']);
  });

  it('is not told of a session that was closed: its feed is let go of and says nothing to the window', () => {
    const { sessions, calls } = told();
    const feed = fakeTerminalFeed();
    const opened = sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => feed });
    opened?.close();
    feed.set({ finished: done('c1') });
    expect(calls).toEqual([]);
  });

  it('is one warning when the window\'s listener throws, and the session goes on following its feed', () => {
    const { store, sessions, warn } = rig({
      finished: () => {
        throw new Error('the notice could not be made');
      },
    });
    const feed = fakeTerminalFeed();
    const opened = sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => feed });
    feed.set({ finished: done('c1') });
    expect(warn).toHaveBeenCalledTimes(1);
    feed.set({ state: 'ended' });
    expect(store.getSnapshot().sessions[opened?.id ?? '']?.state).toBe('ended');
  });
});

describe('which terminal of a session a command finished in', () => {
  it('counts the restarts of the session: the same ids come again from c1 in the terminal a restart makes', () => {
    const calls: Array<readonly [string, number]> = [];
    const next = fakeTerminalFeed();
    const r = rig({
      finished: (session, finished, generation) => {
        calls.push([finished.id, generation]);
        expect(session).not.toBe('');
      },
      restart: (_made, session) => ({ plugin: HOST, id: 'local', title: 'Terminal', sessionId: session, open: () => next }),
    });
    const first = fakeTerminalFeed({ restart: { id: 'old' } });
    const opened = r.sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => first });
    first.set({ finished: done('c2') });
    first.set({ state: 'ended' });
    expect(r.sessions.restart(opened?.id ?? '')).toBe(true);
    next.set({ finished: done('c2', { timeMs: 2 }) });
    expect(calls).toEqual([['c2', 0], ['c2', 1]]);
  });

  it('is kept with the request to show a command, and is 0 when none is given', () => {
    const r = rig();
    const opened = r.sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => fakeTerminalFeed() });
    const id = opened?.id ?? '';
    r.sessions.requestJump(id, 'c1', 2);
    expect(r.sessions.jumpGeneration(id)).toBe(2);
    r.sessions.requestJump(id, 'c1');
    expect(r.sessions.jumpGeneration(id)).toBe(0);
    r.sessions.takeJump(id);
    expect(r.sessions.jumpGeneration(id)).toBeUndefined();
  });
});

describe('the request to move a terminal\'s view to a command (`requestJump`)', () => {
  function jumps() {
    const r = rig();
    const opened = r.sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => fakeTerminalFeed() });
    const heard = vi.fn<() => void>();
    r.sessions.subscribeJumps(heard);
    return { ...r, id: opened?.id ?? '', heard, opened };
  }

  it('is kept until the body takes it, once: the same value in between, and none after', () => {
    const { sessions, id } = jumps();
    expect(sessions.pendingJump(id)).toBeUndefined();
    expect(sessions.requestJump(id, 'c7')).toBe(true);
    expect(sessions.pendingJump(id)).toBe('c7');
    expect(sessions.pendingJump(id), 'the same value until it is taken').toBe('c7');
    expect(sessions.takeJump(id)).toBe('c7');
    expect(sessions.takeJump(id), 'the second call finds none').toBeUndefined();
    expect(sessions.pendingJump(id)).toBeUndefined();
  });

  it('is replaced by a later request for the session, and is the session\'s own: another session has none', () => {
    const { sessions, id } = jumps();
    sessions.requestJump(id, 'c1');
    sessions.requestJump(id, 'c2');
    expect(sessions.pendingJump(id)).toBe('c2');
    expect(sessions.pendingJump('other')).toBeUndefined();
  });

  it('is refused for a session the registry does not hold, and leaves nothing pending', () => {
    const { sessions, heard } = jumps();
    expect(sessions.requestJump('nobody', 'c1')).toBe(false);
    expect(sessions.pendingJump('nobody')).toBeUndefined();
    expect(heard).not.toHaveBeenCalled();
  });

  it('goes with the session: a tab that closes drops the request, and whoever follows is told', () => {
    const { sessions, id, heard, opened } = jumps();
    sessions.requestJump(id, 'c1');
    heard.mockClear();
    opened?.close();
    expect(sessions.pendingJump(id)).toBeUndefined();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('tells whoever follows once after each request, replacement and take, and nothing for a take that finds none or after a stop', () => {
    const { sessions, id, heard } = jumps();
    sessions.requestJump(id, 'c1');
    expect(heard).toHaveBeenCalledTimes(1);
    sessions.requestJump(id, 'c2');
    expect(heard).toHaveBeenCalledTimes(2);
    sessions.takeJump(id);
    expect(heard).toHaveBeenCalledTimes(3);
    sessions.takeJump(id);
    expect(heard, 'nothing was pending').toHaveBeenCalledTimes(3);
    const late = vi.fn<() => void>();
    const stop = sessions.subscribeJumps(late);
    stop();
    sessions.requestJump(id, 'c3');
    expect(late).not.toHaveBeenCalled();
  });
});
