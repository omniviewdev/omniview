import { useCallback, useSyncExternalStore } from 'react';

// Where the window is, as the host names it: which plugin, which of its pages, and the scope the user chose. The window opens with no URL (the
// native window loads `/` and cannot take a parameter), so every part is optional: an absent plugin is the first one that has a page, an absent page is
// the plugin's `home`. A browser can say more, in the hash (`#/<plugin>/<page>?connection=<id>`), which is also what makes a check of one page repeatable.

export type HostRoute = {
  readonly plugin: string | undefined;
  readonly page: string | undefined;
  readonly connection: string | undefined;
};

export const NO_ROUTE: HostRoute = { plugin: undefined, page: undefined, connection: undefined };

const decode = (part: string | undefined): string | undefined => {
  if (part === undefined || part === '') {
    return undefined;
  }

  try {
    return decodeURIComponent(part);
  } catch {
    return undefined;
  }
};

/** `#/seam/items?connection=north` as a route. Anything it cannot read is absent, never an error: a stale link opens the default. */
export function parseRoute(hash: string): HostRoute {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const [plugin, page] = path.split('/').filter((part) => part !== '');
  return { plugin: decode(plugin), page: decode(page), connection: decode(new URLSearchParams(query).get('connection') ?? undefined) };
}

export function formatRoute(route: HostRoute): string {
  if (route.plugin === undefined) {
    return '';
  }

  const path = [route.plugin, ...(route.page === undefined ? [] : [route.page])].map(encodeURIComponent).join('/');
  const query = route.connection === undefined ? '' : `?connection=${encodeURIComponent(route.connection)}`;
  return `#/${path}${query}`;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => {
    window.removeEventListener('hashchange', listener);
  };
}

const read = (): string => window.location.hash;

/** The route in the hash, and the way to change it. A change is a history entry, so Back returns to the page before. */
export function useHashRoute(): readonly [HostRoute, (route: HostRoute) => void] {
  const hash = useSyncExternalStore(subscribe, read);
  const navigate = useCallback((route: HostRoute) => {
    window.location.hash = formatRoute(route);
  }, []);
  return [parseRoute(hash), navigate];
}
