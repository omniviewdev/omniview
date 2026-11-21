import { admitOrThrow } from '../contract/admit';
import type { ContributionV1 } from '../contract/v1';
import { classify, unloadedFailure, type LoadFailure, type UnloadCause } from '../loader/failure';

// What the host knows about each installed plugin's interface: loading, ready with its contribution, or failed with why. Framework-free (React reads it
// through `useSyncExternalStore`), and the loader is injected, so the rules here (bounded parallel loads, one load per plugin at a time, a retry that
// supersedes a stale answer) are tests with no bundle and no browser. The engine properties are the old shell's (docs/ui-next/optimisations.md
// HSH-9, HSH-11): loads run in a bounded pool, the shell never waits for them, and an upgrade clears the plugin's modules before it loads again.

export type PluginDescriptor = {
  readonly id: string;
  /** The name the plugin's manifest gives it: how a frame is named before (or without) its contribution. */
  readonly name: string;
};

export type PluginEntry = PluginDescriptor &
  (
    | { readonly phase: 'loading' }
    | { readonly phase: 'ready'; readonly contribution: ContributionV1 }
    | { readonly phase: 'failed'; readonly failure: LoadFailure }
  );

export type LoaderDeps = {
  readonly importBundle: (id: string) => Promise<unknown>;
  readonly clearBundle: (id: string) => void;
  readonly log: (message: string, detail: unknown) => void;
};

/** The old shell imports five plugins at once (ui/features/plugins/core/types.ts: `maxConcurrentLoads`). */
export const MAX_CONCURRENT_LOADS = 5;

/**
 * The production loader. SystemJS and the shared list are imported on the first load, so a screen that loads no plugin does not carry them: this is the
 * one place a static import cannot serve, because the point is to keep the loader out of the entry chunk.
 */
export const productionDeps: LoaderDeps = {
  importBundle: async (id) => (await import('../loader/importBundle')).importBundle(id),
  clearBundle: (id) => {
    void import('../loader/importBundle').then((loader) => {
      loader.clearBundle(id);
    });
  },
  log: (message, detail) => {
    console.warn(`[plugins] ${message}`, detail);
  },
};

export class PluginStore {
  private entries: ReadonlyMap<string, PluginEntry> = new Map();
  private snapshot: readonly PluginEntry[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly generation = new Map<string, number>();
  private readonly waiting: Array<() => void> = [];
  private running = 0;

  constructor(
    private readonly deps: LoaderDeps = productionDeps,
    private readonly limit: number = MAX_CONCURRENT_LOADS,
  ) {}

  /** The entries, by id. The same array until something changes. */
  getSnapshot = (): readonly PluginEntry[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Starts loading a plugin that is not known yet. A plugin that is loading, ready or failed is left alone: retry is explicit. */
  async load(descriptor: PluginDescriptor): Promise<void> {
    if (this.entries.has(descriptor.id)) {
      return Promise.resolve();
    }

    return this.start(descriptor);
  }

  /** Loads a plugin again from its files: the failed one, or one whose files changed. Its modules are dropped first, so no chunk of the old files is linked to the new. */
  async retry(descriptor: PluginDescriptor): Promise<void> {
    this.deps.clearBundle(descriptor.id);
    return this.start(descriptor);
  }

  /**
   * The plugin stopped serving the window (`plugin/unloaded`, `lifecycle.ts`): what it drew goes through the paths that already know a plugin with no contribution, in the same transaction, and its modules
   * are dropped. A plugin whose process crashed and one that is reloading are plugins the window will want again, so they stay as a failed entry of the kind `unloaded` that says why in the host's words
   * (`revive` loads it when it runs); the first cause stands until then, so the recovery of a crash, which reloads the plugin, does not turn "stopped unexpectedly" into "reloading". A plugin that was
   * uninstalled or turned off is not a failure: the store forgets it, as it would not have it if the window had opened now, and what loads it again is the inventory. A load that was on its way is
   * dropped, and a plugin the store has no entry for has nothing to drop.
   */
  unload(id: string, cause: UnloadCause): void {
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return;
    }

    if (cause === 'crashed' || cause === 'reloaded') {
      if (entry.phase === 'failed' && entry.failure.kind === 'unloaded') {
        return;
      }

      this.supersede(id);
      this.set({ id, name: entry.name, phase: 'failed', failure: unloadedFailure(cause) });
      return;
    }

    this.supersede(id);
    this.forget(id);
  }

  /**
   * The plugin runs again (`plugin/state_change` to Running): a plugin that was gone loads again from its files. A plugin that is ready, loading, or failed to load on its own is left alone (a retry is
   * explicit), as is one the store has no entry for: the inventory loads that.
   */
  async revive(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry?.phase !== 'failed' || entry.failure.kind !== 'unloaded') {
      return;
    }

    return this.retry({ id, name: entry.name });
  }

  /** The answers of loads that are on their way are stale from now on, and so are the modules of what they were loading. */
  private supersede(id: string): void {
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1);
    this.deps.clearBundle(id);
  }

  private async start(descriptor: PluginDescriptor): Promise<void> {
    const generation = (this.generation.get(descriptor.id) ?? 0) + 1;
    this.generation.set(descriptor.id, generation);
    this.set({ ...descriptor, phase: 'loading' });
    return this.run(descriptor, generation);
  }

  private async run(descriptor: PluginDescriptor, generation: number): Promise<void> {
    await this.acquire();
    try {
      const exports = await this.deps.importBundle(descriptor.id);
      this.settle(descriptor, generation, { ...descriptor, phase: 'ready', contribution: admitOrThrow(exports) });
    } catch (error) {
      const failure = classify(error);
      this.deps.log(`plugin "${descriptor.id}" did not load (${failure.kind})`, { failure, error });
      this.settle(descriptor, generation, { ...descriptor, phase: 'failed', failure });
    } finally {
      this.release();
    }
  }

  /** An answer for a load that a later one superseded is dropped. */
  private settle(descriptor: PluginDescriptor, generation: number, entry: PluginEntry): void {
    if (this.generation.get(descriptor.id) === generation) {
      this.set(entry);
    }
  }

  /** A slot of the pool. When the pool is full the slot is handed over by whoever finishes, so the count never exceeds the limit between the two. */
  private async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next === undefined) {
      this.running -= 1;
    } else {
      next();
    }
  }

  private set(entry: PluginEntry): void {
    this.publish(new Map(this.entries).set(entry.id, entry));
  }

  private forget(id: string): void {
    const next = new Map(this.entries);
    next.delete(id);
    this.publish(next);
  }

  private publish(entries: ReadonlyMap<string, PluginEntry>): void {
    this.entries = entries;
    this.snapshot = [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
    for (const listener of this.listeners) {
      listener();
    }
  }
}
