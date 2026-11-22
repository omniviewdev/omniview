import { describe, expect, it, vi } from 'vitest';
import { CONTRIBUTION_EXPORT_V1 } from '../contract/admit';
import type { Incompatibility } from '../loader/failure';
import { acme } from '../testing';
import { MAX_CONCURRENT_LOADS, PluginStore, type HostRetry, type LoaderDeps, type PluginDescriptor, type PluginEntry } from './pluginStore';

// A plugin the host refused because its process speaks a plugin protocol this Omniview does not run (S4): the host says so in a code and two numbers (`plugin/unloaded` with the cause `incompatible`, `lifecycle.ts`), and the
// inventory says it to a window that opens later. The store shows the plugin as a failed entry of the kind `unloaded` with the host's sentence and the two versions, and never asks the host to start it again: the same process would
// say the same number. No bundle, no browser, no host: the loader and the host's retry are injected.

const FACTS: Incompatibility = { pluginProtocol: 2, accepted: { oldest: 1, newest: 1 } };
const SAYS = 'This plugin was built for a different version of Omniview. It uses plugin protocol 2; this Omniview accepts protocol 1.';
const CRASHED = 'The plugin process stopped unexpectedly, so its pages can\'t load data.';
const STARTING = 'The plugin is starting again. The page opens when it is ready.';
const COULD_NOT_START = 'The plugin could not start, so its pages can\'t load data.';

const descriptor = (id: string, more: Partial<PluginDescriptor> = {}): PluginDescriptor => ({ id, name: `Plugin ${id}`, ...more });
const good = () => ({ [CONTRIBUTION_EXPORT_V1]: acme() });
const entry = (store: PluginStore, id: string): PluginEntry | undefined => store.getSnapshot().find((candidate) => candidate.id === id);

type Loader = LoaderDeps & { reads: number };

function loader(): Loader {
  const made: Loader = {
    reads: 0,
    importBundle: async () => {
      made.reads += 1;
      return good();
    },
    clearBundle: () => undefined,
    log: () => undefined,
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

describe('a plugin the host refused for the protocol it speaks', () => {
  it('stays as a failed entry that says the host\'s sentence and the two versions, and leaves the other plugin alone', async () => {
    const { store } = await ready();
    const other = entry(store, 'other');

    store.unload('acme', 'incompatible', FACTS);

    expect(entry(store, 'acme')).toEqual({ id: 'acme', name: 'Plugin acme', phase: 'failed', failure: { kind: 'unloaded', cause: 'incompatible', message: SAYS, incompatibility: FACTS } });
    expect(entry(store, 'other')).toBe(other);
  });

  it('is not taken for a refusal when the host says it without the numbers: there is nothing true to say, so the entry is as it was', async () => {
    const { store } = await ready();
    const before = store.getSnapshot();

    store.unload('acme', 'incompatible');

    expect(store.getSnapshot()).toBe(before);
  });

  it('ends the reload that was under way: the plugin is not starting again any more, and it is not a plugin that did not start', async () => {
    const { store } = await ready();
    store.unload('acme', 'reloaded');
    expect(entry(store, 'acme')).toMatchObject({ failure: { cause: 'reloaded', message: STARTING } });

    store.unload('acme', 'incompatible', FACTS);

    expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { kind: 'unloaded', cause: 'incompatible', message: SAYS } });
  });

  it('ends the standing of a crash: the host stopped recovering the plugin because it refused it, so nothing is coming back, and the entry says why instead of "stopped unexpectedly"', async () => {
    const { store } = await ready();
    store.unload('acme', 'crashed');
    store.unload('acme', 'reloaded');
    expect(entry(store, 'acme')).toMatchObject({ failure: { cause: 'crashed', message: CRASHED } });

    store.unload('acme', 'incompatible', FACTS);

    expect(entry(store, 'acme')).toMatchObject({ failure: { cause: 'incompatible', message: SAYS } });
  });

  it.each(['failed', 'timeout'] as const)('replaces a load that %s with the refusal, and the refusal with the next attempt when the host reloads the plugin', async (held) => {
    const { store } = await ready();
    store.unload('acme', held);

    store.unload('acme', 'incompatible', FACTS);
    expect(entry(store, 'acme')).toMatchObject({ failure: { cause: 'incompatible' } });
    store.unload('acme', 'reloaded');

    expect(entry(store, 'acme')).toMatchObject({ failure: { cause: 'reloaded', message: STARTING } });
  });

  it('is not replaced by a crash it cannot have had, and not changed by what the host says twice', async () => {
    const { store } = await ready();
    store.unload('acme', 'incompatible', FACTS);
    const gone = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);

    store.unload('acme', 'crashed');
    store.unload('acme', 'incompatible', FACTS);

    expect(store.getSnapshot()).toBe(gone);
    expect(listener).not.toHaveBeenCalled();
  });

  it('gives way to what the host says next when that is another cause: a plugin that was updated to a protocol this Omniview runs, and fails to start, says so', async () => {
    const { store } = await ready();
    store.unload('acme', 'incompatible', FACTS);

    store.unload('acme', 'failed');

    expect(entry(store, 'acme')).toMatchObject({ failure: { cause: 'failed', message: COULD_NOT_START } });
  });

  it('is asked of the host for nothing when the person, or anything else, retries: the host is not asked, the interface is not read and the entry does not move', async () => {
    const { store, asked, reading } = await ready();
    store.unload('acme', 'incompatible', FACTS);
    const refused = store.getSnapshot();
    const reads = reading.reads;

    await store.retry(descriptor('acme'));
    await store.retry(descriptor('acme'));

    expect(asked).not.toHaveBeenCalled();
    expect(reading.reads).toBe(reads);
    expect(store.getSnapshot()).toBe(refused);
  });

  it('loads again when the host says the plugin runs, as every plugin that was gone does: an update that makes it compatible is read from its files, with no reload of the window', async () => {
    const { store, reading } = await ready();
    store.unload('acme', 'incompatible', FACTS);
    const reads = reading.reads;

    await store.revive('acme');

    expect(entry(store, 'acme')).toMatchObject({ phase: 'ready' });
    expect(reading.reads).toBe(reads + 1);
  });

  it('is what a Retry that the host answers with a refusal ends in: the entry was starting again, the host said why it will not, and the call failing afterwards does not take that back', async () => {
    const { store } = await ready(async () => {
      store.unload('acme', 'reloaded');
      store.unload('acme', 'incompatible', FACTS);
      return Promise.reject(new Error('{"detail":"This plugin was built for a different version of Omniview."}'));
    });
    store.unload('acme', 'failed');

    await store.retry(descriptor('acme'));

    expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { cause: 'incompatible', message: SAYS } });
  });

  it('is not read again by the answer of a Retry that says the plugin runs, when the host refused it while the call was in flight: the entry is what the host said last, and the answer is about the load this Retry started', async () => {
    const { store, reading } = await ready(async () => {
      store.unload('acme', 'reloaded');
      store.unload('acme', 'incompatible', FACTS);
      return true;
    });
    store.unload('acme', 'failed');
    const reads = reading.reads;

    await store.retry(descriptor('acme'));

    expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { cause: 'incompatible', message: SAYS } });
    expect(reading.reads).toBe(reads);
  });
});

describe('a plugin the host holds as refused when the window opens', () => {
  it('is a failed entry from the first, with the sentence and the two versions, and its interface is not read: the host\'s events do not reach a window that was not open, so the inventory says it', async () => {
    const reading = loader();
    const store = new PluginStore(reading, MAX_CONCURRENT_LOADS, async () => true);

    await store.load(descriptor('acme', { failed: true, incompatible: FACTS }));

    expect(entry(store, 'acme')).toEqual({ id: 'acme', name: 'Plugin acme', phase: 'failed', failure: { kind: 'unloaded', cause: 'incompatible', message: SAYS, incompatibility: FACTS } });
    expect(reading.reads).toBe(0);
  });

  it('is told apart from a plugin that is merely failed: the same inventory phase, and the facts decide', async () => {
    const store = new PluginStore(loader(), MAX_CONCURRENT_LOADS, async () => true);

    await store.load(descriptor('merely', { failed: true }));
    await store.load(descriptor('refused', { failed: true, incompatible: FACTS }));

    expect(entry(store, 'merely')).toMatchObject({ failure: { cause: 'failed' } });
    expect(entry(store, 'refused')).toMatchObject({ failure: { cause: 'incompatible' } });
  });
});
