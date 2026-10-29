import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const resolveDir = path.dirname(fileURLToPath(import.meta.url));

export interface SharedExports {
  names: string[];
  namespace?: Record<string, unknown>;
}

/** Inspect installed packages, never carry exports forward from an older release. */
export async function discoverExports(packageName: string): Promise<SharedExports> {
  // Styles are shared for their side effects, not JavaScript bindings.
  if (packageName.endsWith('.css')) return { names: [] };

  try {
    const namespace = await import(packageName);
    return {
      names: Object.keys(namespace).filter(name =>
        name !== '__esModule' && name !== 'module.exports').sort(),
      namespace,
    };
  } catch (importError) {
    // Browser-only modules cannot run in Node. Let the bundler resolve their
    // complete export graph, including declarations and star re-exports.
    try {
      const result = await build({
        entryPoints: [packageName],
        absWorkingDir: resolveDir,
        bundle: true,
        platform: 'browser',
        format: 'esm',
        write: false,
        metafile: true,
        outdir: 'shared-exports',
        loader: { '.css': 'empty', '.ttf': 'empty', '.woff': 'empty', '.woff2': 'empty' },
        logLevel: 'silent',
      });
      const entry = Object.values(result.metafile!.outputs).find(output => output.entryPoint);
      if (!entry) throw new Error('No JavaScript entry output');
      return { names: entry.exports.sort() };
    } catch (buildError) {
      throw new AggregateError([importError, buildError], `Cannot inspect shared package ${packageName}`);
    }
  }
}

export function generateShim(packageName: string, names: readonly string[]): string {
  const key = JSON.stringify(packageName);
  const lines = [
    `// Auto-generated shim for ${key}`,
    '// DO NOT EDIT -- regenerate with: pnpm --filter @omniviewdev/vite-plugin generate-shims',
    `const mod = window.__OMNIVIEW_SHARED__[${key}];`,
    `if (!mod) throw new Error('[omniview] Shared dependency ' + ${key} + ' is not available on window.__OMNIVIEW_SHARED__.');`,
  ];
  // Aliases also support reserved words and string-named ESM exports.
  names.forEach((name, index) => {
    lines.push(`const binding${index} = mod[${JSON.stringify(name)}];`);
    lines.push(`export { binding${index} as ${JSON.stringify(name)} };`);
  });
  return lines.join('\n') + '\n';
}
