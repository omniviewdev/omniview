import { validateExtensionName } from './utils';
import {
  type ExtensionPointSettings,
  type ExtensionPointRegistryContract,
  type ExtensionPointStoreContract,
  type ExtensionRenderContext,
  ExtensionPointStore,
} from '../types/extensions';

/**
 * A registry for extension points.
 *
 * - Throws on duplicate extension point IDs instead of overwriting.
 * - Supports removeExtensionPoints(pluginId) and removeContributions(pluginId).
 * - Provides subscriptions so consumers can rerender on changes.
 */
export class ExtensionPointRegistry implements ExtensionPointRegistryContract {
  private _stores = new Map<string, ExtensionPointStore<any, any>>();
  private _listeners = new Set<() => void>();

  constructor(opts?: { initialStores?: Array<ExtensionPointSettings<any, any>> }) {
    if (opts?.initialStores) {
      for (const store of opts.initialStores) {
        this.addExtensionPoint(store);
      }
    }
  }

  /**
   * Add a new extension point to the registry.
   * Throws if the extension point ID already exists.
   */
  addExtensionPoint<TValue = unknown, TContext = ExtensionRenderContext>(
    settings: ExtensionPointSettings<TContext, TValue> & { pluginId?: string },
  ): void {
    const id = validateExtensionName(settings.id);
    if (this._stores.has(id)) {
      const existing = this._stores.get(id)!;
      throw new Error(
        `Extension point "${id}" already exists (owned by "${existing.pluginId ?? 'unknown'}")`,
      );
    }

    this._stores.set(id, new ExtensionPointStore<TValue, TContext>({ ...settings, id }));
    this._notify();
  }

  /**
   * Get an extension point store by ID.
   */
  getExtensionPoint<TValue = unknown, TContext = ExtensionRenderContext>(
    id: string,
  ): ExtensionPointStoreContract<TValue, TContext> | undefined {
    const validated = validateExtensionName(id);
    return this._stores.get(validated) as
      | ExtensionPointStore<TValue, TContext>
      | undefined;
  }

  /**
   * Check if an extension point exists.
   */
  hasExtensionPoint(id: string): boolean {
    const validated = validateExtensionName(id);
    return this._stores.has(validated);
  }

  /**
   * List all extension point IDs.
   */
  listExtensionPoints(): string[] {
    return Array.from(this._stores.keys());
  }

  /**
   * Remove all extension points owned by the given plugin.
   */
  removeExtensionPoints(pluginId: string): void {
    let changed = false;
    for (const [id, store] of this._stores) {
      if (store.pluginId === pluginId) {
        this._stores.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this._notify();
    }
  }

  /**
   * Remove all contributions from the given plugin across all extension points.
   */
  removeContributions(pluginId: string): void {
    for (const store of this._stores.values()) {
      store.removeContributionsByPlugin(pluginId);
    }
    // Store-level notifications handle individual store subscribers.
    // Registry-level notification for registry subscribers.
    this._notify();
  }

  /**
   * Subscribe to registry-level changes (extension points added/removed, contributions changed).
   * Returns an unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private _notify(): void {
    for (const listener of this._listeners) {
      listener();
    }
  }
}
