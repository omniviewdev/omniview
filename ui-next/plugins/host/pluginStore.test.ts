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
