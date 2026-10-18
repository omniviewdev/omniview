// Parent-only barrier: no app launch, dependency installation or registry publication.
// Requires an already bootstrapped/running disposable graph and real observer.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execute = promisify(execFile);
const configPath = process.env.A15_LIVE_SMOKE_CONFIG;
if (!configPath) throw new Error('A15_LIVE_SMOKE_CONFIG must name the disposable barrier JSON');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const temporary = await realpath(os.tmpdir());
async function disposable(directory) {
  const canonical = await realpath(directory);
  assert.ok(canonical.startsWith(`${temporary}${path.sep}`), 'smoke may mutate only temporary disposable roots');
  return canonical;
}
const workspace = await disposable(path.dirname(config.workspaceFile));
const manifest = JSON.parse(await readFile(path.join(workspace, 'workspace.json'), 'utf8'));
assert.equal(await readFile(path.join(workspace, '.local/a15-disposable'), 'utf8'), manifest.workspaceID);
await disposable(config.stateRoot);
const runtimeRoot = await disposable(config.runtimeRoot);
assert.equal(path.basename(runtimeRoot), 'runtime', 'use actual resolved UUID-owned runtime root');
assert.equal(path.basename(path.dirname(runtimeRoot)), manifest.workspaceID, 'runtime belongs to another workspace');
assert.ok(manifest.plugins.length >= 2, 'actual two-plugin observation is required');
const repositories = Object.fromEntries(manifest.repositories.map((repository) => [repository.id, path.resolve(workspace, repository.directory)]));
for (const directory of Object.values(repositories)) {
  assert.ok(directory.startsWith(`${workspace}${path.sep}`));
  assert.equal(await disposable(directory), directory, 'selected smoke source cannot be a redirected symlink');
}
const ui = repositories[manifest.links.uiRepositoryID];
const host = repositories.omniview;
const sdk = repositories[manifest.links.sdkRepositoryID];
assert.ok(ui && host && sdk, 'selected UI, host and SDK are required');
assert.ok(Array.isArray(config.observe) && config.observe.length > 0, 'real operation/browser observer argv is required');
const marker = `a15-${randomUUID()}`;
const files = {
  component: path.join(ui, 'packages/base-ui/src/components/button/Button.tsx'),
  css: path.join(ui, 'packages/base-ui/src/theme/styles.css'),
  runtime: path.join(host, 'packages/omniviewdev-runtime/src/index.ts'),
  sdk: path.join(sdk, 'settings/types.go'),
};
for (const file of Object.values(files)) assert.equal(await realpath(file), file, 'smoke source files cannot be redirected symlinks');
const originals = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readFile(file, 'utf8')])));
const siblingFiles = await Promise.all((config.siblingFiles ?? []).map(async (file) => {
  const canonical = await realpath(file);
  assert.ok(canonical.startsWith(`${temporary}${path.sep}`), 'sibling canaries must be disposable too');
  return [canonical, createHash('sha256').update(await readFile(canonical)).digest('hex')];
}));
assert.ok(siblingFiles.length > 0, 'explicit sibling output/state canaries are required');
async function siblingUnchanged() {
  for (const [file, hash] of siblingFiles) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), hash, `sibling changed: ${file}`);
}
async function observe(phase) {
  const deadline = Date.now() + (config.timeoutMS ?? 180000);
  let last;
  while (Date.now() < deadline) {
    try {
      const result = await execute(config.observe[0], [...config.observe.slice(1), phase, marker], {
        env: { ...process.env, GOWORK: 'off', GOFLAGS: '' }, timeout: 30000,
      });
      last = JSON.parse(result.stdout);
      if (phase === 'syntax-error' && last.phase === 'error' && last.typecheckFailed === true) return last;
      if (phase !== 'syntax-error' && last.phase === 'ready') return last;
    } catch (error) { last = String(error); }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`live phase ${phase} did not satisfy actual readiness/error: ${JSON.stringify(last)}`);
}
async function requireContains(file, text) {
  const deadline = Date.now() + (config.timeoutMS ?? 180000);
  while (Date.now() < deadline) {
    try { if ((await readFile(file, 'utf8')).includes(text)) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`actual rebuilt output did not contain ${text}: ${file}`);
}
async function artifactRecords() {
  return Promise.all(manifest.plugins.map(async ({ id }) => {
    const file = path.join(runtimeRoot, 'artifacts', `${id}.json`);
    return [file, await readFile(file, 'utf8')];
  }));
}
let mutated = false;
try {
  await observe('baseline');
  const anchor = '    <BaseButton\n';
  assert.equal(originals.component.split(anchor).length, 2, 'reviewed Button mutation anchor changed');
  mutated = true;
  await writeFile(files.component, originals.component.replace(anchor, `${anchor}      data-a15-live="${marker}"\n`));
  await writeFile(files.css, `${originals.css}\n:root { --a15-live-smoke: ${marker}; }\n`);
  const runtimeMutation = `${originals.runtime}\nexport const A15LiveRuntimeExport = '${marker}';\n`;
  await writeFile(files.runtime, runtimeMutation);
  await requireContains(path.join(ui, 'packages/base-ui/dist/index.js'), marker);
  await requireContains(path.join(ui, 'packages/base-ui/dist/base-ui.css'), marker);
  await requireContains(path.join(host, 'packages/omniviewdev-runtime/dist/index.js'), marker);
  await requireContains(path.join(host, 'packages/omniviewdev-vite-plugin/shims/_omniviewdev__runtime.mjs'), 'A15LiveRuntimeExport');
  const live = await observe('live-exports');
  assert.equal(live.reactSingleton, true);
  assert.equal(live.runtimeSingleton, true);
  for (const consumer of [live.host, ...manifest.plugins.map(({ id }) => live.plugins?.find((plugin) => plugin.id === id))]) {
    assert.ok(consumer, 'every intended host/plugin must be observed by the real browser adapter');
    for (const field of ['component', 'css', 'runtime']) assert.equal(consumer[field], true, `missing live ${field}`);
  }
  await siblingUnchanged();
  await writeFile(files.runtime, `${runtimeMutation}\nexport const A15InvalidSyntax = ;\n`);
  await observe('syntax-error');
  await writeFile(files.runtime, runtimeMutation);
  await observe('syntax-recovered');
  const records = await artifactRecords();
  // Ordinary dirty SDK API edits retain the reviewed isolation baseline and
  // acquire fresh source identity only through actual successful local rebuilds.
  await writeFile(files.sdk, `${originals.sdk}\nfunc A15LiveSDKMethod() string { return "${marker}" }\n`);
  const sdkLive = await observe('sdk-live');
  assert.equal(sdkLive.host?.rebuilt, true, 'intended host did not actually rebuild/restart');
  for (const [file, bytes] of records) {
    const before = JSON.parse(bytes);
    const after = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(after.expectedSDKRevision, before.expectedSDKRevision, 'dirty API edit must retain reviewed baseline');
    assert.match(after.expectedSDKSourceSHA256, /^[0-9a-f]{64}$/);
    assert.notEqual(after.expectedSDKSourceSHA256, before.expectedSDKSourceSHA256, 'dirty SDK source was not re-attested after rebuild');
    const plugin = sdkLive.plugins?.find(({ id }) => id === after.pluginID);
    assert.equal(plugin?.rebuilt, true, 'intended plugin did not actually rebuild/reload');
    assert.equal(plugin?.sourceDigest, after.expectedSDKSourceSHA256);
    assert.equal(sdkLive.host?.sourceDigest, after.expectedSDKSourceSHA256);
  }
  await writeFile(files.sdk, originals.sdk);
  await observe('sdk-restored');
  await siblingUnchanged();
  console.log(JSON.stringify({ workspaceID: manifest.workspaceID, marker, phases: ['live-exports', 'syntax-error', 'syntax-recovered', 'sdk-live-rebuilt', 'sdk-restored'], positiveDirtySDKMutation: true }));
} finally {
  if (mutated) {
    for (const [key, file] of Object.entries(files)) await writeFile(file, originals[key]);
    await observe('restored');
    await siblingUnchanged();
  }
}
