import { useSyncExternalStore } from 'react';
import type { Breadcrumb, Location, StripItem, TabId, TabsState, TabsStore } from '../core/tabs';

// What a component of the shell reads of the tab model. One hook is one slice: the model hands back the same object while its slice is the same (core/tabs/README.md, "One snapshot,
// one slice each"), so `useSyncExternalStore` renders the component only when its own slice changed. A tab's title changing re-renders that tab and nothing that reads another.

/** A slice of the model. `select` must return an object that is the same while the slice is, or a primitive: the model's selectors do. */
export function useTabsSelector<T>(store: TabsStore, select: (state: TabsState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()));
}

/** The strip's order: it changes when a tab opens, closes or moves, not when a title does. */
export function useTabIds(store: TabsStore): readonly TabId[] {
  return useTabsSelector(store, store.selectors.ids);
}

/** The tab on screen. */
export function useActiveId(store: TabsStore): TabId | null {
  return useTabsSelector(store, store.selectors.active);
}

/** What the strip draws for one tab: its identity, glyph and flags. */
export function useStripItem(store: TabsStore, id: TabId): StripItem | undefined {
  return useTabsSelector(store, (state) => store.selectors.stripItem(state, id));
}

/** The tabs whose page is mounted, in strip order (the keep-alive policy's answer). */
export function useMountedIds(store: TabsStore): readonly TabId[] {
  return useTabsSelector(store, store.selectors.mounted);
}

/** Where one tab is: its route. It changes when the route does, or on a reload, never for a title. */
export function useLocation(store: TabsStore, id: TabId | null): Location | undefined {
  return useTabsSelector(store, (state) => (id === null ? undefined : store.selectors.location(state, id)));
}

/** The status bar's path: the tab on screen, root first. */
export function useBreadcrumb(store: TabsStore): Breadcrumb | undefined {
  return useTabsSelector(store, store.selectors.breadcrumb);
}

/** Whether the tab on screen has an earlier (or later) page in its own history: the model's own answer, read again whenever the snapshot changes. */
export function useCanGo(store: TabsStore, direction: 'back' | 'forward'): boolean {
  return useTabsSelector(store, () => (direction === 'back' ? store.canBack() : store.canForward()));
}
