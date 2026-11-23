import type { HomeConnectionGroup, HomeConnectionRow } from './Home';
import { faceOf } from './connections/words';
import type { HostConnection } from './connections/types';
import type { PluginEntry } from './pluginStore';
import { railOf } from './rail';

// What Home says of the connections (HM1), made from what the window knows: one group for each plugin that contributes and has a connection, in the order of the rail (R2), each connection by its NAME with the state it is
// in. The mock's Home lists the connections that are IN USE only (shell-page-home.js, `connectionsSection`: "idle ones never show"); the person this slice is for could not find their connections at all, so Home lists
// every one a plugin has, and the state says which are connected.

/** The connections of every plugin that contributes, grouped by plugin. A plugin with none has no group. */
export function homeGroupsOf(entries: readonly PluginEntry[], connections: readonly HostConnection[]): readonly HomeConnectionGroup[] {
  return railOf(entries).flatMap((entry): HomeConnectionGroup[] => {
    const rows = connections
      .filter((connection) => connection.plugin === entry.id)
      .map((connection): HomeConnectionRow => {
        const { role, word } = faceOf(connection.state);
        return { key: connection.key, name: connection.name, role, word, reason: connection.reason, busy: connection.state === 'connecting' };
      });
    return rows.length === 0 ? [] : [{ plugin: entry.id, label: entry.label, icon: entry.icon, tone: entry.accent ?? 'neutral', rows }];
  });
}
