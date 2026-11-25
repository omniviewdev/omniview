import { ResourceClient } from '@omniviewdev/runtime/api';
import { Events } from '@omniviewdev/runtime/runtime';
import type { AppError } from '@omniviewdev/runtime/ui/v1';

// What the connection store (`store.ts`) asks of the host, as far as it asks it: the state of every plugin's connections, a start, and the two events that say a state may have changed. The store is written over this
// type and its tests over a table of promises; `productionApi` is the one binding to the runtime, and it adapts and decides nothing.

/** One connection as the host lists it: the plugin's id for it, its name, and where its client stands. Not a probe of the network: the host says what it holds. */
export type StateRecord = {
  readonly connection: { readonly id: string; readonly name?: string | undefined; readonly description?: string | undefined };
  /** `UNKNOWN`, `DISCONNECTED`, `PENDING`, `CONNECTED` or `FAILED`. */
  readonly readiness: string;
  /** Why the last start failed, as the host classified it. Meaningful only when the readiness is `FAILED`. */
  readonly readinessError?: AppError | undefined;
};

/** What a start answered, when it answered. A start that could not run rejects instead, with the host's error. */
export type StartStatus = { readonly status: string; readonly error?: string | undefined; readonly details?: string | undefined };

export type ConnectionsApi = {
  /** The connections of every plugin that has any, by plugin id. Rejects when the host cannot answer. */
  readonly states: () => Promise<Readonly<Record<string, readonly StateRecord[]>>>;
  /** Starts a connection. Resolves with the status the host gave, rejects with its error. */
  readonly start: (plugin: string, key: string) => Promise<StartStatus>;
  /** Calls `listener` whenever the host says the status of a connection changed, in any plugin. Answers the function that stops it. */
  readonly onStatus: (listener: () => void) => () => void;
  /** Calls `listener` whenever the host says the connections of `plugin` were synced (one added, one removed, one renamed). Answers the function that stops it. */
  readonly onSync: (plugin: string, listener: () => void) => () => void;
};

/** The runtime's own calls (`ResourceClient`) and events (`Events`: `connection/status`, and `<plugin>/connection/sync` for each plugin). Needs the Wails runtime, so nothing tests it: the store's tests use a fake. */
export const productionApi: ConnectionsApi = {
  states: async () => ResourceClient.GetAllConnectionStates(),
  start: async (plugin, key) => ResourceClient.StartConnection(plugin, key),
  onStatus: (listener) =>
    Events.On('connection/status', () => {
      listener();
    }),
  onSync: (plugin, listener) =>
    Events.On(`${plugin}/connection/sync`, () => {
      listener();
    }),
};
