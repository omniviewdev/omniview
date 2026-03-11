/**
 * Context that can be passed to the registry to provide additional information to the matcher.
 * The context should generate a cache key that can be used to cache the results of the matcher
 * to avoid recalculating the same result multiple times.
 */
export type ExtensionRenderContext = {
  getCacheKey?(): string;
};

/**
 * A contribution registration entry stored within an extension point store.
 * Generic over TValue — not limited to React components.
 */
export interface ExtensionContributionRegistration<TValue = unknown> {
  id: string;
  plugin: string;
  label: string;
  value: TValue;
  meta?: unknown;
}

/**
 * Settings for defining an extension point.
 * Generic over TContext (the render/lookup context) and TValue (what contributions hold).
 */
export interface ExtensionPointSettings<
  TContext = ExtensionRenderContext,
  TValue = unknown,
> {
  /** Unique extension point identifier */
  id: string;

  /** The plugin (or 'core') that owns this extension point */
  pluginId?: string;

  /** Whether this extension point resolves one or many contributions */
  mode?: 'single' | 'multiple';

  /**
   * Filter contributions for a given context. Applied in both single and multiple modes.
   */
  matcher?: (
    contribution: ExtensionContributionRegistration<TValue>,
    context?: TContext,
  ) => boolean;

  /**
   * In single mode, select which of the matched contributions to return.
   * If not provided, the first match in deterministic order is used.
   */
  select?: (
    contributions: ExtensionContributionRegistration<TValue>[],
    context?: TContext,
  ) => ExtensionContributionRegistration<TValue> | undefined;
}

/**
 * A registration entry that a plugin exports to register a value into an extension point.
 * The host app processes these at plugin load time.
 */
export type ExtensionRegistration<TValue = unknown> = {
  /** The ID of the extension point to register into */
  extensionPointId: string;
  /** The registration options */
  registration: Omit<ExtensionContributionRegistration<TValue>, 'plugin'> & {
    plugin?: string;
  };
};

/**
 * Store contract for an extension point.
 * Generic over TValue (what contributions hold) and TContext (the lookup context).
 */
export interface ExtensionPointStoreContract<
  TValue = unknown,
  TContext = ExtensionRenderContext,
> {
  readonly id: string;
  readonly mode: 'single' | 'multiple';

  /** The plugin (or 'core') that owns this extension point, if set. */
  readonly pluginId?: string;

  /** Monotonically increasing version — increments on every mutation. */
  readonly version: number;

  register(contribution: ExtensionContributionRegistration<TValue>): void;
  unregister(contributionId: string): void;

  provide(context?: TContext): TValue[];
  list(context?: TContext): ExtensionContributionRegistration<TValue>[];
  listAll(): ExtensionContributionRegistration<TValue>[];

  subscribe(listener: () => void): () => void;
}

/**
 * Registry contract for managing extension points.
 */
export interface ExtensionPointRegistryContract {
  addExtensionPoint<TValue = unknown, TContext = ExtensionRenderContext>(
    settings: ExtensionPointSettings<TContext, TValue> & { pluginId?: string },
  ): void;

  getExtensionPoint<TValue = unknown, TContext = ExtensionRenderContext>(
    id: string,
  ): ExtensionPointStoreContract<TValue, TContext> | undefined;

  hasExtensionPoint(id: string): boolean;
  listExtensionPoints(): string[];

  removeExtensionPoints(pluginId: string): void;
  removeContributions(pluginId: string): void;

  subscribe(listener: () => void): () => void;
}

/**
 * A registry to hold an extension point's registered contributions, providing type safe access.
 *
 * Generic over TValue (what contributions hold) and TContext (the lookup context).
 */
export class ExtensionPointStore<TValue = unknown, TContext = ExtensionRenderContext>
  implements ExtensionPointStoreContract<TValue, TContext>
{
  readonly id: string;
  readonly mode: 'single' | 'multiple';

  private readonly _pluginId?: string;
  private _version = 0;
  private readonly _contributions = new Map<string, ExtensionContributionRegistration<TValue>>();
  private readonly _lookupCache = new Map<string, string[]>();
  private readonly _matcher?: (
    contribution: ExtensionContributionRegistration<TValue>,
    context?: TContext,
  ) => boolean;
  private readonly _select?: (
    contributions: ExtensionContributionRegistration<TValue>[],
    context?: TContext,
  ) => ExtensionContributionRegistration<TValue> | undefined;
  private readonly _listeners = new Set<() => void>();

  constructor(settings: ExtensionPointSettings<TContext, TValue>) {
    this.id = settings.id;
    this.mode = settings.mode ?? 'multiple';
    this._pluginId = settings.pluginId;
    this._matcher = settings.matcher;
    this._select = settings.select;
  }

  get pluginId(): string | undefined {
    return this._pluginId;
  }

  get version(): number {
    return this._version;
  }

  /**
   * Register a contribution. Throws if the contribution ID already exists.
   */
  register(contribution: ExtensionContributionRegistration<TValue>): void {
    if (this._contributions.has(contribution.id)) {
      throw new Error(
        `Contribution with id "${contribution.id}" already exists in extension point "${this.id}"`,
      );
    }
    this._contributions.set(contribution.id, contribution);
    this._invalidateCache();
    this._notify();
  }

  /**
   * Unregister a contribution by ID.
   */
  unregister(contributionId: string): void {
    if (this._contributions.delete(contributionId)) {
      this._invalidateCache();
      this._notify();
    }
  }

  /**
   * Synchronously provide matched values for the given context.
   * In single mode, matcher is applied first, then select (or first match) picks one.
   * In multiple mode, all matched contributions are returned in deterministic order.
   */
  provide(context?: TContext): TValue[] {
    const matched = this._getMatched(context);
    return matched.map((c) => c.value);
  }

  /**
   * Synchronously list matched contribution registrations for the given context.
   */
  list(context?: TContext): ExtensionContributionRegistration<TValue>[] {
    return this._getMatched(context);
  }

  /**
   * List all contributions regardless of context/matcher.
   */
  listAll(): ExtensionContributionRegistration<TValue>[] {
    return Array.from(this._contributions.values());
  }

  /**
   * Subscribe to changes in this store. Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /**
   * Remove all contributions owned by the given plugin.
   */
  removeContributionsByPlugin(pluginId: string): void {
    let changed = false;
    for (const [id, contrib] of this._contributions) {
      if (contrib.plugin === pluginId) {
        this._contributions.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this._invalidateCache();
      this._notify();
    }
  }

  // --- private ---

  private _getMatched(context?: TContext): ExtensionContributionRegistration<TValue>[] {
    // Check cache
    const cacheKey = this._getCacheKey(context);
    if (cacheKey != null) {
      const cachedIds = this._lookupCache.get(cacheKey);
      if (cachedIds) {
        const result = cachedIds
          .map((id) => this._contributions.get(id))
          .filter((c): c is ExtensionContributionRegistration<TValue> => c != null);
        return this._applyMode(result, context);
      }
    }

    // Compute matches
    let all = this._sortDeterministic(Array.from(this._contributions.values()));

    if (this._matcher && context !== undefined) {
      all = all.filter((c) => this._matcher!(c, context));
    }

    // Cache the result
    if (cacheKey != null) {
      this._lookupCache.set(cacheKey, all.map((c) => c.id));
    }

    return this._applyMode(all, context);
  }

  private _applyMode(
    matched: ExtensionContributionRegistration<TValue>[],
    context?: TContext,
  ): ExtensionContributionRegistration<TValue>[] {
    if (this.mode === 'single') {
      if (this._select) {
        const selected = this._select(matched, context);
        return selected ? [selected] : [];
      }
      return matched.length > 0 ? [matched[0]] : [];
    }
    return matched;
  }

  /**
   * Sort contributions deterministically: plugin ascending, then id ascending.
   */
  private _sortDeterministic(
    contributions: ExtensionContributionRegistration<TValue>[],
  ): ExtensionContributionRegistration<TValue>[] {
    return [...contributions].sort((a, b) => {
      const pluginCmp = a.plugin.localeCompare(b.plugin);
      if (pluginCmp !== 0) return pluginCmp;
      return a.id.localeCompare(b.id);
    });
  }

  private _getCacheKey(context?: TContext): string | undefined {
    if (context != null && typeof context === 'object' && 'getCacheKey' in context) {
      const fn = (context as ExtensionRenderContext).getCacheKey;
      if (typeof fn === 'function') {
        return fn();
      }
    }
    return undefined;
  }

  private _invalidateCache(): void {
    this._lookupCache.clear();
  }

  private _notify(): void {
    this._version++;
    for (const listener of this._listeners) {
      listener();
    }
  }
}
