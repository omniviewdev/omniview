import type { AppError } from '@omniviewdev/runtime/ui/v1';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionsApi, StartStatus, StateRecord } from './api';
import { createConnectionsStore, type ConnectionsStore, type ConnectionsStoreOptions } from './store';
import type { ConnectOutcome, ConnectionState } from './types';

// The connection store (store.ts) over a fake host: every call it makes is a promise the test settles, so the order in which the host answers is the test's. No runtime, no host, no timers except where a test says so.

type Answer = Readonly<Record<string, readonly StateRecord[]>>;
type Deferred<T> = { readonly promise: Promise<T>; readonly resolve: (value: T) => void; readonly reject: (reason: unknown) => void };
type Start = Deferred<StartStatus> & { readonly plugin: string; readonly key: string };
type Timer = { readonly run: () => void; readonly ms: number; isCancelled: boolean };

function deferred<T>(): Deferred<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  return { promise, resolve, reject };
}

function fakeApi(overrides: Partial<ConnectionsApi> = {}) {
  const reads: Array<Deferred<Answer>> = [];
  const starts: Start[] = [];
  const statusListeners = new Set<() => void>();
  const everyStatusListener: Array<() => void> = [];
  const syncListeners = new Map<string, Set<() => void>>();
  const api: ConnectionsApi = {
    states: async () => {
      const read = deferred<Answer>();
      reads.push(read);
      return read.promise;
    },
    start: async (plugin, key) => {
      const start = { ...deferred<StartStatus>(), plugin, key };
      starts.push(start);
      return start.promise;
    },
    onStatus: (listener) => {
      statusListeners.add(listener);
      everyStatusListener.push(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    onSync: (plugin, listener) => {
      const set = syncListeners.get(plugin) ?? new Set<() => void>();
      syncListeners.set(plugin, set);
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    ...overrides,
  };
  return {
    api,
    reads,
    starts,
    everyStatusListener,
    emitStatus: () => {
      for (const listener of [...statusListeners]) {
        listener();
      }
    },
    emitSync: (plugin: string) => {
      for (const listener of [...(syncListeners.get(plugin) ?? [])]) {
        listener();
      }
    },
    /** What the window follows now: how many status handlers, and the plugins whose sync has a handler. */
    following: () => ({ status: statusListeners.size, sync: [...syncListeners].filter(([, set]) => set.size > 0).map(([plugin]) => plugin).sort() }),
  };
}

type World = ReturnType<typeof fakeApi> & { readonly store: ConnectionsStore; readonly timers: Timer[] };

function build(options: ConnectionsStoreOptions = {}, overrides: Partial<ConnectionsApi> = {}): World {
  const fake = fakeApi(overrides);
  const timers: Timer[] = [];
  const schedule = (run: () => void, ms: number): (() => void) => {
    const timer: Timer = { run, ms, isCancelled: false };
    timers.push(timer);
    return () => {
      timer.isCancelled = true;
    };
  };

  return { ...fake, timers, store: createConnectionsStore(fake.api, { schedule, ...options }) };
}

const record = (id: string, name: string | undefined, readiness = 'CONNECTED', readinessError?: AppError): StateRecord => ({
  connection: name === undefined ? { id } : { id, name },
  readiness,
  ...(readinessError === undefined ? {} : { readinessError }),
});

/** The envelope as the host sends it, and as Wails delivers it. */
const envelope = (patch: Partial<AppError>): AppError => ({ type: 'omniview:internal', title: 'Operation failed', status: 500, detail: 'The operation could not be completed.', ...patch });
const wails = (body: AppError): Error => Object.assign(new Error(JSON.stringify(body)), { cause: body });
const UNAUTHORIZED = envelope({ type: 'omniview:resource/unauthorized', title: 'Authentication required', status: 401, detail: 'The provider requires authentication.', code: 'UNAUTHORIZED', recovery: 'none' });
const FORBIDDEN = envelope({ type: 'omniview:resource/forbidden', title: 'Access denied', status: 403, detail: 'The role may not connect.', code: 'FORBIDDEN', recovery: 'none' });
const NOT_RESPONDING = envelope({ type: 'omniview:connection/failed', title: 'Source unavailable', status: 503, detail: 'The server refused the connection.', code: 'UNAVAILABLE', recovery: 'reconnect' });
const BROKEN = envelope({ detail: 'The plugin could not open it.' });

/**
 * What the host's list can say of a connection whose start failed: the readiness FAILED with its error (the host's public form, `readinessError`), the state that error is and the host's own line (none when the host gave no
 * error). The store keeps nothing of its own about a failed start: the connection is what the last list said, whoever made the start.
 */
const HOST_SAYS: Array<[name: string, error: AppError | undefined, state: ConnectionState, reason: string | undefined]> = [
  ['a sign-in is needed', UNAUTHORIZED, 'unauthorized', 'The provider requires authentication.'],
  ['access is denied', FORBIDDEN, 'forbidden', 'The role may not connect.'],
  ['the server does not answer', NOT_RESPONDING, 'unreachable', 'The server refused the connection.'],
  ['the start failed and the host did not classify it', BROKEN, 'failed', 'The plugin could not open it.'],
  ['the start failed and the host gave no error', undefined, 'failed', undefined],
];

/** Lets every promise the store is waiting on run; a promise that is still pending after it is waiting for the test. */
const flush = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
};

/** Whether a promise has settled, and with what, without waiting for it. */
function watch<T>(promise: Promise<T>): { readonly isDone: () => boolean; readonly value: () => T | undefined } {
  let isFinished = false;
  let result: T | undefined;
  void promise.then((value) => {
    isFinished = true;
    result = value;
  });
  return { isDone: () => isFinished, value: () => result };
}

/** Reads the host once and answers it. */
async function loadedWith(world: World, answer: Answer): Promise<void> {
  const done = world.store.refresh();
  world.reads[world.reads.length - 1].resolve(answer);
  await done;
}

const connection = (world: World, plugin: string, key: string) => world.store.getSnapshot().connections.find((entry) => entry.plugin === plugin && entry.key === key);
const stateOf = (world: World, plugin: string, key: string): ConnectionState | undefined => connection(world, plugin, key)?.state;
const keys = (world: World): string[] => world.store.getSnapshot().connections.map((entry) => `${entry.plugin}/${entry.key}`);

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the list', () => {
  it('is empty, not loaded and not failed before anything was read', () => {
    expect(build().store.getSnapshot()).toEqual({ loaded: false, failed: false, connections: [] });
  });

  it('reads the host when asked, and lists what it said once the read has finished', async () => {
    const world = build();

    const done = world.store.refresh();
    expect(world.reads).toHaveLength(1);
    expect(world.store.getSnapshot().loaded).toBe(false);
    world.reads[0].resolve({ acme: [record('main', 'Main'), record('spare', 'Spare', 'DISCONNECTED')] });
    await done;

    expect(world.store.getSnapshot()).toEqual({
      loaded: true,
      failed: false,
      connections: [
        { plugin: 'acme', key: 'main', name: 'Main', state: 'connected', reason: undefined },
        { plugin: 'acme', key: 'spare', name: 'Spare', state: 'disconnected', reason: undefined },
      ],
    });
  });

  it('is loaded with nothing in it when the host has no connections', async () => {
    const world = build();

    await loadedWith(world, {});

    expect(world.store.getSnapshot()).toEqual({ loaded: true, failed: false, connections: [] });
  });

  it('says each connection\'s state as the host\'s readiness says it, with the host\'s own line for a failure it classified', async () => {
    const world = build();

    await loadedWith(world, {
      acme: [
        record('a', 'A', 'CONNECTED'),
        record('b', 'B', 'PENDING'),
        record('c', 'C', 'DISCONNECTED'),
        record('d', 'D', 'UNKNOWN'),
        record('e', 'E', 'FAILED'),
        record('f', 'F', 'FAILED', UNAUTHORIZED),
        record('g', 'G', 'FAILED', FORBIDDEN),
        record('h', 'H', 'FAILED', NOT_RESPONDING),
      ],
    });

    expect(world.store.getSnapshot().connections.map((entry) => [entry.key, entry.state, entry.reason])).toEqual([
      ['a', 'connected', undefined],
      ['b', 'connecting', undefined],
      ['c', 'disconnected', undefined],
      ['d', 'disconnected', undefined],
      ['e', 'failed', undefined],
      ['f', 'unauthorized', 'The provider requires authentication.'],
      ['g', 'forbidden', 'The role may not connect.'],
      ['h', 'unreachable', 'The server refused the connection.'],
    ]);
  });

  it('sorts by plugin, then name (numbers by value, case ignored), then key, whatever order the host answered in', async () => {
    const world = build();

    await loadedWith(world, {
      west: [record('z', 'Zulu'), record('n10', 'Item 10'), record('n2', 'Item 2'), record('t2', 'Same'), record('t1', 'Same')],
      acme: [record('k1', 'Beta'), record('k2', 'alpha'), record('k3', 'Alpha'), record('k4', undefined)],
    });

    expect(keys(world)).toEqual(['acme/k2', 'acme/k3', 'acme/k1', 'acme/k4', 'west/n2', 'west/n10', 'west/t1', 'west/t2', 'west/z']);
  });

  it('orders two connections that differ only in case the same way whatever order the host gave them in', async () => {
    const first = build();
    const second = build();

    await loadedWith(first, { acme: [record('k', 'Same'), record('K', 'Same')] });
    await loadedWith(second, { acme: [record('K', 'Same'), record('k', 'Same')] });

    expect(keys(first)).toEqual(keys(second));
  });

  it('says a name trimmed, and "Unnamed connection" when there is none: never the key', async () => {
    const world = build();

    await loadedWith(world, { acme: [record('k1', '  Main  '), record('k2', undefined), record('k3', '   ')] });

    expect(world.store.getSnapshot().connections.map((entry) => entry.name)).toEqual(['Main', 'Unnamed connection', 'Unnamed connection']);
  });

  it('keeps the connections of two plugins that use the same key apart', async () => {
    const world = build();
    await loadedWith(world, { acme: [record('main', 'Main', 'DISCONNECTED')], west: [record('main', 'Main', 'DISCONNECTED')] });

    void world.store.connect('west', 'main');

    expect(stateOf(world, 'west', 'main')).toBe('connecting');
    expect(stateOf(world, 'acme', 'main')).toBe('disconnected');
  });
});

describe('the snapshot', () => {
  it('is the same object, and tells nobody, after a read that says what the last one said', async () => {
    const world = build();
    await loadedWith(world, { acme: [record('main', 'Main'), record('spare', 'Spare', 'DISCONNECTED')] });
    const before = world.store.getSnapshot();
    const listener = vi.fn();
    world.store.subscribe(listener);

    await loadedWith(world, { acme: [record('spare', 'Spare', 'DISCONNECTED'), record('main', 'Main')] });

    expect(world.store.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('is a new object, and tells the listeners once, when something changed; the connections that did not change are the same objects', async () => {
    const world = build();
    await loadedWith(world, { acme: [record('main', 'Main'), record('spare', 'Spare', 'DISCONNECTED')] });
    const before = world.store.getSnapshot();
    const listener = vi.fn();
    const stop = world.store.subscribe(listener);

    await loadedWith(world, { acme: [record('main', 'Main'), record('spare', 'Spare', 'CONNECTED')] });

    const after = world.store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.connections[0]).toBe(before.connections[0]);
    expect(after.connections[1]).not.toBe(before.connections[1]);
    expect(after.connections[1]?.state).toBe('connected');
    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    await loadedWith(world, {});
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not let a listener that throws stop the others, nor turn a read into a rejection', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const world = build();
    world.store.subscribe(() => {
      throw new Error('a listener that fails');
    });
    const heard = vi.fn();
    world.store.subscribe(heard);

    await expect(loadedWith(world, { acme: [record('main', 'Main')] })).resolves.toBeUndefined();

    expect(heard).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalled();
  });
});

describe('a read', () => {
  it('that fails keeps the list the last read that worked said, and says it failed; the next that works says it did not', async () => {
    const world = build();
    await loadedWith(world, { acme: [record('main', 'Main')] });
    const connections = world.store.getSnapshot().connections;

    const failing = world.store.refresh();
    world.reads[1].reject(new Error('the host is gone'));
    await failing;

    expect(world.store.getSnapshot()).toEqual({ loaded: true, failed: true, connections });
    expect(world.store.getSnapshot().connections).toBe(connections);

    await loadedWith(world, { acme: [record('main', 'Main')] });
    expect(world.store.getSnapshot().failed).toBe(false);
  });

  it('that fails first is loaded, failed and empty', async () => {
    const world = build();

    const failing = world.store.refresh();
    world.reads[0].reject(new Error('the host is gone'));
    await failing;

    expect(world.store.getSnapshot()).toEqual({ loaded: true, failed: true, connections: [] });
  });

  it('is a failure, never a rejection, when the host throws instead of rejecting or answers what is not a list', async () => {
    const throwing = build({}, {
      states: () => {
        throw new Error('no runtime');
      },
    });
    await expect(throwing.store.refresh()).resolves.toBeUndefined();
    expect(throwing.store.getSnapshot()).toEqual({ loaded: true, failed: true, connections: [] });

    const nothing = build();
    const done = nothing.store.refresh();
    nothing.reads[0].resolve(undefined as unknown as Answer);
    await expect(done).resolves.toBeUndefined();
    expect(nothing.store.getSnapshot().failed).toBe(true);
  });

  it('is shared by the calls that overlap, and a call after it ended reads again', async () => {
    const world = build();

    const first = world.store.refresh();
    const second = world.store.refresh();
    expect(world.reads).toHaveLength(1);
    world.reads[0].resolve({});
    await Promise.all([first, second]);
    expect(world.reads).toHaveLength(1);

    const third = world.store.refresh();
    expect(world.reads).toHaveLength(2);
    world.reads[1].resolve({});
    await third;
  });

  it('that began before another that ended first never overwrites it, whichever way the host answers', async () => {
    const world = build();
    const stop = world.store.attach();
    // The first read is in flight; the host changes under it, so the read the event asks for is a new one (the first may not have seen the change).
    world.emitStatus();
    world.timers[0].run();
    expect(world.reads).toHaveLength(2);

    world.reads[1].resolve({ acme: [record('main', 'Newer')] });
    await flush();
    world.reads[0].resolve({ acme: [record('main', 'Older')] });
    await flush();
    expect(world.store.getSnapshot().connections.map((entry) => entry.name)).toEqual(['Newer']);

    // And when the older one ends first, it is taken, and the newer one that ends after it is what stays.
    world.emitStatus();
    world.timers[1].run();
    world.emitStatus();
    world.timers[2].run();
    expect(world.reads).toHaveLength(4);
    world.reads[2].resolve({ acme: [record('main', 'Second')] });
    await flush();
    expect(world.store.getSnapshot().connections.map((entry) => entry.name)).toEqual(['Second']);
    world.reads[3].resolve({ acme: [record('main', 'Third')] });
    await flush();
    expect(world.store.getSnapshot().connections.map((entry) => entry.name)).toEqual(['Third']);
    stop();
  });

  it('that fails after a newer one worked changes nothing', async () => {
    const world = build();
    const stop = world.store.attach();
    world.emitStatus();
    world.timers[0].run();

    world.reads[1].resolve({ acme: [record('main', 'Main')] });
    await flush();
    world.reads[0].reject(new Error('too late'));
    await flush();

    expect(world.store.getSnapshot().failed).toBe(false);
    expect(world.store.getSnapshot().connections).toHaveLength(1);
    stop();
  });
});

describe('connect', () => {
  it('is connecting at once, stays so while the list is read again, and is connected, with the outcome, after it', async () => {
    const world = build();
    await loadedWith(world, { acme: [record('main', 'Main', 'DISCONNECTED')] });

    const outcome = watch(world.store.connect('acme', 'main'));

    expect(world.starts).toHaveLength(1);
    expect(world.starts[0]).toMatchObject({ plugin: 'acme', key: 'main' });
    expect(connection(world, 'acme', 'main')).toMatchObject({ state: 'connecting', reason: undefined });

    world.starts[0].resolve({ status: 'CONNECTED' });
    await flush();
    // The start ended and the list is being read again: it says connecting still, never what it said before the start, and the outcome waits for the read.
    expect(world.reads).toHaveLength(2);
    expect(stateOf(world, 'acme', 'main')).toBe('connecting');
    expect(outcome.isDone()).toBe(false);

    world.reads[1].resolve({ acme: [record('main', 'Main', 'CONNECTED')] });
    await flush();
    expect(outcome.value()).toEqual({ status: 'connected' });
    expect(stateOf(world, 'acme', 'main')).toBe('connected');
  });

  it('reads the list again after the start ended even when a read that began before it is in flight: that one may not have seen the connection come up', async () => {
    const world = build();
    await loadedWith(world, { acme: [record('main', 'Main', 'DISCONNECTED')] });
    void world.store.refresh();
    expect(world.reads).toHaveLength(2);

    const outcome = watch(world.store.connect('acme', 'main'));
    world.starts[0].resolve({ status: 'CONNECTED' });
    await flush();
    expect(world.reads).toHaveLength(3);

    world.reads[1].resolve({ acme: [record('main', 'Main', 'DISCONNECTED')] });
    await flush();
    expect(outcome.isDone()).toBe(false);
    world.reads[2].resolve({ acme: [record('main', 'Main', 'CONNECTED')] });
    await flush();

    expect(outcome.value()).toEqual({ status: 'connected' });
    expect(stateOf(world, 'acme', 'main')).toBe('connected');
  });

  it('does not start a connection that is listed and connected: it is connected, with no call, no read and nothing to tell', async () => {
    const world = build();
    await loadedWith(world, { acme: [record('main', 'Main', 'CONNECTED')] });
    const before = world.store.getSnapshot();
    const listener = vi.fn();
    world.store.subscribe(listener);

    await expect(world.store.connect('acme', 'main')).resolves.toEqual({ status: 'connected' });

    expect(world.starts).toHaveLength(0);
    expect(world.reads).toHaveLength(1);
    expect(world.store.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each(['PENDING', 'DISCONNECTED', 'UNKNOWN', 'FAILED'])('starts a connection that is listed as %s', async (readiness) => {
    const world = build();
    await loadedWith(world, { acme: [record('main', 'Main', readiness)] });

    void world.store.connect('acme', 'main');

    expect(world.starts).toHaveLength(1);
  });

  it('still starts a connection the list does not hold: the host decides, and there is nothing to mark', async () => {
    const world = build();
    const listener = vi.fn();
    world.store.subscribe(listener);

    const outcome = watch(world.store.connect('acme', 'ghost'));

    expect(world.starts).toHaveLength(1);
    expect(world.starts[0]).toMatchObject({ plugin: 'acme', key: 'ghost' });
    expect(world.store.getSnapshot()).toEqual({ loaded: false, failed: false, connections: [] });
    expect(listener).not.toHaveBeenCalled();

    world.starts[0].resolve({ status: 'CONNECTED' });
    await flush();
    world.reads[0].resolve({ acme: [record('ghost', 'Ghost', 'CONNECTED')] });
    await flush();
    expect(outcome.value()).toEqual({ status: 'connected' });
    expect(stateOf(world, 'acme', 'ghost')).toBe('connected');
  });

  it('shares one start between the calls for one connection that overlap, before the start ended and while the list is read after it, and not with another connection', async () => {
    const world = build();
    await loadedWith(world, { acme: [record('main', 'Main', 'DISCONNECTED'), record('spare', 'Spare', 'DISCONNECTED')], west: [record('main', 'Main', 'DISCONNECTED')] });

    const first = watch(world.store.connect('acme', 'main'));
    const second = watch(world.store.connect('acme', 'main'));
    const spare = watch(world.store.connect('acme', 'spare'));
    const other = watch(world.store.connect('west', 'main'));
    expect(world.starts.map((start) => `${start.plugin}/${start.key}`)).toEqual(['acme/main', 'acme/spare', 'west/main']);

    world.starts[0].resolve({ status: 'CONNECTED' });
    await flush();
    const third = watch(world.store.connect('acme', 'main'));
    expect(world.starts).toHaveLength(3);

    world.reads[1].resolve({ acme: [record('main', 'Main', 'CONNECTED'), record('spare', 'Spare', 'DISCONNECTED')], west: [record('main', 'Main', 'DISCONNECTED')] });
    await flush();

    expect([first.value(), second.value(), third.value()]).toEqual([{ status: 'connected' }, { status: 'connected' }, { status: 'connected' }]);
    expect(spare.isDone()).toBe(false);
    expect(other.isDone()).toBe(false);
    expect(stateOf(world, 'acme', 'main')).toBe('connected');
    expect(stateOf(world, 'acme', 'spare')).toBe('connecting');
    expect(stateOf(world, 'west', 'main')).toBe('connecting');
  });

  describe('that fails', () => {
    type Watched = { readonly isDone: () => boolean; readonly value: () => ConnectOutcome | undefined };

    function rejecting(error: Error): (start: Start) => void {
      return (start) => {
        start.reject(error);
      };
    }

    function answering(status: StartStatus): (start: Start) => void {
      return (start) => {
        start.resolve(status);
      };
    }

    const FAILURES: Array<[name: string, fail: (start: Start) => void, state: ConnectionState, reason: string]> = [
      ['a sign-in is needed', rejecting(wails(UNAUTHORIZED)), 'unauthorized', 'The provider requires authentication.'],
      ['access is denied', rejecting(wails(FORBIDDEN)), 'forbidden', 'The role may not connect.'],
      ['the server does not answer', rejecting(wails(NOT_RESPONDING)), 'unreachable', 'The server refused the connection.'],
      ['the host says it did not start', rejecting(wails(BROKEN)), 'failed', 'The plugin could not open it.'],
      ['the host answers UNAUTHORIZED', answering({ status: 'UNAUTHORIZED', error: 'The token has expired.' }), 'unauthorized', 'The token has expired.'],
      ['the host answers FORBIDDEN', answering({ status: 'FORBIDDEN' }), 'forbidden', 'You do not have access to this connection.'],
      ['the host answers FAILED', answering({ status: 'FAILED', details: 'The server is starting.' }), 'failed', 'The server is starting.'],
      ['the host answers PENDING, which is no connection', answering({ status: 'PENDING' }), 'failed', 'The connection did not start.'],
    ];

    async function failed(fail: (start: Start) => void): Promise<{ world: World; outcome: Watched }> {
      const world = build();
      await loadedWith(world, { acme: [record('main', 'Main', 'DISCONNECTED')] });
      const outcome = watch(world.store.connect('acme', 'main'));
      fail(world.starts[0]);
      await flush();
      return { world, outcome };
    }

    it.each(FAILURES)('when %s: is connecting until the list was read again, and answers its caller then with what the start came to', async (_name, fail, state, reason) => {
      const { world, outcome } = await failed(fail);

      // The start ended and the list is being read again. The window says nothing of its own about why it failed: the connection is connecting still, and the answer waits for the read.
      expect(connection(world, 'acme', 'main')).toMatchObject({ state: 'connecting', reason: undefined });
      expect(outcome.isDone()).toBe(false);

      world.reads[1].resolve({ acme: [record('main', 'Main', 'DISCONNECTED')] });
      await flush();

      // The caller is answered from the start itself (its rejection, or the status it answered), whatever the list says: nothing of it is stored.
      expect(outcome.value()).toEqual({ status: 'failed', state, reason });
    });

    it('shows no text the plugin wrote when what the host threw is not its envelope: the answer is failed, with the runtime\'s own sentence, and the store holds none of it', async () => {
      const { world, outcome } = await failed((start) => {
        start.reject(new Error('boom: token=abc123'));
      });
      world.reads[1].resolve({ acme: [record('main', 'Main', 'DISCONNECTED')] });
      await flush();

      expect(outcome.value()).toMatchObject({ status: 'failed', state: 'failed' });
      expect(JSON.stringify(outcome.value())).not.toMatch(/boom|token|abc123/);
      expect(JSON.stringify(world.store.getSnapshot())).not.toMatch(/boom|token|abc123/);
    });

    it('is a failure, not a rejection, when the host throws instead of rejecting, and when it answers what is not a status', async () => {
      const throwing = build({}, {
        start: () => {
          throw new Error('no runtime');
        },
      });
      const thrown = watch(throwing.store.connect('acme', 'main'));
      await flush();
      throwing.reads[0].resolve({});
      await flush();
      expect(thrown.value()).toMatchObject({ status: 'failed', state: 'failed' });

      const nothing = build();
      const outcome = watch(nothing.store.connect('acme', 'main'));
      nothing.starts[0].resolve(null as unknown as StartStatus);
      await flush();
      nothing.reads[0].resolve({});
      await flush();
      expect(outcome.value()).toMatchObject({ status: 'failed', state: 'failed' });
    });

    it('is connecting until the read that follows it has ended, also when that read fails: then it is what the last read that worked said, and the caller is answered all the same', async () => {
      const { world, outcome } = await failed((start) => {
        start.reject(wails(UNAUTHORIZED));
      });
      expect(connection(world, 'acme', 'main')).toMatchObject({ state: 'connecting', reason: undefined });

      world.reads[1].reject(new Error('the host is gone'));
      await flush();

      expect(outcome.value()).toEqual({ status: 'failed', state: 'unauthorized', reason: 'The provider requires authentication.' });
      expect(connection(world, 'acme', 'main')).toMatchObject({ state: 'disconnected', reason: undefined });
      expect(world.store.getSnapshot().failed).toBe(true);
    });
  });
});

// The host remembers why a start failed (its list says FAILED with the error, and a `connection/status` event tells every window that something changed): the store keeps nothing of its own, so a connection is what the last list said,
// whichever window made the start, and a list that says something else the next time is believed.
describe('what the host says of a start that failed', () => {
  it.each(HOST_SAYS)('is %s: an event from the host makes the window read a list that says FAILED, with no start made by this window', async (_name, error, state, reason) => {
    const world = build({ plugins: () => ['acme'] });
    const stop = world.store.attach();
    world.reads[0].resolve({ acme: [record('main', 'Main', 'DISCONNECTED')] });
    await flush();
    expect(connection(world, 'acme', 'main')).toMatchObject({ state: 'disconnected', reason: undefined });
    const listener = vi.fn();
    world.store.subscribe(listener);

    // A start of another window fails. The event says that something changed, not what: the window reads the list, and the list says it.
    world.emitStatus();
    expect(world.timers).toHaveLength(1);
    world.timers[0].run();
    world.reads[1].resolve({ acme: [record('main', 'Main', 'FAILED', error)] });
    await flush();

    expect(connection(world, 'acme', 'main')).toMatchObject({ state, reason });
    expect(world.starts).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it.each(HOST_SAYS)('is %s: after a start of this window that failed the state is what the list says, whatever the start said, and the caller is answered with the start\'s own', async (_name, error, state, reason) => {
    const world = build();
    await loadedWith(world, { acme: [record('main', 'Main', 'DISCONNECTED')] });
    const outcome = watch(world.store.connect('acme', 'main'));
    world.starts[0].resolve({ status: 'PENDING' });
    await flush();

    world.reads[1].resolve({ acme: [record('main', 'Main', 'FAILED', error)] });
    await flush();

    expect(connection(world, 'acme', 'main')).toMatchObject({ state, reason });
    expect(outcome.value()).toEqual({ status: 'failed', state: 'failed', reason: 'The connection did not start.' });
  });

  it('is connected, with no reason, when a later list says CONNECTED', async () => {
    const world = build();
    await loadedWith(world, { acme: [record('main', 'Main', 'DISCONNECTED')] });
    void world.store.connect('acme', 'main');
    world.starts[0].reject(wails(NOT_RESPONDING));
    await flush();
    world.reads[1].resolve({ acme: [record('main', 'Main', 'FAILED', NOT_RESPONDING)] });
    await flush();
    expect(connection(world, 'acme', 'main')).toMatchObject({ state: 'unreachable', reason: 'The server refused the connection.' });

    await loadedWith(world, { acme: [record('main', 'Main', 'CONNECTED')] });

    expect(connection(world, 'acme', 'main')).toMatchObject({ state: 'connected', reason: undefined });
  });

  it('remembers nothing between reads: a list that says DISCONNECTED after a start that failed is disconnected, and the same list read again changes nothing', async () => {
    const world = build();
    await loadedWith(world, { acme: [record('main', 'Main', 'DISCONNECTED')] });
    void world.store.connect('acme', 'main');
    world.starts[0].reject(wails(UNAUTHORIZED));
    await flush();

    world.reads[1].resolve({ acme: [record('main', 'Main', 'DISCONNECTED')] });
    await flush();
    expect(connection(world, 'acme', 'main')).toMatchObject({ state: 'disconnected', reason: undefined });

    const before = world.store.getSnapshot();
    const listener = vi.fn();
    world.store.subscribe(listener);
    await loadedWith(world, { acme: [record('main', 'Main', 'DISCONNECTED')] });

    expect(world.store.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('follows the host both ways, read after read: FAILED, DISCONNECTED, FAILED again, each as that list says it, and the same list twice says the same twice', async () => {
    const world = build();
    const says = async (readiness: string, error?: AppError) => {
      await loadedWith(world, { acme: [record('main', 'Main', readiness, error)] });
      return connection(world, 'acme', 'main');
    };

    expect(await says('FAILED', FORBIDDEN)).toMatchObject({ state: 'forbidden', reason: 'The role may not connect.' });
    const first = world.store.getSnapshot();
    expect(await says('FAILED', FORBIDDEN)).toMatchObject({ state: 'forbidden', reason: 'The role may not connect.' });
    expect(world.store.getSnapshot()).toBe(first);
    expect(await says('DISCONNECTED')).toMatchObject({ state: 'disconnected', reason: undefined });
    expect(await says('FAILED', NOT_RESPONDING)).toMatchObject({ state: 'unreachable', reason: 'The server refused the connection.' });
  });

  it('is connecting at once, with no reason, when a connection the list says FAILED is started again, and is what the list says when that start ended', async () => {
    const world = build();
    await loadedWith(world, { acme: [record('main', 'Main', 'FAILED', UNAUTHORIZED)] });
    expect(stateOf(world, 'acme', 'main')).toBe('unauthorized');

    const outcome = watch(world.store.connect('acme', 'main'));
    expect(connection(world, 'acme', 'main')).toMatchObject({ state: 'connecting', reason: undefined });

    world.starts[0].reject(wails(FORBIDDEN));
    await flush();
    expect(connection(world, 'acme', 'main')).toMatchObject({ state: 'connecting', reason: undefined });
    world.reads[1].resolve({ acme: [record('main', 'Main', 'FAILED', FORBIDDEN)] });
    await flush();

    expect(outcome.value()).toEqual({ status: 'failed', state: 'forbidden', reason: 'The role may not connect.' });
    expect(connection(world, 'acme', 'main')).toMatchObject({ state: 'forbidden', reason: 'The role may not connect.' });
  });
});

describe('attach', () => {
  it('reads once and follows the status event and the sync of each plugin that is listed', () => {
    const world = build({ plugins: () => ['west', 'acme'] });

    const stop = world.store.attach();

    expect(world.reads).toHaveLength(1);
    expect(world.following()).toEqual({ status: 1, sync: ['acme', 'west'] });
    stop();
  });

  it('follows the status event alone when no plugins are listed', () => {
    const world = build();

    const stop = world.store.attach();

    expect(world.following()).toEqual({ status: 1, sync: [] });
    stop();
  });

  it('asks for one read, 100 ms after the first event of a burst, whatever the events are and however many; a later event asks again', async () => {
    const world = build({ plugins: () => ['acme', 'west'] });
    const stop = world.store.attach();
    world.reads[0].resolve({ acme: [record('main', 'Main', 'DISCONNECTED')] });
    await flush();

    world.emitStatus();
    world.emitSync('acme');
    world.emitSync('west');
    world.emitStatus();

    expect(world.timers).toHaveLength(1);
    expect(world.timers[0].ms).toBe(100);
    expect(world.reads).toHaveLength(1);

    world.timers[0].run();
    expect(world.reads).toHaveLength(2);
    world.reads[1].resolve({ acme: [record('main', 'Main', 'CONNECTED')] });
    await flush();
    expect(stateOf(world, 'acme', 'main')).toBe('connected');

    world.emitSync('west');
    expect(world.timers).toHaveLength(2);
    world.timers[1].run();
    expect(world.reads).toHaveLength(3);
    stop();
  });

  it('waits the 100 ms on the real clock by default', async () => {
    vi.useFakeTimers();
    const fake = fakeApi();
    const store = createConnectionsStore(fake.api);
    const stop = store.attach();
    fake.reads[0].resolve({});
    await vi.advanceTimersByTimeAsync(0);

    fake.emitStatus();
    fake.emitStatus();
    await vi.advanceTimersByTimeAsync(99);
    expect(fake.reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.reads).toHaveLength(2);

    fake.emitStatus();
    stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.reads).toHaveLength(2);
  });

  it('follows the plugins that are listed after each read: the ones that came are followed once, the ones that left are not', async () => {
    let plugins = ['acme'];
    const world = build({ plugins: () => plugins });
    const stop = world.store.attach();
    expect(world.following().sync).toEqual(['acme']);

    plugins = ['acme', 'west'];
    world.reads[0].resolve({});
    await flush();
    expect(world.following().sync).toEqual(['acme', 'west']);

    plugins = ['west'];
    world.emitStatus();
    world.timers[0].run();
    world.reads[1].resolve({});
    await flush();
    expect(world.following().sync).toEqual(['west']);
    stop();
  });

  it('leaves nothing followed and nothing scheduled once undone, and a read that was in flight changes nothing and follows nothing', async () => {
    const world = build({ plugins: () => ['acme'] });
    const stop = world.store.attach();
    world.emitStatus();
    const before = world.store.getSnapshot();
    const listener = vi.fn();
    world.store.subscribe(listener);

    stop();

    expect(world.following()).toEqual({ status: 0, sync: [] });
    expect(world.timers[0].isCancelled).toBe(true);

    world.reads[0].resolve({ acme: [record('main', 'Main')] });
    await flush();
    expect(world.store.getSnapshot()).toBe(before);
    expect(world.store.getSnapshot().loaded).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(world.following()).toEqual({ status: 0, sync: [] });

    // An event that still arrives, and a scheduler that could not cancel, ask for nothing.
    world.everyStatusListener[0]();
    world.timers[0].run();
    expect(world.timers).toHaveLength(1);
    expect(world.reads).toHaveLength(1);
  });

  it('keeps one set of events until both of two attachments are undone, and undoing one twice undoes it once', () => {
    const world = build({ plugins: () => ['acme'] });

    const first = world.store.attach();
    const second = world.store.attach();
    expect(world.reads).toHaveLength(1);
    expect(world.following()).toEqual({ status: 1, sync: ['acme'] });

    first();
    first();
    expect(world.following()).toEqual({ status: 1, sync: ['acme'] });

    second();
    expect(world.following()).toEqual({ status: 0, sync: [] });
  });

  it('reads again when it is attached again after being undone, and takes that read and not the one that was in flight', async () => {
    const world = build();
    world.store.attach()();

    const stop = world.store.attach();
    expect(world.reads).toHaveLength(2);

    world.reads[1].resolve({ acme: [record('main', 'Main')] });
    await flush();
    world.reads[0].resolve({ acme: [record('main', 'Old'), record('spare', 'Old')] });
    await flush();

    expect(world.store.getSnapshot().connections.map((entry) => entry.name)).toEqual(['Main']);
    stop();
  });

  it('is attached to nothing when the events cannot be followed: the next attach starts from the beginning', () => {
    let isBroken = true;
    const world = build({}, {
      onStatus: (listener) => {
        if (isBroken) {
          throw new Error('no runtime');
        }

        return fakeApi().api.onStatus(listener);
      },
    });

    expect(() => world.store.attach()).toThrow('no runtime');
    expect(world.reads).toHaveLength(0);

    isBroken = false;
    const stop = world.store.attach();
    expect(world.reads).toHaveLength(1);
    stop();
  });

  it('does not let a list of plugins that throws stop the read', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const world = build({
      plugins: () => {
        throw new Error('no plugins yet');
      },
    });

    const stop = world.store.attach();
    world.reads[0].resolve({ acme: [record('main', 'Main')] });
    await flush();

    expect(world.store.getSnapshot().loaded).toBe(true);
    expect(logged).toHaveBeenCalled();
    stop();
  });
});
