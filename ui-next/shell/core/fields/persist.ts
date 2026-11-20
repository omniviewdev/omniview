import { isObject, strictJson } from '../tabs/json';
import type { CompiledSchema } from './schema';
import { FORM_VERSION, LIMITS, type Json } from './types';
import { readValue } from './values';

// The draft of a form as a page keeps it across a switch of tabs or a restart: the version first, which form it is for, and the values that differ from the applied ones. A SECRET is
// never in it (a restore does not believe one that is). Reading it back REPAIRS rather than discards, as the tab model's and the palette's saved forms do: a value that is not for a
// field of this form, or does not fit its kind, is dropped alone, and said (without the value). A draft of another version with no way up, or for another form, is never half used.

export type DraftMigration = (raw: Readonly<Record<string, unknown>>) => unknown;

/** The steps from every older draft version, keyed by the version they start from. Empty at version 1: the first release has nothing to migrate from. */
export const DRAFT_MIGRATIONS: Readonly<Record<number, DraftMigration>> = Object.freeze({});

export type RestoreOptions = { readonly migrations?: Readonly<Record<number, DraftMigration>> | undefined };

export type RestoreResult =
  | { readonly ok: true; readonly values: Readonly<Record<string, Json>>; /** Something was dropped. */ readonly repaired: boolean; readonly problems: readonly string[] }
  | { readonly ok: false; readonly reason: 'missing' | 'unreadable' | 'foreign-version' | 'other-form'; readonly detail: string };

const plainObject = (value: unknown): Readonly<Record<string, unknown>> | undefined => (isObject(value) && !Array.isArray(value) ? (value) : undefined);

/** Reads a saved draft for a form. `values` are what to start the form with (`FormOptions.draft`); `null` is a number or a choice the user cleared. Never throws. */
export function restoreDraft(raw: unknown, schema: CompiledSchema, options: RestoreOptions = {}): RestoreResult {
  try {
    if (raw === undefined || raw === null) {
      return { ok: false, reason: 'missing', detail: 'There is no saved draft.' };
    }

    let working = plainObject(raw);
    const wrote = working?.version;
    if (working === undefined || typeof wrote !== 'number' || !Number.isInteger(wrote) || wrote < 0) {
      return { ok: false, reason: 'unreadable', detail: 'A saved draft is an object with a version.' };
    }

    let version = wrote;
    if (version > FORM_VERSION) {
      return { ok: false, reason: 'foreign-version', detail: `This build reads draft version ${String(FORM_VERSION)}; this one is version ${String(version)}.` };
    }

    const steps = options.migrations ?? DRAFT_MIGRATIONS;
    while (version < FORM_VERSION) {
      const step = Object.hasOwn(steps, version) ? steps[version] : undefined;
      if (step === undefined) {
        return { ok: false, reason: 'foreign-version', detail: `This build cannot bring draft version ${String(version)} up to ${String(FORM_VERSION)}.` };
      }

      let next: unknown;
      try {
        next = step(working);
      } catch {
        return { ok: false, reason: 'unreadable', detail: `The step from draft version ${String(version)} failed.` };
      }

      const found = plainObject(next);
      if (found === undefined) {
        return { ok: false, reason: 'unreadable', detail: `The step from draft version ${String(version)} did not answer a draft.` };
      }

      working = found;
      version += 1;
    }

    const values = plainObject(working.values);
    if (typeof working.schema !== 'string' || values === undefined) {
      return { ok: false, reason: 'unreadable', detail: 'A saved draft says which form it is for and holds its values.' };
    }

    if (working.schema !== schema.id) {
      return { ok: false, reason: 'other-form', detail: 'The saved draft is for another form.' };
    }

    const kept: Array<readonly [string, Json]> = [];
    const problems: string[] = [];
    for (const [id, value] of Object.entries(values).slice(0, LIMITS.fields)) {
      const field = schema.index.get(id);
      if (field === undefined) {
        problems.push('A saved value was not for a field of this form.');
      } else if (field.sensitive) {
        problems.push('A saved value was for a secret: a secret is never restored.');
      } else if (field.kind === 'unsupported') {
        problems.push('A saved value was for a kind of field this version does not know.');
      } else if (value === null && (field.kind === 'number' || field.kind === 'select')) {
        // A number or a choice the user cleared: saved as `null`, since JSON has no "nothing".
        kept.push([id, null]);
      } else {
        const read = readValue(field.kind, value, true);
        const copy = read.ok && read.value !== undefined ? strictJson(read.value) : undefined;
        if (copy === undefined) {
          problems.push('A saved value did not fit the kind of its field.');
        } else {
          kept.push([id, copy]);
        }
      }
    }

    return { ok: true, values: Object.freeze(Object.fromEntries(kept)), repaired: problems.length > 0, problems };
  } catch {
    return { ok: false, reason: 'unreadable', detail: 'The saved draft could not be read.' };
  }
}
