import type { RouteObject } from 'react-router';
import type { PluginDescriptor, PluginImportOpts } from '../core/types';

/** Route metadata must not import or evaluate the feature module. */
export type BuiltinRoute = {
  readonly path?: string;
  readonly index?: true;
  readonly children?: readonly BuiltinRoute[];
};

export type BuiltinModule = {
  readonly routes: readonly BuiltinRoute[];
  readonly load: () => Promise<unknown>;
};

export type BuiltinModuleRegistry = Readonly<Record<string, BuiltinModule>>;

// Product composition lists trusted feature entrypoints without evaluating them.
export const builtinModules: BuiltinModuleRegistry = Object.freeze({
  grafana: {
    routes: [{ path: '/' }],
    load: () => import('../../builtinplugins/grafana/entry'),
  },
});

export function getBuiltinModule(key: string, registry: BuiltinModuleRegistry = builtinModules): BuiltinModule {
  if (!Object.hasOwn(registry, key)) {
    throw new Error(`Unknown built-in frontend module "${key}"`);
  }

  return registry[key];
}

export function builtinRoutes(key: string, registry: BuiltinModuleRegistry = builtinModules): RouteObject[] {
  return getBuiltinModule(key, registry).routes.map(function route(metadata): RouteObject {
    if (metadata.index) {
      return { index: true };
    }

    return { path: metadata.path, children: metadata.children?.map(route) };
  });
}

/** Resolve provenance from native inventory, never from import options or manifests. */
export function createPluginModuleResolver(deps: {
  readonly getDescriptor: (id: string) => Promise<PluginDescriptor>;
  readonly activateBackend: (id: string) => Promise<unknown>;
  readonly importExternal: (opts: PluginImportOpts) => Promise<unknown>;
  readonly registry?: BuiltinModuleRegistry;
}): (opts: PluginImportOpts) => Promise<unknown> {
  return async (opts) => {
    const descriptor = await deps.getDescriptor(opts.pluginId);
    if (opts.isCurrent && !opts.isCurrent()) {
      return undefined;
    }

    if (descriptor.origin !== 'builtin') {
      return deps.importExternal(opts);
    }

    if (descriptor.enabled === false) {
      throw new Error(`Built-in plugin "${opts.pluginId}" is disabled`);
    }

    const module = getBuiltinModule(descriptor.frontendModule ?? '', deps.registry);
    await deps.activateBackend(opts.pluginId);
    if (opts.isCurrent && !opts.isCurrent()) {
      return undefined;
    }

    return module.load();
  };
}
