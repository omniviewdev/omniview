export const HOME_PATH = '/';

export function resourceBrowserPath(pluginId: string, connectionId: string, type?: string): string {
  const path = `/resources/${encodeURIComponent(pluginId)}/${encodeURIComponent(connectionId)}`;
  return type === undefined ? path : `${path}?${new URLSearchParams({ type })}`;
}

export function connectionProfilesPath(pluginId: string): string {
  return `/connections/${encodeURIComponent(pluginId)}`;
}

export function connectionProfilePath(pluginId: string, connectionId: string): string {
  return `${connectionProfilesPath(pluginId)}/${encodeURIComponent(connectionId)}/edit`;
}

/** What a page tab shows, derived from its router path. */
export type PagePathTarget =
  | { kind: 'home' }
  | { kind: 'plugins' }
  | { kind: 'settings' }
  | { kind: 'plugin'; pluginId: string }
  | { kind: 'connection'; pluginId: string; connectionId: string }
  | { kind: 'unknown' };

export type PageTitleLookup = {
  pluginName: (pluginId: string) => string | undefined;
  connectionName: (pluginId: string, connectionId: string) => string | undefined;
};

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Router path (`pathname?search`) without its query and hash. */
export function pathnameOf(path: string): string {
  const end = path.search(/[?#]/);
  return end === -1 ? path : path.slice(0, end);
}

export function parsePagePath(path: string): PagePathTarget {
  const segments = pathnameOf(path).split('/').filter(Boolean);
  if (segments.length === 0) {
    return { kind: 'home' };
  }

  switch (segments[0]) {
    case 'plugins':
      return { kind: 'plugins' };
    case 'settings':
      return { kind: 'settings' };
    case 'resources':
    case 'connections':
      return segments[1] && segments[2]
        ? { kind: 'connection', pluginId: decodeSegment(segments[1]), connectionId: decodeSegment(segments[2]) }
        : segments[1] ? { kind: 'plugin', pluginId: decodeSegment(segments[1]) } : { kind: 'unknown' };
    case '_plugin': {
      if (!segments[1]) {
        return { kind: 'unknown' };
      }

      const pluginId = decodeSegment(segments[1]);
      // Connection pages: `/_plugin/<id>/cluster/<connectionId>/...` or `/_plugin/<id>/connection/<connectionId>/...`.
      if ((segments[2] === 'cluster' || segments[2] === 'connection') && segments[3]) {
        return { kind: 'connection', pluginId, connectionId: decodeSegment(segments[3]) };
      }

      return { kind: 'plugin', pluginId };
    }

    default:
      return { kind: 'unknown' };
  }
}

/** Identifies the connection a path belongs to, so tabs of one connection can share a group. */
export function connectionKeyOfPath(path: string): string | null {
  const target = parsePagePath(path);
  return target.kind === 'connection' ? `${target.pluginId}\u0000${target.connectionId}` : null;
}

/**
 * Title for a page tab, or null when the names it needs are not known yet
 * (plugin inventory or connection list still loading).
 */
export function derivePageTitle(path: string, lookup: PageTitleLookup): string | null {
  const target = parsePagePath(path);
  switch (target.kind) {
    case 'home':
      return 'Home';
    case 'plugins':
      return 'Plugins';
    case 'settings':
      return 'Settings';
    case 'plugin':
      return lookup.pluginName(target.pluginId) ?? null;
    case 'connection':
      return lookup.connectionName(target.pluginId, target.connectionId) ?? lookup.pluginName(target.pluginId) ?? null;
    case 'unknown':
      return null;
  }
}
