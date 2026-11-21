import type { PageMemory } from '../../page';
import type { TabId, TabsStore } from '../../shell';

/**
 * A page's memory (`PageMemory`) in this window: the `pageState` of the tab the page is in. The tab model keeps it for as long as the tab is open and the window lives and never saves it to disk, and gives it back
 * when the tab is reloaded, when the tab is closed and reopened, and when the keep-alive cap let the page go and it is drawn again. When the tab moves to another entry of its history the entry it leaves keeps it, and
 * Back and Forward give it back to the page of that entry (`shell/core/tabs/resolve.ts`, `pushed` and `stepped`, H7); a navigation to a place the tab has been at starts with it, except where the page was scrolled.
 */
export function pageMemoryOf(tabs: TabsStore, tab: TabId): PageMemory {
  return {
    read: () => tabs.selectors.tab(tabs.getSnapshot(), tab)?.pageState,
    write: (value) => {
      tabs.setPageState(tab, value);
    },
  };
}
