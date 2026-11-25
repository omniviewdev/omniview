import type { IconName, KindTileTone } from '@omniviewdev/kit';
import { failureWords } from '../loader/failure';
import type { HomeConnectionGroup, HomeConnectionRow, HomeEntry } from './Home';
import { faceOf, type HostConnection, type RecentConnection } from './connections';
import type { PluginEntry } from './pluginStore';
import { DEFAULT_RAIL_ICON, railOf } from './rail';

// What Home says of the connections (HM1, HM2), made from what the window knows: one group for each plugin that contributes and has a connection, in the order of the rail (R2), each connection by its NAME with the state it is in, and
// the connections used last, shown above them. The mock's Home lists the connections that are IN USE only (shell-page-home.js, `connectionsSection`: "idle ones never show") and stops at six; the person this slice is for could not find their
// connections at all, so Home lists every one a plugin has, and the state says which are connected. Its Recent (`recentSection`) lists the recently closed tabs and the places last opened, which this window has no source for; the
// connections it used last are the window's own (`connections/recents.ts`).
//
// THE ROWS ARE MADE ONCE. A row is plain data, and the page draws a row again only when it is another object (`Home.tsx`). The store keeps the same `HostConnection` for a connection that did not change (`store.ts`, `reuse`), so a
// row is made for each `HostConnection` once, with the glyph and the colour of its plugin, and every later call hands back that very object: a change of one connection, of the connections used last, or of the plugins that
// does not touch a connection, draws the one row that changed and no other.

/** How many of the connections used last Home shows: the mock's cap for the places last opened (`CAP.visited`). The ones after them stay in their plugin's list. */
export const RECENT_SHOWN = 5;

/**
 * The identity of a connection on Home: its plugin and the plugin's key for it, as one text, made so that a plugin's id and a key that contain slashes, or each other, never run together. It is what a row is keyed by and what its
 * menu is opened for, so it names the record and not the element that draws it. Never drawn.
 */
export const homeIdOf = (plugin: string, key: string): string => JSON.stringify([plugin, key]);

/** The row each connection made, and the glyph and colour it wears: the same connection in the same plugin's glyph and colour is the same row. */
const made = new WeakMap<HostConnection, HomeConnectionRow>();

function rowOf(connection: HostConnection, icon: IconName, tone: KindTileTone): HomeConnectionRow {
  const known = made.get(connection);
  if (known?.icon === icon && known.tone === tone) {
    return known;
  }

  const { role, word } = faceOf(connection.state);
  const row: HomeConnectionRow = {
    id: homeIdOf(connection.plugin, connection.key),
    plugin: connection.plugin,
    key: connection.key,
    name: connection.name,
    detail: connection.detail,
    icon,
    tone,
    role,
    word,
    reason: connection.reason,
    busy: connection.state === 'connecting',
  };
  made.set(connection, row);
  return row;
}

/** What Home draws of the connections. */
export type HomeModel = {
  /** The connections used last that still exist, most recent first, at most `RECENT_SHOWN`. */
  readonly recent: readonly HomeConnectionRow[];
  /** The other connections, a group for each plugin that has one left. Every connection is in `recent` or in its plugin's group, never both. */
  readonly groups: readonly HomeConnectionGroup[];
  /** Every row, by its id, wherever the page draws it: what the menu of a row resolves its record against. */
  readonly rows: ReadonlyMap<string, HomeConnectionRow>;
};

/**
 * The connections of every plugin that contributes, grouped by plugin in the order of the rail, and the ones used last. A plugin with no connection has no group, a connection of a plugin that is not ready is not drawn, and a connection
 * used lately that is gone (or whose plugin has no group) is skipped for the next that exists. The groups are named when more than one plugin has a connection, counted before Recent takes any: a plugin all of whose connections are
 * recent has no group left, and the person still has the connections of two plugins.
 */
export function homeConnectionsOf(entries: readonly PluginEntry[], connections: readonly HostConnection[], recents: readonly RecentConnection[]): HomeModel {
  const byPlugin = new Map<string, HostConnection[]>();
  for (const connection of connections) {
    const own = byPlugin.get(connection.plugin);
    if (own === undefined) {
      byPlugin.set(connection.plugin, [connection]);
    } else {
      own.push(connection);
    }
  }

  const rows = new Map<string, HomeConnectionRow>();
  const listed: Array<{ readonly plugin: string; readonly label: string; readonly rows: readonly HomeConnectionRow[] }> = [];
  for (const entry of railOf(entries)) {
    const own = byPlugin.get(entry.id);
    if (own === undefined) {
      continue;
    }

    const tone = entry.accent ?? 'neutral';
    const drawn = own.map((connection) => rowOf(connection, entry.icon, tone));
    for (const row of drawn) {
      rows.set(row.id, row);
    }

    listed.push({ plugin: entry.id, label: entry.label, rows: drawn });
  }

  const recent: HomeConnectionRow[] = [];
  for (const use of recents) {
    if (recent.length === RECENT_SHOWN) {
      break;
    }

    const row = rows.get(homeIdOf(use.plugin, use.key));
    if (row !== undefined && !recent.includes(row)) {
      recent.push(row);
    }
  }

  const taken = new Set(recent);
  const named = listed.length > 1;
  const groups = listed.flatMap((group): HomeConnectionGroup[] => {
    const rest = group.rows.filter((row) => !taken.has(row));
    return rest.length === 0 ? [] : [{ plugin: group.plugin, label: group.label, named, rows: rest }];
  });
  return { recent, groups, rows };
}

/**
 * Every installed plugin, the ones that contribute first in the order of the rail, then the others by name: a plugin that is loading or did not load is still a place to go, because its
 * tab says what happened and offers the Retry, and it has no entry in the rail to reach it by.
 */
export function homeEntriesOf(entries: readonly PluginEntry[]): readonly HomeEntry[] {
  const ready = railOf(entries).map((entry): HomeEntry => ({ id: entry.id, label: entry.label, icon: entry.icon, tone: entry.accent ?? 'neutral', state: undefined }));
  const others = entries
    .filter((entry) => entry.phase !== 'ready')
    .map((entry): HomeEntry => ({ id: entry.id, label: entry.name, icon: DEFAULT_RAIL_ICON, tone: 'neutral', state: entry.phase === 'loading' ? 'Loading' : failureWords(entry.failure).caption }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : 1));
  return [...ready, ...others];
}
