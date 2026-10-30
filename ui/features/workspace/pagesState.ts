import { connectionKeyOfPath } from './pagePaths';

/** Chrome's tab group palette; the strip maps each name to a theme color. */
export const PAGE_GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'] as const;
export type PageGroupColor = (typeof PAGE_GROUP_COLORS)[number];

export type PageTab = {
  id: string;
  /** Router location of the tab: pathname plus search. */
  path: string;
  pinned?: boolean;
  groupId?: string;
  /** Last title shown, used until the plugin and connection names load. */
  title?: string;
};

export type PageGroup = { id: string; title: string; color: PageGroupColor; collapsed?: boolean };

export type PagePane = { id: string; tabIds: string[]; activeTabId: string | null };

/** The `pages` window state slot. */
export type PagesState = {
  version: 1;
  tabs: Record<string, PageTab>;
  groups: PageGroup[];
  /** One pane, or two side by side. */
  panes: PagePane[];
  activePaneId: string;
  /** Width of the first pane as a fraction of the pane area. */
  splitRatio: number;
};

/** A page tab serialized for another window (drag payload or "Move to window"). */
export type PageTabTransfer = { path: string; title?: string; pinned?: boolean };

export const MAX_PANES = 2;
export const DEFAULT_SPLIT_RATIO = 0.5;
const MIN_SPLIT_RATIO = 0.1;
const MAX_SPLIT_RATIO = 0.9;

export type PagesAction =
  | { type: 'open'; tab: { id: string; path: string }; paneId: string; afterTabId: string | null; activate: boolean }
  | { type: 'activate'; tabId: string }
  | { type: 'activatePane'; paneId: string }
  /** Closes tabs, or removes them after they were transferred to another window. */
  | { type: 'close'; tabIds: string[] }
  | { type: 'reorder'; paneId: string; tabIds: string[] }
  | { type: 'setPinned'; tabId: string; pinned: boolean }
  | { type: 'createGroup'; group: PageGroup; tabId: string }
  | { type: 'addToGroup'; tabId: string; groupId: string }
  | { type: 'removeFromGroup'; tabId: string }
  | { type: 'updateGroup'; groupId: string; changes: Partial<Pick<PageGroup, 'title' | 'color' | 'collapsed'>> }
  | { type: 'ungroup'; groupId: string }
  /** Moves a tab of this window to a pane (strip drop from the other pane). `index: null` appends. */
  | { type: 'moveToPane'; tabId: string; paneId: string; index: number | null }
  /** Opens a second pane with the tab, or moves it to the other pane when already split. */
  | { type: 'split'; tabId: string; newPaneId: string }
  | { type: 'unsplit' }
  /** Takes a tab from another window. */
  | { type: 'adopt'; tab: PageTab; target: { paneId: string; index: number | null } | { newPaneId: string } }
  | { type: 'setPath'; tabId: string; path: string }
  | { type: 'setTitles'; titles: Record<string, string> }
  | { type: 'setSplitRatio'; ratio: number };

export function createSingleTabState(tab: PageTab, paneId: string): PagesState {
  return {
    version: 1,
    tabs: { [tab.id]: { id: tab.id, path: tab.path, ...(tab.pinned ? { pinned: true } : {}), ...(tab.title ? { title: tab.title } : {}) } },
    groups: [],
    panes: [{ id: paneId, tabIds: [tab.id], activeTabId: tab.id }],
    activePaneId: paneId,
    splitRatio: DEFAULT_SPLIT_RATIO,
  };
}

export function countTabs(state: PagesState): number {
  return state.panes.reduce((count, pane) => count + pane.tabIds.length, 0);
}

export function findPaneOfTab(state: PagesState, tabId: string): PagePane | undefined {
  return state.panes.find((pane) => pane.tabIds.includes(tabId));
}

export function getActiveTab(state: PagesState): PageTab | undefined {
  const pane = state.panes.find((candidate) => candidate.id === state.activePaneId) ?? state.panes[0];
  return pane.activeTabId ? state.tabs[pane.activeTabId] : undefined;
}

export function toPageTabTransfer(tab: PageTab): PageTabTransfer {
  return { path: tab.path, ...(tab.title ? { title: tab.title } : {}), ...(tab.pinned ? { pinned: true } : {}) };
}

/** Main window rule: it never ends up without a tab. */
export function withTabIfEmpty(state: PagesState, tab: { id: string; path: string }): PagesState {
  if (countTabs(state) > 0) {
    return state;
  }

  const pane = state.panes[0];
  return {
    ...state,
    tabs: { [tab.id]: { id: tab.id, path: tab.path } },
    panes: [{ ...pane, tabIds: [tab.id], activeTabId: tab.id }],
    activePaneId: pane.id,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function updateTab(state: PagesState, tabId: string, update: (tab: PageTab) => PageTab): PagesState {
  const tab = state.tabs[tabId] as PageTab | undefined;
  if (!tab) {
    return state;
  }

  return { ...state, tabs: { ...state.tabs, [tabId]: update(tab) } };
}

function withoutGroup({ groupId: _groupId, ...tab }: PageTab): PageTab {
  return tab;
}

/** Chrome rule: activate the tab to the right of the removed active tab, else the one to the left. */
function removeFromPane(pane: PagePane, removed: ReadonlySet<string>): PagePane {
  const tabIds = pane.tabIds.filter((id) => !removed.has(id));
  if (!pane.activeTabId || !removed.has(pane.activeTabId)) {
    return { ...pane, tabIds };
  }

  const index = pane.tabIds.indexOf(pane.activeTabId);
  const right = pane.tabIds.slice(index + 1).find((id) => !removed.has(id));
  const left = pane.tabIds.slice(0, index).findLast((id) => !removed.has(id));
  return { ...pane, tabIds, activeTabId: right ?? left ?? null };
}

function insertAt(ids: string[], id: string, index: number | null): string[] {
  const at = index === null ? ids.length : Math.max(0, Math.min(index, ids.length));
  return [...ids.slice(0, at), id, ...ids.slice(at)];
}

/** A tab opened on a connection joins the group that other tabs of that connection already use. */
function groupOfConnection(state: PagesState, path: string): string | undefined {
  const key = connectionKeyOfPath(path);
  if (!key) {
    return undefined;
  }

  return Object.values(state.tabs).find((tab) => tab.groupId && connectionKeyOfPath(tab.path) === key)?.groupId;
}

/** Moves the tab id to the end of its pane, so ordering puts it last within its new segment. */
function moveTabToPaneEnd(state: PagesState, tabId: string): PagesState {
  return {
    ...state,
    panes: state.panes.map((pane) => pane.tabIds.includes(tabId)
      ? { ...pane, tabIds: [...pane.tabIds.filter((id) => id !== tabId), tabId] }
      : pane),
  };
}

function applyAction(state: PagesState, action: PagesAction): PagesState {
  switch (action.type) {
    case 'open': {
      if (state.tabs[action.tab.id]) {
        return state;
      }

      const pane = state.panes.find((candidate) => candidate.id === action.paneId) ?? state.panes[0];
      const anchor = action.afterTabId && pane.tabIds.includes(action.afterTabId) ? state.tabs[action.afterTabId] : undefined;
      const groupId = groupOfConnection(state, action.tab.path) ?? (anchor && !anchor.pinned ? anchor.groupId : undefined);
      const tab: PageTab = { id: action.tab.id, path: action.tab.path, ...(groupId ? { groupId } : {}) };
      const index = anchor ? pane.tabIds.indexOf(anchor.id) + 1 : null;
      return {
        ...state,
        tabs: { ...state.tabs, [tab.id]: tab },
        panes: state.panes.map((candidate) => candidate === pane
          ? { ...pane, tabIds: insertAt(pane.tabIds, tab.id, index), activeTabId: action.activate ? tab.id : pane.activeTabId }
          : candidate),
        activePaneId: action.activate ? pane.id : state.activePaneId,
      };
    }

    case 'activate': {
      const pane = findPaneOfTab(state, action.tabId);
      if (!pane || (pane.activeTabId === action.tabId && state.activePaneId === pane.id)) {
        return state;
      }

      return {
        ...state,
        panes: state.panes.map((candidate) => candidate === pane ? { ...pane, activeTabId: action.tabId } : candidate),
        activePaneId: pane.id,
      };
    }

    case 'activatePane':
      return state.activePaneId === action.paneId || !state.panes.some((pane) => pane.id === action.paneId)
        ? state
        : { ...state, activePaneId: action.paneId };

    case 'close': {
      const removed = new Set(action.tabIds.filter((id) => id in state.tabs));
      if (removed.size === 0) {
        return state;
      }

      const tabs = Object.fromEntries(Object.entries(state.tabs).filter(([id]) => !removed.has(id)));
      return { ...state, tabs, panes: state.panes.map((pane) => removeFromPane(pane, removed)) };
    }

    case 'reorder': {
      const pane = state.panes.find((candidate) => candidate.id === action.paneId);
      if (!pane) {
        return state;
      }

      if (action.tabIds.length !== pane.tabIds.length || !action.tabIds.every((id) => pane.tabIds.includes(id))) {
        return state;
      }

      return {
        ...state,
        panes: state.panes.map((candidate) => candidate === pane ? { ...pane, tabIds: [...action.tabIds] } : candidate),
      };
    }

    case 'setPinned':
      return updateTab(state, action.tabId, (tab) => {
        if (Boolean(tab.pinned) === action.pinned) {
          return tab;
        }

        if (action.pinned) {
          return { ...withoutGroup(tab), pinned: true };
        }

        const { pinned: _pinned, ...unpinned } = tab;
        return unpinned;
      });

    case 'createGroup': {
      if (!(action.tabId in state.tabs) || state.groups.some((group) => group.id === action.group.id)) {
        return state;
      }

      const grouped = updateTab(state, action.tabId, ({ pinned: _pinned, ...tab }) => ({ ...tab, groupId: action.group.id }));
      return { ...grouped, groups: [...state.groups, action.group] };
    }

    case 'addToGroup': {
      if (!state.groups.some((group) => group.id === action.groupId) || state.tabs[action.tabId]?.groupId === action.groupId) {
        return state;
      }

      const grouped = updateTab(state, action.tabId, ({ pinned: _pinned, ...tab }) => ({ ...tab, groupId: action.groupId }));
      return moveTabToPaneEnd(grouped, action.tabId);
    }

    case 'removeFromGroup':
      return state.tabs[action.tabId]?.groupId ? updateTab(state, action.tabId, withoutGroup) : state;

    case 'updateGroup': {
      const group = state.groups.find((candidate) => candidate.id === action.groupId);
      if (!group) {
        return state;
      }

      return {
        ...state,
        groups: state.groups.map((candidate) => candidate === group ? { ...group, ...action.changes } : candidate),
      };
    }

    case 'ungroup': {
      const tabs = { ...state.tabs };
      for (const tab of Object.values(state.tabs)) {
        if (tab.groupId === action.groupId) {
          tabs[tab.id] = withoutGroup(tab);
        }
      }

      return { ...state, tabs, groups: state.groups.filter((group) => group.id !== action.groupId) };
    }

    case 'moveToPane': {
      const source = findPaneOfTab(state, action.tabId);
      const target = state.panes.find((pane) => pane.id === action.paneId);
      if (!source || !target) {
        return state;
      }

      const removed = new Set([action.tabId]);
      return {
        ...state,
        panes: state.panes.map((pane) => {
          const remaining = pane === source ? removeFromPane(pane, removed) : pane;
          return pane === target
            ? { ...remaining, tabIds: insertAt(remaining.tabIds, action.tabId, action.index), activeTabId: action.tabId }
            : remaining;
        }),
        activePaneId: target.id,
      };
    }

    case 'split': {
      const source = findPaneOfTab(state, action.tabId);
      if (!source) {
        return state;
      }

      if (state.panes.length >= MAX_PANES) {
        const other = state.panes.find((pane) => pane !== source);
        return other ? applyAction(state, { type: 'moveToPane', tabId: action.tabId, paneId: other.id, index: null }) : state;
      }

      if (source.tabIds.length === 1) {
        return state;
      }

      return {
        ...state,
        panes: [
          ...state.panes.map((pane) => pane === source ? removeFromPane(pane, new Set([action.tabId])) : pane),
          { id: action.newPaneId, tabIds: [action.tabId], activeTabId: action.tabId },
        ],
        activePaneId: action.newPaneId,
      };
    }

    case 'unsplit': {
      if (state.panes.length < 2) {
        return state;
      }

      const [first, ...rest] = state.panes;
      return {
        ...state,
        panes: [{ ...first, tabIds: [...first.tabIds, ...rest.flatMap((pane) => pane.tabIds)] }],
        activePaneId: first.id,
      };
    }

    case 'adopt': {
      if (action.tab.id in state.tabs) {
        return state;
      }

      const groupId = groupOfConnection(state, action.tab.path);
      const tab: PageTab = { ...withoutGroup(action.tab), ...(groupId && !action.tab.pinned ? { groupId } : {}) };
      const tabs = { ...state.tabs, [tab.id]: tab };
      const { target } = action;
      if ('newPaneId' in target && state.panes.length < MAX_PANES) {
        return {
          ...state,
          tabs,
          panes: [...state.panes, { id: target.newPaneId, tabIds: [tab.id], activeTabId: tab.id }],
          activePaneId: target.newPaneId,
        };
      }

      const pane = 'paneId' in target
        ? state.panes.find((candidate) => candidate.id === target.paneId) ?? state.panes[0]
        : state.panes[state.panes.length - 1];
      const index = 'paneId' in target ? target.index : null;
      return {
        ...state,
        tabs,
        panes: state.panes.map((candidate) => candidate === pane
          ? { ...pane, tabIds: insertAt(pane.tabIds, tab.id, index), activeTabId: tab.id }
          : candidate),
        activePaneId: pane.id,
      };
    }

    case 'setPath':
      return state.tabs[action.tabId]?.path === action.path
        ? state
        : updateTab(state, action.tabId, (tab) => ({ ...tab, path: action.path }));

    case 'setTitles': {
      const changed = Object.entries(action.titles).filter(([id, title]) => id in state.tabs && state.tabs[id].title !== title);
      if (changed.length === 0) {
        return state;
      }

      const tabs = { ...state.tabs };
      for (const [id, title] of changed) {
        tabs[id] = { ...tabs[id], title };
      }

      return { ...state, tabs };
    }

    case 'setSplitRatio': {
      const ratio = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, action.ratio));
      return ratio === state.splitRatio ? state : { ...state, splitRatio: ratio };
    }
  }
}

/**
 * Restores the invariants every state change must keep:
 * - every tab is in exactly one pane, and every pane id refers to a tab;
 * - pinned tabs are ungrouped, grouped tabs refer to an existing group, groups without tabs disappear;
 * - each pane lists pinned tabs first, then groups in group order, then ungrouped tabs (the order the strip shows);
 * - empty panes collapse, but one pane always remains;
 * - active tab and active pane refer to existing entries.
 */
export function normalizePagesState(state: PagesState): PagesState {
  const placed = new Set<string>();
  const panesWithTabs = state.panes.map((pane) => ({
    ...pane,
    tabIds: pane.tabIds.filter((id) => {
      if (!(id in state.tabs) || placed.has(id)) {
        return false;
      }

      placed.add(id);
      return true;
    }),
  }));

  const knownGroupIds = new Set(state.groups.map((group) => group.id));
  const tabs: Record<string, PageTab> = {};
  for (const id of placed) {
    const tab = state.tabs[id];
    tabs[id] = tab.groupId && (tab.pinned === true || !knownGroupIds.has(tab.groupId)) ? withoutGroup(tab) : tab;
  }

  const usedGroupIds = new Set(Object.values(tabs).flatMap((tab) => tab.groupId ? [tab.groupId] : []));
  const groups = state.groups.filter((group) => usedGroupIds.has(group.id));
  const groupRank = new Map(groups.map((group, index) => [group.id, index + 1]));
  const rankOf = (id: string) => {
    const tab = tabs[id];
    if (tab.pinned) {
      return 0;
    }

    return tab.groupId ? groupRank.get(tab.groupId) ?? groups.length + 1 : groups.length + 1;
  };

  const orderedPanes = panesWithTabs.map((pane) => {
    const tabIds = pane.tabIds.toSorted((a, b) => rankOf(a) - rankOf(b));
    const activeTabId = pane.activeTabId && tabIds.includes(pane.activeTabId) ? pane.activeTabId : tabIds[0] ?? null;
    return { ...pane, tabIds, activeTabId };
  });
  const nonEmptyPanes = orderedPanes.filter((pane) => pane.tabIds.length > 0);
  const panes = nonEmptyPanes.length > 0 ? nonEmptyPanes : [{ ...orderedPanes[0], tabIds: [], activeTabId: null }];
  const activePaneId = panes.some((pane) => pane.id === state.activePaneId) ? state.activePaneId : panes[0].id;

  return { ...state, tabs, groups, panes, activePaneId };
}

export function pagesReducer(state: PagesState, action: PagesAction): PagesState {
  const next = applyAction(state, action);
  return next === state ? state : normalizePagesState(next);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`invalid pages state: ${message}`);
}

function expectOptional(value: unknown, type: 'string' | 'boolean', field: string): void {
  if (value !== undefined && typeof value !== type) {
    fail(`${field} must be a ${type}`);
  }
}

function isRoutePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/');
}

function parseTab(key: string, value: unknown): PageTab {
  if (!isRecord(value)) {
    fail(`tab "${key}" is not an object`);
  }

  if (value.id !== key) {
    fail(`tab "${key}" has id ${JSON.stringify(value.id)}`);
  }

  if (!isRoutePath(value.path)) {
    fail(`tab "${key}" path must start with "/"`);
  }

  expectOptional(value.pinned, 'boolean', `tab "${key}" pinned`);
  expectOptional(value.groupId, 'string', `tab "${key}" groupId`);
  expectOptional(value.title, 'string', `tab "${key}" title`);
  return {
    id: key,
    path: value.path,
    ...(value.pinned === true ? { pinned: true } : {}),
    ...(typeof value.groupId === 'string' ? { groupId: value.groupId } : {}),
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
  };
}

function parseGroup(value: unknown, index: number): PageGroup {
  if (!isRecord(value)) {
    fail(`group ${index} is not an object`);
  }

  if (typeof value.id !== 'string' || !value.id) {
    fail(`group ${index} id must be a non-empty string`);
  }

  if (typeof value.title !== 'string') {
    fail(`group "${value.id}" title must be a string`);
  }

  if (!PAGE_GROUP_COLORS.includes(value.color as PageGroupColor)) {
    fail(`group "${value.id}" has unknown color`);
  }

  expectOptional(value.collapsed, 'boolean', `group "${value.id}" collapsed`);
  return {
    id: value.id,
    title: value.title,
    color: value.color as PageGroupColor,
    ...(value.collapsed === true ? { collapsed: true } : {}),
  };
}

function parsePane(value: unknown, index: number): PagePane {
  if (!isRecord(value)) {
    fail(`pane ${index} is not an object`);
  }

  if (typeof value.id !== 'string' || !value.id) {
    fail(`pane ${index} id must be a non-empty string`);
  }

  if (!Array.isArray(value.tabIds) || !value.tabIds.every((id) => typeof id === 'string')) {
    fail(`pane "${value.id}" tabIds must be strings`);
  }

  const tabIds = value.tabIds;
  if (value.activeTabId !== null && !(typeof value.activeTabId === 'string' && tabIds.includes(value.activeTabId))) {
    fail(`pane "${value.id}" active tab is not one of its tabs`);
  }

  return { id: value.id, tabIds: [...tabIds], activeTabId: value.activeTabId };
}

/** Validates a saved `pages` slot. Throws on anything that does not match the schema. */
export function parsePagesState(value: unknown): PagesState {
  if (!isRecord(value)) {
    fail('not an object');
  }

  if (value.version !== 1) {
    fail(`unsupported version ${JSON.stringify(value.version)}`);
  }

  if (!isRecord(value.tabs)) {
    fail('tabs must be an object');
  }

  if (!Array.isArray(value.groups)) {
    fail('groups must be an array');
  }

  if (!Array.isArray(value.panes) || value.panes.length < 1 || value.panes.length > MAX_PANES) {
    fail(`panes must hold 1 to ${MAX_PANES} panes`);
  }

  const tabs: Record<string, PageTab> = {};
  for (const [key, tab] of Object.entries(value.tabs)) {
    tabs[key] = parseTab(key, tab);
  }

  const groups = value.groups.map(parseGroup);
  const groupIds = new Set(groups.map((group) => group.id));
  if (groupIds.size !== groups.length) {
    fail('group ids must be unique');
  }

  for (const tab of Object.values(tabs)) {
    if (tab.groupId && !groupIds.has(tab.groupId)) {
      fail(`tab "${tab.id}" refers to unknown group "${tab.groupId}"`);
    }
  }

  const panes = value.panes.map(parsePane);
  if (new Set(panes.map((pane) => pane.id)).size !== panes.length) {
    fail('pane ids must be unique');
  }

  const placed = panes.flatMap((pane) => pane.tabIds);
  if (new Set(placed).size !== placed.length) {
    fail('a tab is listed twice');
  }

  for (const id of placed) {
    if (!(id in tabs)) {
      fail(`pane lists unknown tab "${id}"`);
    }
  }

  if (placed.length !== Object.keys(tabs).length) {
    fail('a tab is not in any pane');
  }

  if (typeof value.activePaneId !== 'string' || !panes.some((pane) => pane.id === value.activePaneId)) {
    fail('activePaneId must name a pane');
  }

  if (typeof value.splitRatio !== 'number' || !(value.splitRatio > 0 && value.splitRatio < 1)) {
    fail('splitRatio must be between 0 and 1');
  }

  return normalizePagesState({ version: 1, tabs, groups, panes, activePaneId: value.activePaneId, splitRatio: value.splitRatio });
}

/** Validates a tab handed over by another window. Throws when it is not a page tab. */
export function parsePageTabTransfer(value: unknown): PageTabTransfer {
  if (!isRecord(value)) {
    throw new Error('invalid page tab transfer: not an object');
  }

  if (!isRoutePath(value.path)) {
    throw new Error('invalid page tab transfer: path must start with "/"');
  }

  if (value.title !== undefined && typeof value.title !== 'string') {
    throw new Error('invalid page tab transfer: title must be a string');
  }

  if (value.pinned !== undefined && typeof value.pinned !== 'boolean') {
    throw new Error('invalid page tab transfer: pinned must be a boolean');
  }

  return {
    path: value.path,
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
    ...(value.pinned === true ? { pinned: true } : {}),
  };
}
