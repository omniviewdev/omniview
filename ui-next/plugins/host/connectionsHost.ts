import type { ConnectionOpenResultV1, ConnectionV1, ConnectionsHostV1, ConnectionsViewV1 } from '../contract/v1';
import { faceOf, type ConnectionsState, type ConnectionsStore, type HostConnection, type HostConnections } from './connections';

// What a custom page asks of the window about its plugin's connections (KL2; `ConnectionsHostV1`): the window's own store, words and actions (`connections/`), for ONE plugin, handed over as one external store and three
// functions. There is no second store: the view is the window's list of connections cut to the plugin's, so what a landing draws is what Home and the scope lane draw, in the same words, at the same moment. `ctx.panel` is made
// the same way (`panelHost.ts`): one handle for each plugin, made once and given again as it was, so a context that holds it stays the same object.

/** Where an open that a plugin's page asked for says it came from, in the tab model's record of where an open came from (`Home` says `home`, the palette `palette`). */
const SOURCE = 'landing';

/** The words a plugin's page gets when the window has no connection data (a test of another part): no connection, none that can be opened. */
const NO_CONNECTIONS = 'This window has no connections to open.';

/**
 * The connection a plugin's page is told of, made once for each `HostConnection`. The store keeps the same object for a connection that did not change (`store.ts`, `reuse`), so a connection that did not change is the same object here, and a page that
 * draws it is not drawn again. Frozen, because the pages of a plugin share one view.
 */
const told = new WeakMap<HostConnection, ConnectionV1>();

function toldOf(connection: HostConnection): ConnectionV1 {
  const known = told.get(connection);
  if (known !== undefined) {
    return known;
  }

  const { role, word } = faceOf(connection.state);
  const made: ConnectionV1 = Object.freeze({ key: connection.key, name: connection.name, description: connection.detail, state: connection.state, word, role, reason: connection.reason });
  told.set(connection, made);
  return made;
}

/** Whether two lists hold the very same connections, in the same order. */
const sameConnections = (a: readonly ConnectionV1[], b: readonly ConnectionV1[]): boolean => a.length === b.length && a.every((entry, index) => entry === b[index]);

/**
 * The view of one plugin's connections, as a `getSnapshot`: the window's list cut to the plugin, with each connection the object it was and the whole view the object it was while nothing of the plugin's changed. A change of another plugin's connection
 * makes the window's state another object and this view the same one, which is what lets a page that reads it through `useSyncExternalStore` draw nothing.
 */
function viewOf(store: ConnectionsStore, plugin: string): () => ConnectionsViewV1 {
  let read: ConnectionsState | undefined;
  let held: ConnectionsViewV1 | undefined;
  return () => {
    const state = store.getSnapshot();
    if (state === read && held !== undefined) {
      return held;
    }

    read = state;
    const own = state.connections.flatMap((connection) => (connection.plugin === plugin ? [toldOf(connection)] : []));
    const connections = held !== undefined && sameConnections(held.connections, own) ? held.connections : Object.freeze(own);
    if (held?.loaded !== state.loaded || held.failed !== state.failed || held.connections !== connections) {
      held = Object.freeze({ loaded: state.loaded, failed: state.failed, connections });
    }

    return held;
  };
}

function handleOf({ store, actions }: HostConnections, plugin: string): ConnectionsHostV1 {
  const view = viewOf(store, plugin);
  return Object.freeze({
    // Called for a change of the window's list, whoever's it is; the listener hears of this plugin's alone.
    subscribe: (listener: () => void) => {
      let last = view();
      return store.subscribe(() => {
        const next = view();
        if (next !== last) {
          last = next;
          listener();
        }
      });
    },
    getSnapshot: view,
    // The plugin is the handle's, whatever the key: a page opens a connection of its own plugin and of no other.
    open: async (key: string, options?: { readonly newTab?: boolean | undefined }): Promise<ConnectionOpenResultV1> => actions.go(plugin, key, { how: options?.newTab === true ? 'new' : 'smart', source: SOURCE }),
    refresh: async () => store.refresh(),
  });
}

const NONE_VIEW: ConnectionsViewV1 = Object.freeze({ loaded: true, failed: false, connections: Object.freeze([]) });

/** What a window with no connection data gives a page: it reads no connection, and opening one is refused in words. */
const NONE: ConnectionsHostV1 = Object.freeze({
  subscribe: () => () => undefined,
  getSnapshot: () => NONE_VIEW,
  open: async () => Promise.resolve({ ok: false, reason: NO_CONNECTIONS }),
  refresh: async () => Promise.resolve(),
});

/**
 * What `context.connections` is for each plugin: one handle for each plugin, made on the first ask and given again as it was. `undefined` connections (a window with no connection API) give every plugin the handle that reads none.
 */
export function connectionsHostsOf(connections: HostConnections | undefined): (plugin: string) => ConnectionsHostV1 {
  const made = new Map<string, ConnectionsHostV1>();
  return (plugin) => {
    const known = made.get(plugin);
    if (known !== undefined) {
      return known;
    }

    const handle = connections === undefined ? NONE : handleOf(connections, plugin);
    made.set(plugin, handle);
    return handle;
  };
}
