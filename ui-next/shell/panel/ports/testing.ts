import type { PortNames, PortsDeps } from './api';

// Test and probe support for the Ports tool: the host's calls and events as a test controls them, in an order the test chooses. Nothing in the product imports this file. Each call of the list is a promise the test answers, so that what
// happens when an event arrives while a read is in flight is a sequence written in the test and not a race.

export type Deferred<T> = {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
};

/** A promise and the means to settle it from outside. Written with the constructor: the app's TypeScript project has no `Promise.withResolvers` in its library (the test project does). */
export function deferred<T>(): Deferred<T> {
  let resolve: Deferred<T>['resolve'] = () => undefined;
  let reject: Deferred<T>['reject'] = () => undefined;
  const promise = new Promise<T>((settleWith, failWith) => {
    resolve = settleWith;
    reject = failWith;
  });
  return { promise, resolve, reject };
}

/** A session as the runtime's binding hands it over, with the members a row reads. */
export function session(id: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    created_at: '2026-11-24T10:00:00Z',
    connection_type: 'RESOURCE',
    connection: { plugin_id: 'acme', connection_id: 'conn-1', resource_id: `res-${id}`, resource_key: 'widgets' },
    protocol: 'TCP',
    state: 'ACTIVE',
    local_port: 8081,
    remote_port: 8080,
    ...patch,
  };
}

type Handler = (event: { readonly data?: unknown }) => void;

export type FakePorts = {
  readonly deps: PortsDeps;
  /** How many times the host was asked for the list, and how many of those answers are still to come. */
  readonly listed: () => number;
  readonly pending: () => number;
  /** Answers the oldest read that is waiting (or the one at `index` of those that wait): with these sessions, or with a failure. One turn of promises runs after it, so that what it caused has happened when it returns. */
  readonly answer: (sessions: readonly unknown[] | null, index?: number) => Promise<void>;
  readonly fail: (error: unknown) => Promise<void>;
  /** The ids Stop was pressed for, in order, and the call of each: answered by the test. */
  readonly closed: () => readonly string[];
  readonly closeAnswer: (index?: number) => Promise<void>;
  readonly closeFail: (error: unknown, index?: number) => Promise<void>;
  /** Tells every handler of an event, as the runtime does, and runs the frame that asked for: what an event that comes alone comes to. */
  readonly emit: (name: string, data?: unknown) => void;
  /** Tells every handler of an event and leaves the frame it asked for waiting: one event of a burst, each of which the runtime's socket hands over in a task of its own. */
  readonly deliver: (name: string, data?: unknown) => void;
  /** The frames the store asked the window for: how many it asked for and how many it cancelled, how many wait, and the run of those that wait, as the window does at its next frame. */
  readonly frames: { readonly requested: () => number; readonly cancelled: () => number; readonly pending: () => number; readonly tick: () => void };
  /** How many handlers are on now, of one event or of all; and how many `On` and unsubscribe calls were made in all. */
  readonly handlers: (name?: string) => number;
  readonly on: () => number;
  readonly off: () => number;
  /** The addresses opened outside the app, and those put on the clipboard, in order. */
  readonly opened: readonly string[];
  readonly copied: readonly string[];
  /** What the clipboard answers next: whether it copied. Default: it does. */
  readonly clipboard: { works: boolean };
  /** What opening an address does next: nothing, or a rejection. */
  readonly browser: { reject: boolean };
  /** The timers that are waiting: how many, and a run of the one that was asked for last. */
  readonly timers: () => number;
  readonly fire: () => void;
  /** The delays the timers were asked for, in order. */
  readonly delays: () => readonly number[];
  /** The names the window knows, and a change of one. */
  readonly names: { readonly set: (plugin: string, connection: string, name: string | undefined) => void; readonly listeners: () => number };
  /** The page's events connection coming back after a gap, as a window in a browser has it: the socket opening, and how many listeners wait for it. */
  readonly reconnected: { readonly fire: () => void; readonly listeners: () => number };
  /** The window coming back to a person (the focus, the page's visibility), and how many listeners wait for it: none while nobody looks at the tool. */
  readonly woken: { readonly fire: () => void; readonly listeners: () => number };
  /** From now on the host answers a read at once with these sessions, as a host that keeps listing what it listed: the read a press makes before it acts needs no turn of the test. `undefined`: back to the answers the test gives. */
  readonly serve: (sessions: readonly unknown[] | null | undefined) => void;
};

/** One turn of the promises that are ready, a few of them: what a call that was answered has made of its answer by the time a test looks. */
export async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }
}

export function fakePorts(): FakePorts {
  const reads: Array<Deferred<readonly unknown[] | null>> = [];
  let listed = 0;
  const closes: Array<{ readonly id: string; readonly done: Deferred<unknown> }> = [];
  const handlers = new Map<string, Set<Handler>>();
  let on = 0;
  let off = 0;
  const opened: string[] = [];
  const copied: string[] = [];
  const clipboard = { works: true };
  const browser = { reject: false };
  const timers: Array<{ readonly run: () => void; cancelled: boolean }> = [];
  const frames: Array<{ readonly run: () => void; cancelled: boolean; ran: boolean }> = [];
  const known = new Map<string, string>();
  const heard = new Set<() => void>();
  const reconnecting = new Set<() => void>();
  const waking = new Set<() => void>();
  let served: readonly unknown[] | null | undefined;

  const names: PortNames = {
    of: (plugin, connection) => known.get(JSON.stringify([plugin, connection])),
    subscribe: (listener) => {
      heard.add(listener);
      return () => {
        heard.delete(listener);
      };
    },
  };

  const delays: number[] = [];

  const deps: PortsDeps = {
    client: {
      ListAllPortForwardSessions: async () => {
        listed += 1;
        if (served !== undefined) {
          return served;
        }

        const read = deferred<readonly unknown[] | null>();
        reads.push(read);
        return read.promise;
      },
      ClosePortForwardSession: async (id) => {
        const done = deferred<unknown>();
        closes.push({ id, done });
        return done.promise;
      },
    },
    events: {
      On: (name, listener) => {
        on += 1;
        const set = handlers.get(name) ?? new Set<Handler>();
        set.add(listener);
        handlers.set(name, set);
        return () => {
          off += 1;
          set.delete(listener);
        };
      },
    },
    openExternal: async (url) => {
      opened.push(url);
      if (browser.reject) {
        throw new Error('the browser did not open');
      }

      await Promise.resolve();
    },
    copy: async (text) => {
      copied.push(text);
      return Promise.resolve(clipboard.works);
    },
    names,
    explain: (error) => ({ gone: error instanceof Error && error.message === 'gone', text: error instanceof Error && error.message !== 'gone' ? error.message : '' }),
    schedule: (run, ms) => {
      delays.push(ms);
      const timer = { run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    frame: (run) => {
      const frame = { run, cancelled: false, ran: false };
      frames.push(frame);
      return () => {
        frame.cancelled = true;
      };
    },
    reconnect: (listener) => {
      reconnecting.add(listener);
      return () => {
        reconnecting.delete(listener);
      };
    },
    wake: (listener) => {
      waking.add(listener);
      return () => {
        waking.delete(listener);
      };
    },
  };

  const deliver = (name: string, data?: unknown): void => {
    for (const handler of [...(handlers.get(name) ?? [])]) {
      handler({ data });
    }
  };

  const tick = (): void => {
    for (const frame of frames.filter((candidate) => !candidate.cancelled && !candidate.ran)) {
      frame.ran = true;
      frame.run();
    }
  };

  return {
    deps,
    delays: () => [...delays],
    reconnected: {
      fire: () => {
        for (const listener of [...reconnecting]) {
          listener();
        }
      },
      listeners: () => reconnecting.size,
    },
    woken: {
      fire: () => {
        for (const listener of [...waking]) {
          listener();
        }
      },
      listeners: () => waking.size,
    },
    serve: (sessions) => {
      served = sessions;
    },
    listed: () => listed,
    pending: () => reads.length,
    answer: async (sessions, index = 0) => {
      reads.splice(index, 1)[0]?.resolve(sessions);
      await settle();
    },
    fail: async (error) => {
      reads.shift()?.reject(error);
      await settle();
    },
    closed: () => closes.map((close) => close.id),
    closeAnswer: async (index = 0) => {
      closes[index]?.done.resolve(null);
      await settle();
    },
    closeFail: async (error, index = 0) => {
      closes[index]?.done.reject(error);
      await settle();
    },
    emit: (name, data) => {
      deliver(name, data);
      tick();
    },
    deliver,
    frames: {
      requested: () => frames.length,
      cancelled: () => frames.filter((frame) => frame.cancelled).length,
      pending: () => frames.filter((frame) => !frame.cancelled && !frame.ran).length,
      tick,
    },
    handlers: (name) => (name === undefined ? [...handlers.values()].reduce((total, set) => total + set.size, 0) : (handlers.get(name)?.size ?? 0)),
    on: () => on,
    off: () => off,
    opened,
    copied,
    clipboard,
    browser,
    timers: () => timers.filter((timer) => !timer.cancelled).length,
    fire: () => {
      const timer = timers.filter((candidate) => !candidate.cancelled).at(-1);
      if (timer !== undefined) {
        timer.cancelled = true;
        timer.run();
      }
    },
    names: {
      set: (plugin, connection, name) => {
        const key = JSON.stringify([plugin, connection]);
        if (name === undefined) {
          known.delete(key);
        } else {
          known.set(key, name);
        }

        for (const listener of [...heard]) {
          listener();
        }

        tick();
      },
      listeners: () => heard.size,
    },
  };
}
