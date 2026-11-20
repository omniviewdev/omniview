import { describe, expect, it } from 'vitest';
import { compileCondition, evaluate, whyNot, type ConditionEnv, type Reader } from './expr';
import { LIMITS, type Json, type Problem } from './types';

// Conditions are data: a visibility or an enabled rule over other fields' values and the host's context flags. They are compiled once (what they read is listed, so a change
// re-runs only the conditions that read it) and evaluated against a reader.

const SECRET = 'token';

function env(known: readonly string[] = ['a', 'b', 'mode', 'tags', 'n', 'name', 'on'], problems: Problem[] = []): ConditionEnv {
  return { path: 'field.visibleWhen', has: (id) => known.includes(id) || id === SECRET, isSecret: (id) => id === SECRET, problems };
}

type Values = Readonly<Record<string, Json | undefined>>;
const reader = (values: Values, ctx: Values = {}, secretSet = false): Reader => ({
  value: (id) => values[id],
  empty: (id) => {
    if (id === SECRET) {
      return !secretSet;
    }

    const value = values[id];
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
  },
  ctx: (key) => ctx[key],
});

const holds = (raw: unknown, values: Values = {}, ctx: Values = {}): boolean => {
  const compiled = compileCondition(raw, env());
  return compiled === undefined ? true : evaluate(compiled, reader(values, ctx));
};

describe('constants', () => {
  it('compile a boolean to itself and an absent condition to nothing', () => {
    expect(holds(true)).toBe(true);
    expect(holds(false)).toBe(false);
    expect(compileCondition(undefined, env())).toBeUndefined();
  });
});

describe('a field compared with a value', () => {
  it('equals and notEquals are strict', () => {
    expect(holds({ field: 'mode', equals: 'on' }, { mode: 'on' })).toBe(true);
    expect(holds({ field: 'mode', equals: 'on' }, { mode: 'off' })).toBe(false);
    expect(holds({ field: 'n', equals: 1 }, { n: '1' })).toBe(false);
    expect(holds({ field: 'on', equals: true }, { on: true })).toBe(true);
    expect(holds({ field: 'mode', notEquals: 'off' }, { mode: 'on' })).toBe(true);
    expect(holds({ field: 'mode', notEquals: 'off' }, { mode: 'off' })).toBe(false);
  });

  it('in and notIn test membership of a list of scalars', () => {
    expect(holds({ field: 'mode', in: ['a', 'b'] }, { mode: 'b' })).toBe(true);
    expect(holds({ field: 'mode', in: ['a', 'b'] }, { mode: 'c' })).toBe(false);
    expect(holds({ field: 'mode', notIn: ['a', 'b'] }, { mode: 'c' })).toBe(true);
    expect(holds({ field: 'mode', notIn: ['a', 'b'] }, { mode: 'a' })).toBe(false);
  });

  it('has tests that a list holds a value', () => {
    expect(holds({ field: 'tags', has: 'alpha' }, { tags: ['alpha', 'beta'] })).toBe(true);
    expect(holds({ field: 'tags', has: 'gamma' }, { tags: ['alpha'] })).toBe(false);
    expect(holds({ field: 'tags', has: 'alpha' }, { tags: 'alpha' })).toBe(false);
  });

  it('empty is true for no value, an empty text and an empty list, and empty:false is its opposite', () => {
    for (const value of [undefined, '', []] as const) {
      expect(holds({ field: 'name', empty: true }, { name: value })).toBe(true);
      expect(holds({ field: 'name', empty: false }, { name: value })).toBe(false);
    }

    expect(holds({ field: 'name', empty: true }, { name: 'x' })).toBe(false);
    expect(holds({ field: 'name', empty: false }, { name: 'x' })).toBe(true);
    expect(holds({ field: 'n', empty: false }, { n: 0 })).toBe(true);
  });

  it('gt, gte, lt and lte compare numbers, and are false for anything else', () => {
    expect(holds({ field: 'n', gt: 1 }, { n: 2 })).toBe(true);
    expect(holds({ field: 'n', gt: 2 }, { n: 2 })).toBe(false);
    expect(holds({ field: 'n', gte: 2 }, { n: 2 })).toBe(true);
    expect(holds({ field: 'n', lt: 3 }, { n: 2 })).toBe(true);
    expect(holds({ field: 'n', lte: 1 }, { n: 2 })).toBe(false);
    expect(holds({ field: 'n', gt: 1 }, { n: '2' })).toBe(false);
    expect(holds({ field: 'n', gt: 1 }, {})).toBe(false);
  });

  it('startsWith tests the start of a text', () => {
    expect(holds({ field: 'name', startsWith: 'http://' }, { name: 'http://x' })).toBe(true);
    expect(holds({ field: 'name', startsWith: 'http://' }, { name: 'https://x' })).toBe(false);
    expect(holds({ field: 'name', startsWith: 'http://' }, { name: 4 })).toBe(false);
  });

  it('a missing value equals nothing, differs from everything and is empty', () => {
    expect(holds({ field: 'a', equals: 'x' }, {})).toBe(false);
    expect(holds({ field: 'a', notEquals: 'x' }, {})).toBe(true);
    expect(holds({ field: 'a', notIn: ['x'] }, {})).toBe(true);
    expect(holds({ field: 'a', empty: true }, {})).toBe(true);
  });

  it('every comparison on one leaf has to hold', () => {
    const raw = { field: 'n', gte: 1, lte: 5, notEquals: 3 };
    expect([0, 1, 3, 5, 6].map((n) => holds(raw, { n }))).toEqual([false, true, false, true, false]);
  });
});

describe('the host context', () => {
  it('a ctx leaf reads a flag the host sets', () => {
    expect(holds({ ctx: 'developer', equals: true }, {}, { developer: true })).toBe(true);
    expect(holds({ ctx: 'developer', equals: true }, {}, { developer: false })).toBe(false);
    expect(holds({ ctx: 'developer', equals: true }, {}, {})).toBe(false);
    expect(holds({ ctx: 'platform', in: ['darwin', 'linux'] }, {}, { platform: 'linux' })).toBe(true);
  });
});

describe('combinators', () => {
  const both = { all: [{ field: 'a', equals: 1 }, { field: 'b', equals: 2 }] };
  const either = { any: [{ field: 'a', equals: 1 }, { field: 'b', equals: 2 }] };

  it('all needs every item, any needs one, not turns one around', () => {
    expect([holds(both, { a: 1, b: 2 }), holds(both, { a: 1, b: 3 })]).toEqual([true, false]);
    expect([holds(either, { a: 1, b: 3 }), holds(either, { a: 0, b: 3 })]).toEqual([true, false]);
    expect([holds({ not: { field: 'a', equals: 1 } }, { a: 2 }), holds({ not: { field: 'a', equals: 1 } }, { a: 1 })]).toEqual([true, false]);
  });

  it('an empty all holds and an empty any does not', () => {
    expect(holds({ all: [] })).toBe(true);
    expect(holds({ any: [] })).toBe(false);
  });

  it('nest', () => {
    const raw = { all: [{ field: 'a', equals: 1 }, { any: [{ field: 'b', equals: 2 }, { not: { ctx: 'developer', equals: false } }] }] };
    expect(holds(raw, { a: 1, b: 9 }, { developer: true })).toBe(true);
    expect(holds(raw, { a: 1, b: 9 }, { developer: false })).toBe(false);
    expect(holds(raw, { a: 1, b: 2 }, { developer: false })).toBe(true);
  });
});

describe('what a condition reads', () => {
  it('lists the fields and the flags once each, in the order they first appear', () => {
    const compiled = compileCondition({ all: [{ field: 'b', equals: 1 }, { any: [{ field: 'a', equals: 1 }, { field: 'b', empty: false }, { ctx: 'developer', equals: true }, { ctx: 'developer', equals: true }] }] }, env());
    expect(compiled?.fields).toEqual(['b', 'a']);
    expect(compiled?.ctx).toEqual(['developer']);
  });

  it('lists nothing for a constant', () => {
    const compiled = compileCondition(true, env());
    expect(compiled?.fields).toEqual([]);
    expect(compiled?.ctx).toEqual([]);
  });
});

describe('a condition from a newer schema or a careless one is never a crash', () => {
  it('an unknown field is a problem, and the leaf holds (a field is not hidden for what this build cannot read)', () => {
    const problems: Problem[] = [];
    const compiled = compileCondition({ field: 'nope', equals: 1 }, env(undefined, problems));
    expect(compiled === undefined ? true : evaluate(compiled, reader({}))).toBe(true);
    expect(problems.map((problem) => problem.code)).toEqual(['unknown-field']);
    expect(problems[0]?.path).toBe('field.visibleWhen');
  });

  it('an operator this build does not know is a problem, and the leaf holds', () => {
    const problems: Problem[] = [];
    const compiled = compileCondition({ field: 'a', matches: '^x' }, env(undefined, problems));
    expect(compiled === undefined ? true : evaluate(compiled, reader({ a: 'y' }))).toBe(true);
    expect(problems.map((problem) => problem.code)).toEqual(['unknown-operator']);
  });

  it('a leaf with no head, an empty object, a function and a number is a problem each', () => {
    for (const raw of [{}, { equals: 1 }, () => true, 4, 'yes', null, [true]]) {
      const problems: Problem[] = [];
      const compiled = compileCondition(raw, env(undefined, problems));
      expect(compiled === undefined ? true : evaluate(compiled, reader({}))).toBe(true);
      expect(problems.length).toBeGreaterThan(0);
    }
  });

  it('an operand that is not data is a problem', () => {
    const problems: Problem[] = [];
    const compiled = compileCondition({ field: 'a', equals: () => 1 }, env(undefined, problems));
    expect(compiled === undefined ? true : evaluate(compiled, reader({ a: 1 }))).toBe(true);
    expect(problems.map((problem) => problem.code)).toEqual(['bad-condition']);
  });

  it('a field named like a prototype member is just an unknown field', () => {
    const problems: Problem[] = [];
    const compiled = compileCondition({ field: '__proto__', equals: 1 }, env(undefined, problems));
    expect(compiled === undefined ? true : evaluate(compiled, reader({}))).toBe(true);
    expect(problems.map((problem) => problem.code)).toEqual(['unknown-field']);
  });

  it('too deep a condition is cut, and a condition with too many nodes is cut, each with a problem', () => {
    let deep: unknown = { field: 'a', equals: 1 };
    for (let level = 0; level < LIMITS.conditionDepth + 3; level += 1) {
      deep = { all: [deep] };
    }

    const problems: Problem[] = [];
    expect(compileCondition(deep, env(undefined, problems))).toBeDefined();
    expect(problems.some((problem) => problem.code === 'bad-condition')).toBe(true);

    const wide = { all: Array.from({ length: LIMITS.conditionNodes + 10 }, () => ({ field: 'a', equals: 1 })) };
    const widened: Problem[] = [];
    const compiled = compileCondition(wide, env(undefined, widened));
    expect(compiled?.fields).toEqual(['a']);
    expect(widened.some((problem) => problem.code === 'bad-condition')).toBe(true);
  });
});

describe('a secret in a condition', () => {
  it('can only be asked whether it is empty: a condition must not be able to probe it', () => {
    const problems: Problem[] = [];
    const probe = compileCondition({ field: SECRET, equals: 'guess' }, env(undefined, problems));
    expect(problems.map((problem) => problem.code)).toEqual(['secret-rule']);
    expect(probe === undefined ? true : evaluate(probe, reader({}, {}, true))).toBe(true);

    const allowed = compileCondition({ field: SECRET, empty: false }, env());
    expect(allowed).toBeDefined();
    expect(evaluate(allowed!, reader({}, {}, true))).toBe(true);
    expect(evaluate(allowed!, reader({}, {}, false))).toBe(false);
  });

  it('a mix of empty and another operator keeps only empty', () => {
    const problems: Problem[] = [];
    const mixed = compileCondition({ field: SECRET, empty: false, startsWith: 'sk-' }, env(undefined, problems));
    expect(problems.map((problem) => problem.code)).toEqual(['secret-rule']);
    expect(evaluate(mixed!, reader({}, {}, true))).toBe(true);
    expect(evaluate(mixed!, reader({}, {}, false))).toBe(false);
  });
});

describe('why a condition does not hold', () => {
  const reasoned = compileCondition({
    all: [
      { field: 'a', equals: true, reason: 'Turn on A to change this.' },
      { field: 'b', equals: true, reason: 'Turn on B to change this.' },
    ],
  }, env())!;

  it('is the reason of the first leaf that failed, in the order written (S126: a list is checked in order)', () => {
    expect(whyNot(reasoned, reader({ a: false, b: false }))).toBe('Turn on A to change this.');
    expect(whyNot(reasoned, reader({ a: true, b: false }))).toBe('Turn on B to change this.');
  });

  it('is empty when the condition holds, and when no node says why', () => {
    expect(whyNot(reasoned, reader({ a: true, b: true }))).toBe('');
    expect(whyNot(compileCondition({ field: 'a', equals: true }, env())!, reader({ a: false }))).toBe('');
  });

  it('prefers the reason of the node that failed to the reason of one inside it', () => {
    const compiled = compileCondition({ all: [{ field: 'a', equals: true, reason: 'inner' }], reason: 'outer' }, env())!;
    expect(whyNot(compiled, reader({ a: false }))).toBe('outer');
  });

  it('takes the first reason of an any that failed, and the reason of a not that failed', () => {
    const either = compileCondition({ any: [{ field: 'a', equals: true, reason: 'A or B.' }, { field: 'b', equals: true }] }, env())!;
    expect(whyNot(either, reader({ a: false, b: false }))).toBe('A or B.');
    const negated = compileCondition({ not: { field: 'a', equals: true }, reason: 'A must be off.' }, env())!;
    expect(whyNot(negated, reader({ a: true }))).toBe('A must be off.');
  });

  it('is cleaned and bounded: a reason is text from a plugin', () => {
    const compiled = compileCondition({ field: 'a', equals: true, reason: `\u001b[31mTurn on A\u001b[0m\n${'x'.repeat(1000)}` }, env())!;
    const reason = whyNot(compiled, reader({ a: false }));
    expect(reason.startsWith('Turn on A xxx')).toBe(true);
    expect([...reason].length).toBeLessThanOrEqual(LIMITS.text);
  });
});
