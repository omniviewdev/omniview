import { validateExtensionName } from './utils';
import { type CreateExtensionPointOptions, ExtensionPointStore, type ExtensionPointSettings } from '../types/extensions';

type CreateExtensionPointRegistryOptions = {
  initialStores: Array<CreateExtensionPointOptions<any>>;
};

/**
 * A registry for extension points.
 */
export class ExtensionPointRegistry {
  private store: Record<string, ExtensionPointStore<any>> = {};

  constructor({ initialStores }: CreateExtensionPointRegistryOptions) {
    initialStores.forEach((store) => {
      this.addExtensionPoint(store);
    });
  }

  /**
   * Add a new extension point to the registry. If the extension point already exists, it will not be
   * added again.
   * @param opts The settings for the extension point
   */
  addExtensionPoint<T>(opts: ExtensionPointSettings): void {
    let validated = validateExtensionName(opts.id);
    console.log('validated', validated);
    console.log('store', this.store);
    if (this.store[validated]) {
      console.warn(`Extension point ${validated} already exists. Not adding again.`);
      return
    }

    this.store[validated] = new ExtensionPointStore<T>(opts);
  }

  /**
   * Get an extension point from the registry.
   */
  getExtensionPoint<T>(name: string): ExtensionPointStore<T> | undefined {
    name = validateExtensionName(name);
    return this.store[name];
  }

  /**
   * List all extension points in the registry.
   */
  listExtensionPointIds(): string[] {
    return Object.keys(this.store);
  }

  // /**
  //  * List extension points, grouped by owner
  //  */
  // listExtensionPointsByOwner(): Record<string, ExtensionPointSettings[]> {
  //   const byOwner: Record<string, ExtensionPointSettings[]> = {};
  //   Object.values(this.store).forEach((store) => {
  //     const owner = store.settings().owner;
  //     if (!byOwner[owner]) {
  //       byOwner[owner] = [];
  //     }
  //
  //     byOwner[owner].push(store.settings());
  //   });
  //   return byOwner;
  // }

  /**
   * List all extensions in the registry.
   */
  listExtensionPoints(): ExtensionPointSettings[] {
    return Object.values(this.store).map((store) => store.settings());
  }
}
