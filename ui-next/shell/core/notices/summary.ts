import { maxSeverity } from './policy';
import { line } from './text';
import type { Activity, ActivityBar, Bell, Counts, RecordView, Severity } from './types';

// What the bell and the status area show (ch16 S81, S90, S94; ch05 167, 177; the mock's `summary` and `opsFace` and `trackOf`). The bell is a dot and a name that carries the counts, never a number
// (A12). The status area says one operation by its title and its own track, or several as a count and the worst severity; a bar only when one operation or every one that runs counts the same
// unit, and then it is their sum, never an average. Everything here reads views: it does what it is told by the records, and invents nothing.

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

const figure = (value: number): string => String(Math.round(value * 100) / 100);

/** The bell: a dot of the worst unread severity (red for an error, amber for a warning, else the accent), and a name ("Notifications, 3 unread, 1 error"). Work that runs is never unread (S81). */
export function bellOf(views: readonly RecordView[]): Bell {
  let unread = 0;
  let errors = 0;
  let warnings = 0;
  let attention = 0;
  let active = 0;
  for (const record of views) {
    if (record.active) {
      active += 1;
    } else if (record.unread) {
      unread += 1;
      if (record.severity === 'error') {
        errors += 1;
      } else if (record.severity === 'warning') {
        warnings += 1;
      }
    }

    if (record.attention) {
      attention += 1;
    }
  }

  const label = ['Notifications'];
  if (unread > 0) {
    label.push(`${String(unread)} unread`);
  }

  if (errors > 0) {
    label.push(plural(errors, 'error'));
  }

  if (warnings > 0) {
    label.push(plural(warnings, 'warning'));
  }

  return Object.freeze({ dot: errors > 0 ? 'error' : warnings > 0 ? 'warning' : unread > 0 ? 'info' : '', unread, errors, warnings, attention, active, label: label.join(', ') });
}

/** The counts of the centre's segmented control: All, Active, Needs attention (S80). */
export function countsOf(views: readonly RecordView[]): Counts {
  let active = 0;
  let attention = 0;
  let unread = 0;
  for (const record of views) {
    active += record.active ? 1 : 0;
    attention += record.attention ? 1 : 0;
    unread += record.unread ? 1 : 0;
  }

  return Object.freeze({ all: views.length, active, attention, unread });
}

/**
 * A bar only where the producer gave counts (never invented, ch05 171). One operation: its own track. Several: only when every one counts the same unit, and then the sum of what they
 * counted (ch05 177). Percents are not a unit: they would have to be averaged. The words are the sample a screen reader is told, so the widget and its popover read alike (QA-SF-27).
 */
function barOf(list: readonly RecordView[]): ActivityBar | undefined {
  const [first] = list;
  if (first === undefined) {
    return undefined;
  }

  if (list.length === 1) {
    const progress = first.progress;
    if (progress === undefined) {
      return undefined;
    }

    return progress.kind === 'indeterminate'
      ? Object.freeze({ kind: 'indeterminate', fraction: null, text: progress.a11y.text })
      : Object.freeze({ kind: 'determinate', fraction: progress.fraction, text: progress.a11y.text });
  }

  const unit = first.progress?.kind === 'determinate' ? first.progress.unit : '';
  if (unit === '' || unit === '%') {
    return undefined;
  }

  let current = 0;
  let total = 0;
  let sampledCurrent = 0;
  let sampledTotal = 0;
  for (const record of list) {
    const progress = record.progress;
    if (progress?.kind !== 'determinate' || progress.unit !== unit) {
      return undefined;
    }

    current += progress.current;
    total += progress.total;
    sampledCurrent += progress.a11y.current;
    sampledTotal += progress.a11y.total;
  }

  return Object.freeze({ kind: 'determinate', fraction: total > 0 ? current / total : 0, text: `${figure(sampledCurrent)} of ${figure(sampledTotal)} ${unit}` });
}

const REST: Activity = Object.freeze({ count: 0, running: 0, queued: 0, paused: 0, worst: '', text: 'Operations', tooltip: 'Nothing is running', bar: undefined, cancel: undefined });

/** The status area's widget (S94): one operation's title and track with a Cancel beside it (never nested in the widget), or a count and the worst severity. */
export function activityOf(active: readonly RecordView[]): Activity {
  const [only] = active;
  if (only === undefined) {
    return REST;
  }

  let running = 0;
  let queued = 0;
  let paused = 0;
  let worst: Severity = 'info';
  for (const record of active) {
    running += record.state === 'running' ? 1 : 0;
    queued += record.state === 'queued' ? 1 : 0;
    paused += record.state === 'paused' ? 1 : 0;
    worst = maxSeverity(worst, record.severity);
  }

  const one = active.length === 1;
  const cancel = one ? only.actions.find((action) => action.kind === 'cancel') : undefined;
  return Object.freeze({
    count: active.length,
    running,
    queued,
    paused,
    worst,
    text: one ? line(only.title, 24) : `${String(active.length)} operations`,
    tooltip: one ? `${only.title}${only.text === '' ? '' : `\n${only.text}`}` : active.map((record) => record.title).join('\n'),
    bar: barOf(active),
    cancel: cancel === undefined ? undefined : Object.freeze({ id: only.id, label: cancel.label, disabled: cancel.disabled }),
  });
}
