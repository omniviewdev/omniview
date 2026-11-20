import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, makeForm, schemaOf, SENTINEL, type Fixture } from './testing';
import type { FieldState, FormState, RemoteRequest, SubmitOutcome } from './types';

// A secret reaches NOTHING but the submit callback. The model never puts its value in a snapshot, a saved draft, a message, a log or a count; it says only whether one is set, and whether the
// user changed it. It holds the value from the moment it is typed until the host has taken it: a rejection keeps it (the user fixes the rest and sends again without typing it), and a success,
// a revert, a hidden field and a dispose drop it. These tests plant a sentinel no real secret looks like and look for it everywhere the model can speak: every snapshot it ever made (JSON), what
// it saves, what it announces, what it reports to its error hook, the console. A negative control (the last block) shows that the search itself finds a leak: a search that cannot fail proves nothing.

const OTHER = 'pw"with\\odd/chars\nand a newline';

/** True when the text holds the secret as it is, or as JSON writes it (quotes, backslashes and line breaks escaped). */
const holds = (haystack: string, secret: string): boolean => haystack.includes(secret) || haystack.includes(JSON.stringify(secret).slice(1, -1));

/** Everything the model has said, as text: each snapshot it made, the draft it would save, what it announced and reported, its counts. */
function everything(fixture: Fixture, extra: readonly unknown[] = []): string {
  return JSON.stringify([fixture.store.getSnapshot(), fixture.store.serialise(), fixture.store.stats(), fixture.seen, fixture.announced, fixture.errors, extra]);
}

function expectClean(fixture: Fixture, extra: readonly unknown[] = []): void {
  const text = everything(fixture, extra);
  expect(holds(text, SENTINEL), 'the sentinel was found').toBe(false);
  expect(holds(text, OTHER), 'the second sentinel was found').toBe(false);
}

const FORM = schemaOf(
  { id: 'name', kind: 'text', label: 'Name', default: 'api' },
  { id: 'token', kind: 'secret', label: 'Token', constraints: { minLength: 8 } },
  { id: 'again', kind: 'secret', label: 'Again', constraints: { sameAs: 'token' } },
  { id: 'apiKey', kind: 'text', sensitive: true, label: 'API key' },
  { id: 'pin', kind: 'number', sensitive: true, label: 'PIN' },
);

const field = (state: FormState, id: string): FieldState => {
  const found = state.fields.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`no field ${id}`);
  }

  return found;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what a view may know of a secret', () => {
  it('is whether one is set, and whether the user has typed (or cleared) one: never its value, never a default', () => {
    const fixture = makeForm(FORM, { presence: { token: true } });
    const state = fixture.store.getSnapshot();
    expect(field(state, 'token')).toMatchObject({ kind: 'secret', sensitive: true, secret: { presence: 'set', changed: false }, dirty: false, modified: true });
    expect(field(state, 'again').secret).toEqual({ presence: 'unset', changed: false });
    for (const id of ['token', 'again', 'apiKey', 'pin']) {
      expect(Object.hasOwn(field(state, id), 'value'), id).toBe(false);
      expect(Object.hasOwn(field(state, id), 'default'), id).toBe(false);
      expect(field(state, id).sensitive, id).toBe(true);
    }

    expect(field(state, 'name').secret).toBeUndefined();
  });

  it('says "changed" once the user has typed, and the field is dirty without a word of what it holds', () => {
    const fixture = makeForm(FORM);
    expect(fixture.store.setValue('token', SENTINEL)).toEqual({ status: 'set' });
    const state = fixture.store.getSnapshot();
    expect(field(state, 'token')).toMatchObject({ secret: { presence: 'unset', changed: true }, dirty: true, edited: true });
    expect(state.dirtyIds).toEqual(['token']);
    expect(state.dirty).toBe(true);
    expectClean(fixture);
  });

  it('says nothing changed when the user typed nothing, or cleared what they typed in a field that was never set', () => {
    const fixture = makeForm(FORM);
    expect(fixture.store.setValue('token', '')).toEqual({ status: 'noop' });
    fixture.store.setValue('token', 'abc');
    fixture.store.setValue('token', '');
    expect(field(fixture.store.getSnapshot(), 'token').secret).toEqual({ presence: 'unset', changed: false });
    expect(fixture.store.getSnapshot().dirty).toBe(false);
  });

  it('says "changed" when the user clears a secret that is saved: that is a change, and the value that clears it is empty', () => {
    const fixture = makeForm(FORM, { presence: { token: true } });
    fixture.store.setValue('token', '');
    expect(field(fixture.store.getSnapshot(), 'token').secret).toEqual({ presence: 'set', changed: true });
    expect(fixture.store.stats().secrets).toBe(1);
  });

  it('takes no secret from anywhere but the user: the applied values, a restored draft and a rebase carry none', () => {
    const fixture = makeForm(FORM, { initial: { token: SENTINEL, apiKey: SENTINEL, pin: 1234 }, draft: { token: SENTINEL, apiKey: SENTINEL } });
    fixture.store.rebase({ token: SENTINEL, apiKey: SENTINEL });
    expect(fixture.store.getSnapshot().dirty).toBe(false);
    expect(fixture.store.stats().secrets).toBe(0);
    expectClean(fixture);
  });

  it('is the same for a sensitive field that is not a "secret" kind: a text and a number', () => {
    const fixture = makeForm(FORM);
    fixture.store.setValue('apiKey', SENTINEL);
    fixture.store.setValue('pin', '123456');
    const state = fixture.store.getSnapshot();
    expect(field(state, 'apiKey')).toMatchObject({ kind: 'text', sensitive: true, secret: { presence: 'unset', changed: true } });
    expect(field(state, 'pin')).toMatchObject({ kind: 'number', sensitive: true, secret: { presence: 'unset', changed: true } });
    expectClean(fixture);
    expect(holds(everything(fixture), '123456')).toBe(false);
  });
});

describe('what the model says while a secret is held', () => {
  it('holds no value in any snapshot, saved draft, message, announcement or count, through every operation', async () => {
    const fixture = makeForm(FORM, { presence: { token: true }, send: 'all' });
    const { store } = fixture;
    const steps: ReadonlyArray<() => unknown> = [
      () => store.setValue('token', SENTINEL),
      () => store.setValue('again', 'different'),
      async () => store.blur('again'),
      () => store.setValue('again', SENTINEL),
      async () => store.blur('token'),
      () => store.setValue('apiKey', OTHER),
      () => store.setValue('name', `name ${SENTINEL}`.slice(0, 8)),
      () => store.setContext({ developer: true }),
      () => store.setFieldLock('token', { reason: 'Managed.', source: 'managed', readonly: true }),
      () => store.setFieldLock('token', undefined),
      () => store.rebase({ name: 'x' }),
      () => store.queryOptions('token', SENTINEL),
      () => store.draft().dirty(),
    ];
    for (const step of steps) {
      await step();
      expectClean(fixture);
    }
  });

  it('says its own problems without the value: a secret that is too short, or does not match, is told in words that name no value', async () => {
    const fixture = makeForm(FORM, { send: 'all' });
    fixture.store.setValue('token', 'qz7-ab');
    fixture.store.setValue('again', 'qz7-ac');
    await fixture.store.submit();
    expect(JSON.stringify(fixture.store.getSnapshot())).not.toContain('qz7');
    expect(field(fixture.store.getSnapshot(), 'token').message).toMatchObject({ kind: 'error', code: 'min-length' });
    expect(field(fixture.store.getSnapshot(), 'again').message).toMatchObject({ kind: 'error', code: 'same-as' });
  });

  it('keeps the typed secret when a submit is not valid, because nothing was handed over (VL1: the typed draft stays), and drops it when the host has taken it', async () => {
    const fixture = makeForm(schemaOf({ id: 'name', kind: 'text', constraints: { required: true } }, { id: 'token', kind: 'secret' }), { send: 'all' });
    fixture.store.setValue('token', SENTINEL);
    expect(await fixture.store.submit()).toMatchObject({ status: 'invalid' });
    expect(fixture.submits).toEqual([]);
    expect(fixture.store.stats().secrets).toBe(1);
    fixture.store.setValue('name', 'api');
    expect(await fixture.store.submit()).toEqual({ status: 'succeeded' });
    expect(fixture.submits[0]?.values).toEqual({ name: 'api', token: SENTINEL });
    expect(fixture.store.stats().secrets).toBe(0);
  });

  it('shows no logged value either: what the model reports to the console by default is cleaned of the value', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = makeForm(FORM, { send: 'all', onError: undefined, submit: () => {
      throw new Error(`down: ${SENTINEL}`); 
    } });
    let isArmed = true;
    fixture.store.subscribe(() => {
      if (isArmed) {
        throw new Error(`listener ${SENTINEL}`);
      }
    });
    fixture.store.setValue('token', SENTINEL);
    fixture.store.setValue('again', SENTINEL);
    isArmed = false;
    await fixture.store.submit();
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(holds(JSON.stringify(spy.mock.calls), SENTINEL)).toBe(false);
    expectClean(fixture);
  });

  it('reports what a listener threw without the value it was holding, and without the error object itself', () => {
    const fixture = makeForm(FORM);
    fixture.store.subscribe(() => {
      throw new Error(`listener ${SENTINEL}`); 
    });
    fixture.store.setValue('token', SENTINEL);
    expect(fixture.errors).toEqual([{ name: 'Error', message: 'listener •••', where: 'listener' }]);
  });
});

describe('what the host says back', () => {
  async function rejected(outcome: () => never | SubmitOutcome): Promise<Fixture> {
    const fixture = makeForm(FORM, { send: 'all', submit: outcome });
    fixture.store.setValue('token', SENTINEL);
    fixture.store.setValue('again', SENTINEL);
    fixture.store.setValue('apiKey', OTHER);
    await fixture.store.submit();
    return fixture;
  }

  it('may echo the secret in an apperror: it is scrubbed from the title, the sentence, the suggestions, the actions and the fields', async () => {
    const host = JSON.stringify({ type: 'omniview:validation', title: `Rejected ${SENTINEL}`, status: 400, detail: `Bad token ${SENTINEL} and ${OTHER}`, suggestions: [`Not ${SENTINEL}`], actions: [{ type: 'copy', label: 'Copy', target: SENTINEL }], fields: { token: `The value ${SENTINEL} is wrong.` } });
    const fixture = await rejected(() => {
      throw new Error(host); 
    });
    expectClean(fixture);
    expect(fixture.store.getSnapshot().issues[0]?.text).toBe('Bad token ••• and •••');
    expect(field(fixture.store.getSnapshot(), 'token').message?.text).toBe('The value ••• is wrong.');
  });

  it('may echo it in a rejection by field, and in a plain error', async () => {
    const byField = await rejected((): SubmitOutcome => ({ ok: false, errors: { token: `bad ${SENTINEL}` }, message: `Not saved: ${SENTINEL}` }));
    expectClean(byField);
    const plain = await rejected(() => {
      throw new Error(`bad ${SENTINEL}`); 
    });
    expectClean(plain);
  });

  it('may answer while the secret is still held: the model keeps it until the host has answered, and scrubs the answer', async () => {
    const gate = deferred<SubmitOutcome>();
    const fixture = makeForm(FORM, { send: 'all', submit: async () => gate.promise });
    fixture.store.setValue('token', SENTINEL);
    fixture.store.setValue('again', SENTINEL);
    const done = fixture.store.submit();
    expect(fixture.store.stats().secrets).toBe(2);
    gate.resolve({ ok: false, message: `no ${SENTINEL}` });
    await done;
    expectClean(fixture);
    expect(fixture.store.getSnapshot().issues[0]?.text).toBe('no •••');
  });

  it('scrubs a success the same way: a notice that quotes the secret says "•••" instead', async () => {
    const fixture = makeForm(FORM, { send: 'all', submit: (): SubmitOutcome => ({ ok: true, notice: { kind: 'info', text: `Saved ${SENTINEL}` } }) });
    fixture.store.setValue('token', SENTINEL);
    fixture.store.setValue('again', SENTINEL);
    expect(await fixture.store.submit()).toEqual({ status: 'succeeded' });
    expect(fixture.store.getSnapshot().submit.notice).toEqual({ kind: 'info', text: 'Saved •••' });
    expectClean(fixture);
  });

  it('says it is set after a success, and nothing else', async () => {
    const fixture = makeForm(FORM, { send: 'all' });
    fixture.store.setValue('token', SENTINEL);
    fixture.store.setValue('again', SENTINEL);
    expect(await fixture.store.submit()).toEqual({ status: 'succeeded' });
    expect(field(fixture.store.getSnapshot(), 'token').secret).toEqual({ presence: 'set', changed: false });
    expect(fixture.submits[0]?.changed).toEqual(['token', 'again']);
    expectClean(fixture);
  });
});

describe('after the host rejects what was typed (the lead\'s ruling: the typed secret is kept in memory, never shown)', () => {
  const REJECTIONS: ReadonlyArray<readonly [string, () => never | SubmitOutcome]> = [
    ['a rejection by field', (): SubmitOutcome => ({ ok: false, errors: { name: 'Taken.' }, message: 'Not saved.' })],
    ['an error the host sent', () => {
      throw new Error(JSON.stringify({ type: 'omniview:validation', title: 'Rejected', status: 400, detail: 'Not accepted.' }));
    }],
    ['a plain failure', () => {
      throw new Error('down');
    }],
  ];

  it.each(REJECTIONS)('keeps what was typed after %s: the user fixes the rest and sends again without typing it twice, and no output of the model holds it', async (_name, reject) => {
    let isRejecting = true;
    const fixture = makeForm(FORM, { send: 'all', submit: () => (isRejecting ? reject() : { ok: true }) });
    const { store } = fixture;
    store.setValue('token', SENTINEL);
    store.setValue('again', SENTINEL);
    store.setValue('apiKey', OTHER);
    expect(await store.submit()).toEqual({ status: 'failed' });
    const state = store.getSnapshot();
    for (const id of ['token', 'again', 'apiKey']) {
      expect(field(state, id).secret).toEqual({ presence: 'unset', changed: true });
    }

    expect(state.dirtyIds).toEqual(expect.arrayContaining(['token', 'again', 'apiKey']));
    expect(store.stats().secrets).toBe(3);
    // Held, and in no place the model speaks: the snapshot as JSON, what it would save, what it announced and reported.
    expect(holds(JSON.stringify(state), SENTINEL)).toBe(false);
    expect(holds(JSON.stringify(state), OTHER)).toBe(false);
    expectClean(fixture);
    // The user fixes the other field and sends again: the host is handed the same secrets, none typed again.
    isRejecting = false;
    store.setValue('name', 'api2');
    expect(await store.submit()).toEqual({ status: 'succeeded' });
    expect(fixture.submits).toHaveLength(2);
    expect(fixture.submits[1]?.values).toEqual({ name: 'api2', token: SENTINEL, again: SENTINEL, apiKey: OTHER });
    expect(field(store.getSnapshot(), 'token').secret).toEqual({ presence: 'set', changed: false });
    expect(store.stats().secrets).toBe(0);
    expectClean(fixture);
  });

  it('is dropped by a revert: Escape puts the whole form back, and the typed secret goes with the rest', async () => {
    const fixture = makeForm(FORM, { send: 'all', submit: () => {
      throw new Error('down');
    } });
    fixture.store.setValue('token', SENTINEL);
    fixture.store.setValue('again', SENTINEL);
    await fixture.store.submit();
    expect(fixture.store.stats().secrets).toBe(2);
    expect(fixture.store.revert()).toBe(true);
    expect(fixture.store.stats().secrets).toBe(0);
    expect(field(fixture.store.getSnapshot(), 'token').secret).toEqual({ presence: 'unset', changed: false });
    expectClean(fixture);
  });

  it('is dropped when the form is disposed', async () => {
    const fixture = makeForm(FORM, { send: 'all', submit: () => {
      throw new Error('down');
    } });
    fixture.store.setValue('token', SENTINEL);
    await fixture.store.submit();
    expect(fixture.store.stats().secrets).toBe(1);
    fixture.store.dispose();
    expect(fixture.store.stats().secrets).toBe(0);
    expectClean(fixture);
  });

  it('stays while the tab guard waits: a save that fails keeps it, and discard drops it', async () => {
    const fixture = makeForm(FORM, { send: 'all', submit: () => {
      throw new Error('down');
    } });
    fixture.store.setValue('token', SENTINEL);
    fixture.store.setValue('again', SENTINEL);
    const guard = fixture.store.draft();
    expect(await guard.save()).toMatchObject({ result: 'failed' });
    expect(guard.dirty()).toBe(true);
    expect(fixture.store.stats().secrets).toBe(2);
    guard.discard();
    expect(guard.dirty()).toBe(false);
    expect(fixture.store.stats().secrets).toBe(0);
    expectClean(fixture);
  });

  it('is kept in a form that applies on change too, so Retry hands the same secret over again, and it is dropped once the host has taken it', async () => {
    let isDown = true;
    const fixture = makeForm(FORM, { mode: 'apply-on-change', submit: () => {
      if (isDown) {
        throw new Error('down');
      }

      return { ok: true };
    } });
    const { store } = fixture;
    store.setValue('token', SENTINEL);
    expect(await store.commit('token')).toEqual({ status: 'failed' });
    expect(field(store.getSnapshot(), 'token')).toMatchObject({ secret: { presence: 'unset', changed: true }, message: { kind: 'error', retry: true } });
    expect(store.stats().secrets).toBe(1);
    expectClean(fixture);
    isDown = false;
    expect(await store.retry('token')).toEqual({ status: 'applied' });
    expect(fixture.submits.map((payload) => payload.values)).toEqual([{ token: SENTINEL }, { token: SENTINEL }]);
    expect(field(store.getSnapshot(), 'token').secret).toEqual({ presence: 'set', changed: false });
    expect(store.stats().secrets).toBe(0);
    expectClean(fixture);
  });

  it('does not drop a newer secret that was typed while an older one was being applied: it is the one handed over next', async () => {
    const gate = deferred<SubmitOutcome>();
    let calls = 0;
    const fixture = makeForm(FORM, { mode: 'apply-on-change', submit: async (): Promise<SubmitOutcome> => {
      calls += 1;
      return calls === 1 ? gate.promise : { ok: true };
    } });
    const { store } = fixture;
    store.setValue('token', SENTINEL);
    const first = store.commit('token');
    store.setValue('token', OTHER);
    const second = store.commit('token');
    gate.resolve({ ok: true });
    expect(await first).toEqual({ status: 'applied' });
    expect(await second).toEqual({ status: 'applied' });
    expect(fixture.submits.map((payload) => payload.values)).toEqual([{ token: SENTINEL }, { token: OTHER }]);
    expect(store.stats().secrets).toBe(0);
    expectClean(fixture);
  });
});

describe('where a secret goes', () => {
  it('to the submit callback, with the other values, and to nothing else', async () => {
    const fixture = makeForm(FORM, { send: 'all' });
    fixture.store.setValue('token', SENTINEL);
    fixture.store.setValue('again', SENTINEL);
    fixture.store.setValue('apiKey', OTHER);
    await fixture.store.submit();
    expect(fixture.submits).toHaveLength(1);
    expect(fixture.submits[0]?.values).toEqual({ name: 'api', token: SENTINEL, again: SENTINEL, apiKey: OTHER });
  });

  it('is not given to a check or a provider that another field asks for: their `values` are the visible, non-sensitive ones', async () => {
    const seen: RemoteRequest[] = [];
    const optionAsked: Array<Readonly<Record<string, unknown>>> = [];
    const fixture = makeForm(
      schemaOf(
        { id: 'name', kind: 'text', default: 'api', validate: { remote: 'check' } },
        { id: 'token', kind: 'secret' },
        { id: 'ns', kind: 'select', options: { provider: 'p' } },
      ),
      {
        validators: { check: (request) => {
          seen.push(request); return { valid: true }; 
        } },
        providers: { p: async (request) => {
          optionAsked.push(request.values); return Promise.resolve([]); 
        } },
      },
    );
    fixture.store.setValue('token', SENTINEL);
    fixture.store.setValue('name', 'api2');
    await fixture.store.blur('name');
    fixture.store.queryOptions('ns', '', { immediate: true });
    expect(seen).toHaveLength(1);
    expect(holds(JSON.stringify([seen.map((request) => request.values), optionAsked]), SENTINEL)).toBe(false);
    expect(Object.keys(seen[0]?.values ?? {})).toEqual(['name']);
  });

  it('is never asked of the host: a check declared on a secret is not kept (the schema rule), so no validator can be handed it', async () => {
    const asked: unknown[] = [];
    const fixture = makeForm(schemaOf({ id: 'token', kind: 'secret', validate: { remote: 'check' } }), { validators: { check: (request) => {
      asked.push(request); return { valid: true }; 
    } } });
    fixture.store.setValue('token', SENTINEL);
    await fixture.store.blur('token');
    expect(asked).toEqual([]);
    expect(field(fixture.store.getSnapshot(), 'token').spec.remote).toBe(false);
  });

  it('is not part of what is saved of a draft, and a saved draft that has one is not believed', () => {
    const fixture = makeForm(FORM);
    fixture.store.setValue('name', 'other');
    fixture.store.setValue('token', SENTINEL);
    fixture.store.setValue('apiKey', OTHER);
    expect(fixture.store.serialise()).toEqual({ version: 1, schema: 'form', values: { name: 'other' } });
  });

  it('is part of a condition only as "empty or not": what is shown follows whether a secret is set, and the condition can learn nothing else', () => {
    const fixture = makeForm(schemaOf(
      { id: 'token', kind: 'secret' },
      { id: 'next', kind: 'text', visibleWhen: { field: 'token', empty: false } },
      { id: 'probe', kind: 'text', visibleWhen: { field: 'token', equals: SENTINEL } },
    ));
    expect(field(fixture.store.getSnapshot(), 'next').visible).toBe(false);
    fixture.store.setValue('token', SENTINEL);
    expect(field(fixture.store.getSnapshot(), 'next').visible).toBe(true);
    expect(field(fixture.store.getSnapshot(), 'probe').visible).toBe(true);
    expectClean(fixture);
  });
});

describe('when a secret is dropped', () => {
  it('when the host has taken it (a submit, an apply on change)', async () => {
    const submit = makeForm(FORM, { send: 'all' });
    submit.store.setValue('token', SENTINEL);
    submit.store.setValue('again', SENTINEL);
    expect(submit.store.stats().secrets).toBe(2);
    await submit.store.submit();
    expect(submit.store.stats().secrets).toBe(0);
    const apply = makeForm(FORM, { mode: 'apply-on-change' });
    apply.store.setValue('token', SENTINEL);
    expect(apply.store.stats().secrets).toBe(1);
    await apply.store.commit('token');
    expect(apply.store.stats().secrets).toBe(0);
    expect(apply.submits[0]?.values).toEqual({ token: SENTINEL });
  });

  it('when the user reverts: one field, or all of them; and a later submit has none', async () => {
    const fixture = makeForm(FORM, { send: 'all' });
    fixture.store.setValue('token', SENTINEL);
    fixture.store.setValue('again', SENTINEL);
    fixture.store.revert('token');
    expect(fixture.store.stats().secrets).toBe(1);
    fixture.store.revert();
    expect(fixture.store.stats().secrets).toBe(0);
    expect(field(fixture.store.getSnapshot(), 'token').secret).toEqual({ presence: 'unset', changed: false });
    fixture.store.setValue('name', 'x');
    await fixture.store.submit();
    expect(fixture.submits[0]?.values).not.toHaveProperty('token');
  });

  it('when the form is disposed', () => {
    const fixture = makeForm(FORM);
    fixture.store.setValue('token', SENTINEL);
    expect(fixture.store.stats().secrets).toBe(1);
    fixture.store.dispose();
    expect(fixture.store.stats().secrets).toBe(0);
    expectClean(fixture);
  });

  it('when the field is hidden: a secret that is not shown is not kept, and is empty when the field comes back', () => {
    const fixture = makeForm(schemaOf({ id: 'method', kind: 'select', default: 'token', options: [{ value: 'token', label: 'Token' }, { value: 'basic', label: 'Basic' }] }, { id: 'token', kind: 'secret', visibleWhen: { field: 'method', equals: 'token' } }));
    fixture.store.setValue('token', SENTINEL);
    expect(fixture.store.stats().secrets).toBe(1);
    fixture.store.setValue('method', 'basic');
    expect(fixture.store.stats().secrets).toBe(0);
    fixture.store.setValue('method', 'token');
    expect(field(fixture.store.getSnapshot(), 'token').secret).toEqual({ presence: 'unset', changed: false });
  });

  it('on a reset: the default of a secret is nothing, so it clears what is saved', async () => {
    const fixture = makeForm(FORM, { presence: { token: true }, mode: 'apply-on-change' });
    const result = fixture.store.reset('token');
    expect(result).toMatchObject({ status: 'set' });
    await fixture.clock.flush();
    expect(fixture.submits[0]?.values).toEqual({ token: '' });
    expect(field(fixture.store.getSnapshot(), 'token').secret).toEqual({ presence: 'unset', changed: false });
  });
});

describe('the search for a leak', () => {
  it('finds a value that is there, as it is and as JSON writes it, so a clean result means something (a negative control)', () => {
    expect(holds(JSON.stringify({ leaked: SENTINEL }), SENTINEL)).toBe(true);
    expect(holds(JSON.stringify({ leaked: OTHER }), OTHER)).toBe(true);
    expect(holds(JSON.stringify({ fine: 'nothing here' }), SENTINEL)).toBe(false);
  });

  it('fails the check that uses it when a snapshot holds the value (the check is not vacuous)', () => {
    const fixture = makeForm(FORM);
    fixture.announced.push(`leak ${SENTINEL}`);
    expect(() => {
      expectClean(fixture); 
    }).toThrow(/sentinel was found/);
  });
});
