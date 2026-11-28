import { useMemo, useSyncExternalStore } from 'react';
import { fitsUtf8, normaliseExtensionView, type ExtensionViewRoute } from '../../shell/core/tabs';

// What the page's address asks for, as the host names it: which plugin, which of its pages, the connection the user chose and the page's other parameters (the identity of the object a detail
// page shows). The window opens with no URL (the native window loads `/` and cannot take a parameter), so every part is optional: an absent plugin is no request, an absent page is the plugin's
// `home`. A browser can say more, in the hash (`#/<plugin>/<page>?connection=<id>&<name>=<value>`): a deep link at load, which is also what makes a check of one page repeatable, and a hash typed
// later. It is a request from outside, read and never written: where the window is, is the tabs' (each has its own history), and a hash that echoed one of them would name one place of many.
// A link a page draws carries the same address as its `href` (`addressOf`), so the platform can show it and copy it, and a link nobody intercepted still goes where it says.

export type PageLink = {
  readonly kind?: undefined;
  readonly plugin: string | undefined;
  readonly page: string | undefined;
  readonly connection: string | undefined;
  /** The query's other parameters, each once, as text. */
  readonly params: Readonly<Record<string, string>>;
};

/** A malformed request in the host's own address space is not a missing ordinary link. */
export type HostRoute = PageLink | ExtensionViewRoute | { readonly kind: 'invalid-view' };

export const NO_PARAMS: Readonly<Record<string, string>> = Object.freeze({});

export const NO_ROUTE: PageLink = { plugin: undefined, page: undefined, connection: undefined, params: NO_PARAMS };

const INVALID_VIEW = Object.freeze({ kind: 'invalid-view' } as const);
const HASH_BYTES = 8 * 1024;

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

/** The query's parameters but the connection: the first of a name that is given twice, and none that is empty. Entries, not assignments: a name such as `__proto__` is data here. */
function paramsOf(query: URLSearchParams): Readonly<Record<string, string>> {
  const seen = new Map<string, string>();
  for (const [name, value] of query) {
    if (name !== 'connection' && value !== '' && !seen.has(name)) {
      seen.set(name, value);
    }
  }

  return seen.size === 0 ? NO_PARAMS : Object.freeze(Object.fromEntries(seen));
}

/** Parse the host address prefix strictly, before ordinary page completion can interpret any part of it. */
function parseView(hash: string): HostRoute {
  if (!fitsUtf8(hash, HASH_BYTES)) {
    return INVALID_VIEW;
  }

  const [path = '', query, extra] = hash.split('?', 3);
  const segments = path.split('/', 7);
  if (extra !== undefined || segments.length !== 6 || segments[0] !== '#~view' || segments[1] !== '1') {
    return INVALID_VIEW;
  }

  const plugin = decode(segments[2]);
  const point = decode(segments[3]);
  const contributor = decode(segments[4]);
  const local = decode(segments[5]);
  if (!plugin || !point || !contributor || !local) {
    return INVALID_VIEW;
  }

  let connection: string | undefined;
  if (query !== undefined) {
    const equals = query.indexOf('=');
    if (equals < 1 || query.includes('&') || query.includes('#') || decode(query.slice(0, equals)) !== 'connection') {
      return INVALID_VIEW;
    }

    connection = decode(query.slice(equals + 1).replace(/\+/g, ' '));
    if (connection === undefined) {
      return INVALID_VIEW;
    }
  }

  return normaliseExtensionView({ kind: 'extension-view', plugin, point, offer: `${contributor}/${local}`, connection }) ?? INVALID_VIEW;
}

/** Ordinary malformed page components keep their historical fallback. Invalid host view requests never do. */
export function parseRoute(hash: string): HostRoute {
  if (hash.startsWith('#~view')) {
    return parseView(hash);
  }

  if (hash.startsWith('~view')) {
    return INVALID_VIEW;
  }

  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const [plugin, page] = path.split('/').filter((part) => part !== '');
  const parameters = new URLSearchParams(query);
  // The query is decoded once, by URLSearchParams: decoding what it returns again would turn a connection that holds a literal percent escape (`north%2Fwest`, written `north%252Fwest`) into
  // another scope. The path's parts are encoded by `addressOf` with encodeURIComponent and are decoded once, by `decode`.
  const connection = parameters.get('connection');
  return { plugin: decode(plugin), page: decode(page), connection: connection === null || connection === '' ? undefined : connection, params: paramsOf(parameters) };
}

/** What `addressOf` is asked for: a page of a plugin and the parameters that name its destination, the connection among them. A parameter with no value is left out. */
export type AddressOf = {
  readonly kind?: undefined;
  readonly plugin: string;
  readonly page: string;
  readonly params?: Readonly<Record<string, string | undefined>> | undefined;
};

/** Write each component once. Ordinary page addresses retain their existing URLSearchParams encoding. */
export function addressOf(destination: AddressOf | ExtensionViewRoute): string {
  if (destination.kind === 'extension-view') {
    const route = normaliseExtensionView(destination);
    if (route === undefined) {
      throw new TypeError('Invalid extension view location');
    }

    const path = [route.plugin, route.point, ...route.offer.split('/')].map(encodeURIComponent).join('/');
    return `#~view/1/${path}${route.connection === undefined ? '' : `?connection=${encodeURIComponent(route.connection)}`}`;
  }

  const { plugin, page, params } = destination;
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') {
      query.append(name, value);
    }
  }

  const text = query.toString();
  return `#/${encodeURIComponent(plugin)}/${encodeURIComponent(page)}${text === '' ? '' : `?${text}`}`;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => {
    window.removeEventListener('hashchange', listener);
  };
}

const read = (): string => window.location.hash;

/** What the hash names now. It changes when the hash does, and the host opens a tab for each distinct request. The same object while the hash is the same text. */
export function useHashLink(): HostRoute {
  const hash = useSyncExternalStore(subscribe, read);
  return useMemo(() => parseRoute(hash), [hash]);
}
