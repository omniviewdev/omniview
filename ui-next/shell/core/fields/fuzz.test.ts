import { describe, expect, it } from 'vitest';
import { after, makeForm, SENTINEL, type ManualClock } from './testing';
import type { FormState, Json, SubmitOutcome } from './types';

// Random operations against a form that has every kind of thing in it (conditions, a confirmation, a check of the host, an option provider, secrets, a restart), with the invariants of a
// sound snapshot checked after each one, and the sentinel searched for everywhere the model speaks. The tab and panel models have the same kind of test; the seeds are fixed so a
// failure is reproducible, and every failure names its seed and step.

const SCHEMA = {
  sections: [
    { id: 'a', fields: [
      { id: 'name', kind: 'text', default: 'x', constraints: { required: true, maxLength: 12, pattern: '[a-z0-9]*' } },
      { id: 'mode', kind: 'select', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] },
      { id: 'extra', kind: 'text', visibleWhen: { field: 'mode', equals: 'b' }, enabledWhen: { field: 'name', empty: false, reason: 'Name it first.' } },
      { id: 'port', kind: 'number', default: 80, constraints: { min: 1, max: 9999, integer: true }, restart: true },
      { id: 'on', kind: 'boolean' },
      { id: 'tags', kind: 'list', constraints: { unique: true } },
      { id: 'path', kind: 'path', validate: { remote: 'exe' }, constraints: { absolute: true } },
      { id: 'ns', kind: 'select', options: { provider: 'ns', limit: 3 } },
    ] },
    { id: 'dev', visibleWhen: { ctx: 'developer', equals: true }, fields: [
      { id: 'token', kind: 'secret', constraints: { minLength: 4 } },
      { id: 'again', kind: 'secret', constraints: { sameAs: 'token' } },
      { id: 'key', kind: 'text', sensitive: true },
      { id: 'future', kind: 'duration' },
    ] },
  ],
};

const IDS = ['name', 'mode', 'extra', 'port', 'on', 'tags', 'path', 'ns', 'token', 'again', 'key', 'future', 'nope'];

function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

function checkInvariants(state: FormState, context: string): void {
  expect(Object.isFrozen(state), context).toBe(true);
  expect(JSON.parse(JSON.stringify(state)), context).toEqual(state);
  expect(state.dirtyIds, context).toEqual(state.fields.filter((field) => field.dirty).map((field) => field.id));
  expect(state.invalidIds.every((id) => state.fields.some((field) => field.id === id && field.visible && field.issues.length > 0)), context).toBe(true);
  expect(state.pendingIds.every((id) => state.fields.find((field) => field.id === id)?.validation === 'checking'), context).toBe(true);
  expect(['idle', 'submitting', 'succeeded', 'failed']).toContain(state.submit.status);
  expect(state.fields.every((field) => (field.sensitive ? !Object.hasOwn(field, 'value') : true)), context).toBe(true);
  expect(state.fields.every((field) => field.message === undefined || field.message.text.length <= 400), context).toBe(true);
}

describe('random operations', () => {
  for (const seed of [1, 2, 3, 4]) {
    it(`keep every invariant of a snapshot and never show a secret (seed ${String(seed)})`, async () => {
      const random = generator(seed);
      const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
      const values: readonly unknown[] = ['', 'abc', 'ab-1', 'x'.repeat(30), 'a b', SENTINEL, 7, 0, -3, 99_999, 1.5, true, false, null, ['a', 'a'], ['/a', 'rel'], ['p'], { x: 1 }, 'b', 'a', '/usr/bin/x', 'https://x.example'];
      // A host echoes what it was handed: a rejection quotes the sentinel only when the sentinel was in the payload (a secret the user typed).
      const outcomes: ReadonlyArray<(echo: string) => SubmitOutcome> = [() => ({ ok: true }), (echo) => ({ ok: false, errors: { name: `Taken ${echo}` }, message: `no ${echo}` }), (echo) => {
        throw new Error(`down ${echo}`); 
      }];
      const fixture = makeForm(SCHEMA, {
        send: random() < 0.5 ? 'all' : 'changed',
        presence: { token: random() < 0.5 },
        submit: (payload) => pick(outcomes)(Object.values(payload.values).includes(SENTINEL) ? SENTINEL : 'nothing'),
        validators: (clock: ManualClock) => ({ exe: async ({ signal }) => {
          const found = await after(clock, 50 + Math.floor(random() * 400), random() < 0.7, signal); return { valid: found, message: found ? 'Fine.' : 'Not fine.' }; 
        } }),
        providers: (clock: ManualClock) => ({ ns: async ({ query, signal }) => after(clock, 100, [{ value: query, label: `${query}!` }], signal) }),
      });
      const { store, clock } = fixture;
      const pending: Array<Promise<unknown>> = [];
      for (let step = 0; step < 400; step += 1) {
        const context = `seed ${String(seed)} step ${String(step)}`;
        const id = pick(IDS);
        const roll = random();
        if (roll < 0.45) {
          const typed = pick(values);
          pending.push(Promise.resolve(store.setValue(id, typed === SENTINEL && !['token', 'again', 'key'].includes(id) ? 'plain' : typed)));
        } else if (roll < 0.55) {
          pending.push(store.blur(id));
        } else if (roll < 0.6) {
          pending.push(store.commit(id));
        } else if (roll < 0.66) {
          store.revert(random() < 0.5 ? id : undefined);
        } else if (roll < 0.7) {
          store.reset(id);
        } else if (roll < 0.74) {
          store.setContext({ developer: random() < 0.5 });
        } else if (roll < 0.78) {
          store.setFieldLock(id, random() < 0.5 ? { reason: 'Locked.', source: 'managed', readonly: random() < 0.5 } : undefined);
        } else if (roll < 0.8) {
          store.setFormLock(random() < 0.3 ? { reason: 'Off.', source: 'plugin', readonly: false } : undefined);
        } else if (roll < 0.86) {
          pending.push(store.submit());
        } else if (roll < 0.9) {
          store.rebase({ name: pick(['x', 'y']), port: pick([80, 81]) });
        } else if (roll < 0.94) {
          store.queryOptions('ns', pick(['', 'a', 'ab']), { immediate: random() < 0.5 });
        } else {
          await clock.advance(Math.floor(random() * 1500));
        }

        checkInvariants(store.getSnapshot(), context);
        const text = JSON.stringify([store.getSnapshot(), store.serialise(), store.stats(), fixture.announced, fixture.errors]);
        expect(text.includes(SENTINEL), context).toBe(false);
        expect(store.stats().secrets, context).toBeLessThanOrEqual(3);
      }

      await clock.advance(60_000);
      await Promise.allSettled(pending);
      checkInvariants(store.getSnapshot(), `seed ${String(seed)} end`);
      store.dispose();
      expect(store.stats().secrets).toBe(0);
      expect(clock.pending()).toBe(0);
    });
  }
});
