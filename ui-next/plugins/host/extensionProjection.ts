import type { ExtensionEdge, ExtensionFields } from './extensionContract';
import { weigh } from './portSize';

type Scalar = string | number;
export type ExtensionInput = Readonly<Record<string, Scalar>>;
export type ProjectionRule = {
  readonly fields: ExtensionFields;
  readonly optional: readonly string[];
  readonly effective: readonly string[];
  readonly when: ExtensionEdge['when'];
};

const MISSING = Symbol('missing');
const INVALID = Symbol('invalid');

/** A descriptor trap can synchronously revoke this binding or switch the subject. Never invoke a getter or inspect a thrown value. */
function own(context: unknown, field: string, tag: 'string' | 'number', current: () => boolean): Scalar | typeof MISSING | typeof INVALID {
  if (!current()) {
    return INVALID;
  }

  const descriptor = Object.getOwnPropertyDescriptor(context, field);
  if (!current()) {
    return INVALID;
  }

  if (!descriptor) {
    return MISSING;
  }

  if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
    return INVALID;
  }

  const value: unknown = descriptor.value;
  if (tag === 'string') {
    return typeof value === 'string' && value.length <= 4096 ? value : INVALID;
  }

  return typeof value === 'number' && Number.isFinite(value) ? value : INVALID;
}

function comparisons(rule: ProjectionRule, context: unknown, current: () => boolean, tested?: Record<string, Scalar>): boolean {
  if (rule.when) {
    // Establish the whole grant before the first descriptor: even testing one fact can disclose a value through membership.
    if (!rule.when.every(test => rule.effective.includes(test.field))) {
      return false;
    }

    for (const { field, equals } of rule.when) {
      const value = own(context, field, rule.fields[field], current);
      if (value !== equals) {
        return false;
      }

      if (tested) {
        tested[field] = value;
      }
    }
  }

  return current();
}

/** Listing touches only facts actually needed by this predicate. An unconditional choice is metadata. */
export function matchesExtension(rule: ProjectionRule, context: unknown, current: () => boolean): boolean {
  if (!rule.when) {
    return current();
  }

  try {
    return typeof context === 'object' && context !== null && !Array.isArray(context) && comparisons(rule, context, current);
  } catch {
    return false;
  }
}

/** Project from one binding only. Never enumerate, spread, stringify, measure or freeze the owner's context. */
export function projectExtension(rule: ProjectionRule, context: unknown, current: () => boolean, afterMatch?: () => boolean): ExtensionInput | undefined {
  try {
    if (!current() || typeof context !== 'object' || context === null || Array.isArray(context)) {
      return undefined;
    }

    const input: Record<string, Scalar> = Object.create(null);
    // The menu's independent destination can disappear or reenter the owner lease. Screen it before reading other granted facts.
    if (!comparisons(rule, context, current, input) || (afterMatch && (!afterMatch() || !current()))) {
      return undefined;
    }

    let remaining = 16 * 1024 - 2; // Compact JSON braces.
    let count = 0;
    for (const field of rule.effective) {
      const value = Object.hasOwn(input, field) ? input[field] : own(context, field, rule.fields[field], current);
      if (value === MISSING) {
        // An inherited value is not an absent optional field. `has` does not read it, but a proxy can reenter here too.
        if (!rule.optional.includes(field) || Reflect.has(context, field) || !current()) {
          return undefined;
        }

        continue;
      }

      if (value === INVALID) {
        return undefined;
      }

      remaining -= field.length + 3 + (count === 0 ? 0 : 1); // ASCII segment, two quotes, colon and separator.
      // JSON.stringify(-0) is "0". Weigh only this validated scalar, never denied properties or the original object.
      const bytes = weigh(value === 0 ? 0 : value, remaining, 4096);
      if (typeof bytes !== 'number') {
        return undefined;
      }

      remaining -= bytes;
      input[field] = value;
      count++;
    }

    return current() ? Object.freeze(input) : undefined;
  } catch {
    return undefined;
  }
}

export function sameInput(left: ExtensionInput, right: ExtensionInput): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.is(left[key], right[key]));
}
