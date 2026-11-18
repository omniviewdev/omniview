import { useSyncExternalStore } from 'react';

// What the page's address asks for, as the host names it: which plugin, which of its pages, and the connection the user chose. The window opens with no URL (the native window loads `/`
// and cannot take a parameter), so every part is optional: an absent plugin is no request, an absent page is the plugin's `home`. A browser can say more, in the hash
// (`#/<plugin>/<page>?connection=<id>`): a deep link at load, which is also what makes a check of one page repeatable, and a hash typed later. It is a request from outside, read and never written:
// where the window is, is the tabs' (each has its own history), and a hash that echoed one of them would name one place of many.

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

/** `#/seam/items?connection=north` as a request. Anything it cannot read is absent, never an error: a stale link opens the default. */
export function parseRoute(hash: string): HostRoute {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const [plugin, page] = path.split('/').filter((part) => part !== '');
  return { plugin: decode(plugin), page: decode(page), connection: decode(new URLSearchParams(query).get('connection') ?? undefined) };
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => {
    window.removeEventListener('hashchange', listener);
  };
}

const read = (): string => window.location.hash;

/** What the hash names now. It changes when the hash does, and the host opens a tab for each distinct request. */
export function useHashLink(): HostRoute {
  return parseRoute(useSyncExternalStore(subscribe, read));
}
