import { ResourceClient } from '@omniviewdev/runtime/api';
import { Events } from '@omniviewdev/runtime/runtime';
import type { AppError } from '@omniviewdev/runtime/ui/v1';

// What the connection store (`store.ts`) and the verbs (`verbs.ts`) ask of the host, as far as they ask it: the state of every plugin's connections, a start, a check, a stop, a removal, a load of a plugin's connections, and the two events that say a state may have changed. The store is written over this
// type and its tests over a table of promises; `productionApi` is the one binding to the runtime, and it adapts and decides nothing.

/** One connection as the host lists it: the plugin's id for it, its name, and where its client stands. Not a probe of the network: the host says what it holds. */
export type StateRecord = {
  readonly connection: { readonly id: string; readonly name?: string | undefined; readonly description?: string | undefined; readonly labels?: unknown };
  /** `UNKNOWN`, `DISCONNECTED`, `PENDING`, `CONNECTED` or `FAILED`. */
  readonly readiness: string;
  /** Why the last start failed, as the host classified it. Meaningful only when the readiness is `FAILED`. */
  readonly readinessError?: AppError | undefined;
};

/** What a start or a check answered, when it answered. A call that could not run rejects instead, with the host's error. */
export type StartStatus = { readonly status: string; readonly error?: string | undefined; readonly details?: string | undefined };

export type ConnectionsApi = {
  /** The connections of every plugin that has any, by plugin id. Rejects when the host cannot answer. */
  readonly states: () => Promise<Readonly<Record<string, readonly StateRecord[]>>>;
  /** Starts a connection. Resolves with the status the host gave, rejects with its error. */
  readonly start: (plugin: string, key: string) => Promise<StartStatus>;
  /** Asks the plugin whether a connection is healthy (`CheckConnection`). Resolves with the status the plugin gave (a connection that is not started says DISCONNECTED), rejects with the host's error. The host's list does not change for it. */
  readonly check: (plugin: string, key: string) => Promise<StartStatus>;
  /** Stops a connection (`StopConnection`): resolves when the host has, rejects with its error. A connection that is not started is stopped all the same, and a start that failed is forgotten. */
  readonly stop: (plugin: string, key: string) => Promise<unknown>;
  /** Removes a connection from the plugin's list (`RemoveConnection`): resolves when the host has, rejects with its error (a plugin that cannot, a connection that is not its own). */
  readonly remove: (plugin: string, key: string) => Promise<void>;
  /** Asks the plugin's backend to load its connections again (`LoadConnections`): it may find new ones and lose others, and the host's list says so afterwards. Rejects with the host's error. */
  readonly load: (plugin: string) => Promise<unknown>;
  /** Calls `listener` whenever the host says the status of a connection changed, in any plugin. Answers the function that stops it. */
  readonly onStatus: (listener: () => void) => () => void;
  /** Calls `listener` whenever the host says the connections of `plugin` were synced (one added, one removed, one renamed). Answers the function that stops it. */
  readonly onSync: (plugin: string, listener: () => void) => () => void;
};

/** The runtime's own calls (`ResourceClient`) and events (`Events`: `connection/status`, and `<plugin>/connection/sync` for each plugin). Needs the Wails runtime, so nothing tests it: the store's tests use a fake. */
export const productionApi: ConnectionsApi = {
  states: async () => ResourceClient.GetAllConnectionStates(),
  start: async (plugin, key) => ResourceClient.StartConnection(plugin, key),
  check: async (plugin, key) => ResourceClient.CheckConnection(plugin, key),
  stop: async (plugin, key) => ResourceClient.StopConnection(plugin, key),
  remove: async (plugin, key) => ResourceClient.RemoveConnection(plugin, key),
  load: async (plugin) => ResourceClient.LoadConnections(plugin),
  onStatus: (listener) =>
    Events.On('connection/status', () => {
      listener();
    }),
  onSync: (plugin, listener) =>
    Events.On(`${plugin}/connection/sync`, () => {
      listener();
    }),
};
