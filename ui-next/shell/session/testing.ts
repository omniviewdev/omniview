import type { FlagSource, SessionStorage } from './types';

// Test support only: nothing in the session module imports this file. A place to keep the session that is a string in memory, with the calls it was asked for written down, so a test can
// say what was read, written and kept aside, and make any of the three fail.

export type Memory = {
  readonly storage: SessionStorage;
  /** The text the place holds now: what a read would answer. */
  readonly text: () => string | undefined;
  /** Replaces what the place holds, as another run of the app would have left it. */
  readonly set: (text: string | undefined) => void;
  /** Every text written, in order. */
  readonly writes: string[];
  /** What was kept aside, by name. */
  readonly kept: Map<string, string>;
  /** Makes the next calls of the named kind reject with this error (or stop rejecting with `undefined`). */
  readonly fail: (call: 'read' | 'write' | 'keep', error: Error | undefined) => void;
  /** Makes the read answer only when `release` is called, as a place that is slow. */
  readonly hold: () => { readonly release: (text: string | undefined) => void };
};

export function memoryStorage(initial?: string): Memory {
  let text = initial;
  const writes: string[] = [];
  const kept = new Map<string, string>();
  const failures = new Map<'read' | 'write' | 'keep', Error>();
  let held: ((text: string | undefined) => void) | undefined;
  let holding = false;

  return {
    storage: {
      read: async () => {
        const failure = failures.get('read');
        if (failure !== undefined) {
          throw failure;
        }

        if (holding) {
          return new Promise<string | undefined>((resolve) => {
            held = resolve;
          });
        }

        return text;
      },
      write: async (next) => {
        const failure = failures.get('write');
        if (failure !== undefined) {
          throw failure;
        }

        writes.push(next);
        text = next;
      },
      keep: async (name, value) => {
        const failure = failures.get('keep');
        if (failure !== undefined) {
          throw failure;
        }

        kept.set(name, value);
      },
    },
    text: () => text,
    set: (next) => {
      text = next;
    },
    writes,
    kept,
    fail: (call, error) => {
      if (error === undefined) {
        failures.delete(call);
      } else {
        failures.set(call, error);
      }
    },
    hold: () => {
      holding = true;
      return {
        release: (answer) => {
          held?.(answer);
        },
      };
    },
  };
}

/** A yes or no the window holds that no model owns, made as the host makes it (`FlagSource`): a test sets it, and the session listens to it. */
export type Flag = FlagSource & { readonly set: (on: boolean) => void };

export function flag(initial = false): Flag {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (on) => {
      if (on !== current) {
        current = on;
        for (const listener of [...listeners]) {
          listener();
        }
      }
    },
  };
}
