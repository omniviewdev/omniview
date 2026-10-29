import React, { type ReactNode } from 'react';
import {
  type BottomDrawerTab,
  type CloseDrawer,
  type CreateTab,
  type CreateTabOpts,
  type FindTabOpts,
  type FocusTab,
  type FullscreenDrawer,
  type ResizeDrawer,
  type CloseTab,
  type ReorderTab,
  type CreateTabs,
  type CloseTabs,
  type UpdateTab,
  type UpdateTabOpts,
  BottomDrawerContext,
} from '@omniviewdev/runtime';
import { ExecClient } from '@omniviewdev/runtime/api';
import log from '@/features/logger';
import {
  DRAWER_TAB_DRAG_TYPE,
  currentWindow,
  onWindowClosed,
  readInitialSlot,
  saveSlot,
  useTabDeliveries,
} from '@/features/windows';
import { bottomDrawerChannel } from '@/providers/BottomDrawer/events';
import {
  type DrawerMode,
  type DrawerSlot,
  type SerializedDrawerTab,
  buildDrawerSlot,
  hydrateDrawerTab,
  isPendingDrawerTab,
  isTerminalSessionTab,
  parseDrawerSlot,
  parseSerializedDrawerTab,
} from './drawerSlot';
import { planDrawerRestore } from './drawerRestore';
import { markTerminalSessionHandedOff } from './terminalHandoff';
import {
  type AdoptDrawerTabsPlacement,
  type BottomDrawerWindowContextType,
  type DrawerLayout,
  BottomDrawerWindowContext,
  DEFAULT_DRAWER_EXPANDED_HEIGHT,
} from './windowContext';

type BottomDrawerProviderProps = {
  children: ReactNode;
};

/** Utility function to search for the matching tab */
const findTabIndex = (tabs: BottomDrawerTab[], opts: FindTabOpts): number => {
  if (opts.index !== undefined) {
    if (opts.index < 0 || opts.index >= tabs.length) {
      return -1;
    }

    return opts.index;
  }

  if (opts.id !== undefined) {
    return tabs.findIndex((tab) => tab.id === opts.id);
  }

  if (opts.properties !== undefined) {
    const matches = tabs.filter((tab) => {
      if (tab.properties === undefined) {
        return false;
      }

      return Object.keys(opts.properties ?? {}).every((key) => tab.properties?.[key] === opts.properties?.[key]);
    });
    if (matches.length === 0) {
      return -1;
    }

    if (matches.length === 1) {
      return tabs.indexOf(matches[0]);
    }

    switch (opts.actionOnMultiple) {
      case 'first':
        return tabs.indexOf(matches[0]);
      case 'newest':
        return tabs.indexOf(matches[matches.length - 1]);
      case 'oldest':
        return tabs.indexOf(matches[0]);
      case 'none':
      case undefined:
        return -1;
    }
  }

  return -1;
};

// ===================================== TAB STATE ===================================== //

type DrawerTabsState = {
  tabs: BottomDrawerTab[];
  focused: number;
};

type DrawerTabsAction =
  | { type: 'create'; tabs: BottomDrawerTab[]; focusCreated: boolean }
  | { type: 'update'; find: FindTabOpts; updates: UpdateTabOpts }
  | { type: 'focus'; find: FindTabOpts }
  | { type: 'reorder'; from: number; to: number }
  | { type: 'close'; ids: string[]; focus: 'before-first-closed' | 'last' }
  | { type: 'remove'; ids: ReadonlySet<string> }
  | { type: 'adopt'; tabs: BottomDrawerTab[]; index?: number; focusTabId?: string };

/** Keeps the focused tab focused when other tabs disappear; falls back to its left neighbor. */
function focusAfterRemoval(state: DrawerTabsState, remaining: BottomDrawerTab[]): number {
  const focusedTab = state.tabs[state.focused];
  const stillFocused = focusedTab === undefined ? -1 : remaining.indexOf(focusedTab);
  if (stillFocused !== -1) {
    return stillFocused;
  }

  const removedBeforeFocus = state.tabs.slice(0, state.focused).filter((tab) => !remaining.includes(tab)).length;
  return Math.max(Math.min(state.focused - removedBeforeFocus - 1, remaining.length - 1), 0);
}

function drawerTabsReducer(state: DrawerTabsState, action: DrawerTabsAction): DrawerTabsState {
  switch (action.type) {
    case 'create':
      return {
        tabs: [...state.tabs, ...action.tabs],
        focused: action.focusCreated ? state.tabs.length : state.focused,
      };

    case 'update': {
      const index = findTabIndex(state.tabs, action.find);
      if (index === -1) {
        return state;
      }

      const tab = state.tabs[index];
      const { updates } = action;
      const updated: BottomDrawerTab = {
        ...tab,
        ...(updates.id !== undefined && { id: updates.id }),
        ...(updates.title !== undefined && { title: updates.title }),
        ...(updates.icon !== undefined && { icon: updates.icon }),
        properties: updates.properties !== undefined
          ? { ...tab.properties, ...updates.properties }
          : tab.properties,
        updatedAt: new Date(),
      };
      const tabs = [...state.tabs];
      tabs[index] = updated;
      return { ...state, tabs };
    }

    case 'focus': {
      const index = findTabIndex(state.tabs, { actionOnMultiple: 'newest', ...action.find });
      return index === -1 ? state : { ...state, focused: index };
    }

    case 'reorder': {
      const { from, to } = action;
      if (from === to || from < 0 || from >= state.tabs.length || to < 0 || to >= state.tabs.length) {
        return state;
      }

      const tabs = [...state.tabs];
      const [tab] = tabs.splice(from, 1);
      tabs.splice(to, 0, tab);
      return { tabs, focused: to };
    }

    case 'close': {
      const closing = new Set(action.ids);
      const firstClosedIndex = state.tabs.findIndex((tab) => closing.has(tab.id));
      if (firstClosedIndex === -1) {
        return state;
      }

      const tabs = state.tabs.filter((tab) => !closing.has(tab.id));
      return {
        tabs,
        focused: action.focus === 'last' ? tabs.length - 1 : Math.max(firstClosedIndex - 1, 0),
      };
    }

    case 'remove': {
      const tabs = state.tabs.filter((tab) => !action.ids.has(tab.id));
      if (tabs.length === state.tabs.length) {
        return state;
      }

      return { tabs, focused: focusAfterRemoval(state, tabs) };
    }

    case 'adopt': {
      const existingIds = new Set(state.tabs.map((tab) => tab.id));
      const adopted = action.tabs.filter((tab) => !existingIds.has(tab.id));
      if (adopted.length === 0) {
        return state;
      }

      const insertAt = Math.min(Math.max(action.index ?? state.tabs.length, 0), state.tabs.length);
      const tabs = [...state.tabs.slice(0, insertAt), ...adopted, ...state.tabs.slice(insertAt)];
      const focusIndex = action.focusTabId === undefined
        ? -1
        : tabs.findIndex((tab) => tab.id === action.focusTabId);
      if (focusIndex !== -1) {
        return { tabs, focused: focusIndex };
      }

      const focusShift = state.tabs.length > 0 && insertAt <= state.focused ? adopted.length : 0;
      return { tabs, focused: state.focused + focusShift };
    }
  }
}

function initialDrawerTabsState(slot: DrawerSlot | null): DrawerTabsState {
  if (slot === null) {
    return { tabs: [], focused: 0 };
  }

  const focused = slot.tabs.findIndex((tab) => tab.id === slot.focusedId);
  return { tabs: slot.tabs.map(hydrateDrawerTab), focused: Math.max(focused, 0) };
}

// ===================================== PROVIDER ===================================== //

export const BottomDrawerProvider: React.FC<BottomDrawerProviderProps> = ({ children }) => {
  const defaultHeight = 32;

  const [initialSlot] = React.useState(() => readInitialSlot('drawer', parseDrawerSlot));
  const [state, dispatch] = React.useReducer(drawerTabsReducer, initialSlot, initialDrawerTabsState);
  const [drawerHeight, setDrawerHeight] = React.useState<number>(defaultHeight);
  const [layout, setLayout] = React.useState<DrawerLayout>(() => ({
    mode: initialSlot?.mode ?? 'minimized',
    expandedHeight: initialSlot?.height ?? DEFAULT_DRAWER_EXPANDED_HEIGHT,
  }));
  const [quietTabIds, setQuietTabIds] = React.useState<ReadonlySet<string>>(
    () => new Set(initialSlot?.tabs.map((tab) => tab.id)),
  );
  const [restoreComplete, setRestoreComplete] = React.useState(false);

  // Operations that run side effects for specific tabs read the latest committed tabs.
  const stateRef = React.useRef(state);
  React.useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  // ===================================== CONTEXT METHODS ===================================== //

  const createTab: CreateTab = React.useCallback((opts: CreateTabOpts) => {
    const now = new Date();
    dispatch({
      type: 'create',
      focusCreated: true,
      tabs: [{
        id: opts.id ?? window.crypto.randomUUID(),
        icon: opts.icon,
        title: opts.title,
        createdAt: now,
        updatedAt: now,
        variant: opts.variant,
        properties: opts.properties,
      }],
    });
    bottomDrawerChannel.emit('onTabCreated');
  }, []);

  const createTabs: CreateTabs = React.useCallback((newTabs: CreateTabOpts[]) => {
    if (newTabs.length === 0) {
      return;
    }

    const now = new Date();
    dispatch({
      type: 'create',
      focusCreated: false,
      tabs: newTabs.map((opts) => ({
        id: opts.id ?? window.crypto.randomUUID(),
        icon: opts.icon,
        title: opts.title,
        createdAt: now,
        updatedAt: now,
        variant: opts.variant,
        properties: opts.properties,
      })),
    });
    bottomDrawerChannel.emit('onTabCreated');
  }, []);

  const updateTab: UpdateTab = React.useCallback((find: FindTabOpts, updates: UpdateTabOpts) => {
    dispatch({ type: 'update', find, updates });
  }, []);

  const focusTab: FocusTab = React.useCallback((opts: FindTabOpts) => {
    dispatch({ type: 'focus', find: opts });
  }, []);

  const reorderTab: ReorderTab = React.useCallback((from: number, to: number) => {
    dispatch({ type: 'reorder', from, to });
  }, []);

  const closeTab: CloseTab = React.useCallback((opts: FindTabOpts) => {
    const tab = stateRef.current.tabs[findTabIndex(stateRef.current.tabs, opts)];
    if (tab === undefined) {
      return;
    }

    // if terminal with a real backend session, close it
    if (isTerminalSessionTab(tab)) {
      ExecClient.CloseSession(tab.id).catch((err: unknown) => {
        if (err instanceof Error) {
          log.error(err, { event: 'terminate_session', sessionId: tab.id });
        }
      });
    }

    dispatch({ type: 'close', ids: [tab.id], focus: 'before-first-closed' });
  }, []);

  const closeTabs: CloseTabs = React.useCallback((opts: FindTabOpts[]) => {
    const { tabs } = stateRef.current;
    const closing = opts
      .map((opt) => tabs[findTabIndex(tabs, opt)])
      .filter((tab): tab is BottomDrawerTab => tab !== undefined);
    if (closing.length === 0) {
      return;
    }

    // close all the selected sessions
    Promise.all(closing.filter(isTerminalSessionTab).map(async (tab) => ExecClient.CloseSession(tab.id)))
      .catch((err: unknown) => {
        if (err instanceof Error) {
          log.error(err, { event: 'terminate_sessions' });
        }
      });

    dispatch({ type: 'close', ids: closing.map((tab) => tab.id), focus: 'last' });
  }, []);

  const resizeDrawer: ResizeDrawer = React.useCallback((height: number) => {
    if (height < defaultHeight) {
      setDrawerHeight(defaultHeight);
      return;
    }

    if (height > window.innerHeight) {
      setDrawerHeight(window.innerHeight);
      return;
    }

    setDrawerHeight(height);
  }, []);

  const closeDrawer: CloseDrawer = React.useCallback(() => {
    setDrawerHeight(defaultHeight);
  }, []);

  const fullscreenDrawer: FullscreenDrawer = React.useCallback(() => {
    // calculate from the window
    setDrawerHeight(window.innerHeight);
  }, []);

  // ===================================== WINDOW METHODS ===================================== //

  const transferTabOut = React.useCallback((id: string) => {
    const tab = stateRef.current.tabs.find((candidate) => candidate.id === id);
    if (tab === undefined) {
      return;
    }

    // The session lives on in the target window: no CloseSession, and the
    // unmounting terminal must not detach it from under the target.
    if (isTerminalSessionTab(tab)) {
      markTerminalSessionHandedOff(tab.id);
    }

    dispatch({ type: 'remove', ids: new Set([id]) });
  }, []);

  const adoptTabs = React.useCallback((incoming: SerializedDrawerTab[], placement: AdoptDrawerTabsPlacement) => {
    const existingIds = new Set(stateRef.current.tabs.map((tab) => tab.id));
    const adoptable = incoming.filter((tab) => !isPendingDrawerTab(tab) && !existingIds.has(tab.id));
    if (adoptable.length === 0) {
      return false;
    }

    if (placement.focusTabId === undefined) {
      setQuietTabIds((previous) => new Set([...previous, ...adoptable.map((tab) => tab.id)]));
    }

    dispatch({
      type: 'adopt',
      tabs: adoptable.map(hydrateDrawerTab),
      index: placement.index,
      focusTabId: placement.focusTabId,
    });
    return true;
  }, []);

  const saveLayout = React.useCallback((mode: DrawerMode, expandedHeight?: number) => {
    setLayout((previous) => ({ mode, expandedHeight: expandedHeight ?? previous.expandedHeight }));
  }, []);

  // ===================================== WINDOW WIRING ===================================== //

  React.useEffect(() => {
    saveSlot('drawer', buildDrawerSlot(
      state.tabs,
      state.tabs[state.focused]?.id,
      layout.mode,
      layout.expandedHeight,
    ));
  }, [state, layout]);

  React.useEffect(() => {
    let disposed = false;
    planDrawerRestore(initialSlot?.tabs ?? [])
      .then(({ deadTabIds, orphanedSessionTabs }) => {
        if (disposed) {
          return;
        }

        if (deadTabIds.size > 0) {
          dispatch({ type: 'remove', ids: deadTabIds });
        }

        adoptTabs(orphanedSessionTabs, {});
      })
      .catch((err: unknown) => {
        console.error('[drawer] failed to reconcile drawer tabs with live sessions', err);
      })
      .finally(() => {
        if (!disposed) {
          setRestoreComplete(true);
        }
      });
    return () => {
      disposed = true;
    };
  }, [initialSlot, adoptTabs]);

  // Drawer tabs of a closed window come back to the main window.
  React.useEffect(() => {
    if (!currentWindow.isMain) {
      return undefined;
    }

    return onWindowClosed(({ name, states }) => {
      if (!states.drawer) {
        return;
      }

      let slot: DrawerSlot;
      try {
        slot = parseDrawerSlot(JSON.parse(states.drawer));
      } catch (err) {
        console.error(`[drawer] ignoring invalid drawer state of closed window "${name}"`, err);
        return;
      }

      const drawerIsEmpty = stateRef.current.tabs.length === 0;
      const focusTabId = drawerIsEmpty ? slot.focusedId ?? slot.tabs[0]?.id : undefined;
      adoptTabs(slot.tabs, { focusTabId });
    });
  }, [adoptTabs]);

  // Tabs moved here from another window's "Move to window" menu.
  useTabDeliveries(DRAWER_TAB_DRAG_TYPE, (payload) => {
    const tab = parseSerializedDrawerTab(payload);
    return adoptTabs([tab], { focusTabId: tab.id });
  });

  // ===================================== CONTEXT VALUE ===================================== //

  const value = React.useMemo(() => ({
    height: drawerHeight,
    focused: state.focused,
    tabs: state.tabs,
    createTab,
    createTabs,
    updateTab,
    focusTab,
    reorderTab,
    closeTab,
    closeTabs,
    resizeDrawer,
    closeDrawer,
    fullscreenDrawer,
  }), [
    drawerHeight, state, createTab, createTabs, updateTab, focusTab, reorderTab, closeTab, closeTabs,
    resizeDrawer, closeDrawer, fullscreenDrawer,
  ]);

  const windowValue: BottomDrawerWindowContextType = React.useMemo(() => ({
    restoreComplete,
    quietTabIds,
    layout,
    saveLayout,
    transferTabOut,
    adoptTabs,
  }), [restoreComplete, quietTabIds, layout, saveLayout, transferTabOut, adoptTabs]);

  return (
    <BottomDrawerContext.Provider value={value}>
      <BottomDrawerWindowContext.Provider value={windowValue}>
        {children}
      </BottomDrawerWindowContext.Provider>
    </BottomDrawerContext.Provider>
  );
};

export default BottomDrawerProvider;
