// The path classifier (scripts/ci/changes.mjs): which parts of the repository a pull request changes, and so which CI jobs can have an answer.
//
// The rule it must keep: a path the classifier does not know runs EVERYTHING. Every "NEGATIVE" test below feeds it a change that must not be allowed to skip a job (the plan's list of
// them: go.mod, vite.config.ts, package.json, pnpm-lock.yaml, any .github/**, Taskfile.yml, a path never seen before, docs plus one code file) and each was also seen to go red with the rule
// it names taken out (docs/ui-next/status/N24-D1.md). This file needs no installed dependency: the repository guard runs it on every pull request, whatever the pull request changes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { selectChanges } from '../../e2e/scripts/select-tests.mjs';
import { ALWAYS, CLASSES, GATED, changedPaths, classify, outputsOf, pathArea, renderSummary, skippedBy } from './changes.mjs';

const script = fileURLToPath(new URL('./changes.mjs', import.meta.url));

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Prose that nothing builds or reads: the class of the e2e selector (e2e/scripts/select-tests.mjs), which this one must never be wider than. */
const DOCS = [
  'README.md',
  'docs/development-cli.md',
  'docs/plugin-development.md',
  'docs/roadmap/2026-10-17-product-roadmap.md',
  'docs/ui-next/TRACKER.md',
  'docs/ui-next/AGENTS.md',
  'docs/ui-next/status/N24-D1.md',
  'docs/ui-next/status/SEC1/notes.md',
  'docs/ui-next/baseline/2026-11-19-log.md',
  'docs/ui-next/status/K2a/k2a-proof.mjs.txt',
  'docs/ui-next/status/E0-1/evidence-test.go.txt',
  'docs/ui-next/status/summary.txt',
];

/** Evidence under docs/ui-next/status/ that the e2e selector does not call prose (images, YAML, JSON, scripts): nothing reads a path there (the tripwire at the end searches), so it is documentation here. */
const DOCS_EVIDENCE = [
  'docs/ui-next/status/L2/shot.png',
  'docs/ui-next/status/1a.2/scale.yaml',
  'docs/ui-next/status/1a.2/raw/results-N25.json',
  'docs/ui-next/status/SEC1/sec1-secrets.yaml',
  'docs/ui-next/status/K2a/proof.mjs',
  'docs/ui-next/status/E0-1/run.sh',
  'docs/ui-next/status/x.txt.exe',
  'docs/ui-next/status/.txt',
  'docs/ui-next/status/.hidden',
];

/** The new UI: what the stable build, the Go host and the e2e suite never read. */
const NEW_UI = [
  'ui-next/App.tsx',
  'ui-next/shell/Shell.tsx',
  'ui-next/shell/README.md', // scanned by the vocabulary guard: Markdown inside the new trees is an input of the UI checks
  'ui-next/shell/probes/mock-rail.json',
  'ui-next/global.css',
  'packages/kit/src/index.ts',
  'packages/kit/package.json',
  'packages/kit/api/kit.api.md', // compared with src/index.ts by the API report
  'packages/kit/README.md',
  'packages/kit/src/generated/tokens.css',
  'packages/kit/vitest.setup.ts', // the kit's own vitest setup: the root configuration does not load it
  'docs/ui-next/slices/1a-pods-list/fixture.yaml', // applied by the Pods workflow
  'docs/ui-next/baseline/run.sh',
  'docs/ui-next/baseline/raw/pass1/render.json',
];

/** The new UI's own tooling: read by a check that stays for a change to the new UI (or by none), and by no host job. Every new probe is a unit in the first two files. */
const NEW_UI_TOOLING = [
  'scripts/ci/probe-shards.mjs', // read by the kit probes workflow only
  'scripts/ci/probe-shards.test.mjs',
  'scripts/ci/probe-shards.runs.json',
  'scripts/ci/probe-shards.layout.json',
  'scripts/ci/probe-pack.mjs',
  'scripts/ci/probe-pack.test.mjs',
  'scripts/ci/probe-seconds.mjs',
  'scripts/ci/probe-seconds.test.mjs',
  'scripts/ci/probe-builds.mjs',
  'scripts/ci/probe-builds.test.mjs',
  'scripts/ci/probe-units.manifest.json',
  'scripts/ci/probe-units/panel.mjs', // the probe table, one file for each probe (N25): a pull request that adds a probe adds one
  'scripts/ci/probe-units/a-new-probe.mjs',
  'scripts/ui-next-pods/host.sh', // the Pods cluster check
  'scripts/ui-next-pods/pods-cluster.check.mjs',
  'scripts/ui-next-bundle.mjs', // read by the flavour guard of the UI build
  'bench/table/run.mjs', // the kit's benches: no workflow runs them
  'bench/table/page/main.tsx',
  'bench/log/analyze.mjs',
];

/** Paths that must run everything. The first ten are the plan's own list (N24-ci-speed.md, "Negative controls"). */
const PLAN_NEGATIVES = [
  'go.mod',
  'vite.config.ts',
  'package.json',
  'pnpm-lock.yaml',
  '.github/workflows/pr.yml',
  '.github/workflows/pr-checks.yml',
  '.github/ci/Dockerfile',
  '.github/CODEOWNERS',
  'Taskfile.yml',
  'a-directory-nobody-has-seen/and-a-file.xyz',
];
const OTHER = [
  ...PLAN_NEGATIVES,
  'go.sum',
  'pnpm-workspace.yaml',
  '.golangci.yml',
  'tsconfig.json',
  'index.html',
  'main.go',
  'build/Taskfile.yml',
  'build/darwin/Info.plist',
  'backend/pkg/plugin/manager.go',
  'internal/devworkspace/links.go',
  'cmd/omniview-dev/main.go',
  'ui/main.tsx',
  'ui-next/test-setup.ts', // loaded by the e2e suite: see the tripwire tests
  'packages/omniviewdev-runtime/src/index.ts',
  'packages/omniviewdev-providers/package.json',
  'packages/omniviewdev-vite-plugin/src/index.ts',
  'bench/render/table.bench.tsx',
  'bench/app/run.mjs',
  'e2e/tests/layout/app-shell.spec.ts',
  'e2e/scripts/run.mjs',
  'scripts/ci/changes.mjs',
  'scripts/ci/changes.test.mjs',
  'scripts/ci/check-image.mjs',
  'scripts/ci/check-image.test.mjs',
  'scripts/ui-audit/check.mjs',
  'scripts/ui-flavour.test.mjs',
  'scripts/react-compiler.test.mjs',
  'scripts/check-tracked-outputs.mjs',
  'CLAUDE.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  '.changeset/some-change.md',
  '.agents/skills/omniview-ui-mocks/SKILL.md',
  'docs/new.mdx',
  'docs/guide.markdown',
  'docs/notes.txt',
  'docs/superpowers/specs/design.zip',
  'docs/images/native-controls-marketplace-after.png',
  'docs/pr-evidence/run.sh',
  'evidence/metrics-416-admission-batch/summary.json',
  'public/images/logo.svg',
  'patches/vite@7.3.7.patch',
];

test('documentation is what nothing builds or reads: README.md, Markdown under docs/, the .txt copies of the proof tools', () => {
  for (const file of DOCS) assert.equal(pathArea(file), 'docs', file);
});

test('the new UI is ui-next/, packages/kit/ and docs/ui-next/, Markdown and fixtures included', () => {
  for (const file of NEW_UI) assert.equal(pathArea(file), 'new-ui', file);
});

test('the new UI\'s own tooling is the new UI: the probe table and its test, the Pods scripts, the bundle script of the flavour guard, the kit\'s benches', () => {
  for (const file of NEW_UI_TOOLING) assert.equal(pathArea(file), 'new-ui', file);
});

test('NEGATIVE: what only looks like that tooling is "other": a sibling script, a backup, a prefix, the benches the host profile and the render benchmarks run', () => {
  for (const file of [
    'scripts/ci/probe-shards.mjs.bak',
    'scripts/ci/probe-shards-extra.mjs',
    'scripts/ci/probe-units',
    'scripts/ci/probe-units-extra/panel.mjs',
    'scripts/ci/probe-units/helper.go',
    'scripts/ci/changes.mjs',
    'scripts/ci/check-image.mjs',
    'scripts/ci/probe-shard.mjs',
    'scripts/ui-next-pods-extra/host.sh',
    'scripts/ui-next-pods',
    'scripts/ui-next-bundle.mjs.old',
    'scripts/ui-next-bundle.mjs/x.js',
    'scripts/ui-next-bundles.mjs',
    'scripts/ui-next-pods/helper.go',
    'bench/table-extra/run.mjs',
    'bench/tablex/run.mjs',
    'bench/table',
    'bench/logs/run.mjs',
    'bench/log/go.mod',
    'bench/render/README.md',
    'bench/app/archive-smoke.mjs',
    'bench/vite/wails-binding-index.ts',
    'bench/historycipherprobe/main.go',
  ]) {
    assert.equal(pathArea(file), 'other', file);
  }
});

// The one file of the new trees that a host job executes: vite.config.ts lists `./ui-next/test-setup.ts` among the root vitest configuration's `setupFiles` (vite.config.ts:55), and the e2e
// runner runs `vitest run ui/features/plugins/adapters/clearPlugin.test.ts` with that configuration in every run that is not cache-only (e2e/scripts/cohort.mjs:74, run.mjs:229). So a change to
// it can change the e2e result, and it is "other". The two tests below are tripwires: they read the real files, and fail when the carve-out stops being enough.
const readRepoFile = (file) => readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../..', file), 'utf8');

test('NEGATIVE: ui-next/test-setup.ts, which the e2e suite loads through vite.config.ts, is "other", alone and among new-UI paths; another file of the new UI is not', () => {
  assert.equal(pathArea('ui-next/test-setup.ts'), 'other');
  assert.equal(classOf('ui-next/test-setup.ts'), 'all');
  assert.equal(classOf('ui-next/App.tsx', 'ui-next/test-setup.ts', 'docs/ui-next/status/N24-D1.md'), 'all');
  assert.equal(pathArea('ui-next/shell/test-setup.ts'), 'new-ui');
  assert.equal(pathArea('packages/kit/vitest.setup.ts'), 'new-ui');
});

test('TRIPWIRE: ui-next/test-setup.ts imports nothing, so that the one carved-out path is every file the e2e suite can reach in the new UI', () => {
  const source = readRepoFile('ui-next/test-setup.ts');
  const code = source.split('\n').filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line)).join('\n');
  assert.doesNotMatch(code, /\bimport\b|\brequire\s*\(|\bexport\b.*\bfrom\b/, 'a file it imports is an input of the e2e suite too: add it to the carve-out in scripts/ci/changes.mjs (pathArea), with a test');
});

test('TRIPWIRE: vite.config.ts names no other file of the new trees than the setup file, the flavour root and the test glob; a new one is an input of the jobs that load it', () => {
  const code = readRepoFile('vite.config.ts').split('\n').filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line)).join('\n');
  const named = [...code.matchAll(/(['"`])((?:\.\/)?(?:ui-next|packages\/kit)[^'"`\n]*)\1/g)].map((match) => match[2]).sort();
  assert.deepEqual(named, ['./ui-next/test-setup.ts', 'ui-next', 'ui-next/**/*.{spec,test}.{ts,tsx}'], 'vite.config.ts changed what it reads from the new trees: decide which of the new paths the host jobs now read, and carve them out in scripts/ci/changes.mjs');
});

test('NEGATIVE: every other path is "other", which runs everything: the plan\'s list and what the host builds, tests and ships', () => {
  for (const file of OTHER) assert.equal(pathArea(file), 'other', file);
});

test('NEGATIVE: a path that only starts like a documentation or new-UI path is "other"', () => {
  for (const file of [
    'ui-next-other/App.tsx',
    'ui-next',
    'xui-next/App.tsx',
    'packages/kit',
    'packages/kit-extra/src/index.ts',
    'packages/kitten/src/index.ts',
    'packages/omniviewdev-kit/src/index.ts',
    'docs-other/notes.md',
    'docsx/notes.md',
    'docs',
    'doc/notes.md',
    'UI-NEXT/App.tsx',
    'Docs/notes.md',
    'README.md/script.js',
    'sub/README.md',
    'ui/docs/guide.md',
    'ui-next.md',
    'docs/ui-nextx/status/x.md.exe',
  ]) {
    assert.equal(pathArea(file), 'other', file);
  }
});

test('NEGATIVE: a Markdown-looking path that is not prose is not documentation: "other" under docs/, "new-ui" under docs/ui-next/, never "docs"', () => {
  for (const file of ['docs/.md', 'docs/x.MD', 'docs/x.md.js', 'docs/x.mdx', 'docs/x.md/y.js', 'docs/notes.txt', 'docs/guide.markdown']) {
    assert.equal(pathArea(file), 'other', file);
  }
  for (const file of ['docs/ui-next/.md', 'docs/ui-next/x.MD', 'docs/ui-next/x.mdx', 'docs/ui-next/notes.txt', 'docs/ui-next/status.txt', 'docs/ui-next/statuses/x.txt']) {
    assert.equal(pathArea(file), 'new-ui', file);
  }
});

test('NEGATIVE: a path that climbs, repeats a separator, hides a segment or is not a plain relative path is "other", whatever it ends like', () => {
  for (const file of [
    '',
    '/docs/new.md',
    '/ui-next/App.tsx',
    'docs//new.md',
    'docs/./new.md',
    'docs/../go.mod',
    'docs/a/../b.md',
    'ui-next/../go.mod',
    'ui-next/./App.tsx',
    'packages/kit/../../go.mod',
    'docs\\new.md',
    'ui-next\\App.tsx',
    'docs/new.md/',
    'ui-next/',
    'docs/ui-next/status/../../../go.mod',
    'docs/new\0.md',
    'docs/line\nbreak.md',
    'docs/tab\there.md',
    'docs/esc\u001b.md',
    'ui-next/new\nline.ts',
    '../docs/new.md',
  ]) {
    assert.equal(pathArea(file), 'other', JSON.stringify(file));
  }
  assert.equal(pathArea(undefined), 'other');
  assert.equal(pathArea(null), 'other');
  assert.equal(pathArea(42), 'other');
});

test('NEGATIVE: a Go input is "other" wherever it sits, even under the new UI: the Go jobs read it', () => {
  for (const file of [
    'ui-next/helper.go',
    'ui-next/helper_test.go',
    'ui-next/go.mod',
    'ui-next/go.sum',
    'ui-next/go.work',
    'ui-next/go.work.sum',
    'packages/kit/main.go',
    'packages/kit/native/glue.c',
    'packages/kit/native/glue.h',
    'packages/kit/native/glue.cc',
    'packages/kit/native/glue.cpp',
    'packages/kit/native/glue.m',
    'packages/kit/native/glue.mm',
    'packages/kit/native/glue.s',
    'packages/kit/native/glue.syso',
    'docs/ui-next/slices/x/go.mod',
    'docs/ui-next/baseline/tool.go',
  ]) {
    assert.equal(pathArea(file), 'other', file);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const classOf = (...paths) => classify(paths.flat()).class;

test('the three classes, and what each one skips', () => {
  assert.deepEqual(CLASSES, ['docs', 'new-ui', 'all']);
  const docs = classify(['docs/ui-next/status/N24-D1.md']);
  assert.deepEqual([docs.class, docs.skipHost, docs.skipUi, docs.skipWindows], ['docs', true, true, true]);
  const newUi = classify(['ui-next/App.tsx']);
  assert.deepEqual([newUi.class, newUi.skipHost, newUi.skipUi, newUi.skipWindows], ['new-ui', true, false, false]);
  const all = classify(['go.mod']);
  assert.deepEqual([all.class, all.skipHost, all.skipUi, all.skipWindows], ['all', false, false, false]);
});

test('a documentation-only change is "docs"', () => {
  assert.equal(classOf(DOCS), 'docs');
  for (const file of DOCS) assert.equal(classOf(file), 'docs', file);
});

test('a change to the new UI alone, or with its documentation or its tooling, is "new-ui"', () => {
  assert.equal(classOf(NEW_UI), 'new-ui');
  assert.equal(classOf(NEW_UI_TOOLING), 'new-ui');
  for (const file of [...NEW_UI, ...NEW_UI_TOOLING]) assert.equal(classOf(file), 'new-ui', file);
  assert.equal(classOf('ui-next/App.tsx', 'docs/ui-next/status/N24-D1.md', 'packages/kit/src/index.ts', 'README.md'), 'new-ui');
  assert.equal(classOf(DOCS, NEW_UI, NEW_UI_TOOLING), 'new-ui');
  assert.equal(classOf('scripts/ci/probe-shards.mjs', 'docs/ui-next/status/N24-D1.md'), 'new-ui', 'a pull request that edits the engine of the probe table: the engine, its status file');
  assert.equal(classOf('scripts/ci/probe-units/panel.mjs', 'ui-next/shell/probes/panel-probe.mjs', 'docs/ui-next/status/N25.md'), 'new-ui', 'a pull request that adds a control: its unit file, its probe, its status file (N25: it no longer edits scripts/ci/probe-shards.mjs)');
});

test('NEGATIVE: every path of the plan\'s list runs everything, alone, with documentation and with the new UI, in either order', () => {
  for (const file of PLAN_NEGATIVES) {
    for (const others of [[], DOCS, NEW_UI, NEW_UI_TOOLING, ['docs/ui-next/status/N24-D1.md', 'ui-next/App.tsx']]) {
      assert.equal(classOf(file, others), 'all', `${file} + ${others.length} paths`);
      assert.equal(classOf(others, file), 'all', `${others.length} paths + ${file}`);
    }
  }
});

test('NEGATIVE: documentation plus one code file runs everything, whichever file it is', () => {
  for (const file of OTHER) {
    assert.equal(classOf('docs/ui-next/status/N24-D1.md', file), 'all', file);
    assert.equal(classOf('docs/ui-next/status/N24-D1.md', 'ui-next/App.tsx', file), 'all', file);
  }
});

test('NEGATIVE: a Go file in the new UI, or a rename that lands in documentation, runs everything', () => {
  assert.equal(classOf('ui-next/App.tsx', 'ui-next/helper.go'), 'all');
  assert.equal(classOf('docs/ui-next/status/N24-D1.md', 'packages/kit/go.mod'), 'all');
});

test('NEGATIVE: no changed path at all runs everything: there is nothing to prove a skip with', () => {
  assert.equal(classify([]).class, 'all');
  assert.equal(classify([]).skipHost, false);
  assert.equal(classify([]).skipUi, false);
  assert.equal(classify([]).skipWindows, false);
  assert.throws(() => classify(undefined), /paths/);
  assert.throws(() => classify('go.mod'), /paths/);
});

test('NEGATIVE: one unknown path among a thousand known ones runs everything, wherever it sits in the list', () => {
  const known = Array.from({ length: 1000 }, (_, i) => `ui-next/generated/file-${i}.ts`);
  for (const at of [0, 1, 500, 1000]) {
    const paths = [...known.slice(0, at), 'somewhere/new/file', ...known.slice(at)];
    assert.equal(classOf(paths), 'all', `at ${at}`);
  }
  assert.equal(classOf(known), 'new-ui');
});

test('the class does not depend on the order of the paths or on repeats', () => {
  const mixes = [
    [...DOCS, ...NEW_UI],
    [...NEW_UI, 'go.mod'],
    [...DOCS, 'Taskfile.yml', 'docs/ui-next/status/N24-D1.md'],
    [...DOCS],
  ];
  for (const paths of mixes) {
    const expected = classOf(paths);
    assert.equal(classOf([...paths].reverse()), expected);
    assert.equal(classOf([...paths, ...paths]), expected);
    const shuffled = paths.map((_, i) => paths[(i * 7 + 3) % paths.length]);
    assert.equal(classOf(shuffled), classOf([...new Set(shuffled)]), 'a shuffle with repeats');
  }
});

test('adding a path never lets a change skip more: "other" is absorbing, "new-ui" only ever moves "docs" up', () => {
  const rank = { docs: 0, 'new-ui': 1, all: 2 };
  const everything = [...DOCS, ...NEW_UI, ...OTHER];
  for (const first of everything) {
    for (const second of everything) {
      const both = classOf(first, second);
      assert.ok(rank[both] >= Math.max(rank[classOf(first)], rank[classOf(second)]), `${first} + ${second}`);
    }
  }
});

test('the result names the paths that made it "all", each once, in the order they came, and counts every path', () => {
  const result = classify(['docs/ui-next/status/N24-D1.md', 'go.mod', 'ui-next/App.tsx', 'vite.config.ts', 'go.mod']);
  assert.equal(result.class, 'all');
  assert.deepEqual(result.deciding, ['go.mod', 'vite.config.ts']);
  assert.deepEqual(result.counts, { docs: 1, 'new-ui': 1, other: 2 });
  assert.deepEqual(classify(['ui-next/App.tsx']).deciding, []);
  assert.deepEqual(classify([]).deciding, []);
});

test('the outputs a workflow reads: only skip flags, which are the strings "true" and "false", and the class', () => {
  assert.deepEqual(outputsOf(classify(['docs/ui-next/status/N24-D1.md'])), { class: 'docs', skip_host: 'true', skip_ui: 'true', skip_windows: 'true' });
  assert.deepEqual(outputsOf(classify(['ui-next/App.tsx'])), { class: 'new-ui', skip_host: 'true', skip_ui: 'false', skip_windows: 'false' });
  assert.deepEqual(outputsOf(classify(['go.mod'])), { class: 'all', skip_host: 'false', skip_ui: 'false', skip_windows: 'false' });
  assert.deepEqual(Object.keys(outputsOf(classify([]))).sort(), ['class', 'skip_host', 'skip_ui', 'skip_windows']);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The jobs each flag skips
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('the table of gated jobs: two flags, two workflows, each job once, and the jobs that always run are not in it', () => {
  assert.ok(GATED.length > 0);
  const seen = new Set();
  for (const entry of GATED) {
    assert.ok(['host', 'ui', 'windows'].includes(entry.flag), JSON.stringify(entry));
    assert.ok(['pr.yml', 'pr-checks.yml'].includes(entry.workflow), JSON.stringify(entry));
    assert.ok(entry.job && entry.check, JSON.stringify(entry));
    const key = `${entry.workflow}:${entry.job}`;
    assert.ok(!seen.has(key), `${key} is listed twice`);
    seen.add(key);
  }
  for (const entry of ALWAYS) assert.ok(!seen.has(`${entry.workflow}:${entry.job}`), `${entry.job} always runs and is also gated`);
  // The repository guard and the classifier are the two that must run on every pull request.
  assert.ok(ALWAYS.some((entry) => entry.workflow === 'pr-checks.yml' && entry.job === 'repo-guard'));
  assert.ok(ALWAYS.filter((entry) => entry.job === 'changes').length === 2, 'one classifier job in each of the two workflows');
});

test('what is skipped by path: nothing for "all", the host jobs for "new-ui", every gated job for "docs"', () => {
  assert.deepEqual(skippedBy(classify(['go.mod'])), []);
  assert.deepEqual(skippedBy(classify(['ui-next/App.tsx'])).map((entry) => entry.job), GATED.filter((entry) => entry.flag === 'host').map((entry) => entry.job));
  assert.deepEqual(skippedBy(classify(['docs/ui-next/status/N24-D1.md'])), GATED);
  for (const entry of skippedBy(classify(['ui-next/App.tsx']))) assert.equal(entry.flag, 'host');
});

test('NEGATIVE: the jobs that check the UI are not skipped for a change to the new UI, and the guard and the gates are never skipped', () => {
  const skipped = skippedBy(classify(['ui-next/App.tsx', 'packages/kit/src/index.ts', 'docs/ui-next/status/N24-D1.md'])).map((entry) => entry.job);
  for (const job of ['ui-build', 'ui-lint', 'ui-component-tests', 'ui-runtime-contract', 'c02-corpus']) assert.ok(!skipped.includes(job), job);
  for (const job of ['repo-guard', 'changes', 'ui-checks', 'e2e-tests']) assert.ok(!skippedBy(classify(['docs/ui-next/status/N24-D1.md'])).some((entry) => entry.job === job), job);
  for (const job of ['go-checks', 'go-lint', 'windows-connection-profiles', 'bindings-check', 'release-packaging-checks', 'e2e-application', 'build-artifacts']) assert.ok(skipped.includes(job), job);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Against the e2e selector
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const selected = (...paths) => selectChanges({ changes: paths.flat().map((file) => ({ status: 'M', paths: [file] })), complete: true });

test('everything this classifier calls documentation, the e2e selector calls prose: it would select no test either', () => {
  for (const file of DOCS) assert.equal(selected(file).kind, 'none', file);
  assert.equal(selected(DOCS).kind, 'none');
});

test('TRIPWIRE: over every file the repository tracks, a file this classifier calls documentation is prose to the e2e selector, and no file of the new UI is a Go input', () => {
  const listed = spawnSync('git', ['-C', path.join(path.dirname(fileURLToPath(import.meta.url)), '../..'), 'ls-files', '-z'], { encoding: 'utf8', env: GIT_ENV, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(listed.status, 0, listed.stderr);
  const tracked = listed.stdout.split('\0').filter(Boolean);
  assert.ok(tracked.length > 1000, 'the repository has files');
  const counts = { docs: 0, 'new-ui': 0, other: 0 };
  for (const file of tracked) {
    const area = pathArea(file);
    counts[area] += 1;
    if (area === 'docs' && !file.startsWith('docs/ui-next/status/')) assert.equal(selected(file).kind, 'none', `${file} is documentation here and not prose to the e2e selector`);
    if (area === 'new-ui') assert.doesNotMatch(file, /\.(go|c|h|s|syso)$|(^|\/)go\.(mod|sum|work)$/, `${file} is a Go input in the new UI`);
  }
  assert.ok(counts.docs > 0 && counts['new-ui'] > 0 && counts.other > 0, JSON.stringify(counts));
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'changes test',
  GIT_AUTHOR_EMAIL: 'changes@example.test',
  GIT_COMMITTER_NAME: 'changes test',
  GIT_COMMITTER_EMAIL: 'changes@example.test',
};

function git(root, args, env = GIT_ENV) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function put(root, file, text = `${file}\n`) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), text);
}

function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '--allow-empty', '-m', message]);
}

/** A repository whose first commit holds `files` (path -> text), on `main`. */
function repository(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'changes-'));
  roots.push(root);
  git(root, ['init', '-q', '-b', 'main']);
  for (const [file, text] of Object.entries(files)) put(root, file, text);
  commit(root, 'base');
  return root;
}

/**
 * What GitHub checks out for a pull request: a detached merge commit of the base's tip (HEAD^1) and the branch (HEAD^2). `change` is the branch's work; `baseMoves` is what the base
 * did meanwhile, which the merge commit holds too and the pull request did not change.
 */
function pullRequest(root, change, baseMoves = () => {}) {
  git(root, ['checkout', '-q', '-b', 'pr']);
  change(root);
  commit(root, 'the pull request');
  git(root, ['checkout', '-q', 'main']);
  baseMoves(root);
  commit(root, 'the base moves on');
  git(root, ['checkout', '-q', '--detach', 'main']);
  git(root, ['merge', '-q', '--no-ff', '-m', 'merge', 'pr']);
  return root;
}

test('the changed paths are what the merge commit adds to its first parent, and not what the base did meanwhile', () => {
  const root = repository({ 'go.mod': 'module x\n', 'ui-next/App.tsx': 'a\n', 'docs/a.md': 'a\n' });
  pullRequest(
    root,
    (dir) => {
      put(dir, 'ui-next/App.tsx', 'changed\n');
      put(dir, 'docs/new.md');
    },
    (dir) => put(dir, 'go.mod', 'module x // moved on\n'),
  );
  assert.deepEqual(changedPaths({ root }).sort(), ['docs/new.md', 'ui-next/App.tsx']);
  assert.deepEqual(changedPaths({ root, base: 'HEAD^1', head: 'HEAD' }).sort(), ['docs/new.md', 'ui-next/App.tsx']);
});

test('NEGATIVE: a rename counts both paths, so that moving go.mod into documentation is not documentation, whatever the user\'s Git is set to detect', () => {
  const root = repository({ 'go.mod': 'module example.test/x\n\ngo 1.27.0\n', 'ui-next/App.tsx': 'a\n' });
  pullRequest(root, (dir) => {
    mkdirSync(path.join(dir, 'docs'));
    git(dir, ['mv', 'go.mod', 'docs/old-go-mod.md']);
  });
  // What a plain `git diff --name-only` prints for it, with rename detection on: only the new name.
  const plain = git(root, ['-c', 'diff.renames=true', 'diff', '--name-only', 'HEAD^1', 'HEAD']).trim().split('\n');
  assert.deepEqual(plain, ['docs/old-go-mod.md'], 'the premise: Git alone hides the old path');
  const config = path.join(mkdtempSync(path.join(tmpdir(), 'changes-config-')), 'gitconfig');
  roots.push(path.dirname(config));
  writeFileSync(config, '[diff]\n\trenames = copies\n[core]\n\tquotePath = true\n[diff "x"]\n\ttextconv = false\n');
  for (const env of [GIT_ENV, { ...GIT_ENV, GIT_CONFIG_GLOBAL: config }]) {
    const paths = changedPaths({ root, env }).sort();
    assert.deepEqual(paths, ['docs/old-go-mod.md', 'go.mod']);
    assert.equal(classify(paths).class, 'all');
  }
});

test('a copy and a rename inside the new UI count both paths, and a mode change, a deletion and an addition are changes', () => {
  const root = repository({ 'ui-next/a.ts': 'same\n'.repeat(40), 'ui-next/script.sh': '#!/bin/sh\n', 'docs/gone.md': 'x\n' });
  pullRequest(root, (dir) => {
    put(dir, 'ui-next/copy.ts', 'same\n'.repeat(40));
    git(dir, ['mv', 'ui-next/a.ts', 'ui-next/b.ts']);
    spawnSync('chmod', ['+x', path.join(dir, 'ui-next/script.sh')]);
    git(dir, ['rm', '-q', 'docs/gone.md']);
    put(dir, 'ui-next/added.ts');
  });
  assert.deepEqual(changedPaths({ root }).sort(), ['docs/gone.md', 'ui-next/a.ts', 'ui-next/added.ts', 'ui-next/b.ts', 'ui-next/copy.ts', 'ui-next/script.sh']);
});

test('names Git would quote, split or mistake for an option come back as they are', () => {
  const root = repository({ 'README.md': 'x\n' });
  const names = ['docs/a b.md', 'docs/quote"s.md', 'docs/üñí/日本語.md', 'docs/tab\there.md', 'docs/line\nbreak.md', 'docs/-dash.md', 'docs/back\\slash.md', "docs/it's.md"];
  pullRequest(root, (dir) => {
    for (const name of names) put(dir, name);
  });
  assert.deepEqual(changedPaths({ root }).sort(), [...names].sort());
});

test('a change that changes nothing, as a push of an empty commit does to a pull request that already has a diff, has no paths', () => {
  const root = repository({ 'README.md': 'x\n' });
  pullRequest(root, () => {});
  assert.deepEqual(changedPaths({ root }), []);
});

test('NEGATIVE: a base Git cannot resolve, a directory that is not a repository and a "base" that is an option are errors, not an empty change', () => {
  const root = repository({ 'README.md': 'x\n' });
  assert.throws(() => changedPaths({ root, base: 'no-such-ref' }), /no-such-ref/);
  assert.throws(() => changedPaths({ root, base: 'HEAD^1' }), /HEAD\^1/, 'a first commit has no parent');
  assert.throws(() => changedPaths({ root: mkdtempSync(path.join(tmpdir(), 'changes-none-')) }), /git/i);
  assert.throws(() => changedPaths({ root, base: '--output=/tmp/changes-test-output' }), /ref/i);
  assert.throws(() => changedPaths({ root, head: '-p' }), /ref/i);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

function scratchFile() {
  const directory = mkdtempSync(path.join(tmpdir(), 'changes-out-'));
  roots.push(directory);
  return path.join(directory, 'file');
}

function run(root, args = [], env = {}) {
  const output = scratchFile();
  const summary = scratchFile();
  const result = spawnSync(process.execPath, [script, '--root', root, ...args], {
    encoding: 'utf8',
    env: { ...GIT_ENV, GITHUB_ACTIONS: '', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary, ...env },
  });
  const read = (file) => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  };
  return { ...result, outputs: read(output), summary: read(summary), text: `${result.stdout}${result.stderr}` };
}

const withChange = (before, change) => pullRequest(repository(before), change);

test('the command writes the class and the two skip flags where the workflow reads them, and nothing else', () => {
  const cases = [
    [{ 'docs/a.md': 'a\n' }, (dir) => put(dir, 'docs/a.md', 'b\n'), 'class=docs\nskip_host=true\nskip_ui=true\nskip_windows=true\n'],
    [{ 'ui-next/a.ts': 'a\n' }, (dir) => put(dir, 'ui-next/a.ts', 'b\n'), 'class=new-ui\nskip_host=true\nskip_ui=false\nskip_windows=false\n'],
    [{ 'go.mod': 'a\n' }, (dir) => put(dir, 'go.mod', 'b\n'), 'class=all\nskip_host=false\nskip_ui=false\nskip_windows=false\n'],
  ];
  for (const [before, change, expected] of cases) {
    const outcome = run(withChange(before, change));
    assert.equal(outcome.status, 0, outcome.text);
    assert.equal(outcome.outputs, expected);
    assert.match(outcome.stdout, new RegExp(expected.split('\n')[0]), 'and says it on its own output');
  }
});

test('the default base is HEAD^1, the first parent of the merge commit a pull request is checked out as', () => {
  const root = withChange({ 'ui-next/a.ts': 'a\n', 'go.mod': 'a\n' }, (dir) => put(dir, 'ui-next/a.ts', 'b\n'));
  assert.equal(run(root).outputs, 'class=new-ui\nskip_host=true\nskip_ui=false\nskip_windows=false\n', 'what the pull request changed, with no flag at all');
  assert.equal(run(root, ['--head', 'HEAD^1']).outputs, 'class=all\nskip_host=false\nskip_ui=false\nskip_windows=false\n', 'the head is a flag too: the base against itself has no change to show');
  git(root, ['commit', '-q', '--allow-empty', '-m', 'on top']);
  // HEAD^1 of the empty commit on top is the merge commit: nothing changed since.
  assert.equal(run(root).outputs, 'class=all\nskip_host=false\nskip_ui=false\nskip_windows=false\n', 'an empty change runs everything');
  assert.equal(run(root, ['--base', 'HEAD~1']).outputs, 'class=all\nskip_host=false\nskip_ui=false\nskip_windows=false\n');
  assert.equal(run(root, ['--base', 'main~0', '--head', 'pr']).outputs, 'class=new-ui\nskip_host=true\nskip_ui=false\nskip_windows=false\n');
});

test('the job summary says what was skipped by path and why, with the name of each check', () => {
  const docs = run(withChange({ 'docs/a.md': 'a\n' }, (dir) => put(dir, 'docs/a.md', 'b\n')));
  assert.match(docs.summary, /^### Changed paths: `docs`/m);
  assert.match(docs.summary, /1 changed path: 1 documentation, 0 new UI, 0 elsewhere/);
  for (const entry of GATED) assert.ok(docs.summary.includes(`${entry.check}`), `${entry.check} in the docs summary`);
  assert.match(docs.summary, /skipped by path: docs/);

  const newUi = run(withChange({ 'ui-next/a.ts': 'a\n' }, (dir) => put(dir, 'ui-next/a.ts', 'b\n')));
  assert.match(newUi.summary, /^### Changed paths: `new-ui`/m);
  assert.match(newUi.summary, /skipped by path: new-ui/);
  assert.ok(newUi.summary.includes('Go checks'));
  assert.ok(!newUi.summary.includes('UI build'), 'the UI jobs run for a change to the new UI');

  const all = run(withChange({ 'go.mod': 'a\n', 'ui-next/a.ts': 'a\n' }, (dir) => {
    put(dir, 'go.mod', 'b\n');
    put(dir, 'ui-next/a.ts', 'b\n');
  }));
  assert.match(all.summary, /^### Changed paths: `all`/m);
  assert.match(all.summary, /Everything runs/);
  assert.match(all.summary, /`go\.mod`/);
  assert.doesNotMatch(all.summary, /skipped by path/);
});

test('a long list of the paths that decided is cut, and says how many it left out', () => {
  const root = withChange({ 'README.md': 'x\n' }, (dir) => {
    for (let i = 0; i < 25; i += 1) put(dir, `new-area/file-${String(i).padStart(2, '0')}.txt`);
  });
  const outcome = run(root);
  assert.match(outcome.summary, /new-area\/file-00\.txt/);
  assert.match(outcome.summary, /new-area\/file-09\.txt/);
  assert.doesNotMatch(outcome.summary, /new-area\/file-10\.txt/);
  assert.match(outcome.summary, /\(15 more\)/);
});

test('NEGATIVE: a file name cannot write a workflow command or Markdown of its own into the log or the summary', () => {
  const evil = ['new-area/x\n::error::injected by a file name', 'new-area/y\n::set-output name=skip_host::true', 'new-area/`z` | <b>bold</b>\r\n## heading', 'new-area/::stop-commands::token'];
  const root = withChange({ 'README.md': 'x\n' }, (dir) => {
    for (const name of evil) put(dir, name);
  });
  const outcome = run(root, [], { GITHUB_ACTIONS: 'true' });
  assert.equal(outcome.status, 0, outcome.text);
  for (const stream of [outcome.stdout, outcome.stderr, outcome.summary]) {
    // the one workflow command the script writes is its own notice, with the class and the flags and nothing a file name could reach
    for (const line of stream.split(/\r?\n/).filter((entry) => entry !== 'class=all skip_host=false skip_ui=false skip_windows=false' && !/^::notice title=Changed paths::class=all skip_host=false skip_ui=false skip_windows=false$/.test(entry))) assert.doesNotMatch(line, /^::/, `a line that is a workflow command: ${line}`);
    assert.doesNotMatch(stream, /\r/);
  }
  assert.doesNotMatch(outcome.summary, /^## heading/m);
  assert.equal(outcome.outputs, 'class=all\nskip_host=false\nskip_ui=false\nskip_windows=false\n', 'and a file name never reaches the outputs');
});

test('NEGATIVE: when it cannot tell what changed it fails, with the reason, and writes no output: the jobs that read none run, and the gates are red', () => {
  const root = repository({ 'README.md': 'x\n' });
  const outcome = run(root, ['--base', 'HEAD^1']);
  assert.equal(outcome.status, 1, outcome.text);
  assert.match(outcome.stderr, /^changes: /m);
  assert.ok(!outcome.outputs, 'nothing is written to the outputs');
  const annotated = run(root, ['--base', 'HEAD^1'], { GITHUB_ACTIONS: 'true' });
  assert.equal(annotated.status, 1);
  assert.match(annotated.stdout, /^::error title=Changed paths::/m);
});

test('a usage error is exit 2 with the usage', () => {
  const root = repository({ 'README.md': 'x\n' });
  for (const args of [['--bogus'], ['--base'], ['stray'], ['--head']]) {
    const outcome = run(root, args);
    assert.equal(outcome.status, 2, `${args.join(' ')}: ${outcome.text}`);
    assert.match(outcome.stderr, /usage: node scripts\/ci\/changes\.mjs/);
  }
});

test('the summary of a classification can be rendered without a repository', () => {
  const text = renderSummary(classify(['docs/ui-next/status/N24-D1.md', 'ui-next/App.tsx']));
  assert.match(text, /### Changed paths: `new-ui`/);
  assert.match(text, /2 changed paths: 1 documentation, 1 new UI, 0 elsewhere/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Rulings after the first review: the Windows build stays for the new UI; everything under docs/ui-next/status/ is documentation; where the merge gate reads the class
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('everything under docs/ui-next/status/ is documentation, whatever its extension: the evidence nothing reads', () => {
  for (const file of DOCS_EVIDENCE) assert.equal(pathArea(file), 'docs', file);
  assert.equal(classOf(DOCS_EVIDENCE), 'docs');
  assert.equal(classOf(DOCS, DOCS_EVIDENCE), 'docs');
  assert.equal(classOf('docs/ui-next/status/L2/shot.png', 'ui-next/App.tsx'), 'new-ui');
});

test('NEGATIVE: nothing else under docs/ changes class with that: the baseline, the slices and their fixture stay the new UI, the rest of docs/ stays "other", a Go input under status/ is "other"', () => {
  for (const file of ['docs/ui-next/baseline/run.sh', 'docs/ui-next/baseline/raw/pass1/render.json', 'docs/ui-next/slices/1a-pods-list/fixture.yaml', 'docs/ui-next/slices/1a-pods-list/ref.webp', 'docs/ui-next/status', 'docs/ui-next/status.png', 'docs/ui-next/statuses/x.png']) {
    assert.equal(pathArea(file), 'new-ui', file);
  }
  for (const file of ['docs/x.png', 'docs/images/a.png', 'docs/superpowers/specs/design.zip', 'docs/pr-evidence/run.sh', 'docs/notes.yaml', 'docs/status/x.png']) assert.equal(pathArea(file), 'other', file);
  for (const file of ['docs/ui-next/status/x.go', 'docs/ui-next/status/y_test.go', 'docs/ui-next/status/go.mod', 'docs/ui-next/status/K2a/go.sum', 'docs/ui-next/status/n/glue.c']) assert.equal(pathArea(file), 'other', file);
  assert.equal(classOf('docs/ui-next/status/L2/shot.png', 'docs/x.png'), 'all');
  assert.equal(classOf('docs/ui-next/status/L2/shot.png', 'docs/ui-next/baseline/run.sh'), 'new-ui');
  assert.equal(pathArea('docs/ui-next/status/../../../go.mod'), 'other');
});

test('the Windows build is kept for a change to the new UI and skipped only for documentation; the macOS and Linux builds are skipped for both', () => {
  const windows = GATED.find((entry) => entry.job === 'build-artifacts-windows');
  assert.ok(windows, 'the Windows build is a job of its own');
  assert.equal(windows.flag, 'windows');
  assert.equal(windows.check, 'build-artifacts (windows/amd64)');
  const newUi = skippedBy(classify(['ui-next/App.tsx', 'packages/kit/src/index.ts'])).map((entry) => entry.job);
  assert.ok(!newUi.includes('build-artifacts-windows'), 'a change to the kit is built on Windows');
  assert.ok(newUi.includes('build-artifacts'), 'the macOS and Linux builds are skipped');
  const docs = skippedBy(classify(['docs/ui-next/status/N24-D1.md'])).map((entry) => entry.job);
  assert.ok(docs.includes('build-artifacts-windows') && docs.includes('build-artifacts'));
  assert.deepEqual(skippedBy(classify(['go.mod'])), []);
});

test('on a runner the command also writes one notice that names the class and the flags and no path: the check run carries it where the merge gate can read it', () => {
  const root = withChange({ 'ui-next/a.ts': 'a\n', 'go.mod': 'a\n' }, (dir) => put(dir, 'ui-next/a.ts', 'b\n'));
  const onRunner = run(root, [], { GITHUB_ACTIONS: 'true' });
  assert.equal(onRunner.status, 0, onRunner.text);
  assert.match(onRunner.stdout, /^::notice title=Changed paths::class=new-ui skip_host=true skip_ui=false skip_windows=false$/m);
  assert.equal(run(root, [], { GITHUB_ACTIONS: '' }).stdout.includes('::notice'), false, 'and nowhere else');
});

// "Nothing reads a path under docs/ui-next/status/" is what makes it documentation whatever it holds. Searched at the time: the mentions outside docs/ are comments, Markdown, messages and the e2e selector's classification (a regular
// expression and its test data). This reads the repository and fails when another file names the path on a line of code, or builds it from parts.
const STATUS_MENTIONS_ALLOWED = new Set(['scripts/ci/changes.mjs', 'scripts/ci/changes.test.mjs', 'scripts/ci/changes-workflows.test.mjs', 'e2e/scripts/select-tests.mjs', 'e2e/scripts/select-tests.test.mjs', 'scripts/ci/probe-shards.mjs']);

test('TRIPWIRE: no code, test or workflow outside docs/ names a path under docs/ui-next/status/ on a line of code, or joins "ui-next" and "status" into one', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const search = (args) => spawnSync('git', ['-C', root, 'grep', '-I', ...args, '--', '.', ':(exclude)docs', ':(exclude)scripts/ci/changes.test.mjs'], { encoding: 'utf8', env: GIT_ENV, maxBuffer: 64 * 1024 * 1024 }).stdout.split('\n').filter(Boolean);
  const offenders = [];
  for (const file of search(['-l', '-F', 'docs/ui-next/status'])) {
    if (file.endsWith('.md') || STATUS_MENTIONS_ALLOWED.has(file)) continue;
    readRepoFile(file).split('\n').forEach((line, index) => {
      if (line.includes('docs/ui-next/status') && !/^\s*(\/\/|#|\*|\/\*)/.test(line)) offenders.push(`${file}:${index + 1}`);
    });
  }
  offenders.push(...search(['-n', '-E', '[\'"`]ui-next[\'"`] *, *[\'"`]status[\'"`]']));
  assert.deepEqual(offenders, [], 'a file now names a path under docs/ui-next/status/: decide whether it READS it, and if it does take that path out of the documentation class in scripts/ci/changes.mjs (pathArea)');
});
