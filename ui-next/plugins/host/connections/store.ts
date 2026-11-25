import type { ConnectionsApi, StateRecord } from './api';
import type { ConnectOutcome, HostConnection } from './types';
import { failureOf, nameOf, outcomeOfStatus, stateOfReadiness } from './words';

// What the window knows of the connections of every plugin (HM1), and what it does to learn more: one list, read from the host, with a start of this window that is running shown as connecting. Framework-free, like `pluginStore.ts`:
// React reads it through `useSyncExternalStore` (`getSnapshot` is the same object until something in it changes), and the host is injected (`ConnectionsApi`), so the rules here are tests with no runtime and no host.
//
// THE LIST is what the last read that worked said (`GetAllConnectionStates`: a readiness word and the host's error for each connection of each plugin), sorted by plugin, then by name, then by key. A window that
// has never read has an empty list and `loaded: false`, so an empty window is never mistaken for a plugin with no connections; a read that failed keeps the list and says `failed: true`.
//
// READS. A read that is asked for while another is in flight shares it, unless the host has changed since that one began (an event was heard, or a start of this window ended): a read that began before the change may
// not have seen it, so the next is a new one. Two reads can then be in flight, and the one that began first never overwrites what the one that began last has already said (the generation counter).
//
// STARTS. `connect` marks the connection `connecting` at once and keeps the mark until the read that follows the start has landed, whether the start worked or failed, so a list never goes back to the state it had before the
// start in between. The store keeps no memory of a failed start: the host does (its list says FAILED, with its own `readinessError`, the public form of why, and `connection/status` tells every window that something changed),
// so a connection is what the last list said, whichever window made the start, and a list that says something else the next time is believed. The one thing that comes from the start itself is the answer of `connect`: its
// rejection (or the status it answered) is worded for the caller, given to it and not stored.
//
// EVENTS. `attach` keeps the window in step with the host while it lives: the host says that something changed (`connection/status`, and `<plugin>/connection/sync` for each plugin), not what, so every event
// asks for a read, and a burst of them asks for one, 100 ms after the first.

/** The state of the window's connections. */
export type ConnectionsState = {
  /** A read has finished, whether it worked or not. Until then the list is empty because nothing was asked, not because there is nothing. */
  readonly loaded: boolean;
  /** The last read failed. The list is what the last read that worked said (empty before one). */
  readonly failed: boolean;
  /** Every plugin's connections as the host said them, sorted by plugin id, then name, then key, with a start of this window that is running shown as connecting. The same array until something in it changes. */
  readonly connections: readonly HostConnection[];
};

export type ConnectionsStore = {
  /** The state. The same object until something in it changes. */
  readonly getSnapshot: () => ConnectionsState;
  /** Called after every change of the state, and never for a read or a start that changed nothing. Answers the function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Reads the host's list now. Calls that overlap share one read, unless the host changed after it began. Never rejects: a read that failed is `failed: true`. */
  readonly refresh: () => Promise<void>;
  /**
   * Starts a connection of a plugin by its key. A connection that is listed and connected is not started: the answer is `connected`. Otherwise it is `connecting` at once, and the answer comes after the host ended the
   * start AND the list was read again, so whoever routes on it finds the state current. The answer is what the start came to (a failure carries its class and one line that is safe to show); what the connection is afterwards is what
   * the list says, and the store keeps nothing of a failed start of its own. Calls for the same connection that overlap share one start. Never rejects.
   */
  readonly connect: (plugin: string, key: string) => Promise<ConnectOutcome>;
  /**
   * Keeps the window in step with the host for as long as it lives: reads once, follows `connection/status` and the sync of each plugin `plugins` lists (read again after every read), and reads again 100 ms after the first
   * event of a burst. Answers the function that undoes it: no event is followed afterwards, no read is scheduled, and a read that was in flight changes nothing. Attached twice, one set of events stays until both are undone.
   */
  readonly attach: () => () => void;
};

export type ConnectionsStoreOptions = {
  /** The ids of the plugins whose connection sync is followed. Read when the store is attached and after every read. Default: none (the status event is followed all the same). */
  readonly plugins?: (() => readonly string[]) | undefined;
  /** Runs `run` after `ms` milliseconds; answers the function that cancels it. Default: `setTimeout` and `clearTimeout`. */
  readonly schedule?: ((run: () => void, ms: number) => () => void) | undefined;
};

/** How long a burst of events is gathered before the one read it asks for. */
const COALESCE_MS = 100;

const CONNECTED: ConnectOutcome = { status: 'connected' };

// `localeCompare` with these options, made once: a collator that is built for every comparison is most of the cost of sorting.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** The id of a connection in the maps here: a tuple, so that a plugin's id and a key that contain slashes or each other never run together. */
const idOf = (plugin: string, key: string): string => JSON.stringify([plugin, key]);

const raw = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Plugin, then name, then key: numbers by value and case ignored ("ctx2" before "ctx10", "alpha" before "Beta"). Texts that differ only in case still have one order, so the list never depends on the order the host gave them in. */
function compare(a: HostConnection, b: HostConnection): number {
  return (
    collator.compare(a.plugin, b.plugin) ||
    collator.compare(a.name, b.name) ||
    collator.compare(a.key, b.key) ||
    raw(a.plugin, b.plugin) ||
    raw(a.name, b.name) ||
    raw(a.key, b.key)
  );
}

/** What the host answered, as one sorted list of connections whose state is what the host's readiness says. */
function flatten(answer: Readonly<Record<string, readonly StateRecord[]>>): HostConnection[] {
  const connections: HostConnection[] = [];
  for (const [plugin, records] of Object.entries(answer)) {
    for (const record of records) {
      const { state, reason } = stateOfReadiness(record.readiness, record.readinessError);
      connections.push({ plugin, key: record.connection.id, name: nameOf(record.connection), state, reason });
    }
  }

  return connections.sort(compare);
}

/** `next`, with each connection that is the same as the one `previous` holds for it being that very object, and the whole array being `previous` when nothing differs. */
function reuse(previous: readonly HostConnection[], next: readonly HostConnection[]): readonly HostConnection[] {
  const held = new Map<string, HostConnection>();
  for (const entry of previous) {
    held.set(idOf(entry.plugin, entry.key), entry);
  }

  const kept = next.map((entry) => {
    const before = held.get(idOf(entry.plugin, entry.key));
    return before?.name === entry.name && before.state === entry.state && before.reason === entry.reason ? before : entry;
  });
  return kept.length === previous.length && kept.every((entry, index) => entry === previous[index]) ? previous : kept;
}

const later = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);
  return () => {
    clearTimeout(timer);
  };
};

/** A read that is in flight, and the version of the host it began at. */
type Read = { readonly version: number; readonly done: Promise<void> };

/** What `attach` keeps for as long as the window lives. */
type Session = {
  /** Follows the sync of the plugins that are listed now, and of no others. */
  readonly sync: () => void;
  readonly stop: () => void;
};

export function createConnectionsStore(api: ConnectionsApi, options: ConnectionsStoreOptions = {}): ConnectionsStore {
  const schedule = options.schedule ?? later;
  const listeners = new Set<() => void>();
  let snapshot: ConnectionsState = { loaded: false, failed: false, connections: [] };

  // What the host said in the last read that worked, and how reading has gone.
  let host: readonly HostConnection[] = [];
  let hasLoaded = false;
  let didFail = false;
  // What this window does to the connections the host lists: the starts that are running (shown as connecting), and the promise each running start answers by.
  const marks = new Set<string>();
  const attempts = new Map<string, Promise<ConnectOutcome>>();

  // The reads. `started` counts the reads begun and `newest` is the last one whose answer was taken: an answer is taken only if no later read's has been, so what is said last about the host is what began last.
  // `version` counts what may have changed the host under a read in flight, and `shared` is the read that a call may share (the one that began at the version the host is at).
  let started = 0;
  let newest = 0;
  let version = 0;
  let shared: Read | undefined;

  let attached = 0;
  let session: Session | undefined;

  // A listener that throws is its own fault: it does not stop the others, and it does not turn a read or a start into a rejection.
  const notify = (): void => {
    for (const listener of [...listeners]) {
      if (!listeners.has(listener)) {
        continue;
      }

      try {
        listener();
      } catch (error) {
        console.error('[connections] a listener failed', error);
      }
    }
  };

  /** The host's list with the starts of this window that are running shown as connecting. Nothing else is laid over what the host said. */
  const overlay = (): readonly HostConnection[] =>
    host.map((entry): HostConnection => (marks.has(idOf(entry.plugin, entry.key)) ? { ...entry, state: 'connecting', reason: undefined } : entry));

  const publish = (): void => {
    const connections = reuse(snapshot.connections, overlay());
    if (snapshot.loaded === hasLoaded && snapshot.failed === didFail && snapshot.connections === connections) {
      return;
    }

    snapshot = { loaded: hasLoaded, failed: didFail, connections };
    notify();
  };

  /** Takes the answer of a read: the list it said, or that it failed (which keeps the list). */
  const apply = (answer: readonly HostConnection[] | undefined): void => {
    hasLoaded = true;
    if (answer === undefined) {
      didFail = true;
    } else {
      didFail = false;
      host = answer;
    }

    publish();
  };

  const settle = async (generation: number): Promise<void> => {
    let answer: readonly HostConnection[] | undefined;
    try {
      answer = flatten(await api.states());
    } catch {
      answer = undefined;
    }

    if (generation > newest) {
      newest = generation;
      apply(answer);
    }

    // The plugins may have changed since the list was last read: follow the ones that are there now. A window that was detached meanwhile follows nothing.
    session?.sync();
  };

  const refresh = async (): Promise<void> => {
    if (shared?.version === version) {
      return shared.done;
    }

    started += 1;
    const mine: Read = { version, done: settle(started) };
    shared = mine;
    try {
      await mine.done;
    } finally {
      if (shared === mine) {
        shared = undefined;
      }
    }
  };

  const follow = (): Session => {
    let isLive = true;
    let cancel: (() => void) | undefined;
    const followed = new Map<string, () => void>();

    const onEvent = (): void => {
      if (!isLive) {
        return;
      }

      // The host changed under any read that is in flight, whatever it was.
      version += 1;
      // The first event of a burst asks for the read; the others, until it runs, are covered by it.
      cancel ??= schedule(() => {
        cancel = undefined;
        if (isLive) {
          void refresh();
        }
      }, COALESCE_MS);
    };

    const sync = (): void => {
      if (!isLive) {
        return;
      }

      try {
        const wanted = new Set(options.plugins?.() ?? []);
        for (const [plugin, stop] of followed) {
          if (!wanted.has(plugin)) {
            stop();
            followed.delete(plugin);
          }
        }

        for (const plugin of wanted) {
          if (!followed.has(plugin)) {
            followed.set(plugin, api.onSync(plugin, onEvent));
          }
        }
      } catch (error) {
        console.error('[connections] could not follow the plugins\' connections', error);
      }
    };

    const stopStatus = api.onStatus(onEvent);
    sync();
    return {
      sync,
      stop: () => {
        isLive = false;
        stopStatus();
        for (const stop of followed.values()) {
          stop();
        }

        followed.clear();
        cancel?.();
        cancel = undefined;
      },
    };
  };

  const attach = (): (() => void) => {
    // Nothing is counted until the events are followed: an `onStatus` that throws leaves no half-attached store behind.
    if (attached === 0) {
      session = follow();
    }

    attached += 1;
    if (attached === 1) {
      void refresh();
    }

    let isDone = false;
    return () => {
      if (isDone) {
        return;
      }

      isDone = true;
      attached -= 1;
      if (attached === 0) {
        session?.stop();
        session = undefined;
        // Every read begun so far is over: its answer is not taken, and a call that comes next does not share it.
        newest = started;
        shared = undefined;
      }
    };
  };

  /** What the host said of a start, as the outcome it is. A host that throws, or answers what is not a status, is a failure like any other. */
  const ended = async (plugin: string, key: string): Promise<ConnectOutcome> => {
    try {
      return outcomeOfStatus(await api.start(plugin, key));
    } catch (error) {
      return { status: 'failed', ...failureOf(error) };
    }
  };

  /** Runs the start that `connect` marked, and settles what the window knows once it ended: the list is read again, and only then does the mark go. The outcome is the start's own, whichever way it ended. */
  const finish = async (plugin: string, key: string, id: string): Promise<ConnectOutcome> => {
    const outcome = await ended(plugin, key);
    // The host is not what a read in flight has seen: the start has changed it, so the read below is a new one.
    version += 1;
    await refresh();
    // A start keeps its mark until the read has landed, whether it worked or failed: the list says connecting, then what the host says (connected, or FAILED with its error), and never what it said before the start in between.
    if (marks.delete(id)) {
      publish();
    }

    return outcome;
  };

  const connect = async (plugin: string, key: string): Promise<ConnectOutcome> => {
    const id = idOf(plugin, key);
    const running = attempts.get(id);
    if (running !== undefined) {
      return running;
    }

    if (snapshot.connections.some((entry) => entry.plugin === plugin && entry.key === key && entry.state === 'connected')) {
      return CONNECTED;
    }

    // Marked, started and registered before anything is told to anyone, so that nobody who hears the mark can start it twice.
    marks.add(id);
    const attempt = finish(plugin, key, id);
    attempts.set(id, attempt);
    publish();
    try {
      return await attempt;
    } finally {
      attempts.delete(id);
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    connect,
    attach,
  };
}
