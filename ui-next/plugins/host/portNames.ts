import type { PortNames } from '../../shell';
import type { ConnectionNames } from './connectionName';
import type { ConnectionsStore } from './connections';

// What the Ports tool reads of the window to name the connection of a forward. The host states a forward's connection by the plugin's own id for it, which is never drawn (`connectionName.ts`); the NAME a person knows it by is the window's:
// first the connections it lists for its plugins (`connections/`: the names the host's own records give), then the names it learned from the pages it drew. A connection that neither knows has no name, and the table draws a dash.

/**
 * The names of connections for the Ports tool. The list is read as it is when a name is asked for, and `subscribe` hears the list and the learned names: the tool listens while it is on screen, and a connection that was renamed or that
 * arrived, or whose name a page taught the window, is a row that changes. A window with no connection list (a test of another part) has only what it learned.
 */
export function portNamesOf(connections: Pick<ConnectionsStore, 'getSnapshot' | 'subscribe'> | undefined, learned: Pick<ConnectionNames, 'get' | 'subscribe'>): PortNames {
  return {
    of: (plugin, connection) => connections?.getSnapshot().connections.find((entry) => entry.plugin === plugin && entry.key === connection)?.name ?? learned.get(plugin, connection),
    subscribe: (listener) => {
      const stops = [connections?.subscribe(listener), learned.subscribe(listener)];
      return () => {
        for (const stop of stops) {
          stop?.();
        }
      };
    },
  };
}
