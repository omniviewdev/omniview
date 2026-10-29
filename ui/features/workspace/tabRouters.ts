import { createMemoryRouter, type DataRouter, type Location, type RouteObject } from 'react-router';

export function routerPathOf(location: Pick<Location, 'pathname' | 'search' | 'hash'>): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

/**
 * One memory router per page tab. Routers are created when a tab first
 * renders, rebuilt at their current location when plugin routes change, and
 * disposed when the tab closes or leaves the window.
 */
export class PageTabRouters {
  private readonly routers = new Map<string, DataRouter>();
  private readonly unsubscribers = new Map<string, () => void>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private routes: RouteObject[],
    /** Called whenever a tab's router lands on a new location. */
    private readonly onPathChange: (tabId: string, path: string) => void,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get(tabId: string): DataRouter | undefined {
    return this.routers.get(tabId);
  }

  ensure(tabId: string, path: string): void {
    if (this.routers.has(tabId)) {
      return;
    }

    this.install(tabId, path);
    this.notify();
  }

  setRoutes(routes: RouteObject[]): void {
    if (routes === this.routes) {
      return;
    }

    this.routes = routes;
    if (this.routers.size === 0) {
      return;
    }

    for (const [tabId, router] of [...this.routers]) {
      // Keep each tab where it is; only the route tree changes.
      this.install(tabId, routerPathOf(router.state.location));
      router.dispose();
    }

    this.notify();
  }

  dispose(tabId: string): void {
    const router = this.routers.get(tabId);
    if (!router) {
      return;
    }

    this.unsubscribers.get(tabId)?.();
    this.unsubscribers.delete(tabId);
    this.routers.delete(tabId);
    router.dispose();
    this.notify();
  }

  /** Disposes the routers of tabs that are no longer in this window. */
  retain(tabIds: ReadonlySet<string>): void {
    for (const tabId of [...this.routers.keys()]) {
      if (!tabIds.has(tabId)) {
        this.dispose(tabId);
      }
    }
  }

  private install(tabId: string, path: string): void {
    this.unsubscribers.get(tabId)?.();
    const router = createMemoryRouter(this.routes, { initialEntries: [path] });
    // Links render the window's URL form (`#/path`): the window URL shows the
    // active tab's route, and a plain `#/…` href navigates that tab too.
    const createMemoryHref = router.createHref;
    router.createHref = (location) => `#${createMemoryHref(location)}`;
    this.routers.set(tabId, router);
    this.unsubscribers.set(tabId, router.subscribe((state) => {
      this.onPathChange(tabId, routerPathOf(state.location));
    }));
  }

  private notify(): void {
    this.listeners.forEach((listener) => {
      listener();
    });
  }
}
