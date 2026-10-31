import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { initializeToolCache, readToolCache, retirePreparationHome } from './tool-cache.mjs';
import { toolEnvironment } from './execution.mjs';

const temporary = () => realpathSync(mkdtempSync(join(tmpdir(), 'omniview-tool-cache-')));
test('explicit cache initialization creates private fixed native-cache children and preserves real payloads on reuse', () => {
  const arena = temporary();
  const root = join(arena, 'cache');
  try {
    const cache = initializeToolCache(root);
    assert.equal(cache.goModCache, join(root, 'go-mod'));
    assert.equal(cache.bootstrapGoCache, join(root, 'bootstrap-go-build'));
    assert.equal(cache.pnpmStore, join(root, 'pnpm-store/12.14.0'));
    assert.equal(cache.playwrightBrowsers, join(root, 'playwright-browsers'));
    for (const path of [root, cache.goModCache, cache.bootstrapGoCache, cache.pnpmStore, cache.playwrightBrowsers]) assert.equal(lstatSync(path).mode & 0o777, 0o700);
    writeFileSync(join(cache.goModCache, 'downloaded-module'), 'native cache payload');
    assert.deepEqual(initializeToolCache(root), cache);
    assert.deepEqual(readToolCache(root), cache);
    assert.equal(readFileSync(join(cache.goModCache, 'downloaded-module'), 'utf8'), 'native cache payload');
  } finally { rmSync(arena, { recursive: true, force: true }); }
});
test('unknown, public and redirected cache containers are refused without adoption or repair', () => {
  const arena = temporary();
  try {
    const unknown = join(arena, 'unknown');
    mkdirSync(unknown, { mode: 0o700 });
    writeFileSync(join(unknown, 'credentials'), 'not a cache');
    assert.throws(() => initializeToolCache(unknown), /cache/);
    assert.equal(existsSync(join(unknown, '.owner.json')), false);
    const root = join(arena, 'cache');
    initializeToolCache(root);
    chmodSync(root, 0o755);
    assert.throws(() => readToolCache(root), /private/);
    assert.equal(lstatSync(root).mode & 0o777, 0o755);
    chmodSync(root, 0o700);
    const alias = join(arena, 'alias');
    symlinkSync(root, alias);
    assert.throws(() => initializeToolCache(alias), /cache|canonical|private/);
    rmSync(join(root, 'go-mod'), { recursive: true });
    symlinkSync(unknown, join(root, 'go-mod'));
    assert.throws(() => readToolCache(root), /cache|canonical|private/);
    assert.equal(readFileSync(join(unknown, 'credentials'), 'utf8'), 'not a cache');
  } finally { rmSync(arena, { recursive: true, force: true }); }
});
test('a copied owner file cannot authorize a replacement cache directory', () => {
  const arena = temporary();
  const root = join(arena, 'cache');
  try {
    initializeToolCache(root);
    renameSync(root, join(arena, 'original'));
    mkdirSync(root, { mode: 0o700 });
    copyFileSync(join(arena, 'original/.owner.json'), join(root, '.owner.json'));
    assert.throws(() => initializeToolCache(root), /ownership/);
  } finally { rmSync(arena, { recursive: true, force: true }); }
});
test('foreign owner claims are refused without modifying the recorded owner', () => {
  const arena = temporary();
  try {
    const root = join(arena, 'cache'); initializeToolCache(root);
    const path = join(root, '.owner.json');
    const owner = JSON.parse(readFileSync(path, 'utf8'));
    owner.directory.uid += 1;
    const foreign = JSON.stringify(owner);
    writeFileSync(path, foreign);
    assert.throws(() => readToolCache(root), /ownership/);
    assert.equal(readFileSync(path, 'utf8'), foreign);
  } finally { rmSync(arena, { recursive: true, force: true }); }
});
test('numeric filesystem identity claims are refused without rewriting ownership', () => {
  const arena = temporary();
  try {
    const root = join(arena, 'cache'); initializeToolCache(root);
    const path = join(root, '.owner.json');
    const owner = JSON.parse(readFileSync(path, 'utf8'));
    owner.directory.ino = Number(owner.directory.ino);
    const rounded = JSON.stringify(owner);
    writeFileSync(path, rounded);
    assert.throws(() => readToolCache(root), /ownership/);
    assert.equal(readFileSync(path, 'utf8'), rounded);
  } finally { rmSync(arena, { recursive: true, force: true }); }
});
test('explicit Windows cache selection refuses unsupported ownership before filesystem mutation', () => {
  const arena = temporary();
  const root = join(arena, 'cache');
  try {
    const helper = new URL('./tool-cache.mjs', import.meta.url).href;
    const code = `import assert from 'node:assert/strict'; import { initializeToolCache, readToolCache } from ${JSON.stringify(helper)}; Object.defineProperty(process, 'platform', { value: 'win32' }); for (const operation of [initializeToolCache, readToolCache]) assert.throws(() => operation(${JSON.stringify(root)}), /Windows.*ownership|ownership.*Windows/);`;
    execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: toolEnvironment(process.env), stdio: 'pipe' });
    assert.equal(existsSync(root), false);
  } finally { rmSync(arena, { recursive: true, force: true }); }
});
test('enclosing workspace, collection and custom-profile markers protect unrelated namespaces', () => {
  const arena = temporary();
  try {
    for (const marker of ['workspace.json', '.omniview-dev/repositories.json', '.omniview-profile.json', '.workspace-owner.json']) {
      const container = join(arena, marker.replaceAll('/', '-'));
      const parent = join(container, 'private');
      mkdirSync(parent, { recursive: true, mode: 0o700 });
      const markerPath = join(container, marker);
      mkdirSync(join(markerPath, '..'), { recursive: true, mode: 0o700 });
      writeFileSync(markerPath, 'malformed boundary evidence');
      const root = join(parent, 'cache');
      assert.throws(() => initializeToolCache(root), /boundary|workspace|collection|profile/);
      assert.equal(existsSync(root), false);
    }
    const redirected = join(arena, 'redirected');
    const metadata = join(arena, 'metadata');
    mkdirSync(redirected, { mode: 0o700 });
    mkdirSync(metadata, { mode: 0o700 });
    symlinkSync(metadata, join(redirected, '.omniview-dev'));
    assert.throws(() => initializeToolCache(join(redirected, 'cache')), /boundary|redirect|collection/);
    assert.equal(existsSync(join(redirected, 'cache')), false);
  } finally { rmSync(arena, { recursive: true, force: true }); }
});
test('reuse refuses a cache whose enclosing directory becomes a profile', () => {
  const arena = temporary();
  try {
    const root = join(arena, 'cache');
    const cache = initializeToolCache(root);
    const payload = join(cache.goModCache, 'retained');
    writeFileSync(payload, 'native cache bytes');
    writeFileSync(join(arena, '.omniview-profile.json'), '{}');
    assert.throws(() => readToolCache(root), /profile|boundary/);
    assert.equal(readFileSync(payload, 'utf8'), 'native cache bytes');
  } finally { rmSync(arena, { recursive: true, force: true }); }
});
test('source/collection/profile overlap is refused before creating cache contents', () => {
  const arena = temporary();
  try {
    const source = join(arena, 'source'); mkdirSync(source, { mode: 0o700 });
    for (const root of [source, join(source, 'cache'), arena]) assert.throws(() => initializeToolCache(root, { protectedRoots: [source] }), /overlap/);
    assert.equal(existsSync(join(source, '.owner.json')), false);
    assert.throws(() => initializeToolCache('relative/cache'), /absolute/);
    assert.throws(() => initializeToolCache(join(arena, 'bad\ncache')), /cache/);
  } finally { rmSync(arena, { recursive: true, force: true }); }
});
test('cache-init CLI exports only native cache paths and performs no tool, dependency or application preparation', () => {
  const arena = temporary();
  const host = join(arena, 'host');
  const scripts = join(host, 'e2e/scripts');
  mkdirSync(scripts, { recursive: true });
  try {
    for (const name of ['run.mjs', 'execution.mjs', 'select-tests.mjs', 'application.mjs', 'candidate-source.mjs', 'cohort.mjs', 'tool-cache.mjs', 'browser-dependencies.mjs']) copyFileSync(fileURLToPath(new URL(name, import.meta.url)), join(scripts, name));
    mkdirSync(join(host, 'scripts'));
    copyFileSync(fileURLToPath(new URL('../../scripts/wails-tool.mjs', import.meta.url)), join(host, 'scripts/wails-tool.mjs'));
    const output = join(arena, 'github-env');
    const root = join(arena, 'cache');
    execFileSync(process.execPath, [join(scripts, 'run.mjs'), '--init-tool-cache'], { env: { ...toolEnvironment(process.env), PATH: '', OMNIVIEW_E2E_TOOL_CACHE_ROOT: root, GITHUB_ENV: output, OMNIVIEW_WAILS_TOOL_CAPABILITY: '{}' }, encoding: 'utf8' });
    const cache = readToolCache(root);
    assert.equal(readFileSync(output, 'utf8'), `OMNIVIEW_E2E_TOOL_CACHE_ROOT=${cache.root}\nGOCACHE=${cache.bootstrapGoCache}\nGOMODCACHE=${cache.goModCache}\nPLAYWRIGHT_BROWSERS_PATH=${cache.playwrightBrowsers}\n`);
    assert.equal(existsSync(join(host, 'node_modules')), false);
    assert.equal(existsSync(join(host, '.local')), false);
    assert.equal(existsSync(join(host, 'e2e/playwright-report')), false);
  } finally { rmSync(arena, { recursive: true, force: true }); }
});
test('parallel native-cache claims preserve one actual owner and existing payloads', async () => {
  const arena = temporary();
  const root = join(arena, 'cache');
  const helper = new URL('./tool-cache.mjs', import.meta.url).href;
  const claim = () => new Promise((resolve, reject) => {
    const code = `import { initializeToolCache } from ${JSON.stringify(helper)}; initializeToolCache(${JSON.stringify(root)});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: toolEnvironment(process.env), stdio: ['ignore', 'ignore', 'ignore'] });
    child.once('error', reject); child.once('close', status => resolve(status));
  });
  try {
    const first = await Promise.all([claim(), claim()]);
    // An overlapping first claim may fail closed while its owner marker is not
    // yet committed. It must never adopt, replace or damage the winning claim.
    assert.ok(first.includes(0));
    const cache = readToolCache(root);
    const owner = readFileSync(join(root, '.owner.json'), 'utf8');
    writeFileSync(join(cache.goModCache, 'retained'), 'native payload');
    assert.deepEqual(await Promise.all([claim(), claim()]), [0, 0]);
    assert.equal(readFileSync(join(root, '.owner.json'), 'utf8'), owner);
    assert.equal(readFileSync(join(cache.goModCache, 'retained'), 'utf8'), 'native payload');
  } finally { rmSync(arena, { recursive: true, force: true }); }
});
test('private preparation retirement preserves persistent native data and never cleans its module cache', () => {
  const arena = temporary();
  try {
    const cache = initializeToolCache(join(arena, 'cache'));
    const payload = join(cache.goModCache, 'retained-module');
    writeFileSync(payload, 'persistent native module');
    const tools = join(arena, 'tools'); mkdirSync(tools, { mode: 0o700 });
    const calls = join(arena, 'cleanup-call');
    // A real controlled child records the cleanup environment. It is not a
    // managed receipt or application substitute; this tests deletion authority.
    writeFileSync(join(tools, 'go'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(calls)}, process.env.GOMODCACHE);`, { mode: 0o700 });
    const makeHome = name => {
      const root = join(arena, name); const home = join(root, 'home');
      mkdirSync(home, { recursive: true, mode: 0o700 });
      writeFileSync(join(home, 'private-config'), 'must retire');
      return { root, env: { ...toolEnvironment(process.env), PATH: tools, HOME: home, GOPATH: join(home, 'go'), GOMODCACHE: cache.goModCache } };
    };
    const persistent = makeHome('persistent-run');
    retirePreparationHome(persistent.root, persistent.env, { toolCache: cache });
    assert.equal(existsSync(persistent.root), false);
    assert.equal(existsSync(calls), false, 'persistent-cache retirement must not invoke go clean');
    assert.equal(readFileSync(payload, 'utf8'), 'persistent native module');
    const fallback = makeHome('fallback-run');
    retirePreparationHome(fallback.root, fallback.env);
    assert.equal(readFileSync(calls, 'utf8'), join(fallback.root, 'home/go/pkg/mod'));
    assert.equal(existsSync(fallback.root), false);
    assert.equal(readFileSync(payload, 'utf8'), 'persistent native module');
  } finally { rmSync(arena, { recursive: true, force: true }); }
});

test('cache-only retirement removes complete private artifacts and cohort data, preserving only authenticated native payloads', () => {
  const arena = temporary();
  try {
    const cache = initializeToolCache(join(arena, 'cache'));
    const owner = readFileSync(join(cache.root, '.owner.json'), 'utf8');
    for (const directory of [cache.goModCache, cache.bootstrapGoCache, cache.pnpmStore, cache.playwrightBrowsers]) writeFileSync(join(directory, 'native-payload'), 'retained native bytes');
    const root = join(arena, 'preparation');
    const home = join(root, 'home');
    mkdirSync(home, { recursive: true, mode: 0o700 });
    for (const name of ['application', 'build-cohort', 'ownership', 'wails-tool']) {
      mkdirSync(join(root, name), { mode: 0o700 });
      writeFileSync(join(root, name, 'private-data'), 'not a reusable native payload');
    }
    const env = { ...toolEnvironment(process.env), PATH: '', HOME: home, GOPATH: join(home, 'go'), GOMODCACHE: cache.goModCache };
    // Unknown restored metadata refuses deletion; never hide a failed retirement
    // by publishing a cache-only success or deleting the evidence first.
    writeFileSync(join(cache.root, 'foreign-receipt'), 'unknown');
    assert.throws(() => retirePreparationHome(root, env, { toolCache: cache }), /unknown/);
    assert.equal(existsSync(join(root, 'build-cohort/private-data')), true);
    rmSync(join(cache.root, 'foreign-receipt')); // This test owns the injected file.
    retirePreparationHome(root, env, { toolCache: cache });
    assert.equal(existsSync(root), false);
    assert.equal(readFileSync(join(cache.root, '.owner.json'), 'utf8'), owner);
    for (const directory of [cache.goModCache, cache.bootstrapGoCache, cache.pnpmStore, cache.playwrightBrowsers]) assert.equal(readFileSync(join(directory, 'native-payload'), 'utf8'), 'retained native bytes');
  } finally { rmSync(arena, { recursive: true, force: true }); }
});

test('only an actual validated cache owner can select persistent browser payloads', () => {
  const arena = temporary();
  try {
    const cache = initializeToolCache(join(arena, 'cache'));
    const input = { PLAYWRIGHT_BROWSERS_PATH: '/foreign/browser-cache' };
    assert.equal(toolEnvironment(input).PLAYWRIGHT_BROWSERS_PATH, undefined);
    assert.equal(toolEnvironment(input, { toolCacheRoot: cache.root }).PLAYWRIGHT_BROWSERS_PATH, cache.playwrightBrowsers);
    rmSync(cache.playwrightBrowsers, { recursive: true });
    symlinkSync(join(arena, 'foreign'), cache.playwrightBrowsers);
    assert.throws(() => toolEnvironment(input, { toolCacheRoot: cache.root }), /cache|ENOENT/);
  } finally { rmSync(arena, { recursive: true, force: true }); }
});
