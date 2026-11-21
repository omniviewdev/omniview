import { describe, expect, it } from 'vitest';
import { MIGRATIONS, restoreNotices, serialiseNotices } from './persist';
import { START } from './testing';
import { FOREVER, LIMITS, NOTICES_VERSION, type PersistedRecord } from './types';

// The history survives a restart (ch16 S74: "Records persist (at most 200, 7 days) and a record that was active reloads as unknown", and the lead's ruling of 2026-11-20 for the owner's decision B7: 500 records, 7 days; the mock's `reload`, shell-notify.js:704-725). The saved form
// carries its version and `migrate` (the tab model's) brings an older one up; what is read back is repaired rather than discarded: a damaged record is dropped alone. The old app has 36 stores
// that were never versioned; this is not the 37th.

const record = (extra: Partial<PersistedRecord> = {}): PersistedRecord => ({
  id: 'n1',
  kind: 'message',
  source: 'cloud',
  initiator: 'system',
  severity: 'info',
  state: 'succeeded',
  title: 'Snapshot created',
  doneTitle: '',
  detail: '40 GiB in us-east-1',
  details: '',
  fields: [],
  actions: [],
  count: 1,
  fold: '',
  attempt: 1,
  createdAt: START - 60_000,
  updatedAt: START - 60_000,
  finishedAt: START - 60_000,
  read: false,
  ...extra,
});

const document = (records: readonly unknown[], muted: unknown = {}): unknown => ({ version: NOTICES_VERSION, records, muted });

const restore = (raw: unknown, extra: { history?: number; age?: number } = {}) => restoreNotices(raw, { now: START, ...extra });

describe('serialiseNotices', () => {
  it('writes the version first, then the records and the mutes that have not ended', () => {
    const written = serialiseNotices([record()], new Map([['cloud', START + 1000], ['stack', START - 1]]), START);
    expect(Object.keys(written)).toEqual(['version', 'records', 'muted']);
    expect(written.version).toBe(NOTICES_VERSION);
    expect(written.muted).toEqual({ cloud: START + 1000 });
  });

  it('writes at most the history, newest first, and keeps what a record needs to draw before its plugin loads', () => {
    const many = Array.from({ length: LIMITS.history + 50 }, (_, index) => record({ id: `n${String(index)}`, createdAt: START - index }));
    const written = serialiseNotices(many, new Map(), START);
    expect(written.records).toHaveLength(500);
    expect(written.records[0]?.id).toBe('n0');
  });

  it('is plain JSON that comes back whole', () => {
    const written = serialiseNotices([record({ actions: [{ id: 'go', kind: 'open', label: 'Open it', route: { plugin: 'cloud', contribution: 'instances', params: { id: 'i-1' } } }] })], new Map(), START);
    const result = restore(JSON.parse(JSON.stringify(written)));
    expect(result.ok && result.records).toEqual(written.records);
  });
});

describe('restoreNotices: the way back', () => {
  it('reads a record that was written, and says nothing was repaired', () => {
    const result = restore(document([record()]));
    expect(result).toMatchObject({ ok: true, repaired: false, problems: [] });
    expect(result.ok && result.records).toEqual([record()]);
  });

  it('brings work that was running back as unknown, unread, with no progress and no way to cancel (S74)', () => {
    const result = restore(document([record({ id: 'op', kind: 'operation', state: 'running', severity: 'info', read: true, startedAt: START - 50_000, updatedAt: START - 40_000, finishedAt: undefined, title: 'Installing plugin cloud' })]));
    expect(result.ok && result.records[0]).toMatchObject({ id: 'op', state: 'unknown', severity: 'warning', read: false, title: 'Installing plugin cloud', finishedAt: START - 40_000 });
  });

  it('keeps what ended as it was, read or not', () => {
    const result = restore(document([record({ id: 'a', state: 'failed', kind: 'operation', severity: 'error', read: true }), record({ id: 'b', state: 'cancelled', kind: 'operation', severity: 'info', read: false })]));
    expect(result.ok && result.records.map((read) => [read.id, read.state, read.read])).toEqual([['a', 'failed', true], ['b', 'cancelled', false]]);
  });

  it('puts the newest first and leaves out one that repeats an id', () => {
    const result = restore(document([record({ id: 'old', createdAt: START - 90_000 }), record({ id: 'new', createdAt: START - 10_000 }), record({ id: 'new', createdAt: START - 5000 })]));
    expect(result.ok && result.records.map((read) => read.id)).toEqual(['new', 'old']);
    expect(result).toMatchObject({ repaired: true });
  });

  it('drops a record older than seven days, and keeps one that is six days old', () => {
    const day = 86_400_000;
    const result = restore(document([record({ id: 'old', createdAt: START - (8 * day), updatedAt: START - (8 * day), finishedAt: START - (8 * day) }), record({ id: 'recent', createdAt: START - (6 * day), updatedAt: START - (6 * day), finishedAt: START - (6 * day) })]));
    expect(result.ok && result.records.map((read) => read.id)).toEqual(['recent']);
  });

  it('keeps the newest five hundred and says it dropped the rest', () => {
    const many = Array.from({ length: 600 }, (_, index) => record({ id: `n${String(index)}`, createdAt: START - 1000 - index }));
    const result = restore(document(many));
    expect(result.ok && result.records).toHaveLength(500);
    expect(result.ok && result.records[0]?.id).toBe('n0');
    expect(result).toMatchObject({ repaired: true });
  });

  it('keeps a record\'s history bound as it is told, so the decision of B7 is one number', () => {
    const many = Array.from({ length: 10 }, (_, index) => record({ id: `n${String(index)}`, createdAt: START - 1000 - index }));
    const result = restore(document(many), { history: 3 });
    expect(result.ok && result.records).toHaveLength(3);
  });

  it('cuts diagnostics to what is kept of them, and repairs a count and an attempt that are not numbers', () => {
    const result = restore(document([record({ details: 'x'.repeat(20_000), count: -3, attempt: 0 })]));
    expect(result.ok && result.records[0]).toMatchObject({ count: 1, attempt: 1 });
    expect(result.ok && result.records[0]?.details).toHaveLength(LIMITS.storedDetails);
  });

  it('drops a record that is not a record, with a problem that says which, and keeps every other', () => {
    const result = restore(document([record({ id: 'a' }), 'x', null, 4, { id: 'b' }, { ...record({ id: 'c' }), state: 'sleeping' }, { ...record({ id: 'd' }), kind: 'thing' }, { ...record({ id: 'e' }), title: '' }, { ...record({ id: 'f' }), createdAt: 'yesterday' }, record({ id: 'ok' })]));
    expect(result.ok && result.records.map((read) => read.id).sort()).toEqual(['a', 'ok']);
    expect(result.ok && result.problems.length).toBe(8);
  });

  it('repairs a field that is wrong and keeps the record: a severity, a source, a read flag', () => {
    const result = restore(document([{ ...record(), severity: 'loud', source: 7, read: 'yes', initiator: 'robot', fold: 'weird' }]));
    expect(result.ok && result.records[0]).toMatchObject({ severity: 'info', source: 'host', read: false, initiator: 'system', fold: '' });
  });

  it('drops an action that is not valid data and keeps the record and the other actions', () => {
    const good = { id: 'go', kind: 'open', label: 'Open it', route: { plugin: 'cloud', contribution: 'instances', params: {} } };
    const result = restore(document([record({ actions: [good, { id: 'bad', kind: 'open', label: 'Bad', route: { plugin: '', contribution: '' } }, { id: 'cmd', kind: 'custom', label: 'Do', command: { id: '' } }, 'x', { id: 'ok', kind: 'custom', label: 'Fix' }] as unknown as PersistedRecord['actions'] })]));
    expect(result.ok && result.records[0]?.actions.map((action) => action.id)).toEqual(['go', 'ok']);
  });

  it('keeps a route as plain data it owns, and an action of code with no code to run (it is shown disabled when drawn)', () => {
    const result = restore(document([record({ actions: [{ id: 'fix', kind: 'custom', label: 'Fix', primary: true }] })]));
    expect(result.ok && result.records[0]?.actions[0]).toMatchObject({ id: 'fix', primary: true });
  });

  it('keeps the model\'s own Mute action', () => {
    const result = restore(document([record({ fold: 'rate', count: 40, actions: [{ id: 'mute', kind: 'custom', label: 'Mute for 1 hour', builtin: 'mute' }] })]));
    expect(result.ok && result.records[0]?.actions[0]?.builtin).toBe('mute');
  });

  it('is nothing for a list that is not a list', () => {
    expect(restore({ version: NOTICES_VERSION, records: 'nope', muted: {} })).toMatchObject({ ok: true, records: [], repaired: true });
  });

  it('reads at most as many entries as could ever be kept: a document with fifty thousand junk entries is not worked through', () => {
    const junk = Array.from({ length: 50_000 }, () => 'x');
    const started = performance.now();
    const result = restore(document(junk));
    expect(result.ok && result.records).toEqual([]);
    expect(performance.now() - started).toBeLessThan(250);
  });
});

describe('the mutes', () => {
  it('keeps one that has not ended and one that does not', () => {
    const result = restore(document([], { cloud: START + 5000, stack: FOREVER }));
    expect(result.ok && result.muted).toEqual({ cloud: START + 5000, stack: FOREVER });
  });

  it('drops one that ended, and what is not a time', () => {
    const result = restore(document([], { a: START - 1, b: 'x', c: Number.NaN, d: null, e: START + 1 }));
    expect(result.ok && result.muted).toEqual({ e: START + 1 });
  });

  it('is nothing for a value that is not an object', () => {
    expect(restore(document([], 7))).toMatchObject({ ok: true, muted: {} });
    expect(restore({ version: NOTICES_VERSION, records: [] })).toMatchObject({ ok: true, muted: {} });
  });

  it('keeps at most two hundred sources', () => {
    const many = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`p${String(index)}`, START + 1000]));
    const result = restore(document([], many));
    expect(result.ok && Object.keys(result.muted)).toHaveLength(200);
  });
});

describe('the version', () => {
  it('says nothing saved is missing', () => {
    expect(restore(undefined)).toMatchObject({ ok: false, reason: 'missing' });
    expect(restore(null)).toMatchObject({ ok: false, reason: 'missing' });
  });

  it('says what is not a versioned document is unreadable', () => {
    expect(restore('x{')).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(restore({ records: [] })).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(restore({ version: '1', records: [] })).toMatchObject({ ok: false, reason: 'unreadable' });
  });

  it('never half uses a document of a newer version', () => {
    expect(restore({ version: NOTICES_VERSION + 1, records: [record()] })).toMatchObject({ ok: false, reason: 'foreign-version' });
  });

  it('brings an older version up one step at a time with the migrations it is given', () => {
    const steps = { 0: (value: Record<string, unknown>) => ({ ...value, version: 1, records: Array.isArray(value.items) ? value.items : [], muted: {} }) };
    const result = restoreNotices({ version: 0, items: [record()] }, { now: START, current: 1, steps });
    expect(result.ok && result.records).toHaveLength(1);
    expect(restoreNotices({ version: 0, items: [] }, { now: START, current: 1, steps: {} })).toMatchObject({ ok: false, reason: 'foreign-version' });
  });

  it('starts with no migrations: the first release has nothing to migrate from', () => {
    expect(MIGRATIONS).toEqual({});
  });
});
