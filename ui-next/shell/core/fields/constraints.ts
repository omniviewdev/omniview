import type { CompiledField } from './schema';
import { clip } from './text';
import { LIMITS, type Issue, type IssueCode, type IssueWhen, type Json } from './types';
import { isBlank, sameValue } from './values';

// The local checks of a value, from the constraints the schema declares (ch04 "Validation timing and outcome"). Pure: a field and a value in, the issues out. Each issue says WHEN it is
// told: `now` (an illegal character, a value past its maximum: validated at once, as the user types), `complete` (everything else about a value that is being formed: told once it was
// committed, by blur or Enter, or a submit was tried) and `required` (nothing was entered: told only after a submit, or after the user edited the field and committed it, and never
// for a field that was merely opened or passed). The sentences are "Problem. Fix." and at most 80 characters (S127); a plugin's own replace them. A sentence never carries the value.

export type Found = Issue & { readonly when: IssueWhen };

const ABSOLUTE = /^(?:\/|~(?:\/|$)|[A-Za-z]:[\\/]|\\\\)/;
const CONTROL = /\p{Cc}/u;
const COLOR = /^#?[0-9a-fA-F]{6}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;

/** The number of characters (code points) of a text, without making a list of them when the text is short enough to be sure. */
const length = (text: string, bound: number): number => (text.length <= bound ? text.length : Array.from(text).length);

function make(field: CompiledField, code: IssueCode, when: IssueWhen, text: string): Found {
  return Object.freeze({ code, text: clip(field.constraints.messages[code] ?? text, LIMITS.message), severity: 'error' as const, source: 'local' as const, when });
}

/** Whether every character of a text typed or pasted is one the field accepts: what a view asks before it takes a key (`beforeinput`), so an illegal character is refused as it is typed. */
export function allows(field: CompiledField, text: string): boolean {
  const { allowed } = field.constraints;
  return allowed === undefined || Array.from(text).every((character) => allowed.test(character));
}

function urlIsFine(value: string, schemes: readonly string[]): boolean {
  try {
    const url = new URL(value);
    const scheme = url.protocol.slice(0, -1).toLowerCase();
    return schemes.includes(scheme) && ((scheme !== 'http' && scheme !== 'https') || url.hostname !== '');
  } catch {
    return false;
  }
}

function pathIsFine(value: string, field: CompiledField): boolean {
  const { absolute, extensions, pathKind } = field.constraints;
  if (CONTROL.test(value) || (absolute && !ABSOLUTE.test(value))) {
    return false;
  }

  if (pathKind === 'file' && extensions.length > 0) {
    const lower = value.toLowerCase();
    return extensions.some((extension) => lower.endsWith(`.${extension.replace(/^\./, '').toLowerCase()}`));
  }

  return true;
}

function checkText(field: CompiledField, value: string, add: (code: IssueCode, when: IssueWhen, text: string) => void): void {
  const c = field.constraints;
  if (c.allowed !== undefined && !allows(field, value)) {
    add('chars', 'now', 'Illegal characters. Remove the ones that are not allowed.');
  }

  const characters = c.maxLength !== undefined || c.minLength !== undefined ? length(value, Math.max(c.maxLength ?? 0, c.minLength ?? 0)) : 0;
  if (c.maxLength !== undefined && characters > c.maxLength) {
    add('max-length', 'now', `Too long. Use at most ${String(c.maxLength)} characters.`);
  }

  if (c.minLength !== undefined && characters < c.minLength) {
    add('min-length', 'complete', `Too short. Use at least ${String(c.minLength)} characters.`);
  }

  // A plugin's expression is run only on a bounded input: a pattern that backtracks must not be able to hang the page.
  if (c.pattern !== undefined && value.length <= LIMITS.patternInput && !c.pattern.test(value)) {
    add('pattern', 'complete', 'Not in the expected form. Check the value.');
  }

  if (c.format === 'datetime' && !(RFC3339.test(value) && Number.isFinite(Date.parse(value)))) {
    add('format', 'complete', 'Not a date and time. Use RFC 3339, like 2026-11-01T09:00:00Z.');
  }
}

function checkNumber(field: CompiledField, value: Json, add: (code: IssueCode, when: IssueWhen, text: string) => void): void {
  if (typeof value !== 'number') {
    add('not-a-number', 'complete', 'Not a number. Enter digits only.');
    return;
  }

  const { integer, min, max, step } = field.constraints;
  if (integer && !Number.isInteger(value)) {
    add('not-an-integer', 'complete', 'Not a whole number. Enter digits only.');
  }

  const range = min !== undefined && max !== undefined ? `Out of range. Use a value from ${String(min)} to ${String(max)}.` : undefined;
  if (max !== undefined && value > max) {
    add('max', 'now', range ?? `Too large. Use ${String(max)} or less.`);
  }

  if (min !== undefined && value < min) {
    add('min', 'complete', range ?? `Too small. Use ${String(min)} or more.`);
  }

  if (step !== undefined) {
    const steps = (value - (min ?? 0)) / step;
    if (Math.abs(steps - Math.round(steps)) > 1e-7) {
      add('step', 'complete', `Off the grid. Use steps of ${String(step)}.`);
    }
  }
}

function checkItems(field: CompiledField, items: readonly Json[], add: (code: IssueCode, when: IssueWhen, text: string) => void): void {
  const c = field.constraints;
  if (field.kind === 'multiselect' && field.options !== undefined) {
    const offered = field.options;
    if (items.some((item) => !offered.some((option) => option.value === item))) {
      add('not-an-option', 'complete', 'Not an option. Choose from the list.');
    }
  }

  if (field.kind === 'list') {
    if (c.item === 'path' && items.some((item) => typeof item !== 'string' || !pathIsFine(item, field))) {
      add('path', 'complete', c.absolute ? 'Not an absolute path. Start it with / or ~.' : 'Not a valid path. Remove the control characters.');
    } else if (c.item === 'url' && items.some((item) => typeof item !== 'string' || !urlIsFine(item, c.schemes))) {
      add('url', 'complete', 'Not a full URL. Use one like https://example.com.');
    }
  }

  if (c.unique && new Set(items).size !== items.length) {
    add('duplicate', 'now', 'Already in the list. Enter a different value.');
  }

  if (c.maxItems !== undefined && items.length > c.maxItems) {
    add('max-items', 'now', `Too many items. Use at most ${String(c.maxItems)}.`);
  }

  if (c.minItems !== undefined && items.length < c.minItems) {
    add('min-items', 'complete', `Too few items. Use at least ${String(c.minItems)}.`);
  }
}

/**
 * The issues of a value, in the order the lane tells them (the earliest first). `other` is the value of the field this one must equal (`sameAs`), when it has one. An empty value is
 * fine unless the field is required (or a list must have a minimum); every other check is for a value that is there.
 */
export function checkValue(field: CompiledField, value: Json | undefined, other: Json | undefined): readonly Found[] {
  const found: Found[] = [];
  const add = (code: IssueCode, when: IssueWhen, text: string): void => {
    found.push(make(field, code, when, text));
  };

  const c = field.constraints;
  if (field.kind === 'unsupported') {
    return found;
  }

  if (field.kind === 'boolean') {
    if (c.required && value !== true) {
      add('required', 'required', `${field.label} must be on.`);
    }

    return found;
  }

  if (isBlank(value)) {
    if (c.required) {
      add('required', 'required', `${field.label} is required.`);
    } else if ((field.kind === 'list' || field.kind === 'multiselect') && (c.minItems ?? 0) > 0) {
      add('min-items', 'complete', `Too few items. Use at least ${String(c.minItems)}.`);
    }

    return found;
  }

  if (value === undefined) {
    return found;
  }

  switch (field.kind) {
    case 'text':
    case 'secret':
      if (typeof value === 'string') {
        checkText(field, value, add);
      }

      break;
    case 'path':
      if (typeof value === 'string') {
        checkText(field, value, add);
        if (!pathIsFine(value, field)) {
          add('path', 'complete', c.absolute && !CONTROL.test(value) ? 'Not an absolute path. Start it with / or ~.' : 'Not a valid path. Check the characters and the file type.');
        }
      }

      break;
    case 'url':
      if (typeof value === 'string') {
        checkText(field, value, add);
        if (!urlIsFine(value, c.schemes)) {
          add('url', 'complete', 'Not a full URL. Use one like https://example.com.');
        }
      }

      break;
    case 'color':
      if (typeof value === 'string' && !COLOR.test(value)) {
        add('color', 'complete', 'Not a color. Use six hex digits, like #3871E1.');
      }

      break;
    case 'number':
      checkNumber(field, value, add);
      break;
    case 'select':
      if (field.options !== undefined && !field.options.some((option) => option.value === value)) {
        add('not-an-option', 'complete', 'Not an option. Choose one from the list.');
      }

      break;
    case 'multiselect':
    case 'list':
      if (Array.isArray(value)) {
        checkItems(field, value, add);
      } else {
        add('type', 'now', 'Not a valid value. Check what you entered.');
      }

      break;
  }

  if (c.sameAs !== undefined && !sameValue(value, other)) {
    add('same-as', 'complete', 'Does not match. Enter the same value again.');
  }

  return found;
}
