import { describe, expect, it } from 'vitest';
import { checkInvariants, LIMITS, restoreTabs, STATE_VERSION, type Json, type Tab, type TabsState } from './index';
import { boot, cloudPage, FIXTURE_PLUGINS, hostPage, pageTabOf as tab, stackPage, type Harness } from './testing';

// What a tab's history keeps of the page (H7, docs/ui-next/status/H7.md). A history entry carries the page state of the page it LEFT: Back and Forward give it back. A navigation to a place starts with a
// clean page, but for a place the tab has been at before, which opens as it was left, except where it was scrolled (the mock keeps a list's state per tab while the list is the same,
// the mock's list module, docs/ui-next/status/H7.md); a route opened in a new tab starts clean. A state is plain data of at most `LIMITS.pageStateBytes`, kept for the history's 50 entries and the window's life, never saved to disk.

const sound = (h: Harness) => {
  expect(checkInvariants(h.state())).toEqual([]);
};

const list = cloudPage('instances');
const item = (name: string) => cloudPage('instances', { item: name });
const bytes = (value: Json) => new TextEncoder().encode(JSON.stringify(value)).length;
const stateOf = (h: Harness, id: string): Json => tab(h, id).pageState;
const savedOf = (h: Harness, id: string): readonly Json[] | undefined => tab(h, id).history.states;

/** A tab on the list, with the page state a person would have left on it. */
function onList(state: Json = { sort: 'name', search: 'web', filter: 'failed', scroll: { top: 120 } }) {
  const h = boot({ home: false });
  const a = h.open(list);
  h.store.setPageState(a, state);
  return { h, a, state };
}

/** A tab on the list that has been through `pages` more pages, so its history holds `pages + 1` entries and the list is the oldest. */
function throughPages(pages: number) {
  const h = boot({ home: false });
  const a = h.open(list);
  h.store.setPageState(a, { sort: 'name' });
  for (let i = 0; i < pages; i += 1) {
    h.store.navigate(a, item(`i-${String(i)}`));
  }

  return { h, a };
}

describe('Back and Forward: a history entry carries the page state of the page it left', () => {
  it('saves the state of the page a navigation leaves with its entry, and starts the page it goes to clean', () => {
    const { h, a, state } = onList();
    h.store.navigate(a, item('i-1'));
    expect(stateOf(h, a)).toBeNull();
    expect(savedOf(h, a)).toEqual([state, null]);
    expect(tab(h, a).history.index).toBe(1);
    sound(h);
  });

  it('gives Back the state of the entry it returns to, and keeps the state it leaves for Forward', () => {
    const { h, a, state } = onList();
    h.store.navigate(a, item('i-1'));
    h.store.setPageState(a, { selected: 'tab-2' });
    expect(h.store.back(a)).toMatchObject({ status: 'done', id: a });
    expect(stateOf(h, a)).toEqual(state);
    expect(tab(h, a).history.index).toBe(0);
    expect(h.store.forward(a)).toMatchObject({ status: 'done', id: a });
    expect(stateOf(h, a)).toEqual({ selected: 'tab-2' });
    sound(h);
  });

  it('keeps one state for each entry through a longer walk, and an entry that kept nothing opens clean', () => {
    const { h, a } = onList({ n: 0 });
    h.store.navigate(a, item('i-1'));
    h.store.setPageState(a, { n: 1 });
    h.store.navigate(a, item('i-2'));
    h.store.navigate(a, item('i-3'));
    h.store.setPageState(a, { n: 3 });
    const seen: Json[] = [];
    for (let i = 0; i < 3; i += 1) {
      h.store.back(a);
      seen.push(stateOf(h, a));
    }

    expect(seen).toEqual([null, { n: 1 }, { n: 0 }]);
    for (let i = 0; i < 3; i += 1) {
      h.store.forward(a);
      seen.push(stateOf(h, a));
    }

    // Forward gives back what each page kept when it was left, and the page that was left last has what it kept then.
    expect(seen.slice(3)).toEqual([{ n: 1 }, null, { n: 3 }]);
    sound(h);
  });

  it('saves what a person changed on the entry they went back to when they leave it again, not what it was', () => {
    const { h, a } = onList({ sort: 'name' });
    h.store.navigate(a, item('i-1'));
    h.store.back(a);
    h.store.setPageState(a, { sort: 'age' });
    h.store.forward(a);
    h.store.back(a);
    expect(stateOf(h, a)).toEqual({ sort: 'age' });
    sound(h);
  });

  it('holds no saved state for the entry on screen: its page keeps its state in the tab, and that is the one place it lives', () => {
    const { h, a } = onList();
    h.store.navigate(a, item('i-1'));
    h.store.back(a);
    expect(stateOf(h, a)).not.toBeNull();
    expect(savedOf(h, a)?.[tab(h, a).history.index] ?? null).toBeNull();
    sound(h);
  });

  it('drops the forward entries and their states when a navigation follows Back, and keeps what the entries before kept', () => {
    const { h, a } = onList({ n: 0 });
    h.store.navigate(a, item('i-1'));
    h.store.setPageState(a, { n: 1 });
    h.store.navigate(a, item('i-2'));
    h.store.setPageState(a, { n: 2 });
    h.store.back(a);
    expect(stateOf(h, a)).toEqual({ n: 1 });
    h.store.navigate(a, item('i-9'));
    expect(h.store.canForward(a)).toBe(false);
    expect(tab(h, a).history.entries.map((entry) => entry.params.item)).toEqual([undefined, 'i-1', 'i-9']);
    // The state of the page that was ahead ({ n: 2 }) is gone with its entry.
    expect(savedOf(h, a)).toEqual([{ n: 0 }, { n: 1 }, null]);
    h.store.back(a);
    expect(stateOf(h, a)).toEqual({ n: 1 });
    h.store.back(a);
    expect(stateOf(h, a)).toEqual({ n: 0 });
    sound(h);
  });

  it('is one commit for a step and for a navigation, and none for a step that is not there or a write of what the tab holds', () => {
    const { h, a } = onList();
    const heard: number[] = [];
    h.store.subscribe(() => heard.push(1));
    h.store.navigate(a, item('i-1'));
    expect(heard).toHaveLength(1);
    h.store.back(a);
    expect(heard).toHaveLength(2);
    h.store.forward(a);
    expect(heard).toHaveLength(3);
    h.store.forward(a);
    expect(heard).toHaveLength(3);
    expect(h.store.setPageState(a, stateOf(h, a))).toBe(false);
    expect(heard).toHaveLength(3);
  });

  it('changes nothing when the step asks about unsaved changes and is not confirmed, and gives the entry\'s state when it is', () => {
    const { h, a, state } = onList();
    h.store.navigate(a, item('i-1'));
    h.store.setPageState(a, { draft: true });
    h.store.setUnsaved(a, true);
    const before = h.state();
    expect(h.store.back(a)).toEqual({ status: 'confirm', action: 'navigate', tabs: [a] });
    expect(h.state()).toBe(before);
    expect(h.store.back(a, { confirmed: true })).toMatchObject({ status: 'done', id: a });
    expect(stateOf(h, a)).toEqual(state);
    expect(h.store.forward(a)).toMatchObject({ status: 'done' });
    expect(stateOf(h, a)).toEqual({ draft: true });
    sound(h);
  });

  it('changes nothing in the tab when the entry it steps to is a singleton page that another tab holds: that tab is shown, and this one stays where it is', () => {
    const h = boot({ home: false });
    const a = h.open(list);
    h.store.navigate(a, hostPage('settings'));
    h.store.navigate(a, item('i-1'));
    h.store.setPageState(a, { keep: 1 });
    // The window's one Settings tab is now another tab: the entry in this tab's history is that page.
    const settings = h.open(hostPage('settings'), { how: 'new' });
    expect(settings).not.toBe(a);
    const before = tab(h, a);
    expect(h.store.back(a)).toMatchObject({ status: 'done', id: settings });
    expect(tab(h, a)).toBe(before);
    expect(h.active()).toBe(settings);
    sound(h);
  });
});

describe('a scope change, an in-page change and a reload', () => {
  it('replaces the entry with a clean page for a scope change, and leaves the states of the other entries', () => {
    const h = boot({ home: false });
    const a = h.open(stackPage('services', { connection: 'one' }));
    h.store.setPageState(a, { page: 'first' });
    h.store.navigate(a, stackPage('service', { connection: 'one', group: 'g', name: 'api' }));
    h.store.setPageState(a, { page: 'detail' });
    h.store.navigate(a, stackPage('service', { connection: 'two', group: 'g', name: 'api' }), { history: 'replace' });
    expect(stateOf(h, a)).toBeNull();
    expect(savedOf(h, a)).toEqual([{ page: 'first' }, null]);
    h.store.back(a);
    expect(stateOf(h, a)).toEqual({ page: 'first' });
    sound(h);
  });

  it('keeps the page\'s state and the saved ones for a change inside the page, which replaces the entry and pushes nothing', () => {
    const { h, a, state } = onList();
    h.store.navigate(a, item('i-1'));
    h.store.setPageState(a, { tab: 'overview' });
    expect(h.store.replace(a, { plugin: 'cloud', contribution: 'instances', params: { item: 'i-1', tab: 'monitoring' } })).toMatchObject({ status: 'done' });
    expect(stateOf(h, a)).toEqual({ tab: 'overview' });
    expect(savedOf(h, a)).toEqual([state, null]);
    sound(h);
  });

  it('keeps the page\'s state and the saved ones when the page is drawn again', () => {
    const { h, a, state } = onList();
    h.store.navigate(a, item('i-1'));
    h.store.setPageState(a, { tab: 'overview' });
    const before = tab(h, a);
    expect(h.store.reload(a)).toMatchObject({ status: 'done' });
    expect(stateOf(h, a)).toEqual({ tab: 'overview' });
    expect(tab(h, a).history).toBe(before.history);
    expect(savedOf(h, a)).toEqual([state, null]);
  });

  it('keeps the saved states of the other entries when the plugin that says what the tab is moves the tab on screen to another route', () => {
    const { h, a, state } = onList();
    h.store.navigate(a, item('i-1'));
    h.store.setPageState(a, { tab: 'overview' });
    const cloud = FIXTURE_PLUGINS.find((plugin) => plugin.id === 'cloud');
    expect(cloud).toBeDefined();
    if (cloud === undefined) {
      return;
    }

    h.world.install({ ...cloud, complete: (route) => (route.params.item === 'i-1' ? { ...route, params: { ...route.params, item: 'i-1b' } } : route) });
    h.world.changed();
    expect(tab(h, a).location.route.params.item).toBe('i-1b');
    expect(savedOf(h, a)).toEqual([state, null]);
    expect(h.store.back(a)).toMatchObject({ status: 'done' });
    expect(stateOf(h, a)).toEqual(state);
    sound(h);
  });
});

describe('a new navigation to a place the tab has been at opens as it was left (the mock\'s list keeps its state per tab while it is the same list)', () => {
  it('takes the state of an earlier entry of the same tab with the same route, except where the page was scrolled', () => {
    const { h, a } = onList({ sort: 'name', search: 'web', filter: 'failed', scroll: { top: 120, left: 0 } });
    h.store.navigate(a, item('i-1'));
    h.store.navigate(a, list);
    expect(stateOf(h, a)).toEqual({ sort: 'name', search: 'web', filter: 'failed' });
    expect(tab(h, a).history.entries.map((entry) => entry.params.item)).toEqual([undefined, 'i-1', undefined]);
    // The entry it came from still has all it kept, where it was scrolled included: Back gives that, and a step is the only thing that does.
    expect(savedOf(h, a)?.[0]).toEqual({ sort: 'name', search: 'web', filter: 'failed', scroll: { top: 120, left: 0 } });
    sound(h);
  });

  it('is what an open that navigates the tab on screen does too (a sidebar entry, a crumb, a palette entry), and not what an open of a new tab does', () => {
    const { h, a } = onList({ sort: 'name' });
    h.store.navigate(a, item('i-1'));
    expect(h.store.open(list, { how: 'smart', source: 'crumb' })).toMatchObject({ status: 'done', id: a, change: 'navigated' });
    expect(stateOf(h, a)).toEqual({ sort: 'name' });
    const other = h.store.open(list, { how: 'new' });
    expect(other).toMatchObject({ status: 'done', change: 'created' });
    if (other.status === 'done') {
      expect(stateOf(h, other.id)).toBeNull();
    }
  });

  it('takes the state of the NEWEST earlier entry of the route, whatever an older one kept, and a newest that kept nothing is what the person left', () => {
    const { h, a } = onList({ n: 1 });
    h.store.navigate(a, item('i-1'));
    h.store.navigate(a, list);
    expect(stateOf(h, a)).toEqual({ n: 1 });
    h.store.setPageState(a, { n: 2 });
    h.store.navigate(a, item('i-2'));
    h.store.navigate(a, list);
    expect(stateOf(h, a)).toEqual({ n: 2 });
    h.store.setPageState(a, null);
    h.store.navigate(a, item('i-3'));
    h.store.navigate(a, list);
    expect(stateOf(h, a)).toBeNull();
    sound(h);
  });

  it('starts clean in a tab that has not been at the place, though another tab has', () => {
    const { h, a } = onList({ sort: 'name' });
    const b = h.open(item('i-1'), { how: 'new' });
    h.store.navigate(b, list);
    expect(stateOf(h, b)).toBeNull();
    expect(stateOf(h, a)).toEqual({ sort: 'name' });
    sound(h);
  });

  it('starts clean for the same kind in another connection, which is another route, and takes the state of the first connection\'s when the tab comes back to it', () => {
    const h = boot({ home: false });
    const a = h.open(stackPage('services', { connection: 'one' }));
    h.store.setPageState(a, { sort: 'name' });
    h.store.navigate(a, stackPage('service', { connection: 'one', group: 'g', name: 'api' }));
    h.store.navigate(a, stackPage('services', { connection: 'two' }));
    expect(stateOf(h, a)).toBeNull();
    h.store.navigate(a, stackPage('service', { connection: 'two', group: 'g', name: 'api' }));
    h.store.navigate(a, stackPage('services', { connection: 'one' }));
    expect(stateOf(h, a)).toEqual({ sort: 'name' });
    sound(h);
  });

  it('seeds a page of one object only from an earlier visit to that object: another object is another route', () => {
    const { h, a } = onList();
    h.store.navigate(a, item('i-1'));
    h.store.setPageState(a, { tab: 'logs' });
    h.store.navigate(a, list);
    h.store.navigate(a, item('i-2'));
    expect(stateOf(h, a)).toBeNull();
    h.store.navigate(a, list);
    h.store.navigate(a, item('i-1'));
    expect(stateOf(h, a)).toEqual({ tab: 'logs' });
  });

  it('takes the state of the earlier entry while the history cap still holds it: 50 entries, the list the oldest', () => {
    const { h, a } = throughPages(LIMITS.history - 2);
    expect(tab(h, a).history.entries).toHaveLength(LIMITS.history - 1);
    h.store.navigate(a, list);
    expect(tab(h, a).history.entries).toHaveLength(LIMITS.history);
    expect(tab(h, a).history.entries[0]?.params.item).toBeUndefined();
    expect(stateOf(h, a)).toEqual({ sort: 'name' });
    sound(h);
  });

  it('starts clean when the earlier entry has fallen off the history cap', () => {
    const { h, a } = throughPages(LIMITS.history);
    // 51 entries were made and the cap kept the newest 50: the list, the oldest, is gone.
    expect(tab(h, a).history.entries).toHaveLength(LIMITS.history);
    expect(tab(h, a).history.entries.some((entry) => entry.params.item === undefined)).toBe(false);
    h.store.navigate(a, list);
    expect(stateOf(h, a)).toBeNull();
    sound(h);
  });

  it('starts clean when the earlier entry is the one the very navigation drops: the history it makes does not hold it', () => {
    const { h, a } = throughPages(LIMITS.history - 1);
    expect(tab(h, a).history.entries).toHaveLength(LIMITS.history);
    expect(tab(h, a).history.entries[0]?.params.item).toBeUndefined();
    h.store.navigate(a, list);
    expect(tab(h, a).history.entries).toHaveLength(LIMITS.history);
    expect(tab(h, a).history.entries.filter((entry) => entry.params.item === undefined)).toHaveLength(1);
    expect(stateOf(h, a)).toBeNull();
    sound(h);
  });

  it('does not take the state of an entry that is ahead of the tab: the navigation that follows Back drops the entries ahead', () => {
    const { h, a } = onList({ sort: 'name' });
    h.store.navigate(a, item('i-1'));
    h.store.navigate(a, list);
    h.store.setPageState(a, { sort: 'age' });
    h.store.back(a);
    expect(tab(h, a).history.entries).toHaveLength(3);
    // The entry ahead is the list again with its own state; the one this navigation takes is the earlier one's.
    h.store.navigate(a, list);
    expect(stateOf(h, a)).toEqual({ sort: 'name' });
    expect(tab(h, a).history.entries).toHaveLength(3);
    sound(h);
  });

  it('takes no state for a scope change, which replaces the entry: the place is another one, even where an earlier entry is the same route', () => {
    const h = boot({ home: false });
    const a = h.open(stackPage('services', { connection: 'one' }));
    h.store.setPageState(a, { sort: 'name' });
    h.store.navigate(a, stackPage('service', { connection: 'one', group: 'g', name: 'api' }));
    expect(h.store.navigate(a, stackPage('services', { connection: 'one' }), { history: 'replace' })).toMatchObject({ status: 'done' });
    expect(stateOf(h, a)).toBeNull();
    expect(tab(h, a).history.entries).toHaveLength(2);
    sound(h);
  });

  it('seeds nothing from a state that was only where the page was scrolled, and gives it back to Back', () => {
    const { h, a } = onList({ scroll: { top: 500, left: 0 } });
    h.store.navigate(a, item('i-1'));
    h.store.navigate(a, list);
    expect(stateOf(h, a)).toBeNull();
    h.store.back(a);
    h.store.back(a);
    expect(stateOf(h, a)).toEqual({ scroll: { top: 500, left: 0 } });
    sound(h);
  });
});

describe('the limits: a bounded state, a bounded history, a bounded total', () => {
  it('says the limits: 50 entries, 16 KiB for a state, and so at most 816 KiB of page state for a tab', () => {
    expect(LIMITS.history).toBe(50);
    expect(LIMITS.pageStateBytes).toBe(16 * 1024);
    expect((LIMITS.history + 1) * LIMITS.pageStateBytes).toBe(816 * 1024);
  });

  it('refuses a state over the limit and keeps the one the page had, counting bytes as UTF-8, not characters', () => {
    const { h, a, state } = onList();
    // `€` is three bytes and one character: this many fit as characters and do not fit as bytes, and one fewer fits to the byte.
    const room = Math.floor((LIMITS.pageStateBytes - bytes({ note: '' })) / 3);
    const wide = { note: '€'.repeat(room + 1) };
    expect(JSON.stringify(wide).length).toBeLessThan(LIMITS.pageStateBytes);
    expect(bytes(wide)).toBeGreaterThan(LIMITS.pageStateBytes);
    expect(h.store.setPageState(a, wide)).toBe(false);
    expect(stateOf(h, a)).toEqual(state);

    const fits = { note: '€'.repeat(room) };
    expect(bytes(fits)).toBeLessThanOrEqual(LIMITS.pageStateBytes);
    expect(h.store.setPageState(a, fits)).toBe(true);
    expect(stateOf(h, a)).toEqual(fits);
    sound(h);
  });

  it('counts four bytes for a character of the astral planes and one for text, and takes a state of exactly the limit', () => {
    const { h, a } = onList({ keep: 1 });
    expect(h.store.setPageState(a, { note: '😀'.repeat(LIMITS.pageStateBytes / 4) })).toBe(false);
    expect(h.store.setPageState(a, { note: 'x'.repeat(LIMITS.pageStateBytes) })).toBe(false);
    expect(stateOf(h, a)).toEqual({ keep: 1 });
    expect(h.store.setPageState(a, { note: 'x'.repeat(LIMITS.pageStateBytes - bytes({ note: '' })) })).toBe(true);
    expect(bytes(stateOf(h, a))).toBe(LIMITS.pageStateBytes);
  });

  it('keeps at most 50 entries and the state of each, the oldest going together, and the total never passes 51 states of the limit', () => {
    const h = boot({ home: false });
    const a = h.open(list);
    const full = (n: number): Json => ({ n, pad: 'x'.repeat(LIMITS.pageStateBytes - bytes({ n, pad: '' })) });
    h.store.setPageState(a, full(0));
    for (let i = 1; i <= 70; i += 1) {
      h.store.navigate(a, item(`i-${String(i)}`));
      h.store.setPageState(a, full(i));
    }

    const { history } = tab(h, a);
    expect([history.entries.length, history.states?.length]).toEqual([LIMITS.history, LIMITS.history]);
    // Entry k of the 50 is page 21 + k, and holds the state that page kept when it was left (the page on screen keeps its own in the tab).
    history.entries.forEach((entry, k) => {
      const held = k === history.index ? stateOf(h, a) : (history.states?.[k] ?? null);
      const page = typeof entry.params.item === 'string' ? Number(entry.params.item.slice(2)) : -1;
      expect(page).toBe(21 + k);
      expect(held).toEqual(full(page));
    });
    const total = [...(history.states ?? []), stateOf(h, a)].reduce((sum: number, held) => sum + bytes(held), 0);
    expect(total).toBeLessThanOrEqual((LIMITS.history + 1) * LIMITS.pageStateBytes);
    expect(total).toBeGreaterThan(LIMITS.history * LIMITS.pageStateBytes - 1);
    sound(h);
  });

  it('keeps a history that saved nothing the history it always was: the entries and the index, and no member for states', () => {
    const h = boot({ home: false });
    const a = h.open(list);
    h.store.navigate(a, item('i-1'));
    h.store.navigate(a, item('i-2'));
    expect(Object.keys(tab(h, a).history)).toEqual(['entries', 'index']);
    expect(tab(h, a).history.index).toBe(2);
  });
});

describe('close, reopen and duplicate', () => {
  it('drops the saved states of a tab\'s history when it closes, keeps the page state of the entry on screen, and brings back only that', () => {
    const { h, a } = onList({ sort: 'name' });
    h.openAll(['buckets']);
    h.store.navigate(a, item('i-1'));
    h.store.setPageState(a, { tab: 'logs' });
    expect(savedOf(h, a)).toEqual([{ sort: 'name' }, null]);
    h.store.close(a);
    const [closed] = h.state().closed;
    expect(closed?.history.states).toBeUndefined();
    expect(closed?.history.entries).toHaveLength(2);
    expect(closed?.pageState).toEqual({ tab: 'logs' });
    expect(h.store.reopen()).toMatchObject({ status: 'done', id: a });
    expect(stateOf(h, a)).toEqual({ tab: 'logs' });
    expect(savedOf(h, a)).toBeUndefined();
    // The list it came from is a page the window has let go of: Back opens it clean.
    h.store.back(a);
    expect(stateOf(h, a)).toBeNull();
    sound(h);
  });

  it('keeps closed tabs light: the 25 of the list hold a page state each and no saved ones, whatever their histories held', () => {
    const h = boot({ home: false });
    for (let t = 0; t < 30; t += 1) {
      const id = h.open(cloudPage('instances', { item: `t-${String(t)}` }), { how: 'new' });
      h.store.setPageState(id, { n: t });
      h.store.navigate(id, cloudPage('instances', { item: `u-${String(t)}` }));
      h.store.setPageState(id, { n: t, deeper: true });
      expect(tab(h, id).history.states).toEqual([{ n: t }, null]);
    }

    for (const id of [...h.ids()]) {
      h.store.close(id);
    }

    expect(h.state().closed).toHaveLength(LIMITS.closed);
    expect(h.state().closed.every((entry) => entry.history.states === undefined)).toBe(true);
    sound(h);
  });

  it('opens a duplicate with its route, its top history entry only and no page state, as it did before this step (ch16 S37)', () => {
    const { h, a } = onList();
    h.store.navigate(a, item('i-1'));
    h.store.setPageState(a, { tab: 'logs' });
    expect(savedOf(h, a)).toBeDefined();
    const copy = h.store.duplicate(a);
    expect(copy).toMatchObject({ status: 'done' });
    if (copy.status === 'done') {
      expect(stateOf(h, copy.id)).toBeNull();
      expect(tab(h, copy.id).history).toEqual({ entries: [tab(h, a).location.route], index: 0 });
      expect(savedOf(h, copy.id)).toBeUndefined();
    }

    expect(stateOf(h, a)).toEqual({ tab: 'logs' });
    sound(h);
  });
});

describe('checkInvariants knows the saved states', () => {
  const broken = (h: Harness, id: string, change: Partial<Tab>): TabsState => ({ ...h.state(), tabs: { ...h.state().tabs, [id]: { ...tab(h, id), ...change } } });
  const said = (state: TabsState, pattern: RegExp) => checkInvariants(state).some((line) => pattern.test(line));
  const over: Json = { pad: 'x'.repeat(LIMITS.pageStateBytes) };

  it('says a history whose states do not line up with its entries, one that holds a state for the entry on screen, and a state over the limit', () => {
    const { h, a } = onList();
    h.store.navigate(a, item('i-1'));
    const { history } = tab(h, a);
    expect(checkInvariants(h.state())).toEqual([]);
    expect(said(broken(h, a, { history: { ...history, states: [null] } }), /saved page states/)).toBe(true);
    expect(said(broken(h, a, { history: { ...history, states: [null, { n: 1 }] } }), /entry on screen/)).toBe(true);
    expect(said(broken(h, a, { history: { ...history, states: [over, null] } }), /over the limit/)).toBe(true);
    expect(said(broken(h, a, { pageState: over }), /over the limit/)).toBe(true);
  });

  it('says a closed tab that keeps saved states, and one whose page state is over the limit', () => {
    const { h, a } = onList();
    h.store.navigate(a, item('i-1'));
    h.openAll(['buckets']);
    h.store.close(a);
    const [closed] = h.state().closed;
    expect(closed).toBeDefined();
    if (closed === undefined) {
      return;
    }

    const state = h.state();
    expect(said({ ...state, closed: [{ ...closed, history: { ...closed.history, states: [{ n: 1 }, null] } }] }, /closed tab/)).toBe(true);
    expect(said({ ...state, closed: [{ ...closed, pageState: over }] }, /closed tab/)).toBe(true);
  });
});

describe('the saved session: the page state of a history entry is for the window\'s life, never saved (ch16 S32: page-local state is not persisted unless the plugin opts in)', () => {
  const route = (contribution: string, params: Record<string, unknown> = {}) => ({ plugin: 'cloud', contribution, params });
  /** A saved tab on the second of two entries of the instances page, as the session writes it, with what a test adds. */
  const saved = (extra: Record<string, unknown> = {}, history: Record<string, unknown> = {}) => ({
    version: STATE_VERSION,
    active: 'a',
    tabs: [
      {
        id: 'a',
        route: route('instances', { item: 'i-1' }),
        key: 'instances|i-1',
        pinned: false,
        preview: false,
        history: { entries: [route('instances'), route('instances', { item: 'i-1' })], index: 1, ...history },
        ...extra,
      },
    ],
  });

  it('saves no page state of any entry, nor the page on screen\'s, and the document is the one it was', () => {
    const { h, a } = onList({ marker: 'only-in-memory' });
    h.store.navigate(a, item('i-1'));
    h.store.setPageState(a, { marker: 'also-only-in-memory' });
    // The states are there in the window: the first page left one with its entry, the second holds its own.
    expect(JSON.stringify(h.state().tabs[a])).toContain('only-in-memory');
    expect(JSON.stringify(savedOf(h, a))).toContain('only-in-memory');
    const document = h.store.serialise();
    expect(JSON.stringify(document)).not.toContain('only-in-memory');
    expect(Object.keys(document.tabs[0] ?? {}).sort()).toEqual(['face', 'history', 'id', 'key', 'pinned', 'preview', 'route']);
    expect(Object.keys(document.tabs[0]?.history ?? {})).toEqual(['entries', 'index']);
  });

  it('comes back with every page clean, and Back from a restored tab opens the page before it clean: nothing was saved to give back', () => {
    const first = boot({ home: false });
    const a = first.open(list);
    first.store.setPageState(a, { sort: 'name' });
    first.store.navigate(a, item('i-1'));
    first.store.setPageState(a, { tab: 'logs' });
    const result = restoreTabs(JSON.parse(JSON.stringify(first.store.serialise())), { contributions: first.world.contributions });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const second = boot({ home: false, initial: result.state, world: first.world });
    expect(stateOf(second, a)).toBeNull();
    expect(savedOf(second, a)).toBeUndefined();
    expect(second.store.back(a)).toMatchObject({ status: 'done' });
    expect(stateOf(second, a)).toBeNull();
    // From there a page keeps its state again, which the entry it leaves carries.
    second.store.setPageState(a, { sort: 'age' });
    second.store.forward(a);
    second.store.back(a);
    expect(stateOf(second, a)).toEqual({ sort: 'age' });
    sound(second);
  });

  it('reads a snapshot written before this step, which has no member for any of it, as it always did', () => {
    const world = boot({ home: false }).world;
    const result = restoreTabs(saved(), { contributions: world.contributions });
    expect(result).toMatchObject({ ok: true, repaired: false, problems: [] });
    if (!result.ok) {
      return;
    }

    const h = boot({ home: false, initial: result.state, world });
    expect(stateOf(h, 'a')).toBeNull();
    expect(h.store.back('a')).toMatchObject({ status: 'done' });
    expect(stateOf(h, 'a')).toBeNull();
    expect(h.store.forward('a')).toMatchObject({ status: 'done' });
    expect(tab(h, 'a').history.index).toBe(1);
    sound(h);
  });

  it('drops what a snapshot says of page state, whatever it is, and neither throws nor reads it', () => {
    const world = boot({ home: false }).world;
    let deep: Json = 1;
    for (let i = 0; i < 40; i += 1) {
      deep = [deep];
    }

    const hostile: unknown[] = [
      { n: 1 },
      'x'.repeat(2 * LIMITS.pageStateBytes),
      deep,
      JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}}') as unknown,
      null,
      7,
    ];
    for (const junk of hostile) {
      const result = restoreTabs(saved({ pageState: junk }, { states: [junk, junk, junk], pageStates: [junk] }), { contributions: world.contributions });
      expect(result.ok).toBe(true);
      if (!result.ok) {
        continue;
      }

      const h = boot({ home: false, initial: result.state, world });
      expect(stateOf(h, 'a')).toBeNull();
      expect(savedOf(h, 'a')).toBeUndefined();
      expect(h.store.back('a')).toMatchObject({ status: 'done' });
      expect(stateOf(h, 'a')).toBeNull();
      expect(Reflect.get({}, 'polluted')).toBeUndefined();
      sound(h);
    }
  });
});
