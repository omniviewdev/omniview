import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkStylesheet, declaredLayerOrder, HOST_FONT_URL } from '../packages/kit/scripts/stylesheet.ts';
import { oldUiModules } from '../packages/omniviewdev-runtime/scripts/ui-v1-graph.ts';

// OMNIVIEW_UI chooses the frontend a build ships (see vite.config.ts). Stable and nightly build `current`,
// so their output must hold nothing from ui-next/; only the feature-ui-next channel builds `next`.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = 'Omniview ui-next';
// The stable output is the one `pnpm build` wrote unless OMNIVIEW_STABLE_DIST names another; the channel output is built here.
const stable = path.resolve(root, process.env.OMNIVIEW_STABLE_DIST || 'dist');

async function list(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter(entry => entry.isFile())
    .map(entry => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();
}

function build(ui, outputDirectory) {
  return spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, OMNIVIEW_UI: ui, OMNIVIEW_BUILD_OUTPUT_DIRECTORY: outputDirectory },
  });
}

// What the `next` bundle holds, module by module (scripts/ui-next-bundle.mjs builds it and prints the chunks with their module ids, here with `/` separators).
function bundleOf(...args) {
  const run = spawnSync(process.execPath, [path.join(root, 'scripts/ui-next-bundle.mjs'), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  return JSON.parse(run.stdout).chunks.map(chunk => ({ ...chunk, modules: chunk.modules.map(id => id.split('\\').join('/')) }));
}

test('the stable build output holds nothing from ui-next', async () => {
  const files = await list(stable).catch(() => []);
  assert.ok(files.includes('index.html'), `no stable frontend build at ${stable}; run pnpm build first`);
  assert.deepEqual(files.filter(file => file.toLowerCase().includes('ui-next')), []);
  for (const file of files.filter(name => /\.(?:html|js|css)$/.test(name))) {
    const content = await readFile(path.join(stable, file), 'utf8');
    assert.ok(!content.includes(marker), `${file} contains ${marker}`);
    assert.ok(!content.includes('@layer ov.tokens'), `${file} contains the kit stylesheet`);
  }
});

test('OMNIVIEW_UI=next builds ui-next alone as the entry and replaces the output', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'omniview-ui-next-'));
  try {
    await writeFile(path.join(output, 'stale.js'), 'left behind by an earlier build');
    const built = build('next', output);
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const files = await list(output);
    // The host serves dist/index.html at `/`; nothing else may sit beside it except assets/.
    assert.deepEqual(files.filter(file => !file.startsWith('assets/')), ['index.html']);
    assert.ok((await readFile(path.join(output, 'index.html'), 'utf8')).includes(`<title>${marker}</title>`));
    const scripts = files.filter(file => file.endsWith('.js'));
    assert.ok(scripts.length > 0, 'the entry loads a script');
    let found = false;
    for (const file of scripts) {
      found ||= (await readFile(path.join(output, file), 'utf8')).includes(marker);
    }
    assert.ok(found, `no script renders ${marker}`);
    // The kit's stylesheet comes first and declares the layer order once; the host entry's own rules sit inside those layers.
    const styles = files.filter(file => file.endsWith('.css'));
    assert.equal(styles.length, 1, 'the entry loads one stylesheet');
    const layers = await readFile(path.join(root, 'packages/kit/src/styles/layers.css'), 'utf8');
    // The host's bundler takes the kit's font files into assets/ under hashed names; the stylesheet's `url()` follows them there.
    assert.deepEqual(
      checkStylesheet(await readFile(path.join(output, styles[0]), 'utf8'), declaredLayerOrder(layers), HOST_FONT_URL),
      [],
    );
    assert.ok(files.filter(file => /^assets\/[^/]+\.woff2$/.test(file)).length >= 3, 'the three font files sit in assets/');
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

// The new shell does not carry the previous UI libraries (strategy R3, R4). The runtime is the one place they could come back in: its main barrel imports
// `@omniviewdev/base-ui` and the router, and the shared list serves the runtime to plugins by a dynamic import, which keeps everything it names. The list
// serves the curated entry (`ui/v1`), whose graph holds none of them (`packages/omniviewdev-runtime/scripts/check-ui-v1.ts` checks its source, its
// declarations and its scripts); this checks what the host's bundle then holds, and the next test is the control that it can fail.
test('the next build holds no module of the previous UI libraries, with the runtime shared through its curated entry', () => {
  const modules = bundleOf().flatMap(chunk => chunk.modules);
  assert.ok(modules.some(id => id.endsWith('/packages/omniviewdev-runtime/src/ui/v1.ts')), 'the curated runtime entry is in the build (the shared list serves it)');
  assert.ok(modules.some(id => id.endsWith('/packages/omniviewdev-runtime/src/hooks/resource/useResources.ts')), 'and the hooks the Pods scaffolding reads through it');
  assert.deepEqual(oldUiModules(modules), []);
});

test('the guard goes red when the runtime is shared as its whole barrel', () => {
  const chunks = bundleOf('--probe', 'barrel');
  const old = chunks.map(chunk => ({ file: chunk.file, bytes: chunk.bytes, old: oldUiModules(chunk.modules) })).filter(chunk => chunk.old.length > 0);
  const modules = old.flatMap(chunk => chunk.old);
  assert.ok(modules.some(id => id.includes('/node_modules/@omniviewdev/base-ui/')), 'the barrel brings the previous UI library');
  assert.ok(modules.some(id => id.includes('/node_modules/react-router/')), 'and the router');
  // The chunk that holds them is the 1.88 MB one the design measured (docs/ui-next/slices/n19-plugin-seam.md, 1.2).
  assert.ok(old.some(chunk => chunk.bytes > 1_000_000), `their chunk is over 1 MB (${JSON.stringify(old.map(chunk => [chunk.file, chunk.bytes]))})`);
});

test('an unknown OMNIVIEW_UI fails the build instead of picking a frontend', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'omniview-ui-unknown-'));
  try {
    const built = build('bogus', output);
    assert.notEqual(built.status, 0);
    assert.match(built.stdout + built.stderr, /OMNIVIEW_UI must be "current" or "next", got "bogus"/);
    assert.deepEqual(await list(output), []);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
