import type { Json } from './types';

// Plain data: what a route, a reveal request and a page's saved state are made of. The model stores JSON-shaped data only, copies what it is given,
// and freezes what it keeps, so a caller that holds on to a value can neither change a tab nor be surprised by one.

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 24;

export const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObject(value) || Array.isArray(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** A deep copy of valid JSON with the keys of every object in order, or `undefined` when the value is not JSON (a function, a symbol, `undefined`, NaN, a cycle, a class instance). */
export function strictJson(value: unknown, depth = 0): Json | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (depth > MAX_DEPTH) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const out: Json[] = [];
    for (const item of value) {
      const copy = strictJson(item, depth + 1);
      if (copy === undefined) {
        return undefined;
      }

      out.push(copy);
    }

    return Object.freeze(out);
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const out: Record<string, Json> = {};
  for (const key of Object.keys(value).sort()) {
    if (FORBIDDEN.has(key)) {
      return undefined;
    }

    const copy = strictJson(value[key], depth + 1);
    if (copy === undefined) {
      return undefined;
    }

    out[key] = copy;
  }

  return Object.freeze(out);
}

/**
 * A deep copy that is JSON-shaped whatever it is given: a function, a symbol, `undefined` and a cycle drop, a Date becomes its ISO text, a Set an array, a Map an object,
 * NaN and Infinity null. For state a page keeps (its scroll offsets, its selection), which a page host cannot be expected to keep plain.
 */
export function lenientJson(value: unknown, depth = 0, seen = new Set<unknown>()): Json | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'bigint') {
    return String(value);
  }

  if (typeof value !== 'object' || depth > MAX_DEPTH || seen.has(value)) {
    return undefined;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  seen.add(value);
  let out: Json;
  if (Array.isArray(value) || value instanceof Set) {
    out = Object.freeze(Array.from(value as Iterable<unknown>, (item) => lenientJson(item, depth + 1, seen) ?? null));
  } else {
    const entries: Array<[string, unknown]> = value instanceof Map ? Array.from(value as Map<unknown, unknown>, ([key, item]): [string, unknown] => [String(key), item]) : Object.entries(value);
    const copy: Record<string, Json> = {};
    for (const [key, item] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      const made = FORBIDDEN.has(key) ? undefined : lenientJson(item, depth + 1, seen);
      if (made !== undefined) {
        copy[key] = made;
      }
    }

    out = Object.freeze(copy);
  }

  seen.delete(value);
  return out;
}

export function equalJson(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) {
    return true;
  }

  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }

  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => equalJson(item, b[index]));
  }

  const left = a as Readonly<Record<string, Json>>;
  const right = b as Readonly<Record<string, Json>>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}

/** A text of plain data that does not depend on the order of an object's keys. */
export function stableJson(value: Json): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }

  const object = value as Readonly<Record<string, Json>>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key] ?? null)}`).join(',')}}`;
}

/** The size of `value` as JSON text in UTF-8, in bytes: one for ASCII, two up to U+07FF, three for the rest of the BMP, four for a surrogate pair (`JSON.stringify` escapes a lone surrogate, which then counts as its six characters). */
export function jsonBytes(value: Json): number {
  const text = JSON.stringify(value);
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (unit >= 0xd800 && unit <= 0xdbff && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

/** The same list when `next` holds the same items in the same order, so a selector can hand back an answer that did not change. */
export function sameItems<T>(previous: readonly T[] | undefined, next: readonly T[]): readonly T[] {
  return previous?.length === next.length && previous.every((item, index) => item === next[index]) ? previous : next;
}
