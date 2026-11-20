import { equalJson, stableJson } from '../tabs/json';
import { LIMITS, type FieldKind, type Json, type Scalar } from './types';

// What a field's value is, by kind, and the plain-data rules around it: the empty value, whether two values are the same, and how an input is read. A value is JSON (a text, a number, a
// boolean, a list of those) or nothing; the model never keeps anything else, so a snapshot of values can be copied, compared and saved as it is.

export const isScalar = (value: unknown): value is Scalar => typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));

/** The value of a field that has not been given one: a text is empty, a switch is off, a list has no items; a number and a choice have nothing yet. */
export function emptyValue(kind: FieldKind): Json | undefined {
  switch (kind) {
    case 'text':
    case 'path':
    case 'url':
    case 'color':
      return '';
    case 'boolean':
      return false;
    case 'multiselect':
    case 'list':
      return Object.freeze([]);
    case 'number':
    case 'select':
    case 'secret':
      return undefined;
  }
}

/** Nothing, an empty or blank text, an empty list. A number, `0` and `false` are values. */
export const isBlank = (value: Json | undefined): boolean => value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);

export const sameValue = (a: Json | undefined, b: Json | undefined): boolean => equalJson(a, b);

/** A text that is equal for equal values: what a result is remembered by. */
export const valueKey = (value: Json | undefined): string => (value === undefined ? 'undefined' : stableJson(value));

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export type Read = { readonly ok: true; readonly value: Json | undefined } | { readonly ok: false };

/**
 * What an input means for a kind. A typed number may not be a number yet ("-", "1e"): with `typed` it is kept as the text and judged by the constraints (`not-a-number`), so that what
 * the user typed stays in the field; without it (a value from the host or a default) it is refused. Anything of the wrong type is refused.
 */
export function readValue(kind: FieldKind, raw: unknown, typed: boolean): Read {
  switch (kind) {
    case 'text':
    case 'path':
    case 'url':
    case 'color':
    case 'secret':
      return typeof raw === 'string' && raw.length <= LIMITS.value ? { ok: true, value: raw } : { ok: false };
    case 'number': {
      if (typeof raw === 'number') {
        return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false };
      }

      if (typed && typeof raw === 'string' && raw.length <= 64) {
        const text = raw.trim();
        if (text === '') {
          return { ok: true, value: undefined };
        }

        return { ok: true, value: NUMBER.test(text) && Number.isFinite(Number(text)) ? Number(text) : raw };
      }

      return { ok: false };
    }

    case 'boolean':
      return typeof raw === 'boolean' ? { ok: true, value: raw } : { ok: false };
    case 'select':
      return isScalar(raw) ? { ok: true, value: raw } : { ok: false };
    case 'multiselect':
      return Array.isArray(raw) && raw.length <= LIMITS.items && raw.every(isScalar) ? { ok: true, value: Object.freeze([...(raw as readonly Scalar[])]) } : { ok: false };
    case 'list':
      return Array.isArray(raw) && raw.length <= LIMITS.items && raw.every((item) => typeof item === 'string' && item.length <= LIMITS.value) ? { ok: true, value: Object.freeze([...(raw as readonly string[])]) } : { ok: false };
  }
}

/** The text of every string in a value, for a scrubber: a secret that is a list has several. */
export function stringsOf(value: Json | undefined): readonly string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (typeof value === 'number') {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => stringsOf(item));
  }

  return [];
}
