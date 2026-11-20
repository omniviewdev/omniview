import { createPanelStore, type PanelStore, type PanelStoreOptions } from './store';
import type { PanelState, Selectors, Session, SessionInput, ToolInput } from './types';

// Test support only: nothing in the model imports this file. A store whose ids and clock are under the test's control, and a world of invented plugins (`acme`, `beta`) and tools,
// so a test names no real plugin.

/** A tool as a plugin of the fixture brings it. */
export const tool = (id: string, label = id, order?: number): ToolInput => ({ id, label, icon: 'box', ...(order === undefined ? {} : { order }) });

/** A session as a plugin of the fixture opens it. */
export const session = (toolId: string, plugin: string, title: string, extra: Partial<SessionInput> = {}): SessionInput => ({ tool: toolId, plugin, title, ...extra });

/** The listed sessions of a tool, oldest first, read from the state by the words of the rule (a tool that is visible, a plugin that is live or a session that is held), not from the model's own function. */
function listedOf(state: PanelState, toolId: string): Session[] {
  const tool = Object.hasOwn(state.tools, toolId) ? state.tools[toolId] : undefined;
  if (tool === undefined || !(tool.owner === 'host' || state.live.includes(tool.owner))) {
    return [];
  }

  return state.order.flatMap((id) => {
    const one = Object.hasOwn(state.sessions, id) ? state.sessions[id] : undefined;
    return one?.tool === toolId && (one.plugin === 'host' || state.live.includes(one.plugin) || one.held === true) ? [one] : [];
  });
}

/**
 * The rules the tabs of a strip keep, written from the words of the rule (SCT1, TI1; the mock's `labelParts`, shell-panel.js:207-221) and read by a plain loop over the sessions, not from the selector that
 * implements them: a sentence for each rule a tool's tabs break, none when they are sound. The tabs are those `selectors` gives for `state`.
 *
 *   - a tab draws its scope exactly when its session has one and another listed session of its tool has the same title and another scope, and then the scope it draws is its own;
 *   - the sessions of one title and one scope are numbered in the order they were opened, the first having none (the second is `(2)`); a number is skipped when it would give a tab the name of one before it
 *     (a title that looks like an ordinal beside two sessions of the title it looks like);
 *   - a tab's name is its title, its ordinal and the scope it draws, in that order, and its head and its tail are the title and the ordinal: the tab draws what its name says;
 *   - no two tabs of a tool have one name: the accessible name always tells two of them apart.
 */
export function tabProblems(state: PanelState, selectors: Pick<Selectors, 'toolIds' | 'sessionIds' | 'sessionItem'>): string[] {
  const problems: string[] = [];
  for (const toolId of selectors.toolIds(state)) {
    const listed = listedOf(state, toolId);
    const ids = selectors.sessionIds(state, toolId);
    if (ids.join('\u0000') !== listed.map((one) => one.id).join('\u0000')) {
      problems.push(`the strip of ${toolId} lists ${ids.join(', ')}, not the listed sessions ${listed.map((one) => one.id).join(', ')}`);
      continue;
    }

    const names = new Map<string, string>();
    const taken = new Set<string>();
    listed.forEach((one, index) => {
      const item = selectors.sessionItem(state, one.id);
      if (item === undefined) {
        problems.push(`the session ${one.id} is listed and has no tab`);
        return;
      }

      const twin = listed.some((other) => other !== one && other.title === one.title && other.scope !== one.scope);
      const scope = one.scope !== '' && twin ? one.scope : '';
      if (item.scope !== scope) {
        problems.push(`the tab of ${one.id} draws the scope ${JSON.stringify(item.scope)}, wanted ${JSON.stringify(scope)} (${twin ? 'it has a twin of another scope' : 'it has no twin of another scope'})`);
      }

      const before = listed.slice(0, index);
      const alike = listed.filter((other) => other.title === one.title && other.scope === one.scope);
      let number = alike.length > 1 ? before.filter((other) => other.title === one.title && other.scope === one.scope).length + 1 : 1;
      const nameWith = (n: number) => `${one.title}${n === 1 ? '' : ` (${String(n)})`}${scope === '' ? '' : ` · ${scope}`}`;
      while (taken.has(nameWith(number))) {
        number += 1;
      }

      taken.add(nameWith(number));

      const ordinal = number === 1 ? '' : ` (${String(number)})`;
      if (item.name !== nameWith(number)) {
        problems.push(`the tab of ${one.id} is named ${JSON.stringify(item.name)}, wanted ${JSON.stringify(nameWith(number))}`);
      }

      if (item.head + item.tail !== one.title + ordinal) {
        problems.push(`the tab of ${one.id} draws ${JSON.stringify(item.head + item.tail)} for its name, wanted ${JSON.stringify(one.title + ordinal)}`);
      }

      const clash = names.get(item.name);
      if (clash !== undefined) {
        problems.push(`the tabs of ${clash} and ${one.id} are both named ${JSON.stringify(item.name)}`);
      }

      names.set(item.name, one.id);
    });
  }

  return problems;
}

/**
 * A seeded generator of 32-bit unsigned integers (mulberry32): every bit is mixed, in exact integer arithmetic (`Math.imul`), so `n % 2`, `n % 14` and the rest are fair. The linear
 * congruential generator the fuzz and the damaged-document test used multiplied past 2^53 in floating point: the low bits of every draw after the first were rounded away, `n % 2` was 0 in 99.6%
 * of draws, and half of the operations of the fuzz never ran.
 */
export function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

export type Harness = {
  readonly store: PanelStore;
  /** The clock: `now` is what the store reads; `tick` moves it. */
  readonly clock: { now: number };
  readonly tick: (ms?: number) => void;
  readonly snapshot: () => PanelState;
  /** How many times a subscriber was told. */
  readonly notified: () => number;
};

export type HarnessOptions = Partial<PanelStoreOptions> & {
  /** Registers the host's tools: `terminal`, `logs`. Default: none. */
  readonly hostTools?: readonly ToolInput[] | undefined;
  /** The plugins that are live at the start, each with the tools it brings. Default: none. */
  readonly plugins?: Readonly<Record<string, readonly ToolInput[]>> | undefined;
};

/** A store with ids `s1`, `s2`, ... and a clock that starts at 1,000,000. */
export function boot(options: HarnessOptions = {}): Harness {
  const clock = { now: 1_000_000 };
  let counter = 0;
  const store = createPanelStore({
    newId: () => {
      counter += 1;
      return `s${String(counter)}`;
    },
    now: () => clock.now,
    ...options,
  });
  for (const input of options.hostTools ?? []) {
    store.registerTool(input);
  }

  if (options.plugins !== undefined) {
    store.syncPlugins(Object.entries(options.plugins).map(([id, tools]) => ({ id, tools })));
  }

  let told = 0;
  store.subscribe(() => {
    told += 1;
  });
  return {
    store,
    clock,
    tick: (ms = 1000) => {
      clock.now += ms;
    },
    snapshot: store.getSnapshot,
    notified: () => told,
  };
}
