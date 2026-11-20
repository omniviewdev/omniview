import { describe, expect, it } from 'vitest';
import { migrate } from '../tabs/persist';
import type { Description } from '../tabs/types';
import { contextOf, MIGRATIONS, recentOf, record, restoreRecents, routeKey, serialiseRecents } from './recents';
import { PALETTE_VERSION, type Recent } from './types';

// The recent destinations (ch16 S73): the last 8 opened anywhere in the app, newest first, one for each place; also the recent-tab switcher. The list is saved as a versioned document with
// a way up from every older version (the tab model's `migrate`), and what is read back is repaired rather than discarded: a damaged entry is dropped alone. The mock's own store of
// them, `search.recents`, is `{ version: 1, default: [], clamp: 8 }` (shell-search.js).

const route = (contribution: string, params: Record<string, string> = {}) => ({ plugin: 'cloud', contribution, params });
const entry = (contribution: string, extra: Partial<Recent> = {}): Recent => {
  const where = route(contribution);
  return { key: routeKey(where), route: where, kind: 'page', noun: 'Page', title: contribution, context: '', icon: 'server', tone: 'neutral', ...extra };
};

describe('routeKey', () => {
  it('names a place by what it is, not by how its parameters were written', () => {
    expect(routeKey(route('item', { a: '1', b: '2' }))).toBe(routeKey(route('item', { b: '2', a: '1' })));
    expect(routeKey(route('item', { a: '1' }))).not.toBe(routeKey(route('item', { a: '2' })));
    expect(routeKey(route('item'))).toBe('cloud|item|');
  });
});

describe('recentOf', () => {
  const describing = (title: string) => (): Description => ({ title, icon: 'box', pluginName: 'Cloud', path: ['Cloud', 'Compute', title] });

  it('is what the caller knows of the place, and what its plugin says for the rest', () => {
    expect(recentOf({ route: { plugin: 'cloud', contribution: 'x' }, title: 'X', kind: 'resource' })).toMatchObject({ title: 'X', kind: 'resource', noun: 'Resource', icon: '', context: '' });
    expect(recentOf({ route: { plugin: 'cloud', contribution: 'x' } }, describing('From plugin'))).toMatchObject({ title: 'From plugin', icon: 'box', context: 'Cloud · Compute', kind: 'page' });
  });

  it('is nothing for a place with no valid route or no name', () => {
    expect(recentOf({ route: { plugin: '', contribution: 'x' }, title: 'X' })).toBeUndefined();
    expect(recentOf({ route: { plugin: 'cloud', contribution: 'x' } })).toBeUndefined();
    expect(recentOf({ route: { plugin: 'cloud', contribution: 'x', params: { f: (() => 1) as never } }, title: 'X' })).toBeUndefined();
  });

  it('keeps the route canonical and freezes the recent', () => {
    const made = recentOf({ route: { plugin: ' cloud ', contribution: 'item', params: { b: '2', a: '1', gone: '' } }, title: 'Item' });
    expect(made?.route).toEqual({ plugin: 'cloud', contribution: 'item', params: { a: '1', b: '2' } });
    expect(Object.isFrozen(made)).toBe(true);
  });
});

describe('contextOf', () => {
  it('says where a place is once: the plugin, the path above it, the scope, and never a name twice', () => {
    expect(contextOf({ title: 'cart-api', pluginName: 'Stack', path: ['Stack', 'prod-eu', 'Services', 'cart-api'], scope: { id: 'prod-eu', label: 'prod-eu' } })).toBe('Stack · prod-eu › Services');
    expect(contextOf({ title: 'Settings', path: [] })).toBe('');
    expect(contextOf({ title: 'Instances', pluginName: 'Cloud', path: [{ label: 'Cloud' }, { label: 'Compute' }, { label: 'Instances' }] })).toBe('Cloud · Compute');
  });
});

describe('record', () => {
  it('puts the place first, once, and keeps the last eight', () => {
    let list: readonly Recent[] = [];
    for (const name of ['a', 'b', 'c']) {
      list = record(list, entry(name));
    }

    expect(list.map((item) => item.title)).toEqual(['c', 'b', 'a']);
    list = record(list, entry('a'));
    expect(list.map((item) => item.title)).toEqual(['a', 'c', 'b']);
    for (const name of ['d', 'e', 'f', 'g', 'h', 'i', 'j']) {
      list = record(list, entry(name));
    }

    expect(list).toHaveLength(8);
    expect(list[0]?.title).toBe('j');
    expect(list.map((item) => item.title)).not.toContain('b');
  });

  it('is the same list when the place is already first and says the same, so nothing is saved for nothing', () => {
    const list = record([], entry('a'));
    expect(record(list, entry('a'))).toBe(list);
    expect(record(list, entry('a', { title: 'Renamed' }))).not.toBe(list);
  });

  it('knows a place by its route: another title for the same route replaces it', () => {
    const list = record(record([], entry('a')), entry('a', { title: 'New title' }));
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe('New title');
  });
});

describe('the saved document', () => {
  const list = [entry('a'), entry('b', { kind: 'resource', noun: 'Pump', context: 'Cloud', tone: 'blue' })];

  it('carries its version and the recents, newest first, and reads back what it saved', () => {
    const saved = serialiseRecents(list);
    expect(saved.version).toBe(PALETTE_VERSION);
    expect(restoreRecents(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true, recents: list, repaired: false, problems: [] });
  });

  it('has no migration at version 1: the first release has nothing to migrate from (the chain is the tab model\'s)', () => {
    expect(PALETTE_VERSION).toBe(1);
    expect(MIGRATIONS).toEqual({});
    expect(migrate({ version: 1, recents: [] }, { current: PALETTE_VERSION, steps: MIGRATIONS })).toMatchObject({ ok: true, version: 1 });
  });

  it('brings an older document up one step at a time, and refuses one it cannot (never half used)', () => {
    const steps = { 1: (value: Record<string, unknown>) => ({ ...value, version: 2, recents: value.items }) };
    const old = { version: 1, items: serialiseRecents(list).recents };
    expect(restoreRecents(old, { current: 2, steps })).toMatchObject({ ok: true, recents: list });
    expect(restoreRecents(old, { current: 3, steps })).toMatchObject({ ok: false, reason: 'foreign-version' });
    expect(restoreRecents({ version: PALETTE_VERSION + 1, recents: [] })).toMatchObject({ ok: false, reason: 'foreign-version' });
    expect(restoreRecents({ version: 0, recents: [] })).toMatchObject({ ok: false, reason: 'foreign-version' });
  });

  it('says what it could not read: nothing saved, and text that is not a versioned document', () => {
    expect(restoreRecents(undefined)).toMatchObject({ ok: false, reason: 'missing' });
    expect(restoreRecents(null)).toMatchObject({ ok: false, reason: 'missing' });
    expect(restoreRecents('recents')).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(restoreRecents({ recents: [] })).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(restoreRecents({ version: 1.5, recents: [] })).toMatchObject({ ok: false, reason: 'unreadable' });
  });

  it('repairs rather than discards: a damaged entry drops alone, a duplicate once, and the rest is kept', () => {
    const raw = {
      version: 1,
      recents: [
        { route: route('a'), kind: 'page', noun: 'Page', title: 'A', context: '', icon: 'server', tone: 'neutral' },
        'not an entry',
        { route: { plugin: 'cloud' }, title: 'No contribution' },
        { route: route('b'), title: '' },
        { route: route('a'), title: 'A again' },
        { route: route('c'), kind: 'planet', title: 'C', tone: 'plaid' },
      ],
    };
    const result = restoreRecents(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recents.map((item) => item.title)).toEqual(['A', 'C']);
      expect(result.recents[1]).toMatchObject({ kind: 'page', noun: 'Page', tone: 'neutral', icon: '', context: '' });
      expect(result.repaired).toBe(true);
      expect(result.problems.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('keeps at most eight, the newest', () => {
    const many = Array.from({ length: 12 }, (_, index) => entry(`p${String(index)}`));
    const result = restoreRecents({ version: 1, recents: many });
    expect(result.ok && result.recents.map((item) => item.title)).toEqual(many.slice(0, 8).map((item) => item.title));
    expect(result.ok && result.repaired).toBe(true);
  });

  it('is an empty list, repaired, when the recents are not a list', () => {
    expect(restoreRecents({ version: 1, recents: 'oops' })).toMatchObject({ ok: true, recents: [], repaired: true });
  });

  it('does not let a key the prototype also names become a way in', () => {
    const result = restoreRecents({ version: 1, recents: [{ route: { plugin: '__proto__', contribution: 'constructor', params: {} }, title: 'Odd' }] });
    expect(result.ok && result.recents[0]?.title).toBe('Odd');
  });
});
