import type { LedgerDeps } from './portLedger';

// Test support for the forwards a window counts (`portLedger.ts`): the host's word that a forward is closed, and the window's word on which plugins run, as a test controls them, in the order the test chooses. Nothing in the
// product imports this file.

/** How many listeners each of the two feeds has. */
export type Listening = { readonly closed: number; readonly plugins: number };

export type LedgerWorld = {
  /** What the ledger is given. A plugin runs until `stopped` says it does not. */
  readonly deps: LedgerDeps;
  /** The listeners each feed has now: none while nothing is counted. */
  readonly listening: () => Listening;
  /** The subscriptions each feed has had in all, those that were removed too: a feed that is listened to again is a subscription more. */
  readonly subscribed: () => Listening;
  /** The host says it closed the forward with this id. */
  readonly closed: (sessionId: string) => void;
  /** A plugin stops running, and the window's store says so. */
  readonly stopped: (plugin: string) => void;
};

export function ledgerWorld(): LedgerWorld {
  const closedListeners = new Set<(sessionId: string) => void>();
  const pluginListeners = new Set<() => void>();
  const gone = new Set<string>();
  const made = { closed: 0, plugins: 0 };
  return {
    deps: {
      onClosed: (listener) => {
        made.closed += 1;
        closedListeners.add(listener);
        return () => {
          closedListeners.delete(listener);
        };
      },
      plugins: {
        running: (plugin) => !gone.has(plugin),
        subscribe: (listener) => {
          made.plugins += 1;
          pluginListeners.add(listener);
          return () => {
            pluginListeners.delete(listener);
          };
        },
      },
    },
    listening: () => ({ closed: closedListeners.size, plugins: pluginListeners.size }),
    subscribed: () => ({ ...made }),
    closed: (sessionId) => {
      for (const listener of [...closedListeners]) {
        listener(sessionId);
      }
    },
    stopped: (plugin) => {
      gone.add(plugin);
      for (const listener of [...pluginListeners]) {
        listener();
      }
    },
  };
}
