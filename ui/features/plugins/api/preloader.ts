import { shared } from './shared_dependencies';
import { SystemJS } from './systemjs';
import { buildImportMap } from './utils';

export function preloadSharedDeps() {
  const imports = buildImportMap(shared);
  console.debug('[PluginService] preloaded shared deps import map', { count: Object.keys(imports).length });
  SystemJS.addImportMap({ imports });
}
