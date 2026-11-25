import type { FindOptions, Finder, FindState } from '../engine';
import type { FindScreen } from './findSession';

// A finder and a screen for the tests of the find bar and its session: they have the contract of the real ones (`engine.ts`: a finder that is told where the find stands, a screen that answers once for its finder) and
// the counters a test asks for. A screen can HOLD its answer (`held`), so that a test decides when the finder arrives, and in which order, with no timer. Invented text; nothing here is an emulator.

/** A step of the finder: which way, what was looked for, and how. */
export type FindCall = { readonly direction: 'next' | 'previous'; readonly query: string; readonly options: FindOptions };

export type FakeFinder = Finder & {
  /** Every step, in order. */
  readonly calls: readonly FindCall[];
  /** How many times the highlights were cleared. The real finder tells its listeners the empty state when it is cleared (no match, none counted), and so does this one. */
  readonly clears: () => number;
  /** How many listeners the finder has now. */
  readonly listeners: () => number;
  /** The find stands here now: tells the listeners, as the emulator does after a step and when the output changes under it. */
  readonly tell: (state: FindState) => void;
};

export function fakeFinder(): FakeFinder {
  const calls: FindCall[] = [];
  const listeners = new Set<(state: FindState) => void>();
  let clears = 0;
  const tell = (state: FindState) => {
    for (const listener of [...listeners]) {
      listener(state);
    }
  };

  return {
    next: (query, options) => {
      calls.push({ direction: 'next', query, options });
    },
    previous: (query, options) => {
      calls.push({ direction: 'previous', query, options });
    },
    clear: () => {
      clears += 1;
      tell({ index: -1, count: 0, capped: false });
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    calls,
    clears: () => clears,
    listeners: () => listeners.size,
    tell,
  };
}

export type FakeFindScreen = FindScreen & {
  /** How many times the screen was asked for its finder. */
  readonly asks: () => number;
  /** How many times the keyboard was given back to the screen. */
  readonly focuses: () => number;
  /** Answers the oldest ask that waits (the screen was made with `held`): with the finder, or with `undefined`, as a screen whose emulator is not made yet does. */
  readonly answer: (finder: Finder | undefined) => void;
  /** Fails the oldest ask that waits. */
  readonly fail: (error: unknown) => void;
  /** How many asks wait for an answer. */
  readonly waiting: () => number;
};

export type FakeFindScreenOptions = {
  /** What the screen answers when asked, unless it holds its answers. Default: no finder (`undefined`). */
  readonly finder?: Finder | undefined;
  /** The screen holds every answer until `answer` or `fail` gives it. */
  readonly held?: boolean | undefined;
};

export function fakeFindScreen(config: FakeFindScreenOptions = {}): FakeFindScreen {
  const waiting: Array<{ readonly resolve: (finder: Finder | undefined) => void; readonly reject: (error: unknown) => void }> = [];
  let asks = 0;
  let focuses = 0;
  return {
    find: async () => {
      asks += 1;
      if (config.held !== true) {
        return Promise.resolve(config.finder);
      }

      // The executor form: this file is in the app's TypeScript project, whose library has no `Promise.withResolvers` (the test project's has).
      return new Promise<Finder | undefined>((resolve, reject) => {
        waiting.push({ resolve, reject });
      });
    },
    focus: () => {
      focuses += 1;
      return true;
    },
    asks: () => asks,
    focuses: () => focuses,
    answer: (finder) => {
      waiting.shift()?.resolve(finder);
    },
    fail: (error) => {
      waiting.shift()?.reject(error);
    },
    waiting: () => waiting.length,
  };
}

/** Lets the promises that are settled run their continuations: the answers of `find`. No timer, no wait: a fixed number of turns of the microtask queue, more than any chain of the session's is long. */
export async function settled(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }
}
