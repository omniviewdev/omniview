import { describe, expect, it, vi } from 'vitest';
import type { Route } from '../../../shell';
import { createRecents, RECENTS_MAX, usesOf } from './recents';

// The connections used last (recents.ts): most recent first, each once, kept current by the window and made, when the window comes back, from the tabs the session restored. Nothing here reads a host or a clock.

const route = (plugin: string, connection?: string): Route => ({ plugin, contribution: 'items', params: connection === undefined ? {} : { connection } });
const tab = (...entries: readonly Route[]) => ({ history: { entries } });
const ids = (recents: ReturnType<typeof createRecents>): string[] => recents.getSnapshot().map((use) => `${use.plugin}/${use.key}`);

describe('touch', () => {
  it('puts the connection first and keeps each connection once, the others in the order they were used', () => {
    const recents = createRecents();

    recents.touch('acme', 'a');
    recents.touch('acme', 'b');
    recents.touch('other', 'a');
    recents.touch('acme', 'a');

    expect(ids(recents)).toEqual(['acme/a', 'other/a', 'acme/b']);
  });

  it('tells a plugin\'s key from another plugin\'s with the same key', () => {
    const recents = createRecents();

    recents.touch('acme', 'north');
    recents.touch('other', 'north');

    expect(ids(recents)).toEqual(['other/north', 'acme/north']);
  });

  it('remembers at most RECENTS_MAX connections, the oldest going first', () => {
    const recents = createRecents();

    for (let at = 0; at < RECENTS_MAX + 3; at += 1) {
      recents.touch('acme', `k${String(at)}`);
    }

    expect(recents.getSnapshot()).toHaveLength(RECENTS_MAX);
    expect(ids(recents)[0]).toBe(`acme/k${String(RECENTS_MAX + 2)}`);
    expect(ids(recents)).not.toContain('acme/k0');
  });

  it('changes nothing, and tells nobody, for the connection that is first already: the list is the same array', () => {
    const recents = createRecents();
    const listener = vi.fn();
    recents.touch('acme', 'a');
    recents.subscribe(listener);
    const before = recents.getSnapshot();

    recents.touch('acme', 'a');

    expect(recents.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('tells a listener once for each change, and a listener that stopped hears no more', () => {
    const recents = createRecents();
    const heard = vi.fn();
    const stop = recents.subscribe(heard);

    recents.touch('acme', 'a');
    recents.touch('acme', 'b');
    stop();
    recents.touch('acme', 'c');

    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('seed', () => {
  it('takes the uses of an earlier life, oldest first, so that the newest is first', () => {
    const recents = createRecents();

    recents.seed([
      { plugin: 'acme', key: 'a' },
      { plugin: 'acme', key: 'b' },
      { plugin: 'acme', key: 'a' },
    ]);

    expect(ids(recents)).toEqual(['acme/a', 'acme/b']);
  });

  it('goes under what the window did since: the earlier life is older than anything used now', () => {
    const recents = createRecents();
    recents.touch('acme', 'now');

    recents.seed([
      { plugin: 'acme', key: 'old' },
      { plugin: 'acme', key: 'now' },
    ]);

    expect(ids(recents)).toEqual(['acme/now', 'acme/old']);
  });

  it('changes nothing, and tells nobody, when it brings nothing the list does not have', () => {
    const recents = createRecents();
    const listener = vi.fn();
    recents.touch('acme', 'a');
    recents.subscribe(listener);
    const before = recents.getSnapshot();

    recents.seed([{ plugin: 'acme', key: 'a' }]);
    recents.seed([]);

    expect(recents.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps no more than RECENTS_MAX', () => {
    const recents = createRecents();

    recents.seed(Array.from({ length: RECENTS_MAX + 5 }, (_unused, at) => ({ plugin: 'acme', key: `k${String(at)}` })));

    expect(recents.getSnapshot()).toHaveLength(RECENTS_MAX);
    expect(ids(recents)[0]).toBe(`acme/k${String(RECENTS_MAX + 4)}`);
  });
});

describe('usesOf', () => {
  it('reads the tabs in strip order, each one\'s history from its oldest entry to its newest, and the tab on screen last', () => {
    const uses = usesOf({
      order: ['t1', 't2', 't3'],
      active: 't1',
      tabs: {
        t1: tab(route('acme', 'a1'), route('acme', 'a2')),
        t2: tab(route('acme', 'b1')),
        t3: tab(route('other', 'c1'), route('other', 'c2')),
      },
    });

    expect(uses.map((use) => `${use.plugin}/${use.key}`)).toEqual(['acme/b1', 'other/c1', 'other/c2', 'acme/a1', 'acme/a2']);
  });

  it('ignores the pages that name no connection, and a tab that is not in the model', () => {
    const uses = usesOf({ order: ['t1', 'gone'], active: null, tabs: { t1: tab({ plugin: 'host', contribution: 'home', params: {} }, route('acme'), route('acme', 'a')) } });

    expect(uses).toEqual([{ plugin: 'acme', key: 'a' }]);
  });

  it('makes the most recent connection first once the list is seeded with it', () => {
    const recents = createRecents();

    recents.seed(usesOf({ order: ['t1', 't2'], active: 't1', tabs: { t1: tab(route('acme', 'north'), route('acme', 'south')), t2: tab(route('acme', 'east')) } }));

    expect(ids(recents)).toEqual(['acme/south', 'acme/north', 'acme/east']);
  });
});
