import { useConnections, type Connection } from '@omniviewdev/runtime/ui/v1';
import type { ShellScopeFace } from '../../contract/v1';

// The connection a page of the connections fixture reads, chosen the way a plugin with real connections chooses it: a route holds a connection's ID (`<name>-<10 hex>`), the frame prints its NAME and never
// the id. A route that names none, or one the plugin does not know, takes the plugin's first connection; while the connections are on their way there is none and the lane says so.

export type PageConnection = {
  /** The connection the page reads. Absent while the plugin's connections are on their way, and when the plugin has none. */
  readonly chosen: Connection | undefined;
  /** The plugin's connections are on their way. */
  readonly pending: boolean;
  /** The name the frame gives the connection. Undefined while the connections are on their way, and when the plugin has none. */
  readonly named: string | undefined;
};

/** What a connection is called when it has no name. */
const UNNAMED = 'Unnamed';

/** The connection a route names, or the first of the list. */
export function chooseConnection(list: readonly Connection[], route: string | undefined): Connection | undefined {
  return list.find((candidate) => candidate.id === route) ?? list[0];
}

export function useChosenConnection(plugin: string, route: string | undefined): PageConnection {
  const { connections } = useConnections({ plugin });
  const list = connections.data ?? [];
  const chosen = chooseConnection(list, route);
  const pending = connections.isPending;
  return { chosen, pending, named: chosen === undefined ? undefined : chosen.name.trim() || UNNAMED };
}

/** What the Connection face says before the plugin's connections have answered, and when the plugin has none. */
const WAITING_TEXT = 'Loading…';
const NO_CONNECTION_TEXT = 'None';

/** The scope lane's one face, always there from the first render so the host never moves the page for it. */
export function connectionFace({ named, pending }: Pick<PageConnection, 'named' | 'pending'>): ShellScopeFace {
  return { label: 'Connection', icon: 'server', text: named ?? (pending ? WAITING_TEXT : NO_CONNECTION_TEXT), role: 'connection' };
}
