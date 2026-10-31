import { createContext, useContext, useEffect, useEffectEvent, useState, useSyncExternalStore, type ReactNode } from 'react';
import { registerActivePageNavigator, WindowActionsProvider, type WindowActions } from '@omniviewdev/runtime';
import { PAGE_TAB_DRAG_TYPE, useTabDeliveries } from '@/features/windows';
import { ActivePageNavigationContext, type ActivePageNavigation } from './activePageNavigation';
import { isTerminalTarget } from './keyboard';
import { usePagePresentation } from './pagePresentation';
import { usePageRoutes } from './pageRoutes';
import { getActiveTab, type PagesState } from './pagesState';
import { readInitialPagesState, WorkspaceController } from './workspaceController';
import { syncWindowUrlWithActiveTab } from './windowUrlSync';

const WorkspaceControllerContext = createContext<WorkspaceController | null>(null);

export function useWorkspaceController(): WorkspaceController {
  const controller = useContext(WorkspaceControllerContext);
  if (!controller) {
    throw new Error('useWorkspaceController must be used inside WorkspaceProvider');
  }

  return controller;
}

export function usePagesState(): PagesState {
  const controller = useWorkspaceController();
  return useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
}

function logFailure(action: string) {
  return (error: unknown) => {
    console.error(`[workspace] ${action} failed`, error);
  };
}

/** Ctrl+Tab / Ctrl+Shift+Tab cycle tabs and Ctrl/Cmd+W closes one; Ctrl/Cmd+T belongs to the header's new-tab launcher. Terminals keep these keys. */
function usePageTabShortcuts(controller: WorkspaceController): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || isTerminalTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'tab' && event.ctrlKey && !event.metaKey) {
        controller.cycleActiveTab(event.shiftKey ? -1 : 1);
      } else if (key === 'w' && (event.ctrlKey || event.metaKey) && !event.shiftKey) {
        controller.closeActiveTab();
      } else {
        return;
      }

      event.preventDefault();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [controller]);
}

/** Caches each tab's derived title in the saved state, so a restored tab shows it before names load. */
function PageTitleCache({ controller }: { controller: WorkspaceController }) {
  const state = usePagesState();
  const tabs = Object.values(state.tabs);
  const { derivedTitleOf } = usePagePresentation(tabs);
  const titles: Record<string, string> = {};
  for (const tab of tabs) {
    const title = derivedTitleOf(tab);
    if (title && title !== tab.title) {
      titles[tab.id] = title;
    }
  }

  const changedTitlesKey = JSON.stringify(titles);
  const storeTitles = useEffectEvent(() => {
    if (Object.keys(titles).length > 0) {
      controller.dispatch({ type: 'setTitles', titles });
    }
  });
  useEffect(() => {
    storeTitles();
  }, [changedTitlesKey]);

  return null;
}

/**
 * Page tabs of a workspace window: state, per-tab routers, shell navigation,
 * plugin window actions, tab deliveries from other windows and keyboard
 * shortcuts.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const routes = usePageRoutes();
  const [controller] = useState(() => new WorkspaceController(readInitialPagesState(), routes));
  const [windowActions] = useState<WindowActions>(() => ({
    openInNewTab: (path, options) => {
      controller.openInNewTab(path, options);
    },
    openInNewWindow: (path) => {
      controller.openInNewWindow(path).catch(logFailure('opening a new window'));
    },
    openInSplit: (path) => {
      controller.openInSplit(path);
    },
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const activeLocation = new URL(getActiveTab(state)?.path ?? '/', 'http://page');

  useEffect(() => {
    controller.routers.setRoutes(routes);
  }, [controller, routes]);

  // A restored secondary window without tabs has nothing to show.
  useEffect(() => {
    controller.closeWindowIfEmpty();
  }, [controller]);

  useEffect(() => registerActivePageNavigator((path) => {
    controller.navigateActive(path);
  }), [controller]);

  useEffect(() => syncWindowUrlWithActiveTab(controller), [controller]);

  useTabDeliveries(PAGE_TAB_DRAG_TYPE, (payload) => controller.takeDeliveredTab(payload));
  usePageTabShortcuts(controller);

  const navigation: ActivePageNavigation = {
    pathname: activeLocation.pathname,
    search: activeLocation.search,
    navigate: (path) => {
      controller.navigateActive(path);
    },
    openInNewTab: windowActions.openInNewTab,
    openInNewWindow: windowActions.openInNewWindow,
  };

  return (
    <WorkspaceControllerContext.Provider value={controller}>
      <WindowActionsProvider actions={windowActions}>
        <ActivePageNavigationContext.Provider value={navigation}>
          <PageTitleCache controller={controller} />
          {children}
        </ActivePageNavigationContext.Provider>
      </WindowActionsProvider>
    </WorkspaceControllerContext.Provider>
  );
}
