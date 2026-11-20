import { isObject } from '../tabs/json';
import { cleanText, clip } from './text';
import { ISSUE_CODES, LIMITS, type FormAction, type FormIssue, type IssueCode } from './types';

// What the host says when it refuses a change, read as data. The host's error is the apperror JSON (`backend/pkg/apperror/apperror.go`; the shape is in `docs/ui-next/status/E0-1.md`),
// which Wails gives the page as a `RuntimeError` whose `message` is that JSON and whose `cause` is the same object. It is read like the runtime's `parseAppError` reads it
// (`packages/omniviewdev-runtime/src/errors/parseAppError.ts`; a complete envelope or nothing), then every text of it is cleaned, bounded and SCRUBBED of the secrets the user typed
// (a host that rejects a credential may echo it), and it is put on the form and on the fields it names. The envelope has no member for a field today, so two ways of saying it are
// accepted for when the host gains one: a `fields` member (a list or a map, by field id) and, for a validation error, an `instance` that is a field's id. Anything that is not an
// envelope gets a generic sentence: the raw message of an error nobody reviewed is never shown.

export type HostError = {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance?: string | undefined;
  readonly suggestions?: readonly string[] | undefined;
  readonly actions?: readonly FormAction[] | undefined;
  readonly code?: string | undefined;
  readonly requestId?: string | undefined;
  readonly recovery?: string | undefined;
  /** As the host wrote it: a list or a map; `mapHostError` reads it. */
  readonly fields?: unknown;
};

const RECOVERIES = ['correctRequest', 'refreshContract', 'restartQuery', 'reconnect', 'none'];
const ACTION_TYPES = ['navigate', 'retry', 'open-url', 'copy'] as const;
const VALIDATION = new Set(['omniview:validation', 'omniview:settings/invalid-config']);

const text = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= limit;

function envelopeOf(parsed: Record<string, unknown>): HostError | undefined {
  const { type, title, status, detail } = parsed;
  if (!text(type, 256) || !text(title, 256) || typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599 || typeof detail !== 'string' || detail.length > 4096) {
    return undefined;
  }

  const nested = decode(detail, 1);
  const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.filter((item): item is string => text(item, 512)).slice(0, 8) : undefined;
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions
      .filter((item): item is Record<string, unknown> => isObject(item) && !Array.isArray(item) && (ACTION_TYPES as readonly unknown[]).includes(item.type) && text(item.label, 256) && (item.target === undefined || text(item.target, 4096)))
      .map((item): FormAction => ({ type: item.type as FormAction['type'], label: item.label as string, ...(typeof item.target === 'string' ? { target: item.target } : {}) }))
      .slice(0, 8)
    : undefined;
  return {
    type,
    title,
    status,
    detail: nested === undefined ? detail : `${nested.title}: ${nested.detail}`,
    instance: text(parsed.instance, 512) ? parsed.instance : undefined,
    suggestions,
    actions,
    code: text(parsed.code, 64) ? parsed.code : undefined,
    requestId: text(parsed.requestId, 256) ? parsed.requestId : undefined,
    recovery: typeof parsed.recovery === 'string' && RECOVERIES.includes(parsed.recovery) ? parsed.recovery : undefined,
    fields: parsed.fields,
  };
}

function decode(raw: unknown, depth: number): HostError | undefined {
  if (depth > 6) {
    return undefined;
  }

  if (typeof raw === 'string') {
    const start = raw.indexOf('{');
    if (start < 0) {
      return undefined;
    }

    try {
      return decode(JSON.parse(raw.slice(start)), depth + 1);
    } catch {
      return undefined;
    }
  }

  if (!isObject(raw) || Array.isArray(raw)) {
    return undefined;
  }

  const direct = envelopeOf(raw);
  if (direct !== undefined) {
    return direct;
  }

  // A RuntimeError: the envelope is its cause, or its message (a string of JSON).
  const fromCause = raw.cause === undefined ? undefined : decode(raw.cause, depth + 1);
  return fromCause ?? (typeof raw.message === 'string' ? decode(raw.message, depth + 1) : undefined);
}

/** The apperror envelope in whatever the page was given (a string of JSON, an object, a `RuntimeError`), or nothing. Never throws. */
export function readHostError(raw: unknown): HostError | undefined {
  try {
    return decode(raw, 0);
  } catch {
    return undefined;
  }
}

export type FieldReason = { readonly text: string; readonly detail?: string | undefined; readonly code: IssueCode };

export type MapEnv = {
  /** Whether the form has a field with this id. */
  readonly has: (id: string) => boolean;
  /** Takes every secret out of a text. */
  readonly scrub: (text: string) => string;
  /** What to say of an error that is not the host's own. */
  readonly fallback: string;
};

export type Mapped = {
  readonly form: FormIssue;
  readonly fields: ReadonlyMap<string, FieldReason>;
  /** The call was cancelled (an abort, a cancel, the host's cancelled type): not a failure to show. */
  readonly cancelled: boolean;
};

const isCancellation = (raw: unknown): boolean => raw === 'cancelled' || (isObject(raw) && (raw.name === 'AbortError' || raw.name === 'CancelError'));

/** A text from the host made fit to show: scrubbed of the user's secrets, cleaned (a secret that cleaning would change is caught by the second pass), bounded. */
function safe(scrub: (text: string) => string, value: unknown, max: number): string {
  return typeof value === 'string' ? clip(scrub(cleanText(scrub(value), 4096)), max) : '';
}

function actionsOf(error: HostError, scrub: (text: string) => string): readonly FormAction[] {
  const out: FormAction[] = [];
  for (const action of error.actions ?? []) {
    const label = safe(scrub, action.label, 40);
    const target = action.target;
    if (label === '' || out.length >= 4) {
      continue;
    }

    if (action.type === 'retry') {
      out.push({ type: 'retry', label });
    } else if (target !== undefined && action.type === 'navigate' && /^(?:#\/|\/)/.test(target)) {
      out.push({ type: 'navigate', label, target: clip(target, 500) });
    } else if (target !== undefined && action.type === 'open-url' && /^https?:\/\//i.test(target)) {
      out.push({ type: 'open-url', label, target: clip(target, 500) });
    } else if (target !== undefined && action.type === 'copy' && scrub(target) === target) {
      out.push({ type: 'copy', label, target: clip(target, 500) });
    }
  }

  return out;
}

const reasonOf = (scrub: (text: string) => string, message: unknown, code: unknown): FieldReason | undefined => {
  const full = safe(scrub, message, 400);
  if (full === '') {
    return undefined;
  }

  const shown = clip(full, LIMITS.message);
  return { text: shown, ...(shown === full ? {} : { detail: full }), code: typeof code === 'string' && (ISSUE_CODES as readonly string[]).includes(code) ? (code as IssueCode) : 'rejected' };
};

/** The host's `fields` member: a list of `{ field | id | name, message | reason | detail, code? }`, or a map from a field's id to its sentence. */
function entriesOf(raw: unknown): ReadonlyArray<readonly [string, unknown, unknown]> {
  if (Array.isArray(raw)) {
    return raw.flatMap((entry): ReadonlyArray<readonly [string, unknown, unknown]> => {
      if (!isObject(entry) || Array.isArray(entry)) {
        return [];
      }

      const id = [entry.field, entry.id, entry.name].find((candidate): candidate is string => typeof candidate === 'string' && candidate !== '');
      return id === undefined ? [] : [[id, entry.message ?? entry.reason ?? entry.detail, entry.code]];
    });
  }

  return isObject(raw) ? Object.entries(raw).map(([id, message]): readonly [string, unknown, unknown] => [id, message, undefined]) : [];
}

const GENERIC_TITLE = 'Could not save';

/**
 * The host's error as the form shows it: the title and the sentence, suggestions, actions, recovery, the request id, the code; and the reasons by field. Never throws; an error that is
 * not the host's gets the generic sentence.
 */
export function mapHostError(raw: unknown, env: MapEnv): Mapped {
  const generic: FormIssue = { kind: 'error', title: GENERIC_TITLE, text: env.fallback, suggestions: [], actions: [] };
  try {
    if (isCancellation(raw)) {
      return { form: generic, fields: new Map(), cancelled: true };
    }

    const error = readHostError(raw);
    if (error === undefined) {
      return { form: generic, fields: new Map(), cancelled: false };
    }

    if (error.type === 'omniview:cancelled') {
      return { form: generic, fields: new Map(), cancelled: true };
    }

    const suggestions = (error.suggestions ?? []).map((line) => safe(env.scrub, line, 200)).filter((line) => line !== '');
    const fields = new Map<string, FieldReason>();
    for (const [id, message, code] of entriesOf(error.fields).slice(0, LIMITS.hostFields)) {
      const reason = reasonOf(env.scrub, message, code);
      if (reason === undefined) {
        continue;
      }

      if (env.has(id)) {
        fields.set(id, reason);
      } else {
        suggestions.push(`${safe(env.scrub, id, 64)}: ${reason.detail ?? reason.text}`);
      }
    }

    if (VALIDATION.has(error.type) && error.instance !== undefined && env.has(error.instance) && !fields.has(error.instance)) {
      const reason = reasonOf(env.scrub, error.detail, undefined);
      if (reason !== undefined) {
        fields.set(error.instance, reason);
      }
    }

    const title = safe(env.scrub, error.title, 120);
    const sentence = safe(env.scrub, error.detail, 400);
    const requestId = safe(env.scrub, error.requestId, 256);
    const code = safe(env.scrub, error.code, 64);
    return {
      form: {
        kind: 'error',
        title: title === '' ? GENERIC_TITLE : title,
        text: sentence === '' ? title : sentence,
        suggestions: suggestions.slice(0, 8).map((line) => clip(line, 200)),
        actions: actionsOf(error, env.scrub),
        ...(error.recovery === undefined ? {} : { recovery: error.recovery }),
        ...(requestId === '' ? {} : { requestId }),
        ...(code === '' ? {} : { code }),
      },
      fields,
      cancelled: false,
    };
  } catch {
    return { form: generic, fields: new Map(), cancelled: false };
  }
}
