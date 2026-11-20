import { createFormStore, type FormOptions, type FormStore } from './store';
import { compileSchema } from './schema';
import { type CommitResult, type FormState, type Json, type OptionProvider, type RemoteValidator, type Scheduler, type SetResult, type SubmitFn, type SubmitOutcome, type SubmitPayload } from './types';

// Test support only: nothing in the model imports this file.
//
// A clock the test drives, so a check that takes 300 ms or ten seconds costs no time and the order of every timer is the same on every run (the palette's `testing.ts` has the same
// one; this folder does not import another folder's test support), a promise the test settles by hand, and a form over a recording submit callback.

/** The commit that a `setValue` started (a switch, a choice: they apply at once); fails the test when it started none. */
export async function committed(result: SetResult): Promise<CommitResult> {
  if (result.status !== 'set' || result.commit === undefined) {
    throw new Error('the change started no commit');
  }

  return result.commit;
}

export type ManualClock = {
  readonly scheduler: Scheduler;
  readonly now: () => number;
  /** Runs every timer due in the next `ms` milliseconds, oldest first, and lets the promises that each one settles run before the next. */
  readonly advance: (ms: number) => Promise<void>;
  /** Lets pending promise callbacks run, without moving the clock. */
  readonly flush: () => Promise<void>;
  /** Timers that have not fired. */
  readonly pending: () => number;
};

export function manualClock(): ManualClock {
  let time = 0;
  let counter = 0;
  const timers = new Map<number, { readonly at: number; readonly run: () => void }>();

  const flush = async (): Promise<void> => {
    for (let round = 0; round < 12; round += 1) {
      await Promise.resolve();
    }
  };

  const advance = async (ms: number): Promise<void> => {
    const until = time + ms;
    await flush();
    for (;;) {
      let nextId: number | undefined;
      let nextAt = Number.POSITIVE_INFINITY;
      for (const [id, timer] of timers) {
        if (timer.at <= until && (timer.at < nextAt || (timer.at === nextAt && (nextId === undefined || id < nextId)))) {
          nextId = id;
          nextAt = timer.at;
        }
      }

      if (nextId === undefined) {
        break;
      }

      const due = timers.get(nextId);
      timers.delete(nextId);
      time = Math.max(time, nextAt);
      due?.run();
      await flush();
    }

    time = until;
    await flush();
  };

  return {
    now: () => time,
    flush,
    advance,
    pending: () => timers.size,
    scheduler: {
      now: () => time,
      setTimeout: (callback, ms) => {
        counter += 1;
        timers.set(counter, { at: time + Math.max(0, ms), run: callback });
        return counter;
      },
      clearTimeout: (handle) => {
        if (typeof handle === 'number') {
          timers.delete(handle);
        }
      },
    },
  };
}

export type Deferred<T> = { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (error: unknown) => void };

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** A promise that settles after `ms` of the clock, and rejects with an `AbortError` as soon as the signal aborts, as a check that honours it does. */
export async function after<T>(clock: ManualClock, ms: number, value: T, signal?: AbortSignal): Promise<T> {
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }

    const handle = clock.scheduler.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clock.scheduler.clearTimeout(handle);
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      },
      { once: true },
    );
  });
  return value;
}

/** A value no real secret looks like and every leak shows: it is planted in a secret field, and a test asserts that it appears nowhere. */
export const SENTINEL = 'sk-live-SENTINEL-9f8e7d6c5b4a3210';

export type Fixture = {
  readonly store: FormStore;
  readonly clock: ManualClock;
  /** Every payload the submit callback was handed. */
  readonly submits: SubmitPayload[];
  readonly announced: string[];
  readonly errors: Array<{ readonly name: string; readonly message: string; readonly where: string }>;
  /** Every notification the store made, as the snapshot it announced. */
  readonly seen: FormState[];
};

export type FixtureOptions = Partial<Omit<FormOptions, 'schema' | 'submit' | 'validators' | 'providers'>> & {
  readonly submit?: SubmitFn | undefined;
  /** The host's checks, by name: given the clock so a check can take 300 ms of its time. */
  readonly validators?: Readonly<Record<string, RemoteValidator>> | ((clock: ManualClock) => Readonly<Record<string, RemoteValidator>>) | undefined;
  readonly providers?: Readonly<Record<string, OptionProvider>> | ((clock: ManualClock) => Readonly<Record<string, OptionProvider>>) | undefined;
};

export const succeeded: SubmitOutcome = { ok: true };

/** A form over a schema written as data, a clock the test drives, and a submit callback that records what it was handed and succeeds unless given another. */
export function makeForm(rawSchema: unknown, options: FixtureOptions = {}): Fixture {
  const compiled = compileSchema(rawSchema);
  if (!compiled.ok) {
    throw new Error(`the test schema did not compile: ${compiled.detail}`);
  }

  const clock = manualClock();
  const submits: SubmitPayload[] = [];
  const announced: string[] = [];
  const errors: Fixture['errors'] = [];
  const { submit, validators, providers, ...rest } = options;
  const store = createFormStore({
    scheduler: clock.scheduler,
    announce: (text) => {
      announced.push(text);
    },
    onError: (error, where) => {
      errors.push({ ...error, where });
    },
    ...rest,
    validators: typeof validators === 'function' ? validators(clock) : validators,
    providers: typeof providers === 'function' ? providers(clock) : providers,
    schema: compiled.schema,
    submit: async (payload) => {
      submits.push(payload);
      return submit === undefined ? succeeded : submit(payload);
    },
  });
  const seen: Fixture['seen'] = [];
  store.subscribe(() => {
    seen.push(store.getSnapshot());
  });
  return { store, clock, submits, announced, errors, seen };
}

/** A one-section schema from a list of fields. */
export const schemaOf = (...fields: ReadonlyArray<Record<string, unknown>>): { readonly sections: ReadonlyArray<{ readonly fields: ReadonlyArray<Record<string, unknown>> }> } => ({ sections: [{ fields }] });

/** The values a snapshot holds, by field id: what a test compares. */
export const valuesOf = (state: FormState): Readonly<Record<string, Json | undefined>> => Object.fromEntries(state.fields.map((field) => [field.id, field.value]));
