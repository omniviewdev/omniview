import { describe, expect, it } from 'vitest';
import { view } from '../core/notices/testing';
import type { ActionView } from '../core/notices';
import { SEVERITY_WORD, TOAST_ACTIONS, actionIconOf, dismissLabel, glyphOf, joinOf, shownActions, summaryTitle, toastLabel } from './words';

// The words and glyphs of a toast (ch16 S79, S83, S86; the mock's `WORD`, `GLYPH`, `glyphOf`, `present` in shell-notify.js): severity is a glyph and a word, never colour alone; the second line joins the state's
// word and the sentence; at most two buttons, and only the ones that can be used.

const action = (extra: Partial<ActionView> = {}): ActionView => ({ id: 'a', kind: 'custom', label: 'Fix it', variant: 'default', icon: '', danger: false, disabled: '', route: undefined, command: undefined, ...extra });

describe('severity: a glyph and a word', () => {
  it('has a word for each of the four, the mock\'s', () => {
    expect(SEVERITY_WORD).toEqual({ info: 'Info', success: 'Success', warning: 'Warning', error: 'Error' });
  });

  it('draws the shipped status glyph of each severity', () => {
    expect(glyphOf(view({ severity: 'info' }))).toEqual({ name: 'status-info', busy: undefined });
    expect(glyphOf(view({ severity: 'success' }))).toEqual({ name: 'status-success', busy: undefined });
    expect(glyphOf(view({ severity: 'warning' }))).toEqual({ name: 'status-warning', busy: undefined });
    expect(glyphOf(view({ severity: 'error' }))).toEqual({ name: 'status-error', busy: undefined });
  });

  it('draws running work as the loader that turns, waiting work as the loader that stands, and canceled work as the neutral minus (the mock\'s X2)', () => {
    const work = { kind: 'operation' as const, severity: 'info' as const };
    expect(glyphOf(view({ ...work, state: 'running', active: true }))).toEqual({ name: 'loader-circle', busy: 'spin' });
    expect(glyphOf(view({ ...work, state: 'paused', active: true }))).toEqual({ name: 'loader-circle', busy: 'idle' });
    expect(glyphOf(view({ ...work, state: 'queued', active: true }))).toEqual({ name: 'loader-circle', busy: 'idle' });
    expect(glyphOf(view({ ...work, state: 'cancelled' }))).toEqual({ name: 'circle-minus', busy: 'idle' });
  });

  it('keeps the severity glyph of work that failed or needs attention, and of a message whatever its state', () => {
    expect(glyphOf(view({ kind: 'operation', severity: 'error', state: 'failed' })).name).toBe('status-error');
    expect(glyphOf(view({ kind: 'operation', severity: 'warning', state: 'unknown' })).name).toBe('status-warning');
    expect(glyphOf(view({ kind: 'message', severity: 'info', state: 'succeeded' })).name).toBe('status-info');
  });

  it('names a toast by its severity word and its title', () => {
    expect(toastLabel('error', 'Timed out')).toBe('Error: Timed out');
    expect(toastLabel('success', 'Snapshot created')).toBe('Success: Snapshot created');
  });
});

describe('the summary toast', () => {
  it('says how many more there are, in the mock\'s words', () => {
    expect(summaryTitle(3)).toBe('3 more notifications');
    expect(summaryTitle(2)).toBe('2 more notifications');
  });

  it('is correct for one, which the stack never hides alone but a count must not get wrong', () => {
    expect(summaryTitle(1)).toBe('1 more notification');
  });
});

describe('the second line', () => {
  it('joins the state\'s word and the sentence with a dot, or with a space after a word that ends a sentence', () => {
    expect(joinOf('Paused', 'Waiting for the queue')).toBe('dot');
    expect(joinOf('Outcome unknown.', 'Check prod-db.')).toBe('space');
  });

  it('joins nothing when one of the two is empty', () => {
    expect(joinOf('', 'The cluster did not answer.')).toBe('none');
    expect(joinOf('Canceled', '')).toBe('none');
  });
});

describe('the dismiss control', () => {
  it('is named for what it dismisses', () => {
    expect(dismissLabel('Timed out')).toBe('Dismiss: Timed out');
  });
});

describe('the buttons of a toast', () => {
  it('shows at most two, and only the ones that can be used: an action that cannot be is no button, the reason says why', () => {
    expect(TOAST_ACTIONS).toBe(2);
    const record = view({ actions: [action({ id: 'a' }), action({ id: 'b', disabled: 'Not available after restart' }), action({ id: 'c' }), action({ id: 'd' })] });
    expect(shownActions(record).map((shown) => shown.id)).toEqual(['a', 'c']);
  });

  it('shows none for a record with none', () => {
    expect(shownActions(view())).toEqual([]);
  });

  it('draws the glyph a producer declared when the kit has it, else the verb\'s own: Retry turns, Cancel crosses, Open and a custom action have none', () => {
    expect(actionIconOf(action({ kind: 'retry', label: 'Retry' }))).toBe('refresh');
    expect(actionIconOf(action({ kind: 'cancel', label: 'Cancel' }))).toBe('close');
    expect(actionIconOf(action({ kind: 'open', label: 'Open it' }))).toBeUndefined();
    expect(actionIconOf(action({ kind: 'custom' }))).toBeUndefined();
    expect(actionIconOf(action({ kind: 'custom', icon: 'copy' }))).toBe('copy');
    expect(actionIconOf(action({ kind: 'custom', icon: 'no-such-glyph' }))).toBeUndefined();
  });
});
