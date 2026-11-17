/**
 * The module graph of the runtime's curated entry (`@omniviewdev/runtime/ui/v1`), and what may be reachable from it.
 *
 * A plugin built for the new shell imports this entry and nothing else of the runtime. It must not drag the previous UI library, the router or Monaco
 * along: not in the JavaScript a plugin's test run loads, not in the declarations its type check reads, and not in the host's `next` bundle that serves
 * the entry to every plugin. This file is the one definition of "old library" (a bare specifier, or a module path in a bundle) and the crawler that
 * finds one. `check-ui-v1.ts` runs it over the source and over `dist/`; `scripts/ui-flavour.test.mjs` applies the module-path half to the host's bundle.
 *
 * The crawler reads files as TypeScript's own scanner does (`ts.preProcessFile`), so it sees what the compiler sees: `import`, `export ... from`,
 * dynamic `import()`, `import type`, the `import('x').T` types of a declaration file, and `require` in a script. A relative import is followed (resolved
 * with the bundler rules, so a `.js` specifier finds its `.ts`), a bare one is recorded with the files that wrote it. It does not execute anything.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * Packages the new shell never carries (strategy R3 and R4): the previous UI libraries, and what only they needed. The pattern matches a bare specifier
 * (`@omniviewdev/base-ui/metrics`) and a module path inside `node_modules` (`.../node_modules/@base-ui/react/...`).
 */
const OLD_UI_PACKAGES = [
  '@omniviewdev/base-ui',
  '@omniviewdev/ai-ui',
  '@omniviewdev/editors',
  '@base-ui',
  'react-router',
  'monaco-editor',
  'monaco-yaml',
  'monaco-types',
  '@monaco-editor',
] as const;

const escape = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const OLD_SPECIFIER = new RegExp(`^(?:${OLD_UI_PACKAGES.map(escape).join('|')})(?:/|$)`);
const OLD_MODULE = new RegExp(`/node_modules/(?:${OLD_UI_PACKAGES.map(escape).join('|')})(?:/|$)`);

/** True for a bare specifier that names a previous UI library or something only it needs: `@omniviewdev/base-ui/metrics`, `react-router/dom`. */
export const isOldUiSpecifier = (specifier: string): boolean => OLD_SPECIFIER.test(specifier);

/** The module ids of a bundle (absolute paths, any separator) that sit inside a previous UI library. */
export const oldUiModules = (moduleIds: readonly string[]): string[] =>
  moduleIds.filter((id) => OLD_MODULE.test(id.split('\\').join('/').split('?')[0] ?? id));

const COMPILER_OPTIONS: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ES2022,
  allowImportingTsExtensions: true,
  jsx: ts.JsxEmit.ReactJSX,
};

export type ModuleGraph = {
  readonly entry: string;
  /** Every file reached from the entry through relative imports, the entry first. */
  readonly files: readonly string[];
  /** Each bare specifier a reached file wrote, with the files that wrote it. */
  readonly bare: ReadonlyMap<string, readonly string[]>;
  /** Relative imports that resolved to nothing, as `file -> specifier`. A graph with one proves nothing about what the import would have reached. */
  readonly unresolved: readonly string[];
};

const REQUIRE = /\brequire\(\s*(["'])([^"'\n]+)\1\s*\)/g;
const isRelative = (specifier: string): boolean => specifier.startsWith('.') || specifier.startsWith('/');

function importsOf(file: string, text: string): { readonly specifiers: string[]; readonly files: string[]; readonly types: string[] } {
  if (file.endsWith('.cjs')) {
    return { specifiers: [...text.matchAll(REQUIRE)].map((match) => match[2] ?? ''), files: [], types: [] };
  }

  const info = ts.preProcessFile(text, true, true);
  return {
    specifiers: info.importedFiles.map((reference) => reference.fileName),
    files: info.referencedFiles.map((reference) => reference.fileName),
    types: info.typeReferenceDirectives.map((reference) => reference.fileName),
  };
}

const EXECUTABLE = ['.js', '.mjs', '.cjs'];

/**
 * Resolves a relative specifier of `file`. An executable file (the scripts of `dist/`) is resolved by path, as the module system does: a sibling `.d.ts` must
 * not stand in for the script that runs, and a script that is missing is unresolved. Source and declaration files use the compiler's rules (a `.js` specifier finds its `.ts`).
 */
function resolveRelative(specifier: string, file: string): string | undefined {
  if (EXECUTABLE.includes(path.extname(file))) {
    const base = path.resolve(path.dirname(file), specifier);
    return [base, ...EXECUTABLE.map((extension) => `${base}${extension}`)].find((candidate) => EXECUTABLE.includes(path.extname(candidate)) && existsSync(candidate));
  }

  return ts.resolveModuleName(specifier, file, COMPILER_OPTIONS, ts.sys).resolvedModule?.resolvedFileName;
}

/** Follows every relative import from `entry` (a `.ts`, `.tsx`, `.d.ts`, `.js` or `.cjs` file) and collects the bare ones. */
export function crawl(entry: string): ModuleGraph {
  const root = path.resolve(entry);
  const files = new Set<string>();
  const bare = new Map<string, Set<string>>();
  const unresolved: string[] = [];
  const queue = [root];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (files.has(file)) {
      continue;
    }

    files.add(file);
    const { specifiers, files: references, types } = importsOf(file, readFileSync(file, 'utf8'));
    const note = (specifier: string): void => {
      bare.set(specifier, (bare.get(specifier) ?? new Set<string>()).add(file));
    };
    for (const specifier of [...specifiers, ...references]) {
      if (!isRelative(specifier)) {
        note(specifier);
        continue;
      }

      const resolved = resolveRelative(specifier, file);
      if (resolved === undefined || resolved.includes(`${path.sep}node_modules${path.sep}`)) {
        unresolved.push(`${file} -> ${specifier}`);
      } else {
        queue.push(resolved);
      }
    }

    types.forEach(note);
  }

  return {
    entry: root,
    files: [root, ...[...files].filter((file) => file !== root).sort()],
    bare: new Map([...bare].sort(([a], [b]) => (a < b ? -1 : 1)).map(([specifier, from]) => [specifier, [...from].sort()])),
    unresolved,
  };
}

/**
 * What is wrong with a graph, one line each, or nothing: a previous UI library is reachable (named with the file that wrote the import), a bare import
 * is not on the list `allowed`, or a relative import did not resolve. `base` shortens the paths in the messages.
 */
export function violations(graph: ModuleGraph, allowed: readonly string[], base: string): string[] {
  const rel = (file: string): string => path.relative(base, file).split(path.sep).join('/');
  const found: string[] = [];
  for (const [specifier, from] of graph.bare) {
    const where = `${from.slice(0, 3).map(rel).join(', ')}${from.length > 3 ? ` (+${String(from.length - 3)})` : ''}`;
    if (isOldUiSpecifier(specifier)) {
      found.push(`a previous UI library is reachable: "${specifier}" is imported by ${where}`);
    } else if (!allowed.includes(specifier)) {
      found.push(`"${specifier}" is imported by ${where} and is not on the list the entry may import (${allowed.join(', ')})`);
    }
  }

  for (const entry of graph.unresolved) {
    found.push(`an import did not resolve: ${entry.split(' -> ').map((part, index) => (index === 0 ? rel(part) : part)).join(' -> ')}`);
  }

  return found;
}
