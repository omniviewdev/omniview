import { describe, expect, it } from 'vitest';
import { announcement, attention, deriveSeverity, finishText, isActive, quiet, toastPolicy, unread, urgent, type Facts } from './policy';

// The rules that decide what a record is worth to the user (ch16 S74, S77, S78, S81, S81a, S85, S86, S86a; ch05 OF1 to OF4; the mock's `deriveSeverity`, `quietCompletion`, `toastPolicy`,
// `say` and `finishText`, shell-notify.js:57-110, 993-1090). All pure: facts in, a decision out.

const facts = (extra: Partial<Facts> = {}): Facts => ({
  kind: 'operation',
  state: 'running',
  severity: 'info',
  initiator: 'user',
  read: false,
  action: false,
  ...extra,
});

describe('deriveSeverity: an operation\'s severity follows its state; a producer may raise it, never lower it (S74)', () => {
  it('maps each state', () => {
    expect(deriveSeverity('operation', 'queued', 'info', undefined)).toBe('info');
    expect(deriveSeverity('operation', 'running', 'info', undefined)).toBe('info');
    expect(deriveSeverity('operation', 'paused', 'info', undefined)).toBe('info');
    expect(deriveSeverity('operation', 'cancelled', 'info', undefined)).toBe('info');
    expect(deriveSeverity('operation', 'succeeded', 'info', undefined)).toBe('success');
    expect(deriveSeverity('operation', 'failed', 'info', undefined)).toBe('error');
    expect(deriveSeverity('operation', 'unknown', 'info', undefined)).toBe('warning');
  });

  it('lets the producer raise it, and never lower it', () => {
    expect(deriveSeverity('operation', 'succeeded', 'info', 'warning')).toBe('warning');
    expect(deriveSeverity('operation', 'running', 'info', 'error')).toBe('error');
    expect(deriveSeverity('operation', 'failed', 'info', 'info')).toBe('error');
    expect(deriveSeverity('operation', 'unknown', 'info', 'success')).toBe('warning');
  });

  it('is what a message was posted as', () => {
    expect(deriveSeverity('message', 'succeeded', 'error', undefined)).toBe('error');
    expect(deriveSeverity('message', 'succeeded', 'warning', 'error')).toBe('warning');
  });
});

describe('isActive', () => {
  it('is queued, running and paused', () => {
    expect(['queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled', 'unknown'].map((state) => isActive(state as Facts['state']))).toEqual([true, true, true, false, false, false, false]);
  });
});

describe('quiet: a completion that is read history (S81a, S86a)', () => {
  it('is a calm outcome of work the system started: a sync that worked is not news', () => {
    expect(quiet(facts({ state: 'succeeded', severity: 'success', initiator: 'system' }), false)).toBe(true);
    expect(quiet(facts({ state: 'cancelled', severity: 'info', initiator: 'system' }), false)).toBe(true);
  });

  it('is a calm outcome of work the user started that its own control already shows', () => {
    expect(quiet(facts({ state: 'succeeded', severity: 'success' }), true)).toBe(true);
    expect(quiet(facts({ state: 'succeeded', severity: 'success' }), false)).toBe(false);
  });

  it('is never a warning or an error: they are not silently reclassified as ordinary success', () => {
    expect(quiet(facts({ state: 'succeeded', severity: 'warning', initiator: 'system' }), true)).toBe(false);
    expect(quiet(facts({ state: 'failed', severity: 'error', initiator: 'system' }), true)).toBe(false);
    expect(quiet(facts({ state: 'unknown', severity: 'warning', initiator: 'system' }), true)).toBe(false);
  });

  it('is never a message', () => {
    expect(quiet(facts({ kind: 'message', state: 'succeeded', severity: 'info', initiator: 'system' }), true)).toBe(false);
  });
});

describe('unread and attention (S81)', () => {
  it('is unread until read, and never while the work is active', () => {
    expect(unread(facts({ state: 'succeeded', severity: 'success' }), false)).toBe(true);
    expect(unread(facts({ state: 'succeeded', severity: 'success', read: true }), false)).toBe(false);
    expect(unread(facts({ state: 'running' }), false)).toBe(false);
  });

  it('is not unread while its source is muted', () => {
    expect(unread(facts({ state: 'failed', severity: 'error' }), true)).toBe(false);
  });

  it('needs attention when unread and a warning or an error', () => {
    expect(attention(facts({ state: 'failed', severity: 'error' }), false)).toBe(true);
    expect(attention(facts({ kind: 'message', state: 'succeeded', severity: 'warning' }), false)).toBe(true);
    expect(attention(facts({ kind: 'message', state: 'succeeded', severity: 'info' }), false)).toBe(false);
    expect(attention(facts({ state: 'failed', severity: 'error', read: true }), false)).toBe(false);
  });
});

describe('urgent: an error of work the user waits on interrupts (S86)', () => {
  it('is an error the user started', () => {
    expect(urgent(facts({ state: 'failed', severity: 'error' }))).toBe(true);
    expect(urgent(facts({ state: 'failed', severity: 'error', initiator: 'system' }))).toBe(false);
    expect(urgent(facts({ state: 'failed', severity: 'warning' }))).toBe(false);
  });
});

describe('toastPolicy: one eligibility rule decides every toast (S77, S78, OF4)', () => {
  const policy = (extra: Partial<Facts>, options: { muted?: boolean; inline?: boolean } = {}) => toastPolicy(facts(extra), { muted: options.muted ?? false, inline: options.inline ?? false });

  it('is sticky for work the user started that has not ended, and nothing for work the system started', () => {
    expect(policy({ state: 'running' })).toEqual({ sticky: true });
    expect(policy({ state: 'queued' })).toEqual({ sticky: true });
    expect(policy({ state: 'paused' })).toEqual({ sticky: true });
    expect(policy({ state: 'running', initiator: 'system' })).toBeNull();
  });

  it('is timed for an outcome that is calm: succeeded, cancelled, an info message, a warning with no action', () => {
    expect(policy({ state: 'succeeded', severity: 'success' })).toEqual({ sticky: false });
    expect(policy({ state: 'cancelled' })).toEqual({ sticky: false });
    expect(policy({ kind: 'message', state: 'succeeded', severity: 'info' })).toEqual({ sticky: false });
    expect(policy({ kind: 'message', state: 'succeeded', severity: 'warning' })).toEqual({ sticky: false });
  });

  it('is sticky for a failure, an unknown outcome, an error message and a warning that carries an action: S77 ("a warning with an action") and S78, "a failure must not vanish" (the lead ruled for the written rule on 2026-11-20)', () => {
    expect(policy({ state: 'failed', severity: 'error', action: true })).toEqual({ sticky: true });
    expect(policy({ state: 'unknown', severity: 'warning', action: true })).toEqual({ sticky: true });
    expect(policy({ kind: 'message', state: 'succeeded', severity: 'error', action: true })).toEqual({ sticky: true });
    expect(policy({ kind: 'message', state: 'succeeded', severity: 'warning', action: true })).toEqual({ sticky: true });
  });

  it('is sticky for a failure that has no action too: S77 says every failure sticks, and the mock\'s code, which timed it out after seven seconds, is not the rule', () => {
    expect(policy({ state: 'failed', severity: 'error', action: false })).toEqual({ sticky: true });
    expect(policy({ state: 'unknown', severity: 'warning', action: false })).toEqual({ sticky: true });
    expect(policy({ kind: 'message', state: 'succeeded', severity: 'error', action: false })).toEqual({ sticky: true });
    expect(policy({ state: 'failed', severity: 'error', initiator: 'system', action: false })).toEqual({ sticky: true });
  });

  it('stays timed for a warning with no action, and for an info or a success that has one: only a failure, an unknown outcome, an error and a warning that carries an action are sticky', () => {
    expect(policy({ kind: 'message', state: 'succeeded', severity: 'warning', action: false })).toEqual({ sticky: false });
    expect(policy({ kind: 'message', state: 'succeeded', severity: 'info', action: true })).toEqual({ sticky: false });
    expect(policy({ kind: 'message', state: 'succeeded', severity: 'success', action: true })).toEqual({ sticky: false });
  });

  it('is none for a muted source, whatever the outcome', () => {
    expect(policy({ state: 'failed', severity: 'error', action: true }, { muted: true })).toBeNull();
    expect(policy({ state: 'running' }, { muted: true })).toBeNull();
  });

  it('is none when the control that started the work shows it, whatever the outcome (S76, S77)', () => {
    expect(policy({ state: 'running' }, { inline: true })).toBeNull();
    expect(policy({ state: 'failed', severity: 'error', action: true }, { inline: true })).toBeNull();
    expect(policy({ state: 'succeeded', severity: 'success' }, { inline: true })).toBeNull();
  });

  it('is none for a calm completion of work the system started', () => {
    expect(policy({ state: 'succeeded', severity: 'success', initiator: 'system' })).toBeNull();
    expect(policy({ state: 'cancelled', initiator: 'system' })).toBeNull();
  });

  it('still raises a failure of work the system started: it needs the person', () => {
    expect(policy({ state: 'failed', severity: 'error', initiator: 'system', action: true })).toEqual({ sticky: true });
  });
});

describe('finishText: what the live region says when a record ends and has no toast (S86)', () => {
  const text = (extra: Partial<Parameters<typeof finishText>[0]>) => finishText({ kind: 'operation', state: 'succeeded', severity: 'success', title: 'Scaled orders-api', doneTitle: 'Scaled orders-api', failedHeadline: false, detail: '', targetLabel: '', ...extra });

  it('says a message with its word and its sentence', () => {
    expect(text({ kind: 'message', severity: 'warning', title: 'Rate limit is close', detail: '92% used' })).toBe('Warning: Rate limit is close. 92% used');
    expect(text({ kind: 'message', severity: 'info', title: 'Imported' })).toBe('Info: Imported');
  });

  it('says what succeeded as it was done; "Succeeded:" when the producer gave no done title', () => {
    expect(text({})).toBe('Scaled orders-api');
    expect(text({ doneTitle: '', title: 'Scaling orders-api' })).toBe('Succeeded: Scaling orders-api');
  });

  it('says an unknown outcome and where to check', () => {
    expect(text({ state: 'unknown', severity: 'warning', title: 'Reconnecting data source', targetLabel: 'Prometheus' })).toBe('Outcome unknown: Reconnecting data source. Check Prometheus');
    expect(text({ state: 'unknown', severity: 'warning', title: 'Reconnecting', targetLabel: '' })).toBe('Outcome unknown: Reconnecting. Check the target');
  });

  it('says a failure by what it could not do, or by "Failed:" when the title is not turned into one, with its cause', () => {
    expect(text({ state: 'failed', severity: 'error', title: 'Couldn\'t connect to prod-db', failedHeadline: true, detail: 'Nothing answered.' })).toBe('Couldn\'t connect to prod-db. Nothing answered.');
    expect(text({ state: 'failed', severity: 'error', title: 'Disk check', detail: 'Timed out' })).toBe('Failed: Disk check. Timed out');
    expect(text({ state: 'cancelled', severity: 'info', title: 'Backing up vm-104', detail: 'Stopped after 20 GiB' })).toBe('Canceled: Backing up vm-104. Stopped after 20 GiB');
  });
});

describe('announcement: what is said, and when, for a record that raises no toast (S86, S86a)', () => {
  const said = (extra: Partial<Facts>, change: Parameters<typeof announcement>[1], options: { muted?: boolean; quiet?: boolean } = {}) => announcement(facts(extra), change, { muted: options.muted ?? false, quiet: options.quiet ?? false });

  it('says the start of work once, and the finish once', () => {
    expect(said({}, { first: true, changed: false, restarted: false })).toEqual({ kind: 'start', urgent: false });
    expect(said({ state: 'succeeded', severity: 'success' }, { first: false, changed: true, restarted: false })).toEqual({ kind: 'finish', urgent: false });
    expect(said({ state: 'succeeded', severity: 'success' }, { first: true, changed: false, restarted: false })).toEqual({ kind: 'finish', urgent: false });
  });

  it('says nothing for what did not change: a tick is never announced', () => {
    expect(said({}, { first: false, changed: false, restarted: false })).toBeNull();
    expect(said({ state: 'succeeded', severity: 'success' }, { first: false, changed: false, restarted: false })).toBeNull();
  });

  it('says Retrying once when a record starts over', () => {
    expect(said({}, { first: false, changed: true, restarted: true })).toEqual({ kind: 'retry', urgent: false });
  });

  it('interrupts only for an error of work the user started', () => {
    expect(said({ state: 'failed', severity: 'error' }, { first: false, changed: true, restarted: false })?.urgent).toBe(true);
    expect(said({ state: 'failed', severity: 'error', initiator: 'system' }, { first: false, changed: true, restarted: false })?.urgent).toBe(false);
  });

  it('says nothing for a muted source, for work the system started (S86a), or for a calm automatic completion', () => {
    expect(said({}, { first: true, changed: false, restarted: false }, { muted: true })).toBeNull();
    expect(said({ initiator: 'system' }, { first: true, changed: false, restarted: false })).toBeNull();
    expect(said({ state: 'succeeded', severity: 'success', initiator: 'system' }, { first: false, changed: true, restarted: false }, { quiet: true })).toBeNull();
  });

  it('still says a failure of work the system started: it needs the person', () => {
    expect(said({ state: 'failed', severity: 'error', initiator: 'system' }, { first: false, changed: true, restarted: false })).toEqual({ kind: 'finish', urgent: false });
  });

  it('says a message when it is posted', () => {
    expect(said({ kind: 'message', state: 'succeeded', severity: 'info', initiator: 'system' }, { first: true, changed: false, restarted: false })).toEqual({ kind: 'finish', urgent: false });
  });
});
