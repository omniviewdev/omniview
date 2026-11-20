import { isObject } from '../tabs/json';
import { candidateOf, type Cand, type Owner } from './results';
import { LIMITS, TIMING, type ErrorHook, type Provider, type Scheduler, type SearchScope, type SourceState } from './types';

// The asynchronous half of the palette (ch16 S71, S72). A provider that answers asynchronously is asked 150 ms after the last keystroke, with a signal; at most four are in flight; one that
// has not answered in five seconds has failed; a request the query supersedes is aborted and its answer is never delivered, whether or not the provider honours the signal. Each source
// replaces its own rows at once when it answers, and the rows of its last answer stay (pending) until then. A provider that throws, rejects, never answers or answers nonsense is
// contained and reported for that provider alone. The runner knows nothing of ranking, sections or rows: it holds what each source said, and says when that changed.

/** A provider that answers asynchronously, with everything the runner needs to ask it and to read what it says. */
export type AsyncSource = {
  readonly id: string;
  readonly provider: Provider;
  readonly owner: Owner;
  readonly pluginName: string;
  readonly title: string;
  /** Rows kept, at most `LIMITS.rowsPerProvider`. */
  readonly limit: number;
};

/** What one source said, the last time it said anything: replaced as a whole when it changes. */
export type Answer = {
  readonly id: string;
  readonly source: AsyncSource;
  readonly state: SourceState;
  /** The rows of the last answer, read: they answer `query`, which may not be the query of now (they are then pending, and inert). */
  readonly rows: readonly Cand[];
  readonly query: string;
  /** How many results the provider has in all, when it returned fewer; else `0`. */
  readonly limited: number;
  readonly partial: boolean;
  readonly live: boolean;
  readonly message: string;
  /** A word for the failure: the provider's own (`Starting`), `Timed out`, or `Unavailable`. */
  readonly word: string;
  readonly attempts: number;
  /** Candidates of the answer that were not valid data. */
  readonly invalid: number;
  /** How long the last request took, in milliseconds. */
  readonly ms: number;
  /** When it last became pending. */
  readonly since: number;
  readonly doneAt: number;
};

export type Request = { readonly query: string; readonly scope: SearchScope };

export type RunnerOptions = {
  readonly scheduler: Scheduler;
  /** Called after what the sources say changed. */
  readonly onChange: () => void;
  /** Called with a failure of a provider's code that was not an expected one (not a timeout, not an abort). */
  readonly onError: ErrorHook;
};

export type Runner = {
  /** The answers, in the order of the sources of the last `begin`. */
  readonly answers: () => readonly Answer[];
  /**
   * A new request: everything in flight is aborted, the debounce starts again (or not, when `immediate`), and every source is pending. `keep` holds on to the rows the sources of
   * this request gave before (a new query in the same scope); without it they go (the scope changed). A source that is not in `sources` is dropped.
   */
  readonly begin: (request: Request, sources: readonly AsyncSource[], options: { readonly immediate: boolean; readonly keep: boolean }) => void;
  /** Asks one source again at once; `@live` asks every source whose live updates stopped. */
  readonly retry: (id: string) => boolean;
  /** Asks again every source that failed. Returns how many. */
  readonly retryAll: () => number;
  /** The sources that `leaving` names are gone (a plugin left, PO1): their requests are aborted, their answers dropped. */
  readonly forget: (leaving: (source: AsyncSource) => boolean) => boolean;
  /** Aborts everything, clears the timers and drops every answer. */
  readonly stop: () => void;
  readonly pending: () => number;
  /** A source has been pending for the loader's time (1 s). */
  readonly slow: () => boolean;
  readonly inFlight: () => number;
};

type Run = { readonly source: AsyncSource; readonly controller: AbortController; readonly generation: number; timer: unknown; finished: boolean };

const LIVE_STATES: readonly SourceState[] = ['ready', 'partial', 'limited'];
const NOWHERE: SearchScope = { plugin: null, chips: [], scope: null, kind: 'all' };

const blank = (source: AsyncSource, now: number): Answer => ({ id: source.id, source, state: 'idle', rows: [], query: '', limited: 0, partial: false, live: true, message: '', word: '', attempts: 0, invalid: 0, ms: 0, since: now, doneAt: 0 });

/** What a provider's answer says, read. A list of candidates, or `{ rows, limited?, partial?, live?, message? }`; anything else is a failure of the provider. */
function normalise(source: AsyncSource, result: unknown): Partial<Answer> {
  const object = isObject(result) && !Array.isArray(result) ? result : undefined;
  const list: unknown = Array.isArray(result) ? result : object?.rows;
  if (!Array.isArray(list)) {
    throw new TypeError('A search provider must answer with a list of candidates, or an object with `rows`.');
  }

  const rows: Cand[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  for (const item of list.slice(0, source.limit)) {
    const cand = candidateOf(item, source.owner);
    if (cand === undefined) {
      invalid += 1;
    } else if (!seen.has(cand.key)) {
      seen.add(cand.key);
      rows.push(cand);
    }
  }

  const declared = typeof object?.limited === 'number' && Number.isFinite(object.limited) ? Math.floor(object.limited) : 0;
  const total = Math.max(declared, list.length > source.limit ? list.length : 0);
  const limited = total > rows.length ? total : 0;
  const partial = object?.partial === true;
  const state: SourceState = partial ? 'partial' : limited > 0 ? 'limited' : 'ready';
  return { state, rows, limited, partial, live: object?.live !== false, message: typeof object?.message === 'string' ? object.message : '', word: '', invalid };
}

const wordOf = (error: unknown): string => (isObject(error) && typeof error.word === 'string' && error.word !== '' ? error.word : 'Unavailable');
const messageOf = (error: unknown, fallback: string): string => {
  const message = isObject(error) && typeof error.message === 'string' ? error.message : typeof error === 'string' ? error : '';
  return message === '' ? fallback : message;
};

export function createRunner(options: RunnerOptions): Runner {
  const { scheduler, onChange, onError } = options;
  const answers = new Map<string, Answer>();
  const sources = new Map<string, AsyncSource>();
  const runs = new Set<Run>();
  let queue: AsyncSource[] = [];
  let generation = 0;
  let request: Request = { query: '', scope: NOWHERE };
  let debounce: unknown;
  let loader: unknown;
  /** The debounce has passed: a place that frees up may start the next source in the queue. */
  let armed = false;

  const update = (id: string, patch: Partial<Answer>): void => {
    const current = answers.get(id);
    if (current !== undefined) {
      answers.set(id, Object.freeze({ ...current, ...patch }));
    }
  };

  const abortAll = (): void => {
    for (const run of runs) {
      run.finished = true;
      scheduler.clearTimeout(run.timer);
      run.controller.abort();
    }

    runs.clear();
    queue = [];
  };

  const startLoader = (): void => {
    scheduler.clearTimeout(loader);
    loader = scheduler.setTimeout(() => {
      if ([...answers.values()].some((answer) => answer.state === 'pending')) {
        onChange();
      }
    }, TIMING.loader + 30);
  };

  function pump(): void {
    while (armed && runs.size < LIMITS.inFlight) {
      const next = queue.shift();
      if (next === undefined) {
        return;
      }

      start(next, false);
    }
  }

  function start(source: AsyncSource, retried: boolean): void {
    const run: Run = { source, controller: new AbortController(), generation, timer: undefined, finished: false };
    runs.add(run);
    const startedAt = scheduler.now();
    const query = request.query.trim();
    const attempts = (answers.get(source.id)?.attempts ?? 0) + (retried ? 1 : 0);
    update(source.id, { state: 'pending', attempts });

    const finish = (result: Partial<Answer>): void => {
      if (run.finished) {
        return;
      }

      run.finished = true;
      scheduler.clearTimeout(run.timer);
      runs.delete(run);
      // A request that is no longer the current one is dropped whole: a superseded answer never reaches the list.
      if (run.generation !== generation) {
        pump();
        return;
      }

      // The answer is in: the provider may let go of whatever it holds for it.
      run.controller.abort();
      const now = scheduler.now();
      update(source.id, { ms: Math.round(now - startedAt), doneAt: now, query, ...result });
      pump();
      onChange();
    };

    const fail = (error: unknown): void => {
      if (run.finished || run.generation !== generation) {
        return;
      }

      onError(error, `search() of ${source.id}`);
      finish({ state: 'error', word: wordOf(error), message: messageOf(error, `${source.title} did not answer.`), rows: [], limited: 0, partial: false, live: true, invalid: 0 });
    };

    run.timer = scheduler.setTimeout(() => {
      finish({ state: 'timeout', word: 'Timed out', message: `${source.title} didn't answer in ${String(TIMING.timeout / 1000)} seconds.`, rows: [], limited: 0, partial: false, live: true, invalid: 0 });
    }, TIMING.timeout);

    let pending: Promise<unknown>;
    try {
      pending = Promise.resolve(source.provider.search?.(query, request.scope, run.controller.signal));
    } catch (error) {
      fail(error);
      return;
    }

    pending.then((result) => {
      if (!run.finished) {
        finish(normalise(source, result));
      }
    }).catch(fail);
  }

  return {
    answers: () => [...sources.values()].flatMap((source) => answers.get(source.id) ?? []),

    begin: (next, list, { immediate, keep }) => {
      generation += 1;
      abortAll();
      scheduler.clearTimeout(debounce);
      scheduler.clearTimeout(loader);
      armed = false;
      request = next;
      sources.clear();
      for (const source of list) {
        sources.set(source.id, source);
      }

      for (const id of [...answers.keys()]) {
        if (!keep || !sources.has(id)) {
          answers.delete(id);
        }
      }

      if (list.length === 0) {
        onChange();
        return;
      }

      const now = scheduler.now();
      for (const source of list) {
        answers.set(source.id, Object.freeze({ ...(answers.get(source.id) ?? blank(source, now)), source, state: 'pending', since: now }));
      }

      queue = [...list];
      debounce = scheduler.setTimeout(
        () => {
          armed = true;
          pump();
        },
        immediate ? 0 : TIMING.debounce,
      );
      startLoader();
      onChange();
    },

    retry: function retry(id: string): boolean {
      if (id === '@live') {
        let any = false;
        for (const answer of [...answers.values()]) {
          if (!answer.live && LIVE_STATES.includes(answer.state)) {
            any = retry(answer.id) || any;
          }
        }

        return any;
      }

      const source = sources.get(id);
      if (source === undefined || !answers.has(id)) {
        return false;
      }

      update(id, { since: scheduler.now() });
      startLoader();
      armed = true;
      start(source, true);
      onChange();
      return true;
    },

    retryAll: () => {
      let count = 0;
      for (const answer of [...answers.values()]) {
        const source = sources.get(answer.id);
        if ((answer.state === 'error' || answer.state === 'timeout') && source !== undefined) {
          update(answer.id, { since: scheduler.now() });
          armed = true;
          start(source, true);
          count += 1;
        }
      }

      if (count > 0) {
        startLoader();
        onChange();
      }

      return count;
    },

    forget: (leaving) => {
      let any = false;
      for (const run of [...runs]) {
        if (leaving(run.source)) {
          run.finished = true;
          scheduler.clearTimeout(run.timer);
          run.controller.abort();
          runs.delete(run);
          any = true;
        }
      }

      queue = queue.filter((source) => !leaving(source));
      for (const source of [...sources.values()]) {
        if (leaving(source)) {
          sources.delete(source.id);
          answers.delete(source.id);
          any = true;
        }
      }

      if ([...answers.values()].every((answer) => answer.state !== 'pending')) {
        scheduler.clearTimeout(loader);
      }

      if (any) {
        pump();
        onChange();
      }

      return any;
    },

    stop: () => {
      generation += 1;
      abortAll();
      scheduler.clearTimeout(debounce);
      scheduler.clearTimeout(loader);
      armed = false;
      answers.clear();
      sources.clear();
    },

    pending: () => [...answers.values()].filter((answer) => answer.state === 'pending').length,
    slow: () => {
      const now = scheduler.now();
      return [...answers.values()].some((answer) => answer.state === 'pending' && now - answer.since >= TIMING.loader);
    },
    inFlight: () => runs.size,
  };
}
