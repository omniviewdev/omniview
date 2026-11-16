import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkStylesheet, declaredLayerOrder } from '../packages/kit/scripts/stylesheet.ts';

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
    assert.deepEqual(
      checkStylesheet(await readFile(path.join(output, styles[0]), 'utf8'), declaredLayerOrder(layers)),
      [],
    );
  } finally {
    await rm(output, { recursive: true, force: true });
  }
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
