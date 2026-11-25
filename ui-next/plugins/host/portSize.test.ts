import { describe, expect, it } from 'vitest';
import { weigh } from './portSize';

// What a request weighs (PF2, `portSize.ts`): the bytes its JSON takes in UTF-8, as the runtime's encoder sends them, counted by a walk that has a budget and stops at the first excess, so that a value that is far too large is
// never serialised or read to its end. The oracle is `JSON.stringify` for plain data; the runtime's own differences (a negative zero is sent as `-0`, a member that is `undefined` is left out) are named where they matter.

/** The bytes the JSON of a value takes in UTF-8. */
const sent = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/** A value that nests `levels` arrays, the innermost one empty. */
function nest(levels: number): unknown {
  let value: unknown = [];
  for (let level = 1; level < levels; level += 1) {
    value = [value];
  }

  return value;
}

const PLAIN: ReadonlyArray<readonly [string, unknown]> = [
  ['null', null],
  ['true', true],
  ['false', false],
  ['zero', 0],
  ['a whole number', 8080],
  ['a negative number', -12],
  ['a fraction', 3.14159],
  ['a very large number', 1e21],
  ['a very small number', 1e-7],
  ['an empty text', ''],
  ['a text', 'alpha'],
  ['a text with quotes and a backslash', 'a "quoted" \\ word'],
  ['a text with the escapes of JSON', 'line\nbreak\ttab\rreturn\bback\fform'],
  ['a text with control characters that JSON writes as \\u', '\u0001\u001f'],
  ['a text with two-byte characters', 'é ñ ü'],
  ['a text with three-byte characters', '€ 日本語'],
  ['a text with a character outside the first plane', '😀 𝒳'],
  ['a text with the separators that JSON leaves as they are', '\u2028\u2029\u007f'],
  ['an empty list', []],
  ['an empty map', {}],
  ['a list', [1, 'two', null, true]],
  ['a map', { a: 1, b: 'two', c: null }],
  ['a map with names that need escaping', { 'a"b': 1, 'c\\d': 2, 'é': 3 }],
  ['maps and lists inside one another', { a: { b: [1, { c: [] }, [[]]] }, d: [{ e: { f: 'g' } }] }],
  ['a body as the host writes one', { kind: 'map', value: { name: { kind: 'string', value: 'alpha' }, ports: { kind: 'list', value: [{ kind: 'int64', value: '8080' }] } } }],
  ['a reference as the host writes one', { address: { provider: 'acme', authority: 'north', type: 'widgets', scope: [{ dimension: 'zone', value: 'a' }], id: 'alpha' }, incarnation: '3' }],
];

describe('what a value weighs', () => {
  it.each(PLAIN)('is, for %s, the bytes its JSON takes in UTF-8, to the byte', (_name, value) => {
    expect(weigh(value, 1_000_000)).toBe(sent(value));
  });

  it.each(PLAIN)('is accepted with exactly the budget it weighs, and is over with one byte less, for %s', (_name, value) => {
    const bytes = sent(value);
    expect(weigh(value, bytes)).toBe(bytes);
    expect(weigh(value, bytes - 1)).toBe('over');
  });

  it('leaves out a member that is `undefined`, a function or a symbol, as the JSON of an object does, and counts one in a list as `null`, as a list does', () => {
    const value = { kept: 1, none: undefined, call: () => 1, mark: Symbol('x') };
    expect(weigh(value, 1000)).toBe(sent({ kept: 1 }));
    const list = [1, undefined, 2];
    expect(weigh(list, 1000)).toBe(sent(list));
  });

  it('counts a hole in a list as `null`, which a list that has one writes as it', () => {
    const list = new Array<unknown>(3);
    list[0] = 1;
    list[2] = 3;
    expect(weigh(list, 1000)).toBe(sent(list));
  });

  it('counts a negative zero as the runtime sends it, `-0`, and a number that is not finite as `null`', () => {
    expect(weigh(-0, 100)).toBe(2);
    expect(weigh(Number.NaN, 100)).toBe(4);
    expect(weigh(Number.POSITIVE_INFINITY, 100)).toBe(4);
    expect(weigh([-0, 1], 100)).toBe(sent([0, 1]) + 1);
  });

  it('counts only the members a value has of its own: not those it inherits, and not those that are not enumerable', () => {
    const inherited = Object.create({ borrowed: 1 }) as Record<string, unknown>;
    inherited.own = 2;
    Object.defineProperty(inherited, 'hidden', { value: 3, enumerable: false });
    expect(weigh(inherited, 100)).toBe(sent({ own: 2 }));
  });

  it('says `over` for a text that is longer than what is left, without reading it: a text of twenty megabytes', () => {
    expect(weigh('x'.repeat(20 * 1024 * 1024), 1000)).toBe('over');
    expect(weigh({ a: 'x'.repeat(20 * 1024 * 1024) }, 1000)).toBe('over');
  });

  it('says `over` for a list or a map that is larger than the budget, at the first member that does not fit', () => {
    const list = Array.from({ length: 1000 }, () => 'abcdefghij');
    expect(weigh(list, 1000)).toBe('over');
    const map = Object.fromEntries(list.map((item, index) => [`k${String(index)}`, item]));
    expect(weigh(map, 1000)).toBe('over');
  });
});

describe('the longest text', () => {
  it('is a bound on each text of the value, a name as well: `text` is its answer, and it is said before `over`, since it names what is wrong', () => {
    expect(weigh('abcde', 1000, 5)).toBe(sent('abcde'));
    expect(weigh('abcdef', 1000, 5)).toBe('text');
    expect(weigh({ a: ['abcdef'] }, 1000, 5)).toBe('text');
    expect(weigh({ abcdef: 1 }, 1000, 5)).toBe('text');
    expect(weigh('x'.repeat(2000), 10, 5)).toBe('text');
  });

  it('is no bound when it is not given: any text that fits the budget is taken', () => {
    expect(weigh('x'.repeat(5000), 10_000)).toBe(sent('x'.repeat(5000)));
  });

  it('is counted in characters and not in bytes: five characters of three bytes each are five characters', () => {
    expect(weigh('€€€€€', 1000, 5)).toBe(sent('€€€€€'));
    expect(weigh('€€€€€€', 1000, 5)).toBe('text');
  });
});

describe('how deep a value nests', () => {
  it('is bounded at 64 levels below the root, as the runtime\'s encoder bounds it: a value that nests 65 arrays is taken, and one that nests 66 is `deep`', () => {
    expect(weigh(nest(65), 1_000_000)).toBe(sent(nest(65)));
    expect(weigh(nest(66), 1_000_000)).toBe('deep');
  });

  it('is `deep` for a value that refers to itself, and not a walk that never ends', () => {
    const loop: Record<string, unknown> = {};
    loop.again = loop;
    expect(weigh(loop, 1_000_000)).toBe('deep');
    const list: unknown[] = [];
    list.push(list);
    expect(weigh(list, 1_000_000)).toBe('deep');
  });

  it('is `deep` for a value that refers to itself in many places, which a count of the members that were visited would let run a long time', () => {
    const loop: unknown[] = [];
    loop.push(loop, loop, loop, loop);
    expect(weigh(loop, 10_000_000)).toBe('deep');
  });
});

describe('the walk', () => {
  /** Counts the members a walk reads of a value, by index or by name. */
  function counted<T extends Record<string, unknown> | unknown[]>(target: T): { readonly value: T; readonly reads: () => number } {
    let reads = 0;
    const value = new Proxy(target, {
      get: (object, key, receiver) => {
        if (typeof key === 'string' && key !== 'length') {
          reads += 1;
        }

        return Reflect.get(object, key, receiver);
      },
    });
    return { value, reads: () => reads };
  }

  it('stops at the first excess in a list: of a list of a billion holes it reads no more members than the budget can hold', () => {
    const { value, reads } = counted(new Array<unknown>(1_000_000_000));
    expect(weigh(value, 1000)).toBe('over');
    // A member costs at least a byte for itself and one for the comma.
    expect(reads()).toBeLessThanOrEqual(500);
  });

  it('stops at the first excess in a map: of a map of fifty thousand members it reads no more members than the budget can hold', () => {
    const { value, reads } = counted(Object.fromEntries(Array.from({ length: 50_000 }, (_, index) => [`k${String(index)}`, index])));
    expect(weigh(value, 1000)).toBe('over');
    expect(reads()).toBeLessThanOrEqual(500);
  });

  it('stops at the first text that is too long, and reads nothing after it', () => {
    const { value, reads } = counted(['ok', 'x'.repeat(100), 'never', 'read', 'again']);
    expect(weigh(value, 1_000_000, 10)).toBe('text');
    expect(reads()).toBe(2);
  });
});
