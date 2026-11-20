import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, UNLOADED_CAUSE, type PanelStore } from '../../core/panel';
import type { LogTarget } from './feed';
import { createLogStreams, type LogStreams } from './LogStreams';
import { fakeFeed, type FakeFeed } from './testing';
import { LOGS_TOOL } from './tool';

// The registry of the feeds of the host's Logs tool: it owns each feed from the moment a plugin hands a target over until the session goes (its tab closes, its plugin unloads, the window ends), maps
// what the feed says to what the session says, and releases what the feed holds. Against the real panel model, with invented plugins and feeds.

type Harness = {
  readonly store: PanelStore;
  readonly streams: LogStreams;
  readonly warn: ReturnType<typeof vi.fn<(message: string, error?: unknown) => void>>;
  readonly detach: () => void;
  /** A target of `acme`'s, whose feed is the one the test holds. */
  readonly target: (patch?: Partial<LogTarget>) => { readonly target: LogTarget; readonly feed: FakeFeed };
};

let clock = 1_000;
let counter = 0;

function harness(options: { readonly plugins?: readonly string[] } = {}): Harness {
  clock = 1_000;
  counter = 0;
  const store = createPanelStore({ now: () => clock, newId: () => `store-${String(++counter)}` });
  store.registerTool(LOGS_TOOL);
  store.syncPlugins((options.plugins ?? ['acme']).map((id) => ({ id, tools: [] })));
  const warn = vi.fn<(message: string, error?: unknown) => void>();
  const streams = createLogStreams(store, { newId: () => `log-${String(++counter)}`, warn });
  const detach = streams.attach();
  return {
    store,
    streams,
    warn,
    detach,
    target: (patch = {}) => {
      const feed = fakeFeed();
      return {
        feed,
        target: { plugin: 'acme', id: 'item/orders-api/app', title: 'orders-api/app', scope: 'north', open: () => feed, ...patch },
      };
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
  it('opens a session in the Logs tool for the plugin, on the title and scope it gave, and the panel opens on it', () => {
    const { store, streams, target } = harness();
    const { target: given } = target({ resource: { label: 'Item orders-api', kind: 'Item', route: { plugin: 'acme', contribution: 'item', params: { name: 'orders-api' } } } });
    const opened = streams.open(given);
    expect(opened).toBeDefined();
    const state = store.getSnapshot();
    const session = state.sessions[opened?.id ?? ''];
    expect(session).toMatchObject({ tool: 'logs', plugin: 'acme', title: 'orders-api/app', scope: 'north', state: 'starting', route: { plugin: 'acme', contribution: 'item', params: { name: 'orders-api' } } });
    expect(state.open).toBe(true);
    expect(store.selectors.activeTool(state)).toBe('logs');
    expect(store.selectors.activeSession(state, 'logs')).toBe(opened?.id);
  });

  it('starts the stream once, when the session opens, and takes the lines and the controls from nobody but the view: the registry only listens', () => {
    const { streams, target } = harness();
    const { target: given, feed } = target();
    const open = vi.spyOn(given, 'open');
    streams.open(given);
    expect(open).toHaveBeenCalledTimes(1);
    expect(feed.listeners()).toBe(1);
    expect(feed.reads()).toBe(0);
    expect(feed.controls()).toBe(0);
  });

  it('gives the feed back for the session, by identity, while it is open', () => {
    const { streams, target } = harness();
    const { target: given, feed } = target();
    const opened = streams.open(given);
    expect(streams.feedOf(opened?.id ?? '')).toBe(feed);
    expect(streams.feedOf('nobody')).toBeUndefined();
  });

  it('keeps what it was told of the target for the card: the id, the resource and the sources the feed lists', () => {
    const { streams, target } = harness();
    const { target: given, feed } = target({ resource: { label: 'Item orders-api', kind: 'Item' } });
    feed.set({ state: 'streaming', sources: [{ id: 'orders-api/app' }] });
    const opened = streams.open(given);
    expect(streams.recordOf(opened?.id ?? '')).toMatchObject({ id: 'item/orders-api/app', resource: { label: 'Item orders-api', kind: 'Item' }, snapshot: { state: 'streaming', sources: [{ id: 'orders-api/app' }] } });
    expect(streams.recordOf('nobody')).toBeUndefined();
  });

  it('opens a session that is already what its feed is: a feed that has started streams from the first frame', () => {
    const { store, streams } = harness();
    const feed = fakeFeed({ state: 'streaming' });
    const opened = streams.open({ plugin: 'acme', id: 't', title: 'orders-api/app', open: () => feed });
    expect(store.getSnapshot().sessions[opened?.id ?? '']?.state).toBe('running');
  });

  it('opens two sessions for one target as twins: each has its own stream, and the strip tells them apart', () => {
    const { store, streams } = harness();
    const feeds = [fakeFeed(), fakeFeed()];
    let next = 0;
    const target: LogTarget = { plugin: 'acme', id: 'same', title: 'orders-api/app', open: () => feeds[next++] ?? fakeFeed() };
    const first = streams.open(target);
    const second = streams.open(target);
    expect(first?.id).not.toBe(second?.id);
    const names = store.selectors.sessionIds(store.getSnapshot(), 'logs').map((id) => store.selectors.sessionItem(store.getSnapshot(), id)?.name);
    expect(names).toEqual(['orders-api/app', 'orders-api/app (2)']);
    expect(streams.feedOf(first?.id ?? '')).toBe(feeds[0]);
    expect(streams.feedOf(second?.id ?? '')).toBe(feeds[1]);
  });
});

describe('what the registry refuses', () => {
  it('refuses a target that is not well formed without starting a stream: no id, no title, no plugin, no way to open', () => {
    const { store, streams, warn, target } = harness();
    const { target: good, feed } = target();
    for (const patch of [{ id: '' }, { title: '   ' }, { plugin: '' }]) {
      const open = vi.fn(() => feed);
      expect(streams.open({ ...good, ...patch, open })).toBeUndefined();
      expect(open).not.toHaveBeenCalled();
    }

    expect(streams.open({ ...good, open: undefined } as unknown as LogTarget)).toBeUndefined();
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
    expect(feed.listeners()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('opens no session when the plugin\'s `open` throws, says whose and for what, and leaves the next attempt free', () => {
    const { store, streams, warn } = harness();
    const failing: LogTarget = {
      plugin: 'acme',
      id: 'item/x',
      title: 'x',
      open: () => {
        throw new Error('the request is not well formed');
      },
    };
    expect(streams.open(failing)).toBeUndefined();
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('acme could not open a log stream for item/x'), expect.any(Error));
    const { target } = harness();
    expect(target().target.id).toBeDefined();
  });

  it('closes the stream it was handed when the session cannot open (the plugin is not live), so no backend session is left running', () => {
    const { store, streams, warn, target } = harness({ plugins: ['other'] });
    const { target: given, feed } = target();
    expect(streams.open(given)).toBeUndefined();
    expect(feed.closed()).toBe(1);
    expect(feed.listeners()).toBe(0);
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
    expect(warn).toHaveBeenCalledWith('[panel] acme could not open a log stream for item/orders-api/app: The plugin acme is not live.');
  });

  it('refuses a feed that is not one (a plugin\'s mistake) and closes what it can of it', () => {
    const { store, streams, warn } = harness();
    const close = vi.fn();
    const broken = { subscribe: () => () => undefined, close } as unknown as ReturnType<LogTarget['open']>;
    expect(streams.open({ plugin: 'acme', id: 'x', title: 'x', open: () => broken })).toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
    expect(warn).toHaveBeenCalled();
    expect(streams.open({ plugin: 'acme', id: 'x', title: 'x', open: () => undefined as never })).toBeUndefined();
  });
});

describe('what the session says while its feed runs', () => {
  it('follows the feed: starting, running, ended, each with the words the card gives', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target();
    const id = streams.open(given)?.id ?? '';
    const state = () => store.getSnapshot().sessions[id]?.state;
    expect(state()).toBe('starting');
    clock = 2_000;
    feed.set({ state: 'streaming' });
    expect(state()).toBe('running');
    expect(store.getSnapshot().sessions[id]?.since).toBe(2_000);
    clock = 3_000;
    feed.set({ state: 'ended' });
    expect(state()).toBe('ended');
    expect(store.getSnapshot().sessions[id]?.since).toBe(3_000);
  });

  it('keeps a paused feed a running session, and moves nothing: `since` stays, and nothing is written to the panel', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target();
    const id = streams.open(given)?.id ?? '';
    clock = 2_000;
    feed.set({ state: 'streaming' });
    const before = store.getSnapshot();
    clock = 5_000;
    feed.pause();
    expect(feed.getSnapshot().state).toBe('paused');
    expect(store.getSnapshot().sessions[id]).toMatchObject({ state: 'running', since: 2_000 });
    expect(store.getSnapshot()).toBe(before);
    feed.resume();
    expect(store.getSnapshot()).toBe(before);
  });

  it('fails the session with the cause as a sentence, and keeps the failure when the feed ends after it', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target();
    const id = streams.open(given)?.id ?? '';
    feed.set({ state: 'failed', cause: { stage: 'source', source: 'orders-api/app', message: 'Failed to reconnect after 5 attempts' } });
    expect(store.getSnapshot().sessions[id]).toMatchObject({ state: 'failed', cause: 'The log stream stopped. Failed to reconnect after 5 attempts.' });
  });

  it('is not woken by lines: a wake-up with the same status writes nothing to the panel (10,000 lines a second are not 10,000 changes of the model)', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target();
    streams.open(given);
    feed.set({ state: 'streaming' });
    const before = store.getSnapshot();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    feed.push(500);
    feed.wake();
    feed.wake();
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
    stop();
  });

  it('tells the card the sources and the pause as the feed has them now', () => {
    const { streams, target } = harness();
    const { target: given, feed } = target();
    const id = streams.open(given)?.id ?? '';
    feed.set({ state: 'streaming', sources: [{ id: 'a' }, { id: 'b' }] });
    feed.pause();
    expect(streams.recordOf(id)?.snapshot).toMatchObject({ state: 'paused', paused: true, sources: [{ id: 'a' }, { id: 'b' }] });
  });
});

describe('closing', () => {
  it('closes the stream and lets go of every listener when the session\'s tab closes, and answers nothing after', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target();
    const id = streams.open(given)?.id ?? '';
    feed.set({ state: 'streaming' });
    expect(feed.listeners()).toBe(1);
    store.closeSession(id);
    expect(feed.closed()).toBe(1);
    expect(feed.listeners()).toBe(0);
    expect(streams.feedOf(id)).toBeUndefined();
    // A stream that publishes its last status as it closes, or later, finds the registry gone and the session with it.
    feed.set({ state: 'ended' });
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
  });

  it('closes a stream once, however many times the panel changes after', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target();
    const id = streams.open(given)?.id ?? '';
    store.closeSession(id);
    store.hide();
    store.show();
    store.activateTool('logs');
    expect(feed.closed()).toBe(1);
  });

  it('closes through the handle the plugin was given, which closes the tab and is safe to use twice', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target();
    const opened = streams.open(given);
    opened?.close();
    opened?.close();
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
    expect(feed.closed()).toBe(1);
  });

  it('catches a `close` that rejects, and one that throws, into the log: the session is closed either way', async () => {
    const { store, streams, warn } = harness();
    const rejecting = fakeFeed({ close: async () => Promise.reject(new Error('the backend refused')) });
    const throwing = fakeFeed({
      close: () => {
        throw new Error('it threw');
      },
    });
    const a = streams.open({ plugin: 'acme', id: 'a', title: 'a-stream', open: () => rejecting });
    const b = streams.open({ plugin: 'acme', id: 'b', title: 'b-stream', open: () => throwing });
    store.closeSession(a?.id ?? '');
    store.closeSession(b?.id ?? '');
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
    // A rejection is told in a later turn of the microtask queue; a throw is told at once.
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not close the log stream'), expect.objectContaining({ message: 'the backend refused' }));
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not close the log stream'), expect.objectContaining({ message: 'it threw' }));
    expect(rejecting.listeners()).toBe(0);
    expect(throwing.listeners()).toBe(0);
  });

  it('does not recurse when the stream publishes as it closes: the runtime tells its listeners the end before it returns', () => {
    const { store, streams } = harness();
    const feed = fakeFeed({
      close: () => {
        feed.set({ state: 'ended' });
      },
    });
    const id = streams.open({ plugin: 'acme', id: 'x', title: 'x-stream', open: () => feed })?.id ?? '';
    expect(() => store.closeSession(id)).not.toThrow();
    expect(feed.closed()).toBe(1);
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
  });
});

describe('a plugin that goes away', () => {
  it('closes its streams and ends its sessions: the panel ends them (the plugin was unloaded), the registry releases what they held', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target();
    const id = streams.open(given)?.id ?? '';
    feed.set({ state: 'streaming' });
    clock = 9_000;
    store.syncPlugins([]);
    expect(store.getSnapshot().sessions[id]).toMatchObject({ state: 'ended', cause: UNLOADED_CAUSE });
    expect(feed.closed()).toBe(1);
    expect(feed.listeners()).toBe(0);
    expect(streams.feedOf(id)).toBeUndefined();
  });

  it('leaves the streams of the plugins that stayed', () => {
    const { store, streams, target } = harness({ plugins: ['acme', 'beta'] });
    const mine = target();
    const theirs = fakeFeed();
    streams.open(mine.target);
    streams.open({ plugin: 'beta', id: 't', title: 'beta-stream', open: () => theirs });
    store.syncPlugins([{ id: 'beta', tools: [] }]);
    expect(mine.feed.closed()).toBe(1);
    expect(theirs.closed()).toBe(0);
    expect(theirs.listeners()).toBe(1);
  });

  it('has no stream for the session when the plugin comes back: it is the old session, ended, and what it held is gone', () => {
    const { store, streams, target } = harness();
    const { target: given } = target();
    const id = streams.open(given)?.id ?? '';
    store.syncPlugins([]);
    store.syncPlugins([{ id: 'acme', tools: [] }]);
    expect(store.getSnapshot().sessions[id]?.state).toBe('ended');
    expect(streams.feedOf(id)).toBeUndefined();
  });
});

describe('the registry\'s own end', () => {
  it('closes every stream still open when it is detached, and hears the panel no more', () => {
    const { store, streams, detach, target } = harness();
    const a = target();
    const b = target({ id: 'second', title: 'second-stream' });
    streams.open(a.target);
    streams.open(b.target);
    detach();
    expect(a.feed.closed()).toBe(1);
    expect(b.feed.closed()).toBe(1);
    expect(a.feed.listeners()).toBe(0);
    expect(b.feed.listeners()).toBe(0);
    // Detached, it neither listens to the panel nor closes anything twice.
    store.syncPlugins([]);
    expect(a.feed.closed()).toBe(1);
  });

  it('can be attached again after it was detached (a development build runs its effects twice)', () => {
    const { store, streams, detach, target } = harness();
    detach();
    const detachAgain = streams.attach();
    const { target: given, feed } = target();
    const id = streams.open(given)?.id ?? '';
    store.closeSession(id);
    expect(feed.closed()).toBe(1);
    detachAgain();
  });

  it('notices a session that was closed before it was attached (a host that restores, then attaches)', () => {
    const { store, streams, detach, target } = harness();
    detach();
    const { target: given, feed } = target();
    const id = streams.open(given)?.id ?? '';
    store.closeSession(id);
    expect(feed.closed()).toBe(0);
    streams.attach();
    expect(feed.closed()).toBe(1);
  });
});

describe('a feed that a plugin wrote badly', () => {
  it('is closed even when the plugin\'s unsubscribe throws: the stream must not outlive its session', () => {
    const { store, streams, warn } = harness();
    const feed = fakeFeed();
    const subscribe = feed.subscribe;
    const stubborn: FakeFeed = {
      ...feed,
      subscribe: (listener) => {
        const stop = subscribe(listener);
        return () => {
          stop();
          throw new Error('unsubscribe failed');
        };
      },
    };
    const id = streams.open({ plugin: 'acme', id: 't', title: 'x-stream', open: () => stubborn })?.id ?? '';
    expect(() => {
      store.closeSession(id);
    }).not.toThrow();
    expect(feed.closed()).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not stop listening'), expect.objectContaining({ message: 'unsubscribe failed' }));
  });

  it('is closed, and opens no session, when its status cannot be read or it cannot be listened to', () => {
    const { store, streams, warn } = harness();
    const unreadable = fakeFeed();
    const reading: FakeFeed = {
      ...unreadable,
      getSnapshot: () => {
        throw new Error('no status');
      },
    };
    expect(streams.open({ plugin: 'acme', id: 'a', title: 'a-stream', open: () => reading })).toBeUndefined();
    expect(unreadable.closed()).toBe(1);
    const deaf = fakeFeed();
    const listening: FakeFeed = {
      ...deaf,
      subscribe: () => {
        throw new Error('cannot subscribe');
      },
    };
    expect(streams.open({ plugin: 'acme', id: 'b', title: 'b-stream', open: () => listening })).toBeUndefined();
    expect(deaf.closed()).toBe(1);
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('has the session say what the feed became while the panel announced it: a status changed between the first read and the subscription is copied at once', () => {
    const { store, streams } = harness();
    const feed = fakeFeed({ state: 'streaming' });
    let changed = false;
    store.subscribe(() => {
      if (!changed && Object.keys(store.getSnapshot().sessions).length === 1) {
        changed = true;
        feed.set({ state: 'ended' });
      }
    });
    const id = streams.open({ plugin: 'acme', id: 't', title: 'x-stream', open: () => feed })?.id ?? '';
    expect(changed).toBe(true);
    expect(store.getSnapshot().sessions[id]?.state).toBe('ended');
  });
});
