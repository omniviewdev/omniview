import { isObject } from '../tabs/json';
import { normaliseRoute } from '../tabs/route';
import { line } from './text';
import { LIMITS, SEVERITIES, type Field, type Initiator, type Origin, type Severity, type Target, type TargetInput } from './types';

// What producers hand over, as the one shape the model holds (the mock's `normFields`, `normTarget`, `normSource`; shell-notify.js:148-150). Every function is total: anything a plugin writes
// becomes a bounded, cleaned value or nothing, and none of it throws.

/** Up to four live facts (S74): a label, a value and, optionally, a unit. */
export function normFields(list: unknown): readonly Field[] {
  if (!Array.isArray(list)) {
    return Object.freeze([]);
  }

  const fields: Field[] = [];
  for (const entry of list as readonly unknown[]) {
    if (fields.length >= LIMITS.fields) {
      break;
    }

    if (!isObject(entry) || entry.label === undefined || entry.label === null || entry.value === undefined || entry.value === null) {
      continue;
    }

    const unit = line(entry.unit, LIMITS.unit);
    fields.push(Object.freeze({ label: line(entry.label, LIMITS.fieldLabel), value: line(entry.value, LIMITS.field), ...(unit === '' ? {} : { unit }) }));
  }

  return Object.freeze(fields);
}

/** The produced or affected object: a label alone, or `{ label, kind, route, removed }`. Without a label there is no target. */
export function normTarget(input: TargetInput | undefined): Target | undefined {
  if (typeof input === 'string') {
    const label = line(input, 60);
    return label === '' ? undefined : Object.freeze({ label, kind: '', route: undefined, removed: false });
  }

  if (!isObject(input) || input.label === undefined || input.label === null) {
    return undefined;
  }

  const label = line(input.label, 60);
  if (label === '') {
    return undefined;
  }

  return Object.freeze({ label, kind: line(input.kind, 24).toLowerCase(), route: input.route === undefined ? undefined : normaliseRoute(input.route), removed: input.removed === true });
}

/** The source of a record: a plugin's id, lower case, or `host`. The host stamps it; a plugin cannot claim another (S74). */
export const normSource = (input: unknown): string => (typeof input === 'string' ? line(input, LIMITS.source).toLowerCase() : '') || 'host';

export const normSeverity = (input: unknown, fallback: Severity = 'info'): Severity => (SEVERITIES.find((severity) => severity === input) ?? fallback);

export const normInitiator = (input: unknown): Initiator => (input === 'user' ? 'user' : 'system');

/** Where the work started: the tab and the anchor of the control that shows it. A hint, never authority. */
export function normOrigin(input: unknown): Origin {
  if (!isObject(input)) {
    return Object.freeze({});
  }

  const tab = line(input.tab, 128);
  const anchor = line(input.anchor, 128);
  return Object.freeze({ ...(tab === '' ? {} : { tab }), ...(anchor === '' ? {} : { anchor }) });
}
