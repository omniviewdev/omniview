import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Exposes `virtual:wails-binding-index`: generated binding method IDs mapped to
 * "<path under the omniview module>.<Method>", e.g.
 * 3093409425 -> "backend/pkg/plugin/resource/servicewrapper.List".
 * The fake backend uses it to route `Call.ByID` to fixture handlers by name.
 */
export function wailsBindingIndex(bindingsRoot: string): Plugin {
  const id = 'virtual:wails-binding-index';
  const resolved = '\0' + id;
  return {
    name: 'wails-binding-index',
    resolveId: (source) => (source === id ? resolved : undefined),
    load(source) {
      if (source !== resolved) return;
      const index: Record<string, string> = {};
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) { walk(full); continue; }
          if (!entry.name.endsWith('.ts')) continue;
          const module = path.relative(bindingsRoot, full).replace(/\.ts$/, '');
          const src = fs.readFileSync(full, 'utf8');
          // Lazy match up to the body: signatures can contain `{`/`)` (map types, `{ [_ in string]?: T }`).
          for (const m of src.matchAll(/export function (\w+)\([^]*?\{\s*return \$Call\.ByID\((\d+)/g)) {
            index[m[2]] = `${module}.${m[1]}`;
          }
        }
      };
      walk(bindingsRoot);
      return `export default ${JSON.stringify(index)};`;
    },
  };
}
