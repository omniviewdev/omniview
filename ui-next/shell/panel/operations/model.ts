import { subjectOf, type ActivityRecordLike, type ActivitySeverity, type SourceResolver } from '../activity';
import type { ToolBadge } from '../badge';
import { progressOf } from './progress';
import type { CancelFailure, Operation, OperationState, Operations, OperationsDeps, OperationsSnapshot } from './types';

// The model of the Operations tool (ch16 S122, S74, S81, S84, S114). It reads the feed's task records (`../activity`: the one subscription the window has to the host's activity service, which the Problems tool reads too) and
// turns them into rows that already hold every decision a table needs: the order (S122: running work first, then the newest), the producer's words for progress, what Cancel may say (S84), what is unread (S81) and the dot the tab
// carries (S114). React reads the answers through `useSyncExternalStore`, so every object the model gives keeps its identity while it says the same: a change of one record makes a new row for that record, a new `rows` array,
// a new snapshot and one notification, and the other rows, the unread counts and the badge keep the objects they had. The feed's error (the service could not be observed) rides in the snapshot as `unavailable`, beside the rows
// the model holds. The model has no timer, no DOM and no framework: the window's own clock is the host's.

type Task = NonNullable<ActivityRecordLike['task']>;

/** One record as the model last made its row, and what that row was made from: a record that is the same object, asked about the same cancel, is the same row without asking anybody anything. */
type Entry = { readonly record: ActivityRecordLike; readonly requested: boolean; readonly row: Operation };

const NONE: readonly ActivityRecordLike[] = Object.freeze([]);

const EMPTY: OperationsSnapshot = Object.freeze({ rows: Object.freeze([]), active: 0, unread: Object.freeze({ ids: Object.freeze([]), errors: 0, warnings: 0 }), badge: undefined, unavailable: undefined });

/** The states that have not finished. A state this table does not know (a newer host) has finished nothing it can claim: it is not active. */
const ACTIVE: Readonly<Record<OperationState, boolean>> = { starting: true, running: true, paused: true, succeeded: false, failed: false, cancelled: false, unknown: false };

/** How much a severity asks of a person; success is the least. A record whose severity is not one of the four (a newer host) asks nothing more of a state than the state asks. */
const RANK: Readonly<Record<ActivitySeverity, number>> = { success: 0, info: 1, warning: 2, error: 3 };

/** S74: what a finished task's own state says of it. The record's own severity raises it and never lowers it. */
const OF_STATE: Readonly<Record<OperationState, ActivitySeverity>> = { starting: 'info', running: 'info', paused: 'info', succeeded: 'success', failed: 'error', cancelled: 'info', unknown: 'warning' };

/** S81: a finished task needs a look when it failed, when nobody knows how it ended, or when its record says so, and nobody has had it. An active task is never unread: it becomes unread when it finishes. */
function unreadOf(record: ActivityRecordLike, state: OperationState, active: boolean): Operation['unread'] {
  if (active || record.visibility.read) {
    return undefined;
  }

  const own = OF_STATE[state];
  const severity = RANK[record.severity] > RANK[own] ? record.severity : own;
  return severity === 'error' || severity === 'warning' ? severity : undefined;
}

/** S84: Cancel is the producer's word and nothing else. A request that is pending, the host's or this window's, is `requested` for as long as the work is active. */
function cancelOf(task: Task, active: boolean, requested: boolean): Operation['cancel'] {
  if (!active) {
    return 'none';
  }

  switch (task.cancellation) {
    case 'available':
      return requested ? 'requested' : 'available';
    case 'requested':
    case 'acknowledged':
      return 'requested';
    case 'unsupported':
      return 'none';
  }
}

/** The plugin a record names, or `undefined` for the host's own work: an empty id is no plugin. */
const pluginOf = (record: ActivityRecordLike): string | undefined => (record.source.pluginID === '' ? undefined : record.source.pluginID);

function rowOf(record: ActivityRecordLike, task: Task, requested: boolean, resolve: SourceResolver): Operation {
  const plugin = pluginOf(record);
  const connection = record.source.connectionID;
  const active = ACTIVE[task.state];
  return {
    id: record.id,
    title: record.presentation.title,
    state: task.state,
    active,
    progress: active ? progressOf(record.presentation.progress) : undefined,
    source: resolve.plugin(plugin),
    target: plugin === undefined || connection === undefined ? undefined : resolve.connection(plugin, connection),
    startedAt: Date.parse(record.createdAt),
    cancel: cancelOf(task, active, requested),
    unread: unreadOf(record, task.state, active),
    subject: subjectOf(record.source, resolve),
    message: record.presentation.message,
  };
}

/** Whether two values say the same: the same value, or objects of the same members that say the same (a row's source, progress and subject are flat). A time that cannot be read is NaN, which is the same as itself here. */
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }

  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }

  const left = Object.entries(a);
  return left.length === Object.keys(b).length && left.every(([key, value]) => same(value, (b as Record<string, unknown>)[key]));
}

/** The instant a row sorts by. A record whose time cannot be read sorts as the oldest, so the order stays a total one whatever a producer sent. */
const startOf = (row: Operation): number => (Number.isNaN(row.startedAt) ? 0 : row.startedAt);

/** S122: running work first, each group newest first; a tie of time goes by the id, so the order never depends on how the feed lists the records. */
const byRecency = (a: Operation, b: Operation): number => Number(b.active) - Number(a.active) || startOf(b) - startOf(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** S114: a dot while a failure is unread, else a dot while a warning is, never a count (running work is counted by the status bar). The words are the tab's accessible name: "Operations, 2 unread failures". */
function badgeOf(errors: number, warnings: number): ToolBadge | undefined {
  if (errors > 0) {
    return { kind: 'dot', tone: 'error', label: `${String(errors)} unread ${errors === 1 ? 'failure' : 'failures'}` };
  }

  return warnings > 0 ? { kind: 'dot', tone: 'warning', label: `${String(warnings)} unread ${warnings === 1 ? 'warning' : 'warnings'}` } : undefined;
}

/** What a call of the feed does as a promise, whether it throws before it returns one or rejects after: the call is made at once, and a failure of either kind is a rejection. */
const asked = async <T>(call: () => Promise<T>): Promise<T> => call();

export function createOperations(deps: OperationsDeps): Operations {
  const { feed, resolve } = deps;
  const listeners = new Set<() => void>();
  /** The cancels this window asked for and the host has not answered: while one is here the row says `requested`. */
  const inflight = new Map<string, Promise<void>>();
  /** Who is attached to the feed. The feed has one listener of the model's for as long as there is any. */
  const attachments = new Set<Record<string, unknown>>();
  let stop: (() => void) | undefined;
  let held: readonly ActivityRecordLike[] = NONE;
  let entries = new Map<string, Entry>();
  let snapshot = EMPTY;
  /** What the feed said of whether the service can be observed when the model last read it. */
  let failure: string | undefined;

  function emit(): void {
    for (const listener of [...listeners]) {
      // A listener that was told to go in the middle of this notification is not told.
      if (listeners.has(listener)) {
        listener();
      }
    }
  }

  /** Makes the snapshot of these rows. What is the same as what the snapshot had keeps its object; the listeners are told once, and only when something changed. */
  function publish(rows: Operation[]): void {
    const previous = snapshot;
    const unchanged = previous.rows.length === rows.length && previous.rows.every((row, index) => row === rows[index]);
    let active = 0;
    const ids: string[] = [];
    let errors = 0;
    let warnings = 0;
    for (const row of rows) {
      active += Number(row.active);
      if (row.unread !== undefined) {
        ids.push(row.id);
        errors += Number(row.unread === 'error');
        warnings += Number(row.unread === 'warning');
      }
    }

    const list = unchanged ? previous.rows : rows;
    const sameIds = previous.unread.ids.length === ids.length && previous.unread.ids.every((id, index) => id === ids[index]);
    const unread = sameIds && previous.unread.errors === errors && previous.unread.warnings === warnings ? previous.unread : { ids: sameIds ? previous.unread.ids : ids, errors, warnings };
    const wanted = badgeOf(errors, warnings);
    const badge = same(previous.badge, wanted) ? previous.badge : wanted;
    if (list === previous.rows && unread === previous.unread && badge === previous.badge && failure === previous.unavailable) {
      return;
    }

    snapshot = { rows: list, active, unread, badge, unavailable: failure };
    emit();
  }

  /**
   * Makes every row from the records held. A record that is the same object as the one the row was made from, with the same cancel in flight, keeps its row and is asked of nobody: a progress tick of one task costs one row, not
   * 2,000 questions of the window's names. `again` asks for every record anyway (the names the window knows changed), and a row that comes out the same as the one it had keeps its object.
   */
  function derive(again: boolean): void {
    const next = new Map<string, Entry>();
    const rows: Operation[] = [];
    for (const record of held) {
      const task = record.task;
      if (record.kind !== 'task' || task === undefined || next.has(record.id)) {
        continue;
      }

      const requested = inflight.has(record.id);
      const old = entries.get(record.id);
      let entry: Entry;
      if (!again && old?.record === record && old.requested === requested) {
        entry = old;
      } else {
        const row = rowOf(record, task, requested, resolve);
        entry = { record, requested, row: old !== undefined && same(old.row, row) ? old.row : row };
      }

      next.set(record.id, entry);
      rows.push(entry.row);
    }

    entries = next;
    publish(rows.sort(byRecency));
  }

  function read(): void {
    const records = feed.getSnapshot();
    const error = feed.getError();
    if (records !== held || error !== failure) {
      held = records;
      failure = error;
      derive(false);
    }
  }

  function report(failure: CancelFailure): void {
    try {
      deps.fail?.(failure);
    } catch (error) {
      console.warn(`The handler of a failed cancel of "${failure.title}" threw`, error);
    }
  }

  async function cancel(id: string): Promise<void> {
    const pending = inflight.get(id);
    if (pending !== undefined) {
      return pending;
    }

    // Cancel is what the producer offers (S84): a row that cannot be cancelled, one the host already has a request for, and one that is gone are not asked for.
    const entry = entries.get(id);
    if (entry?.row.cancel !== 'available') {
      return Promise.resolve();
    }

    const { title } = entry.row;
    const plugin = pluginOf(entry.record);
    // The app's TypeScript library (ES2023) has no `Promise.withResolvers`: the promise is made with the executor.
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    inflight.set(id, done);
    derive(false);
    const finish = (failed: { readonly error: unknown } | undefined): void => {
      try {
        inflight.delete(id);
        // The row says what it said before the call, and has said it before the host is told: a way to ask again that is used at once finds a row that can be asked for.
        derive(false);
        if (failed !== undefined) {
          report({ id, title, plugin, error: failed.error, running: entries.get(id)?.row.active ?? false, retry: () => {
            void cancel(id);
          } });
        }
      } finally {
        resolveDone();
      }
    };

    void asked(async () => feed.cancel(id)).then(
      () => {
        finish(undefined);
      },
      (error: unknown) => {
        finish({ error });
      },
    );
    return done;
  }

  async function markRead(ids: readonly string[]): Promise<void> {
    const answers = await Promise.allSettled(ids.map(async (id) => asked(async () => feed.markRead(id))));
    answers.forEach((answer, index) => {
      if (answer.status === 'rejected') {
        console.warn(`Could not mark the operation ${String(ids[index])} read`, answer.reason);
      }
    });
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach: () => {
      const attachment = {};
      attachments.add(attachment);
      if (attachments.size === 1) {
        stop = feed.subscribe(read);
      }

      read();
      return () => {
        if (attachments.delete(attachment) && attachments.size === 0) {
          stop?.();
          stop = undefined;
        }
      };
    },
    refresh: () => {
      derive(true);
    },
    cancel,
    markRead,
  };
}
