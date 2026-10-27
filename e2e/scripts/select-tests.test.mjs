import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cohortMatches, groups, parseNameStatus, selectChanges, selectFromGit } from './select-tests.mjs';

const change = path => ({ status: 'M', paths: [path] });
const selected = changes => selectChanges({ changes, complete: true, cohortUnchanged: true });
const roadmapProse = [
  'docs/roadmap/2026-10-17-product-roadmap.md',
  'docs/roadmap/2026-10-17-resource-intelligence-baseline.md',
  'docs/roadmap/2026-10-17-resource-intelligence-contract-readiness.md',
  'docs/roadmap/2026-10-17-resource-intelligence-work-packages.md',
  'docs/roadmap/2026-10-23-resource-intelligence-remote-index.md',
  'docs/roadmap/2026-10-25-global-command-search-acceptance.md',
];
test('full is default, explicit full overrides even prose, and unknown cohort is full', () => {
  assert.equal(selectChanges().kind, 'full');
  assert.equal(selectChanges({ full: true, changes: [change('README.md')] }).kind, 'full');
  assert.equal(selectChanges({ complete: true, changes: [change('README.md')] }).kind, 'full');
});
test('cohort sentinel allows selection only when base, sentinel and actual refs agree', () => {
  const current = { 'plugin-sdk': 'a'.repeat(40), ui: 'b'.repeat(40), kubernetes: 'd'.repeat(40) };
  assert.equal(cohortMatches({ current, baseline: { ...current }, actual: { ...current } }), true);
  for (const input of [
    {},
    { current, baseline: current },
    { current, baseline: { ...current, ui: 'c'.repeat(40) }, actual: current },
    { current, baseline: current, actual: { ...current, 'plugin-sdk': 'c'.repeat(40) } },
    { current, baseline: current, actual: { ...current, kubernetes: 'c'.repeat(40) } },
    { current: { ...current, ui: 'branch' }, baseline: current, actual: current },
  ]) {
    const cohortUnchanged = cohortMatches(input);
    assert.equal(cohortUnchanged, false);
    assert.equal(selectChanges({ changes: [change('README.md')], complete: true, cohortUnchanged }).kind, 'full');
  }
});
test('full selection covers every checked-in application spec and no observation spec', () => {
  const tests = fileURLToPath(new URL('../tests/', import.meta.url));
  const specs = readdirSync(tests, { recursive: true }).filter(path => path.endsWith('.spec.ts'));
  const full = selectChanges();
  for (const path of specs) {
    const matches = full.specs.filter(prefix => `tests/${path}`.startsWith(`${prefix}/`));
    assert.equal(matches.length, path.startsWith('observation/') ? 0 : 1, path);
  }
});
test('independent UI groups add their actual workspace and shell dependencies', () => {
  const result = selected([change('e2e/tests/settings/settings.spec.ts'), change('e2e/tests/panels/bottom-drawer.spec.ts')]);
  assert.deepEqual(result.groups, ['layout', 'settings', 'panels', 'workspaces']);
  assert.deepEqual(result.specs, result.groups.flatMap(group => groups[group]));
});
test('small consumer contracts run alone for fixture edits and accompany production adapter edits', () => {
  for (const path of [
    'e2e/tests/integration/published-consumers.spec.ts',
    'e2e/fixtures/published-consumers/fixture.mts',
  ]) {
    assert.deepEqual(selected([change(path)]).groups, ['tooling'], path);
  }
  for (const path of [
    'packages/omniviewdev-vite-plugin/src/index.ts',
    'packages/omniviewdev-vite-plugin/scripts/generate-shims.ts',
    'ui/features/plugins/api/importmap.ts',
  ]) {
    assert.deepEqual(selected([change(path)]).groups, ['layout', 'plugins', 'workspaces', 'tooling'], path);
  }
  assert.deepEqual(selected([
    change('e2e/tests/settings/settings.spec.ts'),
    change('e2e/tests/integration/published-consumers.spec.ts'),
  ]).groups, ['layout', 'settings', 'workspaces', 'tooling']);
});
test('core, unknown, fixture, package and cohort paths always force full', () => {
  for (const path of ['internal/devworkspace/watch.go', 'unclassified.txt', 'e2e/tests/fixtures/browser-errors.spec.ts', 'packages/omniviewdev-runtime/src/index.ts', 'e2e/source-cohort.json', 'pnpm-lock.yaml', 'ui/main.tsx']) {
    assert.equal(selected([change('README.md'), change(path)]).kind, 'full', path);
  }
});
test('rename old and new paths and deleted paths both affect selection', () => {
  assert.deepEqual(parseNameStatus('R100\0e2e/tests/settings/settings.spec.ts\0e2e/tests/plugins/plugins.spec.ts\0D\0README.md\0'), [
    { status: 'R100', paths: ['e2e/tests/settings/settings.spec.ts', 'e2e/tests/plugins/plugins.spec.ts'] }, { status: 'D', paths: ['README.md'] },
  ]);
  assert.deepEqual(selected([{ status: 'R100', paths: ['e2e/tests/settings/settings.spec.ts', 'e2e/tests/plugins/plugins.spec.ts'] }]).groups, ['layout', 'settings', 'plugins', 'workspaces']);
  assert.equal(selected([{ status: 'R100', paths: ['unknown.ts', 'README.md'] }]).kind, 'full');
  assert.deepEqual(selected([{ status: 'D', paths: ['ui/features/plugins/react/deleted.ts'] }]).groups, ['layout', 'plugins', 'workspaces']);
});
test('only explicitly listed prose skips; empty, malformed and truncated data fail closed', () => {
  assert.equal(selected([change('README.md')]).kind, 'none');
  for (const path of ['docs/new.md', 'docs/guide.mdx', 'README.md/script.js', '../README.md', '/README.md']) assert.equal(selected([change(path)]).kind, 'full');
  for (const changes of [[], null, [{ status: 'R100', paths: ['README.md'] }], [{ status: 'Z', paths: ['README.md'] }]]) assert.equal(selected(changes).kind, 'full');
  assert.equal(selectChanges({ changes: [change('README.md')], complete: false, cohortUnchanged: true }).kind, 'full');
  for (const data of ['M\0README.md', 'R100\0README.md\0', 'M\0README.md\0garbage\0']) assert.throws(() => parseNameStatus(data));
});
test('only approved roadmap Markdown paths are prose, with all conservative guards retained', () => {
  for (const path of roadmapProse) {
    for (const status of ['A', 'M', 'D']) assert.equal(selected([{ status, paths: [path] }]).kind, 'none', `${status} ${path}`);
    for (const unknown of ['docs/roadmap/new.md', 'docs/roadmap/2026-10-17-resource-intelligence-baseline.mdx', 'docs/roadmap/other/nested.md', 'internal/devworkspace/watch.go', 'e2e/source-cohort.json']) {
      assert.equal(selected([change(path), change(unknown)]).kind, 'full', unknown);
      for (const paths of [[path, unknown], [unknown, path]]) assert.equal(selected([{ status: 'R100', paths }]).kind, 'full');
    }
    assert.equal(selectChanges({ changes: [change(path)], complete: false, cohortUnchanged: true }).kind, 'full');
    assert.equal(selectChanges({ changes: [change(path)], complete: true, cohortUnchanged: false }).kind, 'full');
    assert.equal(selectChanges({ full: true, changes: [change(path)], complete: true, cohortUnchanged: true }).kind, 'full');
  }
  assert.equal(selected(roadmapProse.map(change)).kind, 'none');
  assert.deepEqual(selected([...roadmapProse.map(change), change('e2e/tests/settings/settings.spec.ts')]).groups, ['layout', 'settings', 'workspaces']);
});

test('actual roadmap Git diff skips only while committed, complete and within the approved paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'omniview-roadmap-selector-'));
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=Selector', '-c', 'user.email=selector@example.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${devNull}`, ...args], { encoding: 'utf8' }).trim();
  try {
    git('init', '--initial-branch=main');
    mkdirSync(join(root, 'docs/roadmap'), { recursive: true });
    for (const path of roadmapProse.slice(0, -1)) writeFileSync(join(root, path), `original ${path}\n`);
    git('add', '.'); git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    for (const path of roadmapProse) writeFileSync(join(root, path), `updated ${path}\n`);
    git('add', '.'); git('commit', '-m', 'approved roadmap documents');
    assert.equal(selectFromGit({ root, base, cohortUnchanged: true }).kind, 'none');
    assert.equal(selectFromGit({ root, base, cohortUnchanged: false }).kind, 'full');
    assert.equal(selectFromGit({ root, base: 'missing-ref', cohortUnchanged: true }).kind, 'full');
    writeFileSync(join(root, roadmapProse[0]), 'uncommitted approved prose\n');
    assert.equal(selectFromGit({ root, base, cohortUnchanged: true }).kind, 'full');
    git('add', '.');
    assert.equal(selectFromGit({ root, base, cohortUnchanged: true }).kind, 'full');
    git('commit', '-m', 'committed prose');
    assert.equal(selectFromGit({ root, base, cohortUnchanged: true }).kind, 'none');
    const beforeDelete = git('rev-parse', 'HEAD');
    git('rm', roadmapProse[0]); git('commit', '-m', 'deleted approved prose');
    assert.equal(selectFromGit({ root, base: beforeDelete, cohortUnchanged: true }).kind, 'none');
    const beforeRename = git('rev-parse', 'HEAD');
    git('mv', roadmapProse[1], 'docs/roadmap/unclassified.md');
    git('commit', '-am', 'rename outside allowlist');
    assert.equal(selectFromGit({ root, base: beforeRename, cohortUnchanged: true }).kind, 'full');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('git merge-base, old/new rename and unavailable base are real repository boundaries', () => {
  const root = mkdtempSync(join(tmpdir(), 'omniview-selector-'));
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=Selector', '-c', 'user.email=selector@example.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${devNull}`, ...args], { encoding: 'utf8' }).trim();
  try {
    git('init', '--initial-branch=main');
    writeFileSync(join(root, 'README.md'), 'initial\n');
    git('add', '.'); git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'README.md'), 'prose change\n');
    git('commit', '-am', 'prose');
    assert.equal(selectFromGit({ root, base, cohortUnchanged: true }).kind, 'none');
    assert.equal(selectFromGit({ root, base, cohortUnchanged: false }).kind, 'full');
    writeFileSync(join(root, 'unknown-local.txt'), 'uncommitted\n');
    assert.equal(selectFromGit({ root, base, cohortUnchanged: true }).kind, 'full');
    rmSync(join(root, 'unknown-local.txt'));
    git('mv', 'README.md', 'unknown.md'); git('commit', '-am', 'rename');
    assert.equal(selectFromGit({ root, base, cohortUnchanged: true }).kind, 'full');
    assert.equal(selectFromGit({ root, base: 'missing-ref', cohortUnchanged: true }).kind, 'full');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
