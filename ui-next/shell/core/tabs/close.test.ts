import { describe, expect, it } from 'vitest';
import { checkInvariants } from './index';
import { boot, cloudPage, dest, doneId, makeWorld, stackPage, tabOf, type Harness } from './testing';

// Closing and reopening (ch16 S30, S41 to S43), the guard for unsaved changes (S27) and duplicating (S37).
// Ported from the design lab's harness (tests/shell-model-harness/R2Store/unit.cjs).

const sound = (h: Harness) => {
  expect(checkInvariants(h.state())).toEqual([]); 
};

const tab = tabOf;

describe('close (ch16 S30)', () => {
  it('activates the right neighbour, else the left, and keeps the closed tabs newest first with the index they had', () => {
    const h = boot();
    const [a, b, c] = h.openAll(['instances', 'buckets', 'volumes']);
    h.store.activate(b);
    expect(h.store.close(b)).toEqual({ status: 'done', closed: [b], active: c });
    expect(h.active()).toBe(c);
    expect(h.store.close(c)).toMatchObject({ status: 'done', active: a });
    expect(h.active()).toBe(a);
    expect(h.state().closed.map((entry) => [entry.id, entry.index])).toEqual([[c, 2], [b, 2]]);

    // Closing a tab that is not on screen leaves the one that is.
    const d = h.open(cloudPage('images'), { how: 'new' });
    h.store.activate(a);
    h.store.close(d);
    expect(h.active()).toBe(a);
    sound(h);
  });

  it('leaves the strip empty when the last tab closes, and keeps the closed one so it can come back (decision A17: no page opens by itself)', () => {
    const h = boot();
    const home = h.current();
    expect(h.store.close(home)).toEqual({ status: 'done', closed: [home], active: null });
    expect(h.ids()).toEqual([]);
    expect(h.active()).toBeNull();
    expect(h.state().mounted).toEqual([]);
    expect(h.state().closed[0]?.id).toBe(home);
    sound(h);
  });

  it('opens no page by itself afterwards: not when the plugins change, not on a refresh, not when a home page becomes available', () => {
    const h = boot();
    h.store.close(h.current());
    const empty = h.state();

    h.store.refresh();
    h.world.setHome(false);
    h.world.setHome(true);
    h.store.refresh();
    h.store.refresh('host');

    expect(h.ids()).toEqual([]);
    expect(h.state()).toBe(empty);
    sound(h);
  });

  it('still opens a page for the user when they ask: a new tab, or the one they closed', () => {
    const h = boot();
    const home = h.current();
    h.store.close(home);

    const a = h.open(cloudPage('instances'));
    expect(h.ids()).toEqual([a]);
    h.store.close(a);
    expect(h.store.reopen()).toMatchObject({ status: 'done', id: a });
    expect(h.active()).toBe(a);
    sound(h);
  });

  it('closes the last tab of several the same way: closing all the others, then the one that is left', () => {
    const h = boot();
    const [a] = h.openAll(['instances', 'buckets']);
    h.store.closeMany('others', a);
    expect(h.ids()).toEqual([a]);
    h.store.close(a);
    expect(h.ids()).toEqual([]);
    h.store.closePlugin('cloud');
    expect(h.ids()).toEqual([]);
    sound(h);
  });

  it('leaves the strip empty when there is no home page to open, and the state is still sound', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances'));
    expect(h.store.close(a)).toEqual({ status: 'done', closed: [a], active: null });
    expect(h.active()).toBeNull();
    expect(h.ids()).toEqual([]);
    expect(h.state().mounted).toEqual([]);
    sound(h);
    expect(h.store.reopen()).toMatchObject({ status: 'done', id: a });
  });

  it('refuses a tab that does not exist without changing anything', () => {
    const h = boot();
    const before = h.state();
    expect(h.store.close('nope')).toMatchObject({ status: 'refused', reason: 'missing' });
    expect(h.state()).toBe(before);
  });

  it('keeps 25 closed tabs, newest first', () => {
    const h = boot();
    const keep = h.current();
    const made = Array.from({ length: 30 }, (_, i) => h.open(cloudPage('instances', { item: `i-${i}` }), { how: 'new' }));
    for (const id of made) {
      h.store.close(id);
    }

    const closed = h.state().closed;
    expect(closed).toHaveLength(25);
    expect(closed[0]?.id).toBe(made[29]);
    expect(closed[24]?.id).toBe(made[5]);
    expect(h.active()).toBe(keep);
    sound(h);
  });

  it('keeps the page state of a closed tab, and brings it back with the tab', () => {
    const h = boot();
    h.open(cloudPage('instances'));
    const b = h.open(cloudPage('buckets'), { how: 'new' });
    h.store.setPageState(b, { sel: [1, 2] });
    h.store.close(b);
    expect(h.state().closed[0]?.pageState).toEqual({ sel: [1, 2] });
    const result = h.store.reopen();
    expect(result).toMatchObject({ status: 'done', id: b });
    expect(tab(h, b).pageState).toEqual({ sel: [1, 2] });
    sound(h);
  });
});

describe('reopen (ch16 S43)', () => {
  it('restores the newest closed tab at the index it had, clamped, in the pinned zone for a pinned tab', () => {
    const h = boot();
    const home = h.current();
    const [a, b, c, d] = h.openAll(['instances', 'buckets', 'volumes', 'images']);
    h.store.close(b);
    h.store.close(d);
    h.store.close(a);
    expect(h.ids()).toEqual([home, c]);

    expect(h.store.reopen()).toEqual({ status: 'done', id: a });
    expect(h.ids()).toEqual([home, a, c]);
    expect(h.active()).toBe(a);
    expect(h.store.reopen()).toEqual({ status: 'done', id: d });
    expect(h.ids().indexOf(d)).toBe(3);
    expect(h.store.reopen()).toEqual({ status: 'done', id: b });
    expect(h.ids()).toEqual([home, a, b, c, d]);
    expect(h.store.reopen()).toMatchObject({ status: 'refused', reason: 'nothing-closed' });

    // A named entry.
    h.store.close(a);
    h.store.close(c);
    expect(h.store.reopen({ id: a })).toEqual({ status: 'done', id: a });
    expect(h.state().closed).toHaveLength(1);

    // A pinned tab comes back inside the pinned zone.
    h.store.pin(a);
    h.store.close(a);
    const back = doneId(h.store.reopen());
    expect(h.ids().indexOf(back)).toBe(0);
    expect(tab(h, a).flags.pinned).toBe(true);
    sound(h);
  });

  it('rebuilds the strip exactly when many tabs were closed at once (S42, S43)', () => {
    const h = boot();
    const home = h.current();
    const [a, b, c, d] = h.openAll(['instances', 'buckets', 'volumes', 'images']);
    h.store.activate(a);
    expect(h.store.closeMany('others', a)).toMatchObject({ status: 'done', closed: [home, b, c, d] });
    expect(h.ids()).toEqual([a]);
    expect(h.active()).toBe(a);
    const order = [1, 2, 3, 4, 5].map(() => h.store.reopen()).filter((result) => result.status === 'done').map(doneId);
    expect(order).toEqual([d, c, b, home]);
    expect(h.ids()).toEqual([home, a, b, c, d]);
    sound(h);
  });

  it('activates the singleton that is open instead of making a second one', () => {
    const h = boot();
    const home = h.current();
    const s = h.open(dest('host', 'settings'));
    h.store.close(s);
    const again = h.open(dest('host', 'settings'));
    expect(again).not.toBe(s);
    h.store.activate(home);
    expect(h.store.reopen()).toMatchObject({ status: 'done', id: again });
    expect(h.active()).toBe(again);
    expect(h.ids().filter((id) => tab(h, id).location.key === 'host:settings')).toHaveLength(1);
    sound(h);
  });

  it('skips a closed tab whose plugin cannot serve it, refuses a named one with the reason, and says why through canReopen (CR3)', () => {
    const h = boot();
    const a = h.open(cloudPage('instances'));
    const k = h.open(stackPage('services'));
    h.store.close(a);
    h.store.close(k);
    h.world.report('stack', { state: 'unavailable', reason: 'Stack is disabled in Plugins' });
    expect(h.store.canReopen()).toEqual({ ok: true });

    const closedStack = h.state().closed.find((entry) => entry.location.route.plugin === 'stack');
    expect(h.store.canReopen({ id: closedStack?.id })).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(h.store.reopen({ id: closedStack?.id })).toEqual({ status: 'refused', reason: 'unavailable', message: 'Services: Stack is disabled in Plugins' });
    expect(h.state().closed).toHaveLength(2);

    expect(h.store.reopen()).toEqual({ status: 'done', id: a });
    expect(h.state().closed).toHaveLength(1);
    expect(h.store.canReopen()).toEqual({ ok: false, reason: 'unavailable', message: 'Services: Stack is disabled in Plugins' });
    expect(h.store.reopen()).toMatchObject({ status: 'refused', reason: 'unavailable' });

    h.world.report('stack', undefined);
    expect(h.store.canReopen()).toEqual({ ok: true });
    expect(h.store.reopen()).toMatchObject({ status: 'done', id: k });
    expect(h.store.canReopen()).toMatchObject({ ok: false, reason: 'nothing-closed' });
    sound(h);
  });

  it('names a plugin that is not installed by what the plugin was (CR3)', () => {
    const world = makeWorld();
    const h = boot({ world });
    world.install({ id: 'tmp', name: 'Temp', describe: () => ({ title: 'Temp page' }) });
    const id = h.open(dest('tmp', 'x'));
    h.store.close(id);
    expect(h.store.canReopen()).toEqual({ ok: true });
    world.uninstall('tmp');
    expect(h.store.canReopen()).toMatchObject({ ok: false, reason: 'unavailable', message: 'Temp page: tmp is not installed' });
    expect(h.store.reopen()).toMatchObject({ status: 'refused', reason: 'unavailable' });
    expect(h.state().closed).toHaveLength(1);
  });

  it('lets a plugin rewrite a closed tab when it comes back, and drops one the plugin will not restore', () => {
    const world = makeWorld();
    const h = boot({ world });
    world.install({
      id: 'moved',
      name: 'Moved',
      describe: (route) => ({ title: `Page ${route.contribution}` }),
      restore: (route) => (route.contribution === 'gone' ? false : route.contribution === 'old' ? { ...route, contribution: 'new' } : route),
    });
    const gone = h.open(dest('moved', 'gone'));
    const old = h.open(dest('moved', 'old'), { how: 'new' });
    h.store.close(gone);
    h.store.close(old);
    const back = doneId(h.store.reopen());
    expect(tab(h, back).location.route.contribution).toBe('new');
    expect(tab(h, back).face.title).toBe('Page new');

    // The tab the plugin drops is removed from the list, and the request says why.
    expect(h.store.reopen({ id: gone })).toMatchObject({ status: 'refused', reason: 'dropped' });
    expect(h.state().closed).toHaveLength(0);
    sound(h);
  });
});

describe('close variants (ch16 S42): pinned tabs are skipped, unsaved tabs ask once', () => {
  it('lists others, right, left and unpinned without the pinned tabs', () => {
    const h = boot();
    const ids = [h.current(), ...h.openAll(['instances', 'buckets', 'volumes', 'images', 'snapshots'])];
    h.store.pin(ids[1]);
    expect(h.ids()).toEqual([ids[1], ids[0], ids[2], ids[3], ids[4], ids[5]]);

    expect(h.store.closeMany('right', ids[5])).toEqual({ status: 'noop' });
    expect(h.store.closeMany('right', ids[3])).toMatchObject({ status: 'done', closed: [ids[4], ids[5]] });
    expect(h.ids()).toEqual([ids[1], ids[0], ids[2], ids[3]]);
    expect(h.store.closeMany('left', ids[3])).toMatchObject({ status: 'done', closed: [ids[0], ids[2]] });
    expect(h.ids()).toEqual([ids[1], ids[3]]);
    expect(h.store.closeMany('unpinned', ids[3])).toMatchObject({ status: 'done', closed: [ids[3]] });
    expect(h.ids()).toEqual([ids[1]]);
    expect(h.active()).toBe(ids[1]);

    h.store.close(ids[1]);
    expect(h.ids()).toEqual([]);
    expect(h.active()).toBeNull();
    sound(h);
  });

  it('closes every tab of a plugin into the closed list (S136)', () => {
    const h = boot();
    h.open(cloudPage('instances'));
    h.open(cloudPage('buckets'), { how: 'new' });
    h.open(stackPage('services'));
    expect(h.store.closePlugin('cloud')).toMatchObject({ status: 'done' });
    expect(h.ids().map((id) => tab(h, id).location.route.plugin).sort()).toEqual(['host', 'stack']);
    expect(h.state().closed).toHaveLength(2);
    expect(h.store.closePlugin('cloud')).toEqual({ status: 'noop' });
    sound(h);
  });
});

describe('the guard for unsaved changes (ch16 S27)', () => {
  it('asks before a close discards a draft, never for a clean tab, and closes once the user chose to discard', () => {
    const h = boot();
    const home = h.current();
    const a = h.open(cloudPage('instances'));
    expect(h.store.setUnsaved(a, true)).toBe(true);
    expect(tab(h, a).flags.unsaved).toBe(true);

    // Showing another tab never asks.
    expect(h.store.activate(home)).toMatchObject({ status: 'done' });

    const before = h.state();
    expect(h.store.close(a)).toEqual({ status: 'confirm', action: 'close', tabs: [a] });
    expect(h.state()).toBe(before);
    expect(h.store.close(a, { confirmed: true })).toMatchObject({ status: 'done', closed: [a] });
    expect(h.state().tabs[a]).toBeUndefined();

    const b = h.open(cloudPage('buckets'), { how: 'new' });
    expect(h.store.close(b)).toMatchObject({ status: 'done' });
    sound(h);
  });

  it('asks once for a whole batch, in strip order', () => {
    const h = boot();
    const [a, b, c] = h.openAll(['instances', 'buckets', 'volumes']);
    h.store.setUnsaved(a, true);
    h.store.setUnsaved(c, true);
    expect(h.store.closeMany('others', b)).toEqual({ status: 'confirm', action: 'close', tabs: [a, c] });
    expect(h.store.closeMany('others', b, { confirmed: true })).toMatchObject({ status: 'done' });
    expect(h.ids()).toEqual([b]);
    sound(h);
  });

  it('guards leaving the page: in-place navigation, Back and Reload, and clears the flag once discarded', () => {
    const h = boot({ home: false });
    const b = h.open(cloudPage('instances'));
    h.store.navigate(b, cloudPage('buckets'));
    h.store.setUnsaved(b, true);

    expect(h.store.open(cloudPage('objects'), { how: 'here' })).toEqual({ status: 'confirm', action: 'navigate', tabs: [b] });
    expect(h.store.open(cloudPage('objects'), { how: 'here', confirmed: true })).toMatchObject({ status: 'done', id: b, change: 'navigated' });
    expect(tab(h, b).face.title).toBe('Objects');
    expect(tab(h, b).flags.unsaved).toBe(false);

    h.store.setUnsaved(b, true);
    expect(h.store.back(b)).toEqual({ status: 'confirm', action: 'navigate', tabs: [b] });
    expect(h.store.back(b, { confirmed: true })).toMatchObject({ status: 'done' });

    h.store.setUnsaved(b, true);
    expect(h.store.reload(b)).toEqual({ status: 'confirm', action: 'reload', tabs: [b] });
    expect(h.store.reload(b, { confirmed: true })).toMatchObject({ status: 'done' });
    expect(tab(h, b).flags.unsaved).toBe(false);
    sound(h);
  });

  it('knows a draft only for a tab that exists', () => {
    const h = boot();
    expect(h.store.setUnsaved('nope', true)).toBe(false);
    const before = h.state();
    expect(h.store.setUnsaved(h.current(), false)).toBe(false);
    expect(h.state()).toBe(before);
  });
});

describe('duplicate (ch16 S37)', () => {
  it('opens the same route with its top history entry only, no page state, right of the original, in the foreground', () => {
    const h = boot();
    const a = h.open(cloudPage('instances'));
    h.store.navigate(a, cloudPage('instances', { item: 'i-1' }));
    h.store.setPageState(a, { f: 1 });
    const result = h.store.duplicate(a);
    const b = doneId(result);
    expect(b).not.toBe(a);
    expect(tab(h, b).location.route.params).toEqual({ item: 'i-1' });
    expect([tab(h, b).history.index, tab(h, b).history.entries.length]).toEqual([0, 1]);
    expect(tab(h, b).pageState).toBeNull();
    expect(h.ids().indexOf(b)).toBe(h.ids().indexOf(a) + 1);
    expect(h.active()).toBe(b);
    expect(tab(h, a).pageState).toEqual({ f: 1 });
    expect(tab(h, a).location.key).toBe(tab(h, b).location.key);
    sound(h);
  });

  it('refuses a tab that is not there', () => {
    const h = boot();
    expect(h.store.duplicate('nope')).toMatchObject({ status: 'refused', reason: 'missing' });
  });
});

describe('detach (a tab that moved to another window)', () => {
  it('takes the tab out like close, shows its neighbour, and leaves the closed list as it was so Reopen cannot bring back a tab that lives in another window', () => {
    const h = boot();
    const [a, b, c] = h.openAll(['instances', 'buckets', 'volumes']);
    h.store.close(a);
    const closed = h.state().closed;
    h.store.activate(b);

    expect(h.store.detach(b)).toEqual({ status: 'done', closed: [b], active: c });

    expect(h.ids()).not.toContain(b);
    expect(h.active()).toBe(c);
    expect(h.state().closed).toBe(closed);
    sound(h);
  });

  it('leaves a sound, empty strip when the last tab goes, with nothing to reopen', () => {
    const h = boot();
    const home = h.current();
    h.store.detach(home);
    expect(h.ids()).toEqual([]);
    expect(h.state().closed).toEqual([]);
    expect(h.store.canReopen().ok).toBe(false);
    sound(h);
  });

  it('asks before it drops a tab with unsaved changes, and goes on when confirmed', () => {
    const h = boot();
    const [a] = h.openAll(['instances']);
    h.store.setUnsaved(a, true);
    const before = h.state();

    expect(h.store.detach(a)).toEqual({ status: 'confirm', action: 'close', tabs: [a] });
    expect(h.state()).toBe(before);
    expect(h.store.detach(a, { confirmed: true })).toMatchObject({ status: 'done', closed: [a] });
    expect(h.ids()).not.toContain(a);
  });
});
