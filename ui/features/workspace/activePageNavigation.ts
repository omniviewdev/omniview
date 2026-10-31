import { createContext, useContext } from 'react';
import type { OpenInNewTabOptions } from '@omniviewdev/runtime';

/**
 * Navigation for shell components (header, new-tab launcher, command search) that
 * live outside every page router: they act on the active page tab.
 */
export type ActivePageNavigation = {
  /** Pathname of the active page tab. */
  pathname: string;
  /** Search (`?a=b`) of the active page tab, empty when it has none. */
  search: string;
  navigate: (path: string) => void;
  openInNewTab: (path: string, options?: OpenInNewTabOptions) => void;
  openInNewWindow: (path: string) => void;
};

export const ActivePageNavigationContext = createContext<ActivePageNavigation | null>(null);

export function useActivePageNavigation(): ActivePageNavigation {
  const navigation = useContext(ActivePageNavigationContext);
  if (!navigation) {
    throw new Error('useActivePageNavigation must be used inside a workspace window');
  }

  return navigation;
}
