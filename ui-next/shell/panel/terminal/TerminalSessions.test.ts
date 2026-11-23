import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPanelStore, HOST, UNLOADED_CAUSE, type PanelStore } from '../../core/panel';
import type { TerminalTarget } from './feed';
import { fakeTerminalFeed, type FakeTerminalFeed } from './testing';
import { createTerminalSessions, type TerminalSessions } from './TerminalSessions';
import { TERMINAL_TOOL } from './tool';

// The registry of the feeds of the host's Terminal tool: it owns each feed from the moment a target is opened until the session goes (its tab closes, its plugin unloads, the window ends), maps what the feed says to
// what the session says, and releases what the feed holds. Against the real panel model, with invented plugins and feeds. A press always opens a NEW process: where the Logs tool shows the session a target has
// (A22: reading one item's log twice is reading it), two shells on one target are two shells, as the mock's `openTerminal` makes them.

type Harness = {
  readonly store: PanelStore;
  readonly sessions: TerminalSessions;
  readonly warn: Mock<(message: string, error?: unknown) => void>;
  readonly detach: () => void;
  /** A target of the host's, whose feed is the one the test holds. */
  readonly target: (patch?: Partial<TerminalTarget>) => { readonly target: TerminalTarget; readonly feed: FakeTerminalFeed };
};

let clock = 1_000;
let counter = 0;

function harness(options: { readonly plugins?: readonly string[] } = {}): Harness {
  clock = 1_000;
  counter = 0;
  const store = createPanelStore({ now: () => clock, newId: () => `store-${String(++counter)}` });
  store.registerTool(TERMINAL_TOOL);
  store.syncPlugins((options.plugins ?? []).map((id) => ({ id, tools: [] })));
  const warn = vi.fn<(message: string, error?: unknown) => void>();
  const sessions = createTerminalSessions(store, { newId: () => `term-${String(++counter)}`, warn });
  const detach = sessions.attach();
  return {
    store,
    sessions,
    warn,
    detach,
    target: (patch = {}) => {
      const feed = fakeTerminalFeed();
      return { feed, target: { plugin: HOST, id: 'local', title: 'Terminal', open: () => feed, ...patch } };
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('opening a session for a target', () => {
  it('opens a session in the Terminal tool for the host, on the title it gave, and the panel opens on it', () => {
    const { store, sessions, target } = harness();
    const opened = sessions.open(target().target);
    expect(opened).toBeDefined();
    const state = store.getSnapshot();
    expect(state.sessions[opened?.id ?? '']).toMatchObject({ tool: 'terminal', plugin: HOST, title: 'Terminal', scope: '', state: 'running' });
    expect(state.open).toBe(true);
    expect(store.selectors.activeTool(state)).toBe('terminal');
    expect(store.selectors.activeSession(state, 'terminal')).toBe(opened?.id);
  });

  it('opens a session for a plugin\'s target in the plugin\'s name, with its scope and the resource it belongs to', () => {
    const { store, sessions, target } = harness({ plugins: ['acme'] });
    const { target: given } = target({ plugin: 'acme', id: 'item/web-0/app', title: 'web-0', scope: 'north', resource: { label: 'Item web-0', kind: 'Item', route: { plugin: 'acme', contribution: 'item', params: { name: 'web-0' } } } });
    const opened = sessions.open(given);
    expect(store.getSnapshot().sessions[opened?.id ?? '']).toMatchObject({ plugin: 'acme', title: 'web-0', scope: 'north', route: { plugin: 'acme', contribution: 'item', params: { name: 'web-0' } } });
  });

  it('starts the process once, when the session opens, and takes no output and no input from anybody: the registry only listens', () => {
    const { sessions, target } = harness();
    const { target: given, feed } = target();
    const open = vi.spyOn(given, 'open');
    sessions.open(given);
    expect(open).toHaveBeenCalledTimes(1);
    expect(feed.listeners()).toBe(1);
    expect(feed.reads()).toBe(0);
    expect(feed.typed()).toEqual([]);
    expect(feed.sizes()).toEqual([]);
  });

  it('gives the feed back for the session, by identity, while it is open', () => {
    const { sessions, target } = harness();
    const { target: given, feed } = target();
    const opened = sessions.open(given);
    expect(sessions.feedOf(opened?.id ?? '')).toBe(feed);
    expect(sessions.feedOf('nobody')).toBeUndefined();
  });

  it('keeps what it was told of the target for the card: the id, the resource and the status the feed has now', () => {
    const { sessions, target } = harness({ plugins: ['acme'] });
    const { target: given, feed } = target({ plugin: 'acme', id: 'item/web-0/app', resource: { label: 'Item web-0', kind: 'Item' } });
    feed.set({ program: 'zsh' });
    const opened = sessions.open(given);
    expect(sessions.recordOf(opened?.id ?? '')).toMatchObject({ id: 'item/web-0/app', plugin: 'acme', resource: { label: 'Item web-0', kind: 'Item' }, snapshot: { state: 'running', program: 'zsh' } });
    expect(sessions.recordOf('nobody')).toBeUndefined();
  });

  it('opens a session that is already what its feed is: a feed that is still starting is a session that is starting', () => {
    const { store, sessions } = harness();
    const opened = sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => fakeTerminalFeed({ state: 'starting' }) });
    expect(store.getSnapshot().sessions[opened?.id ?? '']?.state).toBe('starting');
  });

  it('opens a NEW process for every press of one target: two sessions, two feeds, told apart by the strip as twins (a shell in one container twice is two shells)', () => {
    const { store, sessions } = harness();
    const feeds = [fakeTerminalFeed(), fakeTerminalFeed()];
    let next = 0;
    const open = () => feeds[next++] ?? fakeTerminalFeed();
    const first = sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open });
    const second = sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open });
    expect(first?.id).not.toBe(second?.id);
    const names = store.selectors.sessionIds(store.getSnapshot(), 'terminal').map((id) => store.selectors.sessionItem(store.getSnapshot(), id)?.name);
    expect(names).toEqual(['Terminal', 'Terminal (2)']);
    expect(sessions.feedOf(first?.id ?? '')).toBe(feeds[0]);
    expect(sessions.feedOf(second?.id ?? '')).toBe(feeds[1]);
  });
});

describe('what the registry refuses', () => {
  it('refuses a target that is not well formed without starting a process: no id, no title, no plugin, no way to open', () => {
    const { sessions, target, warn } = harness();
    const { target: good } = target();
    const open = vi.spyOn(good, 'open');
    expect(sessions.open({ ...good, id: '  ' })).toBeUndefined();
    expect(sessions.open({ ...good, title: '' })).toBeUndefined();
    expect(sessions.open({ ...good, plugin: '' })).toBeUndefined();
    expect(sessions.open({ ...good, open: undefined } as unknown as TerminalTarget)).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('opens no session when the target\'s `open` throws, says whose and for what, and leaves the next attempt free', () => {
    const { store, sessions, warn } = harness();
    const boom = new Error('boom');
    const opened = sessions.open({
      plugin: HOST,
      id: 'local',
      title: 'Terminal',
      open: () => {
        throw boom;
      },
    });
    expect(opened).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('host could not open a terminal for local'), boom);
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
  });

  it('closes the process it was handed when the session cannot open (the plugin is not live), so nothing is left running in the backend', () => {
    const { store, sessions, target, warn } = harness();
    const { target: given, feed } = target({ plugin: 'gone', id: 'item/web-0/app' });
    expect(sessions.open(given)).toBeUndefined();
    expect(feed.closed()).toBe(1);
    expect(feed.listeners()).toBe(0);
    expect(warn).toHaveBeenCalled();
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
  });

  it('stops when a listener of the panel closes the session as it opens: nothing is left listening to the feed, and no focus is asked for an id nobody holds', () => {
    const { store, sessions, target } = harness();
    store.subscribe(() => {
      for (const id of Object.keys(store.getSnapshot().sessions)) {
        store.closeSession(id);
      }
    });
    const { target: given, feed } = target();
    expect(sessions.open(given, { focus: true })).toBeUndefined();
    expect(feed.closed()).toBe(1);
    expect(feed.listeners()).toBe(0);
    expect(sessions.takeFocus('term-1')).toBe(false);
  });

  it('refuses a feed that is not one (a supplier\'s mistake) and closes what it can of it', () => {
    const { sessions, warn } = harness();
    const close = vi.fn();
    expect(sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => ({ close }) as unknown as FakeTerminalFeed })).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
    expect(sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => 'a string' as unknown as FakeTerminalFeed })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('what the session says while its feed runs', () => {
  it('follows the feed: starting, running, ended; `since` moves with the state and with nothing else', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target();
    feed.set({ state: 'starting' });
    const opened = sessions.open(given);
    const id = opened?.id ?? '';
    const read = () => store.getSnapshot().sessions[id];
    expect(read()).toMatchObject({ state: 'starting', cause: '', since: 1_000 });
    clock = 2_000;
    feed.set({ state: 'running' });
    expect(read()).toMatchObject({ state: 'running', since: 2_000 });
    clock = 3_000;
    feed.set({ state: 'running', program: 'zsh' });
    expect(read()).toMatchObject({ state: 'running', since: 2_000 });
    clock = 4_000;
    feed.set({ state: 'ended', exit: { code: 0 } });
    expect(read()).toMatchObject({ state: 'ended', cause: '', since: 4_000 });
  });

  it('fails the session with the cause as a sentence', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target();
    const opened = sessions.open(given);
    feed.set({ state: 'failed', cause: { stage: 'start', message: 'Failed to start terminal' } });
    expect(store.getSnapshot().sessions[opened?.id ?? '']).toMatchObject({ state: 'failed', cause: 'Couldn\'t start the terminal. Failed to start terminal.' });
  });

  it('is not woken by output: a wake-up with the same status writes nothing to the panel (a flood is not a change of the model)', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target();
    sessions.open(given);
    const heard = vi.fn();
    store.subscribe(heard);
    for (let index = 0; index < 100; index += 1) {
      feed.push('y\r\n');
      feed.read();
    }

    feed.wake();
    expect(heard).not.toHaveBeenCalled();
  });

  it('keeps an ended session and its feed: the output stays readable until the tab closes, and the end changes nothing else', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target();
    const opened = sessions.open(given);
    feed.push('bye\r\n');
    feed.set({ state: 'ended' });
    expect(store.getSnapshot().sessions[opened?.id ?? '']?.state).toBe('ended');
    expect(sessions.feedOf(opened?.id ?? '')).toBe(feed);
    expect(feed.closed()).toBe(0);
    expect(feed.read().bytes).toBe(5);
  });
});

describe('closing', () => {
  it('closes the process and lets go of every listener when the session\'s tab closes, and hears nothing after', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target();
    const opened = sessions.open(given);
    store.closeSession(opened?.id ?? '');
    expect(feed.closed()).toBe(1);
    expect(feed.listeners()).toBe(0);
    expect(sessions.feedOf(opened?.id ?? '')).toBeUndefined();
    expect(sessions.recordOf(opened?.id ?? '')).toBeUndefined();
    feed.set({ state: 'ended' });
    expect(store.getSnapshot().sessions[opened?.id ?? '']).toBeUndefined();
  });

  it('closes a process once, however many times the panel changes after', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target();
    const opened = sessions.open(given);
    store.closeSession(opened?.id ?? '');
    store.hide();
    store.show();
    store.activateTool('terminal');
    expect(feed.closed()).toBe(1);
  });

  it('closes through the handle the caller was given, which closes the tab and is safe to use twice', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target();
    const opened = sessions.open(given);
    opened?.close();
    opened?.close();
    expect(store.getSnapshot().sessions[opened?.id ?? '']).toBeUndefined();
    expect(feed.closed()).toBe(1);
  });

  it('catches a `close` that rejects, and one that throws, into the log: the session is closed either way', async () => {
    const { store, sessions, warn } = harness();
    const rejecting = fakeTerminalFeed({ close: async () => Promise.reject(new Error('could not end')) });
    const throwing = fakeTerminalFeed({
      close: () => {
        throw new Error('threw');
      },
    });
    const one = sessions.open({ plugin: HOST, id: 'a', title: 'one', open: () => rejecting });
    const two = sessions.open({ plugin: HOST, id: 'b', title: 'two', open: () => throwing });
    store.closeSession(one?.id ?? '');
    store.closeSession(two?.id ?? '');
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledTimes(2);
    });
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
  });

  it('does not recurse when the feed publishes as it closes: a feed tells its listeners the end before it returns', () => {
    const { store, sessions } = harness();
    const feed: FakeTerminalFeed = fakeTerminalFeed({
      close: () => {
        feed.set({ state: 'ended' });
      },
    });
    const opened = sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => feed });
    store.closeSession(opened?.id ?? '');
    expect(feed.closed()).toBe(1);
  });
});

describe('a plugin that goes away (a plugin\'s target: A21, the sessions of a host tool are kept)', () => {
  const unload = (store: PanelStore) => {
    store.syncPlugins([]);
  };

  it('closes the process of a session it was running, once, lets go of its own listener, and KEEPS the session: the same feed is still its feed and its record is still there', () => {
    const { store, sessions, target } = harness({ plugins: ['acme'] });
    const { target: given, feed } = target({ plugin: 'acme', id: 'item/web-0/app' });
    const opened = sessions.open(given);
    feed.push('output');
    unload(store);
    expect(feed.closed()).toBe(1);
    expect(feed.listeners()).toBe(0);
    expect(store.getSnapshot().sessions[opened?.id ?? '']).toMatchObject({ state: 'ended', cause: UNLOADED_CAUSE, held: true });
    expect(sessions.feedOf(opened?.id ?? '')).toBe(feed);
    expect(sessions.recordOf(opened?.id ?? '')?.id).toBe('item/web-0/app');
  });

  it('keeps a session that had ended on its own just the same: closed once at the unload, and the session exactly as it was', () => {
    const { store, sessions, target } = harness({ plugins: ['acme'] });
    const { target: given, feed } = target({ plugin: 'acme', id: 'item/web-0/app' });
    const opened = sessions.open(given);
    clock = 2_000;
    feed.set({ state: 'ended', exit: { code: 2 } });
    clock = 3_000;
    unload(store);
    expect(store.getSnapshot().sessions[opened?.id ?? '']).toMatchObject({ state: 'ended', cause: '', since: 2_000, held: true });
    expect(feed.closed()).toBe(1);
  });

  it('hears nothing more of the process it closed: what the feed publishes as it closes, and anything after, writes nothing to the session', () => {
    const { store, sessions } = harness({ plugins: ['acme'] });
    const feed: FakeTerminalFeed = fakeTerminalFeed({
      close: () => {
        feed.set({ state: 'failed', cause: { stage: 'session', message: 'Closed' } });
      },
    });
    const opened = sessions.open({ plugin: 'acme', id: 'item/web-0/app', title: 'web-0', open: () => feed });
    unload(store);
    feed.set({ state: 'running' });
    expect(store.getSnapshot().sessions[opened?.id ?? '']).toMatchObject({ state: 'ended', cause: UNLOADED_CAUSE });
  });

  it('keeps the record of a session as it was at the unload: a feed that says it runs again after its process was closed does not make the card Connected, and one that had failed stays failed', () => {
    const { store, sessions, target } = harness({ plugins: ['acme'] });
    const { target: given, feed } = target({ plugin: 'acme', id: 'item/web-0/app' });
    const opened = sessions.open(given);
    unload(store);
    feed.set({ state: 'running' });
    expect(sessions.recordOf(opened?.id ?? '')?.snapshot).toEqual({ state: 'ended' });
    const { target: other, feed: failed } = target({ plugin: 'acme', id: 'item/web-1/app' });
    store.syncPlugins([{ id: 'acme', tools: [] }]);
    const second = sessions.open(other);
    failed.set({ state: 'failed', cause: { stage: 'session', message: 'Gone' } });
    unload(store);
    failed.set({ state: 'running' });
    expect(sessions.recordOf(second?.id ?? '')?.snapshot).toEqual({ state: 'failed', cause: { stage: 'session', message: 'Gone' } });
  });

  it('leaves the sessions of the plugins that stayed, and the host\'s own', () => {
    const { store, sessions, target } = harness({ plugins: ['acme', 'other'] });
    const mine = target({ plugin: 'acme', id: 'a' });
    const theirs = target({ plugin: 'other', id: 'b' });
    const local = target();
    sessions.open(mine.target);
    sessions.open(theirs.target);
    sessions.open(local.target);
    store.syncPlugins([{ id: 'other', tools: [] }]);
    expect(mine.feed.closed()).toBe(1);
    expect(theirs.feed.closed()).toBe(0);
    expect(local.feed.closed()).toBe(0);
  });

  it('closes nothing twice: not when the panel changes after, not when the tab closes', () => {
    const { store, sessions, target } = harness({ plugins: ['acme'] });
    const { target: given, feed } = target({ plugin: 'acme', id: 'item/web-0/app' });
    const opened = sessions.open(given);
    unload(store);
    store.hide();
    store.show();
    store.syncPlugins([{ id: 'acme', tools: [] }]);
    unload(store);
    store.closeSession(opened?.id ?? '');
    expect(feed.closed()).toBe(1);
    expect(sessions.feedOf(opened?.id ?? '')).toBeUndefined();
  });
});

describe('the request to focus a new terminal (S116a: a new terminal takes the keyboard when its screen is ready)', () => {
  it('is made by a caller that starts a session for the user, and answered once: the body that shows the session asks when it is ready, and the answer is yes the first time only', () => {
    const { sessions, target } = harness();
    const opened = sessions.open(target().target, { focus: true });
    expect(sessions.takeFocus(opened?.id ?? '')).toBe(true);
    expect(sessions.takeFocus(opened?.id ?? '')).toBe(false);
  });

  it('is not made by default: a session that is restored, or opened without the user asking, never takes the keyboard', () => {
    const { sessions, target } = harness();
    const opened = sessions.open(target().target);
    expect(sessions.takeFocus(opened?.id ?? '')).toBe(false);
    expect(sessions.takeFocus('nobody')).toBe(false);
  });

  it('goes with the session: a session that closed before its screen was ready asks for nothing', () => {
    const { store, sessions, target } = harness();
    const opened = sessions.open(target().target, { focus: true });
    store.closeSession(opened?.id ?? '');
    expect(sessions.takeFocus(opened?.id ?? '')).toBe(false);
  });
});

describe('the registry\'s own end', () => {
  it('closes every process still open when it is detached, and hears the panel no more', () => {
    const { store, sessions, target, detach } = harness();
    const one = target({ id: 'one' });
    const two = target({ id: 'two' });
    const first = sessions.open(one.target);
    sessions.open(two.target);
    detach();
    expect(one.feed.closed()).toBe(1);
    expect(two.feed.closed()).toBe(1);
    expect(sessions.feedOf(first?.id ?? '')).toBeUndefined();
    store.closeSession(first?.id ?? '');
    expect(one.feed.closed()).toBe(1);
  });

  it('closes nothing a second time when it is detached while a session is held: the process was closed at the unload', () => {
    const { store, sessions, target, detach } = harness({ plugins: ['acme'] });
    const { target: given, feed } = target({ plugin: 'acme', id: 'a' });
    sessions.open(given);
    store.syncPlugins([]);
    detach();
    expect(feed.closed()).toBe(1);
  });

  it('can be attached again after it was detached (a development build runs its effects twice)', () => {
    const { store, sessions, target, detach } = harness();
    detach();
    const stop = sessions.attach();
    const { target: given, feed } = target();
    const opened = sessions.open(given);
    store.closeSession(opened?.id ?? '');
    expect(feed.closed()).toBe(1);
    stop();
  });

  it('notices a session that was closed before it was attached (a host that restores, then attaches)', () => {
    const { store, sessions, target, detach } = harness();
    detach();
    const { target: given, feed } = target();
    const opened = sessions.open(given);
    store.closeSession(opened?.id ?? '');
    sessions.attach();
    expect(feed.closed()).toBe(1);
  });
});

describe('a feed that was written badly', () => {
  it('is closed even when its unsubscribe throws: the process must not outlive its session', () => {
    const { store, sessions, warn } = harness();
    const feed = fakeTerminalFeed();
    const subscribe = feed.subscribe.bind(feed);
    const bad = {
      ...feed,
      subscribe: (listener: () => void) => {
        const stop = subscribe(listener);
        return () => {
          stop();
          throw new Error('cannot stop');
        };
      },
    };
    const opened = sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => bad });
    store.closeSession(opened?.id ?? '');
    expect(feed.closed()).toBe(1);
    expect(warn).toHaveBeenCalled();
  });

  it('is closed, and opens no session, when its status cannot be read or it cannot be listened to', () => {
    const { store, sessions, warn } = harness();
    const reading = fakeTerminalFeed();
    const listening = fakeTerminalFeed();
    expect(
      sessions.open({
        plugin: HOST,
        id: 'a',
        title: 'one',
        open: () => ({
          ...reading,
          getSnapshot: () => {
            throw new Error('unreadable');
          },
        }),
      }),
    ).toBeUndefined();
    expect(
      sessions.open({
        plugin: HOST,
        id: 'b',
        title: 'two',
        open: () => ({
          ...listening,
          subscribe: () => {
            throw new Error('deaf');
          },
        }),
      }),
    ).toBeUndefined();
    expect(reading.closed()).toBe(1);
    expect(listening.closed()).toBe(1);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
  });

  it('has the session say what the feed became while the panel announced it: a status that changed between the first read and the subscription is copied at once', () => {
    const { store, sessions } = harness();
    const feed = fakeTerminalFeed({ state: 'starting' });
    let reads = 0;
    const lagging = {
      ...feed,
      getSnapshot: () => {
        reads += 1;
        return reads === 1 ? { state: 'starting' as const } : { state: 'running' as const };
      },
    };
    const opened = sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => lagging });
    expect(store.getSnapshot().sessions[opened?.id ?? '']?.state).toBe('running');
  });
});

describe('naming the tab by what the producer says it runs', () => {
  const named = (status: { readonly program?: string | undefined }): string | undefined => status.program;

  it('keeps the title the target gave until the feed names a program, then renames the session to what the target says, and nothing else about it changes', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target({ retitle: named });
    const opened = sessions.open(given);
    const id = opened?.id ?? '';
    const before = store.getSnapshot().sessions[id];
    expect(before?.title).toBe('Terminal');
    clock = 2_000;
    feed.set({ program: 'zsh' });
    const after = store.getSnapshot().sessions[id];
    expect(after).toMatchObject({ title: 'zsh', tool: 'terminal', plugin: HOST, state: 'running', since: before?.since });
    expect(store.selectors.sessionItem(store.getSnapshot(), id)?.name).toBe('zsh');
  });

  it('renames a session whose feed already names its program when the session opens: the first status is the session\'s now', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target({ retitle: named });
    feed.set({ program: 'bash' });
    const opened = sessions.open(given);
    expect(store.getSnapshot().sessions[opened?.id ?? '']?.title).toBe('bash');
  });

  it('renames once per change and tells the panel once for each: a flood of wake-ups with the same program is no commit', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target({ retitle: named });
    sessions.open(given);
    const heard = vi.fn();
    store.subscribe(heard);
    feed.set({ program: 'zsh' });
    const afterFirst = heard.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    feed.wake();
    feed.wake();
    feed.set({ program: 'zsh', state: 'running' });
    expect(heard).toHaveBeenCalledTimes(afterFirst);
    feed.set({ program: 'fish' });
    expect(heard.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('keeps the title when the target does not say how to retitle, whatever the feed says: a plugin names its own tabs', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target();
    const opened = sessions.open(given);
    feed.set({ program: 'zsh' });
    expect(store.getSnapshot().sessions[opened?.id ?? '']?.title).toBe('Terminal');
  });

  it('keeps the title when what the target says is nothing, or white space, or its own title', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target({ retitle: (status) => (status.program === 'blank' ? '   ' : status.program === 'same' ? 'Terminal' : undefined) });
    const opened = sessions.open(given);
    for (const program of ['blank', 'same', 'other']) {
      feed.set({ program });
    }

    expect(store.getSnapshot().sessions[opened?.id ?? '']?.title).toBe('Terminal');
  });

  it('makes two shells of one name twins, as two sessions of one title are (A22): the strip tells them apart', () => {
    const { store, sessions, target } = harness();
    const first = target({ retitle: named });
    const second = target({ retitle: named });
    const one = sessions.open(first.target);
    const two = sessions.open(second.target);
    first.feed.set({ program: 'zsh' });
    second.feed.set({ program: 'zsh' });
    const strip = [one, two].map((opened) => store.selectors.sessionItem(store.getSnapshot(), opened?.id ?? '')?.name);
    expect(new Set(strip).size).toBe(2);
    expect(store.getSnapshot().sessions[one?.id ?? '']?.title).toBe('zsh');
    expect(store.getSnapshot().sessions[two?.id ?? '']?.title).toBe('zsh');
  });

  it('does not rename a session its plugin\'s unload kept: a kept session never changes again (A21)', () => {
    const { store, sessions, target } = harness({ plugins: ['acme'] });
    const { target: given, feed } = target({ plugin: 'acme', retitle: named });
    const opened = sessions.open(given);
    store.syncPlugins([]);
    feed.set({ program: 'zsh' });
    expect(store.getSnapshot().sessions[opened?.id ?? '']?.title).toBe('Terminal');
  });
});

describe('the members a feed must have', () => {
  it('refuses a feed that cannot take an acknowledgement: the host paces a terminal by what its reader took in, and a feed that ignored the count would stall the shell', () => {
    const { sessions, warn } = harness();
    const without = { ...fakeTerminalFeed(), ack: undefined } as unknown as FakeTerminalFeed;
    expect(sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => without })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('does not need a way to ask what runs in it: that is optional, and a close then asks the general question', () => {
    const { sessions } = harness();
    const feed = fakeTerminalFeed();
    expect('busy' in feed).toBe(false);
    expect(sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => feed })).toBeDefined();
  });
});
