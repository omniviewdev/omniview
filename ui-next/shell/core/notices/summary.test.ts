import { describe, expect, it } from 'vitest';
import { activityOf, bellOf, countsOf } from './summary';
import { view } from './testing';
import type { ActionView, ProgressView, RecordView } from './types';

// What the bell and the status area show (ch16 S81, S90, S94; ch05 167, 177; the mock's `summary` and `opsFace`/`trackOf`, shell-notify.js:660-690 and shell-feedback.js:464-520): the bell a dot
// and a name that carries the counts, never a number; the work that runs as one operation's own title and track, or a count and the worst severity, and a bar only when one operation or every
// one that runs counts the same unit, and then their sum, never an average.

const determinate = (current: number, total: number, unit: string, text = ''): ProgressView => ({
  kind: 'determinate',
  fraction: current / total,
  current,
  total,
  unit,
  a11y: { now: Math.round((current / total) * 100), text: text === '' ? `${String(current)} of ${String(total)} ${unit}` : text, current, total },
});

const running = (extra: Partial<RecordView> = {}): RecordView => view({ kind: 'operation', state: 'running', active: true, unread: false, read: false, severity: 'info', initiator: 'user', ...extra });
const cancel: ActionView = { id: 'cancel', kind: 'cancel', label: 'Cancel', variant: 'default', icon: '', danger: false, disabled: '', route: undefined, command: undefined };

describe('bellOf (S81)', () => {
  it('is quiet when nothing is unread', () => {
    expect(bellOf([view({ unread: false, read: true })])).toEqual({ dot: '', unread: 0, errors: 0, warnings: 0, attention: 0, active: 0, label: 'Notifications' });
  });

  it('lights a dot of the worst unread severity: red for an error, amber for a warning, else the accent', () => {
    expect(bellOf([view({ unread: true, severity: 'info' })]).dot).toBe('info');
    expect(bellOf([view({ unread: true, severity: 'info' }), view({ id: 'n2', unread: true, severity: 'warning', attention: true })]).dot).toBe('warning');
    expect(bellOf([view({ unread: true, severity: 'warning', attention: true }), view({ id: 'n2', unread: true, severity: 'error', attention: true })]).dot).toBe('error');
  });

  it('gives the counts in its name, and no number to draw (A12)', () => {
    const list = [
      view({ id: 'a', unread: true, severity: 'error', attention: true }),
      view({ id: 'b', unread: true, severity: 'warning', attention: true }),
      view({ id: 'c', unread: true, severity: 'warning', attention: true }),
      view({ id: 'd', unread: true, severity: 'success' }),
    ];
    const bell = bellOf(list);
    expect(bell).toMatchObject({ unread: 4, errors: 1, warnings: 2, attention: 3 });
    expect(bell.label).toBe('Notifications, 4 unread, 1 error, 2 warnings');
    expect(bellOf([view({ unread: true, severity: 'error', attention: true })]).label).toBe('Notifications, 1 unread, 1 error');
  });

  it('does not count a record that is not unread: read, or muted', () => {
    expect(bellOf([view({ unread: false, severity: 'error' }), view({ id: 'b', unread: false, severity: 'warning' })]).dot).toBe('');
  });

  it('never counts work that is still running as unread, and counts it as active', () => {
    const bell = bellOf([running(), running({ id: 'n2' })]);
    expect(bell).toMatchObject({ unread: 0, active: 2, dot: '' });
  });
});

describe('countsOf: the centre\'s segmented control (S80)', () => {
  it('counts all, active, and what needs attention', () => {
    const list = [running(), view({ id: 'b', unread: true, severity: 'error', attention: true }), view({ id: 'c', unread: true }), view({ id: 'd', unread: false, read: true })];
    expect(countsOf(list)).toEqual({ all: 4, active: 1, attention: 1, unread: 2 });
  });
});

describe('activityOf (S90, S94)', () => {
  it('is at rest with nothing running', () => {
    expect(activityOf([])).toEqual({ count: 0, running: 0, queued: 0, paused: 0, worst: '', text: 'Operations', tooltip: 'Nothing is running', bar: undefined, cancel: undefined });
  });

  it('says one operation by its title, with its own track, and a Cancel beside it when it can be cancelled', () => {
    const one = running({ title: 'Restarting api-gateway', phase: 'Draining the first node', text: 'Draining the first node', actions: [cancel], progress: determinate(3, 7, 'items') });
    const activity = activityOf([one]);
    expect(activity).toMatchObject({ count: 1, running: 1, text: 'Restarting api-gateway', tooltip: 'Restarting api-gateway\nDraining the first node' });
    expect(activity.bar).toMatchObject({ kind: 'determinate', text: '3 of 7 items' });
    expect(activity.bar?.fraction).toBeCloseTo(3 / 7);
    expect(activity.cancel).toEqual({ id: 'n1', label: 'Cancel', disabled: '' });
  });

  it('cuts a long title for the widget at twenty-four characters and keeps it whole in the tooltip', () => {
    const activity = activityOf([running({ title: 'Reconciling the whole stack of the production account' })]);
    expect(activity.text).toHaveLength(24);
    expect(activity.tooltip).toContain('Reconciling the whole stack of the production account');
  });

  it('has no bar for work that has no measure, and a bar that is indeterminate when it says so', () => {
    expect(activityOf([running()]).bar).toBeUndefined();
    expect(activityOf([running({ progress: { kind: 'indeterminate', fraction: null, a11y: { now: null, text: 'Working…', current: 0, total: 0 } } })]).bar).toEqual({ kind: 'indeterminate', fraction: null, text: 'Working…' });
  });

  it('reads a step as the steps behind it, and its words as the step', () => {
    const steps: ProgressView = { kind: 'steps', fraction: 1 / 9, current: 2, total: 9, label: 'Download', steps: undefined, a11y: { now: 11, text: 'Step 2 of 9: Download', current: 2, total: 9 } };
    expect(activityOf([running({ progress: steps })]).bar).toEqual({ kind: 'determinate', fraction: 1 / 9, text: 'Step 2 of 9: Download' });
  });

  it('says several as a count, and draws no Cancel: it is for one', () => {
    const activity = activityOf([running({ id: 'a', title: 'A', actions: [cancel] }), running({ id: 'b', title: 'B', actions: [cancel] })]);
    expect(activity).toMatchObject({ count: 2, text: '2 operations', tooltip: 'A\nB' });
    expect(activity.cancel).toBeUndefined();
  });

  it('draws a bar for several only when every one counts the same unit, and then it is their sum (ch05 177)', () => {
    const same = activityOf([running({ id: 'a', progress: determinate(4, 10, 'items') }), running({ id: 'b', progress: determinate(6, 30, 'items') })]);
    expect(same.bar).toMatchObject({ kind: 'determinate', text: '10 of 40 items' });
    expect(same.bar?.fraction).toBe(0.25);
  });

  it('never averages: percents, mixed units and a record with no measure draw no bar', () => {
    expect(activityOf([running({ id: 'a', progress: determinate(40, 100, '%') }), running({ id: 'b', progress: determinate(60, 100, '%') })]).bar).toBeUndefined();
    expect(activityOf([running({ id: 'a', progress: determinate(4, 10, 'items') }), running({ id: 'b', progress: determinate(1, 2, 'files') })]).bar).toBeUndefined();
    expect(activityOf([running({ id: 'a', progress: determinate(4, 10, 'items') }), running({ id: 'b' })]).bar).toBeUndefined();
  });

  it('counts what runs, what waits and what is paused, and says the worst severity of them (ch05 167)', () => {
    const activity = activityOf([running({ id: 'a' }), running({ id: 'b', state: 'queued' }), running({ id: 'c', state: 'paused' }), running({ id: 'd', severity: 'error' })]);
    expect(activity).toMatchObject({ count: 4, running: 2, queued: 1, paused: 1, worst: 'error' });
    expect(activityOf([running({ id: 'a' }), running({ id: 'b', severity: 'warning' })]).worst).toBe('warning');
    expect(activityOf([running({ id: 'a' })]).worst).toBe('info');
  });

  it('shows the Cancel of the one operation with its reason when it cannot be used', () => {
    const waiting: ActionView = { ...cancel, label: 'Canceling…', disabled: 'Requested. Waiting for the producer to acknowledge.' };
    expect(activityOf([running({ actions: [waiting] })]).cancel).toEqual({ id: 'n1', label: 'Canceling…', disabled: 'Requested. Waiting for the producer to acknowledge.' });
  });
});
