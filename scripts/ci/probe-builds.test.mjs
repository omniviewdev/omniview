// The shared build of the kit probes (N27): what a probe process asks for (packages/kit/probes/build-cache.mjs: one build for each kind and mode, made once for everything that shares BUILD_CACHE), the key that names the
// directory the engine gives a shard (scripts/ci/probe-builds.mjs: everything that changes what a build makes), and the lines a build prints so that a shard's log says what it built and what it read.
//
// A shared build is sound when (1) the control a process runs never reaches the build (so the build is the same for every control, and a control that plants its fault in the page or in what the probe reads cannot tell it from
// its own), (2) nothing that changes the artefact can leave the key, and (3) a half-made build is never read. Each test below feeds the mistake it exists for and asserts it is named; docs/ui-next/status/N27.md has the mutants.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CONTROL_VARIABLES, sharedBuild, withoutControl } from '../../packages/kit/probes/build-cache.mjs';
import { BUILD_ENV_NAMES, BUILD_ENV_PREFIXES, buildInputs, buildKey, isBuildEnv, parseBuilds, renderBuilds, shardBuildCache, summariseBuilds } from './probe-builds.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A scratch directory with `files` (path -> text) under it. */
function scratch(files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'probe-builds-'));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

const TREE = {
  'package.json': '{"name":"root"}',
  'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  'vite.config.ts': 'export default {};\n',
  'ui-next/index.html': '<html></html>',
  'ui-next/shell/Shell.tsx': 'export const Shell = 1;\n',
  'packages/kit/src/index.ts': 'export const kit = 1;\n',
  'packages/kit/dist/index.js': 'export const kit = 1;\n',
  'docs/a.md': '# a\n',
};
const ENV = { OMNIVIEW_UI: 'next', PATH: '/usr/bin' };
const keyOf = (root, extra = {}) => buildKey({ root, env: { ...ENV, ...extra.env }, node: extra.node ?? 'v26.13.0', platform: extra.platform ?? 'linux', arch: extra.arch ?? 'x64' });

/** The lines a build or a read prints, collected. */
const collect = () => {
  const lines = [];
  return { lines, log: (line) => lines.push(line) };
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// What a probe process asks for
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('with no shared directory a build is made into a directory of its own every time, and says that it is not shared', () => {
  const { lines, log } = collect();
  const made = [];
  const build = (directory) => {
    made.push(directory);
    writeFileSync(path.join(directory, 'index.html'), 'x');
  };
  const first = sharedBuild({ kind: 'shell-fixtures', mode: 'production', build, env: {}, log });
  const second = sharedBuild({ kind: 'shell-fixtures', mode: 'production', build, env: { BUILD_CACHE: '' }, log });
  roots.push(first, second);
  assert.notEqual(first, second, 'a build nobody shares is not read by the next run');
  assert.equal(made.length, 2);
  assert.equal(readFileSync(path.join(first, 'index.html'), 'utf8'), 'x');
  assert.equal(lines.length, 2);
  for (const line of lines) assert.match(line, /^probe-build: shell-fixtures\/production built in [\d.]+ s \(not shared\)$/);
});

test('with BUILD_CACHE the first ask builds into <cache>/<kind>/<mode> and every later ask reads it: the build runs once, and each ask says which it did', () => {
  const cache = scratch();
  const { lines, log } = collect();
  let runs = 0;
  const build = (directory) => {
    runs += 1;
    writeFileSync(path.join(directory, 'index.html'), `build ${runs}`);
  };
  const env = { BUILD_CACHE: cache };
  const first = sharedBuild({ kind: 'shell-fixtures', mode: 'production', build, env, log });
  const second = sharedBuild({ kind: 'shell-fixtures', mode: 'production', build, env, log });
  const third = sharedBuild({ kind: 'shell-fixtures', mode: 'production', build, env, log });
  assert.equal(first, path.join(cache, 'shell-fixtures', 'production'));
  assert.equal(second, first);
  assert.equal(third, first);
  assert.equal(runs, 1, 'one build for all three asks');
  assert.equal(readFileSync(path.join(first, 'index.html'), 'utf8'), 'build 1');
  assert.match(lines[0], /^probe-build: shell-fixtures\/production built in [\d.]+ s \(shared\)$/);
  assert.deepEqual(lines.slice(1), ['probe-build: shell-fixtures/production reused', 'probe-build: shell-fixtures/production reused']);
});

test('builds of other kinds and other modes under one BUILD_CACHE never meet: the shell fixtures, the Settings fixture and the Plugins page all write a production build, and each has its own directory', () => {
  const cache = scratch();
  const env = { BUILD_CACHE: cache };
  const asked = [];
  for (const [kind, mode] of [
    ['shell-fixtures', 'production'],
    ['shell-fixtures', 'development'],
    ['settings-fixture', 'production'],
    ['plugins-page-fixture', 'production'],
    ['plugins-page-fixture', 'development'],
  ]) {
    asked.push(sharedBuild({ kind, mode, env, log: () => {}, build: (directory) => writeFileSync(path.join(directory, 'which'), `${kind}/${mode}`) }));
  }
  assert.equal(new Set(asked).size, 5);
  for (const directory of asked) assert.equal(readFileSync(path.join(directory, 'which'), 'utf8'), path.relative(cache, directory).split(path.sep).join('/'), 'each directory holds the build that was asked for it');
  const again = sharedBuild({ kind: 'settings-fixture', mode: 'production', env, log: () => {}, build: () => assert.fail('a build that exists is read, not made again') });
  assert.equal(again, asked[2]);
});

test('negative control: a build that fails leaves nothing at the shared path and nothing half made beside it, throws what it threw, and the next ask builds again (a half build is never read)', () => {
  const cache = scratch();
  const env = { BUILD_CACHE: cache };
  assert.throws(
    () =>
      sharedBuild({
        kind: 'shell-fixtures',
        mode: 'production',
        env,
        log: () => {},
        build: (directory) => {
          writeFileSync(path.join(directory, 'half.js'), 'half');
          throw new Error('vite fell over');
        },
      }),
    /vite fell over/,
  );
  assert.deepEqual(readdirSync(path.join(cache, 'shell-fixtures')), [], 'no directory at the shared path, none beside it');
  let runs = 0;
  const directory = sharedBuild({ kind: 'shell-fixtures', mode: 'production', env, log: () => {}, build: (out) => { runs += 1; writeFileSync(path.join(out, 'index.html'), 'whole'); } });
  assert.equal(runs, 1);
  assert.deepEqual(readdirSync(directory), ['index.html'], 'the half build of the first attempt is not in the second');
});

test('a build that another process published while this one was building is kept, not replaced: the late builder reads the first one\'s and discards its own', () => {
  const cache = scratch();
  const env = { BUILD_CACHE: cache };
  const { lines, log } = collect();
  const directory = sharedBuild({
    kind: 'shell-fixtures',
    mode: 'production',
    env,
    log,
    build: (out) => {
      writeFileSync(path.join(out, 'index.html'), 'mine');
      // The other process finishes first and publishes its own.
      mkdirSync(path.join(cache, 'shell-fixtures', 'production'), { recursive: true });
      writeFileSync(path.join(cache, 'shell-fixtures', 'production', 'index.html'), 'theirs');
    },
  });
  assert.equal(readFileSync(path.join(directory, 'index.html'), 'utf8'), 'theirs');
  assert.deepEqual(readdirSync(path.join(cache, 'shell-fixtures')), ['production'], 'the late builder\'s directory is gone');
  assert.match(lines.at(-1), /^probe-build: shell-fixtures\/production reused$/);
});

test('the control a process runs never reaches a build: NEGATIVE_CONTROL and ASSERTION_OFF are taken out of the environment a build gets, and nothing else is', () => {
  assert.deepEqual([...CONTROL_VARIABLES].sort(), ['ASSERTION_OFF', 'NEGATIVE_CONTROL']);
  const given = { PATH: '/bin', OMNIVIEW_UI: 'next', FONT_DELAY_MS: '40', REPORT: '/tmp/r.json', NEGATIVE_CONTROL: 'toast-width', ASSERTION_OFF: 'says' };
  assert.deepEqual(withoutControl(given), { PATH: '/bin', OMNIVIEW_UI: 'next', FONT_DELAY_MS: '40', REPORT: '/tmp/r.json' });
  assert.ok('NEGATIVE_CONTROL' in given, 'the caller\'s own environment is not changed');
  const seen = [];
  sharedBuild({ kind: 'shell-fixtures', mode: 'production', env: { NEGATIVE_CONTROL: 'gap', ASSERTION_OFF: 'x', OMNIVIEW_UI: 'next' }, log: () => {}, build: (out, env) => { seen.push(env); } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].NEGATIVE_CONTROL, undefined, 'a build function is given an environment without the control');
  assert.equal(seen[0].ASSERTION_OFF, undefined);
  assert.equal(seen[0].OMNIVIEW_UI, 'next');
});

// Every place a probe starts a build. Each must ask sharedBuild (so the build is shared and says so) and give the build the environment sharedBuild hands it, which has no control in it: a build that inherited process.env would see
// NEGATIVE_CONTROL, and a shared build is only sound when it cannot.
const BUILD_SITES = [
  'ui-next/shell/probes/harness.mjs',
  'ui-next/shell/probes/settings-lib.mjs',
  'ui-next/shell/plugins-page/probes/plugins-probe.mjs',
  'ui-next/plugins/host/probes/home-perf.mjs',
  'ui-next/page/probes/lib.mjs',
  'ui-next/shell/probes/logs-open-probe.mjs',
];

test('every place a probe starts a build asks sharedBuild and builds with the environment it is given, never with process.env (the control would reach the build)', () => {
  for (const file of BUILD_SITES) {
    const text = readFileSync(path.join(repo, file), 'utf8');
    assert.match(text, /sharedBuild\(\s*\{/, `${file} builds through sharedBuild`);
    assert.doesNotMatch(text, /\.\.\.process\.env/, `${file} spreads process.env: a build that inherits it sees NEGATIVE_CONTROL`);
    assert.doesNotMatch(text, /mkdtempSync/, `${file} makes a temporary build directory of its own: sharedBuild does that when nothing is shared`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('the key is the same for the same tree, node and build variables, whatever the order the variables come in, and is one hexadecimal word', () => {
  const root = scratch(TREE);
  const key = keyOf(root);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(keyOf(root), key);
  assert.equal(buildKey({ root, env: { PATH: '/usr/bin', OMNIVIEW_UI: 'next' }, node: 'v26.13.0', platform: 'linux', arch: 'x64' }), key);
  const copy = scratch(TREE);
  assert.equal(keyOf(copy), key, 'two checkouts of the same content are the same build');
});

test('negative control: a file of the inputs that changes, appears or is renamed changes the key (a source, a built package, the lockfile, the Vite configuration), and a file\'s content is read, not its time', () => {
  const root = scratch(TREE);
  const base = keyOf(root);
  for (const file of ['ui-next/shell/Shell.tsx', 'packages/kit/dist/index.js', 'pnpm-lock.yaml', 'vite.config.ts', 'package.json']) {
    const other = scratch({ ...TREE, [file]: `${TREE[file]}// changed\n` });
    assert.notEqual(keyOf(other), base, `${file} changed`);
  }
  assert.notEqual(keyOf(scratch({ ...TREE, 'ui-next/shell/New.tsx': '' })), base, 'a file appeared');
  const renamed = { ...TREE };
  renamed['ui-next/shell/Renamed.tsx'] = renamed['ui-next/shell/Shell.tsx'];
  delete renamed['ui-next/shell/Shell.tsx'];
  assert.notEqual(keyOf(scratch(renamed)), base, 'a file was renamed: the same bytes under another path are another tree');
  const touched = scratch(TREE);
  writeFileSync(path.join(touched, 'ui-next/shell/Shell.tsx'), TREE['ui-next/shell/Shell.tsx'], { flag: 'w' });
  assert.equal(keyOf(touched), base, 'rewritten with the same bytes is the same build');
});

test('negative control: node, the platform, the architecture, the flavour (OMNIVIEW_UI), a VITE_ variable, a WAILS_ variable and NODE_ENV each change the key', () => {
  const root = scratch(TREE);
  const base = keyOf(root);
  const changes = {
    node: keyOf(root, { node: 'v26.14.0' }),
    platform: keyOf(root, { platform: 'darwin' }),
    arch: keyOf(root, { arch: 'arm64' }),
    flavour: keyOf(root, { env: { OMNIVIEW_UI: 'current' } }),
    'a variable that is added': keyOf(root, { env: { OMNIVIEW_VITE_CACHE_DIRECTORY: '/tmp/vite' } }),
    vite: keyOf(root, { env: { VITE_REACT_DEVTOOLS_URL: 'http://x' } }),
    wails: keyOf(root, { env: { WAILS_VITE_PORT: '9999' } }),
    'node env': keyOf(root, { env: { NODE_ENV: 'development' } }),
  };
  for (const [what, key] of Object.entries(changes)) assert.notEqual(key, base, `${what} changed and the key did not`);
  assert.equal(new Set(Object.values(changes)).size, Object.keys(changes).length, 'each of them is a key of its own');
  // The flavour is not just present: its value is read.
  assert.notEqual(keyOf(root, { env: { OMNIVIEW_UI: 'next' } }), keyOf(root, { env: { OMNIVIEW_UI: 'current' } }));
});

test('what is not an input of a build does not change the key, so that units that set other knobs share one build: the control, the fonts\' delay, the report, the viewports, the shard and GitHub\'s own variables', () => {
  const root = scratch(TREE);
  const base = keyOf(root);
  for (const knob of [
    { NEGATIVE_CONTROL: 'toast-width' },
    { ASSERTION_OFF: 'says' },
    { FONT_DELAY_MS: '40' },
    { REPORT: '/tmp/report.json' },
    { ENGINES: 'chromium', VIEWPORTS: '1440x900', SECTIONS: 'perf', SHOTS: '/tmp/shots' },
    { DIST: '/tmp/dist', PROBE_DIST: '/tmp/dist', FIXTURE_DIST: '/tmp/f', BUILD_CACHE: '/tmp/cache' },
    { SHARD: '3', UNITS: 'a,b', GITHUB_RUN_ID: '1', RUNNER_TEMP: '/tmp', HOME: '/root' },
  ]) {
    assert.equal(keyOf(root, { env: knob }), base, `${Object.keys(knob).join(', ')} is not a build input`);
  }
});

test('node_modules and .git are not read (the lockfile pins the first), a dist of the repository root is not an input and a dist of a package is', () => {
  const root = scratch({ ...TREE, 'node_modules/dep/index.js': 'a', '.git/HEAD': 'ref', 'dist/index.html': 'root output', 'packages/kit/node_modules/x/y.js': 'b' });
  const inputs = buildInputs(root);
  assert.ok(inputs.includes('packages/kit/dist/index.js'), 'the built kit is an input of the fixtures that import it');
  assert.ok(inputs.includes('pnpm-lock.yaml'));
  assert.ok(inputs.includes('ui-next/shell/Shell.tsx'));
  for (const skipped of ['node_modules/dep/index.js', '.git/HEAD', 'dist/index.html', 'packages/kit/node_modules/x/y.js']) assert.ok(!inputs.includes(skipped), `${skipped} is not an input`);
  assert.deepEqual(inputs, [...inputs].sort(), 'in a fixed order');
  const base = keyOf(root);
  writeFileSync(path.join(root, 'node_modules/dep/index.js'), 'changed');
  writeFileSync(path.join(root, 'dist/index.html'), 'changed');
  assert.equal(keyOf(root), base);
});

test('the directory of a shard\'s shared build is under the runner\'s temp and names the key; without a runner it is under the system\'s temp, and it is the same directory for the same inputs', () => {
  const root = scratch(TREE);
  const key = keyOf(root);
  const given = shardBuildCache({ root, env: { ...ENV, RUNNER_TEMP: '/runner/temp' }, node: 'v26.13.0', platform: 'linux', arch: 'x64' });
  assert.equal(given, path.join('/runner/temp', 'probe-builds', key.slice(0, 16)));
  const local = shardBuildCache({ root, env: ENV, node: 'v26.13.0', platform: 'linux', arch: 'x64' });
  assert.equal(local, path.join(tmpdir(), 'probe-builds', key.slice(0, 16)));
  const other = scratch({ ...TREE, 'ui-next/shell/Shell.tsx': 'export const Shell = 2;\n' });
  assert.notEqual(shardBuildCache({ root: other, env: { ...ENV, RUNNER_TEMP: '/runner/temp' }, node: 'v26.13.0', platform: 'linux', arch: 'x64' }), given, 'other inputs are another directory, so a stale build cannot be found');
});

test('a variable is a build input when it has a prefix the build reads or is one of the few names it reads; the prefixes and names are what the real build\'s sources read', () => {
  for (const name of ['OMNIVIEW_UI', 'OMNIVIEW_BUILD_OUTPUT_DIRECTORY', 'WAILS_VITE_PORT', 'VITE_REACT_DEVTOOLS_URL', 'VITEST', 'NODE_ENV']) assert.equal(isBuildEnv(name), true, name);
  for (const name of ['NEGATIVE_CONTROL', 'ASSERTION_OFF', 'FONT_DELAY_MS', 'REPORT', 'PATH', 'HOME', 'RUNNER_TEMP', 'BUILD_CACHE', 'DIST']) assert.equal(isBuildEnv(name), false, name);
  assert.ok(BUILD_ENV_PREFIXES.length > 0 && BUILD_ENV_NAMES.length > 0);
});

/** The environment variables the sources of the build read: Vite's configurations, the Vite plugin, the packages' sources and the new UI's own (never its probes, tests or fixtures: they are not in a build). */
function buildReads() {
  const found = new Map();
  const add = (name, file) => found.set(name, [...(found.get(name) ?? []), file]);
  const READ = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)|process\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]|import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
  const scan = (file) => {
    for (const match of readFileSync(path.join(repo, file), 'utf8').matchAll(READ)) add(match[1] ?? match[2] ?? match[3], file);
  };
  const walk = (directory) => {
    for (const entry of readdirSync(path.join(repo, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', 'probes', 'e2e', 'fixture', '__tests__'].includes(entry.name)) continue;
        walk(relative);
      } else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name) && !/\.(?:test|spec|bench)\./.test(entry.name)) scan(relative);
    }
  };
  for (const file of ['vite.config.ts', 'vitest.cache.ts', 'packages/kit/vite.config.ts', 'packages/omniviewdev-runtime/vite.config.ts']) scan(file);
  for (const directory of ['ui-next', 'packages/kit/src', 'packages/omniviewdev-vite-plugin/src', 'packages/omniviewdev-runtime/src']) walk(directory);
  return found;
}

test('every environment variable the sources of the build read is one the key carries (the real tree): a build that began to read another would let a stale build through, and this names the variable', () => {
  const reads = buildReads();
  assert.ok(reads.has('OMNIVIEW_UI'), 'the scan finds the flavour switch: it is looking at the build\'s sources');
  assert.ok(reads.size >= 8, `the scan found ${reads.size} variables: it is not looking at enough`);
  const lost = [...reads].filter(([name]) => !isBuildEnv(name) && name !== 'NODE_ENV').map(([name, files]) => `${name} (${[...new Set(files)].join(', ')})`);
  assert.deepEqual(lost, [], `the build reads ${lost.join('; ')}: add it to BUILD_ENV_PREFIXES or BUILD_ENV_NAMES in scripts/ci/probe-builds.mjs, so that it is part of the key of the shared build`);
});

test('the fonts\' delay is read by the static server and by nothing that is built: it is not baked into a build, which is why it is not in the key', () => {
  const holders = [];
  const walk = (directory) => {
    for (const entry of readdirSync(path.join(repo, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
        walk(relative);
      } else if (/\.(?:[cm]?[jt]sx?|json)$/.test(entry.name) && readFileSync(path.join(repo, relative), 'utf8').includes('FONT_DELAY_MS')) holders.push(relative);
    }
  };
  for (const directory of ['ui-next', 'packages/kit/src', 'packages/omniviewdev-runtime/src', 'packages/omniviewdev-vite-plugin/src']) walk(directory);
  for (const file of ['vite.config.ts', 'vitest.cache.ts', 'packages/kit/vite.config.ts']) if (readFileSync(path.join(repo, file), 'utf8').includes('FONT_DELAY_MS')) holders.push(file);
  const built = holders.filter((file) => !/\/probes\//.test(file) && !/\/e2e\//.test(file));
  assert.deepEqual(built, [], `${built.join(', ')} reads FONT_DELAY_MS: it would be baked into a build, so it must be in the key`);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// What a shard's log says about its builds
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('the lines of builds are read from a probe\'s output, CRLF and noise around them ignored: what was built, in how long, and what was read', () => {
  const output = [
    'uptime: 12:00:00 up 2 min',
    'probe-build: shell-fixtures/production built in 7.93 s (shared)',
    'webkit 1440x900 done',
    'probe-build: shell-fixtures/development built in 6.1 s (shared)\r',
    'probe-build: settings-fixture/production reused',
    'probe-build: plugins-page-fixture/production built in 19 s (not shared)',
    'it says probe-build: shell-fixtures/production reused',
    '  probe-build: shell-fixtures/production reused',
    'probe-build: not a build line',
    '',
  ].join('\n');
  assert.deepEqual(parseBuilds(output), [
    { kind: 'shell-fixtures', mode: 'production', action: 'built', seconds: 7.93, shared: true },
    { kind: 'shell-fixtures', mode: 'development', action: 'built', seconds: 6.1, shared: true },
    { kind: 'settings-fixture', mode: 'production', action: 'reused', seconds: 0, shared: true },
    { kind: 'plugins-page-fixture', mode: 'production', action: 'built', seconds: 19, shared: false },
  ]);
  assert.deepEqual(parseBuilds(''), []);
});

test('the builds of a shard are summed for each kind and mode: how many were made, how many reads, the seconds they took, and the seconds a read saved are never claimed', () => {
  const list = [
    { kind: 'shell-fixtures', mode: 'production', action: 'built', seconds: 8, shared: true },
    { kind: 'shell-fixtures', mode: 'production', action: 'reused', seconds: 0, shared: true },
    { kind: 'shell-fixtures', mode: 'production', action: 'reused', seconds: 0, shared: true },
    { kind: 'shell-fixtures', mode: 'development', action: 'built', seconds: 7, shared: true },
    { kind: 'settings-fixture', mode: 'production', action: 'built', seconds: 5.5, shared: false },
  ];
  assert.deepEqual(summariseBuilds(list), {
    rows: [
      { kind: 'settings-fixture', mode: 'production', built: 1, reused: 0, seconds: 5.5 },
      { kind: 'shell-fixtures', mode: 'development', built: 1, reused: 0, seconds: 7 },
      { kind: 'shell-fixtures', mode: 'production', built: 1, reused: 2, seconds: 8 },
    ],
    built: 3,
    reused: 2,
    seconds: 20.5,
  });
  const text = renderBuilds(4, summariseBuilds(list));
  assert.match(text, /^#### Kit probes shard 4: builds$/m);
  assert.match(text, /\| shell-fixtures\/production \| 1 \| 2 \| 8 \|/);
  assert.match(text, /3 builds took 21 s and 2 reads reused them/);
  assert.equal(renderBuilds(4, summariseBuilds([])), '');
});
