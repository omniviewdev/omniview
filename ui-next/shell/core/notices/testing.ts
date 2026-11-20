import { createNoticesStore, type NoticesOptions, type NoticesStore } from './store';
import type { CommandRef, Destination, OpenOptions, OpenResult, RecordView, Route, Scheduler } from './types';

// Test support only: nothing in the model imports this file.
//
// A clock the test drives, so a toast that lives seven seconds and a progress bar that ticks a thousand times a second cost no time and the order of every timer is the same on every run; a
// complete record as a view reads it; and a store over that clock with the host's side of the seam written down (what was said, opened and run, which anchors are on screen, which plugins are
// off). The names carry the vocabulary of no real plugin (`cloud`, `stack`, as the tab model's fixture does).

export type ManualClock = {
  readonly scheduler: Scheduler;
  readonly now: () => number;
  /** Runs every timer due in the next `ms` milliseconds, oldest first, and lets the promises that each one settles run before the next. */
  readonly advance: (ms: number) => Promise<void>;
  /** Lets pending promise callbacks run, without moving the clock. */
  readonly flush: () => Promise<void>;
  /** Moves the clock without running a timer: the machine slept. */
  readonly jump: (ms: number) => void;
  /** Timers that have not fired. */
  readonly pending: () => number;
};

/** A day in November 2023, in milliseconds since the epoch: a clock that does not start at zero, so a time of 0 can never be mistaken for a time. */
export const START = 1_700_000_000_000;

export function manualClock(start = START): ManualClock {
  let time = start;
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
    jump: (ms) => {
      time += ms;
    },
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

/** A record as a view reads it, with every member present; a test names what it cares about. */
export function view(extra: Partial<RecordView> = {}): RecordView {
  return Object.freeze({
    id: 'n1',
    kind: 'message',
    rev: 1,
    source: 'cloud',
    sourceName: 'Cloud',
    initiator: 'system',
    severity: 'info',
    state: 'succeeded',
    active: false,
    title: 'Snapshot created',
    name: 'Snapshot created',
    word: '',
    text: '',
    reason: '',
    phase: 'Snapshot created',
    details: '',
    target: undefined,
    produced: undefined,
    progress: undefined,
    fields: Object.freeze([]),
    actions: Object.freeze([]),
    cancellation: 'unsupported',
    count: 1,
    fold: '',
    attempt: 1,
    origin: Object.freeze({}),
    createdAt: START,
    startedAt: undefined,
    finishedAt: START,
    updatedAt: START,
    read: false,
    unread: true,
    attention: false,
    urgent: false,
    toasted: false,
    inlineDismissed: false,
    ...extra,
  });
}

export type Fixture = {
  readonly store: NoticesStore;
  readonly clock: ManualClock;
  /** What the live region was told, in order. */
  readonly said: Array<{ readonly text: string; readonly urgent: boolean }>;
  /** What the tab model was asked to open. */
  readonly opened: Array<{ readonly destination: Destination; readonly options: OpenOptions }>;
  /** What the command registry was asked to run. */
  readonly commands: CommandRef[];
  /** What the model reported of a plugin's code that threw. */
  readonly errors: Array<{ readonly where: string; readonly error: unknown }>;
  readonly centre: { opened: number };
  /** The anchors whose inline presenter is on screen. */
  readonly inline: Set<string>;
  /** The plugins that are turned off: their routes and commands are unavailable. */
  readonly off: Set<string>;
  /** The route the user is on. */
  readonly on: { route: Route | undefined };
};

const DONE: OpenResult = { status: 'done', id: 't1', change: 'created', focused: true };

/** A store over a clock the test drives, with the seam answered by what the fixture holds. */
export function makeNotices(extra: Partial<NoticesOptions> = {}, clock: ManualClock = manualClock()): Fixture {
  const said: Fixture['said'] = [];
  const opened: Fixture['opened'] = [];
  const commands: CommandRef[] = [];
  const errors: Fixture['errors'] = [];
  const centre = { opened: 0 };
  const inline = new Set<string>();
  const off = new Set<string>();
  const on: Fixture['on'] = { route: undefined };
  const store = createNoticesStore({
    scheduler: clock.scheduler,
    onError: (error, where) => {
      errors.push({ where, error });
    },
    open: (destination, options) => {
      opened.push({ destination, options });
      return DONE;
    },
    run: (command) => {
      commands.push(command);
      return true;
    },
    availability: (route) => (off.has(route.plugin) ? { state: 'unavailable', reason: `${route.plugin} is turned off` } : { state: 'available' }),
    commandAvailability: (command) => (off.has(command.id.split('.')[0] ?? '') ? { state: 'unavailable', reason: 'The command is turned off' } : { state: 'available' }),
    current: (route) => on.route?.plugin === route.plugin && on.route.contribution === route.contribution && JSON.stringify(on.route.params) === JSON.stringify(route.params),
    inline: (origin) => origin.anchor !== undefined && inline.has(origin.anchor),
    announce: (text, options) => {
      said.push({ text, urgent: options.urgent });
    },
    pluginName: (plugin) => (plugin === 'cloud' ? 'Cloud' : plugin === 'stack' ? 'Stack' : undefined),
    openCenter: () => {
      centre.opened += 1;
    },
    ...extra,
  });
  return { store, clock, said, opened, commands, errors, centre, inline, off, on };
}
