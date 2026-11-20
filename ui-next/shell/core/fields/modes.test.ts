import { describe, expect, it } from 'vitest';
import { after, committed, deferred, makeForm, schemaOf, type ManualClock } from './testing';
import type { FieldState, FormState, RemoteResult, SubmitOutcome, SubmitPayload } from './types';

// Settings apply on change (S125, A6): a setting is a value and has no Save, no Apply, no unsaved state. Toggles, selects and choices apply at once; text, number, path, URL and secret
// fields commit on Enter or blur, never per keystroke: a value that fails stays in the field with its error while the APPLIED value stays in effect; Escape puts the applied value back;
// the lane says Saved for two seconds; a value that could not be applied says so and offers Retry. (`submit.test.ts` is the other model: a record, a form with actions.)

const field = (state: FormState, id: string): FieldState => {
  const found = state.fields.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`no field ${id}`);
  }

  return found;
};

const SETTINGS = schemaOf(
  { id: 'folding', kind: 'boolean', label: 'Folding', default: true },
  { id: 'lineNumbers', kind: 'select', label: 'Line numbers', default: 'on', options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }, { value: 'relative', label: 'Relative' }, { value: 'interval', label: 'Interval' }] },
  { id: 'fontSize', kind: 'number', label: 'Font size', default: 11, constraints: { min: 8, max: 32, integer: true } },
  { id: 'shell', kind: 'text', label: 'Default shell', default: '/bin/zsh' },
  { id: 'sources', kind: 'multiselect', label: 'Sources', default: ['alpha'], options: [{ value: 'alpha', label: 'Alpha' }, { value: 'beta', label: 'Beta' }] },
  { id: 'roots', kind: 'list', label: 'Roots', default: ['~/.config/app'], constraints: { item: 'path', absolute: true } },
  { id: 'inspect', kind: 'boolean', label: 'UI inspection', restart: true },
);

const apply = { mode: 'apply-on-change' as const };

describe('a value that applies at once: a switch, a choice, several choices, a list', () => {
  it('is handed to the host as one setting the moment it is set, and the applied value is the new one when the host has taken it', async () => {
    const { store, submits } = makeForm(SETTINGS, apply);
    const result = store.setValue('folding', false);
    expect(result).toMatchObject({ status: 'set' });
    expect(submits).toHaveLength(1);
    expect(submits[0]).toMatchObject({ mode: 'apply-on-change', values: { folding: false }, changed: ['folding'] });
    expect(submits[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(await committed(result)).toEqual({ status: 'applied' });
    expect(field(store.getSnapshot(), 'folding')).toMatchObject({ value: false, dirty: false });
    expect(store.getSnapshot().dirtyIds).toEqual([]);
  });

  it('says nothing about it: a switch shows its own new state, so there is no "Saved"', async () => {
    const { store } = makeForm(SETTINGS, apply);
    const result = store.setValue('folding', false);
    await committed(result);
    expect(field(store.getSnapshot(), 'folding').message).toBeUndefined();
    expect(field(store.getSnapshot(), 'lineNumbers').message).toBeUndefined();
  });

  it('is the same for a choice, several choices and a list, each handed over whole', async () => {
    const { store, submits } = makeForm(SETTINGS, apply);
    store.setValue('lineNumbers', 'off');
    store.setValue('sources', ['alpha', 'beta']);
    store.setValue('roots', ['~/.config/app', '/etc/app']);
    expect(submits.map((payload) => payload.values)).toEqual([{ lineNumbers: 'off' }, { sources: ['alpha', 'beta'] }, { roots: ['~/.config/app', '/etc/app'] }]);
  });

  it('is not handed over when it is wrong: the list that would break a rule stays in the control with its error and the applied list stays in effect', async () => {
    const { store, submits } = makeForm(SETTINGS, apply);
    const result = store.setValue('roots', ['relative/x']);
    expect(await committed(result)).toEqual({ status: 'invalid' });
    expect(submits).toEqual([]);
    expect(field(store.getSnapshot(), 'roots')).toMatchObject({ value: ['relative/x'], dirty: true, message: { kind: 'error', code: 'path' } });
  });

  it('keeps one change in flight per field: later changes wait, and only the latest is applied (nothing is applied out of order)', async () => {
    const gates = [deferred<SubmitOutcome>(), deferred<SubmitOutcome>(), deferred<SubmitOutcome>()];
    let at = 0;
    const { store, submits, clock } = makeForm(SETTINGS, { ...apply, submit: async () => gates[at++]?.promise });
    store.setValue('lineNumbers', 'off');
    store.setValue('lineNumbers', 'relative');
    store.setValue('lineNumbers', 'interval');
    expect(submits.map((payload) => payload.values.lineNumbers)).toEqual(['off']);
    gates[0]?.resolve({ ok: true });
    await clock.flush();
    expect(submits.map((payload) => payload.values.lineNumbers)).toEqual(['off', 'interval']);
    gates[1]?.resolve({ ok: true });
    await clock.flush();
    expect(field(store.getSnapshot(), 'lineNumbers')).toMatchObject({ value: 'interval', dirty: false });
  });
});

describe('a value that commits on Enter or blur: text, number, path, URL', () => {
  it('is not handed over while the user types, and is when the field is committed, and says Saved for two seconds', async () => {
    const { store, submits, clock } = makeForm(SETTINGS, apply);
    store.setValue('shell', '/bin/ba');
    store.setValue('shell', '/bin/bash');
    expect(submits).toEqual([]);
    expect(field(store.getSnapshot(), 'shell')).toMatchObject({ value: '/bin/bash', dirty: true });
    expect(await store.commit('shell')).toEqual({ status: 'applied' });
    expect(submits[0]).toMatchObject({ values: { shell: '/bin/bash' }, changed: ['shell'] });
    expect(field(store.getSnapshot(), 'shell')).toMatchObject({ dirty: false, message: { kind: 'saved', text: 'Saved.' } });
    await clock.advance(1999);
    expect(field(store.getSnapshot(), 'shell').message?.kind).toBe('saved');
    await clock.advance(1);
    expect(field(store.getSnapshot(), 'shell').message).toBeUndefined();
  });

  it('leaving the field commits it, as Enter does', async () => {
    const { store, submits } = makeForm(SETTINGS, apply);
    store.setValue('shell', '/bin/bash');
    expect(await store.blur('shell')).toEqual({ status: 'applied' });
    expect(submits).toHaveLength(1);
  });

  it('a value that is the applied one is not handed over: committing it is "same"', async () => {
    const { store, submits } = makeForm(SETTINGS, apply);
    expect(await store.commit('shell')).toEqual({ status: 'same' });
    store.setValue('shell', '/bin/bash');
    store.setValue('shell', '/bin/zsh');
    expect(await store.commit('shell')).toEqual({ status: 'same' });
    expect(submits).toEqual([]);
  });

  it('a value that fails stays in the field with its error, and the applied value stays in effect (A18)', async () => {
    const { store, submits } = makeForm(SETTINGS, apply);
    store.setValue('fontSize', 99);
    expect(await store.commit('fontSize')).toEqual({ status: 'invalid' });
    expect(submits).toEqual([]);
    expect(field(store.getSnapshot(), 'fontSize')).toMatchObject({ value: 99, dirty: true, message: { kind: 'error', text: 'Out of range. Use a value from 8 to 32.' } });
  });

  it('Escape puts the applied value back and clears the error', async () => {
    const { store } = makeForm(SETTINGS, apply);
    store.setValue('fontSize', 99);
    await store.commit('fontSize');
    expect(store.revert('fontSize')).toBe(true);
    expect(field(store.getSnapshot(), 'fontSize')).toMatchObject({ value: 11, dirty: false, issues: [] });
    expect(field(store.getSnapshot(), 'fontSize').message).toBeUndefined();
  });

  it('what depends on a value follows the APPLIED value, not the text being typed', async () => {
    const { store } = makeForm(schemaOf({ id: 'name', kind: 'text', default: '' }, { id: 'extra', kind: 'text', visibleWhen: { field: 'name', empty: false } }), apply);
    store.setValue('name', 'typed');
    expect(field(store.getSnapshot(), 'extra').visible).toBe(false);
    await store.commit('name');
    expect(field(store.getSnapshot(), 'extra').visible).toBe(true);
  });
});

describe('a value the host could not apply', () => {
  it('stays in the field, is not applied, and says so with Retry; retry hands it over again', async () => {
    let tries = 0;
    const { store, submits } = makeForm(SETTINGS, { ...apply, submit: () => {
      if (++tries === 1) {
        throw new Error('the store refused the write'); 
      } 
    } });
    store.setValue('shell', '/bin/bash');
    expect(await store.commit('shell')).toEqual({ status: 'failed' });
    expect(field(store.getSnapshot(), 'shell')).toMatchObject({ value: '/bin/bash', dirty: true, message: { kind: 'error', text: 'Couldn’t save this change. It isn’t applied.', retry: true } });
    expect(await store.retry('shell')).toEqual({ status: 'applied' });
    expect(submits).toHaveLength(2);
    expect(field(store.getSnapshot(), 'shell')).toMatchObject({ dirty: false, message: { kind: 'saved' } });
  });

  it('says what the host said when it said it as an apperror: its sentence, cleaned and bounded, and never its raw text', async () => {
    const host = JSON.stringify({ type: 'omniview:validation', title: 'Invalid request', status: 400, detail: 'The shell is not installed.', code: 'INVALID_REQUEST', recovery: 'correctRequest' });
    const { store } = makeForm(SETTINGS, { ...apply, submit: () => {
      throw new Error(host); 
    } });
    store.setValue('shell', '/bin/nope');
    await store.commit('shell');
    expect(field(store.getSnapshot(), 'shell').message).toMatchObject({ kind: 'error', text: 'The shell is not installed.' });
  });

  it('a rejection by field says it on that field, and offers no retry: the value is wrong, not the store', async () => {
    const { store } = makeForm(SETTINGS, { ...apply, submit: (): SubmitOutcome => ({ ok: false, errors: { shell: 'Choose an installed shell.' } }) });
    store.setValue('shell', '/bin/nope');
    expect(await store.commit('shell')).toEqual({ status: 'invalid' });
    const message = field(store.getSnapshot(), 'shell').message;
    expect(message).toMatchObject({ kind: 'error', text: 'Choose an installed shell.' });
    expect(message?.retry).toBeUndefined();
    store.setValue('shell', '/bin/bash');
    expect(field(store.getSnapshot(), 'shell').message).toBeUndefined();
  });
});

describe('a value the host checks before it is applied', () => {
  const GO = { id: 'go', kind: 'path', label: 'Go path', validate: { remote: 'exe' } };

  const validators = (answer: RemoteResult | 'throw', ms = 300) => (clock: ManualClock) => ({
    exe: async ({ signal }: { signal: AbortSignal }): Promise<RemoteResult> => {
      const result = await after(clock, ms, answer, signal);
      if (result === 'throw') {
        throw new Error('down');
      }

      return result;
    },
  });

  it('is applied when the check passes, with what the host said kept in the Saved line', async () => {
    const { store, submits, clock } = makeForm(schemaOf(GO), { ...apply, validators: validators({ valid: true, message: 'Go 1.24.2' }) });
    store.setValue('go', '/usr/local/go/bin/go');
    const done = store.commit('go');
    expect(submits).toEqual([]);
    expect(field(store.getSnapshot(), 'go').message?.kind).toBe('checking');
    await clock.advance(300);
    expect(await done).toEqual({ status: 'applied' });
    expect(submits).toHaveLength(1);
    expect(field(store.getSnapshot(), 'go').message).toEqual({ kind: 'saved', text: 'Saved. Go 1.24.2' });
  });

  it('is not applied when the check says it is wrong: the value stays, the applied value stays', async () => {
    const { store, submits, clock } = makeForm(schemaOf(GO), { ...apply, validators: validators({ valid: false, message: 'Select an existing Go executable file.' }) });
    store.setValue('go', '/nope');
    const done = store.commit('go');
    await clock.advance(300);
    expect(await done).toEqual({ status: 'invalid' });
    expect(submits).toEqual([]);
    expect(field(store.getSnapshot(), 'go')).toMatchObject({ value: '/nope', dirty: true, message: { kind: 'error' } });
  });

  it('is not applied when the check could not be made: "couldn\'t check", with Retry, and the value is not applied (S127)', async () => {
    const { store, submits, clock } = makeForm(schemaOf(GO), { ...apply, validators: validators('throw') });
    store.setValue('go', '/x');
    const done = store.commit('go');
    await clock.advance(300);
    expect(await done).toEqual({ status: 'unchecked' });
    expect(submits).toEqual([]);
    expect(field(store.getSnapshot(), 'go').message).toMatchObject({ kind: 'retry', retry: true });
  });

  it('is replaced when the user commits another value before it answers: the old answer is dropped, "stale"', async () => {
    const { store, submits, clock } = makeForm(schemaOf(GO), { ...apply, validators: validators({ valid: true }) });
    store.setValue('go', '/one');
    const first = store.commit('go');
    store.setValue('go', '/two');
    const second = store.commit('go');
    await clock.advance(300);
    expect(await first).toEqual({ status: 'stale' });
    expect(await second).toEqual({ status: 'applied' });
    expect(submits.map((payload) => payload.values.go)).toEqual(['/two']);
  });

  it('Escape drops a check that is running', async () => {
    const { store, submits, clock } = makeForm(schemaOf(GO), { ...apply, validators: validators({ valid: true }) });
    store.setValue('go', '/x');
    const done = store.commit('go');
    store.revert('go');
    await clock.advance(1000);
    expect(await done).toEqual({ status: 'stale' });
    expect(submits).toEqual([]);
    expect(field(store.getSnapshot(), 'go')).toMatchObject({ value: '', dirty: false });
  });
});

describe('reset to the default', () => {
  it('applies the default at once, and skips the check (it is the host\'s own default)', async () => {
    let asked = 0;
    const { store, submits } = makeForm(schemaOf({ id: 'shell', kind: 'path', default: '/bin/zsh', validate: { remote: 'exe' } }), { ...apply, initial: { shell: '/bin/bash' }, validators: { exe: () => {
      asked += 1; return { valid: true }; 
    } } });
    expect(field(store.getSnapshot(), 'shell')).toMatchObject({ modified: true, dirty: false });
    const result = store.reset('shell');
    expect(await committed(result)).toEqual({ status: 'applied' });
    expect(asked).toBe(0);
    expect(submits[0]?.values).toEqual({ shell: '/bin/zsh' });
    expect(field(store.getSnapshot(), 'shell')).toMatchObject({ value: '/bin/zsh', modified: false, dirty: false });
  });

  it('is only a change of the draft in a form that is submitted as a whole', () => {
    const { store, submits } = makeForm(schemaOf({ id: 'shell', kind: 'text', default: '/bin/zsh' }), { initial: { shell: '/bin/bash' } });
    expect(store.reset('shell')).toEqual({ status: 'set' });
    expect(field(store.getSnapshot(), 'shell')).toMatchObject({ value: '/bin/zsh', dirty: true });
    expect(submits).toEqual([]);
  });
});

describe('a setting that needs a restart (S129)', () => {
  it('is pending after it is applied, and says so until the app starts again; it is not pending when it is back to what the app started with', async () => {
    const { store } = makeForm(SETTINGS, apply);
    const on = store.setValue('inspect', true);
    await committed(on);
    expect(field(store.getSnapshot(), 'inspect')).toMatchObject({ pendingRestart: true, restart: 'app', message: { kind: 'restart', text: 'Restart required to apply.' } });
    expect(store.getSnapshot().pendingRestart).toEqual(['inspect']);
    const off = store.setValue('inspect', false);
    await committed(off);
    expect(field(store.getSnapshot(), 'inspect').pendingRestart).toBe(false);
    expect(store.getSnapshot().pendingRestart).toEqual([]);
  });

  it('is what the host says is pending, and not pending any more once the app was restarted', () => {
    const { store } = makeForm(SETTINGS, { ...apply, pendingRestart: ['inspect'] });
    expect(store.getSnapshot().pendingRestart).toEqual(['inspect']);
    expect(store.rebase({}, { restarted: true })).toBe(true);
    expect(store.getSnapshot().pendingRestart).toEqual([]);
  });
});

describe('what the host says is applied', () => {
  it('rebase takes the host\'s values as the applied ones: a field with no change of the user\'s follows, one with a draft keeps its draft', () => {
    const { store } = makeForm(SETTINGS, apply);
    store.setValue('shell', '/bin/bash');
    expect(store.rebase({ shell: '/bin/fish', fontSize: 14 })).toBe(true);
    expect(field(store.getSnapshot(), 'fontSize')).toMatchObject({ value: 14, dirty: false });
    expect(field(store.getSnapshot(), 'shell')).toMatchObject({ value: '/bin/bash', dirty: true });
    expect(store.rebase({ fontSize: 14 })).toBe(false);
  });

  it('the host may answer with the value it applied, which is not always the one it was given (a colour in capitals)', async () => {
    const { store } = makeForm(schemaOf({ id: 'c', kind: 'color', default: '' }), { ...apply, submit: (): SubmitOutcome => ({ ok: true, values: { c: '#3871E1' } }) });
    store.setValue('c', '#3871e1');
    await store.commit('c');
    expect(field(store.getSnapshot(), 'c')).toMatchObject({ value: '#3871E1', dirty: false });
  });
});

describe('what cannot be changed', () => {
  it('a locked field is not handed over, and a form has no submit', async () => {
    const { store, submits } = makeForm(SETTINGS, apply);
    store.setFormLock({ reason: 'Start the plugin to change this.', source: 'plugin', readonly: false });
    expect(store.setValue('folding', false)).toEqual({ status: 'refused', reason: 'locked' });
    expect(await store.commit('shell')).toEqual({ status: 'refused', reason: 'locked' });
    expect(await store.submit()).toEqual({ status: 'refused', reason: 'mode' });
    expect(submits).toEqual([]);
  });

  it('commit of an unknown field is refused', async () => {
    const { store } = makeForm(SETTINGS, apply);
    expect(await store.commit('missing')).toEqual({ status: 'refused', reason: 'unknown-field' });
  });
});

describe('what the host is handed, and by whom', () => {
  it('a payload is frozen and holds only the field that changed', async () => {
    const { store, submits } = makeForm(SETTINGS, apply);
    store.setValue('shell', '/bin/bash');
    store.setValue('fontSize', 12);
    await store.commit('shell');
    const payload: SubmitPayload | undefined = submits[0];
    expect(Object.keys(payload?.values ?? {})).toEqual(['shell']);
    expect(Object.isFrozen(payload?.values)).toBe(true);
  });
});
