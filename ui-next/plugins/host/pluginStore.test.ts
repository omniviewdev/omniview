import { describe, expect, it, vi } from 'vitest';
import { BundleTimeoutError } from '../loader/failure';
import { CONTRIBUTION_EXPORT_V1 } from '../contract/admit';
import { acme } from '../testing';
import { PluginStore, type LoaderDeps, type PluginDescriptor, type PluginEntry } from './pluginStore';

// The store with an injected loader: what a load comes to, one at a time, in a bounded pool, and a retry that supersedes a stale answer. No bundle, no browser.

const descriptor = (id: string): PluginDescriptor => ({ id, name: `Plugin ${id}` });
const good = () => ({ [CONTRIBUTION_EXPORT_V1]: acme() });

function deps(importBundle: LoaderDeps['importBundle']): LoaderDeps & { cleared: string[]; logged: string[] } {
  const cleared: string[] = [];
  const logged: string[] = [];
  return {
    importBundle,
    clearBundle: (id) => {
      cleared.push(id);
    },
    log: (message) => {
      logged.push(message);
    },
    cleared,
    logged,
  };
}

const entry = (store: PluginStore, id: string): PluginEntry | undefined => store.getSnapshot().find((candidate) => candidate.id === id);

describe('load', () => {
  it('shows the plugin as loading at once and ready with its contribution when the bundle admits', async () => {
    const release = Promise.withResolvers<unknown>();
    const store = new PluginStore(deps(async () => release.promise));

    const loading = store.load(descriptor('acme'));
    expect(entry(store, 'acme')).toEqual({ id: 'acme', name: 'Plugin acme', phase: 'loading' });

    release.resolve(good());
    await loading;

    expect(entry(store, 'acme')).toMatchObject({ phase: 'ready', contribution: { plugin: { name: 'Acme' } } });
  });

  it('is a failed entry, never a throw, when the bundle cannot be read, and logs it', async () => {
    const loader = deps(async () => Promise.reject(new TypeError('Failed to fetch')));
    const store = new PluginStore(loader);

    await store.load(descriptor('acme'));

    expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { kind: 'missing' } });
    expect(loader.logged).toEqual(['plugin "acme" did not load (missing)']);
  });

  it('is a contract failure when the bundle loads but hands over no contribution of this version', async () => {
    const store = new PluginStore(deps(async () => ({ plugin: {} })));

    await store.load(descriptor('acme'));

    expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { kind: 'contract', detail: 'the bundle exports no contributionV1' } });
  });

  it('is a timeout failure when the loader says so', async () => {
    const store = new PluginStore(deps(async () => Promise.reject(new BundleTimeoutError(30_000))));

    await store.load(descriptor('acme'));

    expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { kind: 'timeout' } });
  });

  it('leaves a plugin it already knows alone: a retry is explicit', async () => {
    const importBundle = vi.fn(async () => Promise.reject(new Error('boom')));
    const store = new PluginStore(deps(importBundle));

    await store.load(descriptor('acme'));
    await store.load(descriptor('acme'));

    expect(importBundle).toHaveBeenCalledTimes(1);
  });
});

describe('retry', () => {
  it('drops the plugin\'s modules before it loads again, and the new answer replaces the failure', async () => {
    let attempt = 0;
    const loader = deps(async () => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('boom')) : good();
    });
    const store = new PluginStore(loader);
    await store.load(descriptor('acme'));
    expect(entry(store, 'acme')).toMatchObject({ phase: 'failed' });

    await store.retry(descriptor('acme'));

    expect(loader.cleared).toEqual(['acme']);
    expect(entry(store, 'acme')).toMatchObject({ phase: 'ready' });
  });

  it('drops the answer of a load that a retry superseded', async () => {
    const first = Promise.withResolvers<unknown>();
    const second = Promise.withResolvers<unknown>();
    const answers = [first, second];
    const store = new PluginStore(deps(async () => answers.shift()!.promise));

    const stale = store.load(descriptor('acme'));
    const fresh = store.retry(descriptor('acme'));
    second.resolve({ [CONTRIBUTION_EXPORT_V1]: acme({ plugin: { name: 'Newer' } }) });
    await fresh;
    first.resolve({ [CONTRIBUTION_EXPORT_V1]: acme({ plugin: { name: 'Older' } }) });
    await stale;

    expect(entry(store, 'acme')).toMatchObject({ phase: 'ready', contribution: { plugin: { name: 'Newer' } } });
  });
});

describe('the pool', () => {
  it('never imports more than its limit at once, and loads every plugin', async () => {
    const gates = new Map<string, PromiseWithResolvers<unknown>>();
    let running = 0;
    let peak = 0;
    const store = new PluginStore(
      deps(async (id) => {
        running += 1;
        peak = Math.max(peak, running);
        const gate = Promise.withResolvers<unknown>();
        gates.set(id, gate);
        try {
          return await gate.promise;
        } finally {
          running -= 1;
        }
      }),
      2,
    );

    const all = ['a', 'b', 'c', 'd', 'e'].map(async (id) => store.load(descriptor(id)));
    await vi.waitFor(() => {
      expect(gates.size).toBe(2);
    });
    expect(store.getSnapshot().map((candidate) => candidate.phase)).toEqual(['loading', 'loading', 'loading', 'loading', 'loading']);

    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      await vi.waitFor(() => {
        expect(gates.has(id)).toBe(true);
      });
      gates.get(id)?.resolve(good());
    }

    await Promise.all(all);

    expect(peak).toBe(2);
    expect(store.getSnapshot().map((candidate) => candidate.phase)).toEqual(['ready', 'ready', 'ready', 'ready', 'ready']);
  });
});

describe('the snapshot', () => {
  it('lists plugins by id, and is the same array until something changes', async () => {
    const store = new PluginStore(deps(async () => good()));
    await store.load(descriptor('b'));
    await store.load(descriptor('a'));

    const before = store.getSnapshot();
    expect(before.map((candidate) => candidate.id)).toEqual(['a', 'b']);
    expect(store.getSnapshot()).toBe(before);

    await store.retry(descriptor('a'));
    expect(store.getSnapshot()).not.toBe(before);
  });

  it('tells a subscriber of each change, and stops after it unsubscribes', async () => {
    const store = new PluginStore(deps(async () => good()));
    const listener = vi.fn();
    const stop = store.subscribe(listener);

    await store.load(descriptor('a'));
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    await store.load(descriptor('b'));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

// A plugin that stops (PU1): the host says so (`plugin/unloaded`, `lifecycle.ts`) and the store lets go of what it drew from the plugin through the paths that already know a plugin that has no
// contribution. A process that crashed and a plugin that is reloading are plugins the window will want again, so they stay, as a failed entry with the host's own sentence (the plugin's words are
// never read); a plugin that was removed or turned off is gone, and the store holds nothing of it, as it would not if the window had opened now.

const CRASHED = 'The plugin process stopped unexpectedly, so its pages can\'t load data.';

/** A store with these plugins loaded and ready. `read` changes what the bundles answer from then on. */
async function loaded(...ids: readonly string[]) {
  let reading: LoaderDeps['importBundle'] = async () => good();
  const loader = deps(async (id) => reading(id));
  const store = new PluginStore(loader);
  for (const id of ids) {
    await store.load(descriptor(id));
  }

  return {
    store,
    loader,
    read: (next: LoaderDeps['importBundle']): void => {
      reading = next;
    },
  };
}

describe('unload', () => {
  it('keeps a plugin whose process crashed as a failed entry that says so in the host\'s words, and touches no other plugin', async () => {
    const { store } = await loaded('acme', 'other');
    const other = entry(store, 'other');

    store.unload('acme', 'crashed');

    expect(entry(store, 'acme')).toEqual({ id: 'acme', name: 'Plugin acme', phase: 'failed', failure: { kind: 'unloaded', cause: 'crashed', message: CRASHED } });
    expect(entry(store, 'other')).toBe(other);
  });

  it('keeps a plugin that is reloading as a failed entry that says it starts again, with no text of anyone but the host', async () => {
    const { store } = await loaded('acme');

    store.unload('acme', 'reloaded');

    expect(entry(store, 'acme')).toEqual({ id: 'acme', name: 'Plugin acme', phase: 'failed', failure: { kind: 'unloaded', cause: 'reloaded', message: 'The plugin is starting again. The page opens when it is ready.' } });
  });

  it.each(['uninstalled', 'disabled'] as const)('forgets a plugin that was %s: the store holds nothing of it, as it would not if the window had opened now', async (cause) => {
    const { store } = await loaded('acme', 'other');
    const listener = vi.fn();
    store.subscribe(listener);

    store.unload('acme', cause);

    expect(store.getSnapshot().map((candidate) => candidate.id)).toEqual(['other']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('drops the plugin\'s modules as it goes, so what loads next is read from its files', async () => {
    const { store, loader } = await loaded('acme');

    store.unload('acme', 'crashed');

    expect(loader.cleared).toEqual(['acme']);
  });

  it('leaves a plugin that is already gone as it is: the first cause stands and nobody is told again', async () => {
    const { store } = await loaded('acme');
    store.unload('acme', 'crashed');
    const gone = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);

    // The recovery of a crash reloads the plugin, which the host says as well: the plugin went away because it crashed.
    store.unload('acme', 'reloaded');

    expect(store.getSnapshot()).toBe(gone);
    expect(entry(store, 'acme')).toMatchObject({ failure: { cause: 'crashed' } });
    expect(listener).not.toHaveBeenCalled();
  });

  it('has nothing to do for a plugin it has no entry for, and tells nobody', async () => {
    const { store } = await loaded('acme');
    const before = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);

    store.unload('missing', 'crashed');
    store.unload('missing', 'disabled');

    expect(store.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('drops the answer of a load that was on its way when the plugin went: it never makes the plugin ready', async () => {
    const answer = Promise.withResolvers<unknown>();
    const store = new PluginStore(deps(async () => answer.promise));
    const loading = store.load(descriptor('acme'));

    store.unload('acme', 'crashed');
    answer.resolve(good());
    await loading;

    expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { kind: 'unloaded', cause: 'crashed' } });
  });

  it('replaces a failure to load: the plugin\'s files are changing, and it loads again when it runs', async () => {
    const store = new PluginStore(deps(async () => Promise.reject(new Error('boom'))));
    await store.load(descriptor('acme'));
    expect(entry(store, 'acme')).toMatchObject({ failure: { kind: 'broken' } });

    store.unload('acme', 'reloaded');

    expect(entry(store, 'acme')).toMatchObject({ phase: 'failed', failure: { kind: 'unloaded', cause: 'reloaded' } });
  });
});

describe('revive', () => {
  it('loads a plugin that is gone again from its files, dropping its modules first, and it is ready with what the new files say', async () => {
    let contribution = acme();
    const loader = deps(async () => ({ [CONTRIBUTION_EXPORT_V1]: contribution }));
    const store = new PluginStore(loader);
    await store.load(descriptor('acme'));
    store.unload('acme', 'reloaded');
    loader.cleared.length = 0;
    contribution = acme({ plugin: { name: 'Newer' } });

    await store.revive('acme');

    expect(loader.cleared).toEqual(['acme']);
    expect(entry(store, 'acme')).toMatchObject({ phase: 'ready', name: 'Plugin acme', contribution: { plugin: { name: 'Newer' } } });
  });

  it('shows the plugin as loading while it loads again, and not as gone', async () => {
    const { store, read } = await loaded('acme');
    const answer = Promise.withResolvers<unknown>();
    store.unload('acme', 'crashed');
    read(async () => answer.promise);

    const reviving = store.revive('acme');
    expect(entry(store, 'acme')).toEqual({ id: 'acme', name: 'Plugin acme', phase: 'loading' });

    answer.resolve(good());
    await reviving;
    expect(entry(store, 'acme')).toMatchObject({ phase: 'ready' });
  });

  it('leaves alone a plugin that is ready, one that is loading and one that failed on its own: a retry is explicit', async () => {
    const importBundle = vi.fn(async (id: string) => (id === 'broken' ? Promise.reject(new Error('boom')) : good()));
    const store = new PluginStore(deps(importBundle));
    await store.load(descriptor('acme'));
    await store.load(descriptor('broken'));
    expect(importBundle).toHaveBeenCalledTimes(2);

    await store.revive('acme');
    await store.revive('broken');

    expect(importBundle).toHaveBeenCalledTimes(2);
    expect(entry(store, 'acme')).toMatchObject({ phase: 'ready' });
    expect(entry(store, 'broken')).toMatchObject({ failure: { kind: 'broken' } });
  });

  it('has nothing to do for a plugin it has no entry for', async () => {
    const importBundle = vi.fn(async () => good());
    const store = new PluginStore(deps(importBundle));

    await store.revive('missing');

    expect(importBundle).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toEqual([]);
  });

  it('loads once for a plugin that is told it runs twice', async () => {
    const { store, read } = await loaded('acme');
    const importBundle = vi.fn(async () => good());
    read(importBundle);
    store.unload('acme', 'crashed');

    await Promise.all([store.revive('acme'), store.revive('acme')]);

    expect(importBundle).toHaveBeenCalledTimes(1);
  });
});

describe('a plugin that goes and comes back', () => {
  it('leaves one entry and one contribution after twenty round trips, whichever way it went, and no subscriber of the store more than it had', async () => {
    const { store, loader } = await loaded('acme', 'other');
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    const causes = ['crashed', 'reloaded'] as const;

    for (let round = 0; round < 20; round += 1) {
      store.unload('acme', causes[round % 2] ?? 'crashed');
      expect(entry(store, 'acme')).toMatchObject({ phase: 'failed' });
      await store.revive('acme');
      expect(store.getSnapshot().map((candidate) => `${candidate.id}:${candidate.phase}`)).toEqual(['acme:ready', 'other:ready']);
    }

    // A round is the stop, the load and the answer: three changes, and the other plugin is never one of them.
    expect(listener).toHaveBeenCalledTimes(20 * 3);
    expect(loader.cleared.filter((id) => id === 'other')).toEqual([]);
    expect(loader.cleared.filter((id) => id === 'acme')).toHaveLength(40);
    stop();
    store.unload('acme', 'crashed');
    expect(listener).toHaveBeenCalledTimes(20 * 3);
  });

  it('is back in a store that lost it to an uninstall by the load of the inventory, as for any plugin the store has not got', async () => {
    const { store } = await loaded('acme');
    store.unload('acme', 'uninstalled');
    expect(store.getSnapshot()).toEqual([]);

    await store.load(descriptor('acme'));

    expect(entry(store, 'acme')).toMatchObject({ phase: 'ready' });
  });
});
