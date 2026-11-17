// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { crawl, isOldUiSpecifier, oldUiModules, violations } from './ui-v1-graph.ts';

// The crawler behind `check-ui-v1.ts`, on files written here (so each case is exact) and on the real source (the negative control: the same check on the
// runtime's whole barrel must find the previous UI library, or it could not fail).
const packageRoot = path.resolve(import.meta.dirname, '..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'ui-v1-graph-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function write(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(path.join(scratch, 'case-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    writeFileSync(path.join(directory, name), text);
  }

  return directory;
}

describe('what counts as a previous UI library', () => {
  it('names the libraries, their subpaths and what only they need', () => {
    for (const specifier of ['@omniviewdev/base-ui', '@omniviewdev/base-ui/metrics', '@omniviewdev/ai-ui', '@omniviewdev/editors/styles.css', '@base-ui/react', 'react-router', 'react-router/dom', 'monaco-editor', 'monaco-yaml', '@monaco-editor/react']) {
      expect(isOldUiSpecifier(specifier), specifier).toBe(true);
    }
  });

  it('leaves React, the query client, the kit and the runtime alone, and does not match a longer name', () => {
    for (const specifier of ['react', 'react-dom', 'react/compiler-runtime', '@tanstack/react-query', '@omniviewdev/kit', '@omniviewdev/runtime', '@omniviewdev/runtime/ui/v1', 'react-routerish', '@base-uix/y']) {
      expect(isOldUiSpecifier(specifier), specifier).toBe(false);
    }
  });

  it('finds the modules of a bundle that sit inside one, on either path separator and with a query', () => {
    const ids = [
      '/repo/node_modules/.pnpm/@omniviewdev+base-ui@0.17.3/node_modules/@omniviewdev/base-ui/dist/index.js',
      '/repo/node_modules/.pnpm/@base-ui+react@1.0.0/node_modules/@base-ui/react/esm/button/Button.js?v=3',
      'C:\\repo\\node_modules\\react-router\\dist\\index.js',
      '/repo/packages/kit/src/index.ts',
      '/repo/node_modules/react-dom/client.js',
      '/repo/ui-next/react-router-note.ts',
    ];
    expect(oldUiModules(ids)).toEqual(ids.slice(0, 3));
  });
});

describe('the crawler', () => {
  it('follows relative imports (a .js specifier finds its .ts) and records each bare one with the file that wrote it', () => {
    const directory = write({
      'entry.ts': "import { a } from './a'; export { b } from './b.js'; import('./lazy'); export { a };",
      'a.ts': "import { useState } from 'react'; export const a = useState;",
      'b.ts': "import { useQuery } from '@tanstack/react-query'; export const b = useQuery;",
      'lazy.ts': "import 'react/compiler-runtime'; export {};",
    });
    const graph = crawl(path.join(directory, 'entry.ts'));
    expect(graph.files.map((file) => path.basename(file))).toEqual(['entry.ts', 'a.ts', 'b.ts', 'lazy.ts']);
    expect([...graph.bare.keys()]).toEqual(['@tanstack/react-query', 'react', 'react/compiler-runtime']);
    expect(graph.bare.get('react')).toEqual([path.join(directory, 'a.ts')]);
    expect(graph.unresolved).toEqual([]);
    expect(violations(graph, ['react', 'react/compiler-runtime', '@tanstack/react-query'], directory)).toEqual([]);
  });

  it('reports a previous UI library, even one imported only for a type, with the file that imports it', () => {
    const directory = write({
      'entry.ts': "export * from './deep/hook';",
      'deep/hook.ts': "import type { MetricUnit } from '@omniviewdev/base-ui/metrics'; export type U = MetricUnit;",
    });
    expect(violations(crawl(path.join(directory, 'entry.ts')), [], directory)).toEqual([
      'a previous UI library is reachable: "@omniviewdev/base-ui/metrics" is imported by deep/hook.ts',
    ]);
  });

  it('reports an import that is not on the list, and one that does not resolve', () => {
    const directory = write({ 'entry.ts': "import _ from 'lodash'; export * from './gone'; export { _ };" });
    const found = violations(crawl(path.join(directory, 'entry.ts')), ['react'], directory);
    expect(found).toEqual([
      '"lodash" is imported by entry.ts and is not on the list the entry may import (react)',
      'an import did not resolve: entry.ts -> ./gone',
    ]);
  });

  it('reads declaration files, the inline `import("x").T` types in them, and the triple-slash references', () => {
    const directory = write({
      'entry.d.ts': "/// <reference path=\"./extra.d.ts\" />\nexport declare const hook: () => import('react-router').Location;\nexport type { T } from './types';",
      'extra.d.ts': "/// <reference types=\"monaco-editor\" />\nexport {};",
      'types.d.ts': "import type { Query } from '@tanstack/react-query'; export type T = Query;",
    });
    const graph = crawl(path.join(directory, 'entry.d.ts'));
    expect(graph.files.map((file) => path.basename(file))).toEqual(['entry.d.ts', 'extra.d.ts', 'types.d.ts']);
    expect([...graph.bare.keys()]).toEqual(['@tanstack/react-query', 'monaco-editor', 'react-router']);
  });

  it('reads CommonJS: `require` of a bare name, and of a sibling file, which it follows', () => {
    const directory = write({
      'v1.cjs': "const q = require('@tanstack/react-query');\nconst chunk = require('./chunk-ab12.cjs');\nexports.q = q; exports.chunk = chunk;",
      'chunk-ab12.cjs': "const old = require(\"@omniviewdev/base-ui\");\nmodule.exports = old;",
    });
    const graph = crawl(path.join(directory, 'v1.cjs'));
    expect(graph.files.map((file) => path.basename(file))).toEqual(['v1.cjs', 'chunk-ab12.cjs']);
    expect(violations(graph, ['@tanstack/react-query'], directory)).toEqual([
      'a previous UI library is reachable: "@omniviewdev/base-ui" is imported by chunk-ab12.cjs',
    ]);
  });

  it('resolves a script to the script, not to a declaration file beside it', () => {
    const directory = write({
      'v1.js': "import './chunk-ab12.js';\nexport {};",
      'chunk-ab12.d.ts': 'export {};',
      'chunk-ab12.js': "import '@omniviewdev/base-ui';\nexport {};",
    });
    const graph = crawl(path.join(directory, 'v1.js'));
    expect(graph.files.map((file) => path.basename(file))).toEqual(['v1.js', 'chunk-ab12.js']);
    expect(violations(graph, [], directory)).toEqual(['a previous UI library is reachable: "@omniviewdev/base-ui" is imported by chunk-ab12.js']);
  });

  it('reports a script that is missing, even when a declaration file of that name exists', () => {
    const directory = write({ 'v1.js': "import './gone.js';\nexport {};", 'gone.d.ts': 'export {};' });
    expect(violations(crawl(path.join(directory, 'v1.js')), [], directory)).toEqual(['an import did not resolve: v1.js -> ./gone.js']);
  });
});

describe('the curated entry', () => {
  const allowed = ['react', '@tanstack/react-query', '@wailsio/runtime'];

  it('reaches nothing of the previous UI library in source', () => {
    const graph = crawl(path.join(packageRoot, 'src/ui/v1.ts'));
    expect(graph.files.length).toBeGreaterThan(10);
    expect(violations(graph, allowed, packageRoot)).toEqual([]);
  });

  it('the control: the same check on the whole barrel finds the library and the router, so it can fail', () => {
    const found = violations(crawl(path.join(packageRoot, 'src/index.ts')), allowed, packageRoot);
    expect(found.filter((line) => line.includes('"@omniviewdev/base-ui"') && line.includes('is reachable'))).not.toEqual([]);
    expect(found.filter((line) => line.includes('"react-router"') && line.includes('is reachable'))).not.toEqual([]);
  });
});
