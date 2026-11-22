import { describe, expect, it } from 'vitest';
import type { FieldMessage } from '../../core/fields';
import { elsewhereNote, laneOf, resetLabel } from './words';

// The words the sheet says on a row: the model's message put in the kit lane's own vocabulary, the note that a setting was changed elsewhere under a draft, and the name of the reset control. Plain functions.

const message = (init: Partial<FieldMessage> & Pick<FieldMessage, 'kind'>): FieldMessage => ({ text: '', ...init });

describe('laneOf', () => {
  it('says nothing when the model says nothing and nothing was changed elsewhere', () => {
    expect(laneOf(undefined, undefined)).toBeUndefined();
  });

  it('passes the model\'s message on in the lane\'s words: a restart is the lane\'s info', () => {
    expect(laneOf(message({ kind: 'error', text: 'Not a port.', detail: 'Use 0 to 65535.' }), undefined)).toEqual({ kind: 'error', text: 'Not a port.', detail: 'Use 0 to 65535.' });
    expect(laneOf(message({ kind: 'restart', text: 'Restart required to apply.' }), undefined)).toEqual({ kind: 'info', text: 'Restart required to apply.' });
    expect(laneOf(message({ kind: 'retry', text: 'Couldn’t check. Try again.', retry: true }), undefined)).toEqual({ kind: 'retry', text: 'Couldn’t check. Try again.', retry: true });
    expect(laneOf(message({ kind: 'checking', text: 'Checking…' }), undefined)).toEqual({ kind: 'checking', text: 'Checking…' });
    expect(laneOf(message({ kind: 'saved', text: 'Saved.' }), undefined)).toEqual({ kind: 'saved', text: 'Saved.' });
  });

  it('says the note when the model has nothing that outranks it (a hint, a restart or nothing), and the model\'s message when it does', () => {
    const note = elsewhereNote('16');
    expect(laneOf(undefined, note)).toEqual({ kind: 'info', text: note });
    expect(laneOf(message({ kind: 'hint', text: 'A hint.' }), note)).toEqual({ kind: 'info', text: note });
    expect(laneOf(message({ kind: 'restart', text: 'Restart required to apply.' }), note)).toEqual({ kind: 'info', text: note });
    expect(laneOf(message({ kind: 'error', text: 'Not a port.' }), note)).toEqual({ kind: 'error', text: 'Not a port.' });
    expect(laneOf(message({ kind: 'checking', text: 'Checking…' }), note)).toEqual({ kind: 'checking', text: 'Checking…' });
  });
});

describe('elsewhereNote', () => {
  it('names the value and what Escape does, in at most 80 characters (S127)', () => {
    expect(elsewhereNote('16')).toBe('Changed elsewhere to “16”. Escape takes it.');
    expect(elsewhereNote(true)).toBe('Changed elsewhere to “on”. Escape takes it.');
    expect(elsewhereNote(false)).toBe('Changed elsewhere to “off”. Escape takes it.');
    expect(elsewhereNote('x'.repeat(200)).length).toBeLessThanOrEqual(80);
    expect(elsewhereNote('x'.repeat(200))).toContain('…');
  });

  it('says what it can of a value that is nothing', () => {
    expect(elsewhereNote('')).toBe('Changed elsewhere to nothing. Escape takes it.');
    expect(elsewhereNote(null)).toBe('Changed elsewhere to nothing. Escape takes it.');
  });
});

describe('resetLabel', () => {
  it('is the mock\'s: Reset {setting} to default', () => {
    expect(resetLabel('Font size')).toBe('Reset Font size to default');
  });
});
