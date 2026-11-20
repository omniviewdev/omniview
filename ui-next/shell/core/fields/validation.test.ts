import { describe, expect, it } from 'vitest';
import { makeForm, schemaOf } from './testing';
import type { FieldState, FormState } from './types';

// When a check is told (ch04 "Validation timing and outcome", VL1, DR1) and which ONE message the lane shows (S127: the lowest rank first: error, warning, checking, retry, saved, info,
// hint; a tie goes to the one written first). The checks themselves are `constraints.test.ts`; this file is what the store does with them.

const field = (state: FormState, id: string): FieldState => {
  const found = state.fields.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`no field ${id}`);
  }

  return found;
};

const NAME = { id: 'name', kind: 'text', label: 'Name', constraints: { required: true, minLength: 2, maxLength: 5, pattern: '[a-z]+' } };

describe('a check that is told at once', () => {
  it('an illegal character is an error as soon as it is there, and goes as soon as it is gone', () => {
    const { store } = makeForm(schemaOf({ id: 'p', kind: 'text', constraints: { allowedChars: 'digits' } }));
    store.setValue('p', '12a');
    expect(field(store.getSnapshot(), 'p').issues.map((issue) => issue.code)).toEqual(['chars']);
    expect(field(store.getSnapshot(), 'p').message).toMatchObject({ kind: 'error', code: 'chars' });
    expect(store.getSnapshot().invalidIds).toEqual(['p']);
    store.setValue('p', '12');
    expect(field(store.getSnapshot(), 'p').issues).toEqual([]);
    expect(store.getSnapshot().invalidIds).toEqual([]);
  });

  it('a value past its maximum is an error at once; one below its minimum is not told until the value is complete', async () => {
    const { store } = makeForm(schemaOf({ id: 'n', kind: 'number', constraints: { min: 10, max: 20 } }, { id: 't', kind: 'text', constraints: { maxLength: 3 } }));
    store.setValue('n', 99);
    expect(field(store.getSnapshot(), 'n').issues.map((issue) => issue.code)).toEqual(['max']);
    store.setValue('n', 5);
    expect(field(store.getSnapshot(), 'n').issues).toEqual([]);
    await store.blur('n');
    expect(field(store.getSnapshot(), 'n').issues.map((issue) => issue.code)).toEqual(['min']);
    store.setValue('t', 'abcd');
    expect(field(store.getSnapshot(), 't').issues.map((issue) => issue.code)).toEqual(['max-length']);
  });
});

describe('a check that waits for the value to be complete', () => {
  it('is not told while the value is being formed, and is told when the user leaves the field or commits it (blur must not steal focus: nothing here moves it)', async () => {
    const { store } = makeForm(schemaOf(NAME));
    store.setValue('name', 'AB1');
    expect(field(store.getSnapshot(), 'name')).toMatchObject({ issues: [], touched: false });
    expect(store.getSnapshot().invalidIds).toEqual([]);
    await store.blur('name');
    expect(field(store.getSnapshot(), 'name')).toMatchObject({ touched: true });
    expect(field(store.getSnapshot(), 'name').issues.map((issue) => issue.code)).toEqual(['pattern']);
    expect(store.getSnapshot().invalidIds).toEqual(['name']);
  });

  it('then follows the value as it changes: it goes the moment the value is right (clear the message when corrected)', async () => {
    const { store } = makeForm(schemaOf(NAME));
    store.setValue('name', 'AB1');
    await store.blur('name');
    store.setValue('name', 'ab');
    expect(field(store.getSnapshot(), 'name').issues).toEqual([]);
    store.setValue('name', 'AB');
    expect(field(store.getSnapshot(), 'name').issues.map((issue) => issue.code)).toEqual(['pattern']);
  });

  it('is told again from the start after a revert', async () => {
    const { store } = makeForm(schemaOf(NAME), { initial: { name: 'ok' } });
    store.setValue('name', 'AB1');
    await store.blur('name');
    store.revert('name');
    store.setValue('name', 'AB1');
    expect(field(store.getSnapshot(), 'name').issues).toEqual([]);
  });
});

describe('a missing required value', () => {
  it('is never told when the form opens, nor when an untouched empty field is passed: never mark untouched empty fields invalid on opening or blur', async () => {
    const { store } = makeForm(schemaOf(NAME, { id: 'other', kind: 'text', constraints: { required: true } }));
    expect(store.getSnapshot().invalidIds).toEqual([]);
    await store.blur('name');
    expect(field(store.getSnapshot(), 'name')).toMatchObject({ touched: true, issues: [] });
    expect(store.getSnapshot().invalidIds).toEqual([]);
  });

  it('is told when the user typed something, emptied it, and left the field', async () => {
    const { store } = makeForm(schemaOf(NAME));
    store.setValue('name', 'a');
    store.setValue('name', '');
    expect(field(store.getSnapshot(), 'name').issues).toEqual([]);
    await store.blur('name');
    expect(field(store.getSnapshot(), 'name').issues).toEqual([expect.objectContaining({ code: 'required', text: 'Name is required.' })]);
  });

  it('is told for every field when a submit is tried, whether or not it was touched (VL1: mark them all in their lanes)', async () => {
    const { store, submits } = makeForm(schemaOf(NAME, { id: 'other', kind: 'text', label: 'Other', constraints: { required: true } }), { send: 'all' });
    const result = await store.submit();
    expect(result).toEqual({ status: 'invalid', firstInvalid: 'name', invalid: ['name', 'other'] });
    expect(submits).toEqual([]);
    const state = store.getSnapshot();
    expect(state.invalidIds).toEqual(['name', 'other']);
    expect(state.firstInvalid).toBe('name');
    expect(state.submit).toMatchObject({ status: 'idle', attempted: true, attempts: 1 });
    expect(field(state, 'other').message).toMatchObject({ kind: 'error', text: 'Other is required.' });
  });
});

describe('a field that is not shown or cannot be edited', () => {
  it('is not checked: a hidden field, a read-only field and a field that is locked cannot hold a form back', async () => {
    const { store, submits } = makeForm(schemaOf(
      { id: 'hidden', kind: 'text', visibleWhen: false, constraints: { required: true } },
      { id: 'fact', kind: 'text', readonly: true, constraints: { required: true } },
      { id: 'locked', kind: 'text', enabledWhen: false, constraints: { required: true } },
      { id: 'a', kind: 'text', default: 'x' },
    ), { send: 'all' });
    expect(await store.submit()).toEqual({ status: 'succeeded' });
    expect(submits).toHaveLength(1);
    expect(store.getSnapshot().invalidIds).toEqual([]);
  });
});

describe('the sentences', () => {
  it('are at most 80 characters and carry a code, and a long one has its full text as detail for the tooltip', async () => {
    const long = `Name must start with a letter. ${'Use letters and digits only. '.repeat(10)}`;
    const { store } = makeForm(schemaOf({ id: 'n', kind: 'text', constraints: { pattern: '[a-z]+', messages: { pattern: long } } }));
    store.setValue('n', '1');
    await store.blur('n');
    const message = field(store.getSnapshot(), 'n').message;
    expect(message?.kind).toBe('error');
    expect([...(message?.text ?? '')].length).toBeLessThanOrEqual(80);
    expect(message?.code).toBe('pattern');
  });
});

describe('the one message of the lane (S127)', () => {
  it('is the hint when nothing else is said', () => {
    const { store } = makeForm(schemaOf({ id: 'a', kind: 'number', hint: '1 to 300 seconds' }, { id: 'b', kind: 'text' }));
    expect(field(store.getSnapshot(), 'a').message).toEqual({ kind: 'hint', text: '1 to 300 seconds' });
    expect(field(store.getSnapshot(), 'b').message).toBeUndefined();
  });

  it('is an info note over the hint, and a warning note over an info note: a warning never blocks', () => {
    const { store } = makeForm(schemaOf({
      id: 'url',
      kind: 'url',
      hint: 'An address.',
      notes: [
        { when: { field: 'url', startsWith: 'http://' }, kind: 'warning', text: 'Not encrypted. Use https:// unless this is a local test server.' },
        { when: true, kind: 'info', text: 'Picked up by the next request.' },
      ],
    }));
    expect(field(store.getSnapshot(), 'url').message).toEqual({ kind: 'info', text: 'Picked up by the next request.' });
    store.setValue('url', 'http://x.example');
    expect(field(store.getSnapshot(), 'url').message).toEqual({ kind: 'warning', text: 'Not encrypted. Use https:// unless this is a local test server.' });
    expect(field(store.getSnapshot(), 'url').issues).toEqual([]);
    expect(store.getSnapshot().invalidIds).toEqual([]);
  });

  it('is a restart note over the hint, and under a note: info against info is the one written first, and the note comes first', () => {
    const plain = makeForm(schemaOf({ id: 'a', kind: 'boolean', restart: true, hint: 'Hint.' }), { pendingRestart: ['a'] });
    expect(field(plain.store.getSnapshot(), 'a')).toMatchObject({ pendingRestart: true, restart: 'app', message: { kind: 'restart', text: 'Restart required to apply.' } });
    const noted = makeForm(schemaOf({ id: 'a', kind: 'boolean', restart: true, notes: [{ when: true, text: 'A note.' }] }), { pendingRestart: ['a'] });
    expect(field(noted.store.getSnapshot(), 'a').message).toEqual({ kind: 'info', text: 'A note.' });
  });

  it('is the reason a field cannot change over a hint and over a note (a disabled field says why, and nothing else)', () => {
    const { store } = makeForm(schemaOf({ id: 'a', kind: 'text', hint: 'Hint.', notes: [{ when: true, kind: 'warning', text: 'Warn.' }], enabledWhen: { ctx: 'on', equals: true, reason: 'Turn it on to change this.' } }));
    expect(field(store.getSnapshot(), 'a').message).toEqual({ kind: 'info', text: 'Turn it on to change this.' });
    store.setContext({ on: true });
    expect(field(store.getSnapshot(), 'a').message).toEqual({ kind: 'warning', text: 'Warn.' });
  });

  it('is an error over everything: a told issue outranks a warning, a note, a restart and a hint', async () => {
    const { store } = makeForm(schemaOf({ id: 'a', kind: 'text', hint: 'Hint.', restart: true, notes: [{ when: true, kind: 'warning', text: 'Warn.' }], constraints: { pattern: '[a-z]+' } }), { pendingRestart: ['a'] });
    expect(field(store.getSnapshot(), 'a').message?.kind).toBe('warning');
    store.setValue('a', '1');
    await store.blur('a');
    expect(field(store.getSnapshot(), 'a').message).toMatchObject({ kind: 'error', code: 'pattern' });
  });
});

describe('what is told aloud', () => {
  it('a new error raised when the user commits is announced once, as "{Field}: {message}" (S127)', async () => {
    const { store, announced } = makeForm(schemaOf(NAME));
    store.setValue('name', 'AB1');
    expect(announced).toEqual([]);
    await store.blur('name');
    expect(announced).toEqual(['Name: Not in the expected form. Check the value.']);
    await store.blur('name');
    expect(announced).toHaveLength(1);
    store.setValue('name', 'ab');
    store.setValue('name', 'AB');
    await store.blur('name');
    expect(announced).toHaveLength(2);
  });

  it('an error typed at once is not announced on every keystroke', () => {
    const { store, announced } = makeForm(schemaOf({ id: 'p', kind: 'text', constraints: { allowedChars: 'digits' } }));
    for (const text of ['1a', '1ab', '1abc']) {
      store.setValue('p', text);
    }

    expect(announced).toEqual([]);
  });

  it('an invalid submit says how many fields need attention and names the first (once)', async () => {
    const { store, announced } = makeForm(schemaOf(NAME, { id: 'other', kind: 'text', label: 'Other', constraints: { required: true } }), { send: 'all' });
    await store.submit();
    expect(announced).toEqual(['2 fields need attention. Name: Name is required.']);
  });
});
