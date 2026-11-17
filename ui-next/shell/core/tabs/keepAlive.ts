import { sameItems } from './json';
import type { KeepAlive, Tab, TabId } from './types';

// Which pages stay mounted (ch16 S29, docs/ui-next/optimisations.md HSH-21, MNR-K1). The old shell mounted a tab the first time it was shown and kept it mounted until the tab
// closed, with no cap. Here the model keeps the list of tabs whose page is mounted and evicts the least recently shown beyond a cap; the UI layer reads the list and decides
// what "not mounted" means (unmount, or hide with the effects released).
//
// The default is a decision the design leaves open (docs/ui-next/status/S1a.md): five pages, the one on screen and four hidden. Four is the number of source views the
// runtime lets linger for hidden and closed pages (RTM-05), so by default the two policies agree. Nothing has measured what N hidden pages cost.

export const DEFAULT_KEEP_ALIVE: KeepAlive = Object.freeze({ cap: 5, keepUnsaved: true });

/** A policy from what a caller wrote: at least one page (the one on screen is always mounted), whole numbers, `null` for no cap. */
export function normaliseKeepAlive(given: Partial<KeepAlive> | undefined, base: KeepAlive = DEFAULT_KEEP_ALIVE): KeepAlive {
  const cap = given !== undefined && 'cap' in given ? given.cap : base.cap;
  return Object.freeze({
    cap: cap === null || cap === undefined || !Number.isFinite(cap) ? null : Math.max(1, Math.floor(cap)),
    keepUnsaved: given?.keepUnsaved ?? base.keepUnsaved,
  });
}

/**
 * `mounted` after the policy: the tabs that still exist, most recently shown first, the least recently shown beyond the cap evicted. A tab with unsaved changes is kept, and
 * does not count toward the cap. The same list when nothing was evicted.
 */
export function enforce(mounted: readonly TabId[], tabs: Readonly<Record<TabId, Tab>>, policy: KeepAlive): readonly TabId[] {
  const kept: TabId[] = [];
  let counted = 0;
  for (const id of mounted) {
    const tab = tabs[id];
    if (!tab) {
      continue;
    }

    if (policy.keepUnsaved && tab.flags.unsaved) {
      kept.push(id);
    } else if (policy.cap === null || counted < policy.cap) {
      counted += 1;
      kept.push(id);
    }
  }

  return Object.freeze(sameItems(mounted, kept));
}
