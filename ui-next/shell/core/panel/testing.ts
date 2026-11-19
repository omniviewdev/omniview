import { createPanelStore, type PanelStore, type PanelStoreOptions } from './store';
import type { PanelState, SessionInput, ToolInput } from './types';

// Test support only: nothing in the model imports this file. A store whose ids and clock are under the test's control, and a world of invented plugins (`acme`, `beta`) and tools,
// so a test names no real plugin.

/** A tool as a plugin of the fixture brings it. */
export const tool = (id: string, label = id, order?: number): ToolInput => ({ id, label, icon: 'box', ...(order === undefined ? {} : { order }) });

/** A session as a plugin of the fixture opens it. */
export const session = (toolId: string, plugin: string, title: string, extra: Partial<SessionInput> = {}): SessionInput => ({ tool: toolId, plugin, title, ...extra });

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
