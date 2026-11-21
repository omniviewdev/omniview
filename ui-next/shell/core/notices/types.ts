import type { Availability, Destination, Json, ModifierEvent, OpenHow, OpenOptions, OpenResult, Route, RouteInput } from '../tabs/types';

// The model of notifications and operations: its data, and the seam it calls through (ch16 section E, S74 to S89a; ch05 OF1 to OF4, RC1; design lab `shell-notify.js`). Plain data only: no
// React, no DOM, nothing a plugin owns. ONE record is rendered in four places (S75): a toast, a row of the notification centre, a row of the Operations tool and the status bar, and,
// for work a page started, the page header's operation slot. This model holds the record and decides everything about it (its words, its actions, whether it has a toast and for how
// long, whether it is unread, what is said to a screen reader); a view draws the snapshot and calls the operations.

export const NOTICES_VERSION = 1;

/** The four severities of ch16 S74. An operation's follows its state; a producer may raise it and never lower it. */
export type Severity = 'info' | 'success' | 'warning' | 'error';
export const SEVERITIES: readonly Severity[] = Object.freeze<Severity[]>(['info', 'success', 'warning', 'error']);

/** The seven states of an operation (S74). A message is `succeeded` from the moment it is posted. */
export type State = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
export const STATES: readonly State[] = Object.freeze<State[]>(['queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled', 'unknown']);

/** `message` is one-shot (an event that happened); `operation` has a state (work). A condition is not a record (S74): it is derived from health, and is not built here. */
export type Kind = 'message' | 'operation';

/** Who started the work. The producer declares it; the default is `system` (S74: the host stamps `user` for work that starts from a UI action). */
export type Initiator = 'user' | 'system';

/** Whether the producer can stop the work, and how far a request has got (S84). */
export type Cancellation = 'unsupported' | 'available' | 'requested' | 'acknowledged';

/** How a record folds its repeats (S79, S82, S85): none, a burst of related records, the same message again, a keyed condition, or the overflow of a source that posts too much. */
export type FoldKind = '' | 'group' | 'repeat' | 'key' | 'rate';

/** The command a notice runs: a registry id, never supplied code. `arg` and `target` are plain data, copied and frozen (the palette's `CommandRef` has the same shape). */
export type CommandRef = {
  readonly id: string;
  readonly arg?: Json | undefined;
  readonly target?: Json | undefined;
};

/** The produced or affected object (S74 `target`): its label, the kind of thing it is, and where it opens. `removed`: the operation deleted it, so there is nothing to open. */
export type TargetInput = string | {
  readonly label: string;
  readonly kind?: string | undefined;
  readonly route?: RouteInput | undefined;
  readonly removed?: boolean | undefined;
};

export type Target = {
  readonly label: string;
  readonly kind: string;
  readonly route: Route | undefined;
  readonly removed: boolean;
};

/** Where the work started, as the host stamped it: the tab, and the `data-key` of the control, row or page that shows its progress and outcome (the inline presenter). A hint, never authority (P5: dropped at restart). */
export type Origin = {
  readonly tab?: string | undefined;
  readonly anchor?: string | undefined;
};

export type ActionKind = 'cancel' | 'retry' | 'open' | 'custom';

/** What a callback of a producer is told when its action runs. */
export type ActionCall = {
  readonly id: string;
  readonly action: string;
  readonly event: ModifierEvent | undefined;
};

/**
 * One action as a producer writes it, at most four a record (S74). Exactly one of three ways to act: `route` (open a page through the tab model, S64: data), `command` (a registry id
 * with plain arguments: data) or `run` (the producer's own code: kept in memory only, so it cannot survive a restart and is then shown disabled with its reason, S84). `cancel` and
 * `retry` are what they say; a `cancel` declared here only relabels or disables the Cancel the model adds (S134).
 */
export type ActionInput = {
  readonly id?: string | undefined;
  readonly label?: string | undefined;
  readonly kind?: ActionKind | undefined;
  readonly route?: RouteInput | undefined;
  readonly reveal?: Json | undefined;
  readonly command?: CommandRef | undefined;
  readonly run?: ((call: ActionCall) => unknown) | undefined;
  /** The first action may be painted primary when it is Retry or says so. */
  readonly primary?: boolean | undefined;
  readonly danger?: boolean | undefined;
  /** A glyph of the kit's registry; absent, the view uses the verb's own. */
  readonly icon?: string | undefined;
  /** Why it cannot be used now; `true` says "Not available". It stays visible: a function that cannot run says why (S2). */
  readonly disabled?: string | boolean | undefined;
};

/** An action as a view draws it. The variant and the reason it is disabled are decided here, once, for every surface. */
export type ActionView = {
  readonly id: string;
  readonly kind: ActionKind;
  readonly label: string;
  readonly variant: 'primary' | 'default';
  readonly icon: string;
  readonly danger: boolean;
  /** Empty when the action can be used. */
  readonly disabled: string;
  readonly route: Route | undefined;
  readonly command: CommandRef | undefined;
};

export type Field = { readonly label: string; readonly value: string; readonly unit?: string | undefined };

/** Progress as a producer says it (S74): none, indeterminate, a percent, `{ current, total, unit }`, or steps. A partial `{ current }` updates the progress the record has. Never invented. */
export type ProgressInput =
  | null
  | 'indeterminate'
  | number
  | {
    readonly kind?: 'determinate' | 'steps' | 'indeterminate' | undefined;
    readonly current?: number | undefined;
    readonly total?: number | undefined;
    readonly unit?: string | undefined;
    readonly label?: string | undefined;
    readonly steps?: readonly string[] | undefined;
  };

export type Progress =
  | { readonly kind: 'indeterminate' }
  | { readonly kind: 'determinate'; readonly current: number; readonly total: number; readonly unit: string }
  | { readonly kind: 'steps'; readonly current: number; readonly total: number; readonly label: string; readonly steps: readonly string[] | undefined };

/** What a screen reader is told about a bar (S86): `aria-valuenow` (absent when the work cannot be measured) and `aria-valuetext`. It changes at most once a second, whatever the ticks. `current` and `total` are the counts the text was made from (a sum of several bars reads them, so every bar of one sample says the same). */
export type A11y = { readonly now: number | null; readonly text: string; readonly current: number; readonly total: number };

export type ProgressView =
  | { readonly kind: 'indeterminate'; readonly fraction: null; readonly a11y: A11y }
  | { readonly kind: 'determinate'; readonly fraction: number; readonly current: number; readonly total: number; readonly unit: string; readonly a11y: A11y }
  | { readonly kind: 'steps'; readonly fraction: number; readonly current: number; readonly total: number; readonly label: string; readonly steps: readonly string[] | undefined; readonly a11y: A11y };

/** A message as a producer posts it (S75 `Shell.notify`). */
export type NoticeInput = {
  /** What happened, in sentence case, at most 80 characters. */
  readonly title: string;
  /** One sentence of cause or effect, at most 120 characters. */
  readonly detail?: string | undefined;
  readonly severity?: Severity | undefined;
  /** Diagnostics, behind a disclosure and an explicit Copy; may hold secrets or paths. */
  readonly details?: string | undefined;
  readonly target?: TargetInput | undefined;
  readonly actions?: readonly ActionInput[] | undefined;
  /** The dedupe key (S85): one notice for the key per ten minutes; a repeat only moves its count and time, and is not news again. */
  readonly key?: string | undefined;
  /** A burst of related notices (S82): the same group inside 60 seconds fold into one record with a count, which is news again. */
  readonly group?: string | undefined;
  readonly initiator?: Initiator | undefined;
  readonly origin?: Origin | undefined;
  /** The host's own producers name their source here; a plugin's producer ignores it: the host stamps it (S74). Default `host`. */
  readonly source?: string | undefined;
};

/** Work as a producer starts it (S75 `Shell.ops.begin`). */
export type OperationInput = {
  /** Present participle while active ("Restarting api-gateway"), at most 80 characters. */
  readonly title: string;
  /** What it was, once done: the past tense and the object ("Restarted api-gateway", OF3). */
  readonly doneTitle?: string | undefined;
  readonly target?: TargetInput | undefined;
  readonly initiator?: Initiator | undefined;
  readonly origin?: Origin | undefined;
  readonly state?: 'queued' | 'running' | undefined;
  readonly progress?: ProgressInput | undefined;
  readonly fields?: readonly Field[] | undefined;
  /** One sentence of phase text, at most 120 characters. */
  readonly message?: string | undefined;
  readonly details?: string | undefined;
  readonly actions?: readonly ActionInput[] | undefined;
  readonly cancellation?: 'available' | 'unsupported' | undefined;
  readonly severity?: Severity | undefined;
  /** Cancel is offered when this is given (or `cancellation: 'available'`). Absent: the work cannot be cancelled and no Cancel is drawn (S84). */
  readonly onCancel?: (() => unknown) | undefined;
  readonly onRetry?: (() => unknown) | undefined;
  /** The host's own producers name their source here; a plugin's producer ignores it. Default `host`. */
  readonly source?: string | undefined;
};

/** What a producer may change of a record that is running; a finished record keeps its progress and its cancellation. */
export type OperationPatch = {
  readonly title?: string | undefined;
  readonly doneTitle?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | undefined;
  readonly fields?: readonly Field[] | undefined;
  readonly target?: TargetInput | undefined;
  readonly actions?: readonly ActionInput[] | undefined;
  readonly severity?: Severity | undefined;
  readonly progress?: ProgressInput | undefined;
  /** A step: its number, its label, or `{ current, total, label }`. */
  readonly step?: number | string | { readonly current?: number | undefined; readonly total?: number | undefined; readonly label?: string | undefined } | undefined;
  readonly cancellation?: 'available' | 'unsupported' | undefined;
};

/** What `finish` and its shorthands take: a sentence, an `Error` (its message and stack, as details) or a patch. */
export type PatchInput = string | Error | OperationPatch;

/** One record as every rendering reads it. A record that did not change is the same object in the next snapshot. */
export type RecordView = {
  readonly id: string;
  readonly kind: Kind;
  readonly rev: number;
  /** `host`, or the id of the plugin that owns the record: stamped by the host. */
  readonly source: string;
  readonly sourceName: string;
  readonly initiator: Initiator;
  readonly severity: Severity;
  readonly state: State;
  readonly active: boolean;
  /** The title a person reads: what a folded record stands for, the done title once it succeeded, "Couldn't …" once it failed. */
  readonly title: string;
  /** The title as the producer wrote it. */
  readonly name: string;
  /** The state in a word, before the text: `Queued`, `Paused`, `Canceled`, `Outcome unknown.`, `Attempt 2`, `Canceling…`; empty when the state needs none. */
  readonly word: string;
  /** The second line: the phase or effect, what a fold stands for, or what to check. */
  readonly text: string;
  /** Why the first action that cannot be used is disabled, as a sentence the view shows under the text. */
  readonly reason: string;
  /** The one sentence a compact rendering (the page header's slot) shows: the same in every rendering, so none reads differently. */
  readonly phase: string;
  readonly details: string;
  readonly target: Target | undefined;
  /** The object the work produced, and where it opens: the call to action. */
  readonly produced: { readonly label: string; readonly route: Route } | undefined;
  readonly progress: ProgressView | undefined;
  readonly fields: readonly Field[];
  readonly actions: readonly ActionView[];
  readonly cancellation: Cancellation;
  /** How many times this happened: 1 for a record that was not folded. */
  readonly count: number;
  readonly fold: FoldKind;
  readonly attempt: number;
  readonly origin: Origin;
  readonly createdAt: number;
  readonly startedAt: number | undefined;
  readonly finishedAt: number | undefined;
  readonly updatedAt: number;
  readonly read: boolean;
  /** The bell counts it (S81): not read, not active, and its source is not muted. */
  readonly unread: boolean;
  /** Unread, and an error or a warning (the "Needs attention" view). */
  readonly attention: boolean;
  /** An error of work the user started: its toast interrupts (`role="alert"`, S86). */
  readonly urgent: boolean;
  /** A toast was raised for it at some time. */
  readonly toasted: boolean;
  /** The page header's slot let it go (its Dismiss, or the clock of its presenter); it stays in the history. */
  readonly inlineDismissed: boolean;
};

export type ToastSummary = { readonly count: number; readonly severity: Severity; readonly ids: readonly string[] };

/** One toast of the stack. `record` is absent for the summary toast ("3 more notifications", whose button Show opens the centre). */
export type ToastItem = {
  readonly key: string;
  readonly id: string;
  readonly record: RecordView | undefined;
  readonly summary: ToastSummary | undefined;
  /** It stays until the user acts or the work ends (S78); otherwise it closes by itself. */
  readonly sticky: boolean;
  readonly urgent: boolean;
};

/**
 * The stack (S79): at most three, newest at the bottom; with more than three eligible, the two newest and a summary toast on top. While a modal or the centre is open the stack is
 * `suspended` and empty (S89a); while the pointer or the focus is in it the clocks wait (`paused`).
 */
export type ToastStack = {
  readonly items: readonly ToastItem[];
  readonly paused: boolean;
  readonly suspended: boolean;
};

/** What the bell shows (S81): a dot, never a number; its name and tooltip give the counts ("Notifications, 3 unread, 1 error"). */
export type Bell = {
  readonly dot: '' | 'info' | 'warning' | 'error';
  readonly unread: number;
  readonly errors: number;
  readonly warnings: number;
  readonly attention: number;
  readonly active: number;
  readonly label: string;
};

/** The counts of the centre's segmented control (S80): All, Active, Needs attention. */
export type Counts = { readonly all: number; readonly active: number; readonly attention: number; readonly unread: number };

/** The bar of the status area (S90, ch05 177): one operation's own, or the sum of several that count the same unit; never an average. Absent when nothing can be measured. */
export type ActivityBar = {
  readonly kind: 'indeterminate' | 'determinate';
  readonly fraction: number | null;
  /** What a screen reader is told; changes at most once a second. */
  readonly text: string;
};

/** What the status area shows of the work that is running. One operation: its title and track and a Cancel beside it. Several: a count, the worst severity and, when they share a unit, a bar. */
export type Activity = {
  readonly count: number;
  readonly running: number;
  readonly queued: number;
  readonly paused: number;
  /** The worst severity of what is active; empty when nothing is. */
  readonly worst: '' | Severity;
  readonly text: string;
  readonly tooltip: string;
  readonly bar: ActivityBar | undefined;
  /** The Cancel beside the widget: only when exactly one operation runs and it can be cancelled (S94, never nested in the widget). */
  readonly cancel: { readonly id: string; readonly label: string; readonly disabled: string } | undefined;
};

/** A source that is muted: its toasts and bell dot stop, its records are kept (Settings > Notifications). */
export type Muted = { readonly source: string; readonly name: string; readonly until: number | 'forever' };

/** The whole model as data. */
export type NoticesState = {
  readonly version: typeof NOTICES_VERSION;
  /** Operations that have not finished: running first, then paused, then queued; newest first inside a state. */
  readonly active: readonly RecordView[];
  /** Everything else, newest first: finished operations and messages, bounded. */
  readonly recent: readonly RecordView[];
  readonly counts: Counts;
  readonly bell: Bell;
  readonly activity: Activity;
  readonly toasts: ToastStack;
  readonly muted: readonly Muted[];
  /** What Clear or Dismiss removed, while Undo is offered (ten seconds). */
  readonly undo: { readonly count: number; readonly until: number } | undefined;
};

/** What a view reports (S78, S89a): the pointer or the focus is in the stack (the clocks wait), a modal owns the window or the centre is open (the stack is suspended). */
export type HoldReason = 'pointer' | 'focus' | 'modal' | 'center';

/**
 * What the page header's operation slot takes (the kit's `PageOperation`, structurally: a test proves one is assignable to the other): a record the page hands over, with nothing wired behind it but
 * these callbacks. A glyph a producer declared is not carried: the kit's `IconName` is the kit's own, and the view that draws the slot validates the name against it.
 */
export type PageOperationView = {
  readonly title: string;
  readonly state: State;
  readonly text: string;
  readonly progress?: number | 'indeterminate' | undefined;
  readonly actions?: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly kind?: 'cancel' | 'retry' | 'custom' | undefined;
    readonly onSelect: () => void;
    readonly disabledReason?: string | undefined;
  }> | undefined;
  readonly onDismiss?: (() => void) | undefined;
};

export type RunResult =
  | { readonly status: 'done'; readonly opened?: OpenResult | undefined }
  | { readonly status: 'refused'; readonly reason: 'missing' | 'none' | 'disabled' | 'unavailable' | 'failed'; readonly message: string };

export type RemoveResult = { readonly removed: number; readonly undo: () => boolean };

/** What a producer holds of a message it posted. A refused one has no id and says why. */
export type NoticeHandle = {
  /** The record that now holds it (a notice that folded into another is driven through that one). Empty when refused. */
  readonly id: string;
  /** Why the model refused it ("" when it did not). */
  readonly refused: string;
  readonly record: RecordView | undefined;
  /** Hides its toast and marks it read. Never deletes (ch05 162). */
  readonly dismiss: () => boolean;
};

/** What a producer holds of work it started (S75). Every method is a no-op that answers `false` once the record is gone, finished, or the plugin left. */
export type OperationHandle = NoticeHandle & {
  readonly state: State | 'removed';
  readonly active: boolean;
  readonly update: (patch: OperationPatch) => boolean;
  readonly progress: (progress: ProgressInput) => boolean;
  readonly step: (step: NonNullable<OperationPatch['step']>) => boolean;
  readonly start: (patch?: PatchInput) => boolean;
  readonly pause: (patch?: PatchInput) => boolean;
  readonly resume: (patch?: PatchInput) => boolean;
  readonly succeed: (patch?: PatchInput) => boolean;
  readonly fail: (patch?: PatchInput) => boolean;
  readonly cancel: (patch?: PatchInput) => boolean;
  readonly unknown: (patch?: PatchInput) => boolean;
  readonly finish: (state: Exclude<State, 'queued' | 'running' | 'paused'>, patch?: PatchInput) => boolean;
  /** Retry on the SAME record (S74): `failed`, `unknown` or `cancelled` to `running`, attempt + 1, the history kept. */
  readonly restart: (patch?: PatchInput) => boolean;
  /** Declares cancellation: the model adds Cancel. The callback runs when the user asks; only the producer can then report `cancelled`. */
  readonly onCancel: (callback: () => unknown) => OperationHandle;
  readonly onRetry: (callback: () => unknown) => OperationHandle;
  /** The producer saw the cancel request (S84): the button reads Canceling… and never claims a rollback. */
  readonly acknowledgeCancel: () => boolean;
};

/** An error the host handed the page, as the TypeScript side receives it (`apperror.AppError` as JSON; docs/ui-next/status/E0-1.md). The runtime's `parseAppError` is the one parser. */
export type HostError = {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly code?: string | undefined;
  readonly requestId?: string | undefined;
  readonly recovery?: string | undefined;
  readonly suggestions?: readonly string[] | undefined;
  readonly actions?: unknown;
  readonly instance?: string | undefined;
  readonly location?: unknown;
};

/** What a caller adds to an error: how the failure reads in its own words (never for a class whose text is the host's), and the way forward. */
export type ErrorContext = {
  /** What failed, in the user's terms ("Couldn't scale cart-api"). Replaces the class title, except where the class text is the host's. */
  readonly title?: string | undefined;
  /** The plugin's own sentence for this occurrence. Replaces the host's, except where the class text is the host's. */
  readonly detail?: string | undefined;
  readonly key?: string | undefined;
  readonly group?: string | undefined;
  /** Default `user`: a failure that reached a page is of something the person asked for. */
  readonly initiator?: Initiator | undefined;
  readonly actions?: readonly ActionInput[] | undefined;
  readonly target?: TargetInput | undefined;
  readonly origin?: Origin | undefined;
};

/** The producer a plugin is handed: the source is baked in, so a plugin cannot claim another plugin. After the plugin leaves, a producer made before is inert. */
export type Producer = {
  readonly source: string;
  readonly notify: (spec: NoticeInput) => NoticeHandle;
  readonly begin: (spec: OperationInput) => OperationHandle;
  /** `parseAppError(error)`, as a notice: title the class's, detail the sentence; nothing for a cancellation. */
  readonly fromError: (error: unknown, context?: ErrorContext) => NoticeHandle | undefined;
};

/** What the model needs of the host. Every member is optional. */
export type NoticesSeam = {
  /** Where an `open` action goes (S64): the tab model's `open`, with `source: 'notification'`. */
  readonly open?: ((destination: Destination, options: OpenOptions) => OpenResult | undefined) | undefined;
  /** Runs a command of the host's registry. Revalidated by the host immediately before it runs. */
  readonly run?: ((command: CommandRef, context: { readonly source: 'notification' }) => unknown) | undefined;
  /** Whether a route can open (S65): the tab model's own `Contributions.availability`. Absent: every route is available. */
  readonly availability?: ((route: Route) => Availability) | undefined;
  readonly commandAvailability?: ((command: CommandRef) => Availability) | undefined;
  /** Whether a route is the page the user is on: a call to action never opens the current page (OF3). The host calls `refresh()` when the tab on screen changes. */
  readonly current?: ((route: Route) => boolean) | undefined;
  /** Whether the inline presenter of an origin is on screen (S76): its tab is on screen and its anchor is mounted. Asked when a record changes state, never on a tick. Absent: no. */
  readonly inline?: ((origin: Origin) => boolean) | undefined;
  /** The live region (S86): what the model says when a record raises no toast. */
  readonly announce?: ((text: string, options: { readonly urgent: boolean }) => void) | undefined;
  /** What a plugin is called, for the words of a fold ("5 notifications from Cloud"). Absent: its id with a capital. */
  readonly pluginName?: ((plugin: string) => string | undefined) | undefined;
  /** The summary toast's Show: open the notification centre. */
  readonly openCenter?: (() => void) | undefined;
};

export type Scheduler = {
  /** Milliseconds since the epoch: records carry it, and it is what the history's age and a mute's end are measured in. */
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

export type ErrorHook = (error: unknown, where: string) => void;

/** What the model counted, for the tests and the status of a run: the work is bounded by what changed, not by what exists. */
export type NoticeStats = {
  /** Snapshots built. */
  readonly snapshots: number;
  /** Times the listeners were called. */
  readonly notifications: number;
  /** Record views made (a record whose view did not change is not made again). */
  readonly views: number;
  /** Notices accepted as records. */
  readonly posted: number;
  /** Notices that folded into a record that was already there. */
  readonly folded: number;
  /** Notices, and operations that would have been too many, that went to the row of a source that posts too much. */
  readonly limited: number;
};

/** The limits of the model, from the mock: titles, bounds of the history and the rate (S74, S82). */
export const LIMITS = Object.freeze({
  /** A title (S74). */
  title: 80,
  /** One sentence of detail or phase text. */
  detail: 120,
  /** Diagnostics (the mock keeps 64 KiB; P5 keeps 8 KiB persisted). */
  details: 8192,
  /** What a record saves of its diagnostics. */
  storedDetails: 4096,
  field: 60,
  fieldLabel: 24,
  unit: 16,
  fields: 4,
  actions: 4,
  actionLabel: 24,
  steps: 20,
  stepLabel: 40,
  /** Records kept once finished: 500 (the lead's ruling of 2026-11-20 for the owner's decision B7; the mock and S74 say 200). */
  history: 500,
  /** How old a finished record may be (S74: seven days). */
  age: 7 * 86_400_000,
  /** Operations that may run at once, per source and in all: a plugin that starts more is flooding. */
  activePerSource: 200,
  active: 1000,
  /** Notices a source may post in a second, and in a minute (S82: 20 a minute; the second bounds a burst); the rest go to its row. */
  perSecond: 5,
  perMinute: 20,
  /** Lines of folded children kept in a record's details. */
  children: 20,
  /** Toasts on screen, the summary toast included (S79). */
  toasts: 3,
  source: 40,
  key: 64,
});

/** Times, in milliseconds. */
export const TIMING = Object.freeze({
  /** A toast that is not sticky closes by itself this long after it appears: 8 s (S78, OF4; the lead's ruling of 2026-11-20: the written rule, not the mock's code, which says 7 s). */
  toast: 8000,
  /** When the clocks resume after a hold, a toast has at least this long to be read (S78, S89a). */
  grace: 2000,
  /** The sliding window of a group, and of a message that repeats (S82). */
  fold: 60_000,
  /** One notification per key in this time, counted from the first (S85). */
  key: 600_000,
  /** Clear and Dismiss offer Undo this long (S80). */
  undo: 10_000,
  /** The centre must have been open this long for what it listed to count as read (S81). */
  seen: 1000,
  /** The listeners are called at most once in this long: one snapshot per frame. */
  frame: 16,
  /** What a screen reader is told about a bar changes at most this often (S86). */
  a11y: 1000,
  /** Mute for an hour (S82). */
  hour: 3_600_000,
});

/** A mute that does not end: the latest date a JavaScript `Date` holds. */
export const FOREVER = 8.64e15;

/** The version of what is saved, and what is saved of a record. */
export type PersistedAction = {
  readonly id: string;
  readonly kind: ActionKind;
  readonly label: string;
  readonly route?: Route | undefined;
  readonly reveal?: Json | undefined;
  readonly command?: CommandRef | undefined;
  readonly primary?: boolean | undefined;
  readonly danger?: boolean | undefined;
  readonly icon?: string | undefined;
  readonly disabled?: string | undefined;
  /** An action the model itself provides (Mute on the row of a source that posts too much). */
  readonly builtin?: 'mute' | undefined;
};

export type PersistedRecord = {
  readonly id: string;
  readonly kind: Kind;
  readonly source: string;
  readonly initiator: Initiator;
  readonly severity: Severity;
  readonly state: State;
  readonly title: string;
  readonly doneTitle: string;
  readonly detail: string;
  readonly details: string;
  readonly target?: { readonly label: string; readonly kind: string; readonly route?: Route | undefined; readonly removed?: boolean | undefined } | undefined;
  readonly fields: readonly Field[];
  readonly actions: readonly PersistedAction[];
  readonly count: number;
  readonly fold: FoldKind;
  readonly attempt: number;
  readonly createdAt: number;
  readonly startedAt?: number | undefined;
  readonly finishedAt?: number | undefined;
  readonly updatedAt: number;
  readonly read: boolean;
  /** The highest severity a producer asked for: kept, so a record never gets quieter after a restart. */
  readonly raised?: Severity | undefined;
};

/** What the session saves of the model: the history (finished records, messages, and the operations that were running, which come back as unknown) and the mutes. */
export type PersistedNotices = {
  readonly version: typeof NOTICES_VERSION;
  readonly records: readonly PersistedRecord[];
  /** Source to the time its mute ends, in milliseconds since the epoch. */
  readonly muted: Readonly<Record<string, number>>;
};

export type { Availability, Destination, Json, ModifierEvent, OpenHow, OpenOptions, OpenResult, Route, RouteInput };
