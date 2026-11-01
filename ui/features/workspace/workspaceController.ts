import type { RouteObject } from 'react-router';
import type { AttachCommit, TabTransferCommit } from '@omniviewdev/base-ui';
import { WindowClient } from '@omniviewdev/runtime/api';
import { openSettings, settingsWindowTarget } from '@omniviewdev/runtime';
import {
  currentWindow,
  deliverTabToWindow,
  moveCurrentWindowToPointer,
  openWindow,
  PAGE_TAB_DRAG_TYPE,
  readInitialSlot,
  saveSlot,
  type WindowClientPoint,
} from '@/features/windows';
import { HOME_PATH } from './pagePaths';
import {
  countTabs,
  createSingleTabState,
  findPaneOfTab,
  getActiveTab,
  PAGE_GROUP_COLORS,
  pagesReducer,
  parsePagesState,
  parsePageTabTransfer,
  toPageTabTransfer,
  withTabIfEmpty,
  type PageGroupColor,
  type PagePane,
  type PagesAction,
  type PagesState,
  type PageTab,
} from './pagesState';
import { PageTabRouters } from './tabRouters';

/**
 * Whether a tab may leave this window, for the given tabs. Components pass the
 * state they render: a call on the stable controller would be memoized by the
 * React Compiler and keep the answer from the first render.
 */
export function canTabLeaveWindow(state: PagesState): boolean {
  return !(currentWindow.isMain && countTabs(state) === 1);
}

const createId = () => crypto.randomUUID();

export const pageStripInstanceId = (paneId: string) => `pages-${currentWindow.name}-${paneId}`;
export const splitZoneInstanceId = (paneId: string) => `split-${currentWindow.name}-${paneId}`;

/** Strips and split zones of this window: a tab dropped on one of them never left the window. */
function isInstanceOfThisWindow(instanceId: string): boolean {
  return instanceId.startsWith(`pages-${currentWindow.name}-`) || instanceId.startsWith(`split-${currentWindow.name}-`);
}

/** The tabs saved for this window (loaded before the first render), or a single Home tab. */
export function readInitialPagesState(): PagesState {
  const restored = readInitialSlot('pages', parsePagesState);
  if (!restored) {
    return createSingleTabState({ id: createId(), path: HOME_PATH }, createId());
  }

  // Old sessions may contain Settings tabs. They no longer belong to a workspace,
  // and restoring a session must not eagerly create the Settings window.
  const obsolete = Object.values(restored.tabs).filter((tab) => settingsWindowTarget(tab.path) !== null);
  return obsolete.length === 0 ? restored : pagesReducer(restored, { type: 'close', tabIds: obsolete.map((tab) => tab.id) });
}

export type OpenPageOptions = { background?: boolean };

/**
 * Owns the page tabs of this window: their state (persisted to the `pages`
 * slot), one router per tab, the DOM host each tab renders into, and every
 * operation the strips, menus, keyboard shortcuts and plugins trigger.
 */
export class WorkspaceController {
  readonly routers: PageTabRouters;
  private state: PagesState;
  private readonly listeners = new Set<() => void>();
  private readonly tabHosts = new Map<string, HTMLDivElement>();
  private windowClosing = false;

  constructor(initialState: PagesState, routes: RouteObject[]) {
    this.state = currentWindow.isMain ? withTabIfEmpty(initialState, { id: createId(), path: HOME_PATH }) : initialState;
    this.routers = new PageTabRouters(routes, (tabId, path) => {
      this.dispatch({ type: 'setPath', tabId, path });
    });
  }

  getState = (): PagesState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  dispatch(action: PagesAction): void {
    let next = pagesReducer(this.state, action);
    if (next === this.state) {
      return;
    }

    if (currentWindow.isMain) {
      next = withTabIfEmpty(next, { id: createId(), path: HOME_PATH });
    }

    this.state = next;
    saveSlot('pages', next);
    const tabIds = new Set(Object.keys(next.tabs));
    this.routers.retain(tabIds);
    for (const [tabId, host] of [...this.tabHosts]) {
      if (!tabIds.has(tabId)) {
        host.remove();
        this.tabHosts.delete(tabId);
      }
    }

    this.listeners.forEach((listener) => {
      listener();
    });
    this.closeWindowIfEmpty();
  }

  /** A non-main window whose last tab left (closed, moved or dragged away) closes itself. */
  closeWindowIfEmpty(): void {
    if (currentWindow.isMain || this.windowClosing || countTabs(this.state) > 0) {
      return;
    }

    this.windowClosing = true;
    WindowClient.Close(currentWindow.name).catch((error: unknown) => {
      this.windowClosing = false;
      console.error('[workspace] closing the empty window failed', error);
    });
  }

  /** The element a tab's page renders into; panes move it between them, so the page keeps its state. */
  tabHost(tabId: string): HTMLDivElement {
    let host = this.tabHosts.get(tabId);
    if (!host) {
      host = document.createElement('div');
      host.dataset.ovTabId = tabId;
      this.tabHosts.set(tabId, host);
    }

    return host;
  }

  activePane(): PagePane {
    return this.state.panes.find((pane) => pane.id === this.state.activePaneId) ?? this.state.panes[0];
  }

  /** Tear-off and "Move to window": not for the last tab of the main window. */
  canTabLeave(): boolean {
    return canTabLeaveWindow(this.state);
  }

  /** Ctrl+Tab: next (`step` 1) or previous (-1) tab of the active pane, wrapping around. */
  cycleActiveTab(step: 1 | -1): void {
    const pane = this.activePane();
    if (pane.tabIds.length < 2 || !pane.activeTabId) {
      return;
    }

    const index = pane.tabIds.indexOf(pane.activeTabId);
    const next = pane.tabIds[(index + step + pane.tabIds.length) % pane.tabIds.length];
    this.dispatch({ type: 'activate', tabId: next });
  }

  closeActiveTab(): void {
    const { activeTabId } = this.activePane();
    if (activeTabId) {
      this.closeTabs([activeTabId]);
    }
  }

  // --- Navigation ----------------------------------------------------------

  navigateActive(path: string): void {
    const settingsTarget = settingsWindowTarget(path);
    if (settingsTarget !== null) {
      this.activateSettings(settingsTarget);
      return;
    }

    const tab = getActiveTab(this.state);
    if (!tab) {
      this.openInNewTab(path);
      return;
    }

    const router = this.routers.get(tab.id);
    if (router) {
      void router.navigate(path);
    } else {
      this.dispatch({ type: 'setPath', tabId: tab.id, path });
    }
  }

  openInNewTab(path: string, { background = false }: OpenPageOptions = {}): void {
    const settingsTarget = settingsWindowTarget(path);
    if (settingsTarget !== null) {
      this.activateSettings(settingsTarget);
      return;
    }

    const pane = this.activePane();
    this.dispatch({ type: 'open', tab: { id: createId(), path }, paneId: pane.id, afterTabId: pane.activeTabId, activate: !background });
  }

  openTabAfter(tabId: string, path: string): string {
    const pane = findPaneOfTab(this.state, tabId) ?? this.activePane();
    const id = createId();
    this.dispatch({ type: 'open', tab: { id, path }, paneId: pane.id, afterTabId: tabId, activate: true });
    return id;
  }

  async openInNewWindow(path: string): Promise<void> {
    const settingsTarget = settingsWindowTarget(path);
    if (settingsTarget !== null) {
      await openSettings(settingsTarget);
      return;
    }

    await openWindow({ kind: 'workspace', slots: { pages: createSingleTabState({ id: createId(), path }, createId()) } });
  }

  openInSplit(path: string): void {
    const settingsTarget = settingsWindowTarget(path);
    if (settingsTarget !== null) {
      this.activateSettings(settingsTarget);
      return;
    }

    const tab: PageTab = { id: createId(), path };
    if (this.state.panes.length < 2) {
      this.dispatch({ type: 'adopt', tab, target: { newPaneId: createId() } });
      return;
    }

    const other = this.state.panes.find((pane) => pane.id !== this.state.activePaneId) ?? this.state.panes[1];
    this.dispatch({ type: 'open', tab, paneId: other.id, afterTabId: other.activeTabId, activate: true });
  }


  // --- Tab menu operations -------------------------------------------------

  duplicateTab(tabId: string): void {
    const tab = this.state.tabs[tabId];
    if (!tab) {
      return;
    }

    const id = this.openTabAfter(tabId, tab.path);
    if (tab.pinned) {
      this.dispatch({ type: 'setPinned', tabId: id, pinned: true });
    }
  }

  closeTabs(tabIds: string[]): void {
    this.dispatch({ type: 'close', tabIds });
  }

  closeOtherTabs(tabId: string): void {
    const pane = findPaneOfTab(this.state, tabId);
    if (pane) {
      this.closeTabs(pane.tabIds.filter((id) => id !== tabId && !this.state.tabs[id].pinned));
    }
  }

  closeTabsToTheRight(tabId: string): void {
    const pane = findPaneOfTab(this.state, tabId);
    if (pane) {
      this.closeTabs(pane.tabIds.slice(pane.tabIds.indexOf(tabId) + 1).filter((id) => !this.state.tabs[id].pinned));
    }
  }

  closeGroup(groupId: string): void {
    this.closeTabs(Object.values(this.state.tabs).filter((tab) => tab.groupId === groupId).map((tab) => tab.id));
  }

  addTabToNewGroup(tabId: string): void {
    const used = new Set(this.state.groups.map((group) => group.color));
    const color: PageGroupColor = PAGE_GROUP_COLORS.find((candidate) => !used.has(candidate))
      ?? PAGE_GROUP_COLORS[this.state.groups.length % PAGE_GROUP_COLORS.length];
    this.dispatch({ type: 'createGroup', group: { id: createId(), title: '', color }, tabId });
  }

  splitTab(tabId: string): void {
    this.dispatch({ type: 'split', tabId, newPaneId: createId() });
  }

  // --- Moving tabs between windows ----------------------------------------

  /**
   * Tear-off: the tab opens in a new window at the release point. The only
   * tab of a secondary window moves its window instead.
   */
  async moveTabToNewWindow(tabId: string, pointer?: WindowClientPoint): Promise<void> {
    const tab = this.state.tabs[tabId];
    if (!tab || !this.canTabLeave()) {
      return;
    }

    if (countTabs(this.state) === 1) {
      if (pointer) {
        await moveCurrentWindowToPointer(pointer);
      }

      return;
    }

    await openWindow({
      kind: 'workspace',
      slots: { pages: createSingleTabState({ id: createId(), ...toPageTabTransfer(tab) }, createId()) },
      pointer,
    });
    this.closeTabs([tabId]);
  }

  async moveTabToWindow(tabId: string, windowName: string): Promise<void> {
    const tab = this.state.tabs[tabId];
    if (!tab || !this.canTabLeave()) {
      return;
    }

    await deliverTabToWindow(windowName, PAGE_TAB_DRAG_TYPE, toPageTabTransfer(tab));
    this.closeTabs([tabId]);
    await WindowClient.Focus(windowName);
  }

  /** "Move to window" from another window: the tab opens in the active pane. */
  takeDeliveredTab(payload: unknown): boolean {
    const transfer = parsePageTabTransfer(payload);
    this.dispatch({ type: 'adopt', tab: { id: createId(), ...transfer }, target: { paneId: this.activePane().id, index: null } });
    return true;
  }

  /** A tab was dropped on a pane strip: a move within this window, or a tab from another window. */
  attachToPane(paneId: string, commit: AttachCommit): void {
    if (isInstanceOfThisWindow(commit.sourceInstanceId) && commit.tab.id in this.state.tabs) {
      this.dispatch({ type: 'moveToPane', tabId: commit.tab.id, paneId, index: commit.insertIndex });
      return;
    }

    const transfer = parsePageTabTransfer(commit.tab.payload);
    this.dispatch({ type: 'adopt', tab: { id: createId(), ...transfer }, target: { paneId, index: commit.insertIndex } });
  }

  /** A tab was dropped on the split zone: it opens in a new pane on the right. */
  attachToSplit(commit: AttachCommit): void {
    if (isInstanceOfThisWindow(commit.sourceInstanceId) && commit.tab.id in this.state.tabs) {
      this.splitTab(commit.tab.id);
      return;
    }

    const transfer = parsePageTabTransfer(commit.tab.payload);
    this.dispatch({ type: 'adopt', tab: { id: createId(), ...transfer }, target: { newPaneId: createId() } });
  }

  /** Source side of a drag: the tab now lives in another window, unless it only moved inside this one. */
  tabTransferred(commit: TabTransferCommit): void {
    if (!isInstanceOfThisWindow(commit.targetInstanceId)) {
      this.closeTabs([commit.id]);
    }
  }

  private activateSettings(target: string): void {
    void openSettings(target).catch((error: unknown) => {
      console.error('[settings] opening the settings window failed', error);
    });
  }
}
