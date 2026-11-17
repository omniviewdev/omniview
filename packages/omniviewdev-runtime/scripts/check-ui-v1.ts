/**
 * Run after the build: the curated entry `@omniviewdev/runtime/ui/v1` must be what its manifest says, and nothing of the previous UI library may be
 * reachable from it, in any form a plugin meets it in:
 *
 *   - `exports["./ui/v1"]` names its three targets, and each exists
 *   - source: `src/ui/v1.ts` and every file it imports
 *   - declarations: `dist/ui-v1/ui/v1.d.ts` (what a plugin's type check reads) and everything it imports; the main program's own `dist/ui/v1.d.ts`,
 *     which would name the main barrel, is not written
 *   - scripts: `dist/ui/v1.js` and `dist/ui/v1.cjs` with the chunks they import (what a plugin's test run loads)
 *
 * Each form may import React, the data client's own dependencies and nothing else (`ALLOWED`), so a new dependency of the entry is a decision made
 * here. `ui-v1-graph.ts` holds the crawler and its own tests, among them the probe that this check fails on the whole barrel.
 *
 *   node scripts/check-ui-v1.ts          after `pnpm run build`
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { crawl, violations, type ModuleGraph } from './ui-v1-graph.ts';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.resolve(root, process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY || 'dist');

/** What the entry may import besides its own files: React (and its compiler runtime, which every compiled hook imports), the query client, Wails. */
const ALLOWED = {
  // The declarations name the types of the hooks' results: the query client's, and nothing of React or Wails.
  declarations: ['@tanstack/react-query'],
  // The source reads Wails in the generated bindings. A bundled build folds its runtime into a chunk, so the scripts do not import it.
  source: ['react', '@tanstack/react-query', '@wailsio/runtime'],
  script: ['react', 'react/compiler-runtime', 'react/jsx-runtime', '@tanstack/react-query', '@wailsio/runtime'],
} as const;

const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { exports: Record<string, Record<string, string> | undefined> };
const entry = manifest.exports['./ui/v1'];
assert.ok(entry !== undefined, 'package.json has no exports["./ui/v1"]');
assert.deepEqual(entry, { types: './dist/ui-v1/ui/v1.d.ts', import: './dist/ui/v1.js', require: './dist/ui/v1.cjs' }, 'exports["./ui/v1"] names the declarations, the module and the CommonJS file');

/** `./dist/x` in the manifest is `x` in the directory this build wrote to. */
const inDist = (target: string): string => path.join(dist, target.replace(/^\.\/dist\//, ''));
const problems: string[] = [];
for (const target of Object.values(entry)) {
  if (!existsSync(inDist(target))) {
    problems.push(`exports target ${target} does not exist`);
  }
}

if (existsSync(path.join(dist, 'ui/v1.d.ts'))) {
  problems.push('dist/ui/v1.d.ts exists: the main program emitted it, and its declarations may name the main barrel (tsconfig.ui-v1.json emits the entry\'s)');
}

const forms: ReadonlyArray<{ readonly name: string; readonly entry: string; readonly allowed: readonly string[] }> = [
  { name: 'source', entry: path.join(root, 'src/ui/v1.ts'), allowed: ALLOWED.source },
  { name: 'declarations', entry: inDist(entry.types ?? ''), allowed: ALLOWED.declarations },
  { name: 'module', entry: inDist(entry.import ?? ''), allowed: ALLOWED.script },
  { name: 'CommonJS', entry: inDist(entry.require ?? ''), allowed: ALLOWED.script },
];

const bytes = (graph: ModuleGraph): { readonly raw: number; readonly gzip: number } =>
  graph.files.reduce((sum, file) => ({ raw: sum.raw + statSync(file).size, gzip: sum.gzip + gzipSync(readFileSync(file)).length }), { raw: 0, gzip: 0 });

if (problems.length === 0) {
  for (const { name, entry: file, allowed } of forms) {
    const graph = crawl(file);
    const found = violations(graph, allowed, root);
    problems.push(...found.map((message) => `${name}: ${message}`));
    const size = name === 'source' || name === 'declarations' ? '' : `, ${String(bytes(graph).raw)} B (${String(bytes(graph).gzip)} B gzip)`;
    console.log(`ui/v1 ${name}: ${String(graph.files.length)} files${size}; imports ${[...graph.bare.keys()].join(', ') || 'nothing'}`);
  }
}

if (problems.length > 0) {
  throw new Error(`@omniviewdev/runtime/ui/v1 is not what it must be:\n  ${problems.join('\n  ')}`);
}
