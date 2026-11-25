// The real plugin host with NO plugin and a FAKE HOST of port forwards, for the Ports probe (ports.mjs): `PluginHost` is the product's own and the Ports tool in it is the product's own (the registry, the singleton body the panel draws only
// while the tool is on screen, the store, the table, the row menu, the clipboard the Logs and the Terminal copy with); only the host behind it is invented: the networker's two calls, the events, the way to open an address and the names
// of connections, answered by a page that keeps the forwards it was given. A second HTML entry that the probe builds on its own; `vite build` of the channel never reaches it.
//
// THE PROBE DRIVES THE FAKE HOST from the page: `window.__ports` (below). What the host lists is `set`; how a read answers is `reads.mode` (`ok`: at once, `hold`: the probe answers each read, `fail`: the next `reads.fails` reads
// are refused); how a close answers is `closes.mode` (`ok` at once, `hold` until the probe answers it, `refuse`: the host would not, `gone`: the host has no such forward).
// `emit` tells every handler of an event, as the runtime does, and `flood` tells many, each in a task of its own, as the runtime's socket does. The calls the product made are in `reads.listed`, `closes.ids` and `opened`; what it
// listens to is `handlers`, `on()` and `off()`; the names of the connections are `names`. The page's own commits are `window.__commits` (React's Profiler: the probe reads them in the development build, where the Profiler reports).
// A session carries `local_host` only when the probe gives one: the SDK's session does not, and the tool says what the producer states and makes no host up.
// The events connection coming back after a gap is `reconnected.fire()`, and how many listen for it is `reconnected.listeners()`; how many listen for the window coming back to a person is `woken.listeners()` (the window's own events are the
// page's to dispatch: a `focus` of the window, a `visibilitychange` of the document).
//
// Query parameters of the page:
//   ?read=hold|fail   how the first reads answer (`ok` by default); `?fails=N` is how many of them are refused with `?read=fail` (1 by default)
//   ?close=<mode>     how the closes answer (`closes.mode`)
//   ?control=<name>   the negative controls that perturb the fake host or the page, each for the assertion of the probe it is named for:
//                     open-twice      the way to open an address records each call twice (`ports.open`)
//                     open-wrong      the way to open an address is given the address with another name for this computer (`ports.open`)
//                     close-twice     the host's close records each call twice (`ports.stop`)
//                     close-other     the host's close is asked for the first forward, whichever Stop was pressed (`ports.stop`)
//                     names-ids       the names of the connections are their ids (`ports.names`)
//                     hidden-leak     the events the tool listens to are never let go of (`ports.hidden`)
//                     events-forever  the tool is also listened to by a page that never lets go of a second listener of the connections' names (`ports.hidden`)
//                     list-eager      the page asks the host for the list before the tool is shown (`ports.hidden`)
//                     idle-commits    a component renders ten times a second for as long as the page lives (`ports.idle`)
//                     flood-sync      the window's next frame is given at once and not at the next frame, as a window that drew for each message would (`ports.flood`)
//                     reconnect-ignored  the page never tells the tool that its events connection came back (`ports.reconnect`)
//                     wake-leak       what the tool listens to the window coming back with is never let go of (`ports.wake`)
//                     confirm-stale   the host answers every read with the list it gave the first time, so a press that reads the list first reads what the host said before (`ports.confirm`)
import '@omniviewdev/kit/styles.css';
import '../../global.css';
import { isIconName, MenuHost, ThemeProvider, TooltipHost } from '@omniviewdev/kit';
import { Profiler, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { PluginSource } from '../../plugins/host/contributions';
import { PluginHost } from '../../plugins/host/PluginHost';
import type { PluginEntry } from '../../plugins/host/pluginStore';
import type { PortsDeps } from '../panel/ports';
import { productionPorts } from '../panel/ports/api';

const params = new URLSearchParams(window.location.search);
const control = params.get('control');

type Handler = (event: { readonly data?: unknown }) => void;
type Read = { readonly resolve: (sessions: readonly unknown[]) => void; readonly reject: (error: unknown) => void };
type Close = { readonly id: string; readonly resolve: () => void; readonly reject: (error: unknown) => void };

/** The error the host answers for a call it refuses: the typed envelope the runtime reads (`parseAppError`), whose `detail` is the sentence the row says. */
const refusal = (type: string, title: string, detail: string, status: number): Error => new Error(JSON.stringify({ type, title, status, detail, code: 'FAILED' }));
const SESSION_NOT_FOUND = 'omniview:session/not-found';

/** The id of a session as the runtime hands it over, or an empty word for a value that is not one. */
const idOf = (session: unknown): string => (typeof session === 'object' && session !== null && 'id' in session && typeof session.id === 'string' ? session.id : '');

let sessions: unknown[] = [];
const handlers = new Map<string, Set<Handler>>();
let on = 0;
let off = 0;
const held: Read[] = [];
const reads = { mode: params.get('read') ?? 'ok', fails: Number(params.get('fails') ?? 1), listed: 0 };
const heldCloses: Close[] = [];
const closes = { mode: params.get('close') ?? 'ok', ids: [] as string[] };
const opened: string[] = [];
const known = new Map<string, string>();
const heard = new Set<() => void>();
const reconnecting = new Set<() => void>();
let waking = 0;
let stale: unknown[] | undefined;
const commits: Array<{ phase: string; actualDuration: number }> = [];

/** The ids of the connections, as the page knows them, for the names a row says. `?control=names-ids` says the id for every name. */
const names: NonNullable<PortsDeps['names']> = {
  of: (plugin, connection) => (control === 'names-ids' ? connection : known.get(JSON.stringify([plugin, connection]))),
  subscribe: (listener) => {
    heard.add(listener);
    return () => {
      if (control !== 'events-forever') {
        heard.delete(listener);
      }
    };
  },
};

/** The page's events connection coming back after a gap: the probe tells it (`window.__ports.reconnected.fire()`), as the runtime's socket does when it reconnects. `?control=reconnect-ignored` is a page that never tells. */
const reconnect: PortsDeps['reconnect'] = (listener) => {
  reconnecting.add(listener);
  return () => {
    reconnecting.delete(listener);
  };
};

/** The window coming back to a person: the product's own (the window's `focus` and the page's `visibilitychange`), counted, so that the probe can say how many listen. `?control=wake-leak` never lets go of what it listens with. */
const wake: PortsDeps['wake'] = (listener) => {
  waking += 1;
  const stop = productionPorts.wake(listener);
  return () => {
    if (control !== 'wake-leak') {
      waking -= 1;
      stop();
    }
  };
};

const client: PortsDeps['client'] = {
  ListAllPortForwardSessions: async () => {
    reads.listed += 1;
    if (reads.mode === 'hold') {
      return new Promise<readonly unknown[]>((resolve, reject) => {
        held.push({ resolve, reject });
      });
    }

    if (reads.mode === 'fail' && reads.fails > 0) {
      reads.fails -= 1;
      throw new Error('the host did not answer');
    }

    if (control === 'confirm-stale') {
      // Every answer is the first one: a read the tool makes before it acts is told what the host said before.
      stale ??= [...sessions];
      return Promise.resolve([...stale]);
    }

    return Promise.resolve([...sessions]);
  },
  ClosePortForwardSession: async (id) => {
    closes.ids.push(control === 'close-other' ? idOf(sessions[0]) : id);
    if (control === 'close-twice') {
      closes.ids.push(id);
    }

    if (closes.mode === 'hold') {
      return new Promise<unknown>((resolve, reject) => {
        heldCloses.push({
          id,
          resolve: () => {
            resolve(null);
          },
          reject,
        });
      });
    }

    if (closes.mode === 'refuse') {
      throw refusal('omniview:plugin/call-failed', 'The plugin refused', 'The plugin is busy with another forward.', 500);
    }

    if (closes.mode === 'gone') {
      // The host has no such forward: it does not list it either.
      sessions = sessions.filter((session) => idOf(session) !== id);
      throw refusal(SESSION_NOT_FOUND, 'Session not found', `Session ${id} not found`, 404);
    }

    sessions = sessions.filter((session) => idOf(session) !== id);
    return Promise.resolve(null);
  },
};

const events: PortsDeps['events'] = {
  On: (name, listener) => {
    on += 1;
    const set = handlers.get(name) ?? new Set<Handler>();
    set.add(listener);
    handlers.set(name, set);
    return () => {
      off += 1;
      if (control !== 'hidden-leak') {
        set.delete(listener);
      }
    };
  },
};

const emit = (name: string, data?: unknown): void => {
  for (const handler of [...(handlers.get(name) ?? [])]) {
    handler({ data });
  }
};

const count = (name?: string): number => (name === undefined ? [...handlers.values()].reduce((total, set) => total + set.size, 0) : (handlers.get(name)?.size ?? 0));

/** The way to open an address outside the window: the probe reads what it was asked for. `?control=open-twice` records each call twice, `open-wrong` names this computer another way. */
const openExternal: PortsDeps['openExternal'] = async (url) => {
  const given = control === 'open-wrong' ? url.replace('127.0.0.1', 'localhost') : url;
  opened.push(given);
  if (control === 'open-twice') {
    opened.push(given);
  }

  return Promise.resolve();
};

/** Tells `count` events, each in a task of its own (a message channel: the task after this one, with no clock and no clamp), as the runtime's socket does for messages that arrive together; then the number of tasks that ran. */
async function flood(name: string, make: (index: number) => unknown, total: number): Promise<number> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let done = 0;
    channel.port1.onmessage = () => {
      emit(name, make(done));
      done += 1;
      if (done < total) {
        channel.port2.postMessage(null);
      } else {
        channel.port1.close();
        resolve(done);
      }
    };

    channel.port2.postMessage(null);
  });
}

Object.assign(window, {
  __commits: commits,
  __ports: {
    /** What the host lists from now on. */
    set: (next: readonly unknown[]): void => {
      sessions = [...next];
    },
    sessions: (): readonly unknown[] => sessions,
    reads: {
      get mode(): string {
        return reads.mode;
      },
      set mode(next: string) {
        reads.mode = next;
      },
      get fails(): number {
        return reads.fails;
      },
      set fails(next: number) {
        reads.fails = next;
      },
      listed: (): number => reads.listed,
      held: (): number => held.length,
      /** Answers the oldest read that waits: with what the host lists, or with the sessions given. */
      answer: (answer?: readonly unknown[]): void => {
        held.shift()?.resolve(answer ?? [...sessions]);
      },
      fail: (): void => {
        held.shift()?.reject(new Error('the host did not answer'));
      },
    },
    closes: {
      get mode(): string {
        return closes.mode;
      },
      set mode(next: string) {
        closes.mode = next;
      },
      ids: (): readonly string[] => [...closes.ids],
      held: (): number => heldCloses.length,
      /** Answers the oldest close that waits, or the one of the forward `id`: the host ended the forward (it is no longer listed), or refused. */
      answer: (how: 'ok' | 'refuse' = 'ok', id?: string): void => {
        const at = id === undefined ? 0 : heldCloses.findIndex((close) => close.id === id);
        const close = at < 0 ? undefined : heldCloses.splice(at, 1)[0];
        if (close === undefined) {
          return;
        }

        if (how === 'refuse') {
          close.reject(refusal('omniview:plugin/call-failed', 'The plugin refused', 'The plugin is busy with another forward.', 500));
          return;
        }

        sessions = sessions.filter((session) => idOf(session) !== close.id);
        close.resolve();
      },
    },
    emit,
    /** Tells `total` events of one name, each a session of the id `<prefix><n>` made by `make`, in a task of its own each: the answer is the number of tasks that ran. */
    flood: async (name: string, prefix: string, total: number, make: Record<string, unknown>): Promise<number> => flood(name, (index) => ({ ...make, id: `${prefix}${String(index)}` }), total),
    handlers: count,
    on: (): number => on,
    off: (): number => off,
    opened,
    names: {
      set: (plugin: string, connection: string, name: string | undefined): void => {
        const key = JSON.stringify([plugin, connection]);
        if (name === undefined) {
          known.delete(key);
        } else {
          known.set(key, name);
        }

        for (const listener of [...heard]) {
          listener();
        }
      },
      listeners: (): number => heard.size,
    },
    /** The events connection coming back after a gap: tells everything that listens to it (`?control=reconnect-ignored`: nothing). */
    reconnected: {
      fire: (): void => {
        if (control === 'reconnect-ignored') {
          return;
        }

        for (const listener of [...reconnecting]) {
          listener();
        }
      },
      listeners: (): number => reconnecting.size,
    },
    /** How many listen for the window coming back to a person. */
    woken: { listeners: (): number => waking },
    /** Whether the registry draws a glyph of this name: the product keeps to the glyph it wants where the registry has it, and to the nearest it has where it does not. */
    hasGlyph: (name: string): boolean => isIconName(name),
  },
});

/** `?control=idle-commits`: a component that renders ten times a second for as long as the page lives, as a view that kept a clock would: a page that is at rest commits nothing. */
function IdleTicker() {
  const [ticks, setTicks] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setTicks((n) => n + 1);
    }, 100);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return <span hidden>{ticks}</span>;
}

/**
 * `?control=flood-sync`: a window whose next frame is the end of the task that asked: what the store asks to be shown at the next frame is shown before the next event, so each event of a flood is a commit of its own. It is a microtask and not a call of
 * `run` at once: the store keeps what `frame` answers, to cancel the frame, and a call at once clears that before it was kept, so the store would ask for no other frame and the table would freeze after the first event (the control would then fail for the
 * rows it lacks and not for the commits it makes).
 */
const atOnce: PortsDeps['frame'] = (run) => {
  let wanted = true;
  queueMicrotask(() => {
    if (wanted) {
      run();
    }
  });
  return () => {
    wanted = false;
  };
};

const NONE: readonly PluginEntry[] = [];
const plugins: PluginSource = { getSnapshot: () => NONE, subscribe: () => () => undefined };

const root = document.getElementById('root');

if (control === 'list-eager') {
  // A page that reads the list before the tool is shown: what a window that asked for it on mount would do.
  void client.ListAllPortForwardSessions();
}

if (control === 'events-forever') {
  // A listener of the names that is never let go of, and so is never counted as gone.
  names.subscribe(() => undefined);
}

if (root !== null) {
  // The window's one menu host and its one tooltip, as the app's entry mounts them (ui-next/main.tsx): the row's menu opens on the first and a tip is drawn by the second, and without them a trigger is inert and a tip is never said.
  createRoot(root).render(
    <ThemeProvider>
      <MenuHost>
        <Profiler
          id="host"
          onRender={(_id, phase, actualDuration) => {
            commits.push({ phase, actualDuration });
          }}
        >
          {control === 'idle-commits' ? <IdleTicker /> : null}
          <PluginHost
            plugins={plugins}
            inventory="ready"
            link={{ plugin: undefined, page: undefined, connection: undefined, params: {} }}
            onRetry={() => undefined}
            onRetryInventory={() => undefined}
            ports={{ client, events, openExternal, names, reconnect, wake, ...(control === 'flood-sync' ? { frame: atOnce } : {}) }}
          />
        </Profiler>
      </MenuHost>
      <TooltipHost />
    </ThemeProvider>,
  );
}
