import { ageTip, type IconName } from '@omniviewdev/kit';
import { TIMING, type Muted } from '../core/notices';

// The words of the notification centre that are its own (ch16 S80, S81; the mock's `EMPTY`, `emptyHtml`, `barHtml`, the `commands` and their announcements, shell-feedback.js). The words of a record (its title,
// its sentence, its state, why an action cannot be used) are the model's, made once for every surface; what is here is the frame around them: the empty states, the notes under the bar, the buttons and what a screen
// reader is told when one of them did something.

export const plural = (count: number, one: string, many = `${one}s`): string => `${String(count)} ${count === 1 ? one : many}`;

/** The time of day in the viewer's locale, hour and minute: when a mute ends (the mock's `clock`). */
export const clockOf = (time: number): string => new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const MINUTE = 60_000;

/**
 * The tip of a record's time (the kit's `ageTip`: the instant in UTC and the span in words, "2026-11-14 11:03 UTC · 2 days ago"), as a label rule for the page's age clock, which keeps it as current as the label beside it: its
 * words change at most once a minute, so it is asked again at the next minute after the time. It has the shape the kit's `useAge` takes (`AgeFormatter`, which the kit does not export).
 */
export function tipAge(date: Date, now: number): { readonly text: string; readonly changesAt: number } {
  const time = date.getTime();
  return { text: ageTip(date, now), changesAt: time + (Math.max(0, Math.floor((now - time) / MINUTE)) + 1) * MINUTE };
}

/** What the list shows when it has no row: a glyph, what is not there, one sentence of what appears and when, and the one button that leads out. */
export type Empty = {
  readonly icon: IconName;
  readonly title: string;
  readonly hint: string;
  readonly action: 'clear-filters' | undefined;
};

/** How long Undo is offered, in seconds (the model's clock, `TIMING.undo`). */
const UNDO_SECONDS = Math.round(TIMING.undo / 1000);

/**
 * The empty state (the mock's `emptyHtml`, QA-SF-30: the title says what is not there, one sentence says what appears here and when). `total` is the whole history and `matched` what the source filter leaves of it:
 * a history with records and a list with none is the filter's doing, whatever else is true; an empty history says what was cleared while Undo is offered, else where notifications come from.
 */
export function emptyOf({ total, matched, undo }: { readonly total: number; readonly matched: number; readonly undo: { readonly count: number } | undefined }): Empty | undefined {
  if (matched > 0) {
    return undefined;
  }

  if (total > 0) {
    return { icon: 'list-filter', title: 'No matching notifications', hint: 'Nothing matches the source you chose.', action: 'clear-filters' };
  }

  if (undo !== undefined) {
    return { icon: 'trash', title: `Cleared ${plural(undo.count, 'notification')}`, hint: `Undo brings them back for ${String(UNDO_SECONDS)} seconds.`, action: undefined };
  }

  return { icon: 'bell-off', title: 'No notifications', hint: 'Messages from plugins and operations you start appear here.', action: undefined };
}

export type MutedNote = { readonly text: string; readonly button: 'Unmute' | 'Unmute all' };

/** The note under the bar while a source is muted (the mock's `muteNote`): the one source and when its mute ends, or how many are muted; and the button that ends it. */
export function mutedNote(muted: readonly Muted[]): MutedNote | undefined {
  const [only] = muted;
  if (only === undefined) {
    return undefined;
  }

  if (muted.length > 1) {
    return { text: `${String(muted.length)} sources are muted`, button: 'Unmute all' };
  }

  return { text: only.until === 'forever' ? `${only.name} is muted` : `${only.name} is muted until ${clockOf(only.until)}`, button: 'Unmute' };
}

/** The label of Undo: what a single removal was, or a Clear (the mock's 'Undo dismiss' and 'Undo clear'). */
export const undoLabel = (count: number): string => (count === 1 ? 'Undo dismiss' : 'Undo clear');

export const olderLabel = (count: number): string => `Show ${String(count)} older`;

/** What a screen reader is told when a button of the centre did something (the mock's `announce` of each command): the result, in the mock's words. */
export const said = {
  readAll: (count: number): string => `${plural(count, 'notification')} marked as read`,
  cleared: (count: number): string => `Cleared ${plural(count, 'notification')}. Undo is available for ${String(UNDO_SECONDS)} seconds`,
  restored: 'Notifications restored',
  muted: (name: string): string => `${name} is muted for 1 hour. Its notifications still arrive here, without toasts`,
  unmuted: (name: string): string => `${name} is unmuted`,
  unmutedAll: 'Notifications are unmuted',
} as const;
