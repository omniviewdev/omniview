import { resolveActions, type ActionDecl } from './actions';
import { present, type Phrase } from './copy';
import { attention, isActive, unread, urgent, type Facts } from './policy';
import { fractionOf } from './progress';
import type { A11y, ActionCall, Availability, Cancellation, CommandRef, Field, FoldKind, Initiator, Kind, Origin, Progress, ProgressView, RecordView, Route, Severity, State, Target } from './types';

// The record the store holds (mutable, private) and the view it makes of it (frozen, public). A view is made once for a change of the record and reused until it changes again: a record that did not
// change is the same object in the next snapshot, so a view that renders it can skip it, and the work of a snapshot is bounded by what changed, never by what exists.

export type Handlers = {
  cancel: (() => unknown) | undefined;
  retry: (() => unknown) | undefined;
  /** The code of the producer's own actions, by id. */
  actions: Map<string, (call: ActionCall) => unknown>;
};

export type Rec = {
  readonly id: string;
  readonly kind: Kind;
  readonly source: string;
  readonly createdAt: number;
  initiator: Initiator;
  origin: Origin;
  rev: number;
  title: string;
  doneTitle: string;
  detail: string;
  details: string;
  target: Target | undefined;
  state: State;
  /** The highest severity the producer asked for: an operation's severity never goes below it. */
  raised: Severity | undefined;
  severity: Severity;
  progress: Progress | null;
  fields: readonly Field[];
  decls: readonly ActionDecl[];
  cancellation: Cancellation;
  /** How it folds, and the key it is found by: the kind is only said once it has folded something (`count` above one). */
  foldKind: FoldKind;
  foldKey: string;
  count: number;
  attempt: number;
  /** The children a fold absorbed, a line each, the last few. */
  log: string[];
  startedAt: number | undefined;
  finishedAt: number | undefined;
  updatedAt: number;
  read: boolean;
  toasted: boolean;
  toastDismissed: boolean;
  /** Its outcome was over the source's budget: it keeps its place in the history and raises no toast. */
  limited: boolean;
  inlineDismissed: boolean;
  /** Its plugin left: the code of its actions is gone. */
  dead: boolean;
  /** What a screen reader was last told of the bar, and when. */
  pub: A11y | undefined;
  pubAt: number;
  view: RecordView | undefined;
  /** The view before something outside the record made it stale (a mute, the host's answers): kept so that a view that says the same is not a new object. */
  prior: RecordView | undefined;
};

/** What a view of a record needs of the store. */
export type ViewContext = {
  readonly pluginName: (source: string) => string;
  readonly muted: (source: string) => boolean;
  /** Why the producer's code of a record cannot run: its plugin left ("Cloud isn't running."), or it was reloaded. Empty while it can. */
  readonly dead: (rec: Rec) => string;
  readonly handlers: (rec: Rec) => { readonly cancel: boolean; readonly retry: boolean; readonly has: (id: string) => boolean };
  readonly availability: (route: Route) => Availability;
  readonly commandAvailability: (command: CommandRef) => Availability;
  readonly current: (route: Route) => boolean;
  readonly counted: () => void;
};

export const factsOf = (rec: Rec, decision: boolean): Facts => ({ kind: rec.kind, state: rec.state, severity: rec.severity, initiator: rec.initiator, read: rec.read, decision });

/** Whether two values of plain data say the same: the same object, or the same primitives, arrays and objects, member for member. */
export function equalPlain(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item: unknown, index) => equalPlain(item, b[index]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && equalPlain(left[key], right[key]));
}

/** The fold a record says: only once it has folded something. */
const foldOf = (rec: Rec): FoldKind => (rec.count > 1 ? rec.foldKind : '');

/** The diagnostics a person reads: the producer's, then the children a fold absorbed, bounded. */
function detailsOf(rec: Rec, limit: number): string {
  const text = rec.log.length === 0 ? rec.details : [rec.details, ...rec.log].filter((part) => part !== '').join('\n');
  return text.length > limit ? text.slice(text.length - limit) : text;
}

function progressView(rec: Rec): ProgressView | undefined {
  const progress = rec.progress;
  if (progress === null || !isActive(rec.state) || rec.pub === undefined) {
    return undefined;
  }

  const a11y = rec.pub;
  if (progress.kind === 'indeterminate') {
    return Object.freeze({ kind: 'indeterminate', fraction: null, a11y });
  }

  const fraction = fractionOf(progress) ?? 0;
  return progress.kind === 'steps'
    ? Object.freeze({ kind: 'steps', fraction, current: progress.current, total: progress.total, label: progress.label, steps: progress.steps, a11y })
    : Object.freeze({ kind: 'determinate', fraction, current: progress.current, total: progress.total, unit: progress.unit, a11y });
}

/** The view of a record, made once for a change of it. */
export function viewOf(rec: Rec, context: ViewContext, limit: number): RecordView {
  if (rec.view !== undefined) {
    return rec.view;
  }

  context.counted();
  const handlers = context.handlers(rec);
  const actions = resolveActions({
    state: rec.state,
    kind: rec.kind,
    cancellation: rec.cancellation,
    target: rec.target,
    decls: rec.decls,
    handlers,
    dead: context.dead(rec),
    availability: context.availability,
    commandAvailability: context.commandAvailability,
    current: context.current,
  });
  const decision = actions.some((action) => action.disabled === '' && (action.kind === 'retry' || action.kind === 'custom'));
  const facts = factsOf(rec, decision);
  const muted = context.muted(rec.source);
  const phrase: Phrase = {
    kind: rec.kind,
    state: rec.state,
    severity: rec.severity,
    source: rec.source,
    sourceName: context.pluginName(rec.source),
    title: rec.title,
    doneTitle: rec.doneTitle,
    detail: rec.detail,
    target: rec.target,
    progress: rec.progress,
    cancellation: rec.cancellation,
    cancelLabel: rec.decls.find((decl) => decl.kind === 'cancel')?.label ?? '',
    attempt: rec.attempt,
    count: rec.count,
    fold: foldOf(rec),
  };
  const words = present(phrase, actions);
  const open = actions.find((action) => action.kind === 'open');
  const next: RecordView = Object.freeze({
    id: rec.id,
    kind: rec.kind,
    rev: rec.rev,
    source: rec.source,
    sourceName: phrase.sourceName,
    initiator: rec.initiator,
    severity: rec.severity,
    state: rec.state,
    active: isActive(rec.state),
    title: words.title,
    name: rec.title,
    word: words.word,
    text: words.text,
    reason: words.reason,
    phase: words.phase,
    details: detailsOf(rec, limit),
    target: rec.target,
    produced: open?.route !== undefined && rec.target !== undefined ? Object.freeze({ label: rec.target.label, route: open.route }) : undefined,
    progress: progressView(rec),
    fields: rec.fields,
    actions,
    cancellation: rec.cancellation,
    count: rec.count,
    fold: foldOf(rec),
    attempt: rec.attempt,
    origin: rec.origin,
    createdAt: rec.createdAt,
    startedAt: rec.startedAt,
    finishedAt: rec.finishedAt,
    updatedAt: rec.updatedAt,
    read: rec.read,
    unread: unread(facts, muted),
    attention: attention(facts, muted),
    urgent: urgent(facts),
    toasted: rec.toasted,
    inlineDismissed: rec.inlineDismissed,
  });
  const prior = rec.prior;
  rec.prior = undefined;
  rec.view = prior !== undefined && equalPlain(prior, next) ? prior : next;
  return rec.view;
}
