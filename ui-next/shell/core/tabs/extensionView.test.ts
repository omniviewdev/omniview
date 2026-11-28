import { describe, expect, it, vi } from 'vitest';
import {
  checkInvariants, createTabsStore, LIMITS, navigationOrigin, normaliseExtensionView, normaliseRoute, normaliseTabRoute,
  restoreTabs, sameRoute, STATE_VERSION, type Contributions, type Description, type ExtensionViewRoute, type Route, type TabsStore,
} from './index';
import { doneId } from './testing';

const view: ExtensionViewRoute = { kind: 'extension-view', plugin: 'owner', point: 'tools', offer: 'peer/manager', connection: 'west' };
const list: Route = { plugin: 'owner', contribution: 'items', params: { connection: 'west' } };
const detail: Route = { plugin: 'owner', contribution: 'item', params: { connection: 'west', name: 'gateway' } };
const peerPage: Route = { plugin: 'peer', contribution: 'manager', params: {} };

function fixture() {
  const describe = vi.fn((route: Route): Description => ({ title: route.contribution }));
  // Deliberately ask for a singleton, a page key and no identity: none of these may override a mounted location's identity.
  const describeView = vi.fn<NonNullable<Contributions['describeView']>>(() => ({ title: 'Manager', key: 'manager', singleton: true, identity: 'none' }));
  const complete = vi.fn((route: Route) => route);
  const restore = vi.fn((route: Route) => route);
  const availability = vi.fn<NonNullable<Contributions['availability']>>(() => ({ state: 'available' }));
  const contributions: Contributions = { describe, describeView, complete, restore, availability };
  let seq = 0;
  const tabs = createTabsStore({ contributions, newId: () => `t${++seq}` });
  return { tabs, contributions, describe, describeView, complete, restore, availability };
}

function restored(raw: unknown, contributions: Contributions) {
  const result = restoreTabs(raw, { contributions });
  if (!result.ok) {
    throw new Error(result.detail);
  }

  return result;
}

function tab(tabs: TabsStore, id: string) {
  const record = tabs.getSnapshot().tabs[id];
  if (record === undefined) {
    throw new Error(`No tab ${id}`);
  }

  return record;
}

describe('the host-only mounted location', () => {
  it('accepts only the closed, bounded locator at host boundaries; plugin page APIs do not accept it', () => {
    expect(normaliseRoute(view)).toBeUndefined();
    expect(normaliseRoute({ ...list, ...view })).toBeUndefined();
    expect(normaliseTabRoute(list)).toEqual(list);
    expect(normaliseTabRoute(view)).toEqual(view);
    const unscoped = normaliseExtensionView({ ...view, connection: undefined });
    expect(unscoped).toEqual({ kind: 'extension-view', plugin: 'owner', point: 'tools', offer: 'peer/manager' });
    expect(Object.isFrozen(unscoped)).toBe(true);
    for (const bad of [
      { ...view, kind: 'page', contribution: 'home' }, { ...view, params: {} }, { ...view, sessionOrigin: 'leak' },
      { ...view, plugin: 'visuals' }, { ...view, point: 'n'.repeat(129) }, { ...view, offer: 'host/manager' },
      { ...view, offer: 'peer/constructor' }, { ...view, offer: 'peer/a/b' }, { ...view, offer: 'manager' },
      { ...view, connection: null }, { ...view, connection: '' }, { ...view, connection: '\ud800' }, { ...view, connection: 'é'.repeat(1025) },
    ]) {
      expect(normaliseTabRoute(bad)).toBeUndefined();
    }
  });

  it('keys every part of the tagged tuple separately from ordinary pages, regardless of description', () => {
    const { tabs } = fixture();
    const alternatives: ExtensionViewRoute[] = [
      view, { ...view, plugin: 'another' }, { ...view, point: 'other' }, { ...view, offer: 'another/manager' },
      { ...view, offer: 'peer/other' }, { ...view, connection: 'east' }, { ...view, connection: undefined },
    ];
    const keys = alternatives.map((route) => {
      const id = doneId(tabs.open({ route }, { how: 'new' }));
      const record = tab(tabs, id);
      expect(record.face).toMatchObject({ title: 'Manager', identity: 'key', singleton: false });
      expect(record.reveal).toBeUndefined();
      expect(sameRoute(record.location.route, route)).toBe(true);
      expect(sameRoute(record.location.route, view)).toBe(route === view);
      return record.location.key;
    });
    for (const route of [peerPage, { ...peerPage, plugin: view.plugin }]) {
      keys.push(tab(tabs, doneId(tabs.open({ route }, { how: 'new' }))).location.key);
      expect(sameRoute(route, view)).toBe(false);
      expect(sameRoute(view, route)).toBe(false);
    }

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('pushes in the source tab, restores bounded UI state, and branches without touching matching or contributor tabs', () => {
    const { tabs } = fixture();
    const id = doneId(tabs.open({ route: list }));
    tabs.navigate(id, { route: detail });
    tabs.setPageState(id, { subtab: 'overview', scroll: { top: 123 } });
    const peer = doneId(tabs.open({ route: peerPage }, { how: 'background' }));
    const match = doneId(tabs.open({ route: view }, { how: 'background' }));
    const before = tabs.getSnapshot();
    expect(before.mounted).toEqual([id]);
    expect(tabs.navigate(id, { route: view }, { origin: navigationOrigin(before), history: 'push', reuse: false })).toEqual({ status: 'done', id });
    expect(tabs.getSnapshot().active).toBe(id);
    expect(tabs.getSnapshot().order).toEqual(before.order);
    expect(tab(tabs, peer)).toBe(before.tabs[peer]);
    expect(tab(tabs, match)).toBe(before.tabs[match]);
    expect(tab(tabs, id).history.entries).toEqual([list, detail, view]);
    expect(tab(tabs, id).pageState).toBeNull();
    const onView = tabs.getSnapshot();
    expect(tabs.navigate(id, { route: { ...view } })).toEqual({ status: 'noop' });
    expect(tabs.getSnapshot()).toBe(onView);
    tabs.back(id);
    expect(tab(tabs, id)).toMatchObject({ location: { route: detail }, pageState: { subtab: 'overview', scroll: { top: 123 } }, history: { index: 1 } });
    tabs.forward(id);
    expect(tab(tabs, id)).toMatchObject({ location: { route: view }, pageState: null, history: { index: 2, entries: [list, detail, view] } });
    tabs.back(id);
    const second = { ...view, offer: 'peer/another' };
    tabs.open({ route: second }, { how: 'here', origin: navigationOrigin(tabs.getSnapshot()) });
    expect(tab(tabs, id).history.entries).toEqual([list, detail, second]);
    expect(tabs.canForward(id)).toBe(false);
    expect(checkInvariants(tabs.getSnapshot())).toEqual([]);
  });

  it('creates only a destination when empty; explicit new/background are not deduplicated and scope change alone may reuse', () => {
    const { tabs } = fixture();
    const first = doneId(tabs.open({ route: view }, { how: 'here', origin: navigationOrigin(tabs.getSnapshot()) }));
    const same = doneId(tabs.open({ route: view }, { how: 'new' }));
    const east = { ...view, connection: 'east' };
    const match = doneId(tabs.open({ route: east }, { how: 'background' }));
    expect(tabs.getSnapshot().active).toBe(same);
    expect(tabs.getSnapshot().mounted).not.toContain(match);
    for (const id of [first, same, match]) {
      expect(tab(tabs, id).history).toEqual({ entries: [id === match ? east : view], index: 0 });
    }

    const source = tab(tabs, same);
    expect(tabs.navigate(same, { route: east }, { history: 'replace', reuse: true })).toEqual({ status: 'done', id: match });
    expect(tab(tabs, same)).toBe(source);
    const north = { ...east, connection: 'north' };
    tabs.navigate(match, { route: north }, { history: 'replace', reuse: true });
    expect(tab(tabs, match).history).toEqual({ entries: [north], index: 0 });
  });

  it('keeps the first background mount unselected across save and restore until explicit activation', () => {
    const { tabs, contributions } = fixture();
    const opened = tabs.open({ route: view }, { how: 'background' });
    const id = doneId(opened);
    expect(opened).toMatchObject({ focused: false });
    expect(tabs.getSnapshot()).toMatchObject({ order: [id], active: null, mounted: [], started: true });
    expect(checkInvariants(tabs.getSnapshot())).toEqual([]);
    const saved = tabs.serialise();
    const read = restored(saved, contributions);
    expect(read.state).toMatchObject({ order: [id], active: null, mounted: [] });
    expect(read.repaired).toBe(false);
    expect(restored({ ...saved, active: 'broken' }, contributions).state.mounted).toEqual([]);
    const receiver = createTabsStore({ contributions, initial: read.state });
    receiver.next();
    expect(receiver.getSnapshot()).toMatchObject({ active: id, mounted: [id] });
    expect(checkInvariants(receiver.getSnapshot())).toEqual([]);
    expect(doneId(tabs.open({ route: list }, { how: 'background' }))).toBe(tabs.getSnapshot().active);
  });

  it('keeps a dirty source unchanged until its still-current press is confirmed', () => {
    const { tabs } = fixture();
    const id = doneId(tabs.open({ route: detail }));
    tabs.setUnsaved(id, true);
    const source = tabs.getSnapshot();
    const origin = navigationOrigin(source);
    expect(tabs.navigate(id, { route: view }, { origin })).toEqual({ status: 'confirm', action: 'navigate', tabs: [id] });
    expect(tabs.getSnapshot()).toBe(source);
    // Unrelated background work is not a different initiating visit.
    tabs.open({ route: peerPage }, { how: 'background' });
    expect(tabs.navigate(id, { route: view }, { origin, confirmed: true })).toEqual({ status: 'done', id });
    expect(tab(tabs, id)).toMatchObject({ history: { entries: [detail, view], index: 1 }, flags: { unsaved: false } });
  });

  it.each(['other tab', 'switch away and back', 'different location', 'traverse away and back', 'reload', 'close and reopen'] as const)('rejects a delayed confirmation after %s', (change) => {
    const { tabs, describeView } = fixture();
    const id = doneId(tabs.open({ route: detail }));
    tabs.setUnsaved(id, true);
    const origin = navigationOrigin(tabs.getSnapshot());
    expect(tabs.open({ route: view }, { how: 'here', origin })).toMatchObject({ status: 'confirm' });
    if (change === 'other tab' || change === 'switch away and back') {
      tabs.open({ route: peerPage }, { how: 'new' });
      if (change === 'switch away and back') {
        tabs.activate(id);
      }
    } else if (change === 'different location' || change === 'traverse away and back') {
      tabs.navigate(id, { route: list }, { confirmed: true });
      if (change === 'traverse away and back') {
        tabs.back(id);
      }
    } else if (change === 'reload') {
      tabs.reload(id, { confirmed: true });
    } else {
      tabs.close(id, { confirmed: true });
      tabs.reopen({ id });
    }

    const current = tabs.getSnapshot();
    describeView.mockClear();
    const guard = { origin, confirmed: true };
    for (const result of [tabs.navigate(id, { route: view }, guard), tabs.open({ route: view }, { how: 'here', ...guard }), tabs.forward(id, guard)]) {
      expect(result).toMatchObject({ status: 'refused', reason: 'stale' });
    }

    expect(tabs.getSnapshot()).toBe(current);
    expect(describeView).not.toHaveBeenCalled();
  });

  it('rebuilds rather than trusting a saved face/key, never asks ordinary page hooks about a mount, and keeps it on loss', () => {
    const { tabs, contributions, describeView, complete, restore, availability, describe } = fixture();
    const id = doneId(tabs.open({ route: view }));
    const background = doneId(tabs.open({ route: view }, { how: 'background' }));
    const key = tab(tabs, id).location.key;
    tabs.setPageState(id, { privateState: 'never transfer' });
    const saved = tabs.serialise();
    expect(saved.version).toBe(STATE_VERSION);
    const raw = { ...saved, tabs: saved.tabs.map((entry) => ({ ...entry, key: 'owner:home', face: { title: 'Old content', singleton: true }, pageState: 'forged', history: { ...entry.history, states: ['forged'] } })) };
    expect(saved.tabs[0]).toEqual({ id, route: view, pinned: false, preview: false, history: { entries: [view], index: 0 } });
    describeView.mockReturnValue(undefined);
    const read = restored(raw, contributions);
    expect(read.state.mounted).toEqual([id]);
    expect(read.state.order).toEqual([id, background]);
    const receiver = createTabsStore({ contributions, initial: read.state });
    for (const tabId of [id, background]) {
      expect(tab(receiver, tabId)).toMatchObject({ location: { route: view, key }, face: { title: 'View unavailable', singleton: false }, pageState: null });
    }

    expect(receiver.closePlugin(view.plugin)).toEqual({ status: 'noop' });
    receiver.close(id);
    receiver.reopen({ id });
    expect(tab(receiver, id).location.key).toBe(key);
    describeView.mockReturnValue({ title: 'Renamed' });
    receiver.refresh('peer');
    expect(tab(receiver, id).face.title).toBe('Renamed');
    describeView.mockReturnValue(undefined);
    receiver.refresh('peer');
    expect(tab(receiver, id)).toMatchObject({ history: { entries: [view], index: 0 }, face: { title: 'View unavailable' } });
    for (const hook of [describe, complete, restore, availability]) {
      expect(hook).not.toHaveBeenCalled();
    }

    expect(checkInvariants(receiver.getSnapshot())).toEqual([]);
  });

  it('never reuses an ordinary tab whose untrusted saved key equals the mounted key', () => {
    const { tabs, contributions } = fixture();
    const id = doneId(tabs.open({ route: view }));
    const key = tab(tabs, id).location.key;
    const unknown: Contributions = { ...contributions, describe: () => undefined };
    const raw = { version: STATE_VERSION, active: 'source', tabs: [{ id: 'source', route: detail }, { id: 'forged', route: peerPage, key }] };
    const receiver = createTabsStore({ contributions: unknown, initial: restored(raw, unknown).state });
    expect(tab(receiver, 'forged').location.key).toBe(key);
    expect(receiver.navigate('source', { route: view }, { history: 'replace', reuse: true })).toEqual({ status: 'done', id: 'source' });
    expect(tab(receiver, 'source').location.route).toEqual(view);
    expect(tab(receiver, 'forged').location.route).toEqual(peerPage);
  });

  it('caps mixed in-memory history at 50, saves 10 around the cursor, and repairs oversized transfers at that same cursor', () => {
    const { tabs, contributions } = fixture();
    const id = doneId(tabs.open({ route: list }));
    for (let i = 1; i <= 66; i++) {
      tabs.setPageState(id, { ephemeral: i });
      tabs.navigate(id, { route: i % 2 === 0 ? { ...view, connection: `scope-${i}` } : { ...detail, params: { item: i } } });
    }

    for (let i = 0; i < 6; i++) {
      tabs.back(id);
    }

    const live = tab(tabs, id);
    expect(live.history.entries).toHaveLength(LIMITS.history);
    const start = live.history.index - 5;
    const wanted = { entries: live.history.entries.slice(start, start + LIMITS.persistedHistory), index: 5 };
    const saved = tabs.serialise();
    expect(saved.tabs[0]?.history).toEqual(wanted);
    expect(JSON.stringify(saved)).not.toContain('ephemeral');
    const roundTrip = restored(JSON.parse(JSON.stringify(saved)), contributions);
    expect(roundTrip.repaired).toBe(false);
    expect(roundTrip.state.tabs[id]?.history).toEqual(wanted);
    const receiver = createTabsStore({ contributions });
    expect(receiver.adopt({ ...saved.tabs[0], history: live.history })).toEqual({ status: 'done', id });
    expect(tab(receiver, id).history).toEqual(wanted);
    expect(tab(receiver, id).pageState).toBeNull();
  });

  it('keeps legacy ordinary histories and repairs malformed tagged entries without treating them as pages', () => {
    const { contributions } = fixture();
    const old = { version: 1, active: 'old', tabs: [{ id: 'old', route: detail, history: { entries: [list, detail], index: 1 } }] };
    expect(restored(old, contributions).state.tabs.old?.history).toEqual(old.tabs[0]?.history);
    const bad = { ...view, contribution: 'home', params: { connection: 'guessed' } };
    const read = restored({ version: STATE_VERSION, active: 'a', tabs: [
      { id: 'a', route: view, history: { entries: [list, bad, detail, view], index: 3 } }, { id: 'bad', route: bad },
    ] }, contributions);
    expect(read.repaired).toBe(true);
    expect(read.state.order).toEqual(['a']);
    expect(read.state.tabs.a?.history).toEqual({ entries: [list, detail, view], index: 2 });
  });
});
