import { describe, expect, it } from 'vitest';
import { checkInvariants } from './index';
import { boot, cloudPage, doneId, hostPage, stackPage, tabOf, type Harness } from './testing';

// Showing a tab, pinning, reordering (ch16 S38, S45, S47, S48), the page state a tab keeps across a switch (S29) and attention (S22).
// Ported from the design lab's harness (tests/shell-model-harness/R2Store/unit.cjs).

const sound = (h: Harness) => {
  expect(checkInvariants(h.state())).toEqual([]); 
};

const tab = tabOf;
const flags = (h: Harness) => h.ids().map((id) => [id, tab(h, id).flags.pinned]);

describe('pin and reorder (ch16 S38, S45)', () => {
  it('moves a pinned tab to the start of the strip and keeps the pinned zone first, whichever way a tab crosses its boundary', () => {
    const h = boot();
    const home = h.current();
    const [a, b, c] = h.openAll(['instances', 'buckets', 'volumes']);
    expect(h.store.pin(b)).toMatchObject({ status: 'done', id: b });
    expect(h.ids()).toEqual([b, home, a, c]);
    expect(h.store.pin(b, true)).toEqual({ status: 'noop' });
    h.store.pin(c, true);
    expect(flags(h)).toEqual([[b, true], [c, true], [home, false], [a, false]]);

    // Drag a pinned tab past the boundary: it unpins.
    expect(h.store.reorder(b, 3, { pinned: false })).toMatchObject({ status: 'done' });
    expect(flags(h)).toEqual([[c, true], [home, false], [a, false], [b, false]]);

    // Drag an unpinned tab into the pinned zone: it pins.
    expect(h.store.reorder(a, 0)).toMatchObject({ status: 'done' });
    expect(flags(h)).toEqual([[a, true], [c, true], [home, false], [b, false]]);

    // The flag cannot contradict the zone: a pinned tab dropped past it lands at its end.
    h.store.reorder(a, 3, { pinned: true });
    expect(flags(h)).toEqual([[c, true], [a, true], [home, false], [b, false]]);
    expect(h.store.reorder(c, 0)).toEqual({ status: 'noop' });
    expect(h.store.reorder('nope', 0)).toMatchObject({ status: 'refused', reason: 'missing' });
    expect(h.store.reorder(b, Number.NaN)).toMatchObject({ status: 'refused', reason: 'invalid' });

    // Unpinning puts the tab in the first slot of the unpinned zone.
    h.store.pin(c, false);
    expect(flags(h)).toEqual([[a, true], [c, false], [home, false], [b, false]]);
    sound(h);
  });

  it('makes a preview permanent when it is pinned or moved', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances'));
    const p = h.open(stackPage('services'), { source: 'search' });
    expect(tab(h, p).flags.preview).toBe(true);
    h.store.reorder(p, 0);
    expect(h.ids()).toEqual([p, a]);
    expect(tab(h, p).flags).toMatchObject({ preview: false, pinned: false });

    const q = h.open(hostPage('plugins'), { source: 'search' });
    expect(tab(h, q).flags.preview).toBe(true);
    h.store.pin(q);
    expect(tab(h, q).flags).toMatchObject({ preview: false, pinned: true });
    sound(h);
  });

  it('keeps a preview until keep, and keep on any other tab changes nothing', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances'));
    const p = h.open(stackPage('services'), { source: 'search' });
    expect(h.store.keep(a)).toEqual({ status: 'noop' });
    expect(h.store.keep(p)).toMatchObject({ status: 'done', id: p });
    expect(tab(h, p).flags.preview).toBe(false);
    expect(h.store.keep('nope')).toMatchObject({ status: 'refused', reason: 'missing' });
  });
});

describe('showing a tab (ch16 S29, S47, S48)', () => {
  it('goes to the next and the previous tab, wrapping, and to the Nth and the last', () => {
    const h = boot();
    const home = h.current();
    const [a, b] = h.openAll(['instances', 'buckets']);
    expect(h.active()).toBe(b);
    h.store.next();
    expect(h.active()).toBe(home);
    h.store.previous();
    expect(h.active()).toBe(b);
    h.store.goto(2);
    expect(h.active()).toBe(a);
    expect(h.store.goto(9)).toMatchObject({ status: 'refused', reason: 'missing' });
    expect(h.store.goto(0)).toMatchObject({ status: 'refused', reason: 'missing' });
    h.store.goto(1);
    expect(h.active()).toBe(home);
    h.store.last();
    expect(h.active()).toBe(b);
    sound(h);
  });

  it('says nothing changed for the tab that is on screen, and writes nothing', () => {
    const h = boot();
    const a = h.open(cloudPage('instances'));
    const before = h.state();
    expect(h.store.activate(a)).toEqual({ status: 'noop' });
    expect(h.state()).toBe(before);
    expect(h.store.activate('nope')).toMatchObject({ status: 'refused', reason: 'missing' });
  });

  it('remembers the order tabs were shown in, most recent first, and only the tabs that were shown', () => {
    const h = boot();
    const home = h.current();
    const [a, b, c] = h.openAll(['instances', 'buckets', 'volumes']);
    expect(h.state().mounted).toEqual([c, b, a, home]);
    h.store.activate(a);
    expect(h.state().mounted).toEqual([a, c, b, home]);
    const background = doneId(h.store.open(cloudPage('images'), { how: 'background' }));
    expect(h.state().mounted).not.toContain(background);
    h.store.activate(background);
    expect(h.state().mounted[0]).toBe(background);
    sound(h);
  });

  it('keeps the page state of each tab through a switch, as plain data', () => {
    const h = boot();
    const home = h.current();
    const a = h.open(cloudPage('instances'));
    const state = { filter: 'web', n: 3, scroll: { top: 333, left: 7, nested: [{ key: 'table', top: 55, left: 1 }] } };
    expect(h.store.setPageState(a, state)).toBe(true);
    h.store.activate(home);
    h.store.setPageState(home, { other: true });
    expect(tab(h, a).pageState).toEqual(state);
    h.store.activate(a);
    expect(tab(h, a).pageState).toEqual(state);
    expect(tab(h, home).pageState).toEqual({ other: true });

    // The same value writes nothing.
    const before = h.state();
    expect(h.store.setPageState(a, { ...state })).toBe(false);
    expect(h.state()).toBe(before);
    expect(h.store.setPageState('nope', {})).toBe(false);
  });

  it('turns page state that is not plain data into plain data instead of breaking the switch (functions, sets, maps, dates, cycles)', () => {
    const h = boot();
    const a = h.open(cloudPage('instances'));
    const cycle: { a: number; self?: unknown } = { a: 1 };
    cycle.self = cycle;
    h.store.setPageState(a, { fn() {
      return 1; 
    }, set: new Set([1, 2]), map: new Map([['k', 1]]), when: new Date(0), cycle, nan: Number.NaN, ok: 'yes' });
    expect(tab(h, a).pageState).toEqual({ set: [1, 2], map: { k: 1 }, when: '1970-01-01T00:00:00.000Z', cycle: { a: 1 }, nan: null, ok: 'yes' });
    h.store.activate(h.ids()[0] ?? a);
    sound(h);
  });
});

describe('attention (ch16 S22)', () => {
  it('is set on a tab that is not on screen, and cleared when the tab is shown', () => {
    const h = boot();
    const home = h.current();
    const a = h.open(cloudPage('instances'));
    expect(h.store.markAttention(home, 'error')).toBe(true);
    expect(tab(h, home).flags.attention).toBe('error');
    expect(h.store.markAttention(home, 'error')).toBe(false);
    h.store.activate(home);
    expect(tab(h, home).flags.attention).toBe(false);

    // An outcome that ends while the tab is on screen sets nothing.
    const before = h.state();
    expect(h.store.markAttention(home, 'error')).toBe(false);
    expect(h.state()).toBe(before);
    expect(h.store.markAttention(a, 'warning')).toBe(true);
    expect(tab(h, a).flags.attention).toBe('warning');
    sound(h);
  });
});
