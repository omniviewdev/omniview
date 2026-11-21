import { dispositionOf } from '../tabs/disposition';
import { isPlainObject, sameItems } from '../tabs/json';
import { declareActions, resolveActions, type Declared } from './actions';
import { noticeFromHostError } from './error';
import { pageOperationOf } from './inline';
import { normFields, normInitiator, normOrigin, normSeverity, normSource, normTarget } from './normalise';
import { serialiseNotices } from './persist';
import { announcement, deriveSeverity, finishText, isActive, maxSeverity, quiet, toastPolicy, type Change } from './policy';
import { a11yOf, mergeProgress, normProgress, restartProgress, stepProgress } from './progress';
import { createRate } from './rate';
import { equalPlain, factsOf, viewOf, type Handlers, type Rec, type ViewContext } from './record';
import { activityOf, bellOf, countsOf } from './summary';
import { block, line, sentenceCase } from './text';
import { composeStack } from './toasts';
import {
  FOREVER,
  LIMITS,
  NOTICES_VERSION,
  SEVERITIES,
  TIMING,
  type ActionCall,
  type Availability,
  type CommandRef,
  type ErrorHook,
  type HoldReason,
  type Kind,
  type ModifierEvent,
  type NoticeHandle,
  type NoticeInput,
  type NoticesSeam,
  type NoticesState,
  type NoticeStats,
  type OpenHow,
  type OperationHandle,
  type OperationInput,
  type OperationPatch,
  type PageOperationView,
  type PatchInput,
  type PersistedAction,
  type PersistedNotices,
  type PersistedRecord,
  type Producer,
  type RecordView,
  type RemoveResult,
  type RunResult,
  type Scheduler,
  type Severity,
  type State,
  type ToastItem,
  type ToastStack,
} from './types';
import type { Activity, Bell, Counts } from './types';

// The store: one immutable snapshot, `subscribe`, and the operations. It is the shape `useSyncExternalStore` wants (`getSnapshot` and `subscribe`), and nothing in it knows React. The tab and
// palette models' stores are the pattern. The snapshot is the whole of notifications and operations as data (the toasts, the bell, the status area's summary, the active work and the history);
// a view draws it and calls the operations. Every decision about a record (its words, its actions, whether it has a toast and for how long, whether it is unread, what the live region is told)
// is made here, when the record changes state and never on a tick.
//
// Work is bounded by what changed: a record's view is made once for a change of it, the parts of the snapshot that did not change are the same objects, and the listeners are told at most
// once a frame (`TIMING.frame`): the first change of a quiet moment at once, the rest together at its end. `getSnapshot` is always current, before anybody is told.

/** What `restoreNotices` read, handed to the store to start from. */
export type Restored = { readonly records: readonly PersistedRecord[]; readonly muted: Readonly<Record<string, number>> };

export type NoticesOptions = NoticesSeam & {
  /** The history to start with: what `restoreNotices` read. */
  readonly initial?: Restored | undefined;
  /** Timers and the clock (milliseconds since the epoch). Default: the platform's. A test drives its own. */
  readonly scheduler?: Scheduler | undefined;
  /** Which key is the command key: Command on macOS, Control elsewhere (S64). Default `other`. */
  readonly platform?: 'mac' | 'other' | undefined;
  /** Hears every failure of a plugin's code. Default: the console. */
  readonly onError?: ErrorHook | undefined;
  /** The bounds of the history: how many finished records, and how old (milliseconds). Defaults: 500 and seven days (S74; the lead's ruling of 2026-11-20 for the owner's decision B7). */
  readonly history?: { readonly max?: number | undefined; readonly age?: number | undefined } | undefined;
};

/** One selector for each consumer; each answers the same object while its part of the snapshot is the same. */
export type Selectors = {
  readonly toasts: () => ToastStack;
  readonly bell: () => Bell;
  readonly activity: () => Activity;
  readonly counts: () => Counts;
  readonly active: () => readonly RecordView[];
  readonly recent: () => readonly RecordView[];
  readonly record: (id: string) => RecordView | undefined;
  /** What the page header's operation slot is fed for one record, or `null` (S76a: nothing renders for what is not there). */
  readonly pageOperation: (id: string) => PageOperationView | null;
};

export type NoticesStore = {
  readonly getSnapshot: () => NoticesState;
  /** Called at most once a frame, after the snapshot changed, and never for a change that changed nothing. Returns the function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
  readonly subscribeTo: <T>(select: (state: NoticesState) => T, listener: (value: T, previous: T) => void, equals?: (a: T, b: T) => boolean) => () => void;
  readonly selectors: Selectors;

  /** A message from the host itself (`source` names it; default `host`). A plugin gets `forSource`. */
  readonly notify: (spec: NoticeInput) => NoticeHandle;
  /** Work the host itself started. */
  readonly begin: (spec: OperationInput) => OperationHandle;
  /** The producer a plugin is handed: its source is baked in. After the plugin leaves, a producer made before is inert. */
  readonly forSource: (source: string) => Producer;
  /** A plugin left (S88, PO1): its operations end as unknown, its notices' actions are marked unavailable, and what its producers post is refused. */
  readonly removePlugin: (plugin: string) => boolean;
  /** What the host says changed (a plugin loaded or left, the tab on screen moved): every record is asked again what its actions can do. */
  readonly refresh: () => void;

  /** What a click on an action does: open a route, run a command, call the producer's code, or ask for a cancel. Acting on a record marks it read (S81). */
  readonly run: (id: string, action: string, how?: ModifierEvent | OpenHow) => RunResult;
  /** Hides a toast and marks the record read. Never deletes (ch05 162). */
  readonly dismiss: (id: string) => boolean;
  readonly dismissToasts: () => number;
  /** The page header's slot lets an outcome go. */
  readonly dismissInline: (id: string) => boolean;
  /** The summary toast's Show: open the centre. */
  readonly showSummary: () => boolean;
  readonly dismissSummary: () => number;
  readonly read: (ids: string | readonly string[]) => number;
  readonly readAll: () => number;
  /** The centre closed: what it listed is read when it was open at least a second (S81). */
  readonly seen: (ids: readonly string[], options: { readonly since: number }) => number;
  readonly remove: (id: string) => RemoveResult;
  readonly clear: (options?: { readonly kind?: Kind | undefined; readonly source?: string | undefined }) => RemoveResult;
  readonly undo: () => boolean;
  /** The pointer or the focus is in the stack, a modal owns the window, or the centre is open. */
  readonly hold: (reason: HoldReason, on: boolean) => boolean;
  /** Mutes a source (Settings > Notifications): for an hour, until a time, or forever. */
  readonly mute: (source: string, until?: number | 'forever') => boolean;
  readonly unmute: (source: string) => boolean;
  readonly unmuteAll: () => number;

  /** Tells the listeners now, when something is pending. */
  readonly flush: () => void;
  /** What the session saves; see `restoreNotices` for the way back and `createNoticesSaver` for the writing. */
  readonly serialise: () => PersistedNotices;
  readonly stats: () => NoticeStats;
  /** Stops listening and drops every timer. */
  readonly dispose: () => void;
};

type ToastState = { readonly id: string; sticky: boolean; remaining: number | null; since: number; timer: unknown };
type Stash = { readonly items: ReadonlyArray<{ readonly rec: Rec; readonly handlers: Handlers | undefined; readonly at: number }>; readonly until: number };

/** The edges of an operation's state (S74): a finished record only starts over, through `restart`. */
const NEXT: Readonly<Record<State, readonly State[]>> = {
  queued: ['running', 'paused', 'succeeded', 'failed', 'cancelled', 'unknown'],
  running: ['paused', 'succeeded', 'failed', 'cancelled', 'unknown'],
  paused: ['running', 'succeeded', 'failed', 'cancelled', 'unknown'],
  succeeded: [],
  failed: [],
  cancelled: [],
  unknown: [],
};

const ENDS: readonly State[] = ['succeeded', 'failed', 'cancelled', 'unknown'];
const RESTARTS: readonly State[] = ['failed', 'unknown', 'cancelled'];
const RESTART = 'Not available after restart';

/** What stands in for the code of a plugin that left: it keeps an action visible and never runs (the action is disabled, with its reason, before it could be). */
const DEAD = (): undefined => undefined;

const AVAILABLE: Availability = Object.freeze({ state: 'available' });

const platformScheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

const logError: ErrorHook = (error, where) => {
  console.error(`[notices] ${where}`, error);
};

const isThenable = (value: unknown): value is PromiseLike<unknown> => typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';

const reuse = <T>(previous: T | undefined, next: T): T => (previous !== undefined && equalPlain(previous, next) ? previous : next);

/** The time of a child line of a fold, the same in every locale. */
const stamp = (time: number): string => new Date(time).toISOString().slice(0, 19).replace('T', ' ');

/** What an error says of itself, for the diagnostics and never the words of a notice. */
const errorText = (error: unknown): string => (error instanceof Error ? (error.stack ?? error.message) : typeof error === 'string' ? error : '');

/** The patch a producer gave: a sentence, an `Error` (its text is diagnostics, never chrome) or a patch. */
function patchOf(input: PatchInput | undefined): OperationPatch {
  if (typeof input === 'string') {
    return { message: input };
  }

  if (input instanceof Error) {
    return { details: errorText(input) };
  }

  return isPlainObject(input) ? (input) : {};
}

export function createNoticesStore(options: NoticesOptions = {}): NoticesStore {
  const scheduler = options.scheduler ?? platformScheduler;
  const onError = options.onError ?? logError;
  const platform = options.platform ?? 'other';
  const historyMax = Math.max(1, Math.floor(options.history?.max ?? LIMITS.history));
  const historyAge = options.history?.age ?? LIMITS.age;
  const now = (): number => scheduler.now();

  const recs = new Map<string, Rec>();
  let order: string[] = [];
  const activeIds = new Set<string>();
  const activeBySource = new Map<string, number>();
  const handlers = new Map<string, Handlers>();
  const keyIndex = new Map<string, string>();
  const rateRows = new Map<string, string>();
  const toastList: ToastState[] = [];
  const toastById = new Map<string, ToastState>();
  const muted = new Map<string, number>();
  const retired = new Set<string>();
  const generations = new Map<string, number>();
  const holds: Record<HoldReason, boolean> = { pointer: false, focus: false, modal: false, center: false, yield: false };
  const rate = createRate({ perSecond: LIMITS.perSecond, perMinute: LIMITS.perMinute });
  const a11yPending = new Set<Rec>();
  const slots = new Map<string, { readonly view: RecordView; readonly value: PageOperationView }>();
  const selects = new Map<string, () => void>();
  const dismissers = new Map<string, () => void>();
  const listeners = new Set<() => void>();
  const counters = { snapshots: 0, notifications: 0, views: 0, posted: 0, folded: 0, limited: 0 };

  let sequence = 0;
  let depth = 0;
  let dirty = true;
  let unsent = false;
  let disposed = false;
  let lastNotify = Number.NEGATIVE_INFINITY;
  let lastAge = Number.NEGATIVE_INFINITY;
  let shapeVersion = 0;
  let orderStamp = -1;
  let activeOrder: Rec[] = [];
  let recentOrder: Rec[] = [];
  let flushTimer: unknown;
  let undoTimer: unknown;
  let muteTimer: unknown;
  let a11yTimer: unknown;
  let stash: Stash | undefined;
  let state: NoticesState | undefined;
  let notified: NoticesState | undefined;

  const guarded = <T>(run: () => T, fallback: T, where: string): T => {
    try {
      return run();
    } catch (error) {
      onError(error, where);
      return fallback;
    }
  };

  const nameOf = (source: string): string => {
    if (source === 'host') {
      return 'Omniview';
    }

    const named = guarded<unknown>(() => options.pluginName?.(source), undefined, `pluginName() of ${source}`);
    return typeof named === 'string' && named.trim() !== '' ? named.trim() : sentenceCase(source);
  };

  const availabilityOf = (answer: unknown): Availability => {
    if (typeof answer === 'object' && answer !== null && 'state' in answer) {
      const reason = 'reason' in answer && typeof answer.reason === 'string' ? answer.reason : '';
      if (answer.state === 'unavailable') {
        return Object.freeze({ state: 'unavailable', reason });
      }

      if (answer.state === 'degraded') {
        return Object.freeze({ state: 'degraded', reason });
      }
    }

    return AVAILABLE;
  };

  const inlineVisible = (origin: { readonly anchor?: string | undefined }): boolean => origin.anchor !== undefined && guarded(() => options.inline?.(origin) === true, false, 'inline()');

  const announce = (text: string, urgent: boolean): void => {
    guarded(() => options.announce?.(text, { urgent }), undefined, 'announce()');
  };

  const isMuted = (source: string): boolean => (muted.get(source) ?? 0) > now();

  const deadReason = (rec: Rec): string => (rec.dead ? (retired.has(rec.source) ? `${nameOf(rec.source)} isn't running.` : RESTART) : '');

  const handlersOf = (rec: Rec): Handlers => {
    let own = handlers.get(rec.id);
    if (own === undefined) {
      own = { cancel: undefined, retry: undefined, actions: new Map() };
      handlers.set(rec.id, own);
    }

    return own;
  };

  const handlerView = (rec: Rec): { readonly cancel: boolean; readonly retry: boolean; readonly has: (id: string) => boolean } => {
    const own = handlers.get(rec.id);
    return { cancel: own?.cancel !== undefined, retry: own?.retry !== undefined, has: (id) => own?.actions.has(id) === true };
  };

  const context: ViewContext = {
    pluginName: nameOf,
    muted: isMuted,
    dead: deadReason,
    handlers: handlerView,
    availability: (route) => guarded(() => availabilityOf(options.availability?.(route)), AVAILABLE, 'availability()'),
    commandAvailability: (command) => guarded(() => availabilityOf(options.commandAvailability?.(command)), AVAILABLE, 'commandAvailability()'),
    current: (route) => guarded(() => options.current?.(route) === true, false, 'current()'),
    counted: () => {
      counters.views += 1;
    },
  };

  const view = (rec: Rec): RecordView => viewOf(rec, context, LIMITS.details);

  /** Whether the record carries an action the user can use now (a Retry, a command, the producer's own code, an Open): S77's "a warning with an action". Asked without making a view. */
  const actionOf = (rec: Rec): boolean =>
    resolveActions({ kind: rec.kind, state: rec.state, cancellation: rec.cancellation, target: rec.target, decls: rec.decls, handlers: handlerView(rec), dead: deadReason(rec), availability: context.availability, commandAvailability: context.commandAvailability, current: context.current })
      .some((action) => action.disabled === '');

  const mark = (): void => {
    dirty = true;
    unsent = true;
  };

  const touch = (rec: Rec): void => {
    rec.view = undefined;
    mark();
  };

  /** Something outside the record made its view stale: the next view is made again, and is the same object when it says the same. */
  const stale = (rec: Rec): void => {
    rec.prior = rec.view ?? rec.prior;
    rec.view = undefined;
    mark();
  };

  const shape = (): void => {
    shapeVersion += 1;
    mark();
  };

  const commit = (rec: Rec): void => {
    rec.rev += 1;
    rec.updatedAt = now();
    rec.severity = deriveSeverity(rec.kind, rec.state, rec.severity, rec.raised);
    touch(rec);
  };

  // ---------------------------------------------------------------- the snapshot

  function rebuildOrders(): void {
    const buckets: Rec[][] = [[], [], []];
    const finished: Rec[] = [];
    for (const id of order) {
      const rec = recs.get(id);
      if (rec === undefined) {
        continue;
      }

      if (isActive(rec.state)) {
        buckets[rec.state === 'running' ? 0 : rec.state === 'paused' ? 1 : 2]?.push(rec);
      } else {
        finished.push(rec);
      }
    }

    activeOrder = buckets.flat();
    recentOrder = finished;
  }

  const mutedList = (): ReadonlyArray<NoticesState['muted'][number]> =>
    Object.freeze([...muted].filter(([, until]) => until > now()).map(([source, until]) => Object.freeze({ source, name: nameOf(source), until: until >= FOREVER ? ('forever' as const) : until })));

  function buildToasts(previous: ToastStack | undefined): ToastStack {
    const suspended = holds.modal || holds.center;
    const paused = suspended || holds.pointer || holds.focus || holds.yield;
    let items: readonly ToastItem[] = [];
    if (!suspended) {
      const fresh = composeStack(toastList.map((toast) => ({ id: toast.id, sticky: toast.sticky })), (id) => {
        const rec = recs.get(id);
        return rec === undefined ? undefined : view(rec);
      });
      items = sameItems(previous?.items, fresh.map((item) => {
        const old = previous?.items.find((candidate) => candidate.key === item.key);
        return old !== undefined && equalPlain(old, item) ? old : item;
      }));
    }

    return reuse(previous, Object.freeze({ items, paused, suspended }));
  }

  function build(): NoticesState {
    counters.snapshots += 1;
    if (orderStamp !== shapeVersion) {
      rebuildOrders();
      orderStamp = shapeVersion;
    }

    const previous = state;
    const active = sameItems(previous?.active, Object.freeze(activeOrder.map(view)));
    const recent = sameItems(previous?.recent, Object.freeze(recentOrder.map(view)));
    const all = active.concat(recent);
    const counts = reuse(previous?.counts, countsOf(all));
    const bell = reuse(previous?.bell, bellOf(all));
    const activity = reuse(previous?.activity, activityOf(active));
    const toasts = buildToasts(previous?.toasts);
    const list = reuse(previous?.muted, mutedList());
    const undo = stash === undefined ? undefined : reuse(previous?.undo, Object.freeze({ count: stash.items.length, until: stash.until }));
    if (previous?.active === active && previous.recent === recent && previous.counts === counts && previous.bell === bell && previous.activity === activity && previous.toasts === toasts && previous.muted === list && previous.undo === undo) {
      return previous;
    }

    return Object.freeze({ version: NOTICES_VERSION, active, recent, counts, bell, activity, toasts, muted: list, undo });
  }

  function getSnapshot(): NoticesState {
    if (dirty || state === undefined) {
      state = build();
      dirty = false;
    }

    return state;
  }

  // ---------------------------------------------------------------- telling the listeners: at most once a frame

  function notifyNow(): void {
    unsent = false;
    lastNotify = now();
    if (listeners.size === 0) {
      return;
    }

    const next = getSnapshot();
    if (next === notified) {
      return;
    }

    notified = next;
    counters.notifications += 1;
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) {
        guarded(listener, undefined, 'listener');
      }
    }
  }

  function settle(): void {
    if (disposed || !unsent) {
      return;
    }

    if (now() - lastNotify >= TIMING.frame) {
      scheduler.clearTimeout(flushTimer);
      flushTimer = undefined;
      notifyNow();
    } else if (flushTimer === undefined) {
      flushTimer = scheduler.setTimeout(() => {
        flushTimer = undefined;
        act(notifyNow);
      }, Math.max(0, lastNotify + TIMING.frame - now()));
    }
  }

  function act<T>(run: () => T): T {
    depth += 1;
    try {
      return run();
    } finally {
      depth -= 1;
      if (depth === 0) {
        settle();
      }
    }
  }

  // ---------------------------------------------------------------- what a screen reader is told of a bar: at most once a second

  const quantise = (time: number): number => Math.ceil(time / 250) * 250;

  function publish(rec: Rec): void {
    a11yPending.delete(rec);
    rec.pub = rec.progress === null || !isActive(rec.state) ? undefined : a11yOf(rec.progress, rec.state);
    rec.pubAt = now();
    touch(rec);
  }

  function armA11y(): void {
    if (a11yTimer !== undefined || a11yPending.size === 0 || disposed) {
      return;
    }

    let due = Number.POSITIVE_INFINITY;
    for (const rec of a11yPending) {
      due = Math.min(due, quantise(rec.pubAt + TIMING.a11y));
    }

    a11yTimer = scheduler.setTimeout(() => {
      a11yTimer = undefined;
      act(() => {
        const at = now();
        for (const rec of [...a11yPending]) {
          if (quantise(rec.pubAt + TIMING.a11y) <= at) {
            publish(rec);
          }
        }

        armA11y();
      });
    }, Math.max(0, due - now()));
  }

  /** A change of the bar: the state or the kind is said at once, a tick waits for its second. */
  function noteProgress(rec: Rec, discrete: boolean): void {
    if (!isActive(rec.state) || rec.progress === null) {
      a11yPending.delete(rec);
      rec.pub = undefined;
      return;
    }

    const want = a11yOf(rec.progress, rec.state);
    if (rec.pub === undefined || discrete || (rec.pub.now === null) !== (want.now === null)) {
      publish(rec);
    } else if (rec.pub.text !== want.text || rec.pub.now !== want.now) {
      a11yPending.add(rec);
      armA11y();
    } else {
      a11yPending.delete(rec);
    }
  }

  // ---------------------------------------------------------------- toasts

  function dropToast(id: string): void {
    const toast = toastById.get(id);
    if (toast === undefined) {
      return;
    }

    scheduler.clearTimeout(toast.timer);
    toastById.delete(id);
    toastList.splice(toastList.indexOf(toast), 1);
    mark();
  }

  const paused = (): boolean => holds.pointer || holds.focus || holds.modal || holds.center || holds.yield;

  function expire(id: string): void {
    const rec = recs.get(id);
    if (rec !== undefined) {
      rec.toastDismissed = true;
      touch(rec);
    }

    dropToast(id);
  }

  function startClock(toast: ToastState): void {
    toast.since = now();
    toast.timer = scheduler.setTimeout(() => {
      toast.timer = undefined;
      act(() => {
        expire(toast.id);
      });
    }, toast.remaining ?? TIMING.toast);
  }

  function retime(toast: ToastState, sticky: boolean): void {
    scheduler.clearTimeout(toast.timer);
    toast.timer = undefined;
    toast.sticky = sticky;
    toast.remaining = sticky ? null : TIMING.toast;
    if (!sticky && !paused()) {
      startClock(toast);
    }

    mark();
  }

  function raise(rec: Rec, sticky: boolean): void {
    const toast: ToastState = { id: rec.id, sticky, remaining: null, since: 0, timer: undefined };
    toastList.push(toast);
    toastById.set(rec.id, toast);
    rec.toasted = true;
    touch(rec);
    retime(toast, sticky);
  }

  /** The clocks of the toasts wait while the pointer or the focus is in the stack, a modal owns the window or the centre is open, and run again with at least two seconds to be read (S78, S89a). */
  function setPaused(): void {
    const on = paused();
    for (const toast of toastList) {
      if (toast.sticky || toast.remaining === null) {
        continue;
      }

      if (on && toast.timer !== undefined) {
        scheduler.clearTimeout(toast.timer);
        toast.timer = undefined;
        toast.remaining = Math.max(0, toast.remaining - (now() - toast.since));
      } else if (!on && toast.timer === undefined) {
        toast.remaining = Math.max(toast.remaining, TIMING.grace);
        startClock(toast);
      }
    }

    mark();
  }

  /** Says what a record that raises no toast is worth to a screen reader (S86). */
  function say(rec: Rec, change: Change, inline: boolean): void {
    const facts = factsOf(rec, false);
    const told = announcement(facts, change, { muted: isMuted(rec.source), quiet: quiet(facts, inline) });
    if (told === null) {
      return;
    }

    if (told.kind === 'start') {
      announce(rec.title, told.urgent);
    } else if (told.kind === 'retry') {
      announce(`Retrying: ${rec.title}`, told.urgent);
    } else {
      const words = view(rec);
      announce(finishText({ kind: rec.kind, state: rec.state, severity: rec.severity, title: words.title, doneTitle: rec.doneTitle, failedHeadline: rec.state === 'failed' && words.title !== rec.title, detail: rec.detail, targetLabel: rec.target?.label ?? '' }), told.urgent);
    }
  }

  /**
   * What to do about a record that is new, changed state, started over or repeated: raise its toast, change it in place, drop it, or say it (S76 to S78, S86). ONE PRESENTER (the lead's ruling of 2026-11-21): while the centre is open
   * its list presents every record, so no toast is raised or kept for one that arrives or changes then; it is said once, as a record without a toast is (S86). A toast that was there before the centre opened is not touched by
   * this: it waits with the rest of the stack (`holds.center`, `toastStack`) and comes back with what it had left.
   */
  function decide(rec: Rec, change: Change & { readonly repeated?: boolean }): void {
    const inline = inlineVisible(rec.origin);
    const failed = rec.state === 'failed' || rec.state === 'unknown';
    if (rec.toastDismissed && (change.repeated === true || (change.changed && failed))) {
      rec.toastDismissed = false;
      touch(rec);
    }

    const policy = rec.toastDismissed || rec.limited || holds.center ? null : toastPolicy(factsOf(rec, actionOf(rec)), { muted: isMuted(rec.source), inline });
    const had = toastById.get(rec.id);
    if (policy === null) {
      dropToast(rec.id);
      say(rec, change, inline);
      return;
    }

    if (had !== undefined) {
      retime(had, policy.sticky);
      if (change.restarted) {
        say(rec, { first: false, changed: false, restarted: true }, inline);
      }

      return;
    }

    raise(rec, policy.sticky);
  }

  // ---------------------------------------------------------------- records

  function drop(rec: Rec): void {
    const at = order.indexOf(rec.id);
    if (at >= 0) {
      order.splice(at, 1);
    }

    recs.delete(rec.id);
    handlers.delete(rec.id);
    dropToast(rec.id);
    a11yPending.delete(rec);
    slots.delete(rec.id);
    dismissers.delete(rec.id);
    for (const key of [...selects.keys()]) {
      if (key.startsWith(`${rec.id}|`)) {
        selects.delete(key);
      }
    }

    if (keyIndex.get(rec.foldKey) === rec.id) {
      keyIndex.delete(rec.foldKey);
    }

    if (rateRows.get(rec.source) === rec.id) {
      rateRows.delete(rec.source);
    }

    if (activeIds.delete(rec.id)) {
      activeBySource.set(rec.source, Math.max(0, (activeBySource.get(rec.source) ?? 1) - 1));
    }

    shape();
  }

  function trim(): void {
    let finished = order.length - activeIds.size;
    for (let index = order.length - 1; index >= 0 && finished > historyMax; index -= 1) {
      const rec = recs.get(order[index] ?? '');
      if (rec !== undefined && !isActive(rec.state)) {
        drop(rec);
        finished -= 1;
      }
    }

    const at = now();
    if (at - lastAge >= TIMING.fold) {
      lastAge = at;
      const cutoff = at - historyAge;
      for (const id of [...order].reverse()) {
        const rec = recs.get(id);
        if (rec !== undefined && !isActive(rec.state) && Math.max(rec.updatedAt, rec.finishedAt ?? 0) < cutoff) {
          drop(rec);
        }
      }
    }
  }

  function insert(rec: Rec): void {
    recs.set(rec.id, rec);
    order.unshift(rec.id);
    if (isActive(rec.state)) {
      activeIds.add(rec.id);
      activeBySource.set(rec.source, (activeBySource.get(rec.source) ?? 0) + 1);
    }

    if (rec.foldKey !== '' && rec.kind === 'message') {
      keyIndex.set(rec.foldKey, rec.id);
    }

    shape();
    trim();
  }

  function nextId(): string {
    do {
      sequence += 1;
    } while (recs.has(`n${String(sequence)}`));

    return `n${String(sequence)}`;
  }

  function newRec(init: Pick<Rec, 'kind' | 'source' | 'initiator' | 'title' | 'state'> & Partial<Rec>): Rec {
    const at = now();
    return {
      id: nextId(),
      createdAt: at,
      origin: Object.freeze({}),
      rev: 1,
      doneTitle: '',
      detail: '',
      details: '',
      target: undefined,
      raised: undefined,
      severity: 'info',
      progress: null,
      fields: Object.freeze([]),
      decls: Object.freeze([]),
      cancellation: 'unsupported',
      foldKind: '',
      foldKey: '',
      count: 1,
      attempt: 1,
      log: [],
      startedAt: undefined,
      finishedAt: undefined,
      updatedAt: at,
      read: false,
      toasted: false,
      toastDismissed: false,
      limited: false,
      inlineDismissed: false,
      dead: false,
      pub: undefined,
      pubAt: at,
      view: undefined,
      prior: undefined,
      ...init,
    };
  }

  function registerRuns(rec: Rec, declared: Declared): void {
    const own = handlersOf(rec);
    own.actions.clear();
    for (const [id, run] of declared.runs) {
      const decl = declared.decls.find((candidate) => candidate.id === id);
      const call: ActionCall = { id: rec.id, action: id, event: undefined };
      if (decl?.kind === 'cancel') {
        own.cancel = () => run(call);
      } else if (decl?.kind === 'retry') {
        own.retry = () => run(call);
      } else {
        own.actions.set(id, run);
      }
    }
  }

  function declare(rec: Rec, list: unknown): void {
    const declared = declareActions(list);
    for (const problem of declared.problems) {
      onError(new TypeError(problem), `actions of ${rec.source}`);
    }

    rec.decls = declared.decls;
    registerRuns(rec, declared);
  }

  // ---------------------------------------------------------------- the row of a source that posts too much (S82)

  function childLine(rec: Pick<Rec, 'title' | 'detail'>, at: number): string {
    return `${stamp(at)}  ${rec.title}${rec.detail === '' ? '' : ` — ${rec.detail}`}`;
  }

  function pushLog(rec: Rec, entry: string): void {
    rec.log.push(entry);
    if (rec.log.length > LIMITS.children) {
      rec.log.splice(0, rec.log.length - LIMITS.children);
    }
  }

  /** Counts one notice, or one operation that could not start, into the row of its source. */
  function overflow(source: string, title: string): Rec {
    counters.limited += 1;
    const at = now();
    let row = recs.get(rateRows.get(source) ?? '');
    if (row === undefined || at - row.updatedAt > TIMING.fold) {
      row = newRec({
        kind: 'message',
        source,
        initiator: 'system',
        title: `${nameOf(source)} is posting many notifications`,
        state: 'succeeded',
        severity: 'warning',
        detail: 'Its next notifications are grouped in this row.',
        foldKind: 'rate',
        foldKey: `rate:${source}`,
        count: 0,
        startedAt: at,
        finishedAt: at,
        decls: Object.freeze([Object.freeze({ id: 'mute', kind: 'custom' as const, label: 'Mute for 1 hour', route: undefined, reveal: undefined, command: undefined, code: false, primary: false, danger: false, icon: '', disabled: '', builtin: 'mute' as const })]),
        read: isMuted(source),
      });
      rateRows.set(source, row.id);
      insert(row);
      counters.posted += 1;
      decide(row, { first: true, changed: false, restarted: false });
    }

    row.count += 1;
    pushLog(row, childLine({ title, detail: '' }, at));
    row.detail = `${String(row.count)} more notification${row.count === 1 ? '' : 's'} grouped in this row.`;
    row.updatedAt = at;
    row.finishedAt = at;
    row.rev += 1;
    touch(row);
    return row;
  }

  // ---------------------------------------------------------------- handles

  const refusedNotice = (reason: string): NoticeHandle => Object.freeze({ id: '', refused: reason, record: undefined, dismiss: () => false });

  const noticeHandle = (id: string): NoticeHandle => ({
    id,
    refused: '',
    get record() {
      const rec = recs.get(id);
      return rec === undefined ? undefined : view(rec);
    },
    dismiss: () => act(() => dismiss(id)),
  });

  const refuse = (reason: string, where: string): string => {
    onError(new TypeError(reason), where);
    return reason;
  };

  // ---------------------------------------------------------------- notices

  /** A repeat of a notice that is already there folds into it (S79, S82, S85); what is over its source's budget goes to the row of the source (S82). */
  function post(spec: unknown, source: string): NoticeHandle {
    if (!isPlainObject(spec)) {
      return refusedNotice(refuse('A notice is an object with a title.', 'notify()'));
    }

    const input = spec as NoticeInput;
    const title = line(input.title, LIMITS.title);
    if (title === '') {
      return refusedNotice(refuse('A notice needs a title.', 'notify()'));
    }

    const severity = normSeverity(input.severity);
    const detail = line(input.detail, LIMITS.detail);
    const key = line(input.key, LIMITS.key);
    const group = line(input.group, LIMITS.key);
    const at = now();
    if (key !== '') {
      const target = recs.get(keyIndex.get(`k|${source}|${key}`) ?? '');
      if (target?.kind === 'message' && at - target.createdAt <= TIMING.key) {
        counters.folded += 1;
        target.count += 1;
        pushLog(target, childLine({ title, detail }, at));
        target.severity = maxSeverity(target.severity, severity);
        target.updatedAt = at;
        target.finishedAt = at;
        target.rev += 1;
        touch(target);
        return noticeHandle(target.id);
      }
    }

    if (rate.hit(source, at)) {
      return noticeHandle(overflow(source, title).id);
    }

    const foldKey = key !== '' ? `k|${source}|${key}` : group !== '' ? `g|${source}|${group}` : `r|${source}|${severity}|${title}|${detail}`;
    const declared = declareActions(input.actions);
    for (const problem of declared.problems) {
      onError(new TypeError(problem), `actions of ${source}`);
    }

    if (key === '') {
      const target = recs.get(keyIndex.get(foldKey) ?? '');
      if (target?.kind === 'message' && !isActive(target.state) && at - Math.max(target.updatedAt, target.finishedAt ?? 0) <= TIMING.fold) {
        counters.folded += 1;
        if (target.log.length === 0) {
          pushLog(target, childLine(target, target.createdAt));
        }

        pushLog(target, childLine({ title, detail }, at));
        target.count += 1;
        target.title = title;
        target.detail = detail;
        target.severity = maxSeverity(target.severity, severity);
        if (declared.decls.length > 0) {
          target.decls = declared.decls;
          registerRuns(target, declared);
        }

        target.updatedAt = at;
        target.finishedAt = at;
        target.read = isMuted(source);
        target.toastDismissed = false;
        target.rev += 1;
        touch(target);
        decide(target, { first: false, changed: false, restarted: false, repeated: true });
        return noticeHandle(target.id);
      }
    }

    const rec = newRec({
      kind: 'message',
      source,
      initiator: normInitiator(input.initiator),
      title,
      state: 'succeeded',
      severity,
      detail,
      details: block(input.details, LIMITS.details),
      target: normTarget(input.target),
      origin: normOrigin(input.origin),
      foldKind: key !== '' ? 'key' : group !== '' ? 'group' : 'repeat',
      foldKey,
      startedAt: undefined,
      finishedAt: at,
      read: isMuted(source),
    });
    rec.decls = declared.decls;
    if (declared.decls.length > 0) {
      registerRuns(rec, declared);
    }

    insert(rec);
    counters.posted += 1;
    decide(rec, { first: true, changed: false, restarted: false });
    return noticeHandle(rec.id);
  }

  // ---------------------------------------------------------------- operations

  /** What a producer may change of work that runs (and, once it ended, of its words). */
  function applyPatch(rec: Rec, input: unknown): boolean {
    if (!isPlainObject(input)) {
      return false;
    }

    const patch = input as OperationPatch;
    let changed = false;
    const title = line(patch.title, LIMITS.title);
    if (title !== '' && title !== rec.title) {
      rec.title = title;
      changed = true;
    }

    if (patch.doneTitle !== undefined && line(patch.doneTitle, LIMITS.title) !== rec.doneTitle) {
      rec.doneTitle = line(patch.doneTitle, LIMITS.title);
      changed = true;
    }

    if (patch.message !== undefined && line(patch.message, LIMITS.detail) !== rec.detail) {
      rec.detail = line(patch.message, LIMITS.detail);
      changed = true;
    }

    if (patch.details !== undefined && block(patch.details, LIMITS.details) !== rec.details) {
      rec.details = block(patch.details, LIMITS.details);
      changed = true;
    }

    if (patch.fields !== undefined) {
      const fields = normFields(patch.fields);
      if (!equalPlain(fields, rec.fields)) {
        rec.fields = fields;
        changed = true;
      }
    }

    if (patch.target !== undefined) {
      const target = normTarget(patch.target);
      if (!equalPlain(target, rec.target)) {
        rec.target = target;
        changed = true;
      }
    }

    if (patch.actions !== undefined) {
      declare(rec, patch.actions);
      changed = true;
    }

    if (patch.severity !== undefined && SEVERITIES.includes(patch.severity)) {
      const raised = maxSeverity(rec.raised ?? 'info', patch.severity);
      if (raised !== rec.raised) {
        rec.raised = raised;
        changed = true;
      }
    }

    if (isActive(rec.state)) {
      if ('progress' in patch) {
        const next = patch.progress === null ? null : normProgress(mergeProgress(rec.progress, patch.progress ?? null));
        if ((next !== null || patch.progress === null) && !equalPlain(next, rec.progress)) {
          rec.progress = next;
          changed = true;
        }
      }

      if (patch.step !== undefined) {
        const next = stepProgress(rec.progress, patch.step);
        if (next !== null && !equalPlain(next, rec.progress)) {
          rec.progress = next;
          changed = true;
        }
      }

      if ((patch.cancellation === 'available' || patch.cancellation === 'unsupported') && rec.cancellation !== patch.cancellation && rec.cancellation !== 'requested' && rec.cancellation !== 'acknowledged') {
        rec.cancellation = patch.cancellation;
        changed = true;
      }
    }

    if (!changed) {
      return false;
    }

    commit(rec);
    noteProgress(rec, false);
    return true;
  }

  function transition(rec: Rec, to: State, patch: PatchInput | undefined): boolean {
    if (!isActive(rec.state) || !NEXT[rec.state].includes(to)) {
      return false;
    }

    const at = now();
    const done = !isActive(to);
    rec.state = to;
    if (to === 'running' && rec.startedAt === undefined) {
      rec.startedAt = at;
    }

    if (done) {
      rec.finishedAt = at;
      rec.startedAt ??= at;
      rec.cancellation = to === 'cancelled' ? 'acknowledged' : 'unsupported';
      if (activeIds.delete(rec.id)) {
        activeBySource.set(rec.source, Math.max(0, (activeBySource.get(rec.source) ?? 1) - 1));
      }
    }

    applyPatch(rec, patchOf(patch));
    rec.severity = deriveSeverity(rec.kind, rec.state, rec.severity, rec.raised);
    if (done) {
      const inline = inlineVisible(rec.origin);
      const calm = quiet(factsOf(rec, false), inline);
      const muted = isMuted(rec.source);
      rec.read = calm || muted;
      if (!calm && !inline && !muted && rate.hit(rec.source, at)) {
        rec.limited = true;
        overflow(rec.source, rec.title);
      }
    }

    commit(rec);
    noteProgress(rec, true);
    shape();
    decide(rec, { first: false, changed: true, restarted: false });
    return true;
  }

  function restart(rec: Rec, patch: PatchInput | undefined): boolean {
    if (rec.kind !== 'operation' || !RESTARTS.includes(rec.state)) {
      return false;
    }

    const at = now();
    rec.state = 'running';
    rec.startedAt = at;
    rec.finishedAt = undefined;
    rec.attempt += 1;
    rec.count = 1;
    rec.read = false;
    rec.toastDismissed = false;
    rec.inlineDismissed = false;
    rec.limited = false;
    rec.detail = '';
    rec.details = '';
    rec.log = [];
    rec.raised = undefined;
    rec.progress = restartProgress(rec.progress);
    rec.cancellation = handlers.get(rec.id)?.cancel === undefined ? 'unsupported' : 'available';
    activeIds.add(rec.id);
    activeBySource.set(rec.source, (activeBySource.get(rec.source) ?? 0) + 1);
    applyPatch(rec, patchOf(patch));
    commit(rec);
    noteProgress(rec, true);
    shape();
    decide(rec, { first: false, changed: true, restarted: true });
    return true;
  }

  function startOperation(spec: unknown, source: string, live: () => boolean): OperationHandle {
    if (!isPlainObject(spec)) {
      return refusedOperation(refuse('Work is an object with a title.', 'begin()'));
    }

    const input = spec as OperationInput;
    const title = line(input.title, LIMITS.title);
    if (title === '') {
      return refusedOperation(refuse('Work needs a title.', 'begin()'));
    }

    if (activeIds.size >= LIMITS.active || (activeBySource.get(source) ?? 0) >= LIMITS.activePerSource) {
      overflow(source, title);
      act(() => undefined);
      return refusedOperation(`${nameOf(source)} is running too many operations at once.`);
    }

    const queued = input.state === 'queued';
    const rec = newRec({
      kind: 'operation',
      source,
      initiator: normInitiator(input.initiator),
      title,
      state: queued ? 'queued' : 'running',
      doneTitle: line(input.doneTitle, LIMITS.title),
      detail: line(input.message, LIMITS.detail),
      details: block(input.details, LIMITS.details),
      target: normTarget(input.target),
      origin: normOrigin(input.origin),
      fields: normFields(input.fields),
      progress: normProgress(input.progress),
      raised: SEVERITIES.includes(input.severity ?? 'info') && input.severity !== undefined ? input.severity : undefined,
      startedAt: queued ? undefined : now(),
      read: false,
    });
    declare(rec, input.actions);
    const own = handlersOf(rec);
    if (typeof input.onCancel === 'function') {
      own.cancel = input.onCancel;
    }

    if (typeof input.onRetry === 'function') {
      own.retry = input.onRetry;
    }

    rec.cancellation = own.cancel !== undefined || input.cancellation === 'available' ? 'available' : 'unsupported';
    rec.severity = deriveSeverity('operation', rec.state, 'info', rec.raised);
    insert(rec);
    noteProgress(rec, true);
    decide(rec, { first: true, changed: false, restarted: false });
    return operationHandle(rec.id, live);
  }

  const refusedOperation = (reason: string): OperationHandle => {
    const no = (): boolean => false;
    const handle: OperationHandle = {
      id: '',
      refused: reason,
      record: undefined,
      state: 'removed',
      active: false,
      dismiss: no,
      update: no,
      progress: no,
      step: no,
      start: no,
      pause: no,
      resume: no,
      succeed: no,
      fail: no,
      cancel: no,
      unknown: no,
      finish: no,
      restart: no,
      onCancel: () => handle,
      onRetry: () => handle,
      acknowledgeCancel: no,
    };
    return Object.freeze(handle);
  };

  function operationHandle(id: string, live: () => boolean): OperationHandle {
    const mine = (): Rec | undefined => (live() ? recs.get(id) : undefined);
    const move = (to: State, patch: PatchInput | undefined): boolean => act(() => {
      const rec = mine();
      return rec !== undefined && transition(rec, to, patch);
    });
    const handle: OperationHandle = {
      id,
      refused: '',
      get record() {
        const rec = recs.get(id);
        return rec === undefined ? undefined : view(rec);
      },
      get state() {
        return recs.get(id)?.state ?? 'removed';
      },
      get active() {
        const rec = recs.get(id);
        return rec !== undefined && isActive(rec.state);
      },
      dismiss: () => act(() => dismiss(id)),
      update: (patch) => act(() => {
        const rec = mine();
        return rec !== undefined && isActive(rec.state) && applyPatch(rec, patch);
      }),
      progress: (progress) => handle.update({ progress }),
      step: (step) => handle.update({ step }),
      start: (patch) => move('running', patch),
      pause: (patch) => move('paused', patch),
      resume: (patch) => move('running', patch),
      succeed: (patch) => move('succeeded', patch),
      fail: (patch) => move('failed', patch),
      cancel: (patch) => move('cancelled', patch),
      unknown: (patch) => move('unknown', patch),
      finish: (to, patch) => ENDS.includes(to) && move(to, patch),
      restart: (patch) => act(() => {
        const rec = mine();
        return rec !== undefined && restart(rec, patch);
      }),
      onCancel: (callback) => {
        act(() => {
          const rec = mine();
          if (rec !== undefined && typeof callback === 'function') {
            handlersOf(rec).cancel = callback;
            if (isActive(rec.state) && rec.cancellation === 'unsupported') {
              rec.cancellation = 'available';
              commit(rec);
            }
          }
        });
        return handle;
      },
      onRetry: (callback) => {
        act(() => {
          const rec = mine();
          if (rec !== undefined && typeof callback === 'function') {
            handlersOf(rec).retry = callback;
            touch(rec);
          }
        });
        return handle;
      },
      acknowledgeCancel: () => act(() => {
        const rec = mine();
        if (rec === undefined || !isActive(rec.state) || rec.cancellation !== 'requested') {
          return false;
        }

        rec.cancellation = 'acknowledged';
        commit(rec);
        return true;
      }),
    };
    return handle;
  }

  // ---------------------------------------------------------------- the user

  function dismiss(id: string): boolean {
    const rec = recs.get(id);
    if (rec === undefined) {
      return false;
    }

    const wasRead = rec.read || isActive(rec.state);
    if (rec.toastDismissed && wasRead && !toastById.has(id)) {
      return false;
    }

    rec.toastDismissed = true;
    if (!isActive(rec.state)) {
      rec.read = true;
    }

    dropToast(id);
    touch(rec);
    return true;
  }

  function markRead(rec: Rec): boolean {
    if (isActive(rec.state) || rec.read) {
      return false;
    }

    rec.read = true;
    dropToast(rec.id);
    touch(rec);
    return true;
  }

  function read(ids: string | readonly string[]): number {
    let count = 0;
    for (const id of typeof ids === 'string' ? [ids] : ids) {
      const rec = recs.get(id);
      if (rec !== undefined && markRead(rec)) {
        count += 1;
      }
    }

    return count;
  }

  function failedAction(rec: Rec, label: string, error: unknown, id: string): void {
    onError(error, `action "${id}" of ${rec.source}`);
    const mapped = noticeFromHostError(error, { title: `Couldn't ${label.toLowerCase()}` });
    if (mapped === undefined || retired.has(rec.source)) {
      return;
    }

    const diagnostics = mapped.details ?? errorText(error);
    post({ ...mapped, ...(diagnostics === '' ? {} : { details: diagnostics }) }, rec.source);
  }

  const refusedRun = (reason: 'missing' | 'none' | 'disabled' | 'unavailable' | 'failed', message: string): RunResult => ({ status: 'refused', reason, message });

  function requestCancel(rec: Rec): RunResult {
    rec.cancellation = 'requested';
    commit(rec);
    const back = (): void => {
      act(() => {
        const current = recs.get(rec.id);
        if (current !== undefined && isActive(current.state) && current.cancellation === 'requested') {
          current.cancellation = 'available';
          current.detail = 'Couldn\'t cancel. The work is still running.';
          commit(current);
        }
      });
    };

    const callback = handlers.get(rec.id)?.cancel;
    if (callback === undefined) {
      return { status: 'done' };
    }

    let out: unknown;
    try {
      out = callback();
    } catch (error) {
      onError(error, `onCancel() of ${rec.source}`);
      back();
      return { status: 'done' };
    }

    if (out === false) {
      back();
    } else if (isThenable(out)) {
      out.then((value) => {
        if (value === false) {
          back();
        }
      }, (error: unknown) => {
        onError(error, `onCancel() of ${rec.source}`);
        back();
      });
    }

    return { status: 'done' };
  }

  function run(id: string, actionId: string, how?: ModifierEvent | OpenHow): RunResult {
    const rec = recs.get(id);
    if (rec === undefined) {
      return refusedRun('missing', 'There is nothing here to act on.');
    }

    const action = view(rec).actions.find((candidate) => candidate.id === actionId);
    if (action === undefined) {
      return refusedRun('none', 'There is no such action.');
    }

    if (action.disabled !== '') {
      return refusedRun('disabled', action.disabled);
    }

    return act((): RunResult => {
      if (action.kind === 'cancel') {
        return requestCancel(rec);
      }

      markRead(rec);
      const decl = rec.decls.find((candidate) => candidate.id === actionId);
      if (decl?.builtin === 'mute') {
        mute(rec.source);
        return { status: 'done' };
      }

      if (action.route !== undefined) {
        const open = options.open;
        if (open === undefined) {
          return refusedRun('unavailable', 'Nothing here can open this page.');
        }

        const route = action.route;
        const reveal = decl?.reveal;
        const disposition = typeof how === 'string' ? how : dispositionOf(how, { platform });
        try {
          return { status: 'done', opened: open({ route, ...(reveal === undefined ? {} : { reveal }) }, { how: disposition, source: 'notification' }) };
        } catch (error) {
          failedAction(rec, action.label, error, action.id);
          return refusedRun('failed', 'The page could not be opened.');
        }
      }

      if (action.command !== undefined) {
        const command: CommandRef = action.command;
        if (options.run === undefined) {
          return refusedRun('unavailable', 'Nothing here can run this command.');
        }

        try {
          const out = options.run(command, { source: 'notification' });
          if (isThenable(out)) {
            out.then(undefined, (error: unknown) => {
              act(() => {
                failedAction(rec, action.label, error, action.id);
              });
            });
          }

          return { status: 'done' };
        } catch (error) {
          failedAction(rec, action.label, error, action.id);
          return refusedRun('failed', 'The command could not be run.');
        }
      }

      const own = handlers.get(rec.id);
      const callback = action.kind === 'retry' ? own?.retry : own?.actions.get(action.id);
      if (callback === undefined) {
        return refusedRun('unavailable', RESTART);
      }

      const attempt = rec.attempt;
      try {
        const out = action.kind === 'retry' ? (callback as () => unknown)() : (callback)({ id: rec.id, action: action.id, event: typeof how === 'object' ? how : undefined });
        if (isThenable(out)) {
          out.then(undefined, (error: unknown) => {
            act(() => {
              failedAction(rec, action.label, error, action.id);
            });
          });
        }
      } catch (error) {
        failedAction(rec, action.label, error, action.id);
        return refusedRun('failed', 'The action did not run.');
      }

      if (action.kind === 'retry' && rec.attempt === attempt && !isActive(rec.state)) {
        dismiss(rec.id);
      }

      return { status: 'done' };
    });
  }

  function takeOut(list: readonly Rec[]): RemoveResult {
    if (list.length === 0) {
      return { removed: 0, undo: () => false };
    }

    const items = list.map((rec) => ({ rec, handlers: handlers.get(rec.id), at: order.indexOf(rec.id) })).sort((a, b) => a.at - b.at);
    for (const { rec } of items) {
      drop(rec);
    }

    const mine: Stash = { items, until: now() + TIMING.undo };
    stash = mine;
    scheduler.clearTimeout(undoTimer);
    undoTimer = scheduler.setTimeout(() => {
      undoTimer = undefined;
      act(() => {
        stash = undefined;
        mark();
      });
    }, TIMING.undo);
    mark();
    return { removed: items.length, undo: () => undo(mine) };
  }

  function undo(from: Stash | undefined = stash): boolean {
    if (from === undefined || from !== stash || now() > from.until) {
      return false;
    }

    stash = undefined;
    scheduler.clearTimeout(undoTimer);
    undoTimer = undefined;
    for (const { rec, handlers: saved, at } of from.items) {
      if (recs.has(rec.id)) {
        continue;
      }

      // A restored record was seen before: it raises no toast and no announcement again.
      rec.toastDismissed = true;
      rec.view = undefined;
      recs.set(rec.id, rec);
      order.splice(Math.min(Math.max(at, 0), order.length), 0, rec.id);
      if (saved !== undefined) {
        handlers.set(rec.id, saved);
      }

      if (rec.foldKey !== '' && rec.kind === 'message') {
        keyIndex.set(rec.foldKey, rec.id);
      }
    }

    shape();
    return true;
  }

  function mute(source: string, until?: number | 'forever'): boolean {
    const name = typeof source === 'string' ? line(source, LIMITS.source).toLowerCase() : '';
    const at = now();
    const end = until === undefined ? at + TIMING.hour : until === 'forever' ? FOREVER : until;
    if (name === '' || typeof end !== 'number' || !Number.isFinite(end) || end <= at) {
      return false;
    }

    muted.set(name, end);
    for (const rec of recs.values()) {
      if (rec.source === name) {
        rec.toastDismissed = true;
        dropToast(rec.id);
        stale(rec);
      }
    }

    armMute();
    mark();
    return true;
  }

  function expireMutes(): void {
    const at = now();
    for (const [source, until] of [...muted]) {
      if (until <= at) {
        muted.delete(source);
        for (const rec of recs.values()) {
          if (rec.source === source) {
            stale(rec);
          }
        }
      }
    }

    armMute();
    mark();
  }

  function armMute(): void {
    scheduler.clearTimeout(muteTimer);
    muteTimer = undefined;
    let next = Number.POSITIVE_INFINITY;
    for (const until of muted.values()) {
      if (until < FOREVER) {
        next = Math.min(next, until);
      }
    }

    if (Number.isFinite(next) && !disposed) {
      muteTimer = scheduler.setTimeout(() => {
        muteTimer = undefined;
        act(expireMutes);
      }, Math.max(0, next - now()));
    }
  }

  function unmute(source: string): boolean {
    const name = typeof source === 'string' ? line(source, LIMITS.source).toLowerCase() : '';
    if (!muted.delete(name)) {
      return false;
    }

    for (const rec of recs.values()) {
      if (rec.source === name) {
        stale(rec);
      }
    }

    armMute();
    mark();
    return true;
  }

  function removePlugin(plugin: string): boolean {
    const source = typeof plugin === 'string' ? line(plugin, LIMITS.source).toLowerCase() : '';
    if (source === '' || source === 'host') {
      return false;
    }

    let changed = !retired.has(source);
    retired.add(source);
    generations.set(source, (generations.get(source) ?? 0) + 1);
    rate.forget(source);
    const at = now();
    for (const rec of recs.values()) {
      if (rec.source !== source) {
        continue;
      }

      const own = handlers.get(rec.id);
      if (own !== undefined) {
        own.cancel = own.cancel === undefined ? undefined : DEAD;
        own.retry = own.retry === undefined ? undefined : DEAD;
        for (const id of own.actions.keys()) {
          own.actions.set(id, DEAD);
        }
      }

      if (!rec.dead) {
        rec.dead = true;
        changed = true;
      }

      if (isActive(rec.state)) {
        rec.state = 'unknown';
        rec.finishedAt = at;
        rec.startedAt ??= at;
        rec.cancellation = 'unsupported';
        rec.detail = `${nameOf(source)} isn't running.`;
        rec.read = false;
        rec.toastDismissed = true;
        dropToast(rec.id);
        a11yPending.delete(rec);
        rec.pub = undefined;
        if (activeIds.delete(rec.id)) {
          activeBySource.set(source, Math.max(0, (activeBySource.get(source) ?? 1) - 1));
        }

        commit(rec);
        shape();
        changed = true;
      } else {
        stale(rec);
      }

      const toast = toastById.get(rec.id);
      if (toast !== undefined) {
        const policy = toastPolicy(factsOf(rec, actionOf(rec)), { muted: isMuted(source), inline: inlineVisible(rec.origin) });
        if (policy === null) {
          dropToast(rec.id);
        } else {
          retime(toast, policy.sticky);
        }
      }
    }

    mark();
    return changed;
  }

  function refresh(): void {
    for (const rec of recs.values()) {
      rec.prior = rec.view ?? rec.prior;
      rec.view = undefined;
    }

    mark();
  }

  // ---------------------------------------------------------------- producers

  function forSource(raw: string): Producer {
    const source = typeof raw === 'string' ? line(raw, LIMITS.source).toLowerCase() : '';
    if (source === '') {
      const reason = 'A producer is made for a plugin that has an id.';
      return Object.freeze({ source: '', notify: () => refusedNotice(reason), begin: () => refusedOperation(reason), fromError: () => refusedNotice(reason) });
    }

    if (source !== 'host') {
      retired.delete(source);
    }

    const generation = generations.get(source) ?? 0;
    const live = (): boolean => (generations.get(source) ?? 0) === generation;
    const gone = `The plugin "${source}" is not running.`;
    return Object.freeze({
      source,
      notify: (spec: NoticeInput) => act(() => (live() ? post(spec, source) : refusedNotice(gone))),
      begin: (spec: OperationInput) => act(() => (live() ? startOperation(spec, source, live) : refusedOperation(gone))),
      fromError: (error: unknown, errorContext?: Parameters<Producer['fromError']>[1]) => act(() => {
        if (!live()) {
          return refusedNotice(gone);
        }

        const spec = noticeFromHostError(error, errorContext);
        return spec === undefined ? undefined : post(spec, source);
      }),
    });
  }

  // ---------------------------------------------------------------- the history on disk

  function persistedOf(rec: Rec): PersistedRecord {
    const running = isActive(rec.state);
    const own = handlers.get(rec.id);
    const actions: PersistedAction[] = rec.decls.map((decl) => ({
      id: decl.id,
      kind: decl.kind,
      label: decl.label,
      ...(decl.route === undefined ? {} : { route: decl.route }),
      ...(decl.reveal === undefined ? {} : { reveal: decl.reveal }),
      ...(decl.command === undefined ? {} : { command: decl.command }),
      ...(decl.primary ? { primary: true } : {}),
      ...(decl.danger ? { danger: true } : {}),
      ...(decl.icon === '' ? {} : { icon: decl.icon }),
      ...(decl.disabled === '' ? {} : { disabled: decl.disabled }),
      ...(decl.builtin === undefined ? {} : { builtin: decl.builtin }),
    }));
    if (!running && own?.retry !== undefined && !actions.some((action) => action.kind === 'retry')) {
      actions.unshift({ id: 'retry', kind: 'retry', label: 'Retry' });
    }

    const text = rec.log.length === 0 ? rec.details : [rec.details, ...rec.log].filter((part) => part !== '').join('\n');
    return {
      id: rec.id,
      kind: rec.kind,
      source: rec.source,
      initiator: rec.initiator,
      severity: running ? 'info' : rec.severity,
      state: rec.state,
      title: rec.title,
      doneTitle: rec.doneTitle,
      detail: running ? '' : rec.detail,
      details: running ? '' : text.slice(0, LIMITS.storedDetails),
      ...(rec.target === undefined ? {} : { target: { label: rec.target.label, kind: rec.target.kind, ...(rec.target.route === undefined ? {} : { route: rec.target.route }), ...(rec.target.removed ? { removed: true } : {}) } }),
      fields: running ? [] : rec.fields,
      actions,
      count: rec.count,
      fold: rec.count > 1 ? rec.foldKind : '',
      attempt: rec.attempt,
      createdAt: rec.createdAt,
      ...(rec.startedAt === undefined ? {} : { startedAt: rec.startedAt }),
      ...(running || rec.finishedAt === undefined ? {} : { finishedAt: rec.finishedAt }),
      updatedAt: running ? (rec.startedAt ?? rec.createdAt) : rec.updatedAt,
      read: running ? false : rec.read,
      ...(rec.raised === undefined ? {} : { raised: rec.raised }),
    };
  }

  function fromPersisted(saved: PersistedRecord): Rec {
    const rec: Rec = {
      id: saved.id,
      kind: saved.kind,
      source: saved.source,
      createdAt: saved.createdAt,
      initiator: saved.initiator,
      origin: Object.freeze({}),
      rev: 1,
      title: saved.title,
      doneTitle: saved.doneTitle,
      detail: saved.detail,
      details: saved.details,
      target: saved.target === undefined ? undefined : Object.freeze({ label: saved.target.label, kind: saved.target.kind, route: saved.target.route, removed: saved.target.removed === true }),
      state: saved.state,
      raised: saved.raised,
      severity: saved.severity,
      progress: null,
      fields: Object.freeze([...saved.fields]),
      decls: Object.freeze(saved.actions.map((action) => Object.freeze({
        id: action.id,
        kind: action.kind,
        label: action.label,
        route: action.route,
        reveal: action.reveal,
        command: action.command,
        code: false,
        primary: action.primary === true,
        danger: action.danger === true,
        icon: action.icon ?? '',
        disabled: action.disabled ?? '',
        builtin: action.builtin,
      }))),
      cancellation: 'unsupported',
      foldKind: saved.fold,
      foldKey: '',
      count: saved.count,
      attempt: saved.attempt,
      log: [],
      startedAt: saved.startedAt,
      finishedAt: saved.finishedAt,
      updatedAt: saved.updatedAt,
      read: saved.read,
      // A restored record was seen before: it raises no toast and no announcement, and its page has no slot for it.
      toasted: true,
      toastDismissed: true,
      limited: false,
      inlineDismissed: true,
      dead: false,
      pub: undefined,
      pubAt: saved.updatedAt,
      view: undefined,
      prior: undefined,
    };
    return rec;
  }

  // ---------------------------------------------------------------- selectors

  const selectsOf = (id: string, action: string): (() => void) => {
    const key = `${id}|${action}`;
    let callback = selects.get(key);
    if (callback === undefined) {
      callback = () => {
        run(id, action);
      };

      selects.set(key, callback);
    }

    return callback;
  };

  const dismissOf = (id: string): (() => void) => {
    let callback = dismissers.get(id);
    if (callback === undefined) {
      callback = () => {
        act(() => dismissInline(id));
      };

      dismissers.set(id, callback);
    }

    return callback;
  };

  function dismissInline(id: string): boolean {
    const rec = recs.get(id);
    if (rec?.kind !== 'operation' || isActive(rec.state) || rec.inlineDismissed) {
      return false;
    }

    rec.inlineDismissed = true;
    dismiss(id);
    touch(rec);
    return true;
  }

  function pageOperation(id: string): PageOperationView | null {
    const rec = recs.get(id);
    if (rec?.kind !== 'operation' || rec.inlineDismissed) {
      return null;
    }

    const current = view(rec);
    const cached = slots.get(id);
    if (cached?.view === current) {
      return cached.value;
    }

    const value = pageOperationOf(current, (action) => selectsOf(id, action), dismissOf(id));
    slots.set(id, { view: current, value });
    return value;
  }

  // ---------------------------------------------------------------- start

  if (options.initial !== undefined) {
    for (const saved of options.initial.records) {
      const rec = fromPersisted(saved);
      if (!recs.has(rec.id)) {
        recs.set(rec.id, rec);
        order.push(rec.id);
        const number = /^n(\d+)$/.exec(rec.id);
        sequence = Math.max(sequence, number === null ? 0 : Number(number[1]));
      }
    }

    order = order.sort((a, b) => (recs.get(b)?.createdAt ?? 0) - (recs.get(a)?.createdAt ?? 0));
    for (const [source, until] of Object.entries(options.initial.muted)) {
      if (until > now()) {
        muted.set(source, until);
      }
    }

    trim();
    armMute();
  }

  return {
    getSnapshot,
    subscribe: (listener) => {
      if (listeners.size === 0) {
        notified = getSnapshot();
      }

      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeTo: (select, listener, equals = Object.is) => {
      let previous = select(getSnapshot());
      const stop = (): void => undefined;
      const unsubscribe = ((): (() => void) => {
        const handle = (): void => {
          const next = select(getSnapshot());
          if (!equals(previous, next)) {
            const before = previous;
            previous = next;
            listener(next, before);
          }
        };

        if (listeners.size === 0) {
          notified = getSnapshot();
        }

        listeners.add(handle);
        return () => {
          listeners.delete(handle);
        };
      })();
      return () => {
        stop();
        unsubscribe();
      };
    },
    selectors: {
      toasts: () => getSnapshot().toasts,
      bell: () => getSnapshot().bell,
      activity: () => getSnapshot().activity,
      counts: () => getSnapshot().counts,
      active: () => getSnapshot().active,
      recent: () => getSnapshot().recent,
      record: (id) => {
        const rec = recs.get(id);
        return rec === undefined ? undefined : view(rec);
      },
      pageOperation,
    },
    notify: (spec) => act(() => post(spec, isPlainObject(spec) ? normSource((spec).source) : 'host')),
    begin: (spec) => act(() => startOperation(spec, isPlainObject(spec) ? normSource((spec).source) : 'host', () => true)),
    forSource,
    removePlugin: (plugin) => act(() => removePlugin(plugin)),
    refresh: () => {
      act(refresh);
    },
    run,
    dismiss: (id) => act(() => dismiss(id)),
    dismissToasts: () => act(() => {
      let count = 0;
      for (const toast of [...toastList]) {
        if (dismiss(toast.id)) {
          count += 1;
        }
      }

      return count;
    }),
    dismissInline: (id) => act(() => dismissInline(id)),
    showSummary: () => act(() => {
      const summary = getSnapshot().toasts.items.find((item) => item.summary !== undefined);
      if (summary === undefined) {
        return false;
      }

      guarded(() => options.openCenter?.(), undefined, 'openCenter()');
      return true;
    }),
    dismissSummary: () => act(() => {
      const ids = getSnapshot().toasts.items.find((item) => item.summary !== undefined)?.summary?.ids ?? [];
      let count = 0;
      for (const id of ids) {
        if (dismiss(id)) {
          count += 1;
        }
      }

      return count;
    }),
    read: (ids) => act(() => read(ids)),
    readAll: () => act(() => read([...recs.keys()])),
    seen: (ids, { since }) => act(() => (now() - since >= TIMING.seen ? read(ids) : 0)),
    remove: (id) => act(() => {
      const rec = recs.get(id);
      return rec === undefined || isActive(rec.state) ? { removed: 0, undo: () => false } : takeOut([rec]);
    }),
    clear: (clearing = {}) => act(() => takeOut([...recs.values()].filter((rec) => !isActive(rec.state) && (clearing.kind === undefined || rec.kind === clearing.kind) && (clearing.source === undefined || rec.source === clearing.source)))),
    undo: () => act(() => undo()),
    hold: (reason, on) => act(() => {
      if (holds[reason] === on) {
        return false;
      }

      holds[reason] = on;
      setPaused();
      return true;
    }),
    mute: (source, until) => act(() => mute(source, until)),
    unmute: (source) => act(() => unmute(source)),
    unmuteAll: () => act(() => {
      const names = [...muted.keys()];
      for (const name of names) {
        unmute(name);
      }

      return names.length;
    }),
    flush: () => {
      act(() => {
        scheduler.clearTimeout(flushTimer);
        flushTimer = undefined;
        if (unsent) {
          notifyNow();
        }
      });
    },
    serialise: () => serialiseNotices(order.map((id) => recs.get(id)).filter((rec): rec is Rec => rec !== undefined).map(persistedOf), muted, now(), historyMax),
    stats: () => ({ ...counters }),
    dispose: () => {
      disposed = true;
      for (const timer of [flushTimer, undoTimer, muteTimer, a11yTimer, ...toastList.map((toast) => toast.timer)]) {
        scheduler.clearTimeout(timer);
      }

      flushTimer = undefined;
      undoTimer = undefined;
      muteTimer = undefined;
      a11yTimer = undefined;
      listeners.clear();
    },
  };
}

export type { Severity };
