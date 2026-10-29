import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ActivePageNavigationContext, type ActivePageNavigation } from '../activePageNavigation';

function unsupported(action: string): never {
  throw new Error(`${action} is not available outside a workspace window`);
}

/**
 * Test harness: binds shell navigation to the surrounding router (e.g. a
 * `MemoryRouter`) instead of a workspace's active page tab.
 */
export function RouterBoundPageNavigation({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const navigation: ActivePageNavigation = {
    pathname: location.pathname,
    search: location.search,
    navigate: (path) => {
      void navigate(path);
    },
    openInNewTab: () => unsupported('openInNewTab'),
    openInNewWindow: () => unsupported('openInNewWindow'),
  };

  return <ActivePageNavigationContext.Provider value={navigation}>{children}</ActivePageNavigationContext.Provider>;
}
