import { readRunning, readUnloaded } from '../../../plugins/host/lifecycle';
import { CLOSED_EVENT, CONNECTION_EVENT, CREATED_EVENT, STATE_CHANGE_EVENT, UNLOADED_EVENT, type PortsDeps } from './api';
import { availabilityOf, browserUrlOf, readForward, rowOf, sameRow, sameSession, type Facts, type Forward, type PortRow } from './model';

// The store of the Ports tool: the forwards the host holds, as rows, kept true by the host's events for as long as somebody looks. Framework-free, like the connections' store (`plugins/host/connections/store.ts`): React reads it through
// `useSyncExternalStore` and the host is injected (`PortsDeps`), so its rules are tests with no runtime and no host.
//
// IT HOLDS NOTHING WHILE NOBODY LOOKS. The first subscriber starts it (the host is asked for the list and the events are listened to, in that order of readiness: the handlers first, so that nothing that happens during the read is lost); the
// last one stops it (every handler is taken off, the clock of a press is cancelled, what was held is let go). A store that is looked at again starts from loading: what it held while nobody listened is not known to be true. That is the
// tool's idle cost: a window with the tool out of sight has no call, no listener and no timer of it.
//
// THE LIST is the host's own (`ListAllPortForwardSessions`: every forward of every window and every plugin: the host gives a forward no owner, docs/ui-next/status/PF1.md W-PF1). The host says two things as they happen,
// that a forward was created and that one was closed; it does not say that a forward failed, that a connection ended it or that its plugin died (W-PF2). So the tool reads the list again when it hears that a connection changed or that
// a plugin stopped or runs again, and says of a plugin's forwards what the host says of the plugin: that it stopped (the host drops a plugin's forwards from its list when the plugin goes, so the rows are kept and said as Stopped
// until the plugin runs again, when they are gone: its new process has none). One read is on its way at a time, and a question asked while it is gets one more read, not one for each: no timer is needed to gather a burst. An answer that
// an event overtook is not taken (it may be older than the event) and the host is asked again.
//
// WHAT IT TELLS, AND WHEN. The host's events (a forward made or closed, a plugin that stopped or runs, a connection or a name that changed) arrive in tasks of their own, as many as a flood has, and a store that told its listener for each
// would make a commit for each. They change what the store holds at once, and the snapshot is made, and the listener told, once, at the window's next frame (`deps.frame`): a burst is one snapshot, and a store the host says nothing to asks for
// no frame. What a person does or the host answers is told at once and takes the events that wait with it: a press of Stop, the answer of a read or of a close, the clock of the check mark. A press reads what is held and not what is shown
// (`rowFor`), so that it is true to a row that no frame has drawn yet.
//
// WHAT IT ADDS to what the host states is four facts, each the window's own (`Facts`): that Stop was pressed, that the plugin stopped, why a Stop could not end a forward, and the name of its connection.

/** How long the check mark of a press of Copy address stays: the mock's two seconds (and the Logs' and the Terminal's). */
export const COPIED_MS = 2_000;

/** How many times a press asks the host again when what it answers may be older than an event, before the press is not confirmed. */
const CONFIRMATIONS = 3;

/** What a person who cannot see the table is told: said once, in the order it happened. A new `id` makes the words new, so that the same words said twice are read twice. */
export type Announcement = { readonly id: number; readonly text: string };

export type PortsSnapshot = {
  /** `loading` until the host first answers, `failed` when it could not, and for as long as the tool is not looked at. */
  readonly status: 'loading' | 'ready' | 'failed';
  readonly rows: readonly PortRow[];
  /** The row whose address was copied a moment ago: its Copy button shows a check mark. */
  readonly copied: string | undefined;
  readonly announcement: Announcement | undefined;
};

export type PortsStore = {
  /** The state. The same object until something in it changes. */
  readonly getSnapshot: () => PortsSnapshot;
  /** Starts the store with the first listener and stops it with the last. Answers the function that removes the listener; calling that again does nothing. */
  readonly subscribe: (listener: () => void) => () => void;
  /** Reads the list again, from loading: what Try again does. */
  readonly retry: () => void;
  /**
   * Asks the host to close a forward. The row says Stopping until the host says it is closed; a host that refuses puts the row back and the row says why. `session` is the session the button was drawn for (`PortRow.session`): a press for a session
   * that has since lost the id to another is not made, so a button that is on the screen never acts on a forward the person did not choose.
   */
  readonly stop: (id: string, session?: number) => void;
  /** Opens a forward that runs over TCP in the system's browser. Bound to the session the button was drawn for, as Stop is. */
  readonly open: (id: string, session?: number) => void;
  /** Puts a forward's address on the clipboard, and marks the row for a moment. Bound to the session the button was drawn for, as Stop is. */
  readonly copy: (id: string, session?: number) => void;
};

type Held = {
  readonly forward: Forward;
  /** The order it arrived in: it settles the rows made at the same moment. */
  readonly seq: number;
  /** Which session of its id this is: a later session that takes the id is another incarnation, and an answer about the first says nothing of it. */
  readonly incarnation: number;
};

type Outcome = { readonly ok: true; readonly sessions: readonly unknown[] | null | undefined } | { readonly ok: false };

/** Everything the store holds while it is looked at: one object, thrown away with the last listener, so that nothing that an old look started can touch the next. */
type Live = {
  status: PortsSnapshot['status'];
  held: Map<string, Held>;
  /** The plugins the host said stopped, and has not said run again. */
  gone: Set<string>;
  /** The plugins said stopped that the events connection may have missed running again: the next list the host gives decides, and a plugin it lists forwards of serves. */
  recheck: Set<string>;
  /** The forwards Stop was pressed for and the host has not closed. */
  stopping: Set<string>;
  /** Why the last Stop of a forward could not end it. */
  failures: Map<string, string>;
  /** The row whose address was copied a moment ago, which session of it and which address: the mark is for that, and goes when either changes. */
  copied: { readonly id: string; readonly incarnation: number; readonly address: string } | undefined;
  /** What is to be said aloud when the snapshot is next made: in the order it happened, and read as one announcement. */
  said: string[];
  announcement: Announcement | undefined;
  seq: number;
  /** Counts the sessions the store has held: each has an incarnation of its own, which tells it from a later session that took its id. */
  incarnations: number;
  /** Counts what changed the forwards the store holds, apart from a read: an answer that began before the change is not the truth. */
  generation: number;
  reading: boolean;
  again: boolean;
  cancelCopied: (() => void) | undefined;
  /** Cancels the frame that is asked for, when one is: what the host said is shown in it. */
  cancelFrame: (() => void) | undefined;
  off: () => void;
  snapshot: PortsSnapshot;
};

const IDLE: PortsSnapshot = Object.freeze({ status: 'loading', rows: Object.freeze([]), copied: undefined, announcement: undefined });

/** The words the tool says aloud. The mapping names the forward: two forwards of one resource are told apart by it. */
const SAYS = {
  copied: 'Address copied',
  copyFailed: 'Couldn\'t copy the address',
  stopped: (mapping: string) => `Stopped ${mapping}`,
  stopFailed: (mapping: string) => `Couldn't stop ${mapping}`,
  openFailed: (address: string) => `Couldn't open ${address} in the browser`,
  notOpened: 'Not opened: the forward is not running.',
  copiedNotRunning: 'Copied, but the forward is not running.',
} as const;

/** A call of the host made now, whose answer is a promise whether the call answered, threw or returned a value: a call that throws is a call that failed. */
const attempt = async <T>(call: () => PromiseLike<T> | T): Promise<T> => call();

export function createPortsStore(deps: PortsDeps): PortsStore {
  const listeners = new Set<() => void>();
  let live: Live | undefined;

  const notify = (): void => {
    for (const listener of [...listeners]) {
      if (listeners.has(listener)) {
        listener();
      }
    }
  };

  const factsOf = (mine: Live, forward: Forward): Facts => ({
    stopping: mine.stopping.has(forward.id),
    pluginStopped: forward.plugin !== '' && mine.gone.has(forward.plugin),
    failure: mine.failures.get(forward.id),
    connectionName: forward.kind === 'resource' ? deps.names?.of(forward.plugin, forward.connection) : undefined,
    session: mine.held.get(forward.id)?.incarnation,
  });

  /** The rows, in the order the forwards were made; a row that says what its twin said is that very object, so the row that shows it does not render. */
  const rowsOf = (mine: Live): readonly PortRow[] => {
    const previous = mine.snapshot.rows;
    const before = new Map(previous.map((row) => [row.id, row]));
    const rows = [...mine.held.values()]
      .sort((a, b) => a.forward.created - b.forward.created || a.seq - b.seq)
      .map(({ forward }) => {
        const row = rowOf(forward, factsOf(mine, forward));
        const known = before.get(row.id);
        return known !== undefined && sameRow(known, row) ? known : row;
      });
    return rows.length === previous.length && rows.every((row, index) => row === previous[index]) ? previous : rows;
  };

  /** The row of a forward as it reads now, for what a press needs to know of it. A press that names the session its button was drawn for is for that session only: the forward held under the id may be another that took it since. */
  const rowFor = (mine: Live, id: string, session?: number): PortRow | undefined => {
    const held = mine.held.get(id);
    return held === undefined || (session !== undefined && held.incarnation !== session) ? undefined : rowOf(held.forward, factsOf(mine, held.forward));
  };

  /** The snapshot, made again from what is held and the listeners told, now: the same object when it says what it said, and then nobody is told. A frame that waited for it is not wanted any more. */
  const publish = (mine: Live): void => {
    if (live !== mine) {
      return;
    }

    mine.cancelFrame?.();
    mine.cancelFrame = undefined;
    // The mark of a copy is for the address that was copied, on the session it was copied from: a row that changed either has none, and the timer of the mark goes with it.
    if (mine.copied !== undefined && rowFor(mine, mine.copied.id, mine.copied.incarnation)?.address !== mine.copied.address) {
      mine.copied = undefined;
      mine.cancelCopied?.();
      mine.cancelCopied = undefined;
    }

    // What was said since the snapshot was last made is one announcement, in the order it happened: two forwards that closed in one frame are both told.
    if (mine.said.length > 0) {
      mine.announcement = { id: (mine.announcement?.id ?? 0) + 1, text: mine.said.join('. ') };
      mine.said = [];
    }

    const before = mine.snapshot;
    const rows = rowsOf(mine);
    if (before.status === mine.status && before.rows === rows && before.copied === mine.copied?.id && before.announcement === mine.announcement) {
      return;
    }

    mine.snapshot = { status: mine.status, rows, copied: mine.copied?.id, announcement: mine.announcement };
    notify();
  };

  /** What the host said is shown at the window's next frame: the first thing it says asks for the one frame, and the changes of a burst are held until it, so that the burst is one snapshot. */
  const touch = (mine: Live): void => {
    if (live !== mine || mine.cancelFrame !== undefined) {
      return;
    }

    mine.cancelFrame = deps.frame(() => {
      mine.cancelFrame = undefined;
      publish(mine);
    });
  };

  const say = (mine: Live, text: string): void => {
    mine.said.push(text);
  };

  /** A forward is gone: its row, and what the window said of it. When Stop was pressed for it, that is said aloud, once. Whoever calls it says that something changed (`publish`, or `touch` for what the host said). */
  const remove = (mine: Live, id: string, aloud: boolean): void => {
    const row = rowFor(mine, id);
    const waited = mine.stopping.delete(id);
    mine.failures.delete(id);
    if (row !== undefined && aloud && waited) {
      say(mine, SAYS.stopped(row.mapping));
    }

    mine.held.delete(id);
  };

  /**
   * The forward the host states, held. The session that is held already keeps its place and its incarnation; another session that took its id (a plugin that restarts may hand an id out again) is a new row with an incarnation of its own,
   * and nothing the window said of the first (a Stop on its way, why one could not end) is said of it.
   */
  const hold = (mine: Live, forward: Forward): Held => {
    const previous = mine.held.get(forward.id);
    if (previous !== undefined && sameSession(previous.forward, forward)) {
      // A read that says nothing of when the session was made does not undo the time that is known: it is what tells this session from another that takes its id.
      const known = forward.created === 0 && previous.forward.created !== 0 ? { ...forward, created: previous.forward.created } : forward;
      return { forward: known, seq: previous.seq, incarnation: previous.incarnation };
    }

    mine.stopping.delete(forward.id);
    mine.failures.delete(forward.id);
    return { forward, seq: ++mine.seq, incarnation: ++mine.incarnations };
  };

  /** What the host answered: the forwards it holds now. A plugin that is gone keeps the rows it had, and a forward that Stop was pressed for and is not listed any more is closed. */
  const take = (mine: Live, sessions: readonly unknown[] | null | undefined): void => {
    const next = new Map<string, Held>();
    for (const raw of sessions ?? []) {
      const forward = readForward(raw);
      if (forward !== undefined) {
        // A forward the host lists is the proof that its plugin serves: the host reaches only the plugins that run. A plugin that was said stopped, and that may have run again while the events were down, is no longer stopped when the list names
        // forwards of it.
        if (mine.recheck.delete(forward.plugin)) {
          mine.gone.delete(forward.plugin);
        }

        next.set(forward.id, hold(mine, forward));
      }
    }

    for (const [id, held] of mine.held) {
      if (!next.has(id) && held.forward.plugin !== '' && mine.gone.has(held.forward.plugin)) {
        next.set(id, held);
      }
    }

    for (const id of [...mine.stopping]) {
      if (!next.has(id)) {
        remove(mine, id, true);
      }
    }

    for (const id of [...mine.failures.keys()]) {
      if (!next.has(id)) {
        mine.failures.delete(id);
      }
    }

    mine.held = next;
    mine.status = 'ready';
    mine.recheck.clear();
  };

  const landed = (mine: Live, started: number, outcome: Outcome): void => {
    mine.reading = false;
    if (live !== mine) {
      return;
    }

    // An answer that an event overtook may be older than the event: it is not taken, and the host is asked again. A question that was asked while this read was on its way is answered by one more read, after this answer is taken.
    const stale = started !== mine.generation;
    const again = mine.again;
    mine.again = false;
    if (!stale && outcome.ok) {
      take(mine, outcome.sessions);
      // An answer that is taken makes the answers that began before it older than it: a press that asked the host meanwhile asks again.
      mine.generation += 1;
    } else if (!stale && !again && !outcome.ok && mine.status !== 'ready') {
      mine.status = 'failed';
    }

    publish(mine);
    if (stale || again) {
      read(mine);
    }
  };

  function read(mine: Live): void {
    if (live !== mine) {
      return;
    }

    if (mine.reading) {
      mine.again = true;
      return;
    }

    mine.reading = true;
    const started = mine.generation;
    void attempt(() => deps.client.ListAllPortForwardSessions()).then(
      (sessions) => {
        landed(mine, started, { ok: true, sessions });
      },
      () => {
        landed(mine, started, { ok: false });
      },
    );
  }

  const created = (mine: Live, data: unknown): void => {
    const forward = readForward(data);
    if (forward === undefined) {
      return;
    }

    mine.held.set(forward.id, hold(mine, forward));
    mine.generation += 1;
    touch(mine);
  };

  const closed = (mine: Live, data: unknown): void => {
    const forward = readForward(data);
    if (forward === undefined) {
      return;
    }

    // The host says a session was closed: the one the store holds, or an earlier session of its id, which says nothing of the row that has the id now.
    const held = mine.held.get(forward.id);
    if (held !== undefined && !sameSession(held.forward, forward)) {
      return;
    }

    mine.generation += 1;
    remove(mine, forward.id, true);
    touch(mine);
  };

  /** The host says a plugin stopped: what it held stopped with it. A Stop that waited for it will not end, so the row stops waiting. The list is read again, which will no longer name them. */
  const unloaded = (mine: Live, data: unknown): void => {
    const stopped = readUnloaded(data);
    if (stopped === undefined) {
      return;
    }

    mine.gone.add(stopped.id);
    mine.generation += 1;
    for (const [id, { forward }] of mine.held) {
      if (forward.plugin === stopped.id) {
        mine.stopping.delete(id);
      }
    }

    touch(mine);
    read(mine);
  };

  /** The host says a plugin runs again: what it held before is gone for good (its process is a new one), so its rows go, and the list says what the new one holds. */
  const running = (mine: Live, data: unknown): void => {
    const plugin = readRunning(data);
    if (plugin === undefined || !mine.gone.delete(plugin)) {
      return;
    }

    for (const [id, { forward }] of [...mine.held]) {
      if (forward.plugin === plugin) {
        mine.held.delete(id);
        mine.stopping.delete(id);
        mine.failures.delete(id);
      }
    }

    mine.generation += 1;
    touch(mine);
    read(mine);
  };

  const attach = (): void => {
    const mine: Live = {
      status: 'loading',
      held: new Map(),
      gone: new Set(),
      recheck: new Set(),
      stopping: new Set(),
      failures: new Map(),
      copied: undefined,
      announcement: undefined,
      said: [],
      seq: 0,
      incarnations: 0,
      generation: 0,
      reading: false,
      again: false,
      cancelCopied: undefined,
      cancelFrame: undefined,
      off: () => undefined,
      snapshot: IDLE,
    };
    live = mine;
    // The handlers first, then the read: what happens while the host answers is not lost. Each is kept as it is registered, so that a registration that fails takes back those that were made, and the store is not left listening.
    const stops: Array<(() => void) | undefined> = [];
    mine.off = () => {
      for (const stop of stops) {
        stop?.();
      }
    };

    const registrations: ReadonlyArray<() => (() => void) | undefined> = [
      () =>
        deps.events.On(CREATED_EVENT, ({ data }) => {
          created(mine, data);
        }),
      () =>
        deps.events.On(CLOSED_EVENT, ({ data }) => {
          closed(mine, data);
        }),
      () =>
        deps.events.On(UNLOADED_EVENT, ({ data }) => {
          unloaded(mine, data);
        }),
      () =>
        deps.events.On(STATE_CHANGE_EVENT, ({ data }) => {
          running(mine, data);
        }),
      () =>
        deps.events.On(CONNECTION_EVENT, () => {
          // A read that began before the connection changed may say what the connection ended: its answer is older than the event, and the read that follows says what is so.
          mine.generation += 1;
          read(mine);
        }),
      () =>
        deps.names?.subscribe(() => {
          touch(mine);
        }),
      () =>
        deps.reconnect(() => {
          // What the host did while the events connection was down was not told, and an answer that began before it is not the truth either: the read that follows says what is so. What was said of the plugins that stopped may have
          // been overtaken the same way (one may have run again), and the list decides that.
          mine.generation += 1;
          for (const plugin of mine.gone) {
            mine.recheck.add(plugin);
          }

          read(mine);
        }),
      () =>
        deps.wake(() => {
          read(mine);
        }),
    ];
    try {
      for (const register of registrations) {
        stops.push(register());
      }
    } catch (error) {
      mine.off();
      live = undefined;
      throw error;
    }

    read(mine);
  };

  const detach = (): void => {
    const mine = live;
    live = undefined;
    mine?.off();
    mine?.cancelCopied?.();
    mine?.cancelFrame?.();
  };

  const stop = (id: string, session?: number): void => {
    const mine = live;
    const row = mine === undefined ? undefined : rowFor(mine, id, session);
    if (mine === undefined || row === undefined || availabilityOf(row).stop !== undefined) {
      return;
    }

    const incarnation = mine.held.get(id)?.incarnation;
    mine.stopping.add(id);
    mine.failures.delete(id);
    publish(mine);
    void attempt(() => deps.client.ClosePortForwardSession(id)).then(
      () => {
        // The host's answer is its word that it closed the forward; its event may be on its way or may never come. An answer about a session that another took the id of says nothing of the row that has it now.
        if (live === mine && mine.held.get(id)?.incarnation === incarnation) {
          mine.generation += 1;
          remove(mine, id, true);
          publish(mine);
        }
      },
      (error: unknown) => {
        if (live === mine && mine.held.get(id)?.incarnation === incarnation) {
          refused(mine, id, error);
        }
      },
    );
  };

  /** The host would not end a forward: it goes back to what it was, and says why in plain words. A forward the host does not have is closed: there is nothing to refuse. */
  const refused = (mine: Live, id: string, error: unknown): void => {
    const why = deps.explain(error);
    if (why.gone) {
      mine.generation += 1;
      remove(mine, id, true);
      publish(mine);
      return;
    }

    const row = rowFor(mine, id);
    if (row === undefined || !mine.stopping.delete(id)) {
      return;
    }

    const detail = why.text.trim();
    mine.failures.set(id, detail === '' ? 'Couldn\'t stop it.' : `Couldn't stop it. ${detail}`);
    say(mine, SAYS.stopFailed(row.mapping));
    publish(mine);
  };

  /**
   * The press is the moment the person trusts the row: the host is asked for the list once more, and what it says is taken, so that the row shows it. Open in browser asks first and acts after (the runtime's call needs no user gesture); Copy
   * address has already written the address it knew, inside the press (a window that is WebKit lets a page write to the clipboard only while the gesture lasts), and what the host says is what is told. Answers the row as the host then says it
   * when the forward is still the session that was pressed and runs, and `undefined` when it is not: it failed, stopped, is gone, or another session has its id. An answer that came after an event, or after another answer was taken, may be
   * older than it: it is not taken, and the host is asked again (a few times, and then the press is not confirmed). A host that cannot be asked leaves what the events hold, when that is still the session that was pressed and runs.
   */
  const confirmed = async (mine: Live, pressed: PortRow, incarnation: number): Promise<PortRow | undefined> => {
    for (let tries = 0; tries < CONFIRMATIONS; tries += 1) {
      const started = mine.generation;
      let sessions: readonly unknown[] | null | undefined;
      try {
        sessions = await deps.client.ListAllPortForwardSessions();
      } catch {
        const kept = live === mine ? rowFor(mine, pressed.id, incarnation) : undefined;
        return kept?.state === 'running' ? kept : undefined;
      }

      if (live !== mine) {
        return undefined;
      }

      if (started === mine.generation) {
        take(mine, sessions);
        // Whatever read began before this answer is older than it.
        mine.generation += 1;
        publish(mine);
        const row = rowFor(mine, pressed.id, incarnation);
        return row?.state === 'running' ? row : undefined;
      }
    }

    return undefined;
  };

  const open = (id: string, session?: number): void => {
    const mine = live;
    const held = mine?.held.get(id);
    const row = mine === undefined ? undefined : rowFor(mine, id, session);
    if (mine === undefined || held === undefined || row === undefined || availabilityOf(row).open !== undefined) {
      return;
    }

    void confirmed(mine, row, held.incarnation).then((now) => {
      if (live !== mine) {
        return;
      }

      if (now === undefined || availabilityOf(now).open !== undefined) {
        say(mine, SAYS.notOpened);
        publish(mine);
        return;
      }

      const url = browserUrlOf(now);
      void attempt(() => deps.openExternal(url)).catch((error: unknown) => {
        console.warn('[ports] the address could not be opened', error);
        if (live === mine) {
          say(mine, SAYS.openFailed(now.address));
          publish(mine);
        }
      });
    });
  };

  /**
   * A press of Copy address is told when the clipboard has answered and so has the host (the address was written inside the press, before the host was heard). A write that failed is said, and nothing else. A forward that is not running any
   * more is said to have been copied all the same, with no check mark. A forward that runs gets its row marked for two seconds, by the one timer there is, and the words; the mark is for the address that was copied, so a row that runs at
   * another address has none, and the first write is kept: nothing more is said or written.
   */
  const copied = (mine: Live, press: { readonly id: string; readonly incarnation: number; readonly address: string }, done: boolean, now: PortRow | undefined): void => {
    if (!done) {
      say(mine, SAYS.copyFailed);
    } else if (now === undefined || availabilityOf(now).copy !== undefined) {
      say(mine, SAYS.copiedNotRunning);
    } else {
      if (now.address === press.address) {
        mine.cancelCopied?.();
        mine.copied = press;
        mine.cancelCopied = deps.schedule(() => {
          mine.cancelCopied = undefined;
          mine.copied = undefined;
          publish(mine);
        }, COPIED_MS);
      }

      say(mine, SAYS.copied);
    }

    publish(mine);
  };

  const copy = (id: string, session?: number): void => {
    const mine = live;
    const held = mine?.held.get(id);
    const row = mine === undefined ? undefined : rowFor(mine, id, session);
    if (mine === undefined || held === undefined || row === undefined || availabilityOf(row).copy !== undefined) {
      return;
    }

    const press = { id, incarnation: held.incarnation, address: row.address };
    // The address is written now, inside the press: a window that is WebKit lets a page write to the clipboard only while the user's gesture lasts, and the host's answer comes after it. The host is asked meanwhile.
    const written = attempt(() => deps.copy(press.address)).then(
      (done) => done,
      () => false,
    );
    void Promise.all([written, confirmed(mine, row, held.incarnation)]).then(([done, now]) => {
      if (live === mine) {
        copied(mine, press, done, now);
      }
    });
  };

  return {
    getSnapshot: () => live?.snapshot ?? IDLE,
    subscribe: (listener) => {
      // Each subscription is an entry of its own, whatever function it is given: the same function subscribed twice is two subscriptions, and the first of them to leave does not take the store from the second.
      const subscription = (): void => {
        listener();
      };

      listeners.add(subscription);
      if (listeners.size === 1) {
        try {
          attach();
        } catch (error) {
          listeners.delete(subscription);
          throw error;
        }
      }

      return () => {
        if (listeners.delete(subscription) && listeners.size === 0) {
          detach();
        }
      };
    },
    retry: () => {
      const mine = live;
      if (mine !== undefined) {
        mine.status = 'loading';
        publish(mine);
        read(mine);
      }
    },
    stop,
    open,
    copy,
  };
}
