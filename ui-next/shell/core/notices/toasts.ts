import { maxSeverity } from './policy';
import { LIMITS, type RecordView, type Severity, type ToastItem } from './types';

// The stack (ch16 S79, O6; the mock's `toastEntries`, and the audit QA-SF-13): at most three toasts, the summary toast included, newest at the bottom. With more than three eligible the two newest
// and one summary toast on top that stands for the rest ("3 more notifications", whose button Show opens the centre), so no record is lost; it carries the worst severity it hides.

/** The id of the summary toast: not a record. */
export const SUMMARY = '__summary';

/** A toast the model holds: a record, and whether it stays until the user acts. Entries come in arrival order. */
export type StackEntry = { readonly id: string; readonly sticky: boolean };

const keyOf = (id: string): string => `notice:toast:${id}`;

/** The toasts to show, top first: the summary toast (when records are hidden), then the newest records in arrival order. A toast whose record is gone is skipped. */
export function composeStack(entries: readonly StackEntry[], view: (id: string) => RecordView | undefined, limit: number = LIMITS.toasts): readonly ToastItem[] {
  const live: Array<{ readonly entry: StackEntry; readonly record: RecordView }> = [];
  for (const entry of entries) {
    const record = view(entry.id);
    if (record !== undefined) {
      live.push({ entry, record });
    }
  }

  const item = ({ entry, record }: { readonly entry: StackEntry; readonly record: RecordView }): ToastItem =>
    Object.freeze({ key: keyOf(entry.id), id: entry.id, record, summary: undefined, sticky: entry.sticky, urgent: record.urgent });

  if (live.length <= limit) {
    return Object.freeze(live.map(item));
  }

  const shown = live.slice(live.length - (limit - 1));
  const hidden = live.slice(0, live.length - shown.length);
  let worst: Severity = 'info';
  for (const { record } of hidden) {
    worst = maxSeverity(worst, record.severity);
  }

  const summary: ToastItem = Object.freeze({
    key: keyOf(SUMMARY),
    id: SUMMARY,
    record: undefined,
    summary: Object.freeze({ count: hidden.length, severity: worst, ids: Object.freeze(hidden.map(({ entry }) => entry.id)) }),
    sticky: true,
    urgent: false,
  });
  return Object.freeze([summary, ...shown.map(item)]);
}
