import { describe, expect, it } from 'vitest';
import { checkInvariants, createPanelStore, HOST, restorePanel, type PanelState, type PanelStore } from './index';
import { generator, tabProblems, tool } from './testing';

// Thousands of random operations against the store, with the invariants of `checkInvariants` checked after each, and the saved session checked to come back whole. Deterministic: a seeded
// generator, and a failure names its seed and step. The same shape as the tab model's fuzz (../tabs/fuzz.test.ts). The tabs of every strip are checked too (`tabProblems`, written from the words of the
// rule): the scope a tab draws, the ordinal of a twin and the name, which no two tabs of a tool share.

const TOOLS = ['terminal', 'logs', 'acme:one', 'beta:two', 'constructor'];
const PLUGINS = ['acme', 'beta', 'host', 'gone'];
/** Ids a session may be given that every object already has a member for: the model's dictionaries must not take them for entries that are there. */
const ODD_IDS = ['constructor', '__proto__', 'toString'];
const STATES = ['starting', 'running', 'ended', 'failed'] as const;
/** Few titles and scopes, so that twins of every kind come up: one title in two scopes and in one, a title that looks like the ordinal of another (`t1 (2)`) and one that looks like another's name and state (`t1, ended`): no two tabs may sound alike even then. */
const TITLES = ['t0', 't1', 't1 (2)', 't1, ended', 't2', 't2, failed'];
const SCOPES = ['', 'dev', 'prod'];

/** What a run did, by operation and by state drawn: the test asserts that every branch ran, so a generator that stops mixing its bits fails loudly. */
type Tally = Map<string, number>;
const count = (tally: Tally, name: string): void => {
  tally.set(name, (tally.get(name) ?? 0) + 1);
};

function sessionIdsOf(state: PanelState): string[] {
  return Object.keys(state.sessions);
}

function step(store: PanelStore, next: () => number, tick: () => void, tally: Tally): string {
  const state = store.getSnapshot();
  const ids = sessionIdsOf(state);
  const pick = <T>(list: readonly T[]): T => list[next() % list.length];
  const pickState = () => {
    const drawn = pick(STATES);
    count(tally, `state:${drawn}`);
    return drawn;
  };

  const roll = next() % 19;
  tick();
  let name: string;
  switch (roll) {
    case 0:
      store.show(next() % 2 === 0 ? { tool: pick(TOOLS) } : undefined);
      name = 'show';
      break;
    case 1:
      store.hide();
      name = 'hide';
      break;
    case 2:
      store.resize(next() % 5 === 0 ? { collapse: true } : { size: (next() % 900) - 50 });
      name = 'resize';
      break;
    case 3:
      store.resetHeight();
      name = 'resetHeight';
      break;
    case 4:
      store.activateTool(pick(TOOLS));
      name = 'activateTool';
      break;
    case 5:
    case 6:
      store.openSession(
        { tool: pick(TOOLS), plugin: pick(PLUGINS), title: pick(TITLES), scope: pick(SCOPES), state: pickState(), ...(next() % 5 === 0 ? { id: pick(ODD_IDS) } : {}) },
        { reveal: next() % 3 !== 0 },
      );
      name = 'openSession';
      break;
    case 7:
      if (ids.length > 0) {
        store.setSessionState(pick(ids), { state: pickState(), cause: 'because' });
        name = 'setSessionState';
      } else {
        name = 'setSessionState (no session)';
      }

      break;
    case 8:
      if (ids.length > 0) {
        store.closeSession(pick(ids));
        name = 'closeSession';
      } else {
        name = 'closeSession (no session)';
      }

      break;
    case 9:
      if (ids.length > 0) {
        store.activateSession(pick(ids));
        name = 'activateSession';
      } else {
        name = 'activateSession (no session)';
      }

      break;
    case 10:
      store.syncPlugins(PLUGINS.filter(() => next() % 2 === 0).map((id) => ({ id, tools: next() % 2 === 0 ? [tool('one'), tool('two', 'Two', 3)] : [] })));
      name = 'syncPlugins';
      break;
    case 11:
      store.registerTool(tool(pick(['terminal', 'logs', 'ports', 'constructor']), 'Words', next() % 40));
      name = 'registerTool';
      break;
    case 12:
      store.unregisterTool(pick(['terminal', 'logs', 'ports', 'constructor']));
      name = 'unregisterTool';
      break;
    case 13:
      store.fitHeight(pick([300, 500, 700, 900, 1400]));
      name = 'fitHeight';
      break;
    case 15: {
      // A plugin that is live leaves and the others stay: what an unload does to the sessions it was running (some of them are now held).
      const leaving = state.live.length === 0 ? undefined : pick(state.live);
      if (leaving === undefined) {
        name = 'pluginLeaves (no plugin live)';
        break;
      }

      store.syncPlugins(state.live.filter((id) => id !== leaving).map((id) => ({ id, tools: next() % 2 === 0 ? [tool('one'), tool('two', 'Two', 3)] : [] })));
      name = 'pluginLeaves';
      break;
    }

    case 16: {
      // A plugin that is not live comes back, the live ones stay: the sessions it had come back with it, and the held ones were never gone.
      const absent = PLUGINS.filter((id) => id !== 'host' && !state.live.includes(id));
      if (absent.length === 0) {
        name = 'pluginReturns (every plugin live)';
        break;
      }

      const returning = pick(absent);
      store.syncPlugins([...state.live, returning].map((id) => ({ id, tools: next() % 2 === 0 ? [tool('one'), tool('two', 'Two', 3)] : [] })));
      name = 'pluginReturns';
      break;
    }

    case 17: {
      // A plugin presses Logs: it opens a session of its own, starting or running, in a tool of the host. This is what an unload holds, so the run has plenty of them to hold.
      const hostTools = Object.values(state.tools).filter((one) => one.owner === HOST);
      const opener = state.live.length === 0 ? undefined : pick(state.live);
      if (opener === undefined || hostTools.length === 0) {
        name = 'openFromPlugin (no plugin live, or no tool of the host)';
        break;
      }

      store.openSession({ tool: pick(hostTools).id, plugin: opener, title: pick(TITLES), scope: pick(SCOPES), state: next() % 2 === 0 ? 'running' : 'starting' }, { reveal: next() % 3 !== 0 });
      name = 'openFromPlugin';
      break;
    }

    case 18:
      // The host learns a session's real name (the shell it resolved to, a title the program set): a title from the same few the sessions open with, so twins form and break up, sometimes padded with white space.
      if (ids.length > 0) {
        const title = pick(TITLES);
        const result = store.retitleSession(pick(ids), next() % 4 === 0 ? `  ${title} ` : title);
        count(tally, `retitle:${result.status}`);
        name = 'retitleSession';
      } else {
        name = 'retitleSession (no session)';
      }

      break;

    default:
      store.toggle();
      name = 'toggle';
  }

  count(tally, name);
  return name;
}

/** Every operation the generator can draw, as `step` names it when it acted. */
const OPERATIONS = ['show', 'hide', 'resize', 'resetHeight', 'activateTool', 'openSession', 'setSessionState', 'closeSession', 'activateSession', 'syncPlugins', 'registerTool', 'unregisterTool', 'fitHeight', 'toggle', 'pluginLeaves', 'pluginReturns', 'openFromPlugin', 'retitleSession'];

/** The sessions of a state that are held. */
const heldOf = (state: PanelState): Array<PanelState['sessions'][string]> => Object.values(state.sessions).filter((session) => session.held === true);

describe('the panel under random operations', () => {
  it('keeps every invariant after every operation, and what it saves comes back whole', () => {
    const clock = { time: 1 };
    const tick = () => {
      clock.time += 7;
    };

    const tally: Tally = new Map();
    for (let seed = 1; seed <= 150; seed += 1) {
      let ids = 0;
      const store = createPanelStore({
        newId: () => `s${String((ids += 1))}`,
        now: () => clock.time,
      });
      store.registerTool(tool('terminal', 'Terminal', 10));
      store.syncPlugins([{ id: 'acme', tools: [tool('one')] }]);
      const next = generator(seed);
      for (let operation = 0; operation < 120; operation += 1) {
        const before = store.getSnapshot();
        const name = step(store, next, tick, tally);
        const state = store.getSnapshot();
        expect(checkInvariants(state), `seed ${String(seed)}, operation ${String(operation)} (${name})`).toEqual([]);
        // The strip never shows a session that is hidden, and a tool on screen is always a tool that is visible.
        const tools = store.selectors.toolIds(state);
        const active = store.selectors.activeTool(state);
        expect(active === null || tools.includes(active), `seed ${String(seed)}, operation ${String(operation)}: the tool on screen is visible`).toBe(true);
        for (const id of tools) {
          const strip = store.selectors.sessionIds(state, id);
          expect(strip.every((one) => store.selectors.session(state, one) !== undefined)).toBe(true);
          const on = store.selectors.activeSession(state, id);
          expect(on === null || strip.includes(on)).toBe(true);
        }

        // The tabs of every strip, from the words of the rule (SCT1, TI1): the scope a tab draws only for a twin of another scope, the ordinal of a twin of its own scope, and a name of its own for every tab.
        expect(tabProblems(state, store.selectors), `seed ${String(seed)}, operation ${String(operation)} (${name}): the tabs`).toEqual([]);
        for (const id of tools) {
          const strip = store.selectors.sessionIds(state, id);
          for (const one of strip) {
            const item = store.selectors.sessionItem(state, one);
            const mine = state.sessions[one];
            if (item === undefined || mine === undefined) {
              continue;
            }

            const twins = strip.filter((other) => state.sessions[other]?.title === mine.title && state.sessions[other]?.scope === mine.scope).length;
            // What the tab draws after the title is its ordinal (a title can end in `(2)` by itself).
            const ordinal = (item.head + item.tail).slice(mine.title.length);
            const number = ordinal === '' ? 1 : Number(/\((\d+)\)/.exec(ordinal)?.[1]);
            count(tally, item.scope === '' ? 'tab:no scope' : 'tab:scope');
            count(tally, number === 1 ? 'tab:no ordinal' : 'tab:ordinal');
            if (number > twins) {
              // A number skipped so that no two tabs have one name: a title that looks like another's ordinal.
              count(tally, 'tab:skipped');
            }
          }
        }

        // A21, in words: a session is listed exactly when its tool is registered and visible and (its plugin is live, or it is held): a held session of a plugin that is off is listed, and nothing else of one is.
        // Written out here from `live` and `held`, not from `sessionVisible`, so the rule is not checked against its own implementation.
        const listed = new Set(tools.flatMap((id) => store.selectors.sessionIds(state, id)));
        for (const [id, one] of Object.entries(state.sessions)) {
          const shouldList = tools.includes(one.tool) && (one.plugin === 'host' || state.live.includes(one.plugin) || one.held === true);
          expect(listed.has(id), `seed ${String(seed)}, operation ${String(operation)} (${name}): ${id} of ${one.plugin} is ${shouldList ? '' : 'not '}to be listed`).toBe(shouldList);
        }

        // A held session never changes, whatever is done, until its tab closes: the very same record, or none. It is held by an unload and by nothing else.
        const heldBefore = heldOf(before);
        for (const one of heldBefore) {
          // An own lookup: `constructor` is an id as legal as `s1`, and `sessions['constructor']` is a function when there is no such session.
          const now = Object.hasOwn(state.sessions, one.id) ? state.sessions[one.id] : undefined;
          expect([one, undefined], `seed ${String(seed)}, operation ${String(operation)} (${name}): the held session ${one.id} changed`).toContain(now);
          if (now === undefined) {
            count(tally, 'held:closed');
          }
        }

        const heldBeforeIds = new Set(heldBefore.map((one) => one.id));
        for (const one of heldOf(state)) {
          if (!heldBeforeIds.has(one.id)) {
            count(tally, 'held:made');
            expect(name, `seed ${String(seed)}, operation ${String(operation)}: ${one.id} was held by ${name}`).toMatch(/^(syncPlugins|pluginLeaves)$/);
          }
        }

        // A plugin that comes back while it has held sessions: they are still there, still ended, the same records (checked above).
        if (heldBefore.some((one) => state.live.includes(one.plugin) && !before.live.includes(one.plugin))) {
          count(tally, 'held:returned');
        }

        // An operation that answers no-op returns the very state it was given (no work for a renderer).
        if (state === before) {
          continue;
        }
      }

      const document = store.serialise();
      expect(JSON.parse(JSON.stringify(document))).toEqual(document);
      // A held session is saved as every session is, by its identity: the flag is never written, and a session that comes back is never held.
      expect(JSON.stringify(document), `seed ${String(seed)}: a held session is saved as identity only`).not.toContain('held');
      const restored = restorePanel(JSON.parse(JSON.stringify(document)), { now: clock.time });
      expect(restored.ok, `seed ${String(seed)}: what it saved is readable`).toBe(true);
      if (restored.ok) {
        expect(checkInvariants(restored.state)).toEqual([]);
        expect(restored.repaired, `seed ${String(seed)}: nothing needed repair`).toBe(false);
        expect(restored.state.order).toEqual(document.sessions.map((one) => one.id));
        expect(heldOf(restored.state), `seed ${String(seed)}: a restored session is never held`).toEqual([]);
      }
    }

    // A uniform draw gives each operation some 1,000 of the 18,000 and each state well over 1,000: the floor is a third of that, so a generator that stops mixing its bits fails here and not silently.
    for (const operation of OPERATIONS) {
      expect(tally.get(operation) ?? 0, `operation ${operation}`).toBeGreaterThan(300);
    }

    for (const state of STATES) {
      expect(tally.get(`state:${state}`) ?? 0, `state ${state}`).toBeGreaterThan(400);
    }

    // The held sessions are what this is for: a run that never made one, never saw its plugin come back while it was held, or never closed one, proves nothing about them.
    for (const event of ['held:made', 'held:returned', 'held:closed']) {
      expect(tally.get(event) ?? 0, `event ${event}`).toBeGreaterThan(100);
    }

    // A retitle that changes a title, one that changes nothing (the title it has) and one that is refused (a held session) must all have been drawn: a run that only ever renamed, or never met a held session, proves nothing about the others.
    for (const event of ['retitle:done', 'retitle:noop', 'retitle:refused']) {
      expect(tally.get(event) ?? 0, `event ${event}`).toBeGreaterThan(20);
    }

    // The tabs are what this part is for: a run in which no tab ever drew a scope, an ordinal, or a skipped number, or in which every tab did, proves nothing about the rule.
    for (const event of ['tab:scope', 'tab:no scope', 'tab:ordinal', 'tab:no ordinal']) {
      expect(tally.get(event) ?? 0, `event ${event}`).toBeGreaterThan(300);
    }

    expect(tally.get('tab:skipped') ?? 0, 'event tab:skipped').toBeGreaterThan(10);
  });

  // A wall-clock bound is the runner's, not the model's (a loaded CI job took twice the time a laptop does), so what is checked is what React reads: with 500 sessions, a state change leaves the
  // lists the strip and the body subscribe to as they were, the same arrays, so only the one session's tab and body re-render.
  it('with 500 sessions, a state change leaves the lists the strip and the body read as they were', () => {
    let n = 0;
    const store = createPanelStore({ newId: () => `s${String((n += 1))}` });
    store.registerTool(tool('logs', 'Logs', 1));
    for (let i = 0; i < 500; i += 1) {
      store.openSession({ tool: 'logs', plugin: 'host', title: `session-${String(i % 50)}` }, { reveal: false });
    }

    const ids = store.selectors.sessionIds(store.getSnapshot(), 'logs');
    const tools = store.selectors.toolIds(store.getSnapshot());
    const mounted = store.selectors.mounted(store.getSnapshot());
    expect(ids).toHaveLength(500);
    for (let i = 0; i < 1000; i += 1) {
      store.setSessionState(`s${String((i % 500) + 1)}`, { state: i % 2 === 0 ? 'running' : 'ended' });
      const state = store.getSnapshot();
      expect(store.selectors.sessionIds(state, 'logs')).toBe(ids);
      expect(store.selectors.toolIds(state)).toBe(tools);
      expect(store.selectors.mounted(state)).toBe(mounted);
    }
  });
});

describe('the generator of the fuzz (CodeRabbit, fuzz.test.ts:14)', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const draw = (seed: number) => Array.from({ length: 8 }, generator(seed));
    expect(draw(7)).toEqual(draw(7));
    expect(draw(7)).not.toEqual(draw(8));
  });

  it('draws every residue the fuzz takes (2, 5, 14 and 15) about as often as any other, from the first draw on', () => {
    for (const seed of [1, 2, 3, 42, 149]) {
      for (const modulus of [2, 5, 14, 15]) {
        const next = generator(seed);
        const seen = new Array<number>(modulus).fill(0);
        const draws = 20_000;
        for (let i = 0; i < draws; i += 1) {
          seen[next() % modulus] += 1;
        }

        for (const hits of seen) {
          expect(hits, `seed ${String(seed)} modulus ${String(modulus)}: ${seen.join(',')}`).toBeGreaterThan((draws / modulus) * 0.85);
          expect(hits, `seed ${String(seed)} modulus ${String(modulus)}: ${seen.join(',')}`).toBeLessThan((draws / modulus) * 1.15);
        }
      }
    }
  });
});
