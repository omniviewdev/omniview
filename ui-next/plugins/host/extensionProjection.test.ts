import { describe, expect, it, vi } from 'vitest';
import { matchesExtension, projectExtension, type ProjectionRule } from './extensionProjection';

const live = () => true;
const one: ProjectionRule = { fields: { fact: 'string' }, optional: [], effective: ['fact'], when: undefined };

describe('one binding’s effective scalar projection', () => {
  it('never enumerates the context or reads, measures, or invokes a denied member, even for an empty grant', () => {
    const denied = vi.fn(() => {
      throw Error('denied'); 
    });
    const touched: PropertyKey[] = [];
    const context = new Proxy(Object.defineProperty({ fact: 'allowed' }, 'private', { get: denied }), {
      getOwnPropertyDescriptor(target, key) {
        touched.push(key); return Reflect.getOwnPropertyDescriptor(target, key); 
      },
      ownKeys: denied, get: denied, getPrototypeOf: denied, has: denied,
    });
    const empty = projectExtension({ ...one, effective: [] }, context, live)!;
    expect(Object.keys(empty)).toEqual([]);
    expect(touched).toEqual([]);
    expect(Object.getPrototypeOf(empty)).toBeNull();
    expect(Object.isFrozen(empty)).toBe(true);
    expect(projectExtension(one, context, live)).toEqual({ fact: 'allowed' });
    expect(touched).toEqual(['fact']);
    expect(denied).not.toHaveBeenCalled();
  });

  it('distinguishes optional absence from inherited, hidden, accessor, malformed and missing required values', () => {
    expect(projectExtension(one, {}, live)).toBeUndefined();
    const optional = { ...one, optional: ['fact'] };
    expect(projectExtension(optional, {}, live)).toEqual({});
    const getter = vi.fn(() => 'private');
    for (const context of [Object.create({ fact: 'inherited' }), Object.defineProperty({}, 'fact', { value: 'hidden' }),
      Object.defineProperty({}, 'fact', { enumerable: true, get: getter }),
      { fact: undefined }, { fact: null }, { fact: { credentials: true } }, [], null, 'not an outlet']) {
      expect(projectExtension(one, context, live)).toBeUndefined();
      expect(projectExtension(optional, context, live)).toBeUndefined();
    }

    expect(getter).not.toHaveBeenCalled();
    const number: ProjectionRule = { ...one, fields: { fact: 'number' } };
    for (const value of [NaN, Infinity, -Infinity, '0', 0n]) {
      expect(projectExtension(number, { fact: value }, live)).toBeUndefined();
    }

    expect(projectExtension(number, { fact: -0 }, live)?.fact).toBe(-0);
    expect(projectExtension(one, { fact: 'x'.repeat(4096) }, live)?.fact).toHaveLength(4096);
    expect(projectExtension(one, { fact: 'x'.repeat(4097) }, live)).toBeUndefined();
  });

  it('honors the compact JSON UTF-8 budget at N and N+1, including escaped controls and multi-byte scalars', () => {
    const rule: ProjectionRule = { fields: { a: 'string', b: 'string', c: 'string', d: 'string' }, effective: ['a', 'b', 'c', 'd'], optional: [], when: undefined };
    const values = { a: '\u0001'.repeat(1000), b: 'é'.repeat(2000), c: '\u{10000}'.repeat(1000), d: '' };
    values.d = 'x'.repeat(16 * 1024 - Buffer.byteLength(JSON.stringify(values), 'utf8'));
    expect(projectExtension(rule, values, live)).toEqual(values);
    values.d += 'x';
    expect(projectExtension(rule, values, live)).toBeUndefined();
  });

  it('tests a fully granted conjunction using exact types and values; empty string and zero can match', () => {
    const tested: ProjectionRule = { fields: { a: 'string', b: 'number', c: 'string' }, optional: ['c'], effective: ['a', 'b', 'c'],
      when: [{ field: 'a', equals: '' }, { field: 'b', equals: 0 }] };
    const descriptors = vi.fn(Reflect.getOwnPropertyDescriptor);
    const context = new Proxy({ a: '', b: 0 }, { getOwnPropertyDescriptor: descriptors });
    expect(matchesExtension({ ...tested, effective: ['a'] }, context, live)).toBe(false);
    expect(descriptors).not.toHaveBeenCalled();
    expect(matchesExtension(tested, context, live)).toBe(true);
    expect(descriptors.mock.calls.map(([, key]) => key)).toEqual(['a', 'b']);
    expect(matchesExtension(tested, { a: '', b: '0' }, live)).toBe(false);
    expect(matchesExtension(tested, { a: '' }, live)).toBe(false);
    expect(projectExtension(tested, context, live)).toEqual({ a: '', b: 0 });
  });

  it('rechecks the lease after a proxy has trap and never inspects a thrown value', () => {
    const inspect = vi.fn(() => {
      throw new Error('inspected raw throw');
    });
    const raw = new Proxy(new Error('owner fault'), { get: inspect });
    expect(projectExtension(one, new Proxy({}, { getOwnPropertyDescriptor() {
      throw raw; 
    } }), live)).toBeUndefined();
    expect(inspect).not.toHaveBeenCalled();
    const rule: ProjectionRule = { fields: { first: 'string', next: 'string' }, optional: ['first'], effective: ['first', 'next'], when: undefined };
    let active = true;
    const touched: PropertyKey[] = [];
    const context = new Proxy({ next: 'withdrawn' }, {
      getOwnPropertyDescriptor(target, key) {
        touched.push(key); return Reflect.getOwnPropertyDescriptor(target, key); 
      },
      has() {
        active = false; return false; 
      },
    });
    expect(projectExtension(rule, context, () => active)).toBeUndefined();
    expect(touched).toEqual(['first']);
  });
});
