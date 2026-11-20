import { afterEach, describe, expect, it, vi } from 'vitest';
import { after, deferred, makeForm, schemaOf, type ManualClock } from './testing';
import type { FieldState, FormState, OptionProvider, RemoteRequest, RemoteResult, RemoteValidator } from './types';

// Asynchronous work: the host's check of a value (`validate: { remote }`, the `Validate(scope, id, value)` the host already has) and an option provider for a set too large to list.
// Debounced, cancellable, a stale answer never shown, bounded in flight, a time limit; "couldn't check" is not "invalid". Time is the manual clock's.

const field = (state: FormState, id: string): FieldState => {
  const found = state.fields.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error(`no field ${id}`);
  }

  return found;
};

const GO = { id: 'go', kind: 'path', label: 'Go path', validate: { remote: 'exe', checking: 'Running go version…' } };

/** A check that takes `ms` of the clock and answers by the value; records what it was asked. */
function checker(answer: (value: unknown) => RemoteResult | 'throw', ms = 300) {
  const calls: RemoteRequest[] = [];
  const make = (clock: ManualClock): Readonly<Record<string, RemoteValidator>> => ({
    exe: async (request) => {
      calls.push(request);
      const result = await after(clock, ms, answer(request.value), request.signal);
      if (result === 'throw') {
        throw new Error('unreachable');
      }

      return result;
    },
  });
  return { calls, make };
}

describe('a check of the host, asked on commit (the default)', () => {
  it('is not asked while the user types, and asked once when the field is committed, with the value, the form\'s other values and a signal', async () => {
    const check = checker(() => ({ valid: true }));
    const { store, clock } = makeForm(schemaOf(GO, { id: 'other', kind: 'text', default: 'o' }), { validators: check.make });
    store.setValue('go', '/usr/local/go/bin/go');
    await clock.advance(5000);
    expect(check.calls).toEqual([]);
    const done = store.blur('go');
    expect(check.calls).toHaveLength(1);
    expect(check.calls[0]).toMatchObject({ id: 'go', value: '/usr/local/go/bin/go', values: { other: 'o' } });
    expect(check.calls[0]?.signal.aborted).toBe(false);
    expect(field(store.getSnapshot(), 'go')).toMatchObject({ validation: 'checking', message: { kind: 'checking', text: 'Running go version…', slow: false } });
    expect(store.getSnapshot().pendingIds).toEqual(['go']);
    await clock.advance(300);
    expect(await done).toEqual({ status: 'checked' });
    expect(field(store.getSnapshot(), 'go')).toMatchObject({ validation: 'valid', issues: [] });
    expect(store.getSnapshot().pendingIds).toEqual([]);
  });

  it('shows its loader only after a second (progress is for work that lasts more than a second)', async () => {
    const check = checker(() => ({ valid: true }), 5000);
    const { store, clock } = makeForm(schemaOf(GO), { validators: check.make });
    store.setValue('go', '/x');
    void store.blur('go');
    await clock.advance(999);
    expect(field(store.getSnapshot(), 'go').message).toMatchObject({ kind: 'checking', slow: false });
    await clock.advance(1);
    expect(field(store.getSnapshot(), 'go').message).toMatchObject({ kind: 'checking', slow: true });
  });

  it('what it says when the value is fine is kept as a note: "Go executable verified: 1.24.2."', async () => {
    const check = checker(() => ({ valid: true, code: 'go_version', message: 'Go executable verified: 1.24.2.' }));
    const { store, clock } = makeForm(schemaOf(GO), { validators: check.make });
    store.setValue('go', '/x');
    void store.blur('go');
    await clock.advance(300);
    expect(field(store.getSnapshot(), 'go').message).toEqual({ kind: 'info', text: 'Go executable verified: 1.24.2.' });
  });

  it('what it says when the value is not fine is the field\'s error, from the host, in the host\'s words (bounded and cleaned)', async () => {
    const check = checker(() => ({ valid: false, code: 'not_file', message: '\u001b[31mSelect an existing Go executable file.\u001b[0m' }));
    const { store, clock } = makeForm(schemaOf(GO), { validators: check.make });
    store.setValue('go', '/nope');
    const done = store.blur('go');
    await clock.advance(300);
    expect(await done).toEqual({ status: 'invalid' });
    const state = field(store.getSnapshot(), 'go');
    expect(state).toMatchObject({ validation: 'invalid', message: { kind: 'error', text: 'Select an existing Go executable file.', code: 'remote' } });
    expect(state.issues).toEqual([{ code: 'remote', text: 'Select an existing Go executable file.', severity: 'error', source: 'remote' }]);
    expect(store.getSnapshot().invalidIds).toEqual(['go']);
  });

  it('is not asked about a value the local checks refuse: a value that cannot be right is not sent', async () => {
    const check = checker(() => ({ valid: true }));
    const { store, clock } = makeForm(schemaOf({ ...GO, constraints: { absolute: true } }), { validators: check.make });
    store.setValue('go', 'relative');
    expect(await store.blur('go')).toEqual({ status: 'invalid' });
    await clock.advance(1000);
    expect(check.calls).toEqual([]);
  });

  it('is not asked about a field that is hidden or cannot be edited', async () => {
    const check = checker(() => ({ valid: true }));
    const { store, clock } = makeForm(schemaOf({ ...GO, id: 'a', visibleWhen: false }, { ...GO, id: 'b', enabledWhen: false }), { validators: check.make, send: 'all' });
    await store.submit();
    await clock.advance(1000);
    expect(check.calls).toEqual([]);
  });
});

describe('a check that cannot be made is not a check that failed', () => {
  it('a check that throws is "couldn\'t check", with Retry, and the value is not called invalid', async () => {
    const check = checker(() => 'throw');
    const { store, clock } = makeForm(schemaOf(GO), { validators: check.make });
    store.setValue('go', '/x');
    const done = store.blur('go');
    await clock.advance(300);
    expect(await done).toEqual({ status: 'unchecked' });
    expect(field(store.getSnapshot(), 'go')).toMatchObject({ validation: 'unreachable', issues: [], message: { kind: 'retry', text: 'Couldn’t check. Try again.', retry: true } });
    expect(store.getSnapshot().invalidIds).toEqual([]);
  });

  it('a check that does not answer in its time is the same, and its signal is aborted', async () => {
    const check = checker(() => ({ valid: true }), 60_000);
    const { store, clock } = makeForm(schemaOf(GO), { validators: check.make });
    store.setValue('go', '/x');
    void store.blur('go');
    await clock.advance(10_000);
    expect(field(store.getSnapshot(), 'go').validation).toBe('unreachable');
    expect(check.calls[0]?.signal.aborted).toBe(true);
  });

  it('a check that says it could not run (the host\'s `retry`) is the same, and keeps the host\'s sentence as detail', async () => {
    const check = checker(() => ({ valid: false, retry: true, message: 'Could not reach the marketplace.' }));
    const { store, clock } = makeForm(schemaOf(GO), { validators: check.make });
    store.setValue('go', '/x');
    void store.blur('go');
    await clock.advance(300);
    expect(field(store.getSnapshot(), 'go')).toMatchObject({ validation: 'unreachable', message: { kind: 'retry', retry: true, detail: 'Could not reach the marketplace.' } });
  });

  it('a field whose check is not registered is "couldn\'t check", never a crash', async () => {
    const { store } = makeForm(schemaOf(GO));
    store.setValue('go', '/x');
    expect(await store.blur('go')).toEqual({ status: 'unchecked' });
    expect(field(store.getSnapshot(), 'go').validation).toBe('unreachable');
  });

  it('retry asks again, whatever was remembered', async () => {
    let answers = 0;
    const check = checker(() => (++answers === 1 ? 'throw' : { valid: true }));
    const { store, clock } = makeForm(schemaOf(GO), { validators: check.make });
    store.setValue('go', '/x');
    void store.blur('go');
    await clock.advance(300);
    const again = store.retry('go');
    await clock.advance(300);
    expect(await again).toEqual({ status: 'checked' });
    expect(check.calls).toHaveLength(2);
    expect(field(store.getSnapshot(), 'go').validation).toBe('valid');
  });
});

describe('a newer value replaces an older check', () => {
  it('aborts the check that runs and never shows its answer, however late it comes', async () => {
    const gates = [deferred<RemoteResult>(), deferred<RemoteResult>()];
    const signals: AbortSignal[] = [];
    let at = 0;
    const { store, clock } = makeForm(schemaOf(GO), {
      validators: { exe: async (request) => {
        signals.push(request.signal); return gates[at++]?.promise ?? { valid: true }; 
      } },
    });
    store.setValue('go', '/old');
    void store.blur('go');
    store.setValue('go', '/new');
    void store.blur('go');
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false]);
    gates[1]?.resolve({ valid: true, message: 'New is fine.' });
    await clock.flush();
    gates[0]?.resolve({ valid: false, message: 'Old is wrong.' });
    await clock.flush();
    expect(field(store.getSnapshot(), 'go')).toMatchObject({ validation: 'valid', issues: [] });
    expect(field(store.getSnapshot(), 'go').message).toEqual({ kind: 'info', text: 'New is fine.' });
  });

  it('clears what was known about the old value the moment the value changes, so a stale verdict is never on screen for a new value', async () => {
    const check = checker(() => ({ valid: false, message: 'Wrong.' }));
    const { store, clock } = makeForm(schemaOf(GO), { validators: check.make });
    store.setValue('go', '/x');
    void store.blur('go');
    await clock.advance(300);
    expect(field(store.getSnapshot(), 'go').validation).toBe('invalid');
    store.setValue('go', '/xy');
    expect(field(store.getSnapshot(), 'go')).toMatchObject({ validation: 'idle', issues: [] });
  });

  it('does not ask twice about a value it already knows the answer to, and asks again for a value that changed and came back', async () => {
    const check = checker(() => ({ valid: true }));
    const { store, clock } = makeForm(schemaOf(GO), { validators: check.make });
    store.setValue('go', '/x');
    void store.blur('go');
    await clock.advance(300);
    await store.blur('go');
    expect(check.calls).toHaveLength(1);
    store.setValue('go', '/y');
    store.setValue('go', '/x');
    void store.blur('go');
    await clock.advance(300);
    expect(check.calls).toHaveLength(2);
  });

  it('revert aborts the check and forgets it', async () => {
    const check = checker(() => ({ valid: true }), 5000);
    const { store, clock } = makeForm(schemaOf(GO), { validators: check.make });
    store.setValue('go', '/x');
    void store.blur('go');
    store.revert('go');
    expect(check.calls[0]?.signal.aborted).toBe(true);
    expect(field(store.getSnapshot(), 'go')).toMatchObject({ validation: 'idle' });
    expect(field(store.getSnapshot(), 'go').message).toBeUndefined();
    await clock.advance(10_000);
    expect(field(store.getSnapshot(), 'go').validation).toBe('idle');
  });
});

describe('a check asked while the value changes (on: change)', () => {
  const LIVE = { id: 'host', kind: 'url', label: 'Host', validate: { remote: 'exe', on: 'change', debounce: 250 } };

  it('waits for the user to stop: one request, with the latest value, 250 ms after the last change', async () => {
    const check = checker(() => ({ valid: true }));
    const { store, clock } = makeForm(schemaOf(LIVE), { validators: check.make });
    for (const text of ['https://a', 'https://ab', 'https://abc.example']) {
      store.setValue('host', text);
      await clock.advance(100);
    }

    expect(check.calls).toEqual([]);
    await clock.advance(149);
    expect(check.calls).toEqual([]);
    await clock.advance(1);
    expect(check.calls.map((call) => call.value)).toEqual(['https://abc.example']);
  });

  it('is not asked while the local checks say the value is wrong', async () => {
    const check = checker(() => ({ valid: true }));
    const { store, clock } = makeForm(schemaOf(LIVE), { validators: check.make });
    store.setValue('host', 'not a url');
    await clock.advance(1000);
    expect(check.calls).toEqual([]);
  });

  it('asks again when a field it depends on changes', async () => {
    const check = checker(() => ({ valid: true }));
    const { store, clock } = makeForm(schemaOf({ ...LIVE, validate: { remote: 'exe', on: 'change', debounce: 100, dependsOn: ['region'] } }, { id: 'region', kind: 'text', default: 'a' }), { validators: check.make, initial: { host: 'https://x.example' } });
    store.setValue('host', 'https://y.example');
    await clock.advance(100);
    expect(check.calls).toHaveLength(1);
    store.setValue('region', 'b');
    expect(field(store.getSnapshot(), 'host').validation).toBe('idle');
    await clock.advance(100);
    expect(check.calls).toHaveLength(2);
    expect(check.calls[1]?.values).toMatchObject({ region: 'b' });
  });
});

describe('what a submit does about the checks', () => {
  it('waits for a check it has not made, and sends nothing when it says the value is wrong', async () => {
    const check = checker(() => ({ valid: false, message: 'Not a Go.' }));
    const { store, clock, submits } = makeForm(schemaOf(GO), { validators: check.make, send: 'all' });
    store.setValue('go', '/x');
    const done = store.submit();
    await clock.advance(300);
    expect(await done).toEqual({ status: 'invalid', firstInvalid: 'go', invalid: ['go'] });
    expect(submits).toEqual([]);
    expect(field(store.getSnapshot(), 'go').message).toMatchObject({ kind: 'error', text: 'Not a Go.' });
  });

  it('sends nothing when a check could not be made: a value the host could not check is not applied (S127)', async () => {
    const check = checker(() => 'throw');
    const { store, clock, submits } = makeForm(schemaOf(GO), { validators: check.make, send: 'all' });
    store.setValue('go', '/x');
    const done = store.submit();
    await clock.advance(300);
    expect(await done).toEqual({ status: 'invalid', firstInvalid: 'go', invalid: ['go'] });
    expect(submits).toEqual([]);
    expect(field(store.getSnapshot(), 'go')).toMatchObject({ validation: 'unreachable', message: { kind: 'retry' } });
  });

  it('sends when every check passed, without asking again about a value it already knew', async () => {
    const check = checker(() => ({ valid: true }));
    const { store, clock, submits } = makeForm(schemaOf(GO), { validators: check.make, send: 'all' });
    store.setValue('go', '/x');
    void store.blur('go');
    await clock.advance(300);
    expect(await store.submit()).toEqual({ status: 'succeeded' });
    expect(check.calls).toHaveLength(1);
    expect(submits).toHaveLength(1);
  });

  it('keeps at most four checks in flight and starts the rest as places free up', async () => {
    let running = 0;
    let peak = 0;
    const many = Array.from({ length: 10 }, (_, index) => ({ id: `f${String(index)}`, kind: 'text', default: 'v', validate: { remote: 'slow' } }));
    const { store, clock } = makeForm(schemaOf(...many), {
      send: 'all',
      validators: (given) => ({
        slow: async (request: RemoteRequest) => {
          running += 1;
          peak = Math.max(peak, running);
          try {
            return await after(given, 200, { valid: true }, request.signal);
          } finally {
            running -= 1;
          }
        },
      }),
    });
    const done = store.submit();
    await clock.advance(1000);
    expect(await done).toEqual({ status: 'succeeded' });
    expect(peak).toBe(4);
  });
});

describe('dispose', () => {
  it('aborts every check that runs and every request that waits, and shows nothing that comes later', async () => {
    const check = checker(() => ({ valid: true }), 5000);
    const { store, clock, seen } = makeForm(schemaOf(GO), { validators: check.make });
    store.setValue('go', '/x');
    void store.blur('go');
    const before = seen.length;
    store.dispose();
    expect(check.calls[0]?.signal.aborted).toBe(true);
    await clock.advance(10_000);
    expect(seen).toHaveLength(before);
    expect(clock.pending()).toBe(0);
  });
});

describe('an option provider, for a set too large to list', () => {
  const NS = { id: 'ns', kind: 'select', label: 'Region', options: { provider: 'regions', params: { scope: 'cluster' }, limit: 3 } };

  type Asked = { readonly query: string; readonly params: unknown; readonly limit: number; readonly values: Readonly<Record<string, unknown>>; readonly signal: AbortSignal };

  function provider(rows: (query: string) => ReadonlyArray<{ readonly value: string; readonly label: string }>, ms = 100) {
    const asked: Asked[] = [];
    const make = (clock: ManualClock): Readonly<Record<string, OptionProvider>> => ({
      regions: async (request) => {
        asked.push({ query: request.query, params: request.params, limit: request.limit, values: request.values, signal: request.signal });
        return after(clock, ms, { options: rows(request.query), total: 40 }, request.signal);
      },
    });
    return { asked, make };
  }

  it('is asked 150 ms after the last query, with the query, the field\'s params, a limit and the form\'s values; its answer is bounded and cleaned', async () => {
    const found = provider((query) => [
      { value: 'a', label: `${query}-a` },
      { value: 'b', label: '\u001b[1mB\u001b[0m' },
      { value: 'a', label: 'again' },
      { value: 'c', label: 'C' },
      { value: 'd', label: 'D' },
    ]);
    const { store, clock } = makeForm(schemaOf(NS, { id: 'other', kind: 'text', default: 'o' }), { providers: found.make });
    expect(field(store.getSnapshot(), 'ns').optionsState).toEqual({ status: 'idle', query: '' });
    expect(store.queryOptions('ns', 'pr')).toBe(true);
    expect(field(store.getSnapshot(), 'ns').optionsState).toMatchObject({ status: 'loading', query: 'pr' });
    await clock.advance(149);
    expect(found.asked).toEqual([]);
    await clock.advance(1);
    expect(found.asked).toHaveLength(1);
    expect(found.asked[0]).toMatchObject({ query: 'pr', params: { scope: 'cluster' }, limit: 3, values: { other: 'o' } });
    await clock.advance(100);
    const state = field(store.getSnapshot(), 'ns');
    expect(state.options).toEqual([{ value: 'a', label: 'pr-a' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }]);
    expect(state.optionsState).toEqual({ status: 'ready', query: 'pr', total: 40 });
  });

  it('a newer query aborts the one that runs, and an answer to an old query is never shown', async () => {
    const found = provider((query) => [{ value: query, label: query }], 300);
    const { store, clock } = makeForm(schemaOf(NS), { providers: found.make });
    store.queryOptions('ns', 'a');
    await clock.advance(150);
    store.queryOptions('ns', 'ab');
    expect(found.asked[0]?.signal.aborted).toBe(true);
    await clock.advance(150 + 300);
    expect(field(store.getSnapshot(), 'ns').options).toEqual([{ value: 'ab', label: 'ab' }]);
    expect(field(store.getSnapshot(), 'ns').optionsState).toMatchObject({ status: 'ready', query: 'ab' });
  });

  it('can be asked at once, for a list that opens', async () => {
    const found = provider(() => [{ value: 'x', label: 'X' }]);
    const { store } = makeForm(schemaOf(NS), { providers: found.make });
    store.queryOptions('ns', '', { immediate: true });
    expect(found.asked).toHaveLength(1);
  });

  it('is an error the user can try again when it throws or takes too long, and the field stays usable', async () => {
    const { store, clock } = makeForm(schemaOf(NS), { providers: { regions: async () => Promise.reject(new Error('down')) } });
    store.queryOptions('ns', 'a', { immediate: true });
    await clock.flush();
    expect(field(store.getSnapshot(), 'ns').optionsState).toEqual({ status: 'error', query: 'a', message: 'Couldn’t load the options. Try again.' });
    expect(field(store.getSnapshot(), 'ns').enabled).toBe(true);
    const slow = provider(() => [], 60_000);
    const second = makeForm(schemaOf(NS), { providers: slow.make });
    second.store.queryOptions('ns', 'a', { immediate: true });
    await second.clock.advance(5000);
    expect(field(second.store.getSnapshot(), 'ns').optionsState?.status).toBe('error');
    expect(slow.asked[0]?.signal.aborted).toBe(true);
  });

  it('knows the label of the value that is chosen, from what it has seen, so a list that is not open can still show it', async () => {
    const found = provider(() => [{ value: 'prod', label: 'production' }, { value: 'dev', label: 'development' }]);
    const { store, clock } = makeForm(schemaOf(NS), { providers: found.make });
    store.queryOptions('ns', '', { immediate: true });
    await clock.advance(100);
    store.setValue('ns', 'prod');
    store.queryOptions('ns', 'zzz', { immediate: true });
    await clock.advance(100);
    expect(field(store.getSnapshot(), 'ns').selected).toEqual([{ value: 'prod', label: 'production' }]);
  });

  it('is nothing for a field that has no provider, or does not exist', () => {
    const { store } = makeForm(schemaOf(NS, { id: 'plain', kind: 'select', options: [{ value: 'a', label: 'A' }] }));
    expect(store.queryOptions('plain', 'x')).toBe(false);
    expect(store.queryOptions('missing', 'x')).toBe(false);
    expect(field(store.getSnapshot(), 'plain').optionsState).toBeUndefined();
  });

  it('is not registered: the field says it could not load, and nothing throws', async () => {
    const { store, clock } = makeForm(schemaOf(NS));
    store.queryOptions('ns', '', { immediate: true });
    await clock.flush();
    expect(field(store.getSnapshot(), 'ns').optionsState?.status).toBe('error');
  });
});

describe('the platform\'s timers, which the store uses when it is given no scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks the host once the debounce has passed on the platform clock, and shows its answer', async () => {
    vi.useFakeTimers();
    const asked: unknown[] = [];
    const { store } = makeForm(schemaOf({ id: 'host', kind: 'url', validate: { remote: 'exe', on: 'change', debounce: 250 } }), {
      scheduler: undefined,
      validators: { exe: async (request) => {
        asked.push(request.value);
        return { valid: true, message: 'Reachable.' };
      } },
    });
    store.setValue('host', 'https://api.example');
    await vi.advanceTimersByTimeAsync(249);
    expect(asked).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked).toEqual(['https://api.example']);
    expect(field(store.getSnapshot(), 'host')).toMatchObject({ validation: 'valid', message: { text: 'Reachable.' } });
    store.dispose();
  });
});
