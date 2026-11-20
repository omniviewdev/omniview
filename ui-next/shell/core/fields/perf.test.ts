import { describe, expect, it } from 'vitest';
import { compileSchema } from './schema';
import { makeForm } from './testing';
import type { FormState } from './types';

// Performance: a form of 500 fields. One keystroke is bounded work: the field's own check, the fields that must equal it, and the conditions that read it (counted, not timed), and the
// fields that did not change keep their identity so a view draws only the rows that did. The time bound is generous (a laptop measures a tenth of it): a shared runner is several times
// slower, and the fastest of three runs is compared with the bound, as the tab model's and the palette's performance tests do.

const CONTROLLERS = 20;

/** 20 controllers, each read by 5 fields; 360 texts, 30 numbers, 50 switches, 40 more texts that read nothing: 500 fields. */
function bigSchema(): unknown {
  const fields: Array<Record<string, unknown>> = [];
  for (let at = 0; at < CONTROLLERS; at += 1) {
    fields.push({ id: `c${String(at)}`, kind: 'text', label: `Controller ${String(at)}`, constraints: { maxLength: 40 } });
  }

  for (let at = 0; at < 100; at += 1) {
    fields.push({ id: `d${String(at)}`, kind: 'text', visibleWhen: { field: `c${String(at % CONTROLLERS)}`, empty: false }, constraints: { required: true, maxLength: 20, pattern: '[a-z0-9 ]*' } });
  }

  for (let at = 0; at < 300; at += 1) {
    fields.push({ id: `t${String(at)}`, kind: 'text', constraints: { required: at % 2 === 0, maxLength: 30 } });
  }

  for (let at = 0; at < 30; at += 1) {
    fields.push({ id: `n${String(at)}`, kind: 'number', default: 5, constraints: { min: 1, max: 100, integer: true } });
  }

  for (let at = 0; at < 50; at += 1) {
    fields.push({ id: `b${String(at)}`, kind: 'boolean' });
  }

  return { sections: [{ fields }] };
}

const fastest = (run: () => void, tries = 3): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }

  return best;
};

const sameObjects = (a: FormState, b: FormState): number => a.fields.filter((field, at) => field === b.fields[at]).length;

describe('a form of 500 fields', () => {
  it('has 500 fields, compiles and starts inside a bound', () => {
    const compiled = compileSchema(bigSchema());
    expect(compiled.ok && compiled.schema.fields.length).toBe(500);
    expect(fastest(() => {
      makeForm(bigSchema()); 
    })).toBeLessThan(1500);
  });

  it('answers one keystroke in a controller with the work that depends on it and nothing else: its own check, and the five conditions that read it', () => {
    const { store } = makeForm(bigSchema());
    const before = store.stats();
    const snapshot = store.getSnapshot();
    store.setValue('c3', 'x');
    const after = store.stats();
    expect(after.conditions - before.conditions).toBe(5);
    expect(after.validations - before.validations).toBe(1);
    expect(after.remote - before.remote).toBe(0);
    expect(after.built - before.built).toBeLessThanOrEqual(6);
    expect(after.notified - before.notified).toBe(1);
    expect(sameObjects(snapshot, store.getSnapshot())).toBeGreaterThanOrEqual(500 - 6);
    store.setValue('c3', 'xy');
    expect(store.stats().conditions - after.conditions).toBe(5);
  });

  it('answers one keystroke in a field that nothing reads with one check and one field made', () => {
    const { store } = makeForm(bigSchema());
    const before = store.stats();
    store.setValue('t10', 'typed');
    const after = store.stats();
    expect(after.conditions - before.conditions).toBe(0);
    expect(after.validations - before.validations).toBe(1);
    expect(after.built - before.built).toBe(1);
  });

  it('tells a listener once per keystroke, and a listener that only watches one field is not told about another', () => {
    const { store } = makeForm(bigSchema());
    let all = 0;
    let one = 0;
    store.subscribe(() => {
      all += 1; 
    });
    store.subscribeTo((state) => state.fields[5]?.value, () => {
      one += 1; 
    });
    for (let at = 0; at < 10; at += 1) {
      store.setValue('t10', `v${String(at)}`);
    }

    expect({ all, one }).toEqual({ all: 10, one: 0 });
  });

  it('takes two hundred keystrokes in a bounded time, whatever field they go to', () => {
    const { store } = makeForm(bigSchema());
    let turn = 0;
    const elapsed = fastest(() => {
      for (let at = 0; at < 200; at += 1) {
        turn += 1;
        store.setValue(`c${String(at % CONTROLLERS)}`, `value ${String(turn)}`);
        store.setValue(`t${String(at)}`, `text ${String(turn)}`);
      }
    });
    expect(elapsed).toBeLessThan(1500);
  });

  it('runs no check for a field that was not changed, however many fields there are: the counts do not grow with the form', () => {
    const small = makeForm({ sections: [{ fields: [{ id: 'c0', kind: 'text' }, { id: 'd0', kind: 'text', visibleWhen: { field: 'c0', empty: false } }] }] });
    const big = makeForm(bigSchema());
    const delta = (fixture: typeof small): number => {
      const start = fixture.store.stats();
      fixture.store.setValue('c0', 'x');
      return fixture.store.stats().conditions - start.conditions;
    };

    expect(delta(big)).toBe(delta(small) * 5);
  });
});
