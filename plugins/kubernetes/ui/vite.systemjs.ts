// vite.plugins.systemjs-dev.ts
import { Plugin } from 'vite';

export default function systemJSDevPlugin(): Plugin {
  return {
    name: 'vite:systemjs-dev-wrapper',
    enforce: 'post',
    transform(_, id) {
      if (!id.endsWith('/entry.system.js')) return;

      // HMR-compatible System.register wrapper
      return {
        code: `
          System.register([], function (_export, _context) {
            var mod;
            return {
              setters: [],
              execute: async function () {
                mod = await import("http://localhost:15173/src${id.replace('.system.js', '.ts')}");
                _export("default", mod.default);
              }
            }
          });
        `,
        map: null,
      };
    },
    resolveId(source) {
      if (source === '/entry.system.js') {
        return source;
      }
      return null;
    },
    load(id) {
      if (id === '/entry.system.js') {
        return ''; // placeholder; actual wrapping happens in transform
      }
      return null;
    }
  };
}
