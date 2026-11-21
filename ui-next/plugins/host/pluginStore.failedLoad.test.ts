import { describe, expect, it, vi } from 'vitest';
import { CONTRIBUTION_EXPORT_V1 } from '../contract/admit';
import { acme } from '../testing';
import { MAX_CONCURRENT_LOADS, PluginStore, type HostRetry, type LoaderDeps, type PluginDescriptor, type PluginEntry } from './pluginStore';

// A plugin whose load failed (PU2, findings PU1-01 and PU1-02): the host says so in a code (`plugin/unloaded` with the cause `failed` or `timeout`, `lifecycle.ts`), and the store shows the plugin as a failed entry with the host's own
// sentence for it, in the same kind as a plugin that crashed or is reloading (`unloaded`). Its Retry is the host's: the store asks the host to start the plugin again (`HostRetry`), says it is starting again for as long as the
// host takes, and ends in what the host answers, never in a spinner with no exit. No bundle, no browser, no host: the loader and the host's retry are injected.

const descriptor = (id: string): PluginDescriptor => ({ id, name: `Plugin ${id}` });
const good = () => ({ [CONTRIBUTION_EXPORT_V1]: acme() });
const entry = (store: PluginStore, id: string): PluginEntry | undefined => store.getSnapshot().find((candidate) => candidate.id === id);

const COULD_NOT_START = 'The plugin could not start, so its pages can\'t load data.';
const TOOK_TOO_LONG = 'The plugin took too long to start, so its pages can\'t load data.';
const STARTING = 'The plugin is starting again. The page opens when it is ready.';
const CRASHED = 'The plugin process stopped unexpectedly, so its pages can\'t load data.';

type Loader = LoaderDeps & { readonly cleared: string[]; readonly logged: Array<{ message: string; detail: unknown }>; reads: number };

/** The loader of a store: what its bundles answer is `read`, and what it was asked is counted. */
function loader(read: (id: string) => Promise<unknown> = async () => good()): Loader {
  const made: Loader = {
    reads: 0,
    cleared: [],
    logged: [],
    importBundle: async (id) => {
      made.reads += 1;
      return read(id);
    },
    clearBundle: (id) => {
      made.cleared.push(id);
    },
    log: (message, detail) => {
      made.logged.push({ message, detail });
    },
  };
  return made;
}

/** A store with `acme` and `other` ready, and a host whose retry answers what the test says. */
async function ready(retryHost: HostRetry = async () => true) {
  const reading = loader();
  const asked = vi.fn(retryHost);
  const store = new PluginStore(reading, MAX_CONCURRENT_LOADS, asked);
  await store.load(descriptor('acme'));
  await store.load(descriptor('other'));
  return { store, reading, asked };
}

const phases = (store: PluginStore): string[] => store.getSnapshot().map((candidate) => `${candidate.id}:${candidate.phase}`);

describe('a load the host says failed', () => {
  it('keeps the plugin as a failed entry that says it could not start, in the host\'s words', async () => {
    const { store } = await ready();
    const other = entry(store, 'other');

    store.unload('acme', 'failed');

    expect(entry(store, 'acme')).toEqual({ id: 'acme', name: 'Plugin acme', phase: 'failed', failure: { kind: 'unloaded', cause: 'failed', message: COULD_NOT_START } });
    expect(entry(store, 'other')).toBe(other);
  });

  it('keeps a plugin that did not answer in time as a failed entry that says it took too long', async () => {
    const { store } = await ready();

    store.unload('acme', 'timeout');

    expect(entry(store, 'acme')).toEqual({ id: 'acme', name: 'Plugin acme', phase: 'failed', failure: { kind: 'unloaded', cause: 'timeout', message: TOOK_TOO_LONG } });
  });

  it.each(['failed', 'timeout'] as const)('ends the reload that was under way when it is told %s: the plugin is not starting again any more', async (cause) => {
    const { store } = await ready();
    store.unload('acme', 'reloaded');
    expect(entry(store, 'acme')).toMatchObject({ failure: { cause: 'reloaded', message: STARTING } });

    store.unload('acme', cause);

    expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { kind: 'unloaded', cause } });
  });

  it('leaves a plugin that crashed as it is: the recovery of a crash fails to start it again, however often, and the plugin still stopped unexpectedly', async () => {
    const { store } = await ready();
    store.unload('acme', 'crashed');
    const gone = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);

    store.unload('acme', 'reloaded');
    store.unload('acme', 'failed');
    store.unload('acme', 'timeout');

    expect(store.getSnapshot()).toBe(gone);
    expect(entry(store, 'acme')).toMatchObject({ failure: { cause: 'crashed', message: CRASHED } });
    expect(listener).not.toHaveBeenCalled();
  });

  it.each(['failed', 'timeout'] as const)('is starting again when the host reloads a plugin that had failed (%s): a new attempt, not the last one\'s end', async (held) => {
    const { store } = await ready();
    store.unload('acme', held);

    store.unload('acme', 'reloaded');

    expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { kind: 'unloaded', cause: 'reloaded', message: STARTING } });
  });

  it('replaces the last failure with the next: the host says what each attempt came to', async () => {
    const { store } = await ready();
    store.unload('acme', 'failed');

    store.unload('acme', 'timeout');

    expect(entry(store, 'acme')).toMatchObject({ failure: { cause: 'timeout', message: TOOK_TOO_LONG } });
  });

  it('shows a plugin that was ready, or loading, or whose interface failed on its own, as failed: what the host says of the plugin is the latest news', async () => {
    const answer = Promise.withResolvers<unknown>();
    const reading = loader(async (id) => (id === 'broken' ? Promise.reject(new Error('boom')) : id === 'slow' ? answer.promise : good()));
    const store = new PluginStore(reading, MAX_CONCURRENT_LOADS, async () => true);
    await store.load(descriptor('acme'));
    await store.load(descriptor('broken'));
    const slow = store.load(descriptor('slow'));

    for (const id of ['acme', 'broken', 'slow']) {
      store.unload(id, 'failed');
    }

    answer.resolve(good());
    await slow;

    expect(store.getSnapshot().map((candidate) => [candidate.id, candidate.phase === 'failed' ? candidate.failure : candidate.phase])).toEqual([
      ['acme', { kind: 'unloaded', cause: 'failed', message: COULD_NOT_START }],
      ['broken', { kind: 'unloaded', cause: 'failed', message: COULD_NOT_START }],
      ['slow', { kind: 'unloaded', cause: 'failed', message: COULD_NOT_START }],
    ]);
  });

  it('drops the plugin\'s modules, and has nothing to do for a plugin it has no entry for', async () => {
    const { store, reading } = await ready();
    const before = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);

    store.unload('missing', 'failed');
    expect(store.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();

    store.unload('acme', 'failed');
    expect(reading.cleared).toEqual(['acme']);
  });
});

describe('the Retry of a plugin the host says is gone', () => {
  it.each(['failed', 'timeout', 'crashed'] as const)('asks the host (and only the host) to start the plugin again, once, and says it is starting again at once: %s', async (cause) => {
    const answer = Promise.withResolvers<boolean>();
    const { store, asked, reading } = await ready(async () => answer.promise);
    store.unload('acme', cause);
    const reads = reading.reads;

    const retrying = store.retry(descriptor('acme'));

    expect(asked).toHaveBeenCalledExactlyOnceWith('acme');
    expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { kind: 'unloaded', cause: 'reloaded', message: STARTING } });
    expect(reading.reads).toBe(reads);
    answer.resolve(true);
    await retrying;
  });

  it('asks the host once for two presses of the Retry in a row: a plugin the host is already starting again is not asked twice', async () => {
    const answer = Promise.withResolvers<boolean>();
    const { store, asked } = await ready(async () => answer.promise);
    store.unload('acme', 'failed');

    const first = store.retry(descriptor('acme'));
    const second = store.retry(descriptor('acme'));
    answer.resolve(true);
    await Promise.all([first, second]);

    expect(asked).toHaveBeenCalledTimes(1);
    expect(entry(store, 'acme')).toMatchObject({ phase: 'ready' });
  });

  it('loads the interface again when the host says the plugin runs, and the plugin is ready with one contribution', async () => {
    const { store, reading } = await ready();
    store.unload('acme', 'failed');
    const reads = reading.reads;

    await store.retry(descriptor('acme'));

    expect(entry(store, 'acme')).toMatchObject({ phase: 'ready', name: 'Plugin acme' });
    expect(reading.reads).toBe(reads + 1);
    expect(phases(store)).toEqual(['acme:ready', 'other:ready']);
  });

  it('loads the interface once when the host says it runs twice: the event of the host and the answer of its call', async () => {
    const { store, reading } = await ready();
    store.unload('acme', 'failed');
    const reads = reading.reads;

    await Promise.all([store.retry(descriptor('acme')), store.revive('acme')]);
    await store.revive('acme');

    expect(entry(store, 'acme')).toMatchObject({ phase: 'ready' });
    expect(reading.reads).toBe(reads + 1);
  });

  it('is a failed entry again when the host answers that the plugin does not run: the call ended and the plugin did not start', async () => {
    const { store } = await ready(async () => false);
    store.unload('acme', 'failed');

    await store.retry(descriptor('acme'));

    expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { kind: 'unloaded', cause: 'failed', message: COULD_NOT_START } });
  });

  it('is a failed entry again when the host\'s call fails, whatever its words: they are the log\'s and never the entry\'s', async () => {
    const { store, reading } = await ready(async () => Promise.reject(new Error('panic at /Users/me/.omniview/plugins/acme: token=abc123')));
    store.unload('acme', 'timeout');

    await store.retry(descriptor('acme'));

    const failed = entry(store, 'acme');
    expect(failed).toMatchObject({ phase: 'failed', failure: { kind: 'unloaded', cause: 'failed', message: COULD_NOT_START } });
    expect(JSON.stringify(failed)).not.toMatch(/abc123|Users/);
    expect(reading.logged.map((line) => line.message)).toEqual(['plugin "acme" did not start again']);
  });

  it('ends in what the host says when it says it before its call answers: the cause it names stands, and the failure of the call that follows changes nothing', async () => {
    const answer = Promise.withResolvers<boolean>();
    const { store } = await ready(async () => answer.promise);
    store.unload('acme', 'failed');
    const retrying = store.retry(descriptor('acme'));

    store.unload('acme', 'reloaded');
    expect(entry(store, 'acme')).toMatchObject({ failure: { cause: 'reloaded' } });
    store.unload('acme', 'timeout');
    expect(entry(store, 'acme')).toMatchObject({ failure: { cause: 'timeout', message: TOOK_TOO_LONG } });
    const settled = store.getSnapshot();
    answer.reject(new Error('the host said no'));
    await retrying;

    expect(store.getSnapshot()).toBe(settled);
  });

  it('drops the answer of an interface that was loading when the retry began', async () => {
    const stale = Promise.withResolvers<unknown>();
    let first = true;
    const reading = loader(async () => {
      if (first) {
        first = false;
        return stale.promise;
      }

      return good();
    });
    const store = new PluginStore(reading, MAX_CONCURRENT_LOADS, async () => false);
    const loading = store.load(descriptor('acme'));
    store.unload('acme', 'failed');

    await store.retry(descriptor('acme'));
    stale.resolve(good());
    await loading;

    expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { cause: 'failed' } });
  });

  it('reads the bundle again, and does not ask the host, for a plugin whose interface failed on its own: nothing is wrong with the plugin\'s process', async () => {
    let broken = true;
    const reading = loader(async () => (broken ? Promise.reject(new Error('boom')) : good()));
    const asked = vi.fn(async () => true);
    const store = new PluginStore(reading, MAX_CONCURRENT_LOADS, asked);
    await store.load(descriptor('acme'));
    broken = false;

    await store.retry(descriptor('acme'));

    expect(asked).not.toHaveBeenCalled();
    expect(entry(store, 'acme')).toMatchObject({ phase: 'ready' });
  });
});

describe('a plugin that fails to load, is retried, fails and is retried again', () => {
  it('ends ready once, with one entry and one contribution: fail, retry, fail, retry, succeed', async () => {
    const answers = [false, true];
    const { store, reading, asked } = await ready(async () => answers.shift() ?? true);
    const reads = reading.reads;

    store.unload('acme', 'reloaded');
    store.unload('acme', 'failed');
    expect(entry(store, 'acme')).toMatchObject({ failure: { cause: 'failed' } });

    // Retry: the host starts it again and it fails again, which it says as well as answering.
    const first = store.retry(descriptor('acme'));
    expect(entry(store, 'acme')).toMatchObject({ failure: { cause: 'reloaded' } });
    store.unload('acme', 'reloaded');
    store.unload('acme', 'timeout');
    await first;
    expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { cause: 'timeout' } });

    // Retry again: it runs.
    await store.retry(descriptor('acme'));

    expect(asked).toHaveBeenCalledTimes(2);
    expect(phases(store)).toEqual(['acme:ready', 'other:ready']);
    expect(reading.reads).toBe(reads + 1);
    expect(store.getSnapshot().filter((candidate) => candidate.id === 'acme')).toHaveLength(1);
  });

  it('leaves one entry, one contribution and no subscriber more than it had after twenty failing cycles and a retry that runs, and never touches the other plugin', async () => {
    const outcomes = ['failed', 'timeout', 'rejects', 'refuses'] as const;
    let outcome: (typeof outcomes)[number] | 'runs' = 'failed';
    let behave: HostRetry = async () => true;
    const { store, reading, asked } = await ready(async (id) => behave(id));
    // What the host does for a retry: it says what became of the attempt as well as answering, or it answers and says nothing, or its call fails.
    behave = async (id) => {
      if (outcome === 'runs') {
        return true;
      }

      if (outcome === 'rejects') {
        return Promise.reject(new Error('no'));
      }

      if (outcome === 'failed' || outcome === 'timeout') {
        // The host's events come over a socket: after the call was made, before it answers.
        await Promise.resolve();
        store.unload(id, 'reloaded');
        store.unload(id, outcome);
      }

      return false;
    };

    const other = entry(store, 'other');
    const reads = reading.reads;
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.unload('acme', 'reloaded');
    store.unload('acme', 'failed');

    const changes: number[] = [];
    for (let cycle = 0; cycle < 20; cycle += 1) {
      outcome = outcomes[cycle % outcomes.length] ?? 'failed';
      const before = listener.mock.calls.length;
      const retrying = store.retry(descriptor('acme'));
      expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { cause: 'reloaded' } });
      await retrying;
      expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { kind: 'unloaded', cause: outcome === 'timeout' ? 'timeout' : 'failed' } });
      expect(store.getSnapshot()).toHaveLength(2);
      changes.push(listener.mock.calls.length - before);
    }

    // Every cycle of the same outcome changes the store the same number of times: nothing builds up.
    expect(changes.slice(4)).toEqual(changes.slice(0, 16));
    expect(reading.reads).toBe(reads);

    outcome = 'runs';
    await store.retry(descriptor('acme'));

    expect(asked).toHaveBeenCalledTimes(21);
    expect(phases(store)).toEqual(['acme:ready', 'other:ready']);
    expect(reading.reads).toBe(reads + 1);
    expect(entry(store, 'other')).toBe(other);
    stop();
    const count = listener.mock.calls.length;
    store.unload('acme', 'failed');
    expect(listener).toHaveBeenCalledTimes(count);
  });
});

// A plugin the host already holds as failed when the window asks for it (PU2): its load failed at the start of the host, or while the window was away (a reloaded window finds it in the inventory with the phase Failed). No event reaches a window that was
// not open, so the inventory says it, and the store shows the plugin as a failed entry from the first, with the host's sentence and the Retry that asks the host; there is no interface to read until the plugin runs.

describe('a plugin the host holds as failed', () => {
  it('is a failed entry from the first, with the host\'s sentence, and its interface is not read', async () => {
    const reading = loader();
    const store = new PluginStore(reading, MAX_CONCURRENT_LOADS, async () => true);

    await store.load({ id: 'acme', name: 'Plugin acme', failed: true });
    await store.load(descriptor('other'));

    expect(entry(store, 'acme')).toEqual({ id: 'acme', name: 'Plugin acme', phase: 'failed', failure: { kind: 'unloaded', cause: 'failed', message: COULD_NOT_START } });
    expect(entry(store, 'other')).toMatchObject({ phase: 'ready' });
    expect(reading.reads).toBe(1);
  });

  it('is loaded when the host says it runs, and by the Retry that asks the host', async () => {
    const reading = loader();
    const asked = vi.fn(async () => true);
    const store = new PluginStore(reading, MAX_CONCURRENT_LOADS, asked);
    await store.load({ id: 'acme', name: 'Plugin acme', failed: true });
    await store.load({ id: 'other', name: 'Plugin other', failed: true });

    await store.revive('acme');
    await store.retry({ id: 'other', name: 'Plugin other' });

    expect(phases(store)).toEqual(['acme:ready', 'other:ready']);
    expect(asked).toHaveBeenCalledExactlyOnceWith('other');
    expect(reading.reads).toBe(2);
  });

  it('is left alone by a later read of the inventory, as any plugin the store has: the host\'s events are the news', async () => {
    const reading = loader();
    const store = new PluginStore(reading, MAX_CONCURRENT_LOADS, async () => true);
    await store.load(descriptor('acme'));
    store.unload('acme', 'reloaded');

    await store.load({ id: 'acme', name: 'Plugin acme', failed: true });

    expect(entry(store, 'acme')).toMatchObject({ failure: { cause: 'reloaded' } });
  });
});
