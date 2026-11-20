import { LIMITS, type Scheduler } from './types';

// Asynchronous work that is safe to type over, keyed (one request per field): the request starts after its delay (a debounce), a newer request for the same key replaces it (the older one
// is aborted if it runs, and its answer is NEVER delivered, whether or not its code honours the signal), at most `inFlight` run at once and the rest wait in the order they were asked,
// and one that has not answered in time has failed. The palette's runner (`../palette/runner.ts`) is the model; this one knows nothing of what it runs.

export type Outcome<T> = { readonly status: 'done'; readonly value: T } | { readonly status: 'failed'; readonly error: unknown } | { readonly status: 'timeout' };

export type Request<T> = {
  /** Quiet time before it starts; a request with no delay starts at once. */
  readonly delay: number;
  /** An answer that has not come by then is `timeout`: the signal is aborted and a late answer is ignored. */
  readonly timeout: number;
  readonly work: (signal: AbortSignal) => Promise<T> | T;
  /** Called once with how it went, unless the request was replaced or cancelled. */
  readonly done: (outcome: Outcome<T>) => void;
  /** Called when the work actually starts (not while it waits for its delay or for a place). */
  readonly started?: (() => void) | undefined;
};

export type RunnerOptions = {
  readonly scheduler: Scheduler;
  /** Default `LIMITS.inFlight`. */
  readonly inFlight?: number | undefined;
  /** Hears what a callback of the caller threw. */
  readonly onError: (error: unknown) => void;
};

export type Runner = {
  readonly run: <T>(key: string, request: Request<T>) => void;
  /** Stops the request for `key`: its timer, its place in the queue, its work (aborted) and its answer. */
  readonly cancel: (key: string) => boolean;
  readonly cancelAll: () => void;
  /** The key has a request that has not finished: waiting, queued or running. */
  readonly active: (key: string) => boolean;
  readonly running: () => number;
};

type Entry = {
  readonly key: string;
  readonly request: Request<never>;
  state: 'waiting' | 'queued' | 'running' | 'closed';
  timer: unknown;
  guard: unknown;
  controller: AbortController | undefined;
};

export function createRunner(options: RunnerOptions): Runner {
  const { scheduler, onError } = options;
  const limit = options.inFlight ?? LIMITS.inFlight;
  const entries = new Map<string, Entry>();
  let queue: Entry[] = [];
  let running = 0;

  const guarded = (callback: () => void): void => {
    try {
      callback();
    } catch (error) {
      onError(error);
    }
  };

  const release = (entry: Entry): boolean => {
    const wasRunning = entry.state === 'running';
    entry.state = 'closed';
    scheduler.clearTimeout(entry.timer);
    scheduler.clearTimeout(entry.guard);
    if (entries.get(entry.key) === entry) {
      entries.delete(entry.key);
    }

    return wasRunning;
  };

  function pump(): void {
    while (running < limit) {
      const next = queue.shift();
      if (next === undefined) {
        return;
      }

      if (next.state === 'queued') {
        start(next);
      }
    }
  }

  function finish(entry: Entry, outcome: Outcome<never>, abort: boolean): void {
    if (entry.state !== 'running') {
      return;
    }

    release(entry);
    running -= 1;
    if (abort) {
      entry.controller?.abort();
    }

    guarded(() => {
      entry.request.done(outcome);
    });
    pump();
  }

  function start(entry: Entry): void {
    entry.state = 'running';
    running += 1;
    const controller = new AbortController();
    entry.controller = controller;
    guarded(() => {
      entry.request.started?.();
    });
    if (entry.state !== 'running') {
      return;
    }

    entry.guard = scheduler.setTimeout(() => {
      finish(entry, { status: 'timeout' }, true);
    }, entry.request.timeout);

    let pending: Promise<never>;
    try {
      pending = Promise.resolve(entry.request.work(controller.signal));
    } catch (error) {
      finish(entry, { status: 'failed', error }, false);
      return;
    }

    pending.then(
      (value) => {
        finish(entry, { status: 'done', value }, false);
      },
      (error: unknown) => {
        finish(entry, { status: 'failed', error }, false);
      },
    );
  }

  function enqueue(entry: Entry): void {
    if (entry.state !== 'waiting') {
      return;
    }

    entry.timer = undefined;
    if (running < limit) {
      start(entry);
      return;
    }

    entry.state = 'queued';
    queue.push(entry);
  }

  const cancel = (key: string): boolean => {
    const entry = entries.get(key);
    if (entry === undefined) {
      return false;
    }

    queue = queue.filter((queued) => queued !== entry);
    if (release(entry)) {
      running -= 1;
      entry.controller?.abort();
      pump();
    }

    return true;
  };

  return {
    run: <T>(key: string, request: Request<T>) => {
      cancel(key);
      const entry: Entry = { key, request: request as unknown as Request<never>, state: 'waiting', timer: undefined, guard: undefined, controller: undefined };
      entries.set(key, entry);
      if (request.delay <= 0) {
        enqueue(entry);
      } else {
        entry.timer = scheduler.setTimeout(() => {
          enqueue(entry);
        }, request.delay);
      }
    },
    cancel,
    cancelAll: () => {
      for (const key of [...entries.keys()]) {
        cancel(key);
      }
    },
    active: (key) => entries.has(key),
    running: () => running,
  };
}
