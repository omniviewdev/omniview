/**
 * Run after the build: what the package ships must be what the package says it ships.
 *
 *   - `exports` holds exactly `.`, `./examples` and `./styles.css`, and every target exists
 *   - the JavaScript that renders JSX was compiled by the React Compiler (it imports the compiler runtime) and imports only React; the examples
 *     entry may also import the kit itself, and the root entry holds no example
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
assert.deepEqual(
  Object.keys(manifest.exports).sort(),
  ['.', './examples', './styles.css'],
  'exports must hold exactly ".", "./examples" and "./styles.css"',
);
const targets = [
  manifest.exports['./styles.css'],
  ...Object.values(manifest.exports['.'] as Record<string, string>),
  ...Object.values(manifest.exports['./examples'] as Record<string, string>),
];
for (const target of targets) {
  assert.equal(typeof target, 'string');
  await stat(path.join(root, target as string)).catch(() => problems.push(`exports target ${String(target)} does not exist`));
}

const entries = await readdir(path.join(root, 'dist'), { recursive: true });
for (const entry of entries.filter((name) => name.endsWith('.map'))) {
  problems.push(`dist/${entry} ships a source map`);
}

// Each script entry, with the packages it may import besides React: the examples are consumer code and import the kit by name.
const scripts = [
  { file: 'dist/index.js', external: [] as string[] },
  { file: 'dist/examples.js', external: ['@omniviewdev/kit'] },
];
for (const { file, external } of scripts) {
  const script = await readFile(path.join(root, file), 'utf8');
  // Any script that renders JSX went through the React Compiler (an empty registry has no component to compile).
  if (script.includes('react/jsx-runtime') && !script.includes('react/compiler-runtime')) {
    problems.push(`${file} was not compiled by the React Compiler`);
  }

  for (const [, specifier] of script.matchAll(/^import .* from "([^"]+)";?$/gm)) {
    if (specifier !== undefined && specifier !== 'react' && !specifier.startsWith('react/') && !external.includes(specifier)) {
      problems.push(`${file} imports ${specifier}; only React${external.length > 0 ? ` and ${external.join(', ')}` : ''} may be external`);
    }
  }

  if (/\.css["']/.test(script)) {
    problems.push(`${file} imports CSS; the host imports ./styles.css`);
  }
}

const declarations = await readFile(path.join(root, 'dist/index.d.ts'), 'utf8');
if (/\.css['"]/.test(declarations)) {
  problems.push('dist/index.d.ts imports CSS; declarations must be plain TypeScript');
}

// The plugin-facing entry carries no example: plugins load it as a singleton, and an example is never API.
const rootScript = await readFile(path.join(root, 'dist/index.js'), 'utf8');
const rootExports = (/^export \{([^}]*)\};?\s*$/m.exec(rootScript)?.[1] ?? '').split(',').map((entry) => entry.trim().split(/\s+as\s+/).at(-1));
if (rootExports.includes('examples') || /^export[^;]*\bexamples\b[^;]*;/m.test(declarations) || /kit\/examples|\.examples/.test(rootScript)) {
  problems.push('the root entry carries an example; examples belong to the "./examples" entry only');
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
