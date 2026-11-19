import { describe, expect, it } from 'vitest';
import { checkInvariants, createPanelStore, restorePanel, type PanelState, type PanelStore } from './index';
import { generator, tool } from './testing';

// Thousands of random operations against the store, with the invariants of `checkInvariants` checked after each, and the saved session checked to come back whole. Deterministic: a seeded
// generator, and a failure names its seed and step. The same shape as the tab model's fuzz (../tabs/fuzz.test.ts).

const TOOLS = ['terminal', 'logs', 'acme:one', 'beta:two', 'constructor'];
const PLUGINS = ['acme', 'beta', 'host', 'gone'];
/** Ids a session may be given that every object already has a member for: the model's dictionaries must not take them for entries that are there. */
const ODD_IDS = ['constructor', '__proto__', 'toString'];
const STATES = ['starting', 'running', 'ended', 'failed'] as const;

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

  const roll = next() % 15;
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
        { tool: pick(TOOLS), plugin: pick(PLUGINS), title: `t${String(next() % 4)}`, scope: next() % 3 === 0 ? 'dev' : '', state: pickState(), ...(next() % 5 === 0 ? { id: pick(ODD_IDS) } : {}) },
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
    default:
      store.toggle();
      name = 'toggle';
  }

  count(tally, name);
  return name;
}

/** Every operation the generator can draw, as `step` names it when it acted. */
const OPERATIONS = ['show', 'hide', 'resize', 'resetHeight', 'activateTool', 'openSession', 'setSessionState', 'closeSession', 'activateSession', 'syncPlugins', 'registerTool', 'unregisterTool', 'fitHeight', 'toggle'];

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

        // An operation that answers no-op returns the very state it was given (no work for a renderer).
        if (state === before) {
          continue;
        }
      }

      const document = store.serialise();
      expect(JSON.parse(JSON.stringify(document))).toEqual(document);
      const restored = restorePanel(JSON.parse(JSON.stringify(document)), { now: clock.time });
      expect(restored.ok, `seed ${String(seed)}: what it saved is readable`).toBe(true);
      if (restored.ok) {
        expect(checkInvariants(restored.state)).toEqual([]);
        expect(restored.repaired, `seed ${String(seed)}: nothing needed repair`).toBe(false);
        expect(restored.state.order).toEqual(document.sessions.map((one) => one.id));
      }
    }

    // A uniform draw gives each operation some 1,200 of the 18,000 and each state well over 1,000: the floor is a third of that, so a generator that stops mixing its bits fails here and not silently.
    for (const operation of OPERATIONS) {
      expect(tally.get(operation) ?? 0, `operation ${operation}`).toBeGreaterThan(400);
    }

    for (const state of STATES) {
      expect(tally.get(`state:${state}`) ?? 0, `state ${state}`).toBeGreaterThan(400);
    }
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
