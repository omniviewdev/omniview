// Which negative controls a change must run (scripts/ci/probe-select.mjs): the glob matcher, the context (a pull request is selected, everything else is a full run), the selection, and the selection
// replayed on the file lists of real merged pull requests (probe-select.prs.json: `gh pr view <n> --json files`, 2026-11-21 and 22).
//
// The rule it must keep is the one of scripts/ci/changes.test.mjs: whatever the selection cannot classify runs EVERYTHING. Every "NEGATIVE" test below feeds it a change that must not be allowed to skip a
// control, and each was seen to go red with the rule it names taken out (docs/ui-next/status/N25.md). No installed dependency is needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadUnits, REPO_ROOT } from './probe-shards.mjs';
import { SHARED_HARNESS, contextOf, globToRegExp, matches, selectControls } from './probe-select.mjs';

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Globs
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('a glob is read as written: a literal path, `*` inside one segment, `?` for one character, `**` for any number of segments, `{a,b}` for either', () => {
  assert.equal(matches('ui-next/shell/Shell.tsx', 'ui-next/shell/Shell.tsx'), true);
  assert.equal(matches('ui-next/shell/Shell.tsx', 'ui-next/shell/Shell.tsx.bak'), false, 'a glob is the whole path, not a prefix');
  assert.equal(matches('ui-next/shell/Shell.tsx', 'x/ui-next/shell/Shell.tsx'), false, 'and not a suffix');
  assert.equal(matches('ui-next/shell/Shell.*', 'ui-next/shell/Shell.tsx'), true);
  assert.equal(matches('ui-next/shell/Shell.*', 'ui-next/shell/Shell.module.css'), true);
  assert.equal(matches('ui-next/shell/*.tsx', 'ui-next/shell/notices/Bell.tsx'), false, '`*` does not cross a slash');
  assert.equal(matches('ui-next/shell/*.tsx', 'ui-next/shell/Rail.tsx'), true);
  assert.equal(matches('ui-next/shell/Tree.?sx', 'ui-next/shell/Tree.tsx'), true);
  assert.equal(matches('ui-next/shell/Tree.?sx', 'ui-next/shell/Tree.sx'), false);
  assert.equal(matches('ui-next/shell/Tree.?sx', 'ui-next/shell/Tree./sx'), false, '`?` does not match a slash');
  assert.equal(matches('ui-next/shell/*.{ts,tsx}', 'ui-next/shell/index.ts'), true);
  assert.equal(matches('ui-next/shell/*.{ts,tsx}', 'ui-next/shell/Shell.tsx'), true);
  assert.equal(matches('ui-next/shell/*.{ts,tsx}', 'ui-next/shell/Shell.css'), false);
  assert.equal(matches('packages/kit/src/components/{Field,Select}/**', 'packages/kit/src/components/Select/Select.tsx'), true);
  assert.equal(matches('packages/kit/src/components/{Field,Select}/**', 'packages/kit/src/components/Toggle/Toggle.tsx'), false);
});

test('`dir/**` is everything below dir at any depth and not dir itself; `**/name` and `a/**/b` allow no directory at all', () => {
  assert.equal(matches('ui-next/shell/notices/**', 'ui-next/shell/notices/Bell.tsx'), true);
  assert.equal(matches('ui-next/shell/notices/**', 'ui-next/shell/notices/deep/er/x.ts'), true);
  assert.equal(matches('ui-next/shell/notices/**', 'ui-next/shell/notices'), false);
  assert.equal(matches('ui-next/shell/notices/**', 'ui-next/shell/notices-extra/x.ts'), false, 'a sibling with the same prefix is not below it');
  assert.equal(matches('ui-next/shell/notices/**', 'x/ui-next/shell/notices/Bell.tsx'), false);
  assert.equal(matches('**/package.json', 'package.json'), true);
  assert.equal(matches('**/package.json', 'packages/kit/package.json'), true);
  assert.equal(matches('**/package.json', 'packages/kit/package.json5'), false);
  assert.equal(matches('**/*.test.ts', 'a.test.ts'), true);
  assert.equal(matches('**/*.test.ts', 'a/b/c.test.ts'), true);
  assert.equal(matches('a/**/b', 'a/b'), true);
  assert.equal(matches('a/**/b', 'a/x/y/b'), true);
  assert.equal(matches('a/**/b', 'a/xb'), false);
});

test('NEGATIVE: a glob that cannot be read is an error, not a pattern that matches nothing (a typo would silently skip a control)', () => {
  for (const bad of ['', '/abs/path', './a', 'a/../b', '..', 'a\\b', 'a/[bc]', 'a/**b', 'a**/b', 'a/{b,c', 'a/b}', 'a/{b,{c,d}}', 'a//b', 'a/', 12, null, undefined]) {
    assert.throws(() => globToRegExp(bad), /glob/, `${JSON.stringify(bad)}`);
  }
  assert.equal(matches('a/(b)+$', 'a/(b)+$'), true, 'parentheses, plus and dollar are literal');
  assert.equal(matches('Ui-next/**', 'ui-next/x'), false, 'case-sensitive');
});

test('the glob matcher agrees with the runtime\'s own (path.matchesGlob) on every glob of the corpus, where the runtime has one', { skip: typeof path.matchesGlob !== 'function' }, () => {
  const globs = ['ui-next/shell/*.tsx', 'ui-next/shell/Shell.*', 'ui-next/shell/notices/**', '**/package.json', '**/*.test.ts', 'a/**/b', 'packages/kit/src/components/{Field,Select}/**', 'ui-next/shell/Tree.?sx', 'scripts/ci/**'];
  const paths = [
    'ui-next/shell/Shell.tsx',
    'ui-next/shell/Shell.module.css',
    'ui-next/shell/notices/Bell.tsx',
    'ui-next/shell/notices/a/b/c.ts',
    'ui-next/shell/Tree.tsx',
    'ui-next/shell/Tree.sx',
    'package.json',
    'packages/kit/package.json',
    'packages/kit/package.json5',
    'a.test.ts',
    'a/b/c.test.ts',
    'a/b',
    'a/x/y/b',
    'a/xb',
    'packages/kit/src/components/Field/Field.tsx',
    'packages/kit/src/components/Select/Select.tsx',
    'packages/kit/src/components/Toggle/Toggle.tsx',
    'scripts/ci/probe-shards.mjs',
    'scripts/ci',
    'scripts/cix/y',
  ];
  for (const glob of globs) for (const file of paths) assert.equal(matches(glob, file), path.matchesGlob(file, glob), `${glob} against ${file}`);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The context
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

test('only a pull request that runs for the first time is selected by what it changes; a push, the nightly run, a dispatch, a merge queue, a re-run and anything unreadable are a full run', () => {
  assert.equal(contextOf({ event: 'pull_request', attempt: '1' }).mode, 'by-change');
  assert.equal(contextOf({ event: 'pull_request', attempt: 1 }).mode, 'by-change');
  for (const [event, words] of [['push', /push to main/], ['schedule', /nightly/], ['workflow_dispatch', /dispatch/], ['merge_group', /merge queue/]]) {
    const context = contextOf({ event, attempt: '1' });
    assert.equal(context.mode, 'full', event);
    assert.match(context.reason, words, event);
  }
});

test('NEGATIVE: a re-run of a pull request, an unreadable attempt, an event nobody named and no event at all are a full run, and the reason says which', () => {
  assert.match(contextOf({ event: 'pull_request', attempt: '2' }).reason, /re-run \(attempt 2\)/);
  assert.equal(contextOf({ event: 'pull_request', attempt: '2' }).mode, 'full');
  for (const attempt of ['', undefined, 'x', '0', '-1', '1.5']) {
    const context = contextOf({ event: 'pull_request', attempt });
    assert.equal(context.mode, 'full', JSON.stringify(attempt));
    assert.match(context.reason, /attempt/, JSON.stringify(attempt));
  }
  for (const event of ['pull_request_target', 'repository_dispatch', 'release', '', undefined]) {
    const context = contextOf({ event, attempt: '1' });
    assert.equal(context.mode, 'full', JSON.stringify(event));
    assert.match(context.reason, /not a pull request/, JSON.stringify(event));
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The selection, on a small table
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const unit = (id, extra = {}) => ({ id, name: `Unit ${id}`, script: `ui-next/shell/probes/${id}-probe.mjs`, seconds: 10, paths: [`ui-next/shell/probes/${id}-*`], file: `scripts/ci/probe-units/${id}.mjs`, ...extra });
const UNITS = [
  unit('a'),
  unit('a-controls', { controls: ['x', 'y'], seconds: 100, paths: ['ui-next/shell/notices/**', 'ui-next/shell/probes/a-*'] }),
  unit('b'),
  unit('b-controls', { controls: ['z'], seconds: 50, paths: ['packages/kit/src/components/Field/**', 'ui-next/shell/probes/b-*'] }),
  unit('c-controls', { controls: ['w'], seconds: 30, paths: ['ui-next/page/**'], file: 'scripts/ci/probe-units/c.mjs' }),
];
const PR = { mode: 'by-change', reason: 'a pull request' };
const FULL = { mode: 'full', reason: 'a push to main' };
const select = (changed, context = PR, units = UNITS) => selectControls({ units, changed, context });
const ran = (selection) => selection.units.filter((entry) => entry.run).map((entry) => entry.id);

test('every probe runs whatever is selected; a control unit runs when a changed path matches one of its globs, and the others are skipped with the reason', () => {
  const selection = select(['ui-next/shell/notices/Centre.tsx']);
  assert.deepEqual(ran(selection), ['a', 'a-controls', 'b']);
  const skipped = selection.units.find((entry) => entry.id === 'b-controls');
  assert.equal(skipped.run, false);
  assert.match(skipped.why, /no changed path matches/);
  assert.match(selection.units.find((entry) => entry.id === 'a-controls').why, /ui-next\/shell\/notices\/Centre\.tsx matches ui-next\/shell\/notices\/\*\*/);
  assert.match(selection.units.find((entry) => entry.id === 'a').why, /probe always runs/);
  assert.equal(selection.everything, false);
  assert.equal(selection.mode, 'by-change');
});

test('the declaration file of a unit is one of its globs without being declared: a change to it selects the controls it declares, and no others', () => {
  assert.deepEqual(ran(select(['scripts/ci/probe-units/a-controls.mjs'])), ['a', 'a-controls', 'b']);
  assert.deepEqual(ran(select(['scripts/ci/probe-units/c.mjs'])), ['a', 'b', 'c-controls']);
  assert.deepEqual(ran(select(['scripts/ci/probe-units/gone.mjs'])), ['a', 'b'], 'a declaration nobody loads selects nothing, and is listed as declared by no unit');
  assert.deepEqual(select(['scripts/ci/probe-units/gone.mjs']).undeclared, ['scripts/ci/probe-units/gone.mjs']);
});

test('a change that matches several units selects each of them; the seconds the skipped controls would have taken are counted', () => {
  const selection = select(['ui-next/shell/notices/Centre.tsx', 'packages/kit/src/components/Field/Field.tsx']);
  assert.deepEqual(ran(selection), ['a', 'a-controls', 'b', 'b-controls']);
  assert.equal(selection.skippedSeconds, 30);
  assert.equal(select(['ui-next/shell/notices/Centre.tsx']).skippedSeconds, 80);
  assert.equal(select(['docs/ui-next/TRACKER.md']).skippedSeconds, 180);
});

test('the same paths in any order, and a path listed twice, select the same controls', () => {
  const paths = ['ui-next/page/ListPage.tsx', 'ui-next/shell/notices/Centre.tsx', 'packages/kit/src/components/Field/Field.tsx'];
  const first = ran(select(paths));
  assert.deepEqual(ran(select([...paths].reverse())), first);
  assert.deepEqual(ran(select([...paths, ...paths])), first);
  assert.deepEqual(first, ['a', 'a-controls', 'b', 'b-controls', 'c-controls']);
});

test('a full run runs every control, whatever the paths, and says why', () => {
  const selection = select(['docs/ui-next/TRACKER.md'], FULL);
  assert.deepEqual(ran(selection), UNITS.map((entry) => entry.id));
  assert.equal(selection.everything, true);
  assert.equal(selection.mode, 'full');
  assert.match(selection.reason, /push to main/);
  assert.match(selection.units.find((entry) => entry.id === 'a-controls').why, /full run: a push to main/);
  assert.equal(selection.skippedSeconds, 0);
});

test('NEGATIVE: paths nobody can read, or none at all, are a full run (a pull request whose diff cannot be read must not skip a control)', () => {
  for (const changed of [null, undefined, []]) {
    const selection = select(changed);
    assert.equal(selection.everything, true, JSON.stringify(changed));
    assert.deepEqual(ran(selection), UNITS.map((entry) => entry.id));
    assert.match(selection.reason, /could not be read|no changed path/, JSON.stringify(changed));
  }
});

// What every control must be run for. The first group is the lead's list (the shared harness, scripts/ci, the kit's tokens and CSS, the package manifests and the lockfile, the probe workflow);
// the second is what these controls cannot be proven not to depend on (a path outside the new UI and documentation, whose class the selection does not know).
const EVERYTHING = [
  ...SHARED_HARNESS,
  'packages/kit/probes/probe-lib.mjs',
  'packages/kit/probes/serve.mjs',
  'ui-next/shell/probes/harness.mjs',
  'ui-next/shell/probes/build-fixture.mjs',
  'scripts/ci/probe-shards.mjs',
  'scripts/ci/probe-shards.test.mjs',
  'scripts/ci/probe-select.mjs',
  'scripts/ci/changes.mjs',
  'scripts/ci/probe-pack.mjs',
  '.github/workflows/ui-next-kit-probes.yml',
  '.github/ci/Dockerfile',
  '.github/ci/image.lock',
  'package.json',
  'packages/kit/package.json',
  'packages/omniviewdev-runtime/package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  '.tool-versions',
  'packages/kit/tokens/manifest.ts',
  'packages/kit/tokens/themes.ts',
  'packages/kit/src/generated/tokens.css',
  'packages/kit/src/generated/tokenNames.ts',
  'packages/kit/src/styles/layers.css',
  'packages/kit/src/styles/base.css',
  'packages/kit/src/styles/fonts.css',
  'packages/kit/src/theme/ThemeProvider.tsx',
  'packages/kit/fonts/Inter-Regular.latin.woff2',
  'packages/kit/src/components/Text/Text.tsx',
  'packages/kit/src/components/Stack/Stack.module.css',
  'packages/kit/src/shared/command.module.css',
  'packages/kit/vite.config.ts',
  'packages/kit/scripts/check-dist.ts',
  'vite.config.ts',
  'tsconfig.app.json',
  'Taskfile.yml',
  'index.html',
  'packages/omniviewdev-runtime/src/logs.ts',
  'backend/pkg/plugin/manager.go',
  'ui/main.tsx',
  '.github/workflows/pr.yml',
  'a-directory-nobody-has-seen/and-a-file.xyz',
];

// A path that is also of a class the selection does not know (the lockfile, a workflow, the CI image are "other") is named by its own rule first: the reason a reviewer reads says what it is.
const REASON_WORDS = [
  [/^pnpm-lock\.yaml$/, /lockfile/],
  [/^\.github\/workflows\/ui-next-kit-probes\.yml$/, /probe workflow/],
  [/^\.github\/ci\//, /CI image/],
  [/^scripts\/ci\//, /CI scripts/],
  [/^pnpm-workspace\.yaml$/, /workspace file/],
  [/^\.npmrc$/, /package manager/],
  [/^\.tool-versions$/, /toolchain/],
];

test('NEGATIVE: the shared harness, scripts/ci, the probe workflow and the image, the manifests and the lockfile, the kit\'s tokens, CSS and primitives, and any path outside the new UI and its documentation run every control, alone or among others', () => {
  for (const file of EVERYTHING) {
    for (const others of [[], ['ui-next/shell/notices/Centre.tsx'], ['docs/ui-next/TRACKER.md', 'ui-next/page/ListPage.tsx']]) {
      const selection = select([...others, file]);
      assert.equal(selection.everything, true, file);
      assert.deepEqual(ran(selection), UNITS.map((entry) => entry.id), file);
      assert.ok(selection.forced.some((entry) => entry.path === file), `${file} is named as one of the paths that forced it`);
      const named = REASON_WORDS.find(([pattern]) => pattern.test(file));
      if (named !== undefined) assert.match(selection.forced.find((entry) => entry.path === file).why, named[1], `${file}: the reason is the one of its rule, not of the class it also is in`);
      assert.match(selection.units.find((entry) => entry.id === 'c-controls').why, new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), file);
    }
  }
});

test('the paths a probe never reads select nothing: documentation, Markdown anywhere, the tests of vitest, the API reports, and a path of the new UI that no unit declares (listed, so a reviewer sees it)', () => {
  const documentation = ['docs/ui-next/TRACKER.md', 'docs/ui-next/decisions.md', 'README.md', 'ui-next/shell/README.md', 'packages/kit/api/kit.api.md'];
  const tests = ['ui-next/shell/notices/Centre.test.tsx', 'packages/kit/src/log/time.test.ts', 'ui-next/plugins/host/PluginHost.sort.test.tsx', 'scripts/ui-next-pods/x.test.mjs'];
  const selection = select([...documentation, ...tests]);
  assert.equal(selection.everything, false);
  assert.deepEqual(ran(selection), ['a', 'b'], 'the probes only');
  assert.deepEqual([...selection.ignored].sort(), [...documentation, ...tests].sort());
  const undeclared = select(['ui-next/plugins/e2e/seam.check.mjs', 'ui-next/connections/List.tsx']);
  assert.deepEqual(ran(undeclared), ['a', 'b']);
  assert.deepEqual(undeclared.undeclared, ['ui-next/plugins/e2e/seam.check.mjs', 'ui-next/connections/List.tsx']);
});

test('NEGATIVE: a test file or a Markdown file inside what every control depends on still runs every control (the order of the rules: what forces everything first)', () => {
  for (const file of ['scripts/ci/probe-shards.test.mjs', 'packages/kit/tokens/render.test.ts', 'packages/kit/src/theme/ThemeProvider.test.tsx', 'packages/kit/src/styles/README.md', 'pnpm-lock.yaml']) {
    assert.equal(select([file]).everything, true, file);
  }
});

test('NEGATIVE: a path that is not plain (a newline, a control character, a backslash, a dot segment, an absolute path, an empty name) is not classified and runs every control, and no reason holds the raw character', () => {
  for (const file of ['ui-next/shell/notices/a\nb.tsx', 'ui-next/shell/notices/a\u0007.tsx', 'ui-next\\shell\\notices\\Centre.tsx', 'ui-next/../packages/kit/x.ts', '/ui-next/shell/notices/Centre.tsx', 'ui-next//shell/x.ts', '', 'ui-next/shell/notices/']) {
    const selection = select([file]);
    assert.equal(selection.everything, true, JSON.stringify(file));
    for (const entry of selection.units) assert.doesNotMatch(entry.why, /[\u0000-\u001f\u007f]/, `${JSON.stringify(file)}: no raw control character in a reason`);
    assert.match(selection.forced[0].why, /not plain/, `${JSON.stringify(file)}: said to be not plain, before any rule reads it`);
  }
  const hostile = select(['ui-next/shell/notices/x\n::error::forged.tsx']);
  for (const entry of hostile.units) assert.equal(entry.why.includes('\n'), false, 'a reason is one line');
  for (const entry of hostile.forced) assert.equal(entry.path.includes('\n'), false, 'and so is the path it names');
});

test('the reason of the first path that forced everything is the one a control gives, with how many others did', () => {
  const selection = select(['vite.config.ts', 'package.json', 'ui-next/shell/notices/Centre.tsx']);
  const why = selection.units.find((entry) => entry.id === 'b-controls').why;
  assert.match(why, /^vite\.config\.ts .*and 1 more path/);
  assert.equal(selection.forced.length, 2);
});

test('a unit with no globs, or one whose glob cannot be read, is an error of the table, never a control that is silently never selected', () => {
  assert.throws(() => select(['ui-next/shell/notices/Centre.tsx'], PR, [unit('d', { controls: ['q'], paths: undefined })]), /"d".*paths/);
  assert.throws(() => select(['ui-next/shell/notices/Centre.tsx'], PR, [unit('d', { controls: ['q'], paths: [] })]), /"d".*paths/);
  assert.throws(() => select(['ui-next/shell/notices/Centre.tsx'], PR, [unit('d', { controls: ['q'], paths: ['ui-next/[a]/x'] })]), /"d".*glob/);
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The selection on real pull requests
//
// The file lists are `gh pr view <n> --json files` of merged pull requests of 2026-11-21 and 22. Every pull request that added or changed a probe also edited the one shard table, scripts/ci/probe-shards.mjs, and a
// few the workflow's matrix line: with the table a directory, the same change edits the unit file of its probe (NEW_LAYOUT) and no matrix. Both are replayed: the lists as merged (the table edit alone made every control
// run), and the lists as the same change is made now.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url));
const PRS = JSON.parse(readFileSync(path.join(here, 'probe-select.prs.json'), 'utf8'));
const { units: REAL_UNITS, problems: LOAD_PROBLEMS } = await loadUnits(REPO_ROOT);

/** The unit file the pull request would edit now, where it edited the one table. */
const NEW_LAYOUT = { 645: 'form', 647: 'notices', 650: 'logs-open', 651: 'tour', 648: 'page', 637: 'logs', 629: 'palette-plugins' };
/** What the one table was edited with: the table, its test, and the workflow's matrix line. */
const OLD_TABLE = ['scripts/ci/probe-shards.mjs', 'scripts/ci/probe-shards.test.mjs', '.github/workflows/ui-next-kit-probes.yml'];
const asMerged = (entry) => entry.files;
const asMadeNow = (entry) => (NEW_LAYOUT[entry.number] === undefined ? entry.files : [...entry.files.filter((file) => !OLD_TABLE.includes(file)), `scripts/ci/probe-units/${NEW_LAYOUT[entry.number]}.mjs`]);
const pr = (number) => PRS.find((entry) => entry.number === number);
const real = (changed) => selectControls({ units: REAL_UNITS, changed, context: PR });
const controlsRun = (selection) => selection.units.filter((entry) => entry.controls && entry.run).map((entry) => entry.id).sort();

test('the file lists of the real pull requests are the ones `gh pr view --json files` gave: the ten of the brief, a docs-only one and the pull requests that touch CI, and the real table loads', () => {
  assert.deepEqual(LOAD_PROBLEMS, []);
  assert.deepEqual(PRS.map((entry) => entry.number), [645, 647, 650, 651, 653, 648, 637, 643, 629, 641, 627, 616, 652]);
  for (const entry of PRS) {
    assert.ok(Array.isArray(entry.files) && entry.files.length > 0, `#${entry.number} has files`);
    assert.ok(entry.files.every((file) => typeof file === 'string' && file !== ''), `#${entry.number}`);
    assert.equal(new Set(entry.files).size, entry.files.length, `#${entry.number} lists no path twice`);
  }
  assert.equal(REAL_UNITS.filter((entry) => entry.controls !== undefined).length, 15);
});

test('as merged, a pull request that edited the one shard table runs every control, whatever else it changed: scripts/ci runs them all (this is what the table as a directory removes)', () => {
  for (const number of [645, 650, 648, 637, 629]) {
    const selection = real(asMerged(pr(number)));
    assert.equal(selection.everything, true, `#${number}`);
    assert.ok(selection.forced.some((entry) => entry.path === 'scripts/ci/probe-shards.mjs'), `#${number}: the table is the path that forced it`);
    assert.equal(selection.skippedSeconds, 0, `#${number}`);
  }
});

// The controls each pull request must run now, and the seconds of controls it skips. The proof that the control guarding the code a pull request changed is selected is each line's first group: the control of the probe that
// opens what the pull request changed.
const EXPECTED = {
  // The form parts: Field, FormControl, TextInput, NumberInput, Toggle, Select, SecretInput, the glyph list of Icon (which no control of another probe lists) and the form probe: the form's controls, and no others.
  645: { run: ['form-controls'], saved: 1628 },
  // The Logs strip's rate at open: the kit's log model, and the new probe and its unit: the log view's controls, the rate probe's control and the Logs probe's, which draw the same strip; none of the others.
  650: { run: ['log-controls', 'logs-controls-feed', 'logs-controls-toolbar', 'logs-open-controls'], saved: 1149 },
  // The list page sorts: the page, the plugin host and the contract the fixture plugin follows, and a page-probe that has no controls: the controls that open the plugin host, not the toast layer, the palette or the form.
  648: { run: ['logs-controls-feed', 'logs-controls-toolbar', 'palette-plugins-controls', 'panel-controls-held', 'panel-controls-twins', 'tour-controls'], saved: 882 },
  // The Logs toolbar: LogView, IconButton, RovingGroup, the Logs session body and the host fixture it runs on: the Logs and log view controls, the panel's, the row menu's (IconButton), and the strip's and tour's, which open the host fixture.
  637: { run: ['log-controls', 'logs-controls-feed', 'logs-controls-toolbar', 'logs-open-controls', 'panel-controls-frame', 'panel-controls-held', 'panel-controls-twins', 'row-menu-controls', 'strip-controls', 'tour-controls'], saved: 617 },
  // A palette row says a connection by its name: the plugin host's palette and the fixture plugin, the plugin palette probe's fixture and the palette probe.
  629: { run: ['logs-controls-feed', 'logs-controls-toolbar', 'palette-controls', 'palette-plugins-controls', 'panel-controls-held', 'panel-controls-twins', 'tour-controls'], saved: 798 },
};

test('in the layout of now, each pull request runs the controls of the probes whose code it changed, and the seconds of the others are not spent', () => {
  for (const [number, expected] of Object.entries(EXPECTED)) {
    const selection = real(asMadeNow(pr(Number(number))));
    assert.equal(selection.everything, false, `#${number}`);
    assert.deepEqual(controlsRun(selection), expected.run, `#${number}`);
    assert.equal(selection.skippedSeconds, expected.saved, `#${number}`);
  }
});

test('#645 (form parts) selects the control that guards the form probe and none of the other fourteen; #650 (the rate at open) selects the controls of the probes that draw the strip it changed, and not the toast layer\'s', () => {
  const form = real(asMadeNow(pr(645)));
  assert.deepEqual(controlsRun(form), ['form-controls']);
  assert.match(form.units.find((entry) => entry.id === 'form-controls').why, /^changed: (?:packages\/kit\/src\/components\/\w+\/|packages\/kit\/probes\/|scripts\/ci\/probe-units\/)/, 'a path of the parts it changed, its probe or its unit');
  const rate = real(asMadeNow(pr(650)));
  assert.ok(controlsRun(rate).includes('logs-open-controls'));
  assert.match(rate.units.find((entry) => entry.id === 'log-controls').why, /^changed: packages\/kit\/src\/log\/\w+\.ts matches packages\/kit\/src\/log\/\*\*/, 'the log model it changed is what the log view controls guard');
  assert.match(rate.units.find((entry) => entry.id === 'notices-controls-toast').why, /^no changed path matches/);
});

test('#637 (the Logs toolbar) selects the control units of the Logs probe that guard the toolbar it changed, and its reason names the toolbar', () => {
  const toolbar = real(asMadeNow(pr(637)));
  const why = toolbar.units.find((entry) => entry.id === 'logs-controls-toolbar').why;
  assert.match(why, /^changed: /);
  assert.match(why, /ui-next\/shell\/panel\/|packages\/kit\/src\/components\/|ui-next\/shell\/probes\//);
});

test('#647 (the notification centre) edited CI files and so ran every control; the same change without them selects the toast layer\'s two control units, because it changed the notices, and not the form, the log view or the row menu', () => {
  assert.equal(real(asMerged(pr(647))).everything, true);
  const ci = pr(647).files.filter((file) => file.startsWith('.github/') || file.startsWith('scripts/ci/'));
  assert.ok(ci.length >= 3, ci.join(', '));
  const feature = [...pr(647).files.filter((file) => !file.startsWith('.github/') && !file.startsWith('scripts/ci/')), 'scripts/ci/probe-units/notices.mjs'];
  const selection = real(feature);
  assert.equal(selection.everything, false);
  assert.deepEqual(controlsRun(selection).filter((id) => id.startsWith('notices-')), ['notices-controls-centre', 'notices-controls-toast']);
  assert.match(selection.units.find((entry) => entry.id === 'notices-controls-centre').why, /^changed: ui-next\/shell\/\S+ matches \S+ and \d+ more paths?$/, 'the first path that reached it and how many more');
  for (const id of ['form-controls', 'log-controls', 'logs-open-controls', 'palette-controls', 'row-menu-controls', 'strip-controls']) assert.equal(controlsRun(selection).includes(id), false, id);
});

test('#651 (the tour fixes) changed the shell probes\' shared harness, and so ran every control, with that path named as the reason; so did the pull requests that touch the CI itself (#627, #616)', () => {
  const tour = real(asMadeNow(pr(651)));
  assert.equal(tour.everything, true);
  assert.ok(tour.forced.some((entry) => entry.path === 'ui-next/shell/probes/harness.mjs' && /shared harness/.test(entry.why)));
  assert.match(tour.units.find((entry) => entry.id === 'tour-controls').why, /^ui-next\/shell\/probes\/harness\.mjs \(the shared harness of the probes\)/);
  for (const number of [627, 616]) {
    const selection = real(asMerged(pr(number)));
    assert.equal(selection.everything, true, `#${number}`);
    assert.ok(selection.forced.some((entry) => /^scripts\/ci\/|^\.github\/workflows\/ui-next-kit-probes/.test(entry.path)), `#${number}`);
  }
});

test('#653 (a tab\'s page state) and #643 (the rail\'s order) select the controls of the tab model, the sessions and the plugin host they changed, and not the toast layer, the form, the palette or the log view', () => {
  const history = controlsRun(real(asMerged(pr(653))));
  assert.deepEqual(history, ['logs-controls-feed', 'palette-plugins-controls', 'panel-controls-held', 'tour-controls']);
  const rail = controlsRun(real(asMerged(pr(643))));
  assert.deepEqual(rail, ['logs-controls-feed', 'logs-controls-toolbar', 'palette-plugins-controls', 'panel-controls-frame', 'panel-controls-held', 'panel-controls-twins', 'tour-controls']);
  for (const list of [history, rail]) for (const id of ['form-controls', 'notices-controls-toast', 'notices-controls-centre', 'log-controls', 'palette-controls']) assert.equal(list.includes(id), false, id);
});

test('a documentation-only pull request (#641) runs the probes and no control at all, and the pull request that only touches the Pods check (#652) is a CI change that runs them all', () => {
  const docs = real(asMerged(pr(641)));
  assert.equal(docs.everything, false);
  assert.deepEqual(controlsRun(docs), []);
  assert.equal(docs.skippedSeconds, 1664);
  assert.equal(real(asMerged(pr(652))).everything, true, 'its workflow is outside the new UI: the selection does not know that class');
});

test('the seconds a pull request saves are the seconds of the control units it skips: the table\'s 1,664 s of controls less the ones it runs', () => {
  const total = REAL_UNITS.filter((entry) => entry.controls !== undefined).reduce((sum, entry) => sum + entry.seconds, 0);
  assert.equal(total, 1664);
  for (const [number, expected] of Object.entries(EXPECTED)) {
    const ran = controlsRun(real(asMadeNow(pr(Number(number)))));
    const spent = REAL_UNITS.filter((entry) => ran.includes(entry.id)).reduce((sum, entry) => sum + entry.seconds, 0);
    assert.equal(total - spent, expected.saved, `#${number}`);
  }
});
