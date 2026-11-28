import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fail, inside, type Watch } from './data';

export type ContractPackage = { root: string; name: string; version: string; types: string; script: string };
export const packageName = /^(?:@[a-z0-9-][a-z0-9._-]*\/)?[a-z0-9-][a-z0-9._-]*$/;

export function localFile(specifier: string, importer: string, base: string, options: ts.CompilerOptions, packed: boolean): string {
  if (!/^\.\.?\//.test(specifier) || /[?%#\\\0]/.test(specifier)) {
    fail('imports must name local source or an allowed public package');
  }

  const file = packed ? path.resolve(path.dirname(importer), specifier) :
    ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule?.resolvedFileName;
  if (!file || !existsSync(file)) {
    fail('expected a readable local module');
  }

  const canonical = realpathSync(file);
  if (!inside(base, canonical) || path.relative(base, canonical).split(path.sep).includes('node_modules') ||
      !/\.[cm]?[jt]sx?$/.test(canonical) || /\.d\.[cm]?ts$/.test(canonical) || (packed && !/\.[cm]?js$/.test(canonical))) {
    fail('expected a local code module inside its own package, not an asset, declaration or dependency');
  }

  return canonical;
}

/** Resolve the installation independently of author tsconfig paths; never load a package entry. */
export function publishedTypes(specifier: string, importer: string, options: ts.CompilerOptions): ts.ResolvedModuleFull {
  const clean: ts.CompilerOptions = { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const installed = ts.resolveModuleName(specifier, importer, clean, ts.sys).resolvedModule;
  const author = ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule;
  if (!installed?.packageId || !author || !/\.d\.[cm]?ts$/.test(installed.resolvedFileName) ||
      realpathSync(installed.resolvedFileName) !== realpathSync(author.resolvedFileName)) {
    fail(`expected installed declaration for ${specifier}, not a source alias`);
  }

  return installed;
}

function runtimeEntry(exports: unknown): string | undefined {
  if (typeof exports === 'string') {
    return exports;
  }

  if (!exports || typeof exports !== 'object') {
    return;
  }

  if (Array.isArray(exports)) {
    for (const item of exports) {
      const target = runtimeEntry(item); if (target) {
        return target;
      }
    }

    return;
  }

  for (const [condition, item] of Object.entries(exports)) {
    if (condition === 'import' || condition === 'default' || condition === 'browser' || condition === 'production') {
      const target = runtimeEntry(item);
      if (target) {
        return target;
      }
    }
  }
}

export function contractPackage(name: string, importer: string, consumingRoot: string, options: ts.CompilerOptions, watch: Watch): ContractPackage {
  if (!packageName.test(name) || name.length > 214) {
    fail('point imports must name a public npm package root');
  }

  const manifest = path.join(consumingRoot, 'package.json');
  watch(manifest);
  const ui = JSON.parse(readFileSync(manifest, 'utf8'));
  const pin = ui.dependencies?.[name] ?? ui.devDependencies?.[name];
  const installed = publishedTypes(name, importer, options);
  const types = realpathSync(installed.resolvedFileName);
  for (let dir = path.dirname(types); ; dir = path.dirname(dir)) {
    const meta = path.join(dir, 'package.json');
    if (existsSync(meta)) {
      const pkg = JSON.parse(readFileSync(meta, 'utf8'));
      if (pkg.name === name) {
        watch(meta);
        if (installed.packageId?.name !== name || typeof pin !== 'string' || pin !== pkg.version || pin !== installed.packageId.version) {
          fail(`${name}: expected a direct dependency pinned to the installed exact version`);
        }

        const entry = pkg.exports && typeof pkg.exports === 'object' && Object.hasOwn(pkg.exports, '.') ? pkg.exports['.'] : pkg.exports;
        const target = runtimeEntry(entry);
        if (!target?.startsWith('./') || !/\.(?:mjs|js)$/.test(target)) {
          fail(`${name}: expected a public ESM root export`);
        }

        const script = realpathSync(path.resolve(dir, target));
        if (!inside(dir, script) || path.relative(dir, script).split(path.sep).includes('node_modules')) {
          fail(`${name}: root export leaves its package`);
        }

        return { root: dir, name, version: pin, types, script };
      }
    }

    if (path.dirname(dir) === dir) {
      break;
    }
  }

  return fail('could not verify the point package root');
}
