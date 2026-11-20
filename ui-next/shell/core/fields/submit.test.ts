import { describe, expect, it } from 'vitest';
import { deferred, makeForm, schemaOf, succeeded } from './testing';
import type { FieldState, FormState, SubmitOutcome, SubmitPayload } from './types';

// A record (a connection profile, a preset): a form committed as a whole with Apply (A6). The draft is kept until it is submitted; an invalid submit says what is wrong in every lane
// and sends nothing; a submit that is already running is not run twice; a rejection by the host puts its reasons on the fields and the sentence on the form, and the draft stays.

const field = (state: FormState, id: string): FieldState => {
  const found = state.fields.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`no field ${id}`);
  }

  return found;
};

const RECORD = schemaOf(
  { id: 'name', kind: 'text', label: 'Name', constraints: { required: true } },
  { id: 'url', kind: 'url', label: 'URL', default: 'https://example.com' },
  { id: 'tls', kind: 'boolean', label: 'Verify TLS', default: true },
  { id: 'note', kind: 'text', label: 'Note' },
  { id: 'fact', kind: 'text', label: 'Fact', readonly: true, default: 'fixed' },
  { id: 'extra', kind: 'text', label: 'Extra', default: 'e', visibleWhen: { field: 'tls', equals: false } },
);

describe('a submit', () => {
  it('hands the host the values that changed, with the mode and a signal, and says it is submitting while it waits', async () => {
    const gate = deferred<SubmitOutcome>();
    const { store, submits, clock } = makeForm(RECORD, { submit: async () => gate.promise });
    store.setValue('name', 'api');
    store.setValue('note', 'n');
    const done = store.submit();
    expect(submits).toHaveLength(1);
    expect(submits[0]).toMatchObject({ mode: 'explicit', values: { name: 'api', note: 'n' }, changed: ['name', 'note'] });
    expect(submits[0]?.signal.aborted).toBe(false);
    expect(store.getSnapshot().submit.status).toBe('submitting');
    expect(store.getSnapshot().canSubmit).toBe(false);
    expect(store.getSnapshot().submitBlocked).toBe('Working…');
    gate.resolve(succeeded);
    await clock.flush();
    expect(await done).toEqual({ status: 'succeeded' });
  });

  it('sends everything that is shown and can be edited when the form says so, and never a hidden field, a read-only fact or a kind it does not know', async () => {
    const { store, submits } = makeForm(schemaOf(...RECORD.sections[0]?.fields ?? [], { id: 'future', kind: 'duration' }), { send: 'all' });
    store.setValue('name', 'api');
    await store.submit();
    expect(submits[0]?.values).toEqual({ name: 'api', url: 'https://example.com', tls: true, note: '' });
    expect(submits[0]?.changed).toEqual(['name']);
  });

  it('sends a field that is shown again when its condition holds', async () => {
    const { store, submits } = makeForm(RECORD, { send: 'all' });
    store.setValue('name', 'api');
    store.setValue('tls', false);
    await store.submit();
    expect(submits[0]?.values).toMatchObject({ extra: 'e' });
  });

  it('is not run twice: a second submit while one runs is the same submit, the host is called once, and both callers get the one answer', async () => {
    const gate = deferred<SubmitOutcome>();
    const { store, submits, clock } = makeForm(RECORD, { submit: async () => gate.promise });
    store.setValue('name', 'api');
    const first = store.submit();
    const second = store.submit();
    expect(submits).toHaveLength(1);
    gate.resolve(succeeded);
    await clock.flush();
    expect(await first).toEqual({ status: 'succeeded' });
    expect(await second).toEqual({ status: 'succeeded' });
    expect(submits).toHaveLength(1);
    expect(store.getSnapshot().submit.attempts).toBe(1);
  });

  it('refuses every change to the draft while it runs, and does not lose the user\'s typing: they were refused, not dropped', async () => {
    const gate = deferred<SubmitOutcome>();
    const { store, clock } = makeForm(RECORD, { submit: async () => gate.promise });
    store.setValue('name', 'api');
    void store.submit();
    expect(store.setValue('name', 'other')).toEqual({ status: 'refused', reason: 'busy' });
    expect(store.revert()).toBe(false);
    expect(await store.commit('name')).toEqual({ status: 'refused', reason: 'busy' });
    gate.resolve(succeeded);
    await clock.flush();
    expect(field(store.getSnapshot(), 'name').value).toBe('api');
  });

  it('is a noop when nothing changed and the form sends only what changed: the host is not called', async () => {
    const { store, submits } = makeForm(RECORD);
    expect(await store.submit()).toEqual({ status: 'noop' });
    expect(submits).toEqual([]);
    expect(store.getSnapshot().submit.attempts).toBe(0);
  });

  it('is refused when the form is locked, and says nothing was sent', async () => {
    const { store, submits } = makeForm(RECORD);
    store.setValue('name', 'api');
    store.setFormLock({ reason: 'Start the plugin to change this.', source: 'plugin', readonly: false });
    expect(await store.submit()).toEqual({ status: 'refused', reason: 'locked' });
    expect(submits).toEqual([]);
  });
});

describe('a submit that is not valid', () => {
  it('says what is wrong in every lane, sends nothing, keeps the draft, and names the first field to focus (VL1)', async () => {
    const { store, submits } = makeForm(RECORD, { send: 'all' });
    store.setValue('url', 'not a url');
    expect(await store.submit()).toEqual({ status: 'invalid', firstInvalid: 'name', invalid: ['name', 'url'] });
    expect(submits).toEqual([]);
    const state = store.getSnapshot();
    expect(state.firstInvalid).toBe('name');
    expect(state.submit).toMatchObject({ status: 'idle', attempted: true, attempts: 1 });
    expect(field(state, 'name').message).toMatchObject({ kind: 'error', text: 'Name is required.' });
    expect(field(state, 'url')).toMatchObject({ value: 'not a url', message: { kind: 'error', code: 'url' } });
  });

  it('each try is counted, and the lanes follow the draft as it is fixed', async () => {
    const { store, submits } = makeForm(RECORD, { send: 'all' });
    await store.submit();
    await store.submit();
    expect(store.getSnapshot().submit.attempts).toBe(2);
    store.setValue('name', 'api');
    expect(store.getSnapshot().invalidIds).toEqual([]);
    expect(await store.submit()).toEqual({ status: 'succeeded' });
    expect(submits).toHaveLength(1);
  });
});

describe('a submit that succeeded', () => {
  it('makes what was sent the applied values: nothing is dirty, and the form is as it was when it opened', async () => {
    const { store } = makeForm(RECORD);
    store.setValue('name', 'api');
    store.setValue('tls', false);
    expect(await store.submit()).toEqual({ status: 'succeeded' });
    const state = store.getSnapshot();
    expect(state.dirty).toBe(false);
    expect(state.dirtyIds).toEqual([]);
    expect(state.submit).toMatchObject({ status: 'succeeded', attempted: false, attempts: 1 });
    expect(field(state, 'name')).toMatchObject({ value: 'api', dirty: false, edited: true });
    expect(state.canSubmit).toBe(false);
  });

  it('is over when the user edits again: the next change is a new draft', async () => {
    const { store } = makeForm(RECORD);
    store.setValue('name', 'api');
    await store.submit();
    store.setValue('name', 'api2');
    expect(store.getSnapshot().submit.status).toBe('idle');
    expect(store.getSnapshot().dirtyIds).toEqual(['name']);
  });

  it('takes what the host says about a success: the values it applied, and a notice ("saved, but not applied")', async () => {
    const { store } = makeForm(schemaOf({ id: 'c', kind: 'color' }), {
      submit: (): SubmitOutcome => ({ ok: true, values: { c: '#3871E1' }, notice: { kind: 'warning', text: 'Saved, but not applied. Restart Omniview.' } }),
    });
    store.setValue('c', '#3871e1');
    await store.submit();
    expect(field(store.getSnapshot(), 'c')).toMatchObject({ value: '#3871E1', dirty: false });
    expect(store.getSnapshot().submit.notice).toEqual({ kind: 'warning', text: 'Saved, but not applied. Restart Omniview.' });
  });

  it('a setting that needs a restart is pending after it was submitted', async () => {
    const { store } = makeForm(schemaOf({ id: 'inspect', kind: 'boolean', restart: 'plugin' }));
    store.setValue('inspect', true);
    await store.submit();
    expect(store.getSnapshot().pendingRestart).toEqual(['inspect']);
    expect(field(store.getSnapshot(), 'inspect')).toMatchObject({ restart: 'plugin', pendingRestart: true });
  });
});

describe('a submit that the host rejected', () => {
  it('puts the reasons on the fields they name and the sentence on the form, keeps the draft, and says the submit failed', async () => {
    const { store } = makeForm(RECORD, { submit: (): SubmitOutcome => ({ ok: false, errors: { name: 'That name is taken.', missing: 'No such field.' }, message: 'The connection was not saved.' }) });
    store.setValue('name', 'api');
    store.setValue('note', 'keep me');
    expect(await store.submit()).toEqual({ status: 'failed' });
    const state = store.getSnapshot();
    expect(state.submit.status).toBe('failed');
    expect(field(state, 'name')).toMatchObject({ value: 'api', dirty: true, message: { kind: 'error', text: 'That name is taken.' }, issues: [{ code: 'rejected', text: 'That name is taken.', source: 'host', severity: 'error' }] });
    expect(field(state, 'note').value).toBe('keep me');
    expect(state.invalidIds).toEqual(['name']);
    expect(state.firstInvalid).toBe('name');
    expect(state.issues).toHaveLength(1);
    expect(state.issues[0]).toMatchObject({ kind: 'error', text: 'The connection was not saved.' });
    expect(state.issues[0]?.suggestions).toEqual(['missing: No such field.']);
    expect(state.dirty).toBe(true);
  });

  it('is shown as the host said it when it said it as an apperror: its title and sentence, its suggestions, its recovery, its request id', async () => {
    const host = JSON.stringify({ type: 'omniview:validation', title: 'Invalid request', status: 400, detail: 'The URL is not reachable.', code: 'INVALID_REQUEST', requestId: 'abc-123', recovery: 'correctRequest', suggestions: ['Check the address.'] });
    const { store } = makeForm(RECORD, { submit: () => {
      throw new Error(host); 
    } });
    store.setValue('name', 'api');
    expect(await store.submit()).toEqual({ status: 'failed' });
    expect(store.getSnapshot().issues).toEqual([{ kind: 'error', title: 'Invalid request', text: 'The URL is not reachable.', suggestions: ['Check the address.'], actions: [], recovery: 'correctRequest', requestId: 'abc-123', code: 'INVALID_REQUEST' }]);
  });

  it('is a generic sentence, never the raw message, when the error is not one the host made', async () => {
    const { store } = makeForm(RECORD, { submit: () => {
      throw new TypeError('x.y is not a function at /Users/ana/work/file.ts:12'); 
    } });
    store.setValue('name', 'api');
    await store.submit();
    const [issue] = store.getSnapshot().issues;
    expect(issue?.text).toBe('The change could not be applied.');
    expect(JSON.stringify(store.getSnapshot())).not.toContain('/Users/ana');
  });

  it('is cleared as the user fixes it: editing a field clears what the host said about it, and editing anything clears the form\'s sentence', async () => {
    const { store } = makeForm(RECORD, { submit: (): SubmitOutcome => ({ ok: false, errors: { name: 'Taken.' }, message: 'Not saved.' }) });
    store.setValue('name', 'api');
    await store.submit();
    store.setValue('note', 'n');
    expect(store.getSnapshot().issues).toEqual([]);
    expect(store.getSnapshot().submit.status).toBe('idle');
    expect(field(store.getSnapshot(), 'name').issues.map((issue) => issue.code)).toEqual(['rejected']);
    store.setValue('name', 'api2');
    expect(field(store.getSnapshot(), 'name').issues).toEqual([]);
    expect(store.getSnapshot().invalidIds).toEqual([]);
  });

  it('can be tried again: the same draft is sent again', async () => {
    let tries = 0;
    const { store, submits } = makeForm(RECORD, { submit: () => {
      if (++tries === 1) {
        throw new Error('down'); 
      } 
    } });
    store.setValue('name', 'api');
    expect(await store.submit()).toEqual({ status: 'failed' });
    expect(await store.submit()).toEqual({ status: 'succeeded' });
    expect(submits.map((payload) => payload.values.name)).toEqual(['api', 'api']);
    expect(store.getSnapshot().submit.attempts).toBe(2);
  });

  it('an error the host marks "retry" is offered as an action the form can take', async () => {
    const host = JSON.stringify({ type: 'omniview:internal', title: 'Unavailable', status: 503, detail: 'Try again in a moment.', actions: [{ type: 'retry', label: 'Retry' }] });
    const { store } = makeForm(RECORD, { submit: () => {
      throw new Error(host); 
    } });
    store.setValue('name', 'api');
    await store.submit();
    expect(store.getSnapshot().issues[0]?.actions).toEqual([{ type: 'retry', label: 'Retry' }]);
  });
});

describe('dispose while a submit runs', () => {
  it('aborts its signal and drops what it answers: nothing changes after the store is gone', async () => {
    const gate = deferred<SubmitOutcome>();
    const { store, submits, clock, seen } = makeForm(RECORD, { submit: async () => gate.promise });
    store.setValue('name', 'api');
    const done = store.submit();
    const before = seen.length;
    store.dispose();
    expect(submits[0]?.signal.aborted).toBe(true);
    gate.resolve(succeeded);
    await clock.flush();
    expect(await done).toEqual({ status: 'refused', reason: 'disposed' });
    expect(seen).toHaveLength(before);
  });
});

describe('the draft as a tab guards it (S27)', () => {
  it('is dirty while a value differs from the applied one, and discard puts everything back', () => {
    const { store } = makeForm(RECORD);
    const guard = store.draft();
    expect(guard.dirty()).toBe(false);
    store.setValue('name', 'api');
    expect(guard.dirty()).toBe(true);
    guard.discard();
    expect(guard.dirty()).toBe(false);
    expect(field(store.getSnapshot(), 'name').value).toBe('');
  });

  it('saves when it is valid, answering `saved`, and a clean draft saves as nothing to do', async () => {
    const { store, submits } = makeForm(RECORD);
    const guard = store.draft();
    expect(await guard.save()).toBe('saved');
    expect(submits).toEqual([]);
    store.setValue('name', 'api');
    expect(await guard.save()).toBe('saved');
    expect(submits).toHaveLength(1);
  });

  it('answers `invalid` with the reason when it is not, keeps the draft, and saves the second time when the user has fixed it (the harness case)', async () => {
    const { store } = makeForm(RECORD);
    const guard = store.draft();
    store.setValue('note', 'x');
    expect(await guard.save()).toEqual({ result: 'invalid', reason: 'Name is required.' });
    expect(guard.dirty()).toBe(true);
    store.setValue('name', 'api');
    expect(await guard.save()).toBe('saved');
  });

  it('answers `failed` with the host\'s sentence when the host rejected it, and keeps the draft', async () => {
    const { store } = makeForm(RECORD, { submit: (): SubmitOutcome => ({ ok: false, message: 'The store is full.' }) });
    const guard = store.draft();
    store.setValue('name', 'api');
    expect(await guard.save()).toEqual({ result: 'failed', reason: 'The store is full.' });
    expect(guard.dirty()).toBe(true);
  });
});

describe('what a payload is', () => {
  it('is frozen, and is not the draft: changing it changes nothing in the form', async () => {
    const { store, submits } = makeForm(RECORD);
    store.setValue('name', 'api');
    await store.submit();
    const payload: SubmitPayload | undefined = submits[0];
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload?.values)).toBe(true);
  });
});
