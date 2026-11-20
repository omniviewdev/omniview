import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { groups, parseNameStatus, selectChanges, selectFromGit } from './select-tests.mjs';

const change = path => ({ status: 'M', paths: [path] });
const selected = changes => selectChanges({ changes, complete: true });
const roadmapProse = [
  'docs/roadmap/2026-10-17-product-roadmap.md',
  'docs/roadmap/2026-10-17-resource-intelligence-baseline.md',
  'docs/roadmap/2026-10-17-resource-intelligence-contract-readiness.md',
  'docs/roadmap/2026-10-17-resource-intelligence-work-packages.md',
  'docs/roadmap/2026-10-23-resource-intelligence-remote-index.md',
  'docs/roadmap/2026-10-25-global-command-search-acceptance.md',
];
test('full is default and explicit full overrides even prose', () => {
  assert.equal(selectChanges().kind, 'full');
  assert.equal(selectChanges({ full: true, changes: [change('README.md')] }).kind, 'full');
  assert.equal(selectChanges({ complete: true, changes: [change('README.md')] }).kind, 'none');
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
test('core, unknown, fixture and dependency paths always force full', () => {
  for (const path of ['internal/devworkspace/watch.go', 'unclassified.txt', 'e2e/tests/fixtures/browser-errors.spec.ts', 'packages/omniviewdev-runtime/src/index.ts', 'go.mod', 'go.sum', 'package.json', 'pnpm-lock.yaml', 'ui/main.tsx']) {
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
test('only listed prose skips; empty, malformed and truncated data fail closed', () => {
  assert.equal(selected([change('README.md')]).kind, 'none');
  for (const path of ['docs/new.mdx', 'docs/guide.mdx', 'README.md/script.js', '../README.md', '/README.md']) assert.equal(selected([change(path)]).kind, 'full', path);
  for (const changes of [[], null, [{ status: 'R100', paths: ['README.md'] }], [{ status: 'Z', paths: ['README.md'] }]]) assert.equal(selected(changes).kind, 'full');
  assert.equal(selectChanges({ changes: [change('README.md')], complete: false }).kind, 'full');
  for (const data of ['M\0README.md', 'R100\0README.md\0', 'M\0README.md\0garbage\0']) assert.throws(() => parseNameStatus(data));
});
test('approved roadmap Markdown stays prose, with all conservative guards retained', () => {
  for (const path of roadmapProse) {
    for (const status of ['A', 'M', 'D']) assert.equal(selected([{ status, paths: [path] }]).kind, 'none', `${status} ${path}`);
    for (const unknown of ['docs/roadmap/new.mdx', 'docs/roadmap/2026-10-17-resource-intelligence-baseline.mdx', 'docs/roadmap/other/nested.md.js', 'internal/devworkspace/watch.go', 'go.mod']) {
      assert.equal(selected([change(path), change(unknown)]).kind, 'full', unknown);
      for (const paths of [[path, unknown], [unknown, path]]) assert.equal(selected([{ status: 'R100', paths }]).kind, 'full');
    }
    assert.equal(selectChanges({ changes: [change(path)], complete: false }).kind, 'full');
    assert.equal(selectChanges({ full: true, changes: [change(path)], complete: true }).kind, 'full');
  }
  assert.equal(selected(roadmapProse.map(change)).kind, 'none');
  assert.deepEqual(selected([...roadmapProse.map(change), change('e2e/tests/settings/settings.spec.ts')]).groups, ['layout', 'settings', 'workspaces']);
});

// N24-E1: docs-only pull requests (7 of the last 40) ran the whole suite because the prose list was nine exact names. The rule is now a class:
// Markdown under docs/ and the `.txt` copies of the proof tools under docs/ui-next/status/. Nothing in the repository reads either at build or test
// time (searched: no Go, vitest, node:test, Playwright or workflow step opens a docs/**/*.md or a status .txt; the vocabulary guard scans ui-next/
// and packages/kit only). Everything else, including every other file type under docs/, stays full.
const docsProse = [
  'docs/new.md',
  'docs/ui-next/TRACKER.md',
  'docs/ui-next/AGENTS.md',
  'docs/ui-next/status/N24-ci-speed.md',
  'docs/ui-next/baseline/2026-11-19-log.md',
  'docs/roadmap/other/nested.md',
  'docs/superpowers/specs/2026-03-20-wails3-migration-design.md',
  'docs/ui-next/status/K2a/k2a-proof.mjs.txt',
  'docs/ui-next/status/E0-1/evidence-before.txt',
  'docs/ui-next/status/E0-1/evidence-test.go.txt',
  'docs/ui-next/status/summary.txt',
];
// Not prose. Each is named for what would break if it were skipped.
const notProse = [
  'docs/new.mdx', // another extension: only .md is prose
  'docs/guide.markdown',
  'docs/UPPER.MD', // the match is case-sensitive: an unusual spelling is not told about
  'docs/.md', // no stem
  'docs/x.md/script.js', // a directory called x.md
  'docs/x.md.js',
  'docs/ui-next/slices/1a-pods-list/fixture.yaml', // applied by the Pods workflow and bench/table/corpus/corpus.sh
  'docs/ui-next/baseline/run.sh', // an executable recipe
  'docs/ui-next/baseline/collect.mjs',
  'docs/ui-next/baseline/raw/pass1/render.json', // recorded numbers: json, not prose
  'docs/ui-next/baseline/raw/1a3b/m1-chromium-w0.trials.jsonl.gz',
  'docs/ui-next/status/1a.2/scale.yaml',
  'docs/ui-next/status/1a.2/raw/results-N25.json',
  'docs/ui-next/status/L2/shot.png',
  'docs/superpowers/specs/2026-10-17-cel-numeric-evidence.zip', // unzipped by bench/resourcequeryspike/retained-driver.mjs
  'docs/dev-cli-sdk-verify-evidence-20261031.json',
  'docs/evidence/visual-sizing/review.html',
  'docs/notes.txt', // .txt is prose only under docs/ui-next/status/
  'docs/ui-next/baseline/notes.txt',
  'docs/ui-next/notes.txt',
  'docs/ui-next/status.txt',
  'docs/ui-next/statuses/x.txt',
  'docs/ui-next/status/x.txt.exe',
];
// Markdown that is NOT under docs/. Several are inputs of a build or a test, the rest are simply not told about.
const markdownOutsideDocs = [
  'CLAUDE.md', // read by the agents tooling
  'AGENTS.md',
  'CONTRIBUTING.md',
  'unknown.md',
  'packages/kit/api/kit.api.md', // the API report: `api-extractor` compares it to src/index.ts, CI fails when they differ
  'packages/kit/api/kit-examples.api.md',
  '.changeset/native-exec.md', // read by the changesets release tooling
  '.agents/skills/omniview-repo-map/SKILL.md', // read by .agents/skills/install.mjs and its tests
  '.agents/skills/omniview-repo-map/references/source-map.md',
  'backend/pkg/resourcecatalog/testdata/kubernetes/README.md', // a testdata directory
  'bench/table/README.md',
  'ui-next/shell/README.md', // scanned by the vocabulary guard (packages/kit/eslint/vocabulary.mjs reads every .md of ui-next/ and packages/kit/)
  'packages/kit/README.md',
  'e2e/README.md',
  'ui/docs/guide.md', // a directory called docs that is not the root one
  'packages/docs/guide.md',
  'docsx/guide.md',
  'doc/guide.md',
  'documentation/docs/guide.md',
  'docs.md',
];
const codeAndDependencyPaths = [
  'go.mod',
  'go.sum',
  'package.json',
  'pnpm-lock.yaml',
  'vite.config.ts',
  'internal/devworkspace/watch.go',
  'ui/main.tsx',
  'ui-next/App.tsx',
  'packages/kit/api/kit.api.md',
  '.github/workflows/pr.yml',
  'docs/new.mdx',
];
test('Markdown under docs/ and the status .txt copies are prose, in every status', () => {
  for (const path of docsProse) {
    for (const status of ['A', 'M', 'D']) assert.equal(selected([{ status, paths: [path] }]).kind, 'none', `${status} ${path}`);
    assert.deepEqual(selected([change(path)]).groups, [], path);
    assert.deepEqual(selected([change(path)]).specs, [], path);
    assert.equal(selectChanges({ changes: [change(path)], complete: false }).kind, 'full', `incomplete data ${path}`);
    assert.equal(selectChanges({ full: true, changes: [change(path)], complete: true }).kind, 'full', `explicit full ${path}`);
  }
  assert.equal(selected(docsProse.map(change)).kind, 'none');
  for (const from of docsProse) for (const to of docsProse.slice(0, 3)) assert.equal(selected([{ status: 'R100', paths: [from, to] }]).kind, 'none', `${from} -> ${to}`);
});
test('NEGATIVE: every other file type under docs/, and a docs/-lookalike, stays full', () => {
  for (const path of notProse) {
    for (const status of ['A', 'M', 'D']) assert.equal(selected([{ status, paths: [path] }]).kind, 'full', `${status} ${path}`);
    for (const prose of docsProse.slice(0, 3)) {
      assert.equal(selected([change(prose), change(path)]).kind, 'full', `${prose} + ${path}`);
      for (const paths of [[prose, path], [path, prose]]) assert.equal(selected([{ status: 'R100', paths }]).kind, 'full', paths.join(' -> '));
    }
  }
});
test('NEGATIVE: Markdown outside docs/ stays full (README.md alone is the one root prose file)', () => {
  assert.equal(selected([change('README.md')]).kind, 'none');
  for (const path of markdownOutsideDocs) {
    for (const status of ['A', 'M', 'D']) assert.equal(selected([{ status, paths: [path] }]).kind, 'full', `${status} ${path}`);
    assert.equal(selected([change('docs/new.md'), change(path)]).kind, 'full', path);
    for (const paths of [['docs/new.md', path], [path, 'docs/new.md']]) assert.equal(selected([{ status: 'R100', paths }]).kind, 'full', paths.join(' -> '));
  }
});
test('NEGATIVE: a pull request that mixes one docs file and one code or dependency file is full, in either order', () => {
  for (const path of codeAndDependencyPaths) {
    assert.equal(selected([change('docs/new.md'), change(path)]).kind, 'full', path);
    assert.equal(selected([change(path), change('docs/new.md')]).kind, 'full', path);
    assert.equal(selected([change('docs/ui-next/status/K2a/k2a-proof.mjs.txt'), change(path)]).kind, 'full', path);
  }
  // A group-selecting path next to docs selects that group and is never `none`.
  const result = selected([change('docs/new.md'), change('e2e/tests/settings/settings.spec.ts')]);
  assert.equal(result.kind, 'selected');
  assert.deepEqual(result.groups, ['layout', 'settings', 'workspaces']);
});
test('NEGATIVE: paths that could climb out of docs/ or hide a segment never reach the prose rule', () => {
  for (const path of ['docs/../go.mod', 'docs/a/../b.md', 'docs/./new.md', 'docs//new.md', 'docs/ui-next/status/../../../go.mod', 'docs\\new.md', '/docs/new.md', 'docs/new.md/', 'docs/', 'docs']) {
    assert.equal(selected([change(path)]).kind, 'full', path);
  }
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
    assert.equal(selectFromGit({ root, base }).kind, 'none');
    assert.equal(selectFromGit({ root, base: 'missing-ref' }).kind, 'full');
    writeFileSync(join(root, roadmapProse[0]), 'uncommitted approved prose\n');
    assert.equal(selectFromGit({ root, base }).kind, 'full');
    git('add', '.');
    assert.equal(selectFromGit({ root, base }).kind, 'full');
    git('commit', '-m', 'committed prose');
    assert.equal(selectFromGit({ root, base }).kind, 'none');
    const beforeDelete = git('rev-parse', 'HEAD');
    git('rm', roadmapProse[0]); git('commit', '-m', 'deleted approved prose');
    assert.equal(selectFromGit({ root, base: beforeDelete }).kind, 'none');
    const beforeRename = git('rev-parse', 'HEAD');
    git('mv', roadmapProse[1], 'docs/roadmap/unclassified.mdx');
    git('commit', '-am', 'rename outside allowlist');
    assert.equal(selectFromGit({ root, base: beforeRename }).kind, 'full');
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
    assert.equal(selectFromGit({ root, base }).kind, 'none');
    writeFileSync(join(root, 'unknown-local.txt'), 'uncommitted\n');
    assert.equal(selectFromGit({ root, base }).kind, 'full');
    rmSync(join(root, 'unknown-local.txt'));
    git('mv', 'README.md', 'unknown.md'); git('commit', '-am', 'rename');
    assert.equal(selectFromGit({ root, base }).kind, 'full');
    assert.equal(selectFromGit({ root, base: 'missing-ref' }).kind, 'full');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('actual Git diff of a docs-only branch is none; the same branch plus one code file, or one .mdx, is full', () => {
  const root = mkdtempSync(join(tmpdir(), 'omniview-docs-selector-'));
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=Selector', '-c', 'user.email=selector@example.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${devNull}`, ...args], { encoding: 'utf8' }).trim();
  const write = (path, text) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text); };
  try {
    git('init', '--initial-branch=main');
    write('go.mod', 'module example\n'); write('docs/ui-next/status/old.md', 'old\n');
    git('add', '.'); git('commit', '-m', 'base');
    const base = git('rev-parse', 'HEAD');
    write('docs/ui-next/status/N24.md', 'status\n'); write('docs/ui-next/status/K2a/proof.mjs.txt', 'copy\n'); write('docs/ui-next/TRACKER.md', 'tracker\n');
    git('add', '.'); git('commit', '-m', 'docs only');
    const docsOnly = git('rev-parse', 'HEAD');
    assert.equal(selectFromGit({ root, base }).kind, 'none');
    write('docs/ui-next/status/N24b.mdx', 'mdx\n');
    git('add', '.'); git('commit', '-m', 'docs plus mdx');
    assert.equal(selectFromGit({ root, base }).kind, 'full');
    git('reset', '--hard', docsOnly);
    write('go.mod', 'module example2\n');
    git('commit', '-am', 'docs plus go.mod');
    assert.equal(selectFromGit({ root, base }).kind, 'full');
    git('reset', '--hard', docsOnly);
    git('mv', 'docs/ui-next/status/old.md', 'old.md'); git('commit', '-am', 'docs md moved out of docs');
    assert.equal(selectFromGit({ root, base }).kind, 'full');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
