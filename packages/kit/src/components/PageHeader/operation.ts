import type { IconName } from '../Icon';

/**
 * Where a user-started operation is (the mock's `Shell.ops` states). `queued`, `running` and `paused` are active: the work is not over.
 * `succeeded` and `cancelled` end calmly; `failed` and `unknown` (the outcome could not be established) need the person to see them.
 */
export type PageOperationState = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';

/** One command the operation offers: Cancel while it runs, the recovery (Retry) or the follow-up (Open) once it ended. */
export type PageOperationAction = {
  readonly id: string;
  /** The command's own word: it names the button. */
  readonly label: string;
  /** `cancel` is the one command drawn while the work is active; `retry` is painted as the primary command. Without a kind it is a plain command. */
  readonly kind?: 'cancel' | 'retry' | 'custom' | undefined;
  /** A glyph before the label. Cancel and Retry have one of their own. */
  readonly icon?: IconName | undefined;
  readonly onSelect: () => void;
  /** Why it cannot be used now. The button stays focusable and does nothing. */
  readonly disabledReason?: string | undefined;
};

/**
 * A user-started operation as the page header's slot presents it: a record the page hands over, with nothing wired behind it (the
 * work, its steps and its retry are the caller's). While it runs the slot shows one step label, a 4 px track and Cancel; once it ended
 * it shows the sentence of the outcome, the record's first command and Dismiss. Starting, finishing, failing, retrying or clearing an
 * operation moves nothing below the header (design 05 OF2, 12 PH2).
 */
export type PageOperation = {
  /** Names the work for assistive technology ("Scale orders-api"): the presenter's label and what Dismiss dismisses. */
  readonly title: string;
  readonly state: PageOperationState;
  /**
   * What the slot says. While the work runs, the step ("Scaling orders-api: 2 of 5 replicas"); once it ended, the sentence of the
   * outcome: verb, object and effect on success ("Scaled orders-api to 5 replicas"), the failure sentence on a failure.
   */
  readonly text: string;
  /** While the work is active: how far it is, from 0 to 1, or `'indeterminate'` when that cannot be said. Absent: no bar, and the track's room stays. */
  readonly progress?: number | 'indeterminate' | undefined;
  /** The record's commands, in priority order. */
  readonly actions?: readonly PageOperationAction[] | undefined;
  /**
   * The outcome is dismissed. Called by the Dismiss button, and by the presenter itself 8 s after a calm outcome (a success or a cancel;
   * held while the pointer or the focus is in it). A failure and an unknown outcome are never cleared by the clock. Absent: no Dismiss.
   */
  readonly onDismiss?: (() => void) | undefined;
};
