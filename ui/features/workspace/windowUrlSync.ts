import { getActiveTab } from './pagesState';
import type { WorkspaceController } from './workspaceController';
import { settingsWindowTarget } from '@omniviewdev/runtime';

/** The route in a window URL hash (`#/plugins` → `/plugins`), or null when the hash names no route. */
export function routeOfHash(hash: string): string | null {
  const route = hash.startsWith('#') ? hash.slice(1) : hash;
  return route.startsWith('/') ? route : null;
}

type ActiveRoute = { tabId: string; path: string } | null;

function activeRouteOf(controller: WorkspaceController): ActiveRoute {
  const tab = getActiveTab(controller.getState());
  return tab ? { tabId: tab.id, path: tab.path } : null;
}

/**
 * Keeps the window URL and the active page tab in step, the way a browser
 * shows the active tab's address:
 *
 * - A route in the URL at startup (a deep link) opens in the active tab.
 * - Navigating inside a tab adds a history entry; switching tabs replaces it,
 *   so back/forward walk the active tab's navigation.
 * - A URL change from outside (`location.hash = …`, a plain `#/…` link, back
 *   or forward) navigates the active tab.
 *
 * Returns a function that stops the sync.
 */
export function syncWindowUrlWithActiveTab(controller: WorkspaceController): () => void {
  const deepLink = routeOfHash(window.location.hash);
  if (deepLink && deepLink !== '/' && deepLink !== activeRouteOf(controller)?.path) {
    controller.navigateActive(deepLink);
  }

  let shown = activeRouteOf(controller);
  if (shown) {
    window.history.replaceState(window.history.state, '', `#${shown.path}`);
  }

  const unsubscribe = controller.subscribe(() => {
    const next = activeRouteOf(controller);
    if (!next || (next.tabId === shown?.tabId && next.path === shown.path)) {
      return;
    }

    const sameTab = next.tabId === shown?.tabId;
    shown = next;
    // Already there: the change came from the URL (hashchange, back, forward).
    if (routeOfHash(window.location.hash) === next.path) {
      return;
    }

    if (sameTab) {
      window.history.pushState(window.history.state, '', `#${next.path}`);
    } else {
      window.history.replaceState(window.history.state, '', `#${next.path}`);
    }
  });

  const onHashChange = () => {
    const route = routeOfHash(window.location.hash);
    if (route && route !== activeRouteOf(controller)?.path) {
      controller.navigateActive(route);
      if (settingsWindowTarget(route) !== null) {
        const active = activeRouteOf(controller);
        if (active) {
          window.history.replaceState(window.history.state, '', `#${active.path}`);
        }
      }
    }
  };

  window.addEventListener('hashchange', onHashChange);

  return () => {
    unsubscribe();
    window.removeEventListener('hashchange', onHashChange);
  };
}
