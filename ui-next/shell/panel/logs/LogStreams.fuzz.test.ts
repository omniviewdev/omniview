import { describe, expect, it } from 'vitest';
import { checkInvariants, createPanelStore, type PanelState, type SessionId } from '../../core/panel';
import { generator, tabProblems } from '../../core/panel/testing';
import { createLogStreams, type LogOpened } from './LogStreams';
import { sessionStateOf } from './state';
import { fakeFeed, type FakeFeed } from './testing';
import { LOGS_TOOL, LOGS_TOOL_ID } from './tool';

// The registry under random operations (P1b-3d), against the real panel model: a plugin presses a target, a stream starts, ends or fails, a tab closes (by the tab or by the handle the plugin was given), a plugin
// leaves and returns, the Logs tool goes and returns, the panel is hidden and another tool shown. After every operation the rule is checked from its words and not from the registry's code: a session is its plugin's and its target's id;
// a press of a target that has a session that is starting or running shows it and starts nothing, and a press of one that has none (or whose session ended, failed or was kept) starts one stream and one session; no target ever has two live sessions; and every stream is closed
// exactly when its session is gone or kept, never twice, and listened to exactly while its session is open. Deterministic: a seeded generator, and a failure names its seed and step.

const PLUGINS = ['acme', 'beta'];
/** Two targets of one title and one of another: the same title in two scopes (a plugin's), so the strip has twins of every kind. */
const TARGETS: Readonly<Record<string, string>> = { 'item/a': 'orders/app', 'item/b': 'orders/app', 'item/c': 'orders/migrate' };
const SCOPES: Readonly<Record<string, string>> = { acme: 'north', beta: 'south' };

type Made = { readonly plugin: string; readonly target: string; readonly session: SessionId; readonly feed: FakeFeed };

type Tally = Map<string, number>;
const count = (tally: Tally, name: string): void => {
  tally.set(name, (tally.get(name) ?? 0) + 1);
};

function run(seed: number, tally: Tally): void {
  let clock = 1_000;
  let storeIds = 0;
  let logIds = 0;
  const store = createPanelStore({ now: () => clock, newId: () => `s${String((storeIds += 1))}` });
  store.registerTool(LOGS_TOOL);
  store.registerTool({ id: 'terminal', label: 'Terminal', icon: 'box', order: 10 });
  store.syncPlugins(PLUGINS.map((id) => ({ id, tools: [] })));
  const streams = createLogStreams(store, { newId: () => `log-${String((logIds += 1))}`, warn: () => undefined });
  streams.attach();
  const next = generator(seed);
  const pick = <T>(list: readonly T[]): T => list[next() % list.length];
  const made: Made[] = [];
  const handles: LogOpened[] = [];
  /** Whether the Logs tool is unregistered now: the panel cannot show any session of it, and a press must still start no stream for a target that has a live one (CodeRabbit, LogStreams.ts, #609). */
  let toolGone = false;
  /** The sessions a plugin took with it when it left and the panel did not keep (A21's hold reaches the sessions in a tool of the host, not one in a tool that is gone): hidden with it, their streams released at once. */
  const released = new Set<SessionId>();
  let opens = 0;
  const started: FakeFeed[] = [];
  /** What the plugin's `open` does for every press: a stream of its own, counted. */
  const startFeed = (): FakeFeed => {
    opens += 1;
    const feed = fakeFeed();
    started.push(feed);
    return feed;
  };

  /** The session a press of (plugin, target) is for, read from the words of the rule (A22): of this plugin and target, there, starting or running, and not kept; the newest. */
  const reusable = (state: PanelState, plugin: string, target: string): Made | undefined => {
    for (let at = made.length - 1; at >= 0; at -= 1) {
      const one = made[at];
      const session = one !== undefined && Object.hasOwn(state.sessions, one.session) ? state.sessions[one.session] : undefined;
      if (one?.plugin === plugin && one.target === target && session !== undefined && session.held !== true && (session.state === 'starting' || session.state === 'running')) {
        return one;
      }
    }

    return undefined;
  };

  const where = (operation: number, name: string) => `seed ${String(seed)}, operation ${String(operation)} (${name})`;

  for (let operation = 0; operation < 120; operation += 1) {
    const state = store.getSnapshot();
    const live = PLUGINS.filter((id) => state.live.includes(id));
    const absent = PLUGINS.filter((id) => !state.live.includes(id));
    const ids = Object.keys(state.sessions);
    const roll = next() % 18;
    let name: string;
    if (roll <= 5 && live.length > 0) {
      // A press: the plugin's page or command, through `ctx.panel`, for a target it names the same way each time.
      const plugin = pick(live);
      const target = pick(Object.keys(TARGETS));
      const before = reusable(state, plugin, target);
      const failedBefore = made.some((one) => one.plugin === plugin && one.target === target && state.sessions[one.session]?.state === 'failed');
      const heldBefore = made.some((one) => one.plugin === plugin && one.target === target && state.sessions[one.session]?.held === true);
      const endedBefore = made.some((one) => one.plugin === plugin && one.target === target && state.sessions[one.session]?.state === 'ended' && state.sessions[one.session]?.held !== true);
      const opensBefore = opens;
      const result = streams.open({ plugin, id: target, title: TARGETS[target] ?? target, scope: SCOPES[plugin], open: startFeed });
      // The stream this press started, if it started one.
      const feed = opens > opensBefore ? started.at(-1) : undefined;
      name = `press ${plugin} ${target}`;
      expect(result, `${where(operation, name)}: a live plugin's press opens or shows a session`).toBeDefined();
      if (result === undefined) {
        continue;
      }

      handles.push(result);
      const now = store.getSnapshot();
      if (before !== undefined) {
        // A target that has an open session: the session is answered and nothing starts; the panel shows it when it has the tool to show it in.
        expect(result.id, `${where(operation, name)}: the press shows the session the target has`).toBe(before.session);
        expect(opens, `${where(operation, name)}: and starts no stream`).toBe(opensBefore);
        count(tally, toolGone ? 'press:answered a live session whose tool is gone' : 'press:shown a live session');
      } else {
        expect(opens, `${where(operation, name)}: a target with no open session starts one stream`).toBe(opensBefore + 1);
        expect(feed, `${where(operation, name)}: and it is the one the registry holds`).toBeDefined();
        if (feed !== undefined) {
          made.push({ plugin, target, session: result.id, feed });
        }

        count(tally, failedBefore ? 'press:new beside a failed one' : heldBefore ? 'press:new beside a kept one' : endedBefore ? 'press:new beside an ended one' : 'press:new');
      }

      // Either way the session is the one on screen when the tool is there to show it in: the panel is open on the Logs tool and it is the tab.
      if (!toolGone) {
        expect(store.selectors.shown(now), `${where(operation, name)}: it is shown`).toEqual({ tool: LOGS_TOOL_ID, session: result.id });
      }
    } else if (roll >= 6 && roll <= 8 && made.length > 0) {
      // A stream moves forward, and only forward (a real stream never leaves `ended` or `failed`); one that has nowhere to go, or was closed, says something again, which changes nothing.
      const one = pick(made);
      const open = ['starting', 'streaming'].includes(one.feed.getSnapshot().state);
      name = roll === 6 ? 'a stream starts streaming' : roll === 7 ? 'a stream ends' : 'a stream fails';
      if (roll === 6 && one.feed.getSnapshot().state === 'starting') {
        one.feed.set({ state: 'streaming' });
      } else if (roll === 7 && open) {
        one.feed.set({ state: 'ended' });
      } else if (roll === 8 && open) {
        one.feed.set({ state: 'failed', cause: { stage: 'source', message: 'The source did not answer' } });
      } else {
        name = 'a stream says something again';
        one.feed.set({});
      }
    } else if (roll === 9 && ids.length > 0) {
      name = 'a tab closes';
      store.closeSession(pick(ids));
    } else if (roll === 10 && handles.length > 0) {
      name = 'the plugin closes its session through the handle it was given';
      pick(handles).close();
    } else if (roll === 11 && live.length > 0) {
      name = 'a plugin leaves';
      const leaving = pick(live);
      // What the unload must do is read from the state BEFORE it and from whether the Logs tool was there, never from what the model says afterwards (CodeRabbit, #609): a session of the plugin that is already kept stays
      // kept; one in the registered Logs tool is kept (held, A21) whatever its state; one whose tool was gone is hidden with its plugin, and its stream is released.
      const had = made.filter((one) => one.plugin === leaving && Object.hasOwn(state.sessions, one.session));
      store.syncPlugins(live.filter((id) => id !== leaving).map((id) => ({ id, tools: [] })));
      const left = store.getSnapshot();
      for (const one of had) {
        if (state.sessions[one.session]?.held !== true && toolGone) {
          released.add(one.session);
        } else {
          expect(left.sessions[one.session]?.held, `${where(operation, name)}: ${one.session} is kept when its plugin leaves (it was, or it is in the Logs tool)`).toBe(true);
        }
      }
    } else if (roll === 12 && absent.length > 0) {
      name = 'a plugin returns';
      store.syncPlugins([...live, pick(absent)].map((id) => ({ id, tools: [] })));
    } else if (roll === 13) {
      name = 'the panel is hidden';
      store.hide();
    } else if (roll === 14) {
      name = 'another tool is shown';
      store.show({ tool: 'terminal' });
    } else if (roll === 16 && !toolGone) {
      name = 'the Logs tool is gone';
      toolGone = true;
      store.unregisterTool(LOGS_TOOL_ID);
    } else if (roll === 17 && toolGone) {
      name = 'the Logs tool returns';
      toolGone = false;
      store.registerTool(LOGS_TOOL);
    } else if (ids.length > 0) {
      name = 'another session is chosen';
      store.activateSession(pick(ids));
    } else {
      name = 'nothing to do';
    }

    count(tally, name.startsWith('press') ? 'press' : name);
    clock += 7;

    const after = store.getSnapshot();
    expect(checkInvariants(after), where(operation, name)).toEqual([]);
    expect(tabProblems(after, store.selectors), `${where(operation, name)}: the tabs`).toEqual([]);
    expect(opens, `${where(operation, name)}: a stream was started for each session ever made, and for nothing else`).toBe(made.length);
    // No target ever has two live sessions: a session that is starting or running and not kept.
    for (const plugin of PLUGINS) {
      for (const target of Object.keys(TARGETS)) {
        const open = made.filter((one) => {
          const session = Object.hasOwn(after.sessions, one.session) ? after.sessions[one.session] : undefined;
          return one.plugin === plugin && one.target === target && session !== undefined && session.held !== true && (session.state === 'starting' || session.state === 'running');
        });
        expect(open.length, `${where(operation, name)}: ${plugin} has ${String(open.length)} open sessions of ${target}`).toBeLessThanOrEqual(1);
      }
    }

    for (const one of made) {
      const session = Object.hasOwn(after.sessions, one.session) ? after.sessions[one.session] : undefined;
      const label = `${where(operation, name)}: the stream of ${one.session}`;
      expect(one.feed.closed(), `${label} is closed at most once`).toBeLessThanOrEqual(1);
      if (session === undefined) {
        // The tab is gone: the stream is closed, nobody listens to it, and the registry holds nothing of it.
        expect(one.feed.closed(), `${label} is closed once its tab has closed`).toBe(1);
        expect(one.feed.listeners(), `${label} has no listener once its tab has closed`).toBe(0);
        expect(streams.feedOf(one.session), `${label} is not held once its tab has closed`).toBeUndefined();
      } else if (released.has(one.session)) {
        // Taken by its plugin when it left and not kept (its tool was gone, so the hold of a tool of the host, A21, did not reach it: "a session in a tool that is not registered was never drawn and is hidden as
        // before"): the stream was released at that unload, closed once and held by nobody, whether the plugin is back or not, and whatever later holds the session itself.
        expect(one.feed.closed(), `${label} was closed when its plugin left`).toBe(1);
        expect(one.feed.listeners(), `${label} has no listener once its plugin has taken it`).toBe(0);
        expect(streams.feedOf(one.session), `${label} is held by nobody once its plugin has taken it`).toBeUndefined();
      } else if (session.held === true) {
        // Kept by its plugin's unload: closed once, not listened to, and still the session's stream for the view that reads it.
        expect(one.feed.closed(), `${label} was closed at the unload`).toBe(1);
        expect(one.feed.listeners(), `${label} has no listener while the session is kept`).toBe(0);
        expect(streams.feedOf(one.session), `${label} is still the session's while it is kept`).toBe(one.feed);
      } else {
        expect(one.feed.closed(), `${label} is open while the session is`).toBe(0);
        expect(one.feed.listeners(), `${label} has the registry's one listener while the session is open`).toBe(1);
        expect(streams.feedOf(one.session), `${label} is the session's`).toBe(one.feed);
        expect(session.state, `${label}: the session says what its stream says`).toBe(sessionStateOf(one.feed.getSnapshot()).state);
      }
    }
  }
}

describe('the registry under random operations (P1b-3d)', () => {
  it('keeps one open session for a plugin and a target, shows it when it is pressed, starts a stream for nothing else, and closes every stream once', () => {
    const tally: Tally = new Map();
    for (let seed = 1; seed <= 40; seed += 1) {
      run(seed, tally);
    }

    // A run that never pressed a target that had a session, or never one whose session ended, failed or was kept, proves nothing about what that press does: each event must have happened about a third as often as a
    // run of 40 seeds makes it (a generator that stops mixing its bits fails here and not silently).
    const floors: ReadonlyArray<readonly [string, number]> = [
      ['press', 400],
      ['press:new', 150],
      ['press:shown a live session', 100],
      ['press:answered a live session whose tool is gone', 40],
      ['the Logs tool is gone', 60],
      ['the Logs tool returns', 60],
      ['press:new beside an ended one', 15],
      ['press:new beside a failed one', 15],
      ['press:new beside a kept one', 40],
      ['a stream ends', 50],
      ['a stream fails', 50],
      ['a plugin leaves', 70],
      ['a plugin returns', 50],
      ['a tab closes', 90],
    ];
    for (const [event, floor] of floors) {
      expect(tally.get(event) ?? 0, `event ${event}`).toBeGreaterThan(floor);
    }
  });
});
