import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createPanelStore, HOST, PANEL_VERSION, restorePanel, RESTORED_CAUSE, UNLOADED_CAUSE, type PanelState, type PanelStore } from '../../core/panel';
import type { TerminalDetached, TerminalFeedHandle, TerminalRestart, TerminalTarget } from './feed';
import { fakeTerminalFeed, type FakeTerminalFeed, type FakeTerminalFeedOptions } from './testing';
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

/** Where the page that the registry runs in is served from, in the tests: the host's server on its usual port. */
const OWN_ORIGIN = { protocol: 'http:', hostname: 'localhost', port: '34115' } as const;

let clock = 1_000;
let counter = 0;

function harness(
  options: {
    readonly plugins?: readonly string[];
    readonly initial?: PanelState | undefined;
    readonly reattach?: ((id: string) => TerminalTarget) | undefined;
    readonly restart?: ((restart: TerminalRestart, session: string) => TerminalTarget) | undefined;
    readonly openExternal?: ((url: string) => void | Promise<void>) | undefined;
    /** The page's own address, which a link must not point at (`TerminalSessionsOptions.origin`). Default: the host's server on its usual port. */
    readonly origin?: { readonly protocol: string; readonly hostname: string; readonly port: string } | undefined;
  } = {},
): Harness {
  clock = 1_000;
  counter = 0;
  const store = createPanelStore({ initial: options.initial, now: () => clock, newId: () => `store-${String(++counter)}` });
  store.registerTool(TERMINAL_TOOL);
  store.syncPlugins((options.plugins ?? []).map((id) => ({ id, tools: [] })));
  const warn = vi.fn<(message: string, error?: unknown) => void>();
  const sessions = createTerminalSessions(store, { newId: () => `term-${String(++counter)}`, warn, reattach: options.reattach, restart: options.restart, openExternal: options.openExternal, origin: options.origin ?? OWN_ORIGIN });
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

  it('keeps the name the person gave the session when the program changes again', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target({ retitle: named });
    const id = sessions.open(given)?.id ?? '';
    feed.set({ program: 'zsh' });
    store.renameSession(id, 'build');
    feed.set({ program: 'vim' });
    expect(store.getSnapshot().sessions[id]?.title).toBe('build');
  });

  it('keeps the name the person gave the session while programs set titles, and when the name is the shell\'s own', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target({ retitle: (status) => status.title ?? status.program });
    const id = sessions.open(given)?.id ?? '';
    feed.set({ program: 'zsh' });
    expect(store.getSnapshot().sessions[id]?.title).toBe('zsh');
    store.renameSession(id, 'zsh');
    feed.set({ program: 'zsh', title: 'vim: notes' });
    feed.set({ program: 'bash' });
    expect(store.getSnapshot().sessions[id]).toMatchObject({ title: 'zsh', titlePinned: true });
  });

  it('shows the title a program set while it runs and the shell\'s name after it, one change of the panel for each', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target({ retitle: (status) => status.title ?? status.program });
    const id = sessions.open(given)?.id ?? '';
    feed.set({ program: 'zsh' });
    const heard = vi.fn();
    store.subscribe(heard);
    feed.set({ program: 'zsh', title: 'vim: notes' });
    expect(store.getSnapshot().sessions[id]?.title).toBe('vim: notes');
    const afterTitle = heard.mock.calls.length;
    feed.wake();
    expect(heard).toHaveBeenCalledTimes(afterTitle);
    feed.set({ program: 'zsh', title: undefined });
    expect(store.getSnapshot().sessions[id]?.title).toBe('zsh');
  });

  it('names the tab by the program again when the person clears their name, at once and with no change of the feed', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target({ retitle: (status) => status.title ?? status.program });
    const id = sessions.open(given)?.id ?? '';
    feed.set({ program: 'zsh', title: 'vim: notes' });
    store.renameSession(id, 'mine');
    expect(store.getSnapshot().sessions[id]?.title).toBe('mine');
    store.renameSession(id, '');
    expect(store.getSnapshot().sessions[id]).toMatchObject({ title: 'vim: notes' });
    expect(store.getSnapshot().sessions[id]).not.toHaveProperty('titlePinned');
    feed.set({ program: 'zsh', title: undefined });
    expect(store.getSnapshot().sessions[id]?.title).toBe('zsh');
  });

  it('keeps a name the person gave after a reload: the saved tab says it is theirs, and the shell\'s name does not take it back', () => {
    const initial = savedPanel([{ id: 'term-a', title: 'my build', titlePinned: true }, { id: 'term-b', title: 'old shell' }]);
    const r = harness({ initial });
    const named = (status: { readonly program?: string | undefined; readonly title?: string | undefined }): string | undefined => status.title ?? status.program;
    const [a, b] = [fakeTerminalFeed(), fakeTerminalFeed()];
    a.set({ program: 'zsh' });
    b.set({ program: 'zsh' });
    r.sessions.open(terminalOf(a, 'term-a', { title: 'zsh', retitle: named }));
    r.sessions.open(terminalOf(b, 'term-b', { title: 'zsh', retitle: named }));
    expect(r.store.getSnapshot().sessions['term-a']).toMatchObject({ title: 'my build', titlePinned: true });
    expect(r.store.getSnapshot().sessions['term-b']?.title, 'a name nobody gave is the shell\'s again').toBe('zsh');
  });

  it('goes on following the program after a title longer than the panel keeps: the title it set is the one the panel holds', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target({ retitle: named });
    const id = sessions.open(given)?.id ?? '';
    feed.set({ program: 'x'.repeat(300) });
    feed.set({ program: 'vim' });
    expect(store.getSnapshot().sessions[id]?.title).toBe('vim');
  });

  it('goes on following the program when the title the target opened with is longer than the panel keeps: that title is not the person\'s', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target({ retitle: named, title: 'x'.repeat(300) });
    const id = sessions.open(given)?.id ?? '';
    feed.set({ program: 'vim' });
    expect(store.getSnapshot().sessions[id]?.title).toBe('vim');
  });

  it('stops a running session: its process is closed, the tab stays and says it ended, and nothing is left to stop', () => {
    const { store, sessions, target } = harness();
    const { target: given, feed } = target();
    const id = sessions.open(given)?.id ?? '';
    sessions.stopOf(id)?.();
    expect(feed.closed()).toBe(1);
    expect(store.getSnapshot().sessions[id]?.state).toBe('ended');
    expect(sessions.stopOf(id)).toBeUndefined();
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

  it('refuses a feed that cannot take raw bytes: a legacy mouse report would be lost without a word', () => {
    const { sessions, warn } = harness();
    const without = { ...fakeTerminalFeed(), writeBinary: undefined } as unknown as FakeTerminalFeed;
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

// ---- a window that was reloaded (T2-go): the terminals its saved tabs belonged to are found again -----------------------------------------------------------------------------------------------------------

type SavedTab = { readonly id: string; readonly title: string; readonly tool?: string; readonly plugin?: string; readonly titlePinned?: true };

/**
 * The panel a reloaded window starts from: what the last run saved, read back by the real restore, so each session is `ended` with the words of a restore and none has a feed. `active` is the session the person
 * had on screen.
 */
function savedPanel(tabs: readonly SavedTab[], active?: string): PanelState {
  const restored = restorePanel(
    {
      version: PANEL_VERSION,
      open: false,
      height: null,
      tool: 'terminal',
      active: active === undefined ? {} : { terminal: active },
      sessions: tabs.map((tab) => ({ id: tab.id, tool: tab.tool ?? 'terminal', plugin: tab.plugin ?? HOST, title: tab.title, scope: '', ...(tab.titlePinned === true ? { titlePinned: true as const } : {}) })),
    },
    { now: 500 },
  );
  if (!restored.ok) {
    throw new Error(restored.detail);
  }

  return restored.state;
}

/** The feed of a terminal that has a key: besides being closed it can be LEFT (`left` counts it), which holds the shell for its lease so that the page that comes back finds it. */
const keyedFeed = (options: FakeTerminalFeedOptions = {}): FakeTerminalFeed => fakeTerminalFeed({ ...options, leave: true });

/** A keyed feed whose `leave` does what the test says: the supplier's fault. */
const failing = (leave: () => unknown): FakeTerminalFeed => ({ ...keyedFeed(), leave });

/** What a producer hands the registry for a terminal that may have a tab already: the id of its terminal is the id of its session. */
const terminalOf = (feed: TerminalFeedHandle, sessionId: string | undefined, patch: Partial<TerminalTarget> = {}): TerminalTarget => ({ plugin: HOST, id: 'local', title: 'Terminal', sessionId, open: () => feed, ...patch });

describe('a saved tab that gets its terminal back (a window that was reloaded: T2-go)', () => {
  const zsh = (id: string): SavedTab => ({ id, title: 'zsh' });

  it('gives the feed to the saved session that has the id the target names: it is that session\'s feed, and no second session is made', () => {
    const r = harness({ initial: savedPanel([zsh('term-a'), { id: 'term-b', title: 'bash' }]) });
    const feed = keyedFeed();
    const opened = r.sessions.open(terminalOf(feed, 'term-b'));
    expect(opened?.id).toBe('term-b');
    expect(Object.keys(r.store.getSnapshot().sessions)).toEqual(['term-a', 'term-b']);
    expect(r.sessions.feedOf('term-b')).toBe(feed);
    expect(r.sessions.feedOf('term-a')).toBeUndefined();
    expect(r.sessions.recordOf('term-b')).toMatchObject({ id: 'local', plugin: HOST, snapshot: { state: 'running' } });
  });

  it('keeps its place in the strip and the title the person saw, whatever the target calls itself: two shells of one name come back as the twins they were', () => {
    const r = harness({ initial: savedPanel([zsh('term-a'), zsh('term-b'), { id: 'term-c', title: 'bash' }]) });
    const names = () => r.store.selectors.sessionIds(r.store.getSnapshot(), 'terminal').map((id) => r.store.selectors.sessionItem(r.store.getSnapshot(), id)?.name);
    expect(names()).toEqual(['zsh', 'zsh (2)', 'bash']);
    // Found in the opposite order, and under the name the host gives a terminal before its shell has said which it is.
    for (const id of ['term-c', 'term-b', 'term-a']) {
      r.sessions.open(terminalOf(fakeTerminalFeed(), id, { title: 'Terminal' }));
    }

    expect(r.store.getSnapshot().order).toEqual(['term-a', 'term-b', 'term-c']);
    expect(names()).toEqual(['zsh', 'zsh (2)', 'bash']);
  });

  it('lets the state flow from ended through starting and running to the end, one change of the panel for each: the same write as for any session, and the words of the restore go with the first', () => {
    const r = harness({ initial: savedPanel([zsh('term-a')]) });
    const read = () => r.store.getSnapshot().sessions['term-a'];
    expect(read()).toMatchObject({ state: 'ended', cause: RESTORED_CAUSE, since: 500 });
    const seen: Array<readonly [string | undefined, string | undefined, number | undefined]> = [];
    r.store.subscribe(() => {
      seen.push([read()?.state, read()?.cause, read()?.since]);
    });
    const feed = keyedFeed({ state: 'starting' });
    r.sessions.open(terminalOf(feed, 'term-a'));
    clock = 2_000;
    feed.set({ state: 'running' });
    clock = 3_000;
    feed.set({ state: 'ended', exit: { code: 0 } });
    expect(seen).toEqual([
      ['starting', '', 1_000],
      ['running', '', 2_000],
      ['ended', '', 3_000],
    ]);
  });

  it('says what the feed says at once when the terminal is running already: the tab goes from ended to running with no start in between', () => {
    const r = harness({ initial: savedPanel([zsh('term-a')]) });
    const seen: string[] = [];
    r.store.subscribe(() => {
      seen.push(r.store.getSnapshot().sessions['term-a']?.state ?? 'gone');
    });
    r.sessions.open(terminalOf(keyedFeed(), 'term-a'));
    expect(seen).toEqual(['running']);
  });

  it('says how a terminal ended while no page held it, in the host\'s words and not the restore\'s: the tab is ended, and its cause is the feed\'s', () => {
    const r = harness({ initial: savedPanel([zsh('term-a')]) });
    const feed = keyedFeed({ state: 'ended' });
    feed.set({ exit: { code: 3 } });
    r.sessions.open(terminalOf(feed, 'term-a'));
    expect(r.store.getSnapshot().sessions['term-a']).toMatchObject({ state: 'ended', cause: '' });
    expect(r.sessions.recordOf('term-a')?.snapshot).toMatchObject({ state: 'ended', exit: { code: 3 } });
  });

  it('fails the tab with the cause as a sentence when the terminal could not be taken back', () => {
    const r = harness({ initial: savedPanel([zsh('term-a')]) });
    const feed = keyedFeed({ state: 'failed' });
    feed.set({ cause: { stage: 'session', message: 'It is not there any more' } });
    r.sessions.open(terminalOf(feed, 'term-a'));
    expect(r.store.getSnapshot().sessions['term-a']).toMatchObject({ state: 'failed', cause: 'The terminal stopped. It is not there any more.' });
  });

  it('knows the feed before the panel hears of the first change: whoever listens to the panel finds the feed of the session it was told about', () => {
    const r = harness({ initial: savedPanel([zsh('term-a')]) });
    const feed = keyedFeed();
    const found: Array<TerminalFeedHandle | undefined> = [];
    r.store.subscribe(() => {
      found.push(r.sessions.feedOf('term-a'));
    });
    r.sessions.open(terminalOf(feed, 'term-a'));
    expect(found).toEqual([feed]);
  });

  it('names the tab as a new terminal is named when the feed says which program it runs, and keeps the title the person saw while it says the same', () => {
    const named = (status: { readonly program?: string | undefined }): string | undefined => status.program;
    const r = harness({ initial: savedPanel([zsh('term-a'), { id: 'term-b', title: 'Terminal' }]) });
    const same = keyedFeed();
    same.set({ program: 'zsh' });
    r.sessions.open(terminalOf(same, 'term-a', { retitle: named }));
    const early = keyedFeed();
    early.set({ program: 'bash' });
    r.sessions.open(terminalOf(early, 'term-b', { retitle: named }));
    const title = (id: string) => r.store.getSnapshot().sessions[id]?.title;
    expect(title('term-a')).toBe('zsh');
    expect(title('term-b')).toBe('bash');
    same.set({ program: 'fish' });
    expect(title('term-a')).toBe('fish');
  });

  it('moves nothing the person sees: the tab on screen stays on screen, the panel stays shut, and no terminal asks for the keyboard', () => {
    const r = harness({ initial: savedPanel([zsh('term-a'), zsh('term-b'), zsh('term-c')], 'term-b') });
    const before = r.store.getSnapshot();
    expect(r.store.selectors.activeSession(before, 'terminal')).toBe('term-b');
    for (const id of ['term-c', 'term-a', 'term-b']) {
      r.sessions.open(terminalOf(keyedFeed(), id));
    }

    const after = r.store.getSnapshot();
    expect(r.store.selectors.activeSession(after, 'terminal')).toBe('term-b');
    expect(after.open).toBe(false);
    expect(after.active).toEqual(before.active);
    expect(after.tool).toBe(before.tool);
    for (const id of ['term-a', 'term-b', 'term-c']) {
      expect(r.sessions.takeFocus(id)).toBe(false);
    }
  });

  it('leaves the panel as the person has it when they opened it before the terminals were found: the tab they are looking at stays on screen', () => {
    const r = harness({ initial: savedPanel([zsh('term-a'), zsh('term-b')], 'term-a') });
    r.store.activateSession('term-b');
    r.store.show();
    r.sessions.open(terminalOf(keyedFeed(), 'term-a'));
    expect(r.store.selectors.activeSession(r.store.getSnapshot(), 'terminal')).toBe('term-b');
    expect(r.store.getSnapshot().open).toBe(true);
  });

  it('opens a new session with the id of the terminal when no tab was saved for it (the saved document was lost): the terminal is found all the same, and is not shown when it is told not to', () => {
    const r = harness();
    const first = r.sessions.open(r.target().target);
    const feed = keyedFeed();
    const opened = r.sessions.open(terminalOf(feed, 'lost-1'), { reveal: false });
    expect(opened?.id).toBe('lost-1');
    expect(r.sessions.feedOf('lost-1')).toBe(feed);
    const after = r.store.getSnapshot();
    expect(after.sessions['lost-1']).toMatchObject({ tool: 'terminal', plugin: HOST, state: 'running' });
    expect(after.order).toEqual([first?.id, 'lost-1']);
    expect(r.store.selectors.activeSession(after, 'terminal')).toBe(first?.id);
    expect(r.sessions.takeFocus('lost-1')).toBe(false);
  });

  it('does not open the panel for a terminal that is found again when none was saved for it: the page stays as it is', () => {
    const r = harness();
    r.sessions.open(terminalOf(keyedFeed(), 'lost-1'), { reveal: false });
    expect(r.store.getSnapshot().open).toBe(false);
    expect(r.store.getSnapshot().active).toEqual({});
  });

  it('makes the session of a NEW terminal the id of the terminal as well, and shows it as it does any session the person starts: the panel opens on it and the keyboard goes in when its screen is ready', () => {
    const r = harness();
    const opened = r.sessions.open(terminalOf(keyedFeed(), 'fresh-1'), { focus: true });
    expect(opened?.id).toBe('fresh-1');
    const state = r.store.getSnapshot();
    expect(state.open).toBe(true);
    expect(r.store.selectors.activeSession(state, 'terminal')).toBe('fresh-1');
    expect(r.sessions.takeFocus('fresh-1')).toBe(true);
  });

  it('starts nothing for an id that belongs to a session of another tool, or of another plugin: it says so, and the sessions stay as they were', () => {
    const r = harness({ plugins: ['acme'], initial: savedPanel([{ id: 'log-1', title: 'build', tool: 'logs' }, { id: 'item-1', title: 'web', plugin: 'acme' }, zsh('term-a')]) });
    const open = vi.fn(() => keyedFeed());
    const before = r.store.getSnapshot();
    expect(r.sessions.open({ ...terminalOf(keyedFeed(), 'log-1'), open })).toBeUndefined();
    expect(r.sessions.open({ ...terminalOf(keyedFeed(), 'item-1'), open })).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(r.warn).toHaveBeenCalledTimes(2);
    expect(r.store.getSnapshot()).toBe(before);
  });

  it('starts nothing for a saved tab of a plugin that is not live: its tabs wait for it', () => {
    const r = harness({ initial: savedPanel([{ id: 'item-1', title: 'web', plugin: 'acme' }]) });
    const open = vi.fn(() => fakeTerminalFeed());
    expect(r.sessions.open({ plugin: 'acme', id: 'item', title: 'web', sessionId: 'item-1', open })).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(r.warn).toHaveBeenCalledTimes(1);
  });

  it('starts no second process for a terminal this registry holds already: the second open is refused, says so, and leaves the first feed alone', () => {
    const r = harness({ initial: savedPanel([zsh('term-a')]) });
    const first = keyedFeed();
    r.sessions.open(terminalOf(first, 'term-a'));
    const open = vi.fn(() => keyedFeed());
    expect(r.sessions.open({ ...terminalOf(first, 'term-a'), open })).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(r.warn).toHaveBeenCalledTimes(1);
    expect(r.sessions.feedOf('term-a')).toBe(first);
    expect(first.closed()).toBe(0);
  });

  it('refuses a session id that is not an id, before anything starts: white space, or a number', () => {
    const r = harness();
    const open = vi.fn(() => keyedFeed());
    for (const bad of ['', '   ', 7]) {
      expect(r.sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', sessionId: bad as unknown as string, open })).toBeUndefined();
    }

    expect(open).not.toHaveBeenCalled();
    expect(r.warn).toHaveBeenCalledTimes(3);
  });

  it('lets go of the feed and leaves the saved tab as it was when the feed cannot be listened to: the terminal is closed, and the tab stays ended', () => {
    const r = harness({ initial: savedPanel([zsh('term-a')]) });
    const feed = keyedFeed();
    const deaf = {
      ...feed,
      subscribe: () => {
        throw new Error('deaf');
      },
    };
    expect(r.sessions.open(terminalOf(deaf, 'term-a'))).toBeUndefined();
    expect(feed.closed()).toBe(1);
    expect(r.store.getSnapshot().sessions['term-a']).toMatchObject({ state: 'ended', cause: RESTORED_CAUSE });
    expect(r.sessions.feedOf('term-a')).toBeUndefined();
    expect(r.warn).toHaveBeenCalledTimes(1);
  });

  it('returns nothing, and holds nothing, when a listener of the panel closes the tab as its state is written', () => {
    const r = harness({ initial: savedPanel([zsh('term-a')]) });
    r.store.subscribe(() => {
      r.store.closeSession('term-a');
    });
    const feed = keyedFeed();
    expect(r.sessions.open(terminalOf(feed, 'term-a'))).toBeUndefined();
    expect(feed.closed()).toBe(1);
    expect(feed.listeners()).toBe(0);
    expect(r.sessions.feedOf('term-a')).toBeUndefined();
  });

  it('closes the terminal, and does not leave it, when the person closes the tab that came back: closing a tab is ending the shell', () => {
    const r = harness({ initial: savedPanel([zsh('term-a')]) });
    const feed = keyedFeed();
    r.sessions.open(terminalOf(feed, 'term-a'));
    r.store.closeSession('term-a');
    expect(feed.closed()).toBe(1);
    expect(feed.left()).toBe(0);
    expect(feed.listeners()).toBe(0);
    expect(r.sessions.feedOf('term-a')).toBeUndefined();
  });

  it('closes the process, and keeps the tab as it was, when the plugin of a tab that came back unloads: the rules of a session are the same for a tab that was saved (A21)', () => {
    const r = harness({ plugins: ['acme'], initial: savedPanel([{ id: 'item-1', title: 'web', plugin: 'acme' }]) });
    const feed = keyedFeed();
    r.sessions.open({ plugin: 'acme', id: 'item', title: 'web', sessionId: 'item-1', open: () => feed });
    expect(r.store.getSnapshot().sessions['item-1']?.state).toBe('running');
    r.store.syncPlugins([]);
    expect(feed.closed()).toBe(1);
    expect(feed.left()).toBe(0);
    expect(r.store.getSnapshot().sessions['item-1']).toMatchObject({ state: 'ended', cause: UNLOADED_CAUSE, held: true });
  });
});

describe('a window that goes away (T2-go: a terminal with a key is left to live out its lease, any other is closed)', () => {
  it('tells every feed that can be left that the page is going, once, and closes nothing: the shell lives on, and the tab stays as it is', () => {
    const r = harness();
    const one = keyedFeed();
    const two = keyedFeed();
    r.sessions.open(terminalOf(one, 'term-one'));
    r.sessions.open(terminalOf(two, 'term-two'));
    r.sessions.leave();
    r.sessions.leave();
    expect(one.left()).toBe(1);
    expect(two.left()).toBe(1);
    expect(one.closed() + two.closed()).toBe(0);
    expect(Object.keys(r.store.getSnapshot().sessions)).toEqual(['term-one', 'term-two']);
  });

  it('does not touch a feed that cannot be left: the page may come back, and a shell that was closed cannot', () => {
    const r = harness();
    const keyed = keyedFeed();
    const plain = fakeTerminalFeed();
    r.sessions.open(terminalOf(keyed, 'term-one'));
    r.sessions.open(terminalOf(plain, undefined));
    r.sessions.leave();
    expect(keyed.left()).toBe(1);
    expect(plain.closed()).toBe(0);
    expect(plain.listeners()).toBe(1);
  });

  it('does not leave a feed it closed already: the plugin\'s unload ended it', () => {
    const r = harness({ plugins: ['acme'] });
    const feed = keyedFeed();
    r.sessions.open({ plugin: 'acme', id: 'item', title: 'web', sessionId: 'term-one', open: () => feed });
    r.store.syncPlugins([]);
    r.sessions.leave();
    expect(feed.closed()).toBe(1);
    expect(feed.left()).toBe(0);
  });

  it('says so, and goes on with the others, when a feed cannot be left: a `leave` that throws and one that rejects are the supplier\'s', async () => {
    const r = harness();
    const throwing = failing(() => {
      throw new Error('threw');
    });
    const rejecting = failing(async () => Promise.reject(new Error('no')));
    const fine = keyedFeed();
    for (const [index, feed] of [throwing, rejecting, fine].entries()) {
      r.sessions.open(terminalOf(feed, `term-${String(index)}`));
    }

    r.sessions.leave();
    expect(fine.left()).toBe(1);
    await flush();
    expect(r.warn).toHaveBeenCalledTimes(2);
    expect(r.warn).toHaveBeenCalledWith(expect.stringContaining('host could not let go of the terminal'), expect.any(Error));
  });

  it('leaves the feeds that can be left, and closes the others, when the registry is detached (the window unmounts)', () => {
    const r = harness();
    const keyed = keyedFeed();
    const plain = fakeTerminalFeed();
    r.sessions.open(terminalOf(keyed, 'term-one'));
    r.sessions.open(terminalOf(plain, undefined));
    r.detach();
    expect(keyed.left()).toBe(1);
    expect(keyed.closed()).toBe(0);
    expect(keyed.listeners()).toBe(0);
    expect(plain.closed()).toBe(1);
    expect(plain.listeners()).toBe(0);
    expect(r.sessions.feedOf('term-one')).toBeUndefined();
  });

  it('leaves a feed once however it ends: one the page left by going away is not left again, and not closed, when the registry is detached after', () => {
    const r = harness();
    const feed = keyedFeed();
    r.sessions.open(terminalOf(feed, 'term-one'));
    r.sessions.leave();
    r.detach();
    expect(feed.left()).toBe(1);
    expect(feed.closed()).toBe(0);
    expect(feed.listeners()).toBe(0);
  });

  it('releases the entry and says so when a feed cannot be left as the registry is detached: no feed outlives its window', () => {
    const r = harness();
    const feed = failing(() => {
      throw new Error('threw');
    });
    r.sessions.open(terminalOf(feed, 'term-one'));
    r.detach();
    expect(r.warn).toHaveBeenCalledTimes(1);
    expect(feed.listeners()).toBe(0);
    expect(r.sessions.feedOf('term-one')).toBeUndefined();
  });
});

// ---- a terminal this page lost (T2d): the tab says so, and the person takes it back ---------------------------------------------------------------------------------------------------------------------

/** What the host says when another tab took the terminal and has gone: its process lives on, nobody holds it (`free`), and for this page the feed is over. */
const lostTo = (feed: FakeTerminalFeed, detached: TerminalDetached = { by: 'taken-over', free: true }): void => {
  feed.set({ state: 'ended', detached });
};

/** The state the panel has for a session. */
const stateOf = (r: Harness, id: string): string | undefined => r.store.getSnapshot().sessions[id]?.state;

/** Lets the promises that are settled run, and what follows them: what the registry does with a feed that rejects happens in the turns after it. Nothing here waits for a clock. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }
}

describe('a terminal this page lost, and takes back (T2d: its tab says so, and a press attaches it again)', () => {
  const named = (status: { readonly program?: string | undefined }): string | undefined => status.program;

  /**
   * A window with a terminal `term-a` (a `zsh`) that another tab took over and has gone: its tab is `ended` and its feed says why. `old` is the feed it had (default: one that cannot ask the host). `reattach` makes the target
   * that attaches it again, whose feed is `again` (`starting`, as the feed of an attach is until the host has answered); `open` is what that target does when it is opened.
   */
  function lost(options: { readonly again?: FakeTerminalFeed; readonly old?: FakeTerminalFeed } = {}) {
    const old = options.old ?? keyedFeed();
    const again = options.again ?? keyedFeed({ state: 'starting' });
    const open = vi.fn((): FakeTerminalFeed => again);
    const reattach = vi.fn((id: string): TerminalTarget => ({ plugin: HOST, id: 'local', title: 'Terminal', sessionId: id, retitle: named, open }));
    const r = harness({ reattach });
    r.sessions.open(terminalOf(old, 'term-a', { title: 'zsh', retitle: named }));
    lostTo(old);
    return { r, old, again, open, reattach };
  }

  describe('whether it can be taken back', () => {
    it('can, when its feed is over for this page because another tab took the terminal and has gone (nobody holds it), and the window can attach it again', () => {
      const { r } = lost();
      expect(r.sessions.canTakeBack('term-a')).toBe(true);
    });

    it.each([
      ['is still held by the tab that took it: nothing says that tab has gone', { detached: { by: 'taken-over' } }],
      ['runs', { state: 'running', detached: undefined }],
      ['is still starting', { state: 'starting', detached: undefined }],
      ['ended by itself, which nothing was lost for', { detached: undefined, exit: { code: 0 } }],
      ['ended in a way nobody told (no exit, and nothing was lost)', { detached: undefined }],
      ['ended after it was lost (its lease ran out, or its shell exited): there is nothing left to take back', { exit: { closedBy: 'detach-timeout' } }],
      ['failed', { state: 'failed', detached: undefined, cause: { stage: 'session', message: 'It broke' } }],
    ] as const)('cannot, when its terminal %s', (_, change) => {
      const { r, old } = lost();
      old.set(change);
      expect(r.sessions.canTakeBack('term-a')).toBe(false);
    });

    it('cannot, in a window that was given no way to attach a terminal again, or for an id that is no terminal of this window', () => {
      const without = harness();
      const feed = keyedFeed();
      without.sessions.open(terminalOf(feed, 'term-a'));
      lostTo(feed);
      expect(without.sessions.canTakeBack('term-a')).toBe(false);
      expect(lost().r.sessions.canTakeBack('nobody')).toBe(false);
    });

    it('cannot, for a saved tab that no terminal was found for: it has no feed that could say it was lost', async () => {
      const reattach = vi.fn();
      const r = harness({ initial: savedPanel([{ id: 'term-a', title: 'zsh' }]), reattach });
      expect(r.sessions.canTakeBack('term-a')).toBe(false);
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
      expect(reattach).not.toHaveBeenCalled();
      expect(r.warn).not.toHaveBeenCalled();
    });

    it('cannot, for the terminal of a plugin: the host\'s own attach is not what takes it back', async () => {
      const reattach = vi.fn();
      const r = harness({ plugins: ['acme'], reattach });
      const feed = keyedFeed();
      r.sessions.open({ plugin: 'acme', id: 'item', title: 'web', sessionId: 'item-1', open: () => feed });
      lostTo(feed);
      expect(r.sessions.canTakeBack('item-1')).toBe(false);
      await expect(r.sessions.takeBack('item-1')).resolves.toBe(false);
      expect(reattach).not.toHaveBeenCalled();
      expect(feed.closed()).toBe(0);
    });

    it('cannot, once the window has stopped: its entries are let go of, and nothing is attached for a page that is gone', async () => {
      const { r, reattach } = lost();
      r.detach();
      expect(r.sessions.canTakeBack('term-a')).toBe(false);
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
      expect(reattach).not.toHaveBeenCalled();
    });
  });

  describe('taking it back', () => {
    it('asks the host anew for the take-back: the answer must begin after the press, so the feed is asked for a fresh one', async () => {
      const { r, old } = lost();
      const refresh = vi.fn(async (_options?: { readonly fresh?: boolean }): Promise<void> => undefined);
      Object.assign(old, { refresh });
      await r.sessions.takeBack('term-a');
      expect(refresh).toHaveBeenCalledWith({ fresh: true });
    });

    it('attaches the terminal again for the session of its id: the window makes the target for that id, it is opened once, and its feed is the session\'s feed from then on', async () => {
      const { r, old, again, open, reattach } = lost();
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(true);
      expect(reattach).toHaveBeenCalledTimes(1);
      expect(reattach).toHaveBeenCalledWith('term-a', expect.anything());
      expect(open).toHaveBeenCalledTimes(1);
      expect(r.sessions.feedOf('term-a')).toBe(again);
      expect(r.sessions.feedOf('term-a')).not.toBe(old);
      expect(r.sessions.recordOf('term-a')).toMatchObject({ id: 'local', plugin: HOST, snapshot: { state: 'starting' } });
    });

    it('attaches a terminal by the id the producer says it has when that is not the session\'s: the terminal a restart made for a tab has an id of its own, and the tab\'s is that of the terminal it replaced (#695 step 5)', async () => {
      const { r, again, reattach } = lost({ old: keyedFeed({ id: 'term-restarted' }) });
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(true);
      expect(reattach).toHaveBeenCalledWith('term-restarted', expect.anything());
      expect(r.sessions.feedOf('term-a')).toBe(again);
    });

    it('gives the window the feed that was lost with the id, so that what it was asked to start with is carried on to the new feed (#695 step 5)', async () => {
      const { r, old, reattach } = lost();
      await r.sessions.takeBack('term-a');
      expect(reattach).toHaveBeenCalledWith('term-a', old);
    });

    it('lets go of the feed it replaces: closed once, and nobody hears it any more; the new feed has the registry for its one listener', async () => {
      const { r, old, again } = lost();
      expect(old.listeners()).toBe(1);
      await r.sessions.takeBack('term-a');
      expect(old.closed()).toBe(1);
      expect(old.listeners()).toBe(0);
      expect(again.closed()).toBe(0);
      expect(again.listeners()).toBe(1);
      old.set({ state: 'running' });
      expect(stateOf(r, 'term-a')).toBe('starting');
    });

    it('lets the state flow from ended through starting to running through the write every status takes: one change of the panel for each, the words of the loss go with the first, and `since` moves with the state', async () => {
      const { r, again } = lost();
      expect(r.store.getSnapshot().sessions['term-a']).toMatchObject({ state: 'ended' });
      expect(r.store.getSnapshot().sessions['term-a']?.cause).not.toBe('');
      const seen: Array<readonly [string | undefined, string | undefined, number | undefined]> = [];
      r.store.subscribe(() => {
        const session = r.store.getSnapshot().sessions['term-a'];
        seen.push([session?.state, session?.cause, session?.since]);
      });
      clock = 2_000;
      await r.sessions.takeBack('term-a');
      clock = 3_000;
      again.set({ state: 'running' });
      expect(seen).toEqual([
        ['starting', '', 2_000],
        ['running', '', 3_000],
      ]);
    });

    it('knows the new feed before the panel hears of the first change: whoever listens finds the feed of the session it was told about', async () => {
      const { r, again } = lost();
      const found: Array<TerminalFeedHandle | undefined> = [];
      r.store.subscribe(() => {
        found.push(r.sessions.feedOf('term-a'));
      });
      await r.sessions.takeBack('term-a');
      expect(found).toEqual([again]);
    });

    it('keeps the tab where it is, under the title the person saw: only its state moves, and the strip names its tabs as before', async () => {
      const { r } = lost();
      r.sessions.open(terminalOf(keyedFeed(), 'term-b', { title: 'zsh', scope: 'north', retitle: named }));
      r.sessions.open(terminalOf(keyedFeed(), 'term-c', { title: 'bash' }));
      const names = () => r.store.selectors.sessionIds(r.store.getSnapshot(), 'terminal').map((id) => r.store.selectors.sessionItem(r.store.getSnapshot(), id)?.name);
      const before = r.store.getSnapshot();
      const strip = names();
      expect(new Set(strip).size).toBe(3);
      clock = 2_000;
      await r.sessions.takeBack('term-a');
      const after = r.store.getSnapshot();
      expect(after.order).toEqual(before.order);
      expect(names()).toEqual(strip);
      expect(after.sessions['term-a']).toEqual({ ...before.sessions['term-a'], state: 'starting', cause: '', since: 2_000 });
      expect(after.sessions['term-b']).toBe(before.sessions['term-b']);
      expect(after.sessions['term-c']).toBe(before.sessions['term-c']);
    });

    it('names the tab as any session is named: the title the person saw stays while the feed says the same shell, and a new name renames it', async () => {
      const { r, again } = lost();
      await r.sessions.takeBack('term-a');
      const heard = vi.fn();
      r.store.subscribe(heard);
      again.set({ program: 'zsh' });
      expect(heard).not.toHaveBeenCalled();
      expect(r.store.getSnapshot().sessions['term-a']?.title).toBe('zsh');
      again.set({ program: 'fish' });
      expect(r.store.getSnapshot().sessions['term-a']?.title).toBe('fish');
    });

    it('moves nothing the person sees: the panel stays shut, the tab on screen stays on screen, and no terminal asks for the keyboard', async () => {
      const { r } = lost();
      r.sessions.open(terminalOf(keyedFeed(), 'term-b'));
      r.store.hide();
      const before = r.store.getSnapshot();
      expect(r.store.selectors.activeSession(before, 'terminal')).toBe('term-b');
      await r.sessions.takeBack('term-a');
      const after = r.store.getSnapshot();
      expect(after.open).toBe(false);
      expect(after.active).toEqual(before.active);
      expect(after.tool).toBe(before.tool);
      expect(r.store.selectors.activeSession(after, 'terminal')).toBe('term-b');
      expect(['term-a', 'term-b'].map((id) => r.sessions.takeFocus(id))).toEqual([false, false]);
    });

    it('leaves the panel as the person has it when it is open: the tab they are looking at stays on screen', async () => {
      const { r } = lost();
      r.sessions.open(terminalOf(keyedFeed(), 'term-b'));
      r.store.show();
      await r.sessions.takeBack('term-a');
      expect(r.store.getSnapshot().open).toBe(true);
      expect(r.store.selectors.activeSession(r.store.getSnapshot(), 'terminal')).toBe('term-b');
    });

    it('does nothing the second time it is pressed: one target, one feed, and the registry listens to one', async () => {
      const { r, old, again, open, reattach } = lost();
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(true);
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
      expect(reattach).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledTimes(1);
      expect(old.closed()).toBe(1);
      expect(again.closed()).toBe(0);
      expect(again.listeners()).toBe(1);
      expect(r.sessions.canTakeBack('term-a')).toBe(false);
    });

    it('can be taken back again when the terminal is lost again: each attach is a new feed, and the one before it is let go of', async () => {
      const second = keyedFeed({ state: 'starting' });
      const { r, again, open, reattach } = lost();
      open.mockImplementationOnce(() => again).mockImplementationOnce(() => second);
      await r.sessions.takeBack('term-a');
      again.set({ state: 'running' });
      lostTo(again, { by: 'taken-over', free: true });
      expect(r.sessions.canTakeBack('term-a')).toBe(true);
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(true);
      expect(reattach).toHaveBeenCalledTimes(2);
      expect(r.sessions.feedOf('term-a')).toBe(second);
      expect(again.closed()).toBe(1);
      expect(again.listeners()).toBe(0);
      expect(second.listeners()).toBe(1);
      expect(stateOf(r, 'term-a')).toBe('starting');
    });

    it('closes the terminal it was taken back with when the person closes the tab, and not the feed it replaced a second time', async () => {
      const { r, old, again } = lost();
      await r.sessions.takeBack('term-a');
      r.store.closeSession('term-a');
      expect(again.closed()).toBe(1);
      expect(again.listeners()).toBe(0);
      expect(old.closed()).toBe(1);
      expect(r.sessions.feedOf('term-a')).toBeUndefined();
    });

    it('leaves the terminal it was taken back with when the page goes away, as any terminal that has a key, even when the feed it replaced was told so before', async () => {
      const { r, old, again } = lost();
      r.sessions.leave();
      expect(old.left()).toBe(1);
      await r.sessions.takeBack('term-a');
      r.sessions.leave();
      expect(again.left()).toBe(1);
      r.detach();
      expect(again.left()).toBe(1);
      expect(again.closed()).toBe(0);
      expect(again.listeners()).toBe(0);
      expect(old.left()).toBe(1);
    });

    it('tells whoever follows the feeds once, after the swap is complete: the session has the new feed, the old one is let go of, and the status is written', async () => {
      const { r, old, again } = lost();
      const told: Array<{ readonly feed: TerminalFeedHandle | undefined; readonly closed: number; readonly state: string | undefined }> = [];
      r.sessions.subscribeFeeds(() => {
        told.push({ feed: r.sessions.feedOf('term-a'), closed: old.closed(), state: stateOf(r, 'term-a') });
      });
      await r.sessions.takeBack('term-a');
      expect(told).toHaveLength(1);
      expect(told[0]?.feed).toBe(again);
      expect(told[0]).toMatchObject({ closed: 1, state: 'starting' });
    });

    it('tells once for each swap, and for nothing else the press or the new feed does: not the second press, not what the new feed says later', async () => {
      const { r, again, open } = lost();
      const told = vi.fn();
      r.sessions.subscribeFeeds(told);
      open.mockImplementationOnce(() => again);
      await r.sessions.takeBack('term-a');
      await r.sessions.takeBack('term-a');
      again.set({ state: 'running', program: 'zsh' });
      again.push('output');
      expect(told).toHaveBeenCalledTimes(1);
    });

    it('tells once, that the session has no feed, when the tab is closed by a listener of the panel as the first status is written: the swap and what undid it are one change for whoever follows', async () => {
      const { r } = lost();
      r.store.subscribe(() => {
        if (stateOf(r, 'term-a') === 'starting') {
          r.store.closeSession('term-a');
        }
      });
      const seen: Array<TerminalFeedHandle | undefined> = [];
      r.sessions.subscribeFeeds(() => {
        seen.push(r.sessions.feedOf('term-a'));
      });
      await r.sessions.takeBack('term-a');
      expect(seen).toEqual([undefined]);
    });
  });

  describe('asking the host who holds the terminal first (a tab may have attached it after this page learned that nobody did, and attaching takes a terminal from whoever holds it)', () => {
    /**
     * A lost terminal whose feed asks the host through `refresh`, which the test answers when it likes (`gate`): `becomes` is what the feed does to its own status when the answer comes (as the real feed does with `free`).
     * `old` is the feed the session has, `base` the feed that status belongs to.
     */
    function asking(becomes?: (feed: FakeTerminalFeed) => void) {
      const gate = Promise.withResolvers<void>();
      const base = keyedFeed();
      const refresh = vi.fn(async (): Promise<void> => {
        await gate.promise;
        becomes?.(base);
      });
      const old: FakeTerminalFeed = { ...base, refresh };
      return { ...lost({ old }), base, gate, refresh };
    }

    it('asks the feed that was lost, once, and attaches nothing before the answer: the session keeps its feed while the host is asked, and swaps when the answer leaves the terminal free', async () => {
      const { r, old, again, gate, refresh, reattach } = asking();
      const pressed = r.sessions.takeBack('term-a');
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(reattach).not.toHaveBeenCalled();
      expect(r.sessions.feedOf('term-a')).toBe(old);
      expect(old.closed()).toBe(0);
      gate.resolve();
      await expect(pressed).resolves.toBe(true);
      expect(reattach).toHaveBeenCalledTimes(1);
      expect(r.sessions.feedOf('term-a')).toBe(again);
      expect(old.closed()).toBe(1);
    });

    it('changes nothing when the answer says somebody holds the terminal now: false, no target made, no feed opened, the lost feed untouched, and the button follows the feed that no longer says free', async () => {
      const { r, old, gate, reattach, open } = asking((feed) => {
        feed.set({ detached: { by: 'taken-over' } });
      });
      const pressed = r.sessions.takeBack('term-a');
      gate.resolve();
      await expect(pressed).resolves.toBe(false);
      expect(reattach).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(old.closed()).toBe(0);
      expect(old.listeners()).toBe(1);
      expect(r.sessions.feedOf('term-a')).toBe(old);
      expect(stateOf(r, 'term-a')).toBe('ended');
      expect(r.sessions.canTakeBack('term-a')).toBe(false);
      expect(r.warn).not.toHaveBeenCalled();
    });

    it('changes nothing when the terminal ended while the host was being asked: there is nothing left to take back', async () => {
      const { r, old, gate, reattach } = asking((feed) => {
        feed.set({ exit: { closedBy: 'detach-timeout' } });
      });
      const pressed = r.sessions.takeBack('term-a');
      gate.resolve();
      await expect(pressed).resolves.toBe(false);
      expect(reattach).not.toHaveBeenCalled();
      expect(r.sessions.feedOf('term-a')).toBe(old);
      expect(old.closed()).toBe(0);
    });

    it('does nothing for a session whose tab is closed while the host is being asked: false, and no target is made and no feed is opened', async () => {
      const { r, old, gate, reattach, open } = asking();
      const pressed = r.sessions.takeBack('term-a');
      r.store.closeSession('term-a');
      gate.resolve();
      await expect(pressed).resolves.toBe(false);
      expect(reattach).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
      expect(r.sessions.feedOf('term-a')).toBeUndefined();
      expect(old.closed()).toBe(1);
    });

    it('does nothing for a window that stops while the host is being asked: nothing is attached for a page that is gone', async () => {
      const { r, old, gate, reattach } = asking();
      const pressed = r.sessions.takeBack('term-a');
      r.detach();
      gate.resolve();
      await expect(pressed).resolves.toBe(false);
      expect(reattach).not.toHaveBeenCalled();
      expect(r.sessions.feedOf('term-a')).toBeUndefined();
      expect(old.left()).toBe(1);
    });

    it('does nothing the second time while one is in flight: false at once, the host is asked once, and the first still swaps', async () => {
      const { r, gate, refresh, reattach, again } = asking();
      const first = r.sessions.takeBack('term-a');
      const second = r.sessions.takeBack('term-a');
      await expect(second).resolves.toBe(false);
      expect(refresh).toHaveBeenCalledTimes(1);
      gate.resolve();
      await expect(first).resolves.toBe(true);
      expect(reattach).toHaveBeenCalledTimes(1);
      expect(r.sessions.feedOf('term-a')).toBe(again);
    });

    it('can be pressed again when the press that was in flight found the terminal held: the host is asked again, and it swaps when the page learns that nobody holds it', async () => {
      const base = keyedFeed();
      const refresh = vi.fn(async (): Promise<void> => undefined);
      refresh.mockImplementationOnce(async () => {
        base.set({ detached: { by: 'taken-over' } });
      });
      const { r, again } = lost({ old: { ...base, refresh } });
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
      lostTo(base);
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(true);
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(r.sessions.feedOf('term-a')).toBe(again);
    });

    it('does not ask the host about a terminal nobody has said is free: false at once, and nothing is asked or attached', async () => {
      const { r, old, refresh, reattach } = asking();
      old.set({ detached: { by: 'taken-over' } });
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
      expect(refresh).not.toHaveBeenCalled();
      expect(reattach).not.toHaveBeenCalled();
    });

    it.each([
      ['rejects', async (): Promise<void> => Promise.reject(new Error('the host did not answer'))],
      [
        'throws',
        (): never => {
          throw new Error('the feed broke');
        },
      ],
    ] as const)('goes on when the question %s: one warning, and what the status of the feed says decides', async (_, refresh) => {
      const { r, again } = lost({ old: { ...keyedFeed(), refresh } });
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(true);
      expect(r.sessions.feedOf('term-a')).toBe(again);
      expect(r.warn).toHaveBeenCalledTimes(1);
      expect(r.warn.mock.calls[0]?.[0]).toContain('host could not ask who holds the terminal');
    });

    it('reads the question from the feed inside what it protects: a getter that throws is one warning, and the feed is the receiver of the question when it can be read', async () => {
      const receivers: unknown[] = [];
      const base = keyedFeed();
      const asked: FakeTerminalFeed = {
        ...base,
        async refresh() {
          receivers.push(this);
        },
      };
      const first = lost({ old: asked });
      await first.r.sessions.takeBack('term-a');
      expect(receivers).toEqual([asked]);
      const unreadable = { ...keyedFeed() };
      Object.defineProperty(unreadable, 'refresh', {
        get: () => {
          throw new Error('the getter threw');
        },
        enumerable: true,
      });
      const second = lost({ old: unreadable });
      await expect(second.r.sessions.takeBack('term-a')).resolves.toBe(true);
      expect(second.r.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('a session that is gone when the new feed is ready (what the supplier runs in between may close the tab)', () => {
    /** A new feed that closes the tab as it is listened to, as a feed that calls what it is given may do; `hook.close` is set once the window exists. */
    function closing() {
      const prepared = keyedFeed({ state: 'starting' });
      const hook = { close: (): void => undefined };
      const again: FakeTerminalFeed = {
        ...prepared,
        subscribe: (listener) => {
          const stop = prepared.subscribe(listener);
          hook.close();
          return stop;
        },
      };
      return { prepared, again, hook };
    }

    it('publishes nothing when the tab is closed as the new feed is listened to: the prepared feed is let go of and closed, the registry holds none, and whoever follows the feeds is told once that the session has none', async () => {
      const { prepared, again, hook } = closing();
      const { r, old, reattach } = lost({ again });
      hook.close = () => {
        r.store.closeSession('term-a');
      };

      const seen: Array<TerminalFeedHandle | undefined> = [];
      r.sessions.subscribeFeeds(() => {
        seen.push(r.sessions.feedOf('term-a'));
      });
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
      expect(reattach).toHaveBeenCalledTimes(1);
      expect(prepared.closed()).toBe(1);
      expect(prepared.listeners()).toBe(0);
      expect(r.sessions.feedOf('term-a')).toBeUndefined();
      expect(old.closed()).toBe(1);
      expect(seen).toEqual([undefined]);
      expect(r.warn).not.toHaveBeenCalled();
    });

    it('publishes nothing either when the registry does not hear of the panel and the session is gone from it: the entry it still holds is no reason to publish a feed for a tab that is not there', async () => {
      const { prepared, again, hook } = closing();
      const old = keyedFeed();
      const r = harness({ reattach: (id) => ({ plugin: HOST, id: 'local', title: 'Terminal', sessionId: id, open: () => again }) });
      r.detach();
      r.sessions.open(terminalOf(old, 'term-a', { title: 'zsh' }));
      lostTo(old);
      hook.close = () => {
        r.store.closeSession('term-a');
      };

      const told = vi.fn();
      r.sessions.subscribeFeeds(told);
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
      expect(prepared.closed()).toBe(1);
      expect(prepared.listeners()).toBe(0);
      expect(r.sessions.feedOf('term-a')).toBe(old);
      expect(told).not.toHaveBeenCalled();
    });

    it('says nothing of a prepared feed whose listening cannot be undone: one warning for it, and still nothing published', async () => {
      const prepared = keyedFeed({ state: 'starting' });
      const hook = { close: (): void => undefined };
      const again: FakeTerminalFeed = {
        ...prepared,
        subscribe: () => {
          hook.close();
          return () => {
            throw new Error('cannot stop');
          };
        },
      };
      const { r } = lost({ again });
      hook.close = () => {
        r.store.closeSession('term-a');
      };

      await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
      expect(prepared.closed()).toBe(1);
      expect(r.warn).toHaveBeenCalledTimes(1);
      expect(r.sessions.feedOf('term-a')).toBeUndefined();
    });

    it('does not stop the swap when the new feed calls its listener as it is listened to: the old feed is still the session\'s then, and the swap is told once', async () => {
      const prepared = keyedFeed({ state: 'starting' });
      const again: FakeTerminalFeed = {
        ...prepared,
        subscribe: (listener) => {
          const stop = prepared.subscribe(listener);
          listener();
          return stop;
        },
      };
      const { r, old } = lost({ again });
      const told = vi.fn();
      r.sessions.subscribeFeeds(told);
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(true);
      expect(r.sessions.feedOf('term-a')).toBe(again);
      expect(old.closed()).toBe(1);
      expect(told).toHaveBeenCalledTimes(1);
    });
  });

  describe('an attach the host refuses', () => {
    it.each([
      ['after the feed started', false],
      ['from the first status of the feed', true],
    ] as const)('shows as the feed\'s failed state, in the host\'s words, %s: the terminal is gone, the feed it replaced is let go of, and there is nothing more to press', async (_, first) => {
      const cause = { stage: 'session', message: 'The terminal is not there any more' } as const;
      const { r, old, again } = lost({ again: first ? keyedFeed({ state: 'failed' }) : undefined });
      if (first) {
        again.set({ cause });
      }

      await r.sessions.takeBack('term-a');
      if (!first) {
        again.set({ state: 'failed', cause });
      }

      expect(r.store.getSnapshot().sessions['term-a']).toMatchObject({ state: 'failed', cause: 'The terminal stopped. The terminal is not there any more.' });
      expect(r.sessions.feedOf('term-a')).toBe(again);
      expect(old.closed()).toBe(1);
      expect(r.sessions.canTakeBack('term-a')).toBe(false);
    });
  });

  describe('an attach that cannot be made leaves the lost terminal as it was, so that it can be tried again', () => {
    const untouched = (r: Harness, old: FakeTerminalFeed): void => {
      expect(old.closed()).toBe(0);
      expect(old.listeners()).toBe(1);
      expect(r.sessions.feedOf('term-a')).toBe(old);
      expect(stateOf(r, 'term-a')).toBe('ended');
      expect(r.sessions.canTakeBack('term-a')).toBe(true);
      expect(r.warn).toHaveBeenCalledTimes(1);
      expect(r.warn.mock.calls[0]?.[0]).toContain('host could not take the terminal back');
    };

    /** A window like `lost`, whose `reattach` is the one given. */
    function lostWith(reattach: (id: string) => TerminalTarget) {
      const old = keyedFeed();
      const r = harness({ reattach });
      r.sessions.open(terminalOf(old, 'term-a', { title: 'zsh' }));
      lostTo(old);
      return { r, old };
    }

    const target = (open: () => unknown): TerminalTarget => ({ plugin: HOST, id: 'local', title: 'Terminal', open: open as TerminalTarget['open'] });

    it('when the window cannot make the target', async () => {
      const { r, old } = lostWith(() => {
        throw new Error('no key');
      });
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
      untouched(r, old);
    });

    it('when the target cannot open', async () => {
      const { r, old } = lostWith(() =>
        target(() => {
          throw new Error('no client');
        }),
      );
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
      untouched(r, old);
    });

    it('when what it opened is not a feed, and closes what it can of it', async () => {
      const close = vi.fn();
      const { r, old } = lostWith(() => target(() => ({ close })));
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
      expect(close).toHaveBeenCalledTimes(1);
      untouched(r, old);
    });

    it('when the status of the feed cannot be read, and closes the feed', async () => {
      const feed = keyedFeed({ state: 'starting' });
      const { r, old } = lostWith(() =>
        target(() => ({
          ...feed,
          getSnapshot: () => {
            throw new Error('unreadable');
          },
        })),
      );
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
      expect(feed.closed()).toBe(1);
      untouched(r, old);
    });

    it('when the feed cannot be listened to, and closes the feed', async () => {
      const feed = keyedFeed({ state: 'starting' });
      const { r, old } = lostWith(() =>
        target(() => ({
          ...feed,
          subscribe: () => {
            throw new Error('deaf');
          },
        })),
      );
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
      expect(feed.closed()).toBe(1);
      untouched(r, old);
    });

    it('and is made at the next press, when the next attach can be: the failed one left nothing behind', async () => {
      const again = keyedFeed({ state: 'starting' });
      let attempts = 0;
      const { r, old } = lostWith((id) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('no key');
        }

        return { plugin: HOST, id: 'local', title: 'Terminal', sessionId: id, open: () => again };
      });
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
      expect(r.sessions.feedOf('term-a')).toBe(old);
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(true);
      expect(r.sessions.feedOf('term-a')).toBe(again);
      expect(old.closed()).toBe(1);
      expect(old.listeners()).toBe(0);
      expect(again.listeners()).toBe(1);
      expect(r.warn).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        'the window cannot make the target',
        () => {
          throw new Error('no key');
        },
      ],
      [
        'the target cannot open',
        () =>
          target(() => {
            throw new Error('no client');
          }),
      ],
      ['what it opened is not a feed', () => target(() => ({ close: vi.fn() }))],
      [
        'the status of the feed cannot be read',
        () =>
          target(() => ({
            ...keyedFeed({ state: 'starting' }),
            getSnapshot: () => {
              throw new Error('unreadable');
            },
          })),
      ],
      [
        'the feed cannot be listened to',
        () =>
          target(() => ({
            ...keyedFeed({ state: 'starting' }),
            subscribe: () => {
              throw new Error('deaf');
            },
          })),
      ],
    ] as const)('tells nobody who follows the feeds when %s: the session keeps the feed it had', async (_, make) => {
      const { r, old } = lostWith(make);
      const told = vi.fn();
      r.sessions.subscribeFeeds(told);
      await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
      expect(told).not.toHaveBeenCalled();
      expect(r.sessions.feedOf('term-a')).toBe(old);
    });
  });

  it('says nothing when there is nothing to take back: a press that comes late (the terminal runs again, the tab is gone) is no fault', async () => {
    const { r, old, reattach } = lost();
    old.set({ state: 'running', detached: undefined });
    await expect(r.sessions.takeBack('term-a')).resolves.toBe(false);
    await expect(r.sessions.takeBack('nobody')).resolves.toBe(false);
    expect(reattach).not.toHaveBeenCalled();
    expect(r.warn).not.toHaveBeenCalled();
    expect(old.closed()).toBe(0);
  });
});

describe('the page\'s events coming back (a gap in the host\'s events lane, deleted with the lane)', () => {
  it('is not something the registry has any more: every feed connects its own stream again from the offset it has, so there is nothing to tell the feeds', () => {
    const r = harness();
    expect(Object.hasOwn(r.sessions, 'rejoin')).toBe(false);
  });
});

describe('the feed a session has can be followed (T2d: a body that was drawn before its terminal was found is told when it is, and when it changes)', () => {
  const zsh: SavedTab = { id: 'term-a', title: 'zsh' };

  it('tells once when a saved tab is given its terminal, after the change: the session has the feed and its status is written', () => {
    const r = harness({ initial: savedPanel([zsh]) });
    const told: Array<{ readonly feed: TerminalFeedHandle | undefined; readonly state: string | undefined }> = [];
    r.sessions.subscribeFeeds(() => {
      told.push({ feed: r.sessions.feedOf('term-a'), state: stateOf(r, 'term-a') });
    });
    const feed = keyedFeed();
    r.sessions.open(terminalOf(feed, 'term-a'));
    expect(told).toHaveLength(1);
    expect(told[0]?.feed).toBe(feed);
    expect(told[0]?.state).toBe('running');
  });

  it('tells once for each new terminal, whether the registry makes the id of its session or the terminal names it', () => {
    const r = harness();
    const told = vi.fn();
    r.sessions.subscribeFeeds(told);
    r.sessions.open(r.target().target);
    expect(told).toHaveBeenCalledTimes(1);
    r.sessions.open(terminalOf(keyedFeed(), 'fresh-1'));
    expect(told).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['the target is not well formed', (r: Harness) => r.sessions.open({ plugin: HOST, id: '  ', title: 'Terminal', open: () => keyedFeed() })],
    [
      'its `open` throws',
      (r: Harness) =>
        r.sessions.open({
          plugin: HOST,
          id: 'local',
          title: 'Terminal',
          open: () => {
            throw new Error('boom');
          },
        }),
    ],
    ['what it opens is not a feed', (r: Harness) => r.sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => 'a string' as unknown as FakeTerminalFeed })],
    [
      'the status of its feed cannot be read',
      (r: Harness) =>
        r.sessions.open({
          plugin: HOST,
          id: 'local',
          title: 'Terminal',
          open: () => ({
            ...keyedFeed(),
            getSnapshot: () => {
              throw new Error('unreadable');
            },
          }),
        }),
    ],
    [
      'its feed cannot be listened to',
      (r: Harness) =>
        r.sessions.open({
          plugin: HOST,
          id: 'local',
          title: 'Terminal',
          open: () => ({
            ...keyedFeed(),
            subscribe: () => {
              throw new Error('deaf');
            },
          }),
        }),
    ],
    ['the panel refuses the session, because its plugin is not live', (r: Harness) => r.sessions.open({ plugin: 'gone', id: 'item', title: 'web', open: () => keyedFeed() })],
    [
      'a listener of the panel closes the session as it opens',
      (r: Harness) => {
        r.store.subscribe(() => {
          for (const id of Object.keys(r.store.getSnapshot().sessions)) {
            r.store.closeSession(id);
          }
        });
        return r.sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => keyedFeed() });
      },
    ],
  ] as const)('does not tell for an open that comes to nothing: %s', (_, run) => {
    const r = harness();
    const told = vi.fn();
    r.sessions.subscribeFeeds(told);
    expect(run(r)).toBeUndefined();
    expect(told).not.toHaveBeenCalled();
    expect(Object.keys(r.store.getSnapshot().sessions)).toEqual([]);
  });

  it('does not tell either when a saved tab is closed by a listener of the panel as its status is written: the terminal was given to nobody', () => {
    const r = harness({ initial: savedPanel([zsh]) });
    r.store.subscribe(() => {
      r.store.closeSession('term-a');
    });
    const told = vi.fn();
    r.sessions.subscribeFeeds(told);
    const feed = keyedFeed();
    expect(r.sessions.open(terminalOf(feed, 'term-a'))).toBeUndefined();
    expect(told).not.toHaveBeenCalled();
    expect(feed.closed()).toBe(1);
  });

  it('tells once for each feed that is let go of, after it is: the person closes a tab, and the registry stops with the terminals it holds, each told with the session no longer having its feed, which is closed or left already', () => {
    const r = harness();
    const ids = ['term-a', 'term-b', 'term-c'];
    const feeds = ids.map(() => keyedFeed());
    ids.forEach((id, index) => {
      r.sessions.open(terminalOf(feeds[index] ?? keyedFeed(), id));
    });

    /** For each telling: the sessions that have a feed, and how many feeds have been closed or left. */
    const told: Array<readonly [string[], number]> = [];
    r.sessions.subscribeFeeds(() => {
      told.push([ids.filter((id) => r.sessions.feedOf(id) !== undefined), feeds.reduce((sum, feed) => sum + feed.closed() + feed.left(), 0)]);
    });
    r.store.closeSession('term-a');
    expect(told).toEqual([[['term-b', 'term-c'], 1]]);
    r.detach();
    expect(told).toEqual([
      [['term-b', 'term-c'], 1],
      [['term-c'], 2],
      [[], 3],
    ]);
  });

  it('does not tell when the session keeps its feed: a plugin\'s unload ends the process and the session stays with the very feed (A21), and nothing a feed says or the page does changes which feed a session has', () => {
    const r = harness({ plugins: ['acme'] });
    const unloaded = keyedFeed();
    const live = keyedFeed();
    r.sessions.open({ plugin: 'acme', id: 'item', title: 'web', sessionId: 'item-1', open: () => unloaded });
    r.sessions.open(terminalOf(live, 'term-a'));
    const told = vi.fn();
    r.sessions.subscribeFeeds(told);
    r.store.syncPlugins([]);
    expect(r.sessions.feedOf('item-1')).toBe(unloaded);
    live.set({ program: 'zsh' });
    live.set({ state: 'ended', exit: { code: 0 } });
    live.push('output');
    r.sessions.leave();
    expect(told).not.toHaveBeenCalled();
  });

  it('answers the same value between changes, so that it can be the snapshot of an external store: the feed while the session has it, nothing while it has none, whatever else the registry does', () => {
    const r = harness({ initial: savedPanel([zsh]) });
    expect(r.sessions.feedOf('term-a')).toBeUndefined();
    expect(r.sessions.feedOf('term-a')).toBeUndefined();
    const feed = keyedFeed();
    r.sessions.open(terminalOf(feed, 'term-a'));
    const before = r.sessions.feedOf('term-a');
    feed.set({ program: 'zsh' });
    r.sessions.open(terminalOf(keyedFeed(), 'term-b'));
    r.store.hide();
    r.store.show();
    expect(before).toBe(feed);
    expect(r.sessions.feedOf('term-a')).toBe(before);
    expect(r.sessions.feedOf('term-a')).toBe(before);
    r.store.closeSession('term-a');
    expect(r.sessions.feedOf('term-a')).toBeUndefined();
    expect(r.sessions.feedOf('term-a')).toBeUndefined();
  });

  it('stops telling a listener that unsubscribes, and unsubscribing again is harmless: the others are told as before', () => {
    const r = harness();
    const [one, two] = [vi.fn(), vi.fn()];
    const stopOne = r.sessions.subscribeFeeds(one);
    r.sessions.subscribeFeeds(two);
    r.sessions.open(terminalOf(keyedFeed(), 'term-a'));
    expect([one.mock.calls.length, two.mock.calls.length]).toEqual([1, 1]);
    stopOne();
    stopOne();
    r.sessions.open(terminalOf(keyedFeed(), 'term-b'));
    expect([one.mock.calls.length, two.mock.calls.length]).toEqual([1, 2]);
  });

  it('does not tell a listener that was unsubscribed while the others were being told: whoever stops listening is not called after', () => {
    const r = harness();
    const second = vi.fn();
    let stopSecond: () => void = () => undefined;
    r.sessions.subscribeFeeds(() => {
      stopSecond();
    });
    stopSecond = r.sessions.subscribeFeeds(second);
    r.sessions.open(terminalOf(keyedFeed(), 'term-a'));
    expect(second).not.toHaveBeenCalled();
  });

  it('goes on with the other listeners, and with what the registry was doing, when one throws: one warning each time, and every feed is still let go of when the registry stops', () => {
    const r = harness();
    const broke = new Error('the listener broke');
    r.sessions.subscribeFeeds(() => {
      throw broke;
    });
    const fine = vi.fn();
    r.sessions.subscribeFeeds(fine);
    const [a, b] = [keyedFeed(), keyedFeed()];
    r.sessions.open(terminalOf(a, 'term-a'));
    r.sessions.open(terminalOf(b, 'term-b'));
    expect(fine).toHaveBeenCalledTimes(2);
    expect(r.warn).toHaveBeenCalledTimes(2);
    expect(r.warn).toHaveBeenCalledWith(expect.stringContaining('listener of the terminal feeds'), broke);
    r.detach();
    expect([a.left(), b.left()]).toEqual([1, 1]);
    expect(fine).toHaveBeenCalledTimes(4);
  });

  it('keeps its listeners when the registry stops and attaches again (a development build runs its effects twice): a listener subscribed once is told of what the registry does after', () => {
    const r = harness();
    const told = vi.fn();
    r.sessions.subscribeFeeds(told);
    r.detach();
    const stop = r.sessions.attach();
    r.sessions.open(terminalOf(keyedFeed(), 'term-a'));
    expect(told).toHaveBeenCalledTimes(1);
    stop();
    expect(told).toHaveBeenCalledTimes(2);
  });
});

describe('who holds the terminals this page lost', () => {
  it('can take back a terminal whose watcher the host closed with no word, until the host says another tab holds it', () => {
    const r = harness({ reattach: (id) => terminalOf(keyedFeed(), id) });
    const feed = keyedFeed();
    r.sessions.open(terminalOf(feed, 'term-u'));
    feed.set({ state: 'ended', detached: { by: 'taken-over' } });
    expect(r.sessions.canTakeBack('term-u')).toBe(false);
    feed.set({ detached: { by: 'taken-over', unwatched: true } });
    expect(r.sessions.canTakeBack('term-u')).toBe(true);
    feed.set({ detached: { by: 'taken-over', unwatched: true, free: false } });
    expect(r.sessions.canTakeBack('term-u')).toBe(true);
  });

  it('attaches nothing after its fresh question unless the host said the terminal is free: a holder it never learned of is not displaced, and the button stays', async () => {
    const reattach = vi.fn((id: string) => terminalOf(keyedFeed(), id));
    const r = harness({ reattach });
    const feed = keyedFeed();
    r.sessions.open(terminalOf(feed, 'term-u'));
    feed.set({ state: 'ended', detached: { by: 'taken-over', unwatched: true } });
    for (const answer of [undefined, false] as const) {
      Object.assign(feed, {
        refresh: async (): Promise<void> => {
          if (answer === false) {
            feed.set({ detached: { by: 'taken-over', unwatched: true, free: false } });
          }
        },
      });
      await expect(r.sessions.takeBack('term-u')).resolves.toBe(false);
      expect(reattach).not.toHaveBeenCalled();
      expect(r.sessions.canTakeBack('term-u')).toBe(true);
    }

    Object.assign(feed, {
      refresh: async (): Promise<void> => {
        feed.set({ detached: { by: 'taken-over', unwatched: true, free: true } });
      },
    });
    await expect(r.sessions.takeBack('term-u')).resolves.toBe(true);
    expect(reattach).toHaveBeenCalledTimes(1);
  });

  it('skips a feed the registry has let go of (an entry kept ended by its plugin\'s unload) even when it is marked unwatched', () => {
    const r = harness({ plugins: ['acme'] });
    const feed = { ...keyedFeed(), refresh: vi.fn(async (_options?: { readonly fresh?: boolean }): Promise<void> => undefined) };
    r.sessions.open({ plugin: 'acme', id: 'item', title: 'web', sessionId: 'item-1', open: () => feed });
    feed.set({ state: 'ended', detached: { by: 'taken-over', unwatched: true } });
    expect(r.sessions.refreshUnwatched()).toBe(true);
    expect(feed.refresh).toHaveBeenCalledTimes(1);
    r.store.syncPlugins([]);
    expect(r.sessions.feedOf('item-1')).toBe(feed);
    expect(r.sessions.refreshUnwatched()).toBe(false);
    expect(feed.refresh).toHaveBeenCalledTimes(1);
  });

  it('asks every unwatched feed for a fresh answer (`refreshUnwatched`) and no other: not a watched one, not one that ended, not a running one', () => {
    const r = harness();
    const asking = (): FakeTerminalFeed & { readonly refresh: Mock<(options?: { readonly fresh?: boolean }) => Promise<void>> } => ({ ...keyedFeed(), refresh: vi.fn(async (_options?: { readonly fresh?: boolean }): Promise<void> => undefined) });
    const [unwatched, watched, finished, running] = [asking(), asking(), asking(), asking()];
    for (const [index, feed] of [unwatched, watched, finished, running].entries()) {
      r.sessions.open(terminalOf(feed, `term-${String(index)}`));
    }

    unwatched.set({ state: 'ended', detached: { by: 'taken-over', unwatched: true } });
    watched.set({ state: 'ended', detached: { by: 'taken-over' } });
    finished.set({ state: 'ended', exit: { code: 0 }, detached: { by: 'taken-over', unwatched: true } });
    expect(r.sessions.refreshUnwatched()).toBe(true);
    expect([unwatched, watched, finished, running].map((feed) => feed.refresh.mock.calls.length)).toEqual([1, 0, 0, 0]);
    expect(unwatched.refresh).toHaveBeenCalledWith({ fresh: true });
    unwatched.set({ detached: { by: 'taken-over' } });
    expect(r.sessions.refreshUnwatched()).toBe(false);
  });

  it('is not asked on a poll: the registry has no way to ask every lost feed, because the host says when a terminal is free (`released`)', () => {
    const r = harness();
    expect(r.sessions).not.toHaveProperty('refreshLost');
    expect(r.sessions).not.toHaveProperty('hasLost');
  });
});

describe('opening an address outside the app (T3a: what a person follows from a link a program wrote in a terminal)', () => {
  const ADDRESS = 'https://example.com/docs?page=2#top';

  it('can when the window gave a way to, and cannot when it gave none: a link is drawn only where it can be followed, so no link is dead', () => {
    expect(harness().sessions.canOpenExternal()).toBe(false);
    expect(harness({ openExternal: vi.fn() }).sessions.canOpenExternal()).toBe(true);
  });

  it('says the same each time it is asked: the answer is the window\'s, not a state of the registry', () => {
    const r = harness({ openExternal: vi.fn() });
    r.detach();
    expect([r.sessions.canOpenExternal(), r.sessions.canOpenExternal()]).toEqual([true, true]);
    const none = harness();
    expect([none.sessions.canOpenExternal(), none.sessions.canOpenExternal()]).toEqual([false, false]);
  });

  it('does nothing without a way, whatever it is given: no throw and no warning, for an address that is fine and for one that would be refused', () => {
    const r = harness();
    expect(() => {
      r.sessions.openExternal(ADDRESS);
      r.sessions.openExternal('javascript:alert(1)');
      r.sessions.openExternal('');
    }).not.toThrow();
    expect(r.warn).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('gives the address to the window\'s way once, as it was given and before it returns, and says nothing of it', () => {
    const open = vi.fn();
    const r = harness({ openExternal: open });
    r.sessions.openExternal(ADDRESS);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(ADDRESS);
    expect(r.warn).not.toHaveBeenCalled();
  });

  it.each([
    'http://example.com',
    'https://example.com',
    'HTTPS://EXAMPLE.COM/Path',
    'http://localhost:3000',
    'http://127.0.0.1:8080/health',
    'http://[::1]:8080/',
    'https://user:secret@example.com/private',
    'https://example.com/a%20b?q=a+b&r=%C3%A9#frag',
    'https://münchen.example/straße',
  ])('opens %j: an http or https address with a host, whatever else is in it', (address) => {
    const open = vi.fn();
    const r = harness({ openExternal: open });
    r.sessions.openExternal(address);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(address);
    expect(r.warn).not.toHaveBeenCalled();
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,<script>alert(1)</script>',
    'ftp://example.com/file',
    'mailto:someone@example.com',
    'vscode://file/etc/hosts',
    'ms-msdt:/id PCWDiagnostic',
    'blob:https://example.com/2b6f',
    'about:blank',
    '',
    '   ',
    '/docs/page',
    'docs/page.html',
    'example.com',
    'www.example.com/page',
    '//example.com/page',
    'https:example.com',
    'https:/example.com',
    'https://',
    'https:///',
    'https://:8080',
    'https://example.com:99999',
    ' https://example.com',
    'https://example.com ',
    'https://exa mple.com',
    'https://example.com/\nfoo',
    'https://example.com/\u0000',
    'http://example.com\\@evil.com',
  ])('never gives %j to the window\'s way: one warning, and no call', (address) => {
    const open = vi.fn();
    const r = harness({ openExternal: open });
    expect(() => {
      r.sessions.openExternal(address);
    }).not.toThrow();
    expect(open).not.toHaveBeenCalled();
    expect(r.warn).toHaveBeenCalledTimes(1);
    expect(r.warn.mock.calls[0]?.[0]).toBe('[terminal] the link could not be opened: only http and https addresses are opened');
  });

  // The host's own server (#696 step 1): a link that points back at the page's own port is an open redirect to the host's loopback API, so the registry does not open it, and says so once. Any other loopback port is a dev server.
  describe('the host\'s own server', () => {
    it.each(['http://localhost:34115/', 'http://127.0.0.1:34115/api/x', 'http://[::1]:34115/', 'http://0.0.0.0:34115/'])('does not open %s, and says why, once', (address) => {
      const open = vi.fn();
      const r = harness({ openExternal: open });
      r.sessions.openExternal(address);
      expect(open).not.toHaveBeenCalled();
      expect(r.warn).toHaveBeenCalledTimes(1);
      expect(r.warn.mock.calls[0]?.[0]).toBe('[terminal] the link could not be opened: it points at this app\'s own server');
    });

    it('opens a dev server on another loopback port, and the same host on the port of another page', () => {
      const open = vi.fn();
      const r = harness({ openExternal: open, origin: { protocol: 'http:', hostname: 'localhost', port: '9999' } });
      r.sessions.openExternal('http://localhost:3000/');
      r.sessions.openExternal('http://localhost:34115/');
      expect(open.mock.calls).toEqual([['http://localhost:3000/'], ['http://localhost:34115/']]);
      expect(r.warn).not.toHaveBeenCalled();
    });

    it('says whether an address is followed, for the tooltip: a web address is, the host\'s own server and any other scheme are not', () => {
      const r = harness({ openExternal: vi.fn() });
      expect(r.sessions.canFollow('https://example.com/')).toBe(true);
      expect(r.sessions.canFollow('http://localhost:3000/')).toBe(true);
      expect(r.sessions.canFollow('http://localhost:34115/')).toBe(false);
      expect(r.sessions.canFollow('file:///etc/passwd')).toBe(false);
      expect(r.sessions.canFollow('javascript:alert(1)')).toBe(false);
    });

    it('follows nothing when the window gave no way to open one', () => {
      expect(harness().sessions.canFollow('https://example.com/')).toBe(false);
    });
  });

  it('takes each press as its own: an address that was refused is no reason to refuse the next, and each good one is one call, in order', () => {
    const open = vi.fn();
    const r = harness({ openExternal: open });
    r.sessions.openExternal('https://example.com/one');
    r.sessions.openExternal('file:///etc/passwd');
    r.sessions.openExternal('http://localhost:3000');
    expect(open.mock.calls).toEqual([['https://example.com/one'], ['http://localhost:3000']]);
    expect(r.warn).toHaveBeenCalledTimes(1);
  });

  it('warns once when the way throws, and does not throw itself: whoever calls it is a click', () => {
    const broke = new Error('the host refused the address');
    const open = vi.fn(() => {
      throw broke;
    });
    const r = harness({ openExternal: open });
    expect(() => {
      r.sessions.openExternal(ADDRESS);
    }).not.toThrow();
    expect(open).toHaveBeenCalledTimes(1);
    expect(r.warn).toHaveBeenCalledTimes(1);
    expect(r.warn).toHaveBeenCalledWith('[terminal] the link could not be opened', broke);
  });

  it('warns once when the way rejects, when it does and not before, and does nothing else: the address is not tried again', async () => {
    const gate = Promise.withResolvers<void>();
    const open = vi.fn(async () => gate.promise);
    const r = harness({ openExternal: open });
    r.sessions.openExternal(ADDRESS);
    await flush();
    expect(r.warn).not.toHaveBeenCalled();
    const refused = new Error('the address has a character the host does not open');
    gate.reject(refused);
    await flush();
    expect(open).toHaveBeenCalledTimes(1);
    expect(r.warn).toHaveBeenCalledTimes(1);
    expect(r.warn).toHaveBeenCalledWith('[terminal] the link could not be opened', refused);
  });

  it('says nothing when the way answers that it opened the address, now or later', async () => {
    const gate = Promise.withResolvers<void>();
    const slow = harness({ openExternal: async () => gate.promise });
    slow.sessions.openExternal(ADDRESS);
    gate.resolve();
    await flush();
    expect(slow.warn).not.toHaveBeenCalled();
    const quick = harness({ openExternal: async () => Promise.resolve() });
    quick.sessions.openExternal(ADDRESS);
    await flush();
    expect(quick.warn).not.toHaveBeenCalled();
  });

  it('warns on the console when the registry was given no channel of its own, as it does for everything else it could not do: the same one warning for a throw and for a refusal', () => {
    const broke = new Error('the host refused the address');
    const sessions = createTerminalSessions(createPanelStore(), {
      openExternal: () => {
        throw broke;
      },
    });
    sessions.openExternal(ADDRESS);
    sessions.openExternal('file:///etc/passwd');
    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenNthCalledWith(1, '[terminal] the link could not be opened', broke);
    expect(console.warn).toHaveBeenNthCalledWith(2, '[terminal] the link could not be opened: only http and https addresses are opened');
  });
});

// Step 5 of #695: restart an ended terminal. The producer states what a restart is made from (`restart` of the feed, only once the process is over for good); the registry makes the new feed from the target the window makes for it,
// puts it in the SAME session (the tab keeps its place, its title and its pin), lets the ended feed go, and does it once.

describe('restarting an ended terminal (`restart`)', () => {
  const spec: TerminalRestart = { id: 'term-old', command: ['/bin/zsh'], cwd: '/work', env: { A: '1' } };

  type Restarting = {
    readonly h: Harness;
    readonly old: FakeTerminalFeed;
    readonly fresh: FakeTerminalFeed;
    readonly id: string;
    /** What the window was asked to make a target for, in order. */
    readonly asked: ReadonlyArray<readonly [TerminalRestart, string]>;
  };

  function restarting(options: { readonly old?: Parameters<typeof fakeTerminalFeed>[0]; readonly plugin?: string; readonly make?: (feed: FakeTerminalFeed) => TerminalTarget['open']; readonly noWindow?: boolean } = {}): Restarting {
    const fresh = fakeTerminalFeed({ state: 'starting' });
    const asked: Array<readonly [TerminalRestart, string]> = [];
    const h = harness({
      plugins: options.plugin === undefined ? [] : [options.plugin],
      ...(options.noWindow === true
        ? {}
        : {
          restart: (made, session) => {
            asked.push([made, session]);
            return { plugin: HOST, id: 'local', title: 'Terminal', sessionId: session, open: options.make?.(fresh) ?? (() => fresh) };
          },
        }),
    });
    const old = fakeTerminalFeed({ state: 'ended', restart: spec, ...options.old });
    const opened = h.sessions.open({ plugin: options.plugin ?? HOST, id: 'local', title: 'zsh', open: () => old });
    return { h, old, fresh, id: opened?.id ?? '', asked };
  }

  it('is offered for an ended terminal the producer says a restart can be made from, and not for one that has no such word', () => {
    const r = restarting();
    expect(r.h.sessions.canRestart(r.id)).toBe(true);
    expect(restarting({ old: { restart: () => undefined } }).h.sessions.canRestart('term-1')).toBe(false);
    const plain = harness({ restart: () => ({ plugin: HOST, id: 'local', title: 'Terminal', open: () => fakeTerminalFeed() }) });
    const opened = plain.sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => fakeTerminalFeed({ state: 'ended' }) });
    expect(plain.sessions.canRestart(opened?.id ?? '')).toBe(false);
  });

  it('is not offered for a terminal that runs or starts, even when the producer has a word of what it was made from', () => {
    for (const state of ['running', 'starting'] as const) {
      const r = restarting({ old: { state } });
      expect(r.h.sessions.canRestart(r.id)).toBe(false);
      expect(r.h.sessions.restart(r.id)).toBe(false);
      expect(r.asked).toEqual([]);
      expect(r.old.closed()).toBe(0);
    }
  });

  it('is not offered where the window cannot make the target, for a session nobody holds, nor for a plugin\'s terminal', () => {
    const none = restarting({ noWindow: true });
    expect(none.h.sessions.canRestart(none.id)).toBe(false);
    expect(none.h.sessions.restart(none.id)).toBe(false);
    expect(none.h.sessions.restart('nobody')).toBe(false);
    const plugin = restarting({ plugin: 'acme' });
    expect(plugin.h.sessions.canRestart(plugin.id)).toBe(false);
    expect(plugin.h.sessions.restart(plugin.id)).toBe(false);
    expect(plugin.asked).toEqual([]);
  });

  it('makes the new feed from what the producer said and the tab it is for, puts it in the SAME session and lets the ended feed go once', () => {
    const r = restarting();
    expect(r.h.sessions.restart(r.id)).toBe(true);
    expect(r.asked).toEqual([[spec, r.id]]);
    expect(r.h.sessions.feedOf(r.id)).toBe(r.fresh);
    expect(r.old.closed()).toBe(1);
    expect(r.old.listeners()).toBe(0);
    expect(r.fresh.listeners()).toBe(1);
    expect(r.fresh.closed()).toBe(0);
    expect(Object.keys(r.h.store.getSnapshot().sessions)).toEqual([r.id]);
  });

  it('says which feed the new one continues, so that the screen that shows the ended one keeps its transcript, and nothing of a feed that did not restart', () => {
    const r = restarting();
    r.h.sessions.restart(r.id);
    expect(r.h.sessions.restartedFrom(r.fresh)).toBe(r.old);
    expect(r.h.sessions.restartedFrom(r.old)).toBeUndefined();
  });

  it('follows the new feed from then on: the session is starting, then what the feed says', () => {
    const r = restarting();
    expect(r.h.store.getSnapshot().sessions[r.id]).toMatchObject({ state: 'ended' });
    r.h.sessions.restart(r.id);
    expect(r.h.store.getSnapshot().sessions[r.id]).toMatchObject({ state: 'starting', cause: '' });
    r.fresh.set({ state: 'running' });
    expect(r.h.store.getSnapshot().sessions[r.id]).toMatchObject({ state: 'running', cause: '' });
    r.fresh.set({ state: 'ended', exit: { code: 1 } });
    expect(r.h.store.getSnapshot().sessions[r.id]).toMatchObject({ state: 'ended' });
  });

  it('keeps the tab where it was in the strip, under the title it had, and a name the person gave stays theirs', () => {
    const r = restarting();
    const before = r.h.sessions.open({ plugin: HOST, id: 'local', title: 'before', open: () => fakeTerminalFeed() });
    const after = r.h.sessions.open({ plugin: HOST, id: 'local', title: 'after', open: () => fakeTerminalFeed() });
    const order = () => r.h.store.selectors.sessionIds(r.h.store.getSnapshot(), 'terminal');
    expect(order()).toEqual([r.id, before?.id, after?.id]);
    r.h.store.renameSession(r.id, 'build');
    expect(r.h.sessions.restart(r.id)).toBe(true);
    expect(order()).toEqual([r.id, before?.id, after?.id]);
    expect(r.h.store.getSnapshot().sessions[r.id]).toMatchObject({ title: 'build', titlePinned: true });
    r.fresh.set({ state: 'running', program: 'zsh' });
    expect(r.h.store.getSnapshot().sessions[r.id]).toMatchObject({ title: 'build', titlePinned: true });
  });

  it('keeps the title of a tab nobody named, and is told the shell\'s name by the new feed as any terminal of the host is', () => {
    const r = restarting();
    expect(r.h.sessions.restart(r.id)).toBe(true);
    expect(r.h.store.getSnapshot().sessions[r.id]?.title).toBe('zsh');
    expect(r.h.store.getSnapshot().sessions[r.id]?.titlePinned).toBeUndefined();
  });

  it('is done once: a second press finds a terminal that starts, and starts nothing, whether it comes after or in the middle of the first', () => {
    const r = restarting();
    expect(r.h.sessions.restart(r.id)).toBe(true);
    expect(r.h.sessions.restart(r.id)).toBe(false);
    expect(r.asked).toHaveLength(1);
    const reentrant = restarting({
      make: () => () => {
        expect(reentrant.h.sessions.restart(reentrant.id)).toBe(false);
        return reentrant.fresh;
      },
    });
    expect(reentrant.h.sessions.restart(reentrant.id)).toBe(true);
    expect(reentrant.asked).toHaveLength(1);
  });

  it('tells whoever follows the feeds once, when the new feed is the session\'s', () => {
    const r = restarting();
    const heard: Array<TerminalFeedHandle | undefined> = [];
    r.h.sessions.subscribeFeeds(() => heard.push(r.h.sessions.feedOf(r.id)));
    r.h.sessions.restart(r.id);
    expect(heard).toEqual([r.fresh]);
  });

  it('leaves the ended terminal as it was, and can be tried again, when the target cannot open: one warning', () => {
    const boom = new Error('boom');
    let attempts = 0;
    const r = restarting({
      make: (fresh) => () => {
        attempts += 1;
        if (attempts === 1) {
          throw boom;
        }

        return fresh;
      },
    });
    expect(r.h.sessions.restart(r.id)).toBe(false);
    expect(r.h.warn).toHaveBeenCalledWith(expect.stringContaining('could not restart'), boom);
    expect(r.h.sessions.feedOf(r.id)).toBe(r.old);
    expect(r.old.closed()).toBe(0);
    expect(r.h.sessions.canRestart(r.id)).toBe(true);
    expect(r.h.sessions.restart(r.id)).toBe(true);
    expect(r.h.sessions.feedOf(r.id)).toBe(r.fresh);
  });

  it('leaves the ended terminal as it was when what the target opens is not a feed, and closes what it can of it', () => {
    const close = vi.fn();
    const r = restarting({ make: () => () => ({ close }) as unknown as FakeTerminalFeed });
    expect(r.h.sessions.restart(r.id)).toBe(false);
    expect(close).toHaveBeenCalledTimes(1);
    expect(r.h.sessions.feedOf(r.id)).toBe(r.old);
    expect(r.h.warn).toHaveBeenCalled();
  });

  it('publishes nothing for a tab that was closed while the target opened, and lets the new feed go', () => {
    const r = restarting({
      make: (fresh) => () => {
        r.h.store.closeSession(r.id);
        return fresh;
      },
    });
    expect(r.h.sessions.restart(r.id)).toBe(false);
    expect(r.fresh.closed()).toBe(1);
    expect(r.fresh.listeners()).toBe(0);
    expect(r.h.sessions.feedOf(r.id)).toBeUndefined();
  });

  it('is offered after a session was stopped (Stop session): the ended feed is let go of already, and is not closed again', () => {
    const r = restarting({ old: { state: 'running', restart: () => spec } });
    r.h.sessions.stopOf(r.id)?.();
    expect(r.old.closed()).toBe(1);
    r.old.set({ state: 'ended', exit: { closedBy: 'request' } });
    expect(r.h.sessions.canRestart(r.id)).toBe(true);
    expect(r.h.sessions.restart(r.id)).toBe(true);
    expect(r.h.sessions.feedOf(r.id)).toBe(r.fresh);
    expect(r.old.closed()).toBe(1);
  });

  it('is not offered once the page is going away: the feed was left, and the terminal belongs to the page that comes back', () => {
    const r = restarting({ old: { leave: true } });
    r.h.sessions.leave();
    expect(r.h.sessions.canRestart(r.id)).toBe(false);
    expect(r.h.sessions.restart(r.id)).toBe(false);
  });

  it('keeps what a failed new feed says: a restart refused at its start is a session that failed, and offers no restart of its own', () => {
    const r = restarting({ make: () => () => fakeTerminalFeed({ state: 'failed', cause: { stage: 'start', message: 'No shell', code: 'SHELL_UNAVAILABLE' } } as never) });
    expect(r.h.sessions.restart(r.id)).toBe(true);
    expect(r.h.store.getSnapshot().sessions[r.id]).toMatchObject({ state: 'failed' });
    expect(r.h.sessions.canRestart(r.id)).toBe(false);
  });

  it('is told apart from a take-back: a terminal another tab holds is not restarted, and one that ended is not taken back', async () => {
    const reattach = vi.fn(() => ({ plugin: HOST, id: 'local', title: 'Terminal', open: () => fakeTerminalFeed() }) satisfies TerminalTarget);
    const h = harness({ reattach, restart: () => ({ plugin: HOST, id: 'local', title: 'Terminal', open: () => fakeTerminalFeed() }) });
    const lost = fakeTerminalFeed({ state: 'ended', restart: () => undefined });
    lost.set({ detached: { by: 'taken-over', free: true } });
    const opened = h.sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => lost });
    expect(h.sessions.canRestart(opened?.id ?? '')).toBe(false);
    expect(h.sessions.canTakeBack(opened?.id ?? '')).toBe(true);
    const over = h.sessions.open({ plugin: HOST, id: 'local', title: 'Terminal', open: () => fakeTerminalFeed({ state: 'ended', restart: spec }) });
    expect(h.sessions.canTakeBack(over?.id ?? '')).toBe(false);
    expect(h.sessions.canRestart(over?.id ?? '')).toBe(true);
  });
});

describe('a split (#697 step 6): a NEW terminal in a pane beside the one in front', () => {
  it('opens its session in a pane beside the active session\'s, a new process under a new id, and makes it the active pane', () => {
    const h = harness();
    const first = h.target();
    const one = h.sessions.open(first.target);
    const second = h.target();
    const two = h.sessions.open(second.target, { split: { extent: 1000 } });
    expect(two?.id).not.toBe(one?.id);
    const group = h.store.getSnapshot().panes.terminal;
    expect(group?.panes.map((pane) => pane.session)).toEqual([one?.id, two?.id]);
    expect(group?.ratios).toEqual([0.5, 0.5]);
    expect(h.store.getSnapshot().active.terminal).toBe(two?.id);
    expect(first.feed.closed()).toBe(0);
  });

  it('opens a session in no pane when it is not a split: the tool shows one session at a time, as before', () => {
    const h = harness();
    h.sessions.open(h.target().target);
    h.sessions.open(h.target().target);
    expect(h.store.getSnapshot().panes).toEqual({});
  });

  it('is refused when the panel has no room for another pane: nothing opens, the process that was started is closed again, and the refusal is warned', () => {
    const h = harness();
    h.sessions.open(h.target().target);
    const crowded = h.target();
    expect(h.sessions.open(crowded.target, { split: { extent: 150 } })).toBeUndefined();
    expect(Object.keys(h.store.getSnapshot().sessions)).toHaveLength(1);
    expect(h.store.getSnapshot().panes).toEqual({});
    expect(crowded.feed.closed()).toBe(1);
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.sessions.feedOf('term-2')).toBeUndefined();
  });
});
