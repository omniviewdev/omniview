// The count a window keeps of the forwards it has started (PF2, `portForward.ts`): how many a plugin holds in a connection, and how many the window holds in all, so that neither passes its cap. The host keeps no such count: a
// forward has no window owner (W-PF1), so the host cannot say how many this window started, and the count is the window's own, of the forwards started through the handles it gave its plugins. Another window counts its own, and so does
// a page that was reloaded: the cap is what one window and one page's life can ask, not what the host holds.
//
// A PLACE is taken at the call, synchronously, before the host is asked, so that a thousand calls made while the host is still answering take the cap's worth of places and the rest are refused at once. It is held while the forward
// lives and given back when the forward ends: when the start fails; when the forward's `stop` has closed it; when the host says that the forward is closed, whoever closed it (an event of the host's, which says nothing of a forward that
// ended on its own or whose plugin died); and when its plugin stops, which is the window's own store's to say (a plugin that stops takes its tunnels with it, and the host says nothing of it, so a plugin that crashed with forwards
// would hold places for ever and could not forward again). A forward whose tunnel ended on its own or whose connection was retired stays listed as stopped, and so counted, until it is closed: it is in the Ports tool, where it can be.
//
// The ledger listens to the host's closed events and to the window's plugins ONLY while it holds a place: the first place takes the two subscriptions and the last place gives them back, so that a window that forwards nothing has no
// listener on either.

/** What the window knows of whether a plugin runs: whether it does now, and when that may have changed. */
export type PluginPresence = {
  readonly running: (plugin: string) => boolean;
  readonly subscribe: (listener: () => void) => () => void;
};

/** The host's word that a forward is closed: calls `listener` with the id of each forward it closed, and answers the function that stops the calls. */
export type ClosedFeed = (listener: (sessionId: string) => void) => () => void;

/** What the ledger listens to. */
export type LedgerDeps = {
  readonly onClosed: ClosedFeed;
  readonly plugins: PluginPresence;
};

/** What a plugin may hold in one connection, and what the window may hold in all. */
export type Limits = { readonly connection: number; readonly window: number };

/** A place a forward holds. */
export type Place = {
  /** Says which forward the place is held for, once the host has answered the start, so that the host's word that it is closed gives the place back. A place that was given back holds nothing. */
  readonly hold: (sessionId: string) => void;
  /** Gives the place back. Safe to call again: a place is given back once. */
  readonly release: () => void;
};

/** A place, or the cap that is full and the number of it. A connection's cap is said before the window's when both are full: it is the one a person can do something about. */
export type Taken = { readonly kind: 'place'; readonly place: Place } | { readonly kind: 'full'; readonly scope: 'connection' | 'window'; readonly limit: number };

export type ForwardLedger = {
  /** Takes a place for a forward of `plugin` in `connection`, or says which cap is full. Counts at the call: nothing awaits. */
  readonly reserve: (plugin: string, connection: string) => Taken;
};

/** What the ledger knows of a place that is taken. */
type Held = {
  readonly plugin: string;
  /** The plugin and the connection together, which a name cannot imitate. */
  readonly key: string;
  /** The forward the place is held for, once it is known. */
  session: string | undefined;
};

export function createForwardLedger(deps: LedgerDeps, limits: Limits): ForwardLedger {
  const places = new Set<Held>();
  const perConnection = new Map<string, number>();
  const bySession = new Map<string, Held>();
  /** The ids the host said were closed while a place did not yet know its own: a forward can be closed before the call that started it has heard that it started. */
  const early = new Set<string>();
  /** The places that do not yet know their id. */
  let unassigned = 0;
  let stopListening: (() => void) | undefined;

  const forgetEarly = (): void => {
    if (unassigned === 0) {
      early.clear();
    }
  };

  const release = (held: Held): void => {
    if (!places.delete(held)) {
      return;
    }

    const left = (perConnection.get(held.key) ?? 1) - 1;
    if (left === 0) {
      perConnection.delete(held.key);
    } else {
      perConnection.set(held.key, left);
    }

    if (held.session === undefined) {
      unassigned -= 1;
      forgetEarly();
    } else if (bySession.get(held.session) === held) {
      // A later place may hold the same id, which the host keeps one session of: it is not this one's to forget.
      bySession.delete(held.session);
    }

    if (places.size === 0) {
      stopListening?.();
      stopListening = undefined;
    }
  };

  const hold = (held: Held, session: string): void => {
    if (!places.has(held)) {
      return;
    }

    if (early.has(session)) {
      release(held);
      return;
    }

    held.session = session;
    bySession.set(session, held);
    unassigned -= 1;
    forgetEarly();
  };

  const closed = (session: string): void => {
    const held = bySession.get(session);
    if (held !== undefined) {
      release(held);
    } else if (unassigned > 0) {
      early.add(session);
    }
  };

  const changed = (): void => {
    for (const held of [...places]) {
      if (!deps.plugins.running(held.plugin)) {
        release(held);
      }
    }
  };

  /** Listens to the two feeds. When the second cannot be listened to, the first is not left listening: a failure takes nothing. */
  const listen = (): void => {
    const stopClosed = deps.onClosed(closed);
    let stopPlugins: () => void;
    try {
      stopPlugins = deps.plugins.subscribe(changed);
    } catch (error) {
      stopClosed();
      throw error;
    }

    stopListening = () => {
      stopClosed();
      stopPlugins();
    };
  };

  return {
    reserve: (plugin, connection) => {
      const key = JSON.stringify([plugin, connection]);
      if ((perConnection.get(key) ?? 0) >= limits.connection) {
        return { kind: 'full', scope: 'connection', limit: limits.connection };
      }

      if (places.size >= limits.window) {
        return { kind: 'full', scope: 'window', limit: limits.window };
      }

      // Before anything is counted, so that a feed that cannot be listened to leaves the counts as they were.
      if (places.size === 0) {
        listen();
      }

      const held: Held = { plugin, key, session: undefined };
      places.add(held);
      perConnection.set(key, (perConnection.get(key) ?? 0) + 1);
      unassigned += 1;
      return {
        kind: 'place',
        place: {
          hold: (session) => {
            hold(held, session);
          },
          release: () => {
            release(held);
          },
        },
      };
    },
  };
}
