export type ExtensionRegistrySettings = {
  /**
  * The ID of the extension point
  */
  id: string;

  /**
  * The human readable label for the extension point
  */
  name: string;

  /**
  * A description of the extension point
  */
  description?: string;

  /**
  * Set the extension point to support rendering multiple components or a single component.
  */
  mode: 'single' | 'multiple';

  /**
  * Disable the extension point to prevent rendering components.
  * This is useful when the extension point should be disabled temporarily.
  */
  disabled?: boolean;

  /**
  * Selected component to render when the extension point is in single-component mode.
  */
  selected?: string;

  /**
  * The order in which the components should be rendered when the extension point is in multiple-component mode.
  */
  order?: string[];
};

/**
 * Options required during registration of the extension to the extension point's registry.
 */
export type RegisterOpts<Props> = {
  /**
   * The ID of the registered component
   */
  id: string;

  /**
   * The plugin that owns the view
   */
  plugin: string;

  /**
   * The human readable label for the component
   */
  label: string;

  /**
   * A description of the component
   */
  description?: string;

  /**
   * The component to render
   */
  component: React.Component<Props>;

  /**
   * Additional optional metadata for the component
   */
  meta?: unknown;
};

export type Registration<Props> = RegisterOpts<Props> & {
  /**
  * The time the component was registered
  */
  registeredAt: Date;

  /**
  * The time the component was last updated
  * This will be the same as `registeredAt` if the component has not been updated
  */
  updatedAt: Date;

  /**
  * Whether the component is enabled
  * This can be used to disable a component without unregistering it.
  */
  enabled?: boolean;
};

/**
 * Context that can be passed to the registry to provide additional information to the matcher.
 * The context should generate a cache key that can be used to cache the results of the matcher
 * to avoid recalculating the same result multiple times.
 */
export type ExtensionRenderContext = {
  getCacheKey: () => string;
};

export type CreateExtensionRegistryOptions<ComponentProps> = ExtensionRegistrySettings & {
  /**
   * Define a custom matcher to use to find which extensions to register based on any number of args.
   * This is useful when the extension should only be registered for certain resources, like for example
   * when a registry contains components that should only be rendered for specific resources.
   *
   * @param context The context to use to determine if the extension should be registered. The extension point
   *                renderer will call this function with the context provided by the extension point.
   * @param item The item to check if it should be registered
   * @returns Whether the item should be registered
   */
  matcher?: (context: ExtensionRenderContext, item: Registration<ComponentProps>) => boolean;
};

/**
 * A registry to hold an extension points registered extensions, providing type safe access to the components.
 *
 * @param ComponentProps The props type for the component that is registered in the registry.
 */
export class ExtensionRegistryStore<ComponentProps> {
  private readonly _settings: ExtensionRegistrySettings;
  private readonly _extensions = new Map<string, Registration<ComponentProps>>();
  private readonly _lookupCache = new Map<string, string[]>();
  private readonly _matchCache = new Map<string, boolean>();
  private readonly _matcher?: (context: ExtensionRenderContext, item: Registration<ComponentProps>) => boolean;

  constructor(opts: CreateExtensionRegistryOptions<ComponentProps>) {
    const { matcher, ...settings } = opts;
    this._settings = settings;
    this._matcher = opts.matcher;
  }

  settings(): ExtensionRegistrySettings {
    return this._settings;
  }

  /**
  * Registers a new component within the registry. Throws an error if a component with the same ID already exists.
  * This method should be used when initializing components or dynamically adding new components at runtime.
  *
  * @param opts The registration options for the component, containing its ID, plugin, and other metadata.
  * @throws Error if a component with the same ID is already registered.
  * @example
  * registry.register({
  *   id: 'unique-sidebar-item',
  *   plugin: 'examplePlugin',
  *   label: 'My Sidebar Item',
  *   component: MyComponent,
  * });
  */
  register(opts: RegisterOpts<ComponentProps>) {
    if (this._extensions.get(opts.id)) {
      throw new Error(`Resource sidebar view with id ${opts.id} already exists`);
    }

    const registration: Registration<ComponentProps> = {
      ...opts,
      registeredAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    };

    this._extensions.set(opts.id, registration);

    const keys = Array.from(this._matchCache.keys());
    for (const key of keys) {
      if (key.startsWith(opts.plugin)) {
        this._matchCache.delete(key);
      }
    }
  }

  /**
  * Unregisters a component from the registry by its ID. Useful for cleanup or when components are dynamically removed.
  *
  * @param id The ID of the component to unregister.
  * @example
  * registry.unregister('unique-sidebar-item');
  */
  unregister(id: string) {
    this._extensions.delete(id);
  }


  /**
  * Retrieves a component by its ID from the registry. Returns undefined if no such component exists.
  *
  * @param id The ID of the component to retrieve.
  * @returns The component associated with the given ID, or undefined if not found.
  * @example
  * const component = registry.get('unique-sidebar-item');
  * if (component) {
  *   render(component);
  * }
  */
  get(id: string) {
    return this._extensions.get(id)?.component;
  }

  /**
  * Lists all registered components in the registry. Useful for debugging or generating summaries of available components.
  *
  * @returns An array of all registered components.
  * @example
  * const allComponents = registry.list();
  * console.log('Registered Components:', allComponents);
  */
  list() {
    return Array.from(this._extensions.values());
  }

  generateMatchCacheKey(item: Registration<ComponentProps>) {
    return `${item.plugin}/${item.id}`;
  }

  /**
   * Calculate the matches for the given context.
   */
  calculateMatches(context: ExtensionRenderContext) {
    // check the cache first
    if (!this._matcher) {
      // all items match
      return Array.from(this._extensions.values());
    }


    const matched: Array<Registration<ComponentProps>> = [];
    for (const item of this._extensions.values()) {
      const matchCacheKey = this.generateMatchCacheKey(item);
      const hasCachedMatch = this._matchCache.has(matchCacheKey);

      // depending on how complex the matcher is, the matching logic may take a bit, so we'll cache
      // both the individual matches to speed things up for a large amount of extensions.
      if (hasCachedMatch && this._matchCache.get(matchCacheKey)) {
        matched.push(item);
        continue;
      }

      if (this._matcher(context, item)) {
        // add to the match cache
        this._matchCache.set(matchCacheKey, true);
        matched.push(item);
      } else if (!hasCachedMatch) {
        this._matchCache.set(matchCacheKey, false);
      }
    }

    return matched;
  }

  /**
   * Preload the registry caches with the given expected context to avoid on-first-request calculation.
   * This is useful when the registry is used to provide components for a specific context, like for
   * specific resources types.
   *
   * If the cache is already populated for the expected context, the cache key will be recalculated.
   *
   * @param context The context expected to be called preload the registry with on provide.
   */
  preload(context: ExtensionRenderContext) {
    const matched = this.calculateMatches(context);
    const cacheKey = context.getCacheKey();
    this._lookupCache.set(cacheKey, matched.map((view) => view.id));
  }

  /**
   * Provide the components that match the given context.
   */
  provide(context: ExtensionRenderContext): Array<React.Component<ComponentProps>> {
    if (this._settings.disabled) {
      return [];
    }

    if (this._settings.mode === 'single') {
      const selected = this._extensions.get(this._settings.selected!);
      if (selected) {
        return [selected.component];
      }

      return [];
    }

    // check the cache first
    const cacheKey = context.getCacheKey();
    let ids = this._lookupCache.get(cacheKey);

    if (ids) {
      let components = ids.map((id) => this._extensions.get(id))
        .filter((v): v is Registration<ComponentProps> => !!v)
        .map((v) => v.component);

      if (this._settings.order) {
        components = this.reorderComponents(components, ids, this._settings.order);
      }

      return components;
    }

    ids = this.calculateMatches(context).map((view) => view.id);
    this._lookupCache.set(cacheKey, ids);

    // if the order is set, reorder the components
    let components = ids.map((id) => this._extensions.get(id))
      .filter((v): v is Registration<ComponentProps> => !!v)
      .map((v) => v.component);

    // Reorder components if order is set
    if (this._settings.order) {
      components = this.reorderComponents(components, ids, this._settings.order);
    }

    return components;
  }

  reorderComponents(components: Array<React.Component<ComponentProps>>, ids: string[], order: string[]): Array<React.Component<ComponentProps>> {
    const idToComponentMap = new Map(ids.map((id, index) => [id, components[index]]));
    return order.map((id) => idToComponentMap.get(id)).filter((component): component is React.Component<ComponentProps> => !!component);
  }

  /**
   * Reorder the components in the registry based on the given order.
   */
  reorder(order: string[]) {
    const reordered = order
      .map((id) => this._extensions.get(id))
      .filter((v): v is Registration<ComponentProps> => !!v);

    const missing = Array.from(this._extensions.values()).filter((v) => !order.includes(v.id));
    const ordered = [...reordered, ...missing];

    this._extensions.clear();
    ordered.forEach((v) => this._extensions.set(v.id, v));

    // reorder the lookup cache entries
    const keys = Array.from(this._lookupCache.keys());
    for (const key of keys) {
      const ids = this._lookupCache.get(key);
      if (!ids) {
        continue;
      }

      const reorderedIds = ids.filter((id) => order.includes(id));
      this._lookupCache.set(key, reorderedIds);
    }
  }

  clearLookupCache() {
    this._lookupCache.clear();
  }

  clearMatchCache() {
    this._matchCache.clear();
  }

  clearAllCaches() {
    this.clearLookupCache();
    this.clearMatchCache();
  }
}
