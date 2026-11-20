import { boot, type Harness } from '../tabs/testing';
import type { Availability, Route } from '../tabs/types';
import { createPaletteStore, type PaletteOptions, type PaletteStore } from './store';
import type { Candidate, CommandOutcome, ProviderAnswer, Scheduler } from './types';

// Test support only: nothing in the model imports this file.
//
// A clock the test drives, so a provider that takes 300 ms or five seconds costs no time and the order of every timer is the same on every run, and the small providers the tests
// use. They carry the vocabulary of no real plugin (`host`, `cloud`, `stack`, as the tab model's fixture does).

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
    for (let round = 0; round < 8; round += 1) {
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

/** A promise that settles after `ms` of the clock, and rejects with an `AbortError` as soon as the signal aborts, as a provider that honours it does. */
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

export const page = (id: string, title: string, extra: Partial<Candidate> = {}): Candidate => ({
  id,
  kind: 'page',
  title,
  route: { plugin: 'cloud', contribution: id },
  ...extra,
});

export const resource = (id: string, title: string, extra: Partial<Candidate> = {}): Candidate => ({
  id,
  kind: 'resource',
  title,
  context: 'Deployment · prod-eu',
  icon: 'box',
  route: { plugin: 'stack', contribution: 'service', params: { name: title, connection: 'prod-eu' } },
  ...extra,
});

export const command = (id: string, title: string, extra: Partial<Candidate> = {}): Candidate => ({ id, kind: 'command', title, command: { id }, ...extra });

/** `count` candidates that look like a registry's commands: distinct titles of two or three words, a category and keywords. */
export function commands(count: number): Candidate[] {
  const verbs = ['Open', 'Close', 'Reopen', 'Toggle', 'Show', 'Hide', 'Refresh', 'Copy', 'Paste', 'Find', 'Clear', 'Reload', 'Pin', 'Move', 'Rename', 'Restart', 'Stop', 'Start', 'Export', 'Import'];
  const nouns = ['tab', 'window', 'panel', 'sidebar', 'terminal', 'log', 'session', 'view', 'editor', 'task', 'cluster', 'connection', 'plugin', 'setting', 'theme', 'layout', 'shortcut', 'workspace', 'history', 'bookmark'];
  const out: Candidate[] = [];
  for (let index = 0; index < count; index += 1) {
    const verb = verbs[index % verbs.length] ?? 'Open';
    const noun = nouns[Math.floor(index / verbs.length) % nouns.length] ?? 'tab';
    const lap = Math.floor(index / (verbs.length * nouns.length));
    out.push({ id: `cmd.${String(index)}`, kind: 'command', title: `${verb} ${noun}${lap === 0 ? '' : ` ${String(lap)}`}`, context: noun, keywords: `${verb.toLowerCase()} ${noun} command`, command: { id: `cmd.${String(index)}` } });
  }

  return out;
}

export const answer = (rows: readonly Candidate[], extra: Omit<ProviderAnswer, 'rows'> = {}): ProviderAnswer => ({ rows, ...extra });

export type Fixture = {
  readonly palette: PaletteStore;
  readonly clock: ManualClock;
  /** The tab model the palette opens places through, over the tab model's own fixture world. */
  readonly tabs: Harness;
  /** What the live region was told. */
  readonly announced: string[];
  /** What the palette reported about a provider's code. */
  readonly errors: Array<{ readonly error: unknown; readonly where: string }>;
  /** The commands the host ran, in order. */
  readonly ran: Array<{ readonly id: string; readonly arg: unknown; readonly target: unknown }>;
};

/** A palette over a real tab store and a clock the test drives. Nothing is registered: a test registers the providers it needs. */
export function makePalette(options: Partial<PaletteOptions> & { readonly clock?: ManualClock; readonly tabs?: Harness } = {}): Fixture {
  const clock = options.clock ?? manualClock();
  const tabs = options.tabs ?? boot({ home: false });
  const announced: string[] = [];
  const errors: Fixture['errors'] = [];
  const ran: Fixture['ran'] = [];
  const availability = (route: Route): Availability => tabs.world.contributions.availability?.(route) ?? { state: 'available' };
  const { clock: _clock, tabs: _tabs, ...rest } = options;
  const palette = createPaletteStore({
    open: (destination, openOptions) => tabs.store.open(destination, openOptions),
    activate: (id) => tabs.store.activate(id),
    run: (command): CommandOutcome => {
      ran.push({ id: command.id, arg: command.arg, target: command.target });
      return true;
    },
    availability,
    describe: (route) => tabs.world.contributions.describe(route),
    announce: (text) => announced.push(text),
    scheduler: clock.scheduler,
    platform: 'mac',
    onError: (error, where) => errors.push({ error, where }),
    ...rest,
  });
  return { palette, clock, tabs, announced, errors, ran };
}
