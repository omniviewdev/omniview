import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkInvariants, createSaver, createTabsStore, LIMITS, migrate, restoreTabs, serialise, STATE_VERSION, type Contributions, type PersistedTabs, type Route } from './index';
import { boot, cloudPage, hostPage, makeWorld, stackPage, tabOf, type Harness, type World } from './testing';

// The saved session (ch16 S32, S150) and what a damaged one becomes. The state carries a version and `migrate` exists from the first release: the old app has 36
// stores that were never versioned. Ported from the design lab's harness (tests/shell-model-harness/R2Store/unit.cjs): the round trip, the foreign-version and
// unusable store, the repaired session, the plugin's `restore` hook, and the mutation fuzz of 600 damaged sessions.

const sound = (h: Harness) => {
  expect(checkInvariants(h.state())).toEqual([]); 
};

const tab = tabOf;
const restore = (raw: unknown, world: World) => restoreTabs(raw, { contributions: world.contributions });
const restored = (raw: unknown, world: World) => {
  const result = restore(raw, world);
  if (!result.ok) {
    throw new Error(`not restored: ${result.reason}: ${result.detail}`);
  }

  return result;
};

const route = (contribution: string, params: Record<string, unknown> = {}, plugin = 'cloud') => ({ plugin, contribution, params });
/** A saved tab as the session writes it, with only what a test needs. */
const saved = (id: string, contribution: string, extra: Record<string, unknown> = {}, plugin = 'cloud') => ({ id, route: route(contribution, {}, plugin), ...extra });
const doc = (tabs: unknown[], active: unknown = null) => ({ version: STATE_VERSION, active, tabs });

describe('the saved session', () => {
  it('is plain data that starts with its version, and holds the tabs, their flags and a window of their history, and no page state', () => {
    const h = boot({ home: false });
    const first = h.open(cloudPage('instances'));
    h.openAll(['buckets', 'volumes']);
    h.store.pin(first);
    h.store.setPageState(first, { scroll: 40 });
    h.store.setUnsaved(first, true);
    const doc1 = h.store.serialise();
    expect(Object.keys(doc1)[0]).toBe('version');
    expect(doc1.version).toBe(STATE_VERSION);
    expect(doc1).toEqual(serialise(h.state()));
    expect(JSON.parse(JSON.stringify(doc1))).toEqual(doc1);
    expect(doc1.tabs.map((entry) => entry.id)).toEqual(h.ids());
    expect(doc1.active).toBe(h.active());
    for (const entry of doc1.tabs) {
      expect(Object.keys(entry).sort()).toEqual(['face', 'history', 'id', 'key', 'pinned', 'preview', 'route']);
    }
  });

  it('comes back as it was: order, pins, the tab on screen, titles, keys, preview, and a history window of 10 around the current entry', () => {
    const first = boot({ home: false });
    const a = first.open(cloudPage('instances', { region: 'r1' }));
    const [b0, b1] = first.openAll(['buckets', 'volumes']);
    first.store.pin(a);
    first.open(stackPage('services'));
    // A page of another plugin than the one on screen, from a search: a new preview tab.
    const preview = first.open(cloudPage('snapshots'), { source: 'search' });
    expect(tab(first, preview).flags.preview).toBe(true);
    for (let i = 0; i < 14; i += 1) {
      first.store.navigate(b0 ?? '', cloudPage('buckets', { item: `i-${i}` }));
    }

    first.store.activate(b1 ?? '');
    const result = restored(JSON.parse(JSON.stringify(first.store.serialise())), first.world);
    expect(result.repaired).toBe(false);
    expect(result.problems).toEqual([]);

    const second = boot({ home: false, initial: result.state, world: first.world });
    const view = (h: Harness) => h.ids().map((id) => [tab(h, id).face.title, tab(h, id).location.key, tab(h, id).flags.pinned, tab(h, id).flags.preview]);
    expect(view(second)).toEqual(view(first));
    expect(second.active()).toBe(first.active());
    expect(second.state().tabs[preview]?.flags.preview).toBe(true);

    // The history window of the tab that moved 14 times kept its current entry, and 9 before it.
    const long = tab(second, b0 ?? '').history;
    expect([long.entries.length, long.index]).toEqual([LIMITS.persistedHistory, 9]);
    expect(long.entries[9]?.params.item).toBe('i-13');

    // What is only for now is not saved: page state, the mounted pages, closed tabs, a reveal request, unsaved and attention.
    expect(second.state().mounted).toEqual([second.current()]);
    expect(second.state().closed).toEqual([]);
    expect(tab(second, second.current()).pageState).toBeNull();
    sound(second);
  });

  it('is written the same way twice: a session that has not changed saves the same document', () => {
    const h = boot();
    h.open(cloudPage('instances'));
    expect(JSON.stringify(h.store.serialise())).toBe(JSON.stringify(h.store.serialise()));
  });
});

describe('migrate: the version is read first, and a newer or unknown one is never half used', () => {
  it('returns a document of the current version as it is', () => {
    const raw = doc([saved('t1', 'instances')], 't1');
    expect(migrate(raw)).toEqual({ ok: true, version: STATE_VERSION, value: raw });
  });

  it('applies each step from the saved version up to the current one, in order', () => {
    const seen: number[] = [];
    const steps = {
      1: (value: Record<string, unknown>) => {
        seen.push(1); return { ...value, version: 2, tabs: value.tabs }; 
      },
      2: (value: Record<string, unknown>) => {
        seen.push(2); return { ...value, version: 3, upgraded: true }; 
      },
    };
    const result = migrate({ version: 1, tabs: [] }, { current: 3, steps });
    expect(result).toEqual({ ok: true, version: 3, value: { version: 3, tabs: [], upgraded: true } });
    expect(seen).toEqual([1, 2]);
  });

  it('refuses a newer version, a version with no way up, a step that throws and a step that does not raise the version', () => {
    expect(migrate({ version: 9, tabs: [] })).toMatchObject({ ok: false, reason: 'foreign-version' });
    expect(migrate({ version: 0, tabs: [] })).toMatchObject({ ok: false, reason: 'foreign-version' });
    expect(migrate({ version: 1 }, { current: 2, steps: { 1: () => {
      throw new Error('boom'); 
    } } })).toMatchObject({ ok: false, reason: 'unreadable', detail: expect.stringContaining('boom') as string });
    expect(migrate({ version: 1 }, { current: 2, steps: { 1: (value) => value } })).toMatchObject({ ok: false, reason: 'unreadable' });
  });

  it('refuses what is not a versioned document, without throwing', () => {
    for (const bad of ['x{', 7, true, [], { nope: 1 }, { version: '1' }, { version: 1.5 }, { version: Number.NaN }, { version: null }]) {
      expect(migrate(bad)).toMatchObject({ ok: false, reason: 'unreadable' });
    }

    expect(migrate(undefined)).toMatchObject({ ok: false, reason: 'missing' });
    expect(migrate(null)).toMatchObject({ ok: false, reason: 'missing' });
  });
});

describe('a store that cannot be used falls back (the shell opens the home page, and warns unless nothing was saved)', () => {
  it('says why, for every kind of damage', () => {
    const world = makeWorld();
    const reasons = (raw: unknown) => {
      const result = restore(raw, world);
      return result.ok ? 'ok' : result.reason;
    };

    expect(reasons(undefined)).toBe('missing');
    expect(reasons(null)).toBe('missing');
    expect(reasons('x{')).toBe('unreadable');
    expect(reasons({ nope: 1 })).toBe('unreadable');
    expect(reasons({ version: 9, active: null, tabs: [] })).toBe('foreign-version');
    expect(reasons(doc([]))).toBe('empty');
    expect(reasons({ version: 1, tabs: 'x' })).toBe('unreadable');
    expect(reasons({ version: 1, active: null })).toBe('unreadable');
    expect(reasons(doc([{ id: 't1', route: 5 }]))).toBe('empty');
    expect(reasons(doc([saved('t1', 'instances')], 't1'))).toBe('ok');
  });
});

describe('a damaged session is repaired, never discarded (ch16 S32, CO-20)', () => {
  it('drops what cannot be a tab alone, orders the pinned zone first, keeps one preview, and finds the tab on screen again', () => {
    const world = makeWorld();
    const raw = doc(
      [
        saved('a', 'instances'),
        saved('b', 'buckets', { pinned: true }),
        saved('a', 'volumes'),
        saved('c', 'images', { preview: true }),
        saved('d', 'snapshots', { preview: true }),
        saved('e', 'instances', { pinned: true, preview: true }),
        { id: 'f', route: null },
        { id: 7, route: route('instances') },
        'junk',
        saved('g', 'objects', { history: { entries: [], index: 7 } }),
        saved('h', 'blank', { pinned: 'yes', preview: 1 }),
      ],
      'ghost',
    );
    const result = restored(raw, world);
    expect(result.repaired).toBe(true);
    expect(result.problems.length).toBeGreaterThan(0);
    const h = boot({ home: false, initial: result.state, world });
    expect(h.ids()).toEqual(['b', 'e', 'a', 'c', 'd', 'g', 'h']);
    expect(h.ids().filter((id) => tab(h, id).flags.preview)).toEqual(['c']);
    expect(tab(h, 'e').flags).toMatchObject({ pinned: true, preview: false });
    expect(tab(h, 'h').flags).toMatchObject({ pinned: false, preview: false });
    expect(h.active()).toBe('b');
    expect(tab(h, 'g').history).toEqual({ entries: [tab(h, 'g').location.route], index: 0 });
    sound(h);
  });

  it('keeps one singleton page in the whole app, the first in the strip', () => {
    const world = makeWorld();
    const raw = doc([saved('a', 'settings', {}, 'host'), saved('b', 'instances'), saved('c', 'settings', {}, 'host'), saved('d', 'plugins', {}, 'host')], 'c');
    const result = restored(raw, world);
    const h = boot({ home: false, initial: result.state, world });
    expect(h.ids()).toEqual(['a', 'b', 'd']);
    expect(result.repaired).toBe(true);
    expect(h.active()).toBe('a');
    sound(h);
  });

  it('keeps only the history entries that are routes, around the entry that is the tab\'s own, and starts over when that entry is damaged', () => {
    const world = makeWorld();
    const entries = [route('instances'), 'junk', route('instances', { item: 'i-1' }), { plugin: 5 }, route('instances', { item: 'i-2' })];
    const kept = restored(doc([{ id: 'a', route: route('instances', { item: 'i-2' }), history: { entries, index: 4 } }], 'a'), world);
    const a = kept.state.tabs.a;
    expect(a?.history.entries.map((entry) => entry.params.item)).toEqual([undefined, 'i-1', 'i-2']);
    expect(a?.history.index).toBe(2);

    // The entry at `index` is not the tab's route: the history starts over at the route.
    const reset = restored(doc([{ id: 'a', route: route('instances', { item: 'i-2' }), history: { entries, index: 0 } }], 'a'), world);
    expect(reset.state.tabs.a?.history).toEqual({ entries: [route('instances', { item: 'i-2' })], index: 0 });
    expect(reset.repaired).toBe(true);
  });

  it('describes a tab again from what its plugin says now, not from what was saved: a stale scope, title and key are gone', () => {
    const world = makeWorld();
    const stale = { title: 'Old', icon: 'old', scope: { id: 'old', label: 'old' }, path: [], facets: [], pluginName: '', singleton: false, identity: 'key' };
    const result = restored(doc([saved('a', 'settings', { key: 'old:key', face: stale }, 'host'), saved('b', 'instances', { key: 'x', face: stale })], 'a'), world);
    const h = boot({ home: false, initial: result.state, world });
    expect(tab(h, 'a').face).toMatchObject({ title: 'Settings', icon: 'house', singleton: true });
    expect(tab(h, 'a').face.scope).toBeUndefined();
    expect(tab(h, 'a').location.key).toBe('host:settings');
    expect(tab(h, 'b').face).toMatchObject({ title: 'Instances', icon: 'server' });
    expect(tab(h, 'b').location.key).toBe('cloud:instances|');
  });

  it('keeps a tab of a plugin that is not there yet, with the face it was saved with, and describes it when the plugin arrives', () => {
    const world = makeWorld();
    const face = { title: 'Later page', icon: 'clock', path: [], facets: [], pluginName: 'Later', singleton: false, identity: 'key' };
    const result = restored(doc([saved('a', 'page', { face }, 'later'), saved('b', 'instances')], 'a'), world);
    const h = boot({ home: false, initial: result.state, world });
    expect(tab(h, 'a').face.title).toBe('Later page');
    expect(h.active()).toBe('a');
    world.install({ id: 'later', name: 'Later', describe: () => ({ title: 'Real title', icon: 'clock' }) });
    world.changed();
    expect(tab(h, 'a').face.title).toBe('Real title');
    sound(h);
  });

  it('keeps the saved face of a tab whose plugin is still loading, which can say only a stand-in (provisional), and takes the plugin\'s own description once it says one', () => {
    const world = makeWorld();
    let loaded = false;
    world.install({ id: 'later', name: 'Later', describe: () => (loaded ? { title: 'Real title', icon: 'clock' } : { title: 'Later', icon: 'box', provisional: true }) });
    const face = { title: 'Later page', icon: 'clock', path: [], facets: [], pluginName: 'Later', singleton: false, identity: 'key' };
    const result = restored(doc([saved('a', 'page', { face, key: 'later:page' }, 'later'), saved('b', 'instances')], 'a'), world);
    const h = boot({ home: false, initial: result.state, world });
    // The stand-in neither names the tab as it is restored nor takes the face from it while the plugin goes on loading.
    expect(tab(h, 'a').face).toMatchObject({ title: 'Later page', icon: 'clock', pluginName: 'Later' });
    expect(tab(h, 'a').location.key).toBe('later:page');
    world.changed();
    expect(tab(h, 'a').face).toMatchObject({ title: 'Later page', icon: 'clock' });
    loaded = true;
    world.changed();
    expect(tab(h, 'a').face).toMatchObject({ title: 'Real title', icon: 'clock' });
    sound(h);
  });

  it('lets the host take out of a saved face what it must not draw (C1g), whether or not its plugin has said anything yet, and a face the plugin has described replaces it', () => {
    const world = makeWorld();
    world.install({ id: 'later', name: 'Later', describe: () => ({ title: 'Later', icon: 'box', provisional: true }) });
    const face = { title: 'Later page', icon: 'clock', scope: { id: 'key-1', label: 'key-1' }, path: [], facets: ['key-1'], pluginName: 'Later', singleton: false, identity: 'key' };
    const asked: string[] = [];
    const contributions: Contributions = {
      ...world.contributions,
      restoreFace: (kept, at) => {
        asked.push(`${at.plugin}:${kept.title}`);
        return { ...kept, scope: kept.scope === undefined ? undefined : { id: kept.scope.id, label: '' }, facets: [] };
      },
    };
    const result = restoreTabs(doc([saved('a', 'page', { face }, 'later'), saved('b', 'instances')], 'a'), { contributions });
    if (!result.ok) {
      throw new Error(`not restored: ${result.reason}`);
    }

    const h = boot({ home: false, initial: result.state, world });
    // The plugin has said only a stand-in: the tab keeps the face the host let stand, with the scope's id and no label.
    expect(tab(h, 'a').face).toMatchObject({ title: 'Later page', scope: { id: 'key-1', label: '' }, facets: [] });
    expect(asked).toContain('later:Later page');
    // A plugin that has described the tab is the one that makes its face.
    expect(tab(h, 'b').face).toMatchObject({ title: 'Instances' });
  });

  it('leaves a saved face as it was saved when the host\'s restoreFace throws or answers what is not a face (C1g)', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const world = makeWorld();
    world.install({ id: 'later', name: 'Later', describe: () => ({ title: 'Later', icon: 'box', provisional: true }) });
    const face = { title: 'Later page', icon: 'clock', scope: { id: 'key-1', label: 'key-1' }, path: [], facets: [], pluginName: 'Later', singleton: false, identity: 'key' };
    const answers: unknown[] = [
      () => {
        throw new Error('boom');
      },
      () => 'nonsense',
      () => null,
    ];
    for (const restoreFace of answers) {
      // What a host that does not keep the contract answers: assigned past the types.
      const contributions: Contributions = { ...world.contributions };
      Reflect.set(contributions, 'restoreFace', restoreFace);
      const result = restoreTabs(doc([saved('a', 'page', { face }, 'later')], 'a'), { contributions });
      if (!result.ok) {
        throw new Error(`not restored: ${result.reason}`);
      }

      const h = boot({ home: false, initial: result.state, world });
      expect(tab(h, 'a').face).toMatchObject({ title: 'Later page', scope: { id: 'key-1', label: 'key-1' } });
    }

    expect(report).toHaveBeenCalledExactlyOnceWith('[tabs] restoreFace() of later', expect.any(Error));
    report.mockRestore();
  });

  it('lets a plugin rewrite or drop a saved tab when it comes back (DM1), and one that throws or answers nonsense costs a tab at most', () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const world = makeWorld();
    // A plugin that ignores the types and answers something that is not a route.
    const nonsense = { plugin: 5 } as unknown as Route;
    world.install({
      id: 'moved',
      name: 'Moved',
      describe: (r) => ({ title: `Page ${r.contribution}` }),
      restore: (r) => (r.contribution === 'gone' ? false : r.contribution === 'old' ? { ...r, contribution: 'new' } : r.contribution === 'bad' ? nonsense : r),
    });
    const raw = doc([saved('a', 'instances'), saved('b', 'gone', {}, 'moved'), saved('c', 'old', {}, 'moved'), saved('d', 'whatever', {}, 'broken'), saved('x', 'bad', {}, 'moved'), saved('e', 'volumes')], 'c');
    const result = restored(raw, world);
    const h = boot({ home: false, initial: result.state, world });
    // A restore hook that throws leaves its tab as it was saved; nonsense and a refusal drop the tab.
    expect(h.ids()).toEqual(['a', 'c', 'd', 'e']);
    expect(tab(h, 'c').location.route.contribution).toBe('new');
    expect(tab(h, 'c').history.entries.map((entry) => entry.contribution)).toEqual(['new']);
    expect(tab(h, 'd').face.title).toBe('Whatever');
    expect(result.repaired).toBe(true);
    sound(h);
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith('[tabs] describe() of broken', expect.any(Error));
    expect(report).toHaveBeenCalledWith('[tabs] restore() of broken', expect.any(Error));
    report.mockRestore();
  });
});

describe('mutation fuzz: 600 damaged sessions always start sound', () => {
  it('never throws, and leaves a sound strip whose tab on screen exists', () => {
    const world = makeWorld();
    const first = boot({ home: false, world });
    const [a, b] = first.openAll(['instances', 'buckets', 'volumes']);
    first.open(hostPage('settings'));
    first.store.keep(first.open(stackPage('services', { connection: 'one' }), { source: 'search', how: 'new' }));
    for (let i = 0; i < 5; i += 1) {
      first.store.navigate(b ?? '', cloudPage('buckets', { item: `i-${i}` }));
    }

    const valid: unknown = JSON.parse(JSON.stringify(first.store.serialise()));
    let seed = 987654321;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed % n;
    };

    const junk = () => [null, 0, -1, 1.5, 'x', '', [], {}, [null], { a: 1 }, true, 't1', 'cloud', Number.NaN][rnd(14)];
    const paths = (value: unknown, base: string[] = []): string[][] =>
      value !== null && typeof value === 'object' ? Object.keys(value).flatMap((key) => [[...base, key], ...paths((value as Record<string, unknown>)[key], [...base, key])]) : [];
    const at = (value: unknown, path: string[]) => path.reduce<unknown>((into, key) => (into as Record<string, unknown>)[key], value);

    const attempt = { restored: 0, refused: 0 };
    for (let i = 0; i < 600; i += 1) {
      const copy = JSON.parse(JSON.stringify(valid)) as Record<string, unknown>;
      for (let m = 0, n = 1 + rnd(4); m < n; m += 1) {
        const all = paths(copy);
        const path = all[rnd(all.length)] ?? [];
        const parent = at(copy, path.slice(0, -1)) as Record<string, unknown> & unknown[];
        const key = path.at(-1) ?? '';
        const kind = rnd(5);
        if (kind === 0) {
          if (Array.isArray(parent)) {
            parent.splice(Number(key), 1);
          } else {
            Reflect.deleteProperty(parent, key);
          }
        } else if (kind === 1) {
          Reflect.set(parent, key, junk());
        } else if (kind === 2 && Array.isArray(parent)) {
          parent.push(parent[rnd(parent.length)]);
        } else if (kind === 3 && Array.isArray(parent) && parent.length > 1) {
          parent.reverse();
        } else {
          Reflect.set(parent, key, typeof parent[key] === 'string' ? `${String(parent[key])}-x` : junk());
        }
      }

      // One in 25 is cut short, as a write that was interrupted would be; the shell parses it, so a cut document arrives as the text it is.
      const text = JSON.stringify(copy, (_k, v: unknown) => (typeof v === 'number' && Number.isNaN(v) ? null : v));
      const input: unknown = rnd(25) === 0 ? text.slice(0, rnd(3000)) : JSON.parse(text);
      const result = restore(input, world);
      if (result.ok) {
        attempt.restored += 1;
        const h = boot({ home: true, initial: result.state, world });
        expect(checkInvariants(h.state())).toEqual([]);
        expect(h.state().active === null || h.state().tabs[h.state().active ?? ''] !== undefined).toBe(true);
        expect(h.ids().length).toBeGreaterThan(0);
      } else {
        attempt.refused += 1;
        expect(['missing', 'unreadable', 'foreign-version', 'empty']).toContain(result.reason);
      }
    }

    expect(attempt.restored + attempt.refused).toBe(600);
    expect(attempt.restored).toBeGreaterThan(300);
  });
});

describe('the store takes a restored state', () => {
  it('starts from it, opens home only when the strip would be empty, and gives new tabs ids that no restored tab has', () => {
    const world = makeWorld();
    const result = restored(doc([saved('t1', 'instances'), saved('t2', 'buckets')], 't2'), world);
    const store = createTabsStore({ contributions: world.contributions, initial: result.state, newId: (() => {
      let n = 0; return () => `t${++n}`; 
    })() });
    expect(store.getSnapshot().order).toEqual(['t1', 't2']);
    expect(store.getSnapshot().active).toBe('t2');
    const opened = store.open(stackPage('services'));
    expect(opened).toMatchObject({ status: 'done', id: 't3' });
  });
});

describe('the saver: one write per burst (HSH-25, MNR-K2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances'));
    const writes: PersistedTabs[] = [];
    const saver = createSaver({ store: h.store, write: (value) => writes.push(value), delay: 400 });
    return { h, a, writes, saver };
  };

  it('writes the last value once, 400 ms after the last of 10 changes', () => {
    const { h, writes } = setup();
    for (let i = 0; i < 10; i += 1) {
      h.open(cloudPage('instances', { item: `i-${i}` }), { how: 'new' });
      if (i < 9) {
        vi.advanceTimersByTime(30);
      }
    }

    expect(writes).toHaveLength(0);
    vi.advanceTimersByTime(399);
    expect(writes).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual(h.store.serialise());
  });

  it('writes nothing for a change that does not change the saved document, and nothing when nothing changed', () => {
    const { h, a, writes } = setup();
    vi.advanceTimersByTime(1000);
    h.store.activate(a);
    h.store.setPageState(a, { scroll: 1 });
    h.store.markAttention(a, 'error');
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(0);
  });

  it('writes the pending value at once on flush (the window is closing), once', () => {
    const { h, writes, saver } = setup();
    h.open(stackPage('services'));
    expect(writes).toHaveLength(0);
    saver.flush();
    expect(writes).toHaveLength(1);
    saver.flush();
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(1);
  });

  it('stops listening on dispose', () => {
    const { h, writes, saver } = setup();
    h.open(stackPage('services'));
    saver.dispose();
    vi.advanceTimersByTime(1000);
    saver.flush();
    h.open(cloudPage('buckets'), { how: 'new' });
    vi.advanceTimersByTime(1000);
    expect(writes).toHaveLength(0);
  });
});
