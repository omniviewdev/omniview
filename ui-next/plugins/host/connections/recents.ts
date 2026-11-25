import type { Route } from '../../../shell';
import { connectionOf } from '../contributions';

// The connections a person used last, most recent first (HM2): what Home lists as Recent and what a plugin opened with no connection falls back to (`contributions.ts`, rule R4). Framework-free, like the connection store: React
// reads it through `useSyncExternalStore` (`getSnapshot` is the same array until something in it changes).
//
// WHERE IT IS KEPT. Nowhere of its own: nothing new is saved. The window's session already keeps every tab's route and a window of its history (`shell/session`, the `tabs` part of the document in `windows.json`, one document for
// each window), and a route carries its connection (`params.connection`). So the list is made from that when the window comes back (`usesOf`: the tabs in strip order, each one's history oldest to newest, the tab that was on screen last,
// so that it wins) and is kept current while the window lives (`touch`, from the route of the tab on screen). What follows from that, said plainly: the list is THIS WINDOW's (another window starts from its own tabs, and one
// that has no tab starts with none), and a connection whose last tab was closed and whose history went with it, in a window that was then restarted, is forgotten. A list that outlives the tabs, or that two windows share, is a
// store of its own in the host (Backend catalog in `docs/ui-next/status/HM2.md`).

/** A connection of a plugin, by the plugin's key for it (the one a route carries). */
export type RecentConnection = { readonly plugin: string; readonly key: string };

/** How many connections are remembered: more than Home shows, so that the ones that went away from the list do not leave it short. */
export const RECENTS_MAX = 16;

export type RecentsStore = {
  /** The connections used, most recent first, each once, at most `RECENTS_MAX`. The same array until something in it changes. */
  readonly getSnapshot: () => readonly RecentConnection[];
  /** Called after every change of the list, and never for a use that changed nothing. Answers the function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
  /** The connection is used now: it goes first. A connection that is first already changes nothing. */
  readonly touch: (plugin: string, key: string) => void;
  /** Takes the uses of an earlier life of the window, oldest first, under whatever was used since. */
  readonly seed: (uses: readonly RecentConnection[]) => void;
};

const same = (a: RecentConnection, b: RecentConnection): boolean => a.plugin === b.plugin && a.key === b.key;

export function createRecents(): RecentsStore {
  let list: readonly RecentConnection[] = [];
  const listeners = new Set<() => void>();

  /** `from` with `use` first and no other entry of it; the same array when it was first already. */
  const front = (from: readonly RecentConnection[], use: RecentConnection): readonly RecentConnection[] => {
    const [head] = from;
    return head !== undefined && same(head, use) ? from : [use, ...from.filter((entry) => !same(entry, use))].slice(0, RECENTS_MAX);
  };

  const set = (next: readonly RecentConnection[]): void => {
    if (next === list) {
      return;
    }

    list = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    getSnapshot: () => list,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    touch: (plugin, key) => {
      set(front(list, { plugin, key }));
    },
    seed: (uses) => {
      // What the window did since is newer than any earlier life: the earlier uses go under it, in their own order.
      const earlier = uses.reduce<readonly RecentConnection[]>((acc, use) => front(acc, use), []);
      const merged = [...list, ...earlier.filter((use) => !list.some((entry) => same(entry, use)))].slice(0, RECENTS_MAX);
      set(merged.length === list.length ? list : merged);
    },
  };
}

/** The tab model's snapshot as far as `usesOf` reads it. */
type TabsAsRead = {
  readonly order: readonly string[];
  readonly active: string | null;
  readonly tabs: Readonly<Record<string, { readonly history: { readonly entries: readonly Route[] } }>>;
};

/**
 * The uses a window's tabs say, oldest first: the tabs in strip order, each one's history from its oldest entry to its newest, and the tab on screen last. A history entry of a page that names no connection is no use of one.
 * `state` is the tab model's snapshot (`TabsStore.getSnapshot()`).
 */
export function usesOf(state: TabsAsRead): readonly RecentConnection[] {
  const uses: RecentConnection[] = [];
  const ids = [...state.order.filter((id) => id !== state.active), ...(state.active === null ? [] : [state.active])];
  for (const id of ids) {
    for (const route of state.tabs[id]?.history.entries ?? []) {
      const key = connectionOf(route);
      if (key !== undefined) {
        uses.push({ plugin: route.plugin, key });
      }
    }
  }

  return uses;
}
