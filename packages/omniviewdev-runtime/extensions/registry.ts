import { validateExtensionName } from './utils';
import { type CreateExtensionRegistryOptions, ExtensionRegistryStore, type ExtensionRegistrySettings } from './store';
import stores from './defaultStores';

type CreateExtensionPointRegistryOptions = {
  initialStores: Array<CreateExtensionRegistryOptions<any>>;
};


/**
 * A registry for extension points.
 */
export class ExtensionPointRegistry {
  private store: Record<string, ExtensionRegistryStore<any>> = {};

  constructor({ initialStores = stores }: CreateExtensionPointRegistryOptions) {
    initialStores.forEach((store) => {
      this.addExtensionPoint(store);
    });
  }

  /**
   * Add a new extension point to the registry. If the extension point already exists, it will return the existing store.
   * @param opts The settings for the extension point
   */
  addExtensionPoint<T>(opts: ExtensionRegistrySettings): ExtensionRegistryStore<T> {
    let validated = validateExtensionName(opts.id);
    console.log('validated', validated);
    console.log('store', this.store);
    if (!this.store[validated]) {
      this.store[validated] = new ExtensionRegistryStore<T>(opts);
    }

    return this.store[validated];
  }

  /**
   * Get an extension point from the registry.
   */
  getExtensionPoint<T>(name: string): ExtensionRegistryStore<T> {
    name = validateExtensionName(name);
    return this.store[name];
  }

  /**
   * List all extension points in the registry.
   */
  listExtensionPointIds(): string[] {
    return Object.keys(this.store);
  }

  /**
   * List extension points, grouped by owner
   */
  listExtensionPointsByOwner(): Record<string, ExtensionRegistrySettings[]> {
    const byOwner: Record<string, ExtensionRegistrySettings[]> = {};
    Object.values(this.store).forEach((store) => {
      const owner = store.settings().owner;
      if (!byOwner[owner]) {
        byOwner[owner] = [];
      }

      byOwner[owner].push(store.settings());
    });
    return byOwner;
  }

  /**
   * List all extensions in the registry.
   */
  listExtensionPoints(): ExtensionRegistrySettings[] {
    return Object.values(this.store).map((store) => store.settings());
  }
}
