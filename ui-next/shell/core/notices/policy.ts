import { SEVERITIES, type Initiator, type Kind, type Severity, type State } from './types';

// The rules that decide what a record is worth to the user, all pure (ch16 S74, S77, S78, S81, S81a, S85, S86, S86a; ch05 OF1 to OF4; the mock's `deriveSeverity`, `quietCompletion`,
// `toastPolicy`, `say` and `finishText`, shell-notify.js): facts in, a decision out. The store applies them when a record changes state, never on a progress tick (S76: no continuous
// tracking).

/** What the rules read of a record. `severity` is the stored one: already derived from the state and raised by the producer. */
export type Facts = {
  readonly kind: Kind;
  readonly state: State;
  readonly severity: Severity;
  readonly initiator: Initiator;
  readonly read: boolean;
  /** The record carries an action the user can use now: an enabled Retry, command, route or code of the producer (S77: "a warning with an action"). An action that cannot be used is no action: the toast draws no button for it. */
  readonly action: boolean;
};

/** What happened to a record since the rules last looked: it is new, its state changed, or it started over (Retry). */
export type Change = { readonly first: boolean; readonly changed: boolean; readonly restarted: boolean };

const RANK: Readonly<Record<Severity, number>> = { info: 0, success: 1, warning: 2, error: 3 };
const DERIVED: Readonly<Record<State, Severity>> = { queued: 'info', running: 'info', paused: 'info', cancelled: 'info', succeeded: 'success', failed: 'error', unknown: 'warning' };
const WORD: Readonly<Record<Severity, string>> = { info: 'Info', success: 'Success', warning: 'Warning', error: 'Error' };
const STATE_WORD: Readonly<Partial<Record<State, string>>> = { queued: 'Queued', paused: 'Paused', cancelled: 'Canceled' };

export const maxSeverity = (a: Severity, b: Severity): Severity => (RANK[b] > RANK[a] ? b : a);

export const isActive = (state: State): boolean => state === 'queued' || state === 'running' || state === 'paused';

/** An operation's severity follows its state; a producer may raise it and never lower it (S74). A message is what it was posted as. */
export function deriveSeverity(kind: Kind, state: State, posted: Severity, raised: Severity | undefined): Severity {
  if (kind === 'message') {
    return SEVERITIES.includes(posted) ? posted : 'info';
  }

  return maxSeverity(DERIVED[state], raised ?? 'info');
}

/**
 * A completion that is read history (S81a, S86a): a calm outcome (succeeded or cancelled, never raised to a warning or an error) of work the system started, or of work the user started that
 * its own control already shows (`inline`). Warnings and errors are never silently reclassified as ordinary success.
 */
export function quiet(facts: Facts, inline: boolean): boolean {
  return facts.kind === 'operation' && (facts.state === 'succeeded' || facts.state === 'cancelled') && facts.severity !== 'warning' && facts.severity !== 'error' && (facts.initiator === 'system' || inline);
}

/** The bell counts it (S81): not read, not active, and its source is not muted. */
export const unread = (facts: Facts, muted: boolean): boolean => !facts.read && !isActive(facts.state) && !muted;

/** Unread, and an error or a warning: the "Needs attention" view. */
export const attention = (facts: Facts, muted: boolean): boolean => unread(facts, muted) && (facts.severity === 'error' || facts.severity === 'warning');

/** An error of work the user is waiting on interrupts (`role="alert"`); everything else is polite (S86, O6). */
export const urgent = (facts: Facts): boolean => facts.severity === 'error' && facts.initiator === 'user';

/**
 * The eligibility table (S77, S78, OF4): `null` is no toast, else whether it is sticky. A muted source and a record whose own control shows it raise none for any outcome. Work the user started is
 * sticky while it runs and updated in place; work the system started raises none while it runs. A completion that is read history raises none. A failure, an unknown outcome and an error are
 * sticky, whether or not it has an action: "a failure must not vanish" (S78; the lead's ruling of 2026-11-20 follows the written rule, and not the mock's `toastPolicy`, which timed out a failure that
 * offered no decision). A warning that carries an action is sticky too, any action (S77's table: "a warning with an action"; the mock's `needsAction` counted only a Retry or a producer's code, and the lead
 * ruled for the written rule again); anything else that ended closes by itself, after `TIMING.toast`.
 */
export function toastPolicy(facts: Facts, options: { readonly muted: boolean; readonly inline: boolean }): { readonly sticky: boolean } | null {
  if (options.muted || options.inline) {
    return null;
  }

  if (isActive(facts.state)) {
    return facts.initiator === 'user' ? { sticky: true } : null;
  }

  if (quiet(facts, false)) {
    return null;
  }

  const failure = facts.state === 'failed' || facts.state === 'unknown' || facts.severity === 'error';
  return { sticky: failure || (facts.severity === 'warning' && facts.action) };
}

/** What a record that ended is told to the live region as (S86): the same words as its toast would carry, with its state in a word. */
export function finishText(facts: {
  readonly kind: Kind;
  readonly state: State;
  readonly severity: Severity;
  /** The headline: what a person reads. */
  readonly title: string;
  readonly doneTitle: string;
  /** The headline already says what failed ("Couldn't connect to prod-db"), so it needs no "Failed:". */
  readonly failedHeadline: boolean;
  readonly detail: string;
  readonly targetLabel: string;
}): string {
  const sentence = facts.detail === '' ? '' : `. ${facts.detail}`;
  if (facts.kind === 'message') {
    return `${WORD[facts.severity]}: ${facts.title}${sentence}`;
  }

  if (facts.state === 'succeeded') {
    return facts.doneTitle === '' ? `Succeeded: ${facts.title}` : facts.title;
  }

  if (facts.state === 'unknown') {
    return `Outcome unknown: ${facts.title}. Check ${facts.targetLabel === '' ? 'the target' : facts.targetLabel}`;
  }

  return `${facts.failedHeadline ? facts.title : `${STATE_WORD[facts.state] ?? 'Failed'}: ${facts.title}`}${sentence}`;
}

/**
 * What the live region is told for a record that raises no toast (S86, S86a): the start of work once and its finish once, "Retrying" once when it starts over, and never a tick. Nothing for a
 * muted source, for work the system started while it runs, or for a calm automatic completion. A toast announces itself, so a record with one is not told here.
 */
export function announcement(facts: Facts, change: Change, options: { readonly muted: boolean; readonly quiet: boolean }): { readonly kind: 'start' | 'retry' | 'finish'; readonly urgent: boolean } | null {
  if (options.muted || (facts.kind === 'operation' && facts.initiator === 'system' && (isActive(facts.state) || options.quiet))) {
    return null;
  }

  const done = !isActive(facts.state);
  if (change.restarted && !done) {
    return { kind: 'retry', urgent: false };
  }

  if (change.first && !done) {
    return { kind: 'start', urgent: false };
  }

  return (change.first || change.changed) && done ? { kind: 'finish', urgent: urgent(facts) } : null;
}
