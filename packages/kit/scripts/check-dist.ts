/**
 * Run after the build: what the package ships must be what the package says it ships.
 *
 *   - `exports` holds exactly `.` and `./styles.css`, and both targets exist
 *   - the JavaScript was compiled by the React Compiler (it imports the compiler runtime) and imports only React
 *   - no source maps ship
 *   - the stylesheet keeps the layer contract (see `checkStylesheet`) and defines exactly the generated token names
 */
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOKEN_NAMES } from '../src/generated/tokenNames.ts';
import { checkStylesheet, declaredLayerOrder, definedTokens } from './stylesheet.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems: string[] = [];

const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')) as { exports: Record<string, unknown> };
assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './styles.css'], 'exports must hold exactly "." and "./styles.css"');
const targets = [manifest.exports['./styles.css'], ...Object.values(manifest.exports['.'] as Record<string, string>)];
for (const target of targets) {
  assert.equal(typeof target, 'string');
  await stat(path.join(root, target as string)).catch(() => problems.push(`exports target ${String(target)} does not exist`));
}

const entries = await readdir(path.join(root, 'dist'), { recursive: true });
for (const entry of entries.filter((name) => name.endsWith('.map'))) {
  problems.push(`dist/${entry} ships a source map`);
}

const script = await readFile(path.join(root, 'dist/index.js'), 'utf8');
if (!script.includes('react/compiler-runtime')) {
  problems.push('dist/index.js was not compiled by the React Compiler');
}

for (const [, specifier] of script.matchAll(/^import .* from "([^"]+)";?$/gm)) {
  if (specifier !== undefined && specifier !== 'react' && !specifier.startsWith('react/')) {
    problems.push(`dist/index.js imports ${specifier}; only React may be external`);
  }
}

if (/\.css["']/.test(script)) {
  problems.push('dist/index.js imports CSS; the host imports ./styles.css');
}

const declarations = await readFile(path.join(root, 'dist/index.d.ts'), 'utf8');
if (/\.css['"]/.test(declarations)) {
  problems.push('dist/index.d.ts imports CSS; declarations must be plain TypeScript');
}

const css = await readFile(path.join(root, 'dist/styles.css'), 'utf8');
const order = declaredLayerOrder(await readFile(path.join(root, 'src/styles/layers.css'), 'utf8'));
problems.push(...checkStylesheet(css, order));
const defined = definedTokens(css);
for (const name of TOKEN_NAMES) {
  if (!defined.has(name)) {
    problems.push(`${name} is a generated token name but dist/styles.css does not define it`);
  }
}

for (const name of defined) {
  if (!(TOKEN_NAMES as readonly string[]).includes(name)) {
    problems.push(`${name} is defined but is not a generated token name`);
  }
}

if (problems.length > 0) {
  process.stderr.write(`dist check failed:\n${problems.map((problem) => `  - ${problem}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`dist check passed: ${defined.size} tokens, layers ${order.join(' > ')}\n`);
