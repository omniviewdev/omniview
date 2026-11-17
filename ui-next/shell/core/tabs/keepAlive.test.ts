import { describe, expect, it, vi } from 'vitest';
import { checkInvariants, DEFAULT_KEEP_ALIVE, restoreTabs } from './index';
import { boot, cloudPage, doneId, stackPage, tabOf, type Harness } from './testing';

// Keep-alive as derived state (docs/ui-next/optimisations.md HSH-21, MNR-K1; ch16 S29, S32): which pages a UI layer keeps mounted.
// The old shell kept every tab it had shown mounted until it closed, with no cap. Here the state holds the tabs whose page is mounted, most recently shown first,
// the store evicts the least recently shown beyond a cap, and `selectors.mounted` lists them in strip order. What the UI does with a page that is not in the list
// (unmount it, or hide it with its effects released) is its own decision.

const sound = (h: Harness) => {
  expect(checkInvariants(h.state())).toEqual([]); 
};

const mounted = (h: Harness) => h.store.selectors.mounted(h.state());
/** Opens `count` tabs, each shown in turn, and returns their ids. */
const showAll = (h: Harness, count: number) => Array.from({ length: count }, (_, i) => doneId(h.store.open(cloudPage('instances', { item: `i-${i}` }), { how: 'new' })));

describe('the default policy', () => {
  it('is documented data in the snapshot: at most 5 pages mounted, the one on screen and four hidden, and a tab with unsaved changes is never evicted', () => {
    const h = boot();
    expect(DEFAULT_KEEP_ALIVE).toEqual({ cap: 5, keepUnsaved: true });
    expect(h.state().keepAlive).toEqual(DEFAULT_KEEP_ALIVE);
  });
});

describe('mounted: which pages stay mounted', () => {
  it('mounts the tab on screen, and nothing else at the start', () => {
    const h = boot();
    expect(mounted(h)).toEqual([h.current()]);
    expect(h.state().mounted).toEqual([h.current()]);
  });

  it('mounts a tab on first show, not before: a background open is not mounted until it is shown', () => {
    const h = boot();
    const home = h.current();
    const background = doneId(h.store.open(cloudPage('buckets'), { how: 'background' }));
    expect(mounted(h)).toEqual([home]);
    h.store.activate(background);
    expect(mounted(h)).toEqual([home, background]);
  });

  it('restores 10 tabs and mounts 1 (MNR-K1)', () => {
    const first = boot({ home: false });
    showAll(first, 10);

    const restored = restoreTabs(first.store.serialise(), { contributions: first.world.contributions });
    if (!restored.ok) {
      throw new Error('not restored');
    }

    const second = boot({ home: false, initial: restored.state, world: first.world });
    expect(second.ids()).toHaveLength(10);
    expect(mounted(second)).toEqual([second.current()]);
    sound(second);
  });

  it('keeps every shown tab while there are no more than the cap, in strip order', () => {
    const h = boot({ home: false, keepAlive: { cap: 5 } });
    const ids = showAll(h, 4);
    h.store.activate(ids[1] ?? '');
    expect(mounted(h)).toEqual(ids);
    expect(h.state().mounted).toEqual([ids[1], ids[3], ids[2], ids[0]]);
  });

  it('evicts the least recently shown tab beyond the cap, and mounts it again only when it is shown again', () => {
    const h = boot({ home: false, keepAlive: { cap: 3 } });
    const [a, b, c, d, e] = showAll(h, 5);
    expect(h.state().mounted).toEqual([e, d, c]);
    expect(mounted(h)).toEqual([c, d, e]);

    h.store.activate(a ?? '');
    expect(h.state().mounted).toEqual([a, e, d]);
    expect(mounted(h)).toEqual([a, d, e]);
    h.store.activate(c ?? '');
    expect(mounted(h)).toEqual([a, c, e]);
    expect(h.state().tabs[b ?? '']).toBeDefined();
    sound(h);
  });

  it('keeps the page state of an evicted tab, so the page can draw itself again where the user left it', () => {
    const h = boot({ home: false, keepAlive: { cap: 1 } });
    const [a, b] = showAll(h, 2);
    expect(mounted(h)).toEqual([b]);
    h.store.setPageState(a ?? '', { scroll: 120 });
    expect(tabOf(h, a ?? '').pageState).toEqual({ scroll: 120 });
    expect(mounted(h)).toEqual([b]);
  });

  it('never evicts a tab with unsaved changes, and does not count it toward the cap', () => {
    const h = boot({ home: false, keepAlive: { cap: 2 } });
    const a = h.open(cloudPage('instances', { item: 'a' }), { how: 'new' });
    h.store.setUnsaved(a, true);
    const [b, c, d] = ['b', 'c', 'd'].map((item) => h.open(cloudPage('instances', { item }), { how: 'new' }));
    expect(mounted(h)).toEqual([a, c, d]);
    expect(h.state().tabs[b ?? '']).toBeDefined();

    // Once the draft is gone the tab counts again, and is the least recently shown.
    h.store.setUnsaved(a, false);
    expect(mounted(h)).toEqual([c, d]);
    sound(h);
  });

  it('lets the policy not exempt unsaved tabs', () => {
    const h = boot({ home: false, keepAlive: { cap: 2, keepUnsaved: false } });
    const a = h.open(cloudPage('instances', { item: 'a' }), { how: 'new' });
    h.store.setUnsaved(a, true);
    const [, c, d] = ['b', 'c', 'd'].map((item) => h.open(cloudPage('instances', { item }), { how: 'new' }));
    expect(mounted(h)).toEqual([c, d]);
  });

  it('keeps no cap at all when the cap is null, as the old shell did', () => {
    const h = boot({ home: false, keepAlive: { cap: null } });
    const ids = showAll(h, 8);
    expect(mounted(h)).toEqual(ids);
  });

  it('always keeps the tab on screen, whatever the cap says', () => {
    const h = boot({ home: false, keepAlive: { cap: 0 } });
    const [a, b] = showAll(h, 2);
    expect(h.state().keepAlive.cap).toBe(1);
    expect(mounted(h)).toEqual([b]);
    h.store.activate(a ?? '');
    expect(mounted(h)).toEqual([a]);
  });

  it('forgets a closed tab, and brings back no page that was evicted when the room it left is free', () => {
    const h = boot({ home: false, keepAlive: { cap: 3 } });
    const [a, b, c, d] = showAll(h, 4);
    expect(mounted(h)).toEqual([b, c, d]);
    h.store.close(d ?? '');
    expect(h.active()).toBe(c);
    expect(mounted(h)).toEqual([b, c]);
    expect(h.state().mounted).not.toContain(a);
    h.store.close(c ?? '');
    expect(h.active()).toBe(b);
    expect(mounted(h)).toEqual([b]);
    sound(h);
  });

  it('changes with the cap while the app runs, tells the listeners, and brings nothing back when the cap goes up', () => {
    const h = boot({ home: false });
    const ids = showAll(h, 5);
    expect(mounted(h)).toEqual(ids);
    const listener = vi.fn();
    h.store.subscribeTo(h.store.selectors.mounted, listener);
    expect(h.store.setKeepAlive({ cap: 2 })).toBe(true);
    expect(mounted(h)).toEqual([ids[3], ids[4]]);
    expect(listener).toHaveBeenCalledTimes(1);

    h.store.setKeepAlive({ cap: null });
    expect(mounted(h)).toEqual([ids[3], ids[4]]);
    h.store.activate(ids[0] ?? '');
    expect(mounted(h)).toEqual([ids[0], ids[3], ids[4]]);
    sound(h);
  });

  it('answers the same list while nothing it depends on changes', () => {
    const h = boot({ home: false, keepAlive: { cap: 3 } });
    const [a, , , d] = showAll(h, 4);
    const before = mounted(h);
    h.store.setPageState(d ?? '', { x: 1 });
    h.store.markAttention(a ?? '', 'warning');
    h.store.pin(a ?? '');
    expect(mounted(h)).toBe(before);
  });

  it('does not mount a closed tab that comes back until it is shown, and shows it on reopen', () => {
    const h = boot({ home: false, keepAlive: { cap: 2 } });
    const [a, b] = showAll(h, 2);
    h.store.close(b ?? '');
    h.store.close(a ?? '');
    expect(mounted(h)).toEqual([]);
    h.store.reopen();
    expect(mounted(h)).toEqual([a]);
    const background = doneId(h.store.open(stackPage('services'), { how: 'background' }));
    expect(mounted(h)).not.toContain(background);
  });
});
