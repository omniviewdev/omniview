import type { ActivityFeed, SourceResolver } from '../activity';
import type { ToolBadge } from '../badge';
import type { Subject } from '../subject';

// What the Operations tool says of the host's tasks (ch16 S122: "an `H.dataView` over the record store"). The model turns the feed's records (`../activity`) into rows that already hold every word and every
// decision a table needs, so the body (`OperationsBody.tsx`) only draws them. Plain data: no function, no DOM, no framework.

/** The states a task is in, as the host's activity service names them (`backend/pkg/activity`): the three that have not finished are `starting`, `running` and `paused`. */
export type OperationState = 'starting' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';

/**
 * What the producer said of how far the work is (S122: "the record's own: '6 of 14 files', steps '2 of 5', a 4 px bar is only its picture, never a derived percentage"): its words, and the part of the 4 px bar that is done.
 * `fraction` is 0 to 1; it is `undefined` when the numbers do not say a part of a whole (a whole of zero, a count that is not a number), and the text is then still what the producer said.
 */
export type ProgressFace = { readonly text: string; readonly fraction: number | undefined };

export type Operation = {
  readonly id: string;
  readonly title: string;
  readonly state: OperationState;
  /** `starting`, `running` or `paused`: the work has not finished. */
  readonly active: boolean;
  /** Only for work that has not finished; `undefined` for none, for work that cannot be measured (`indeterminate`) and for a task that finished. */
  readonly progress: ProgressFace | undefined;
  /** Who started it: the plugin as a person reads it (its name when the window knows it), or the host's own work (`{ id: HOST_SOURCE, name: 'Omniview' }`). */
  readonly source: { readonly id: string; readonly name: string };
  /** The connection's name, when the record names one the window knows. */
  readonly target: string | undefined;
  /** When the host first had the record (`Date.parse(createdAt)`): no producer says when a task finished, so there is no end to measure a duration by. */
  readonly startedAt: number;
  /**
   * What Cancel may say (S84: only when the producer says `cancellation: available`, never over-promising): `available` for a task that has not finished and says so, with no request pending; `requested` while
   * a request is pending (the host's own, `requested` or `acknowledged`, or ours that is still in flight); else `none`.
   */
  readonly cancel: 'none' | 'available' | 'requested';
  /**
   * A task that finished and needs a look that nobody has had (S81: an active task is never unread, it becomes unread when it finishes): `error` for a failure, `warning` for an outcome nobody knows, and either one
   * for a task whose record says so (S74: the severity of a finished task is raised by its record, never lowered). `undefined` for a task that is read, one that is still active and one that finished well.
   */
  readonly unread: 'error' | 'warning' | undefined;
  /** Where the row goes (a connection when the window knows it, else the plugin); `undefined` for the host's own work, which has no page. */
  readonly subject: Subject | undefined;
  /** What the producer says of the state (a failure's cause). */
  readonly message: string | undefined;
};

export type OperationsSnapshot = {
  /** Active work first, each group newest first. */
  readonly rows: readonly Operation[];
  /** How many rows have not finished. */
  readonly active: number;
  readonly unread: { readonly ids: readonly string[]; readonly errors: number; readonly warnings: number };
  /** S114: a dot while a failure (else a warning) is unread, never a count: the running work is counted by the status bar. */
  readonly badge: ToolBadge | undefined;
  /**
   * The feed's error (`ActivityFeed.getError`): the sentence for a failed observation of the activity service, or `undefined` while it can be observed. The rows are what the window held when the observation failed and stay listed; the
   * body draws the failure only when it holds none, in place of "No operations", which a read that failed does not mean. A notice beside rows is the kit's state family for a failure with rows (1a.8), which is not built.
   */
  readonly unavailable: string | undefined;
};

/** A cancel the host refused or never answered: what the host needs to tell the person, and the way to ask again. */
export type CancelFailure = {
  readonly id: string;
  readonly title: string;
  /** The id of the plugin that owns the task; `undefined` for the host's own work. */
  readonly plugin: string | undefined;
  readonly error: unknown;
  /**
   * Whether the task was still active (`starting`, `running` or `paused`) when the failure is reported, which the model reads after it has made the row again from the feed's latest record: `true` is work that is still going on and
   * can be asked for again; `false` is work that ended while the request was on its way (or that the host dropped from its history), which has an outcome and nothing left to cancel.
   */
  readonly running: boolean;
  readonly retry: () => void;
};

export type OperationsDeps = {
  readonly feed: ActivityFeed;
  readonly resolve: SourceResolver;
  /** Told once for each cancel that failed. */
  readonly fail?: ((failure: CancelFailure) => void) | undefined;
};

export type Operations = {
  /** The same object until a row, the counts or the badge change. */
  readonly getSnapshot: () => OperationsSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  /** Listens to the feed until the returned function is called, and reads it at once. */
  readonly attach: () => () => void;
  /** The names or connections the window knows changed: every row is made again from the records; a row that comes out the same keeps its object. */
  readonly refresh: () => void;
  /** Asks the host to stop a task. Never rejects: a failure goes to `fail`, with a way to ask again. */
  readonly cancel: (id: string) => Promise<void>;
  /** Marks records read, each one on its own. Never rejects: a failure is logged and the row stays unread. */
  readonly markRead: (ids: readonly string[]) => Promise<void>;
};
