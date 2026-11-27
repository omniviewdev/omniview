import { createContext, useContext, type ReactNode } from 'react';
import type { TabsStore } from '../core/tabs';

// The tab model, handed down the shell's tree: the strip, the page host and the status bar each read their own slice of it (./hooks.ts). The model itself is framework-free
// (../core/tabs); what owns it is whoever mounts the shell.

const TabsContext = createContext<TabsStore | null>(null);

export function TabsProvider({ store, children }: { readonly store: TabsStore | null; readonly children: ReactNode }) {
  return <TabsContext value={store}>{children}</TabsContext>;
}

/** The tab model of the shell this component is in. */
export function useTabs(): TabsStore {
  const store = useContext(TabsContext);
  if (store === null) {
    throw new Error('A component of the tab strip or the page host was rendered outside a Shell.');
  }

  return store;
}
