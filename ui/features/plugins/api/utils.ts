// import { SHARED_DEPENDENCY_PREFIX } from "./constants";

export function buildImportMap(importMap: Record<string, System.Module>) {
  return Object.keys(importMap).reduce<Record<string, string>>((acc, key) => {
    const module_name = `${key}`;

    // expose dependency to loaders
    addPreload(module_name, importMap[key]);

    acc[key] = module_name;
    return acc;
  }, {});
}

function addPreload(id: string, preload: (() => Promise<System.Module>) | System.Module) {
  if (System.has(id)) {
    return;
  }

  let resolvedId;
  try {
    resolvedId = System.resolve(id);
  } catch (e) {
    console.log(e);
  }

  if (resolvedId && System.has(resolvedId)) {
    return;
  }

  const moduleId = resolvedId || id;
  if (typeof preload === 'function') {
    System.register(id, [], (_export) => {
      return {
        execute: async function () {
          const module = await preload();
          _export(module);
        },
      };
    });
  } else {
    System.set(moduleId, preload);
  }
}
