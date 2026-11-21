import type { PageMemory } from '../../page';
import type { TabId, TabsStore } from '../../shell';

/**
 * A page's memory (`PageMemory`) in this window: the `pageState` of the tab the page is in. The tab model keeps it for as long as the tab is open and the window lives and never saves it to disk, and gives it back
 * when the tab is reloaded, when the tab is closed and reopened, and when the keep-alive cap let the page go and it is drawn again. It drops it when the tab moves to another entry of its history
 * (`shell/core/tabs/open.ts` `moveTab`, `arrange.ts` `step`), so what a page keeps here is lost on list -> detail -> Back: a known gap with a step of its own (docs/ui-next/status/K3a.md).
 */
export function pageMemoryOf(tabs: TabsStore, tab: TabId): PageMemory {
  return {
    read: () => tabs.selectors.tab(tabs.getSnapshot(), tab)?.pageState,
    write: (value) => {
      tabs.setPageState(tab, value);
    },
  };
}
