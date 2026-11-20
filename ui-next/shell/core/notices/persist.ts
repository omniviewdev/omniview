import { isObject, isPlainObject, strictJson } from '../tabs/json';
import { migrate, type Migration } from '../tabs/persist';
import { normaliseRoute } from '../tabs/route';
import { commandOf } from './actions';
import { normFields, normSeverity, normSource } from './normalise';
import { deriveSeverity, isActive, maxSeverity } from './policy';
import { block, line } from './text';
import { LIMITS, NOTICES_VERSION, STATES, type ActionKind, type FoldKind, type PersistedAction, type PersistedNotices, type PersistedRecord } from './types';

// The history survives a restart (ch16 S74: "Records persist (at most 200, 7 days) and a record that was active reloads as unknown"; the mock's `reload`). The saved form carries its version and
// `migrate` (the tab model's) brings an older one up; what is read back is repaired rather than discarded: a damaged record is dropped alone and the rest is kept. The old app has 36 stores that
// were never versioned; this is not the 37th. What is not saved: the code of an action (it cannot survive a restart: the action comes back disabled, with its reason, S84), the origin of the
// work (a hint, P5), a toast (a restored record raises none) and the progress of work that was running (it is unknown now).

/** The steps from every older version, keyed by the version they start from. Empty at version 1: the first release has nothing to migrate from. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({});

/** The most mutes kept: a source for each plugin there could ever be. */
const MUTES = 200;

/** A document may hold more than could ever be kept: only this many times the history is read. */
const READ_FACTOR = 5;

const KINDS: readonly ActionKind[] = ['cancel', 'retry', 'open', 'custom'];
const FOLDS: readonly FoldKind[] = ['', 'group', 'repeat', 'key', 'rate'];

/** What the session saves: the records newest first, at most the history, and the mutes that have not ended. */
export function serialiseNotices(records: readonly PersistedRecord[], muted: ReadonlyMap<string, number>, now: number, history: number = LIMITS.history): PersistedNotices {
  return {
    version: NOTICES_VERSION,
    records: records.slice(0, history),
    muted: Object.fromEntries([...muted].filter(([, until]) => until > now)),
  };
}

export type RestoreOptions = {
  /** Milliseconds since the epoch: the age of a record, and the end of a mute, are measured from it. */
  readonly now: number;
  /** The version this build reads. Default: `NOTICES_VERSION`. A seam for the test of a migration. */
  readonly current?: number | undefined;
  readonly steps?: Readonly<Record<number, Migration>> | undefined;
  /** Records kept. Default `LIMITS.history`. */
  readonly history?: number | undefined;
  /** How old a record may be, in milliseconds. Default `LIMITS.age`. */
  readonly age?: number | undefined;
};

export type RestoreResult =
  | { readonly ok: true; readonly records: readonly PersistedRecord[]; readonly muted: Readonly<Record<string, number>>; /** Something was dropped or fixed. */ readonly repaired: boolean; readonly problems: readonly string[] }
  | { readonly ok: false; readonly reason: 'missing' | 'unreadable' | 'foreign-version'; readonly detail: string };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const whole = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : 1);

/** One saved action, read; `undefined` when it cannot be. The code of an action is not saved, so a command of code reads back as data with nothing behind it. */
function readAction(entry: unknown): PersistedAction | undefined {
  if (!isPlainObject(entry) || typeof entry.id !== 'string' || entry.id.trim() === '') {
    return undefined;
  }

  const kind = KINDS.find((candidate) => candidate === entry.kind);
  const label = line(entry.label, LIMITS.actionLabel);
  if (kind === undefined || label === '') {
    return undefined;
  }

  const route = entry.route === undefined ? undefined : normaliseRoute(entry.route);
  const command = entry.command === undefined ? undefined : commandOf(entry.command);
  if ((entry.route !== undefined && route === undefined) || (entry.command !== undefined && command === undefined)) {
    return undefined;
  }

  const reveal = route !== undefined && entry.reveal !== undefined ? strictJson(entry.reveal) : undefined;
  const icon = line(entry.icon, 64);
  const disabled = line(entry.disabled, 80);
  return {
    id: entry.id.trim().slice(0, LIMITS.key),
    kind,
    label,
    ...(route === undefined ? {} : { route }),
    ...(reveal === undefined ? {} : { reveal }),
    ...(command === undefined ? {} : { command }),
    ...(entry.primary === true ? { primary: true } : {}),
    ...(entry.danger === true ? { danger: true } : {}),
    ...(icon === '' ? {} : { icon }),
    ...(disabled === '' ? {} : { disabled }),
    ...(entry.builtin === 'mute' ? { builtin: 'mute' as const } : {}),
  };
}

/** One saved record, read; `undefined` when it cannot be (said to `note`, once). A field that is wrong is made right: it is the id, the kind, the state, the title and the time that make a record. */
function readRecord(entry: unknown, note: (why: string) => void): PersistedRecord | undefined {
  if (!isPlainObject(entry)) {
    note('is not an object');
    return undefined;
  }

  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  if (id === '' || id.length > 64) {
    note('has no id');
    return undefined;
  }

  const kind = entry.kind === 'message' || entry.kind === 'operation' ? entry.kind : undefined;
  if (kind === undefined) {
    note('has no valid kind');
    return undefined;
  }

  const state = STATES.find((candidate) => candidate === entry.state);
  if (state === undefined) {
    note('has no valid state');
    return undefined;
  }

  const title = line(entry.title, LIMITS.title);
  if (title === '') {
    note('has no title');
    return undefined;
  }

  if (!finite(entry.createdAt) || entry.createdAt <= 0) {
    note('has no valid time');
    return undefined;
  }

  const createdAt = entry.createdAt;
  const updatedAt = finite(entry.updatedAt) ? entry.updatedAt : createdAt;
  const startedAt = finite(entry.startedAt) ? entry.startedAt : undefined;
  const ended = finite(entry.finishedAt) ? entry.finishedAt : undefined;
  const raised = isObject(entry) && typeof entry.raised === 'string' ? normSeverity(entry.raised, 'info') : undefined;
  const wasActive = isActive(state);
  const finalState = wasActive ? 'unknown' : state;
  const target = isPlainObject(entry.target) && typeof entry.target.label === 'string' && line(entry.target.label, 60) !== ''
    ? { label: line(entry.target.label, 60), kind: line(entry.target.kind, 24).toLowerCase(), ...(entry.target.route === undefined || normaliseRoute(entry.target.route) === undefined ? {} : { route: normaliseRoute(entry.target.route) }), ...(entry.target.removed === true ? { removed: true } : {}) }
    : undefined;
  const actions: PersistedAction[] = [];
  const ids = new Set<string>();
  for (const candidate of Array.isArray(entry.actions) ? (entry.actions as readonly unknown[]) : []) {
    const action = readAction(candidate);
    if (action !== undefined && !ids.has(action.id) && actions.length < LIMITS.actions) {
      ids.add(action.id);
      actions.push(action);
    }
  }

  const posted = normSeverity(entry.severity);
  return {
    id,
    kind,
    source: normSource(entry.source),
    initiator: entry.initiator === 'user' ? 'user' : 'system',
    severity: wasActive ? maxSeverity('warning', raised ?? 'info') : deriveSeverity(kind, finalState, posted, raised),
    state: finalState,
    title,
    doneTitle: line(entry.doneTitle, LIMITS.title),
    detail: line(entry.detail, LIMITS.detail),
    details: block(entry.details, LIMITS.storedDetails),
    ...(target === undefined ? {} : { target }),
    fields: normFields(entry.fields),
    actions,
    count: whole(entry.count),
    fold: FOLDS.find((candidate) => candidate === entry.fold) ?? '',
    attempt: whole(entry.attempt),
    createdAt,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(wasActive ? { finishedAt: Math.max(updatedAt, startedAt ?? 0) } : ended === undefined ? {} : { finishedAt: ended }),
    updatedAt,
    read: wasActive ? false : entry.read === true,
    ...(raised === undefined ? {} : { raised }),
  };
}

/**
 * Reads a saved document back. Nothing saved is `missing`; text that is not a versioned document is `unreadable`; a version newer than this build, or older with no way up, is `foreign-version`:
 * it is never half used. A record that cannot be read is dropped alone, with a problem that says which; work that was running comes back unknown (S74); a record older than the history keeps, or
 * beyond its bound, is dropped; a mute that ended is dropped. Only as many entries as could ever be kept are read.
 */
export function restoreNotices(raw: unknown, options: RestoreOptions): RestoreResult {
  const migrated = migrate(raw, { current: options.current ?? NOTICES_VERSION, steps: options.steps ?? MIGRATIONS });
  if (!migrated.ok) {
    return migrated;
  }

  const history = options.history ?? LIMITS.history;
  const age = options.age ?? LIMITS.age;
  const problems: string[] = [];
  const listed: unknown = migrated.value.records;
  const kept: PersistedRecord[] = [];
  if (!Array.isArray(listed)) {
    problems.push('the list of records is not a list');
  } else {
    const entries = listed as readonly unknown[];
    const seen = new Set<string>();
    let expired = 0;
    entries.slice(0, history * READ_FACTOR).forEach((entry, index) => {
      const read = readRecord(entry, (why) => problems.push(`record ${String(index)} ${why}`));
      if (read === undefined) {
        return;
      }

      if (options.now - Math.max(read.updatedAt, read.finishedAt ?? 0) > age) {
        expired += 1;
        return;
      }

      if (seen.has(read.id)) {
        problems.push(`record ${String(index)} repeats an id`);
        return;
      }

      seen.add(read.id);
      kept.push(read);
    });
    if (entries.length > history * READ_FACTOR) {
      problems.push(`there were more than ${String(history * READ_FACTOR)} records: the rest were not read`);
    }

    if (expired > 0) {
      problems.push(`${String(expired)} records were older than the history keeps`);
    }
  }

  kept.sort((a, b) => b.createdAt - a.createdAt);
  if (kept.length > history) {
    problems.push(`there were more than ${String(history)} records`);
  }

  const muted: Record<string, number> = {};
  const saved: unknown = migrated.value.muted;
  if (isPlainObject(saved)) {
    let count = 0;
    for (const [source, until] of Object.entries(saved)) {
      if (count < MUTES && source !== '' && source.length <= LIMITS.source && finite(until) && until > options.now) {
        muted[source] = until;
        count += 1;
      }
    }
  }

  return { ok: true, records: Object.freeze(kept.slice(0, history)), muted: Object.freeze(muted), repaired: problems.length > 0, problems };
}
