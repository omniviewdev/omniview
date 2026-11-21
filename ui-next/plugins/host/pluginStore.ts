import { admitOrThrow } from '../contract/admit';
import type { ContributionV1 } from '../contract/v1';
import { classify, unloadedFailure, type GoneCause, type LoadFailure, type UnloadCause } from '../loader/failure';

// What the host knows about each installed plugin's interface: loading, ready with its contribution, or failed with why. Framework-free (React reads it
// through `useSyncExternalStore`), and the loader is injected, so the rules here (bounded parallel loads, one load per plugin at a time, a retry that
// supersedes a stale answer) are tests with no bundle and no browser. The engine properties are the old shell's (docs/ui-next/optimisations.md
// HSH-9, HSH-11): loads run in a bounded pool, the shell never waits for them, and an upgrade clears the plugin's modules before it loads again.

export type PluginDescriptor = {
  readonly id: string;
  /** The name the plugin's manifest gives it: how a frame is named before (or without) its contribution. */
  readonly name: string;
  /**
   * The host holds the plugin as failed (`inventory.ts`): its load failed before the window asked, at the start of the host or while the window was away. The store shows it so from the first and reads no interface until the plugin runs: a
   * plugin that did not start has no process behind its pages, and the host's events do not reach a window that was not open.
   */
  readonly failed?: boolean | undefined;
};

/** What an entry says of the plugin it is for: the identity of its descriptor and no more. */
type Named = Pick<PluginDescriptor, 'id' | 'name'>;

const named = (descriptor: PluginDescriptor): Named => ({ id: descriptor.id, name: descriptor.name });

export type PluginEntry = Named &
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

/**
 * Asks the host to start a plugin again: the host's own retry (`PluginManager.RetryFailedPlugin`), which cancels the recovery of a crash it may be running, stops what is left of the plugin and loads it. Resolves whether the plugin runs
 * when the call ends; rejects when the host could not. Its answer is a phase and its failure is the host's text, which the store never shows.
 */
export type HostRetry = (id: string) => Promise<boolean>;

/** The production host retry. The runtime's bindings are imported on the first Retry, as the loader is on the first load: a store that retries nothing does not carry them. */
export const productionRetry: HostRetry = async (id) => {
  const { PluginManager } = await import('@omniviewdev/runtime/api');
  return (await PluginManager.RetryFailedPlugin(id)).phase === 'Running';
};

/**
 * Whether what the host says of a plugin that is already gone replaces what its entry says. The first cause of a crash stands against what follows it, which is the host recovering the plugin (a reload, and each attempt that
 * fails): the plugin still stopped unexpectedly. A reload that is under way ends in what the host says of its load; a load that failed gives way to the next attempt when the host reloads the plugin again; what the host says twice
 * changes nothing.
 */
function supersedes(told: GoneCause, held: GoneCause | undefined): boolean {
  switch (held) {
    case 'reloaded':
      return told === 'failed' || told === 'timeout';
    case 'failed':
    case 'timeout':
      return told !== 'crashed' && told !== held;
    case 'crashed':
    case undefined:
      return false;
  }
}

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
    private readonly retryHost: HostRetry = productionRetry,
  ) {}

  /** The entries, by id. The same array until something changes. */
  getSnapshot = (): readonly PluginEntry[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Starts loading a plugin that is not known yet. A plugin that is loading, ready or failed is left alone: retry is explicit. A plugin the host holds as failed (`PluginDescriptor.failed`) is a failed entry of the kind `unloaded` from the
   * first and its interface is not read: `revive` loads it when the host says it runs, and `retry` asks the host to start it.
   */
  async load(descriptor: PluginDescriptor): Promise<void> {
    if (this.entries.has(descriptor.id)) {
      return Promise.resolve();
    }

    if (descriptor.failed === true) {
      this.set({ ...named(descriptor), phase: 'failed', failure: unloadedFailure('failed') });
      return Promise.resolve();
    }

    return this.start(descriptor);
  }

  /**
   * The Retry of a plugin that did not come up. A plugin the host says is not there (it crashed, or its load failed or ran out of time: the kind `unloaded`) is the host's to start again, so the host is asked and the entry says it is
   * starting again until the host answers (`restart`). Any other plugin that did not load had an interface that failed, which is read again from its files.
   */
  async retry(descriptor: PluginDescriptor): Promise<void> {
    const entry = this.entries.get(descriptor.id);
    if (entry?.phase === 'failed' && entry.failure.kind === 'unloaded') {
      // A plugin the host is already starting again is not asked twice: two presses of the Retry in a frame are one request.
      return entry.failure.cause === 'reloaded' ? Promise.resolve() : this.restart(descriptor);
    }

    return this.reload(descriptor);
  }

  /**
   * The plugin stopped serving the window or could not start (`plugin/unloaded`, `lifecycle.ts`): what it drew goes through the paths that already know a plugin with no contribution, in the same transaction, and its modules
   * are dropped. A plugin whose process crashed, one that is reloading and one whose load failed or ran out of time are plugins the window will want again, so they stay as a failed entry of the kind `unloaded` that says why in the
   * host's own words (`revive` loads it when it runs, `retry` asks the host to start it). What an entry already says gives way to what the host says next only where that is news (`supersedes`): the first cause of a crash stands until the
   * plugin runs, so the recovery of a crash, which reloads the plugin, does not turn "stopped unexpectedly" into "reloading" or into "did not start". A plugin that was uninstalled or turned off is not a failure: the store forgets it, as it would
   * not have it if the window had opened now, and what loads it again is the inventory. A load that was on its way is dropped, and a plugin the store has no entry for has nothing to drop.
   */
  unload(id: string, cause: UnloadCause): void {
    const entry = this.entries.get(id);
    if (entry === undefined) {
      return;
    }

    if (cause === 'uninstalled' || cause === 'disabled') {
      this.supersede(id);
      this.forget(id);
      return;
    }

    if (entry.phase === 'failed' && entry.failure.kind === 'unloaded' && !supersedes(cause, entry.failure.cause)) {
      return;
    }

    this.supersede(id);
    this.set({ id, name: entry.name, phase: 'failed', failure: unloadedFailure(cause) });
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

    return this.reload({ id, name: entry.name });
  }

  /**
   * The host starts a plugin that is gone again. The entry says it is starting again from the moment the Retry is pressed, so there is progress to see and no second Retry to press, and it ends in what the host says: that the plugin runs (the call
   * answers it, and `plugin/state_change` says it; whichever comes first loads the interface, `revive` once), or that its load failed again (`plugin/unloaded`, told while the call is in flight). When the host says neither, the end of the call is the
   * exit: a call that fails or answers that the plugin does not run is a load that failed. The words of a failed call are the log's, never the entry's.
   */
  private async restart(descriptor: PluginDescriptor): Promise<void> {
    const { id } = descriptor;
    this.set({ ...named(descriptor), phase: 'failed', failure: unloadedFailure('reloaded') });
    let runs = false;
    try {
      runs = await this.retryHost(id);
    } catch (error) {
      this.deps.log(`plugin "${id}" did not start again`, { error });
    }

    if (runs) {
      return this.revive(id);
    }

    const entry = this.entries.get(id);
    if (entry?.phase === 'failed' && entry.failure.kind === 'unloaded' && entry.failure.cause === 'reloaded') {
      this.set({ id, name: entry.name, phase: 'failed', failure: unloadedFailure('failed') });
    }
  }

  /** Loads a plugin again from its files: the failed one, or one whose files changed. Its modules are dropped first, so no chunk of the old files is linked to the new. */
  private async reload(descriptor: PluginDescriptor): Promise<void> {
    this.deps.clearBundle(descriptor.id);
    return this.start(descriptor);
  }

  /** The answers of loads that are on their way are stale from now on, and so are the modules of what they were loading. */
  private supersede(id: string): void {
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1);
    this.deps.clearBundle(id);
  }

  private async start(descriptor: PluginDescriptor): Promise<void> {
    const generation = (this.generation.get(descriptor.id) ?? 0) + 1;
    this.generation.set(descriptor.id, generation);
    this.set({ ...named(descriptor), phase: 'loading' });
    return this.run(descriptor, generation);
  }

  private async run(descriptor: PluginDescriptor, generation: number): Promise<void> {
    await this.acquire();
    try {
      const exports = await this.deps.importBundle(descriptor.id);
      this.settle(descriptor, generation, { ...named(descriptor), phase: 'ready', contribution: admitOrThrow(exports) });
    } catch (error) {
      const failure = classify(error);
      this.deps.log(`plugin "${descriptor.id}" did not load (${failure.kind})`, { failure, error });
      this.settle(descriptor, generation, { ...named(descriptor), phase: 'failed', failure });
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
