import { describe, expect, it } from 'vitest';
import type { ContributionV1, RailV1 } from '../contract/v1';
import type { LoadFailure } from '../loader/failure';
import type { PluginEntry } from './pluginStore';
import { compareRail, inRailOrder, railOf } from './rail';

// The one order of what plugins contribute (R2): the rail's. The rail itself is read through the window (`PluginHost.test.tsx`, "the rail"); what is held here is the list every other kind of
// contribution takes its order from, `inRailOrder`, and that it is a function of what the plugins say and of nothing about how they were listed or when they arrived.

const contribution = (name: string, rail: true | RailV1 | undefined): ContributionV1 => ({
  plugin: { name },
  rail,
  sidebar: { label: name, title: name, nodes: [] },
  pages: {},
  home: 'items',
});

const ready = (id: string, name: string, order: number | undefined): PluginEntry => ({
  id,
  name,
  phase: 'ready',
  contribution: contribution(name, order === undefined ? undefined : { icon: 'layers', order }),
});
const loading = (id: string): PluginEntry => ({ id, name: id, phase: 'loading' });
const failure: LoadFailure = { kind: 'missing', message: 'The plugin\'s interface could not be read.' };
const failed = (id: string): PluginEntry => ({ id, name: id, phase: 'failed', failure });

const ids = (entries: readonly PluginEntry[]): string[] => entries.map((entry) => entry.id);

/** Every order the first `n` of `items` can be listed in. */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) {
    return [[...items]];
  }

  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

describe('the order of what plugins contribute (R2)', () => {
  const entries = [ready('d-none', 'Delta', undefined), ready('c-late', 'Charlie', 30), ready('a-first', 'Alpha', 10), ready('b-second', 'Bravo', 20), ready('e-none', 'Echo', undefined)];
  const WANTED = ['a-first', 'b-second', 'c-late', 'd-none', 'e-none'];

  it('lists the plugins that contribute in the order of the rail: the lowest place first, the plugins that declare none after them by name', () => {
    expect(ids(inRailOrder(entries))).toEqual(WANTED);
    expect(ids(inRailOrder(entries))).toEqual(railOf(entries).map((entry) => entry.id));
  });

  it('is the same list in every order the plugins can be listed in: nothing about how they are listed, or which of them loaded first, is in it', () => {
    for (const listed of permutations(entries)) {
      expect(ids(inRailOrder(listed)), ids(listed).join(' ')).toEqual(WANTED);
    }
  });

  it('puts a plugin that arrives later where the rail puts it, and does not move the others among themselves', () => {
    const early = [ready('b-second', 'Bravo', 20), ready('c-late', 'Charlie', 30)];
    expect(ids(inRailOrder(early))).toEqual(['b-second', 'c-late']);
    // The rail's first plugin arrives last, in the middle of the others' declared places, and ahead of every one of them.
    expect(ids(inRailOrder([...early, ready('a-first', 'Alpha', 10)]))).toEqual(['a-first', 'b-second', 'c-late']);
    expect(ids(inRailOrder([...early, ready('bb-mid', 'Between', 25)]))).toEqual(['b-second', 'bb-mid', 'c-late']);
  });

  it('puts the plugins that do not contribute after the ones that do, as they were listed: a plugin that is loading or did not load has no place in the rail', () => {
    const mixed = [loading('z-loading'), ready('b-second', 'Bravo', 20), failed('y-failed'), ready('a-first', 'Alpha', 10)];
    expect(ids(inRailOrder(mixed))).toEqual(['a-first', 'b-second', 'z-loading', 'y-failed']);
  });

  it('moves a plugin from the end to its place when it finishes loading', () => {
    const before = [loading('a-first'), ready('b-second', 'Bravo', 20)];
    expect(ids(inRailOrder(before))).toEqual(['b-second', 'a-first']);
    expect(ids(inRailOrder([ready('a-first', 'Alpha', 10), before[1] ?? loading('b-second')]))).toEqual(['a-first', 'b-second']);
  });

  it('settles equal places by the rail\'s own tie-break: the name, compared as plain text, and then the id', () => {
    const tied = [ready('z-1', 'same', 10), ready('a-2', 'Same', 10), ready('m-3', 'same', 10)];
    const sorted = [...railOf(tied)].sort(compareRail).map((entry) => entry.id);
    for (const listed of permutations(tied)) {
      expect(ids(inRailOrder(listed))).toEqual(sorted);
    }
  });
});
