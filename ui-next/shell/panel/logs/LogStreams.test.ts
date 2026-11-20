import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, restorePanel, UNLOADED_CAUSE, type PanelStore } from '../../core/panel';
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

  // P1b-3d: this test used to say that one target opened twice made two sessions ("twins"). A session is its plugin and its target now (below): what makes twins is two TARGETS of one title.
  it('opens two sessions for two targets of one title as twins: each has its own stream, and the strip tells them apart', () => {
    const { store, streams } = harness();
    const feeds = [fakeFeed(), fakeFeed()];
    let next = 0;
    const open = () => feeds[next++] ?? fakeFeed();
    const first = streams.open({ plugin: 'acme', id: 'one', title: 'orders-api/app', open });
    const second = streams.open({ plugin: 'acme', id: 'two', title: 'orders-api/app', open });
    expect(first?.id).not.toBe(second?.id);
    const names = store.selectors.sessionIds(store.getSnapshot(), 'logs').map((id) => store.selectors.sessionItem(store.getSnapshot(), id)?.name);
    expect(names).toEqual(['orders-api/app', 'orders-api/app (2)']);
    expect(streams.feedOf(first?.id ?? '')).toBe(feeds[0]);
    expect(streams.feedOf(second?.id ?? '')).toBe(feeds[1]);
  });
});

// A session is identified by its plugin and its target's id (P1b3b-01, P1b-3d). The mock does it for the targets its runner simulates (`openLogsFor`, shell-panel.js:2564-2565): a target that has a session
// that is not failed or expired is not opened again, its session is shown (`setActive`, `Shell.panel.show('logs', { focus: false })`: the panel opens, the Logs tool is chosen, no focus moves). The host
// shows only a session that is starting or running (A22, the lead's ruling): an ended session is not shown again, because the host has no Reconnect and a dead tab shown again leaves a person no way to fresh
// lines; a failed one is not either (the mock), and a session kept by its plugin's unload (A21) never changes again. For each of these a new press
// opens a new session beside it.
describe('opening a target that has a session already: the plugin and the target\'s id are the session', () => {
  const press = (streams: LogStreams, plugin: string, id: string, feed = fakeFeed(), title = 'orders-api/app', scope = 'north') => {
    const open = vi.fn(() => feed);
    return { opened: streams.open({ plugin, id, title, scope, open }), open, feed };
  };

  it('shows the session that is open and starts no second stream: the same session, the same feed, and the plugin\'s `open` is not called again', () => {
    const { store, streams } = harness();
    const first = press(streams, 'acme', 'item/orders-api/app');
    const again = press(streams, 'acme', 'item/orders-api/app');
    expect(again.opened?.id).toBe(first.opened?.id);
    expect(again.open).not.toHaveBeenCalled();
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([first.opened?.id]);
    expect(streams.feedOf(first.opened?.id ?? '')).toBe(first.feed);
    expect(first.feed.listeners()).toBe(1);
    expect(again.feed.listeners()).toBe(0);
    expect(first.feed.closed()).toBe(0);
  });

  it('starts one stream however often it is pressed', () => {
    const { store, streams } = harness();
    const first = press(streams, 'acme', 'item/orders-api/app');
    const opens = [first.open];
    for (let i = 0; i < 20; i += 1) {
      opens.push(press(streams, 'acme', 'item/orders-api/app').open);
    }

    expect(first.open).toHaveBeenCalledTimes(1);
    expect(opens.slice(1).every((open) => open.mock.calls.length === 0)).toBe(true);
    expect(store.getSnapshot().order).toHaveLength(1);
    expect(first.feed.listeners()).toBe(1);
  });

  it('shows it: the panel opens, the Logs tool is chosen and the session is its tab, from a hidden panel, from another tool and from another session', () => {
    const { store, streams } = harness();
    store.registerTool({ id: 'terminal', label: 'Terminal', icon: 'box', order: 10 });
    const first = press(streams, 'acme', 'item/orders-api/app');
    const other = press(streams, 'acme', 'item/orders-api/migrate', fakeFeed(), 'orders-api/migrate');
    expect(store.selectors.activeSession(store.getSnapshot(), 'logs')).toBe(other.opened?.id);
    store.hide();
    press(streams, 'acme', 'item/orders-api/app');
    expect(store.selectors.shown(store.getSnapshot())).toEqual({ tool: 'logs', session: first.opened?.id });
    store.activateSession(other.opened?.id ?? '');
    store.activateTool('terminal');
    expect(store.selectors.shown(store.getSnapshot())?.tool).toBe('terminal');
    press(streams, 'acme', 'item/orders-api/app');
    expect(store.selectors.shown(store.getSnapshot())).toEqual({ tool: 'logs', session: first.opened?.id });
    expect(store.getSnapshot().open).toBe(true);
  });

  it('changes nothing, and tells nobody, when its session is already the one on screen', () => {
    const { store, streams } = harness();
    press(streams, 'acme', 'item/orders-api/app');
    const before = store.getSnapshot();
    let told = 0;
    store.subscribe(() => {
      told += 1;
    });
    press(streams, 'acme', 'item/orders-api/app');
    expect(store.getSnapshot()).toBe(before);
    expect(told).toBe(0);
  });

  it('finds a session by its plugin and its target\'s id, and by nothing else: the title and the scope are what the tab says, and a press that says another does not rename it', () => {
    const { store, streams } = harness();
    const first = press(streams, 'acme', 'item/orders-api/app');
    const again = press(streams, 'acme', 'item/orders-api/app', fakeFeed(), 'another title', 'another scope');
    expect(again.opened?.id).toBe(first.opened?.id);
    expect(store.getSnapshot().sessions[first.opened?.id ?? '']).toMatchObject({ title: 'orders-api/app', scope: 'north' });
  });

  it('opens another session for another id of the same plugin, and for the same id of another plugin', () => {
    const { store, streams } = harness({ plugins: ['acme', 'beta'] });
    const first = press(streams, 'acme', 'item/orders-api/app');
    const sibling = press(streams, 'acme', 'item/orders-api/app/sidecar');
    const stranger = press(streams, 'beta', 'item/orders-api/app');
    expect(new Set([first.opened?.id, sibling.opened?.id, stranger.opened?.id]).size).toBe(3);
    expect(Object.keys(store.getSnapshot().sessions)).toHaveLength(3);
    expect(sibling.open).toHaveBeenCalledTimes(1);
    expect(stranger.open).toHaveBeenCalledTimes(1);
    // The one of another plugin is its own: pressing it again shows it and not the first.
    expect(press(streams, 'beta', 'item/orders-api/app').opened?.id).toBe(stranger.opened?.id);
  });

  // A22: the mock shows an ended session (`exited` is neither failed nor expired), but it has a Reconnect on the card and in the tab's menu and the host has none (decision 5 of P1b-3a). A press for a target
  // whose stream ended opens a new session beside it, and the ended one stays readable: its lines are evidence.
  it('opens a NEW session beside one whose stream has ended on its own, and leaves the ended one as it was, its stream still the session\'s and its lines readable (A22)', () => {
    const { store, streams } = harness();
    const first = press(streams, 'acme', 'item/orders-api/migrate');
    first.feed.set({ state: 'streaming' });
    first.feed.set({ state: 'ended' });
    const ended = store.getSnapshot().sessions[first.opened?.id ?? ''];
    expect(ended).toMatchObject({ state: 'ended' });
    store.hide();
    const again = press(streams, 'acme', 'item/orders-api/migrate');
    expect(again.opened?.id).not.toBe(first.opened?.id);
    expect(again.open).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().sessions[first.opened?.id ?? '']).toBe(ended);
    expect(streams.feedOf(first.opened?.id ?? '')).toBe(first.feed);
    // The ended stream is not closed: its tab closes it, as for any session.
    expect(first.feed.closed()).toBe(0);
    expect(first.feed.listeners()).toBe(1);
    expect(store.selectors.shown(store.getSnapshot())).toEqual({ tool: 'logs', session: again.opened?.id });
    // Two tabs of one title and one scope, which differ in neither: the new one is told by its ordinal, the ended one by its state (the shell words it).
    const items = store.selectors.sessionIds(store.getSnapshot(), 'logs').map((id) => store.selectors.sessionItem(store.getSnapshot(), id));
    expect(items.map((item) => [item?.name, item?.state])).toEqual([
      ['orders-api/app', 'ended'],
      ['orders-api/app (2)', 'starting'],
    ]);
    // From then on the press is for the live one, not the ended one.
    const third = press(streams, 'acme', 'item/orders-api/migrate');
    expect(third.opened?.id).toBe(again.opened?.id);
    expect(third.open).not.toHaveBeenCalled();
    expect(Object.keys(store.getSnapshot().sessions)).toHaveLength(2);
  });

  it('opens a new session beside a failed one, as the mock does, and leaves the failed one as it was, its lines readable', () => {
    const { store, streams } = harness();
    const first = press(streams, 'acme', 'item/orders-api/sync');
    first.feed.set({ state: 'failed', cause: { stage: 'source', message: 'The source did not answer' } });
    const failed = store.getSnapshot().sessions[first.opened?.id ?? ''];
    expect(failed).toMatchObject({ state: 'failed' });
    const again = press(streams, 'acme', 'item/orders-api/sync');
    expect(again.opened?.id).not.toBe(first.opened?.id);
    expect(again.open).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().sessions[first.opened?.id ?? '']).toBe(failed);
    expect(streams.feedOf(first.opened?.id ?? '')).toBe(first.feed);
    expect(first.feed.closed()).toBe(0);
    expect(store.selectors.activeSession(store.getSnapshot(), 'logs')).toBe(again.opened?.id);
  });

  it('shows the session that is live, not the failed one that came before it, and starts no third', () => {
    const { store, streams } = harness();
    const failing = press(streams, 'acme', 'item/orders-api/sync');
    failing.feed.set({ state: 'failed', cause: { stage: 'source', message: 'late' } });
    const retry = press(streams, 'acme', 'item/orders-api/sync');
    const third = press(streams, 'acme', 'item/orders-api/sync');
    expect(third.opened?.id).toBe(retry.opened?.id);
    expect(third.open).not.toHaveBeenCalled();
    expect(Object.keys(store.getSnapshot().sessions)).toHaveLength(2);
  });

  it('opens a new session beside one that its plugin\'s unload kept (A21), and does not show the kept one: it never changes again', () => {
    const { store, streams } = harness();
    const first = press(streams, 'acme', 'item/orders-api/app');
    store.syncPlugins([]);
    store.syncPlugins([{ id: 'acme', tools: [] }]);
    const kept = store.getSnapshot().sessions[first.opened?.id ?? ''];
    expect(kept).toMatchObject({ held: true, state: 'ended' });
    const again = press(streams, 'acme', 'item/orders-api/app');
    expect(again.opened?.id).not.toBe(first.opened?.id);
    expect(again.open).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().sessions[first.opened?.id ?? '']).toBe(kept);
    expect(store.selectors.activeSession(store.getSnapshot(), 'logs')).toBe(again.opened?.id);
    // And the new one is the session of the target from then on.
    expect(press(streams, 'acme', 'item/orders-api/app').opened?.id).toBe(again.opened?.id);
  });

  it('opens a new session beside one that was restored from the last run: it has no stream, and the registry never held one', () => {
    const saved = restorePanel({ version: 1, open: false, height: null, tool: null, active: {}, sessions: [{ id: 'old', tool: 'logs', plugin: 'acme', title: 'orders-api/app', scope: 'north' }] }, { now: 500 });
    if (!saved.ok) {
      throw new Error('the saved panel is readable');
    }

    const store = createPanelStore({ initial: saved.state, now: () => clock, newId: () => 'store-1' });
    store.registerTool(LOGS_TOOL);
    store.syncPlugins([{ id: 'acme', tools: [] }]);
    const streams = createLogStreams(store, { newId: () => 'log-1', warn: () => undefined });
    streams.attach();
    expect(store.getSnapshot().sessions.old).toMatchObject({ state: 'ended' });
    const again = press(streams, 'acme', 'item/orders-api/app');
    expect(again.opened?.id).toBe('log-1');
    expect(again.open).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().sessions.old).toMatchObject({ state: 'ended' });
  });

  it('refuses a target that is not well formed before it looks for a session: a malformed press neither shows the live session nor starts anything', () => {
    const { store, streams, warn } = harness();
    const first = press(streams, 'acme', 'item/orders-api/app');
    store.hide();
    const bad = press(streams, 'acme', 'item/orders-api/app', fakeFeed(), '   ');
    expect(bad.opened).toBeUndefined();
    expect(bad.open).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not open a log stream'));
    expect(store.getSnapshot().open).toBe(false);
    expect(first.feed.closed()).toBe(0);
  });

  it('closes the one session through either handle: the tab closes, the stream is closed once, and the other handle is safe to use', () => {
    const { store, streams } = harness();
    const first = press(streams, 'acme', 'item/orders-api/app');
    const again = press(streams, 'acme', 'item/orders-api/app');
    again.opened?.close();
    first.opened?.close();
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
    expect(first.feed.closed()).toBe(1);
    expect(first.feed.listeners()).toBe(0);
    // The target is free again: a press now is a new session with a stream of its own.
    const fresh = press(streams, 'acme', 'item/orders-api/app');
    expect(fresh.open).toHaveBeenCalledTimes(1);
    expect(fresh.opened?.id).not.toBe(first.opened?.id);
  });

  it('opens a new session when the session it would show cannot be shown (its tool is gone): the press is not lost', () => {
    const { store, streams } = harness();
    const first = press(streams, 'acme', 'item/orders-api/app');
    store.unregisterTool('logs');
    expect(store.selectors.session(store.getSnapshot(), first.opened?.id ?? '')).toBeUndefined();
    const again = press(streams, 'acme', 'item/orders-api/app');
    expect(again.opened?.id).not.toBe(first.opened?.id);
    expect(again.open).toHaveBeenCalledTimes(1);
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
  it('closes the stream of a session it was running, once, and lets go of its own listener, and KEEPS the session: the same feed is still its feed, and its record is still there (A21)', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target({ resource: { label: 'Item orders-api', kind: 'Item' } });
    const id = streams.open(given)?.id ?? '';
    feed.set({ state: 'streaming', sources: [{ id: 'orders-api/app' }] });
    clock = 9_000;
    store.syncPlugins([]);
    expect(store.getSnapshot().sessions[id]).toMatchObject({ state: 'ended', cause: UNLOADED_CAUSE, held: true, since: 9_000 });
    expect(feed.closed()).toBe(1);
    expect(feed.listeners()).toBe(0);
    // The kit's view makes its model once for a feed object: the very same object stays the session's until its tab closes.
    expect(streams.feedOf(id)).toBe(feed);
    expect(streams.recordOf(id)).toMatchObject({ id: 'item/orders-api/app', plugin: 'acme', resource: { label: 'Item orders-api', kind: 'Item' }, snapshot: { sources: [{ id: 'orders-api/app' }] } });
  });

  it('closes the stream of a session that was still connecting as well: its work was ended by the unload, and it is kept like the others', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target();
    const id = streams.open(given)?.id ?? '';
    expect(store.getSnapshot().sessions[id]?.state).toBe('starting');
    store.syncPlugins([]);
    expect(store.getSnapshot().sessions[id]).toMatchObject({ state: 'ended', held: true });
    expect(feed.closed()).toBe(1);
    expect(streams.feedOf(id)).toBe(feed);
  });

  it('hears nothing more of the stream it closed: the end the stream publishes as it closes, and anything after, writes nothing to the session, which keeps the unload\'s cause', () => {
    const { store, streams } = harness();
    const feed: FakeFeed = fakeFeed({
      state: 'streaming',
      close: () => {
        // A real stream tells its listeners it ended before `close` returns.
        feed.set({ state: 'ended' });
      },
    });
    const id = streams.open({ plugin: 'acme', id: 't', title: 'x-stream', open: () => feed })?.id ?? '';
    const write = vi.spyOn(store, 'setSessionState');
    store.syncPlugins([]);
    feed.set({ state: 'failed', cause: { stage: 'source', message: 'late' } });
    feed.set({ state: 'streaming' });
    expect(write).not.toHaveBeenCalled();
    expect(store.getSnapshot().sessions[id]).toMatchObject({ state: 'ended', cause: UNLOADED_CAUSE, held: true });
  });

  it('keeps a stream that had ended on its own just the same: closed once at the unload, its entry and feed kept, and the session exactly as it was (its own words, its own time)', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target();
    const id = streams.open(given)?.id ?? '';
    clock = 4_000;
    feed.set({ state: 'ended' });
    clock = 9_000;
    store.syncPlugins([]);
    expect(store.getSnapshot().sessions[id]).toMatchObject({ state: 'ended', cause: '', since: 4_000, held: true });
    expect(feed.closed()).toBe(1);
    expect(feed.listeners()).toBe(0);
    expect(streams.feedOf(id)).toBe(feed);
    store.syncPlugins([{ id: 'acme', tools: [] }]);
    expect(store.getSnapshot().sessions[id]).toMatchObject({ state: 'ended', since: 4_000, held: true });
    expect(streams.feedOf(id)).toBe(feed);
  });

  it('keeps a stream that had failed on its own as well: the failure stays the session\'s words, and what the closed stream says afterwards is not heard', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target();
    const id = streams.open(given)?.id ?? '';
    feed.set({ state: 'failed', cause: { stage: 'source', message: 'The source did not answer' } });
    store.syncPlugins([]);
    expect(feed.closed()).toBe(1);
    expect(streams.feedOf(id)).toBe(feed);
    const words = { state: 'failed', cause: 'The log stream stopped. The source did not answer.', held: true };
    expect(store.getSnapshot().sessions[id]).toMatchObject(words);
    feed.set({ state: 'ended' });
    expect(store.getSnapshot().sessions[id]).toMatchObject(words);
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

  it('keeps what it held when the plugin comes back: the same feed, still closed, and the session still ended: nothing starts again, whatever the feed says', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target();
    const id = streams.open(given)?.id ?? '';
    feed.set({ state: 'streaming' });
    store.syncPlugins([]);
    store.syncPlugins([{ id: 'acme', tools: [] }]);
    expect(store.getSnapshot().sessions[id]).toMatchObject({ state: 'ended', held: true, cause: UNLOADED_CAUSE });
    expect(streams.feedOf(id)).toBe(feed);
    expect(feed.closed()).toBe(1);
    expect(feed.listeners()).toBe(0);
    feed.set({ state: 'streaming' });
    expect(store.getSnapshot().sessions[id]).toMatchObject({ state: 'ended', held: true });
  });

  it('closes nothing twice, however the panel changes after the unload, and however often the plugin goes and comes back', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target();
    streams.open(given);
    store.syncPlugins([]);
    store.hide();
    store.show();
    store.activateTool('logs');
    store.syncPlugins([]);
    store.syncPlugins([{ id: 'acme', tools: [] }]);
    store.syncPlugins([]);
    expect(feed.closed()).toBe(1);
  });

  it('releases the entry when the tab closes, and closes nothing a second time: the stream was closed at the unload', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target();
    const id = streams.open(given)?.id ?? '';
    store.syncPlugins([]);
    store.closeSession(id);
    expect(feed.closed()).toBe(1);
    expect(feed.listeners()).toBe(0);
    expect(streams.feedOf(id)).toBeUndefined();
    expect(streams.recordOf(id)).toBeUndefined();
    expect(store.getSnapshot().sessions[id]).toBeUndefined();
    store.show();
    expect(feed.closed()).toBe(1);
  });

  it('closes through the handle the plugin was given, which is safe to use again after the unload: the tab closes, the entry goes, nothing closes twice', () => {
    const { store, streams, target } = harness();
    const { target: given, feed } = target();
    const opened = streams.open(given);
    store.syncPlugins([]);
    opened?.close();
    opened?.close();
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
    expect(streams.feedOf(opened?.id ?? '')).toBeUndefined();
    expect(feed.closed()).toBe(1);
  });

  it('opens a new session for a new press when the plugin is back, with a stream of its own: the held one keeps its closed one, and nothing is shared', () => {
    const { store, streams, target } = harness();
    const first = target();
    const heldId = streams.open(first.target)?.id ?? '';
    store.syncPlugins([]);
    store.syncPlugins([{ id: 'acme', tools: [] }]);
    const second = target();
    const newId = streams.open(second.target)?.id ?? '';
    expect(newId).not.toBe(heldId);
    expect(streams.feedOf(heldId)).toBe(first.feed);
    expect(streams.feedOf(newId)).toBe(second.feed);
    expect(first.feed.closed()).toBe(1);
    expect(first.feed.listeners()).toBe(0);
    expect(second.feed.closed()).toBe(0);
    expect(second.feed.listeners()).toBe(1);
    expect(store.getSnapshot().sessions[heldId]).toMatchObject({ state: 'ended', held: true });
    expect(store.getSnapshot().sessions[newId]).toMatchObject({ state: 'starting' });
    expect(store.getSnapshot().sessions[newId]?.held).toBeUndefined();
    // The new session follows its own feed, and the held one is deaf to it.
    second.feed.set({ state: 'streaming' });
    expect(store.getSnapshot().sessions[newId]?.state).toBe('running');
    expect(store.getSnapshot().sessions[heldId]?.state).toBe('ended');
  });

  it('says in the log when a stream cannot be closed at the unload, and keeps the session all the same: closing it is not tried again when the tab closes', () => {
    const { store, streams, warn } = harness();
    const throwing = fakeFeed({
      close: () => {
        throw new Error('it threw');
      },
    });
    const id = streams.open({ plugin: 'acme', id: 't', title: 'x-stream', open: () => throwing })?.id ?? '';
    store.syncPlugins([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not close the log stream'), expect.objectContaining({ message: 'it threw' }));
    expect(streams.feedOf(id)).toBe(throwing);
    expect(store.getSnapshot().sessions[id]).toMatchObject({ state: 'ended', held: true });
    store.closeSession(id);
    expect(throwing.closed()).toBe(1);
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

  it('closes nothing a second time when it is detached while a session is held: the stream was closed at the unload, and the entry goes with the registry', () => {
    const { store, streams, detach, target } = harness();
    const { target: given, feed } = target();
    const id = streams.open(given)?.id ?? '';
    store.syncPlugins([]);
    expect(streams.feedOf(id)).toBe(feed);
    detach();
    expect(feed.closed()).toBe(1);
    expect(feed.listeners()).toBe(0);
    expect(streams.feedOf(id)).toBeUndefined();
    expect(streams.recordOf(id)).toBeUndefined();
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
