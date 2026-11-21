import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoticeInput } from '../core/notices';
import { makeNotices, type Fixture } from '../core/notices/testing';
import type { Lifecycle } from '../session';
import { loadNotices, NOTICES_SLOT, noticesStorage, QUARANTINE_PREFIX, type NoticesStorage } from './storage';

// The history survives a restart (ch16 S74; the model's `serialise` and `restoreNotices`, core/notices/persist.ts): where it is kept (the host's window service, a slot of its own), how it is read before the window
// draws, what happens to a text that cannot be used (kept aside, never deleted, never written over), and the saving, one burst at a time. The shape follows the session's (`shell/session`), which has the same promises.

const NOW = 1_700_000_000_000;

type Fake = NoticesStorage & {
  readonly slots: Map<string, string>;
  readonly writes: string[];
  readonly gate: { write: Promise<void> | undefined; fail: boolean; failKeep: boolean };
};

/** A place to keep text: the slots of a window, with the failures a test asks for. */
function fakeStorage(saved?: string): Fake {
  const slots = new Map<string, string>(saved === undefined ? [] : [[NOTICES_SLOT, saved]]);
  const writes: string[] = [];
  const gate: Fake['gate'] = { write: undefined, fail: false, failKeep: false };
  return {
    slots,
    writes,
    gate,
    read: async () => Promise.resolve(slots.get(NOTICES_SLOT)),
    write: async (text) => {
      await gate.write;
      if (gate.fail) {
        throw new Error('the disk is full');
      }

      writes.push(text);
      slots.set(NOTICES_SLOT, text);
    },
    keep: async (name, text) => {
      if (gate.failKeep) {
        return Promise.reject(new Error('nowhere to keep it'));
      }

      slots.set(name, text);
      return Promise.resolve();
    },
  };
}

/** The page's own lifecycle, driven by the test: `hide()` is the page going away. */
function fakeLifecycle(): { readonly lifecycle: Lifecycle; readonly hide: () => void; readonly listening: () => boolean } {
  let listener: (() => void) | undefined;
  return {
    lifecycle: {
      onHide: (callback) => {
        listener = callback;
        return () => {
          listener = undefined;
        };
      },
    },
    hide: () => {
      listener?.();
    },
    listening: () => listener !== undefined,
  };
}

/** A history that was saved by a model: a failure, a message and a mute. */
function savedText(): string {
  const source = makeNotices();
  source.store.notify({ title: 'Timed out', detail: 'The cluster did not answer.', severity: 'error', source: 'cloud' });
  source.store.notify({ title: 'Snapshot created', severity: 'success', source: 'stack' });
  source.store.mute('cloud');
  return JSON.stringify(source.store.serialise());
}

/** A saved text read as the plain object it is, so that what a test says of it is checked and not assumed. */
function docOf(text: string | undefined): Record<string, unknown> {
  const value: unknown = JSON.parse(text ?? 'null');
  if (typeof value !== 'object' || value === null) {
    throw new Error(`not an object: ${String(text)}`);
  }

  return Object.fromEntries(Object.entries(value));
}

/** How many records a saved text holds. */
function countOf(text: string | undefined): number {
  const records = docOf(text).records;
  return Array.isArray(records) ? records.length : -1;
}

const quiet = () => ({ now: () => NOW, log: vi.fn() });

/** Posts a notice and lets the model end its frame: it tells its listeners at most once a frame, and a store over a clock that stands still never ends one. */
async function tell(f: Fixture, spec: NoticeInput): Promise<void> {
  f.store.notify(spec);
  await f.clock.advance(16);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('noticesStorage', () => {
  it('keeps the history in the slot `notices` of the window the page is in', async () => {
    const calls: string[] = [];
    let named = 0;
    const storage = noticesStorage({
      client: {
        GetState: async (name) => Promise.resolve({ [NOTICES_SLOT]: `read from ${name}`, session: 'not ours' }),
        SaveState: async (name, slot, json) => {
          calls.push(`${name}|${slot}|${json}`);
          return Promise.resolve();
        },
      },
      name: async () => {
        named += 1;
        return Promise.resolve('main');
      },
    });
    expect(await storage.read()).toBe('read from main');
    await storage.write('{"version":1}');
    await storage.keep(`${QUARANTINE_PREFIX}7`, 'a text');
    expect(calls).toEqual(['main|notices|{"version":1}', 'main|notices.invalid.7|"a text"']);
    expect(named).toBe(1);
  });

  it('reads nothing when the slot holds nothing', async () => {
    const storage = noticesStorage({ client: { GetState: async () => Promise.resolve({}), SaveState: async () => Promise.resolve() }, name: async () => Promise.resolve('main') });
    expect(await storage.read()).toBeUndefined();
  });

  it('asks the window\'s name again after it failed to say it', async () => {
    let tries = 0;
    const storage = noticesStorage({
      client: { GetState: async () => Promise.resolve({}), SaveState: async () => Promise.resolve() },
      name: async () => {
        tries += 1;
        return tries === 1 ? Promise.reject(new Error('not yet')) : Promise.resolve('main');
      },
    });
    await expect(storage.read()).rejects.toThrow('not yet');
    expect(await storage.read()).toBeUndefined();
    expect(tries).toBe(2);
  });
});

describe('loadNotices: what the window starts from', () => {
  it('starts with no history when nothing was saved, and saves from then on', async () => {
    const storage = fakeStorage();
    const loaded = await loadNotices(storage, quiet());
    expect(loaded.initial).toBeUndefined();
    const f = makeNotices();
    const { lifecycle } = fakeLifecycle();
    const stop = loaded.attach(f.store, { lifecycle });
    await tell(f, { title: 'Snapshot created' });
    expect(storage.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(400);
    expect(storage.writes).toHaveLength(1);
    expect(docOf(storage.writes[0])).toEqual(docOf(JSON.stringify(f.store.serialise())));
    stop();
  });

  it('restores what was saved: the records and the mutes that have not ended', async () => {
    const loaded = await loadNotices(fakeStorage(savedText()), { now: () => NOW + 1000, log: vi.fn() });
    expect(loaded.initial?.records.map((record) => record.title).sort()).toEqual(['Snapshot created', 'Timed out']);
    expect(Object.keys(loaded.initial?.muted ?? {})).toEqual(['cloud']);
  });

  it('drops a mute that has ended, and says what was repaired', async () => {
    const log = vi.fn();
    const loaded = await loadNotices(fakeStorage(savedText()), { now: () => NOW + 2 * 3_600_000, log });
    expect(loaded.initial?.muted).toEqual({});
    expect(log).not.toHaveBeenCalled();
  });

  it('puts a text that is not JSON aside, whole, under a name of its own, starts empty and then replaces what was there', async () => {
    const storage = fakeStorage('this is {not json');
    const log = vi.fn();
    const loaded = await loadNotices(storage, { now: () => NOW, log });
    await vi.advanceTimersByTimeAsync(0);
    expect(loaded.initial).toBeUndefined();
    const aside = docOf(storage.slots.get(`${QUARANTINE_PREFIX}${String(NOW)}`));
    expect(aside).toMatchObject({ version: 1, at: NOW, reason: 'unreadable', text: 'this is {not json' });
    expect(typeof aside.detail).toBe('string');
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain(`${QUARANTINE_PREFIX}${String(NOW)}`);
    const f = makeNotices();
    const stop = loaded.attach(f.store, { lifecycle: fakeLifecycle().lifecycle });
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.writes).toHaveLength(1);
    expect(docOf(storage.slots.get(NOTICES_SLOT))).toMatchObject({ version: 1, records: [] });
    stop();
  });

  it('puts a document of a newer version aside, and starts empty: it is never half used and never replaced unkept', async () => {
    const storage = fakeStorage(JSON.stringify({ version: 99, records: [{ id: 'x' }], muted: {} }));
    const loaded = await loadNotices(storage, quiet());
    await vi.advanceTimersByTimeAsync(0);
    expect(loaded.initial).toBeUndefined();
    const aside = docOf(storage.slots.get(`${QUARANTINE_PREFIX}${String(NOW)}`));
    expect(aside).toMatchObject({ reason: 'foreign-version', at: NOW });
  });

  it('treats JSON that is not a document as a text that cannot be used', async () => {
    const storage = fakeStorage('42');
    const loaded = await loadNotices(storage, quiet());
    await vi.advanceTimersByTimeAsync(0);
    expect(loaded.initial).toBeUndefined();
    expect(storage.slots.has(`${QUARANTINE_PREFIX}${String(NOW)}`)).toBe(true);
  });

  it('repairs a document with one bad record and keeps the rest, without putting anything aside', async () => {
    const good = docOf(savedText());
    const storage = fakeStorage(JSON.stringify({ ...good, records: [...(Array.isArray(good.records) ? good.records : []), { id: 'broken' }] }));
    const log = vi.fn();
    const loaded = await loadNotices(storage, { now: () => NOW + 1000, log });
    expect(loaded.initial?.records).toHaveLength(2);
    expect([...storage.slots.keys()]).toEqual([NOTICES_SLOT]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('saves nothing, ever, when the text that cannot be used could not be put aside: a write would replace the only copy', async () => {
    const storage = fakeStorage('this is {not json');
    storage.gate.failKeep = true;
    const log = vi.fn();
    const loaded = await loadNotices(storage, { now: () => NOW, log });
    await vi.advanceTimersByTimeAsync(0);
    expect(loaded.initial).toBeUndefined();
    const f = makeNotices();
    const stop = loaded.attach(f.store, { lifecycle: fakeLifecycle().lifecycle });
    await tell(f, { title: 'Snapshot created' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(storage.writes).toEqual([]);
    expect(storage.slots.get(NOTICES_SLOT)).toBe('this is {not json');
    expect(String(log.mock.calls.at(-1)?.[0])).toContain('does not save');
    stop();
  });

  it('starts empty and saves nothing when the place cannot be read: what it holds is not known', async () => {
    const storage = fakeStorage(savedText());
    const log = vi.fn();
    const loaded = await loadNotices({ ...storage, read: async () => Promise.reject(new Error('the service is down')) }, { now: () => NOW, log });
    expect(loaded.initial).toBeUndefined();
    const f = makeNotices();
    const stop = loaded.attach(f.store, { lifecycle: fakeLifecycle().lifecycle });
    await tell(f, { title: 'Snapshot created' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(storage.writes).toEqual([]);
    expect(String(log.mock.calls[0]?.[0])).toContain('the service is down');
    stop();
  });

  it('does not wait for a place that never answers: after the deadline it starts empty and saves nothing', async () => {
    const storage = fakeStorage();
    const log = vi.fn();
    const pending = loadNotices({ ...storage, read: async () => Promise.withResolvers<string | undefined>().promise }, { now: () => NOW, log, deadline: 50 });
    await vi.advanceTimersByTimeAsync(50);
    const loaded = await pending;
    expect(loaded.initial).toBeUndefined();
    expect(String(log.mock.calls[0]?.[0])).toContain('50 ms');
    const f = makeNotices();
    const stop = loaded.attach(f.store, { lifecycle: fakeLifecycle().lifecycle });
    await tell(f, { title: 'Snapshot created' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(storage.writes).toEqual([]);
    stop();
  });
});

describe('the saving', () => {
  it('writes once for a burst of changes, 400 ms after the last, and not at all for a change that comes back to what was saved', async () => {
    const storage = fakeStorage();
    const loaded = await loadNotices(storage, quiet());
    const f = makeNotices();
    const stop = loaded.attach(f.store, { lifecycle: fakeLifecycle().lifecycle });
    await tell(f, { title: 'One' });
    await vi.advanceTimersByTimeAsync(300);
    await tell(f, { title: 'Two', source: 'stack' });
    await vi.advanceTimersByTimeAsync(399);
    expect(storage.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(storage.writes).toHaveLength(1);
    expect(countOf(storage.writes[0])).toBe(2);
    stop();
  });

  it('writes what is owed at once when the page is hidden, and the stop function writes it too and stops listening', async () => {
    const storage = fakeStorage();
    const loaded = await loadNotices(storage, quiet());
    const f = makeNotices();
    const page = fakeLifecycle();
    const stop = loaded.attach(f.store, { lifecycle: page.lifecycle });
    await tell(f, { title: 'One' });
    page.hide();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.writes).toHaveLength(1);
    await tell(f, { title: 'Two', source: 'stack' });
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.writes).toHaveLength(2);
    expect(page.listening()).toBe(false);
    await tell(f, { title: 'Three', source: 'other' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(storage.writes).toHaveLength(2);
  });

  it('writes one at a time, in order: a write starts after the one before it has answered', async () => {
    const storage = fakeStorage();
    const loaded = await loadNotices(storage, quiet());
    const gate = Promise.withResolvers<void>();
    storage.gate.write = gate.promise;
    const f = makeNotices();
    const stop = loaded.attach(f.store, { lifecycle: fakeLifecycle().lifecycle });
    await tell(f, { title: 'One' });
    await vi.advanceTimersByTimeAsync(400);
    await tell(f, { title: 'Two', source: 'stack' });
    await vi.advanceTimersByTimeAsync(400);
    expect(storage.writes).toEqual([]);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.writes.map(countOf)).toEqual([1, 2]);
    stop();
  });

  it('says a write that failed, never throws into the window, and writes the then-current history at the next change', async () => {
    const storage = fakeStorage();
    const log = vi.fn();
    const loaded = await loadNotices(storage, { now: () => NOW, log });
    const f = makeNotices();
    const stop = loaded.attach(f.store, { lifecycle: fakeLifecycle().lifecycle });
    storage.gate.fail = true;
    await tell(f, { title: 'One' });
    await vi.advanceTimersByTimeAsync(400);
    expect(String(log.mock.calls.at(-1)?.[0])).toContain('the disk is full');
    storage.gate.fail = false;
    await tell(f, { title: 'Two', source: 'stack' });
    await vi.advanceTimersByTimeAsync(400);
    expect(storage.writes).toHaveLength(1);
    expect(countOf(storage.writes[0])).toBe(2);
    stop();
  });

  it('is the history the model restores: what was written reads back whole', async () => {
    const storage = fakeStorage();
    const loaded = await loadNotices(storage, quiet());
    const f = makeNotices();
    const stop = loaded.attach(f.store, { lifecycle: fakeLifecycle().lifecycle });
    await tell(f, { title: 'Timed out', detail: 'The cluster did not answer.', severity: 'error', source: 'cloud' });
    f.store.mute('stack');
    await f.clock.advance(16);
    await vi.advanceTimersByTimeAsync(400);
    stop();
    const again = await loadNotices(storage, { now: () => NOW + 1000, log: vi.fn() });
    expect(again.initial?.records.map((record) => [record.title, record.detail, record.severity])).toEqual([['Timed out', 'The cluster did not answer.', 'error']]);
    expect(Object.keys(again.initial?.muted ?? {})).toEqual(['stack']);
  });
});
