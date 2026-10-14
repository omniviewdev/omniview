// import { SHARED_DEPENDENCY_PREFIX } from "./constants";
import { systemJs } from './systemjs';

export function buildImportMap(importMap: Record<string, System.Module>) {
  return Object.keys(importMap).reduce<Record<string, string>>((acc, key) => {
    const moduleName = `shared://${key}`;

    // expose dependency to loaders
    addPreload(moduleName, importMap[key]);

    acc[key] = moduleName;
    return acc;
  }, {});
}

function addPreload(id: string, preload: (() => Promise<System.Module>) | System.Module) {
  if (systemJs.has(id)) {
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

  const moduleId = resolvedId ?? id;
  if (typeof preload === 'function') {
    console.debug(`[PluginService] registering preload function for module ${id}`);
    systemJs.register(id, [], (_export: any) => {
      return {
        execute: async function () {
          const module = await preload();
          _export(module);
        },
      };
    });
  } else {
    console.debug(`[PluginService] registering preload for module ${moduleId}`);
    systemJs.set(moduleId, preload);
  }
}
