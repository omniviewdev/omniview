import { shared } from './shared_dependencies';
import { SystemJS } from './systemjs';
import { buildImportMap } from './utils';

export function preloadSharedDeps() {
  const imports = buildImportMap(shared);
  console.log("got import map", imports)
  SystemJS.addImportMap({ imports });
}
