// import { SHARED_DEPENDENCY_PREFIX } from "./constants";
import { SystemJS } from "./systemjs";

export function buildImportMap(importMap: Record<string, System.Module>) {
  return Object.keys(importMap).reduce<Record<string, string>>((acc, key) => {
    const module_name = `shared://${key}`;

    // expose dependency to loaders
    addPreload(module_name, importMap[key]);

    acc[key] = module_name;
    return acc;
  }, {});
}

function addPreload(id: string, preload: (() => Promise<System.Module>) | System.Module) {
  if (SystemJS.has(id)) {
    return;
  }

  let resolvedId;
  try {
    resolvedId = System.resolve(id);
  } catch (e) {
    console.debug('[PluginService] SystemJS resolve failed for', id, e);
  }

  if (resolvedId && System.has(resolvedId)) {
    return;
  }

  const moduleId = resolvedId || id;
  if (typeof preload === 'function') {
    console.debug(`[PluginService] registering preload function for module ${id}`);
    SystemJS.register(id, [], (_export: any) => {
      return {
        execute: async function () {
          const module = await preload();
          _export(module);
        },
      };
    });
  } else {
    console.debug(`[PluginService] registering preload for module ${moduleId}`);
    SystemJS.set(moduleId, preload);
  }
}
