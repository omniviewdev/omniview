import { describe, expect, it } from 'vitest';
import {
  countTabs,
  createSingleTabState,
  pagesReducer,
  parsePagesState,
  parsePageTabTransfer,
  withTabIfEmpty,
  type PagesAction,
  type PagesState,
} from './pagesState';

const run = (state: PagesState, ...actions: PagesAction[]) => actions.reduce(pagesReducer, state);

/** One pane with tabs `a`, `b`, `c`... at `/<id>`; the first is active. */
function paneWith(...ids: string[]): PagesState {
  const [first, ...rest] = ids;
  return run(
    createSingleTabState({ id: first, path: `/${first}` }, 'p1'),
    ...rest.map((id, index): PagesAction => ({
      type: 'open', tab: { id, path: `/${id}` }, paneId: 'p1', afterTabId: index === 0 ? first : rest[index - 1], activate: false,
    })),
  );
}

const tabIdsOf = (state: PagesState) => state.panes.map((pane) => pane.tabIds);

describe('closing tabs', () => {
  it('activates the tab to the right of the closed active tab, else the one to the left', () => {
    const state = run(paneWith('a', 'b', 'c'), { type: 'activate', tabId: 'b' });
    expect(run(state, { type: 'close', tabIds: ['b'] }).panes[0].activeTabId).toBe('c');
    expect(run(state, { type: 'activate', tabId: 'c' }, { type: 'close', tabIds: ['c'] }).panes[0].activeTabId).toBe('b');
  });

  it('leaves one empty pane after the last tab closes; the main window rule then opens a tab', () => {
    const empty = run(paneWith('a'), { type: 'close', tabIds: ['a'] });
    expect(countTabs(empty)).toBe(0);
    expect(empty.panes).toEqual([{ id: 'p1', tabIds: [], activeTabId: null }]);

    const restored = withTabIfEmpty(empty, { id: 'home', path: '/' });
    expect(restored.panes[0]).toEqual({ id: 'p1', tabIds: ['home'], activeTabId: 'home' });
    expect(withTabIfEmpty(restored, { id: 'other', path: '/' })).toBe(restored);
  });

  it('removes a tab transferred to another window and forgets it', () => {
    const state = run(paneWith('a', 'b'), { type: 'close', tabIds: ['b'] });
    expect(state.tabs).not.toHaveProperty('b');
    expect(tabIdsOf(state)).toEqual([['a']]);
  });
});

describe('pinning', () => {
  it('keeps pinned tabs in front of all others and ungroups them', () => {
    const grouped = run(paneWith('a', 'b', 'c'), {
      type: 'createGroup', group: { id: 'g', title: 'G', color: 'blue' }, tabId: 'c',
    });
    const pinned = run(grouped, { type: 'setPinned', tabId: 'c', pinned: true });
    expect(tabIdsOf(pinned)).toEqual([['c', 'a', 'b']]);
    expect(pinned.tabs.c).toEqual({ id: 'c', path: '/c', pinned: true });
    expect(pinned.groups).toEqual([]);
  });

  it('rejects a reorder that is not a permutation of the pane and restores the pin boundary', () => {
    const state = run(paneWith('a', 'b', 'c'), { type: 'setPinned', tabId: 'b', pinned: true });
    expect(run(state, { type: 'reorder', paneId: 'p1', tabIds: ['a', 'b'] })).toBe(state);
    expect(tabIdsOf(run(state, { type: 'reorder', paneId: 'p1', tabIds: ['a', 'c', 'b'] }))).toEqual([['b', 'a', 'c']]);
  });
});

describe('groups', () => {
  const grouped = run(paneWith('a', 'b', 'c', 'd'), {
    type: 'createGroup', group: { id: 'g', title: 'Prod', color: 'red' }, tabId: 'c',
  });

  it('lists grouped tabs before ungrouped ones and adds new members at the end of the group', () => {
    expect(tabIdsOf(grouped)).toEqual([['c', 'a', 'b', 'd']]);
    expect(tabIdsOf(run(grouped, { type: 'addToGroup', tabId: 'a', groupId: 'g' }))).toEqual([['c', 'a', 'b', 'd']]);
    expect(tabIdsOf(run(grouped, { type: 'addToGroup', tabId: 'd', groupId: 'g' }))).toEqual([['c', 'd', 'a', 'b']]);
  });

  it('renames, recolors and collapses', () => {
    const updated = run(grouped, { type: 'updateGroup', groupId: 'g', changes: { title: 'Staging', color: 'green', collapsed: true } });
    expect(updated.groups).toEqual([{ id: 'g', title: 'Staging', color: 'green', collapsed: true }]);
  });

  it('disappears when its last tab leaves it, and on ungroup', () => {
    expect(run(grouped, { type: 'removeFromGroup', tabId: 'c' }).groups).toEqual([]);
    expect(run(grouped, { type: 'close', tabIds: ['c'] }).groups).toEqual([]);
    const ungrouped = run(grouped, { type: 'addToGroup', tabId: 'a', groupId: 'g' }, { type: 'ungroup', groupId: 'g' });
    expect(ungrouped.groups).toEqual([]);
    expect(Object.values(ungrouped.tabs).some((tab) => tab.groupId)).toBe(false);
  });

  it('puts a tab opened on a connection into the group of that connection', () => {
    const state = run(
      createSingleTabState({ id: 'a', path: '/_plugin/k8s/cluster/prod/resources' }, 'p1'),
      { type: 'createGroup', group: { id: 'g', title: 'prod', color: 'blue' }, tabId: 'a' },
      { type: 'open', tab: { id: 'b', path: '/' }, paneId: 'p1', afterTabId: null, activate: true },
      { type: 'open', tab: { id: 'c', path: '/_plugin/k8s/cluster/prod/edit' }, paneId: 'p1', afterTabId: 'b', activate: true },
    );
    expect(state.tabs.b.groupId).toBeUndefined();
    expect(state.tabs.c.groupId).toBe('g');
    expect(tabIdsOf(state)).toEqual([['a', 'c', 'b']]);
  });
});

describe('panes', () => {
  it('splits a tab into a second pane, and refuses to split the only tab of a pane', () => {
    const split = run(paneWith('a', 'b'), { type: 'split', tabId: 'b', newPaneId: 'p2' });
    expect(tabIdsOf(split)).toEqual([['a'], ['b']]);
    expect(split.activePaneId).toBe('p2');

    const single = paneWith('a');
    expect(run(single, { type: 'split', tabId: 'a', newPaneId: 'p2' })).toBe(single);
  });

  it('moves a tab to the other pane when already split, collapsing the emptied pane', () => {
    const split = run(paneWith('a', 'b'), { type: 'split', tabId: 'b', newPaneId: 'p2' });
    const moved = run(split, { type: 'split', tabId: 'a', newPaneId: 'p3' });
    expect(moved.panes).toEqual([{ id: 'p2', tabIds: ['b', 'a'], activeTabId: 'a' }]);
    expect(moved.activePaneId).toBe('p2');
  });

  it('moves a tab between panes at an index', () => {
    const split = run(paneWith('a', 'b', 'c'), { type: 'split', tabId: 'c', newPaneId: 'p2' });
    const moved = run(split, { type: 'moveToPane', tabId: 'a', paneId: 'p2', index: 0 });
    expect(tabIdsOf(moved)).toEqual([['b'], ['a', 'c']]);
    expect(moved.panes[1].activeTabId).toBe('a');
  });

  it('unsplits by appending the second pane to the first', () => {
    const split = run(paneWith('a', 'b', 'c'), { type: 'split', tabId: 'b', newPaneId: 'p2' });
    expect(run(split, { type: 'unsplit' }).panes).toEqual([{ id: 'p1', tabIds: ['a', 'c', 'b'], activeTabId: 'a' }]);
  });
});

describe('adopting tabs from other windows', () => {
  it('inserts at the drop index and activates the tab', () => {
    const state = run(paneWith('a', 'b'), {
      type: 'adopt', tab: { id: 'x', path: '/x', title: 'X' }, target: { paneId: 'p1', index: 1 },
    });
    expect(tabIdsOf(state)).toEqual([['a', 'x', 'b']]);
    expect(state.panes[0].activeTabId).toBe('x');
  });

  it('opens a new pane for a split-zone drop and ignores a tab id it already has', () => {
    const state = run(paneWith('a'), { type: 'adopt', tab: { id: 'x', path: '/x' }, target: { newPaneId: 'p2' } });
    expect(tabIdsOf(state)).toEqual([['a'], ['x']]);
    expect(run(state, { type: 'adopt', tab: { id: 'a', path: '/other' }, target: { paneId: 'p1', index: null } })).toBe(state);
  });

  it('never carries a foreign group id along', () => {
    const state = run(paneWith('a'), { type: 'adopt', tab: { id: 'x', path: '/x', groupId: 'elsewhere' }, target: { paneId: 'p1', index: null } });
    expect(state.tabs.x).toEqual({ id: 'x', path: '/x' });
  });
});

describe('parsePagesState', () => {
  const valid = run(
    paneWith('a', 'b', 'c'),
    { type: 'createGroup', group: { id: 'g', title: 'G', color: 'cyan' }, tabId: 'b' },
    { type: 'split', tabId: 'c', newPaneId: 'p2' },
    { type: 'setSplitRatio', ratio: 0.3 },
  );

  it('round-trips a saved state', () => {
    expect(parsePagesState(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it.each<[string, (state: PagesState) => unknown]>([
    ['another version', (state) => ({ ...state, version: 2 })],
    ['a tab key that differs from its id', (state) => ({ ...state, tabs: { ...state.tabs, z: state.tabs.a } })],
    ['a relative path', (state) => ({ ...state, tabs: { ...state.tabs, a: { ...state.tabs.a, path: 'a' } } })],
    ['a tab in two panes', (state) => ({ ...state, panes: [state.panes[0], { ...state.panes[1], tabIds: ['c', 'a'] }] })],
    ['a tab in no pane', (state) => ({ ...state, panes: [{ ...state.panes[0], tabIds: ['b'], activeTabId: 'b' }, state.panes[1]] })],
    ['an unknown group', (state) => ({ ...state, groups: [] })],
    ['an unknown color', (state) => ({ ...state, groups: [{ ...state.groups[0], color: 'teal' }] })],
    ['three panes', (state) => ({ ...state, panes: [...state.panes, { id: 'p3', tabIds: [], activeTabId: null }] })],
    ['an active tab outside its pane', (state) => ({ ...state, panes: [{ ...state.panes[0], activeTabId: 'c' }, state.panes[1]] })],
    ['an unknown active pane', (state) => ({ ...state, activePaneId: 'nope' })],
    ['a split ratio of 1', (state) => ({ ...state, splitRatio: 1 })],
  ])('rejects %s', (_case, corrupt) => {
    expect(() => parsePagesState(JSON.parse(JSON.stringify(corrupt(valid))))).toThrow(/invalid pages state/);
  });
});

describe('parsePageTabTransfer', () => {
  it('keeps path, title and pinned', () => {
    expect(parsePageTabTransfer({ path: '/x', title: 'X', pinned: true, groupId: 'g' })).toEqual({ path: '/x', title: 'X', pinned: true });
  });

  it('rejects anything that is not a page tab', () => {
    expect(() => parsePageTabTransfer({ path: 'x' })).toThrow();
    expect(() => parsePageTabTransfer({ kind: 'terminal' })).toThrow();
  });
});
