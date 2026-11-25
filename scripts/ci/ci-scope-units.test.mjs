// Which units a pull request's diff changes (scripts/ci/ci-scope-units.mjs, N33), with forged diffs: what is attributed to a unit, and that everything shared, unknown or unreadable is refused (the run is then full).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { main, scopeOf } from './ci-scope.mjs';
import { MANIFEST, LAYOUT, MAX_DEPENDENTS, attribute, closureOf, referencedBy } from './ci-scope-units.mjs';
import { loadUnits } from './probe-shards.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const P = 'ui-next/shell/probes';
const U = 'scripts/ci/probe-units';

// A small table in the shape of the real one: `a` and `b` stand alone, `wrap` runs `a` (the wrapper of terminal-data), `c` and `d` share a helper, `a` has a fixture only it reads, and `old.mjs` is read by nobody.
const UNITS = [
  { id: 'a', file: `${U}/a.mjs`, script: `${P}/a-probe.mjs` },
  { id: 'a-controls', file: `${U}/a.mjs`, script: `${P}/a-probe.mjs`, controls: ['x'] },
  { id: 'b', file: `${U}/b.mjs`, script: `${P}/b-probe.mjs` },
  { id: 'b-controls', file: `${U}/b.mjs`, script: `${P}/b-probe.mjs`, controls: ['y'] },
  { id: 'wrap', file: `${U}/wrap.mjs`, script: `${P}/wrap-probe.mjs` },
  { id: 'c', file: `${U}/cd.mjs`, script: `${P}/c-probe.mjs` },
  { id: 'd', file: `${U}/cd.mjs`, script: `${P}/d-probe.mjs` },
  { id: 'e', file: `${U}/e.mjs`, script: `${P}/e-probe.mjs` },
];
const TREE = {
  [`${P}/a-probe.mjs`]: "import { fixture } from './a-lib.mjs';\nconst page = './a-fixture.tsx';\n",
  [`${P}/a-lib.mjs`]: "export const fixture = './a-fixture.tsx';\n",
  [`${P}/a-fixture.tsx`]: 'export const a = 1;\n',
  [`${P}/b-probe.mjs`]: "const page = './b-fixture.tsx';\n",
  [`${P}/b-fixture.tsx`]: 'export const b = 1;\n',
  [`${P}/wrap-probe.mjs`]: "await import('./a-probe.mjs');\n",
  [`${P}/c-probe.mjs`]: "import './shared.mjs';\n",
  [`${P}/d-probe.mjs`]: "import './shared.mjs';\n",
  [`${P}/e-probe.mjs`]: "import './shared.mjs';\nimport './e-only.mjs';\nconst computed = `./${'e'}-hidden.tsx`;\n",
  [`${P}/e-only.mjs`]: 'export const e = 1;\n',
  [`${P}/shared.mjs`]: 'export const shared = 1;\n',
  [`${P}/old.mjs`]: 'export const old = 1;\n',
  'packages/kit/probes/harness.mjs': 'export const harness = 1;\n',
  [`${U}/a.mjs`]: "export const units = [{ id: 'a' }];\n",
  [`${U}/b.mjs`]: "export const units = [{ id: 'b' }];\n",
  [`${U}/wrap.mjs`]: "export const units = [{ id: 'wrap' }];\n",
  [`${U}/cd.mjs`]: "export const units = [{ id: 'c' }];\n",
  [`${U}/e.mjs`]: "export const units = [{ id: 'e' }];\n",
  [MANIFEST]: JSON.stringify({ [`${P}/a-probe.mjs`]: { probe: true, controls: ['x'] }, [`${P}/b-probe.mjs`]: { probe: true, controls: ['y'] } }),
  [LAYOUT]: JSON.stringify({ note: 'n', oldLayoutSeconds: { a: 10, b: 20 }, sharedLayoutRuns: { r: 1 } }),
};

/** The attribution of a forged diff: `edit` is what the head has (a text, or null for a deleted file) and `base` what the base has (default: the tree). */
const run = (files, { head = {}, base = {}, units = UNITS } = {}) => {
  const tree = (overrides) => (file) => (Object.hasOwn(overrides, file) ? overrides[file] : Object.hasOwn(TREE, file) ? TREE[file] : null);
  return attribute({ files, units, readHead: tree(head), readBase: tree(base) });
};
const ids = (result) => (result.ok ? result.units : `refused: ${result.reason}`);

// -- 1. What is attributed ---------------------------------------------------------------------------------------------------------------------------------------------------

const ATTRIBUTED = [
  ['a unit file: its units', [`${U}/a.mjs`], { head: { [`${U}/a.mjs`]: "export const units = [{ id: 'a' }, { id: 'new' }];\n" } }, ['a', 'a-controls']],
  ['another unit file: only its own', [`${U}/b.mjs`], { head: { [`${U}/b.mjs`]: "export const units = [];\n" } }, ['b', 'b-controls']],
  ['two unit files', [`${U}/a.mjs`, `${U}/b.mjs`], {}, ['a', 'a-controls', 'b', 'b-controls']],
  ['a unit file shared by two probes: both of its units', [`${U}/cd.mjs`], {}, ['c', 'd']],
  ['a unit file that was removed has no unit left to run', [`${U}/a.mjs`], { head: { [`${U}/a.mjs`]: null } }, []],
  ['a unit file that was added', [`${U}/new.mjs`], { head: { [`${U}/new.mjs`]: "export const units = [{ id: 'n' }];\n" } }, []],
  ['a probe script: the units that run it (the probe and its controls) and the wrapper that runs it', [`${P}/a-probe.mjs`], {}, ['a', 'a-controls', 'wrap']],
  ['a probe script nothing wraps', [`${P}/b-probe.mjs`], {}, ['b', 'b-controls']],
  ['a probe script that no other reads and a unit file', [`${P}/b-probe.mjs`, `${U}/b.mjs`], {}, ['b', 'b-controls']],
  ['a fixture only one probe reads', [`${P}/b-fixture.tsx`], {}, ['b', 'b-controls']],
  ['a file only one probe reads (the e probe imports e-only)', [`${P}/e-only.mjs`], {}, ['e']],
  ['a file that was added, which no probe reads yet', [`${P}/brand-new.mjs`], { head: { [`${P}/brand-new.mjs`]: 'export {};\n' } }, []],
  ['a new probe: its script, its fixture, its unit file and the manifest entry', [`${P}/n-probe.mjs`, `${P}/n-fixture.tsx`, `${U}/n.mjs`, MANIFEST], {
    head: {
      [`${P}/n-probe.mjs`]: "const page = './n-fixture.tsx';\n",
      [`${P}/n-fixture.tsx`]: 'export {};\n',
      [`${U}/n.mjs`]: "export const units = [{ id: 'n' }];\n",
      [MANIFEST]: JSON.stringify({ ...JSON.parse(TREE[MANIFEST]), [`${P}/n-probe.mjs`]: { probe: true, controls: [] } }),
    },
    units: [...UNITS, { id: 'n', file: `${U}/n.mjs`, script: `${P}/n-probe.mjs` }],
  }, ['n']],
  ['a manifest entry that changed: the units that run that probe', [MANIFEST], { head: { [MANIFEST]: JSON.stringify({ ...JSON.parse(TREE[MANIFEST]), [`${P}/b-probe.mjs`]: { probe: true, controls: ['y', 'z'] } }) } }, ['b', 'b-controls']],
  ['a manifest entry that was removed', [MANIFEST], { head: { [MANIFEST]: JSON.stringify({ [`${P}/a-probe.mjs`]: { probe: true, controls: ['x'] } }) } }, ['b', 'b-controls']],
  ['a manifest with nothing changed', [MANIFEST], {}, []],
  ['the layout record: a unit\'s seconds', [LAYOUT], { head: { [LAYOUT]: JSON.stringify({ note: 'n', oldLayoutSeconds: { a: 11, b: 20 }, sharedLayoutRuns: { r: 1 } }) } }, ['a']],
  ['the layout record: its note', [LAYOUT], { head: { [LAYOUT]: JSON.stringify({ note: 'other', oldLayoutSeconds: { a: 10, b: 20 }, sharedLayoutRuns: { r: 1 } }) } }, []],
  ['the layout record: two units\' seconds', [LAYOUT], { head: { [LAYOUT]: JSON.stringify({ note: 'n', oldLayoutSeconds: { a: 11, b: 21 }, sharedLayoutRuns: { r: 1 } }) } }, ['a', 'b']],
];

for (const [name, files, extra, want] of ATTRIBUTED) {
  test(`attributed: ${name}`, () => {
    const result = run(files, extra);
    assert.equal(result.ok, true, ids(result));
    assert.deepEqual(result.units, want);
  });
}

test('the libraries of a probe and of the wrapper that runs it: a-lib is read by a (directly) and by wrap (through a): two scripts, which is a shared file', () => {
  const result = run([`${P}/a-lib.mjs`]);
  assert.equal(result.ok, false);
  assert.match(result.reason, /2 probe scripts read/);
});

// -- 2. What is refused ------------------------------------------------------------------------------------------------------------------------------------------------------

const REFUSED = [
  ['a helper two probes import', [`${P}/shared.mjs`], {}, /shared helper/],
  ['the helper of a harness in the kit', ['packages/kit/probes/harness.mjs'], {}, /no probe reads/],
  ['a file of a probes directory that no probe reads and that existed', [`${P}/old.mjs`], {}, /no probe reads/],
  ['a file of a probes directory that was deleted', [`${P}/b-fixture.tsx`], { head: { [`${P}/b-fixture.tsx`]: null } }, /was deleted/],
  ['a probe script that was deleted', [`${P}/b-probe.mjs`], { head: { [`${P}/b-probe.mjs`]: null } }, /was deleted/],
  ['a unit file that imports a helper', [`${U}/a.mjs`], { head: { [`${U}/a.mjs`]: "import { x } from '../ci-scope.mjs';\nexport const units = [];\n" } }, /imports/],
  ['a unit file that re-exports', [`${U}/a.mjs`], { head: { [`${U}/a.mjs`]: "export * from './b.mjs';\n" } }, /imports/],
  ['a unit file that requires', [`${U}/a.mjs`], { head: { [`${U}/a.mjs`]: "const x = require('x');\n" } }, /imports/],
  ['a unit file that imports dynamically', [`${U}/a.mjs`], { head: { [`${U}/a.mjs`]: "const x = await import('./b.mjs');\n" } }, /imports/],
  ['a unit file with an import in the middle', [`${U}/a.mjs`], { head: { [`${U}/a.mjs`]: "export const units = [];\n  import x from 'y';\n" } }, /imports/],
  ['a nested path in the units directory', [`${U}/deep/a.mjs`], {}, /not a unit/],
  ['a unit directory file that is not .mjs', [`${U}/a.json`], {}, /not a unit/],
  ['the engine', ['scripts/ci/probe-shards.mjs'], {}, /not a unit/],
  ['the scope code', ['scripts/ci/ci-scope.mjs'], {}, /not a unit/],
  ['the units module', ['scripts/ci/ci-scope-units.mjs'], {}, /not a unit/],
  ['a workflow', ['.github/workflows/ui-next-kit-probes.yml'], {}, /not a unit/],
  ['a manifest that does not parse in the head', [MANIFEST], { head: { [MANIFEST]: '{' } }, /does not read/],
  ['a manifest that does not parse in the base', [MANIFEST], { base: { [MANIFEST]: '[' } }, /does not read/],
  ['a manifest that is a list', [MANIFEST], { head: { [MANIFEST]: '[]' } }, /does not read/],
  ['a manifest that is a number', [MANIFEST], { head: { [MANIFEST]: '3' } }, /does not read/],
  ['a manifest that is null', [MANIFEST], { head: { [MANIFEST]: 'null' } }, /does not read/],
  ['a layout that does not parse', [LAYOUT], { head: { [LAYOUT]: 'nope' } }, /does not read/],
  ['a layout whose shared runs changed', [LAYOUT], { head: { [LAYOUT]: JSON.stringify({ note: 'n', oldLayoutSeconds: { a: 10, b: 20 }, sharedLayoutRuns: { r: 2 } }) } }, /sharedLayoutRuns/],
  ['a layout with a new key', [LAYOUT], { head: { [LAYOUT]: JSON.stringify({ note: 'n', oldLayoutSeconds: { a: 10, b: 20 }, sharedLayoutRuns: { r: 1 }, extra: 1 }) } }, /extra/],
  ['a layout whose seconds name no unit', [LAYOUT], { head: { [LAYOUT]: JSON.stringify({ note: 'n', oldLayoutSeconds: { a: 10, b: 20, ghost: 5 }, sharedLayoutRuns: { r: 1 } }) } }, /no unit of the table/],
  ['a layout whose seconds are a number', [LAYOUT], { head: { [LAYOUT]: JSON.stringify({ note: 'n', oldLayoutSeconds: 5, sharedLayoutRuns: { r: 1 } }) } }, /not an object/],
  ['a layout that was deleted', [LAYOUT], { head: { [LAYOUT]: null } }, /does not read|no unit|not an object|sharedLayoutRuns|oldLayoutSeconds/],
  ['a good file and a bad one in one diff: the bad one decides', [`${U}/a.mjs`, 'scripts/ci/probe-shards.mjs'], {}, /not a unit/],
  ['a bad file first and a good one after', ['scripts/ci/probe-shards.mjs', `${U}/a.mjs`], {}, /not a unit/],
  ['a shared helper among per-unit files', [`${U}/a.mjs`, `${P}/shared.mjs`, `${U}/b.mjs`], {}, /shared helper/],
  ['a probe script that so many others read that it is a shared file', [`${P}/hub-probe.mjs`], {
    head: Object.fromEntries([[`${P}/hub-probe.mjs`, 'export {};\n'], ...['p1', 'p2', 'p3', 'p4'].map((name) => [`${P}/${name}-probe.mjs`, "import './hub-probe.mjs';\n"])]),
    units: [...UNITS, { id: 'hub', file: `${U}/hub.mjs`, script: `${P}/hub-probe.mjs` }, ...['p1', 'p2', 'p3', 'p4'].map((name) => ({ id: name, file: `${U}/${name}.mjs`, script: `${P}/${name}-probe.mjs` }))],
  }, /shared file/],
];

for (const [name, files, extra, reason] of REFUSED) {
  test(`refused: ${name}`, () => {
    const result = run(files, extra);
    assert.equal(result.ok, false, `it was attributed: ${JSON.stringify(result)}`);
    assert.match(result.reason, reason);
    assert.equal(typeof result.file, 'string');
  });
}

test('MAX_DEPENDENTS is two: a script a wrapper and one more run is attributed, three others is a shared file', () => {
  assert.equal(MAX_DEPENDENTS, 2);
  const hubFiles = (count) => Object.fromEntries([[`${P}/hub-probe.mjs`, 'export {};\n'], ...Array.from({ length: count }, (_, index) => [`${P}/q${index}-probe.mjs`, "import './hub-probe.mjs';\n"])]);
  const units = (count) => [...UNITS, { id: 'hub', file: `${U}/hub.mjs`, script: `${P}/hub-probe.mjs` }, ...Array.from({ length: count }, (_, index) => ({ id: `q${index}`, file: `${U}/q${index}.mjs`, script: `${P}/q${index}-probe.mjs` }))];
  assert.equal(run([`${P}/hub-probe.mjs`], { head: hubFiles(2), units: units(2) }).ok, true);
  assert.equal(run([`${P}/hub-probe.mjs`], { head: hubFiles(3), units: units(3) }).ok, false);
});

test('a file that a probe reaches by a computed name is found by the file\'s name in the text (it is over-included, never missed)', () => {
  const head = { [`${P}/e-probe.mjs`]: "const name = 'e-hidden';\nawait import(`./${name}-hidden.tsx`);\nconst other = 'e-only.mjs';\n", [`${P}/e-hidden.tsx`]: 'export {};\n' };
  // The computed name is not found, and the file existed before: nobody is known to read it, so the run is full.
  assert.equal(run([`${P}/e-hidden.tsx`], { head, base: { [`${P}/e-hidden.tsx`]: 'export {};\n' } }).ok, false);
  // The name written out in any file of the probe's reach is.
  const named = { ...head, [`${P}/e-probe.mjs`]: "const file = 'e-hidden.tsx';\n" };
  const found = run([`${P}/e-hidden.tsx`], { head: named });
  assert.deepEqual(found.units, ['e']);
});

test('the reach of a probe follows paths written in its files and stops at a file that is not in a probes directory', () => {
  const exists = (file) => Object.hasOwn(TREE, file) || file === 'ui-next/shell/product.tsx';
  const reached = referencedBy(`${P}/a-probe.mjs`, TREE[`${P}/a-probe.mjs`], exists);
  assert.deepEqual([...reached].sort(), [`${P}/a-fixture.tsx`, `${P}/a-lib.mjs`]);
  const product = referencedBy(`${P}/a-probe.mjs`, "import x from '../product.tsx';\n", exists);
  assert.equal(product.size, 0, 'a product file is not in a probes directory');
  assert.equal(referencedBy(`${P}/a-probe.mjs`, "import x from '../../../../../etc/passwd.json';\n", exists).size, 0);
  const closure = closureOf(`${P}/wrap-probe.mjs`, { read: (file) => TREE[file] ?? null, exists });
  assert.deepEqual([...closure.keys()].sort(), [`${P}/a-fixture.tsx`, `${P}/a-lib.mjs`, `${P}/a-probe.mjs`, `${P}/wrap-probe.mjs`]);
  const cycle = { x: "import './y.mjs';", y: "import './x.mjs';" };
  assert.equal(closureOf(`${P}/x.mjs`, { read: (file) => cycle[path.posix.basename(file, '.mjs')] ?? null, exists: (file) => /[xy]\.mjs$/.test(file) }).size, 2, 'a cycle ends');
});

// -- 3. The scope that comes of it -------------------------------------------------------------------------------------------------------------------------------------------

const scoped = (files, extra = {}) => scopeOf({ event: 'pull_request', files, target: 'probes', attribute: (list) => run(list, extra), ...extra.scope });

test('a pull request that changes the product and one unit file is a pull request scope with the full treatment of that unit only', () => {
  const result = scoped(['ui-next/shell/Thing.tsx', `${U}/b.mjs`]);
  assert.equal(result.scope, 'pr');
  assert.deepEqual(result.units, ['b', 'b-controls']);
  assert.match(result.reason, /1 per-unit file change 2 units \(b, b-controls\), which run with every control in both engines/);
  assert.deepEqual(result.why.map((entry) => entry.file), [`${U}/b.mjs`]);
});

test('a pull request whose files are not test infrastructure at all is a pull request scope with no unit treated', () => {
  const result = scoped(['ui-next/shell/Thing.tsx']);
  assert.deepEqual([result.scope, result.units], ['pr', []]);
});

test('one shared file makes the run full, whatever else is per-unit, and the reason says which and why', () => {
  const result = scoped([`${U}/b.mjs`, 'scripts/ci/probe-shards.mjs']);
  assert.equal(result.scope, 'full');
  assert.match(result.reason, /^scripts\/ci\/probe-shards\.mjs changes the CI scripts .*: a file that is not a unit/);
  const helper = scoped([`${U}/b.mjs`, `${P}/shared.mjs`]);
  assert.equal(helper.scope, 'full');
  assert.match(helper.reason, /shared\.mjs changes a probe, its control or its harness: a file 3 probe scripts read/);
});

test('a name with a newline cannot write a line of the reason', () => {
  const result = scoped([`${U}/b.mjs`, 'scripts/ci/x\n::error::forged']);
  assert.equal(result.scope, 'full');
  assert.equal(result.reason.includes('\n'), false);
});

test('without the attribution (the seam, or no table) the same diff is full, as before N33', () => {
  assert.equal(scopeOf({ event: 'pull_request', files: [`${U}/b.mjs`], target: 'seam' }).scope, 'pr', 'the seam never reads a unit file');
  assert.equal(scopeOf({ event: 'pull_request', files: [`${U}/b.mjs`] }).scope, 'full', 'no target: the old rule');
  assert.equal(scopeOf({ event: 'pull_request', files: [`${U}/b.mjs`], target: 'probes' }).scope, 'full', 'no attribution function: the old rule');
});

test('the files only the other workflow reads do not count: the probes ignore the seam\'s files and the seam ignores the probes\'', () => {
  for (const file of ['scripts/ci/seam-units.mjs', 'scripts/ci/seam-shards.mjs', 'scripts/ci/main-red.mjs', 'ui-next/plugins/e2e/seam.check.mjs', 'ui-next/shell/e2e/x.ts']) {
    assert.equal(scopeOf({ event: 'pull_request', files: [file], target: 'probes' }).scope, 'pr', `probes: ${file}`);
    assert.equal(scopeOf({ event: 'pull_request', files: [file], target: 'seam' }).scope, 'full', `seam: ${file}`);
  }
  for (const file of [`${U}/a.mjs`, MANIFEST, LAYOUT, 'ui-next/shell/probes/x-probe.mjs', 'packages/kit/probes/probe-lib.mjs', 'ui-next/page/probes/x.tsx']) {
    assert.equal(scopeOf({ event: 'pull_request', files: [file], target: 'seam' }).scope, 'pr', `seam: ${file}`);
    assert.equal(scopeOf({ event: 'pull_request', files: [file], target: 'probes' }).scope, 'full', `probes without attribution: ${file}`);
  }
  // Shared by both: the plan code of one that the other imports, the scope code, the workflows, the fixture plugins, the dependencies.
  for (const file of ['scripts/ci/probe-shards.mjs', 'scripts/ci/probe-pack.mjs', 'scripts/ci/ci-scope.mjs', 'scripts/ci/ci-scope-units.mjs', '.github/workflows/ui-next-seam.yml', 'ui-next/plugins/fixture/a.go', 'pnpm-lock.yaml', 'Taskfile.yml']) {
    assert.equal(scopeOf({ event: 'pull_request', files: [file], target: 'seam' }).scope, 'full', `seam: ${file}`);
    assert.equal(scopeOf({ event: 'pull_request', files: [file], target: 'probes' }).scope, 'full', `probes: ${file}`);
  }
});

test('a manual run can name the units that get the full treatment; nothing named is the pull request scope as before', () => {
  assert.deepEqual(scopeOf({ event: 'workflow_dispatch', input: 'pr', unitsInput: 'a, b-controls,,' }).units, ['a', 'b-controls']);
  assert.deepEqual(scopeOf({ event: 'workflow_dispatch', input: 'pr' }).units, []);
  assert.deepEqual(scopeOf({ event: 'workflow_dispatch', input: 'full', unitsInput: 'a' }), { scope: 'full', reason: 'a manual run' });
  for (const event of ['push', 'schedule']) assert.equal(scopeOf({ event, unitsInput: 'a' }).scope, 'full');
});

// -- 4. The whole thing, through git and the real table ---------------------------------------------------------------------------------------------------------------------

test('on the real table every per-unit file attributes to exactly its own units, and no unit file imports anything', async () => {
  const loaded = await loadUnits(repo);
  assert.deepEqual(loaded.problems, []);
  const read = (file) => (existsSync(path.join(repo, file)) ? readFileSync(path.join(repo, file), 'utf8') : null);
  const names = readdirSync(path.join(repo, U)).filter((name) => name.endsWith('.mjs'));
  assert.ok(names.length >= 20);
  for (const name of names) {
    const file = `${U}/${name}`;
    const result = attribute({ files: [file], units: loaded.units, readHead: read, readBase: read });
    assert.equal(result.ok, true, `${file}: ${result.reason}`);
    assert.deepEqual(result.units, loaded.units.filter((unit) => unit.file === file).map((unit) => unit.id).sort(), file);
  }
});

test('on the real table a probe script is attributed to the units that run it, and the shared harness of the kit is refused', async () => {
  const loaded = await loadUnits(repo);
  const read = (file) => (existsSync(path.join(repo, file)) ? readFileSync(path.join(repo, file), 'utf8') : null);
  const tour = attribute({ files: ['ui-next/shell/probes/tour-probe.mjs'], units: loaded.units, readHead: read, readBase: read });
  assert.equal(tour.ok, true);
  assert.deepEqual(tour.units, loaded.units.filter((unit) => unit.script === 'ui-next/shell/probes/tour-probe.mjs').map((unit) => unit.id).sort());
  for (const file of ['packages/kit/probes/probe-lib.mjs', 'packages/kit/probes/build-cache.mjs', 'ui-next/shell/probes/harness.mjs', 'ui-next/shell/probes/lib.mjs']) {
    assert.equal(attribute({ files: [file], units: loaded.units, readHead: read, readBase: read }).ok, false, file);
  }
});

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

test('through git: a pull request checked out as a merge commit that adds a probe and edits another unit is a pull request scope with those units; one that touches the engine too is full', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci-scope-units-'));
  git(dir, 'init', '-q', '-b', 'main');
  const put = (file, text) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  };
  for (const [file, text] of Object.entries(TREE)) put(file, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'switch', '-q', '-c', 'pr');
  put(`${P}/b-fixture.tsx`, 'export const b = 2;\n');
  put(`${P}/z-probe.mjs`, "const page = './z-fixture.tsx';\n");
  put(`${P}/z-fixture.tsx`, 'export {};\n');
  put(`${U}/z.mjs`, "export const units = [{ id: 'z' }];\n");
  put('ui-next/shell/Thing.tsx', 'export {};\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'pr');
  git(dir, 'switch', '-q', 'main');
  git(dir, 'merge', '-q', '--no-ff', '--no-edit', 'pr');
  const table = [...UNITS, { id: 'z', file: `${U}/z.mjs`, script: `${P}/z-probe.mjs` }];
  let out = '';
  const output = path.join(dir, '.out');
  const summary = path.join(dir, '.summary');
  const result = await main(['--for', 'probes'], { env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }, out: (text) => { out += text; }, root: dir, units: table });
  assert.equal(result, 0);
  const written = readFileSync(output, 'utf8');
  assert.match(written, /^scope=pr\n/);
  assert.match(written, /\nfull_units=b,b-controls,z\n$/, 'the fixture of b, the new probe z: its units, from the head table');
  const text = readFileSync(summary, 'utf8');
  assert.match(text, /Full treatment \(every negative control, both engines\) on this pull request:\*\* `b`, `b-controls`, `z`/);
  assert.match(text, /ui-next\/shell\/probes\/b-fixture\.tsx: a file that one probe script reads/);
  assert.match(text, /scripts\/ci\/probe-units\/z\.mjs: a unit file: its units \(z\)/);
  // The seam reads the same diff and sees only the product (a probe's files are not its own): pull request scope, no unit.
  const seam = await main(['--for', 'seam'], { env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: path.join(dir, '.seam') }, out: () => {}, root: dir, units: table });
  assert.equal(seam, 0);
  assert.equal(readFileSync(path.join(dir, '.seam'), 'utf8').split('\n')[0], 'scope=pr');
  // A second pull request that also touches the engine is full.
  git(dir, 'switch', '-q', '-c', 'pr2', 'main~1');
  put(`${P}/b-fixture.tsx`, 'export const b = 3;\n');
  put('scripts/ci/probe-shards.mjs', 'export {};\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'pr2');
  git(dir, 'switch', '-q', 'main');
  git(dir, 'merge', '-q', '--no-ff', '--no-edit', '-X', 'theirs', 'pr2');
  await main(['--for', 'probes'], { env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_OUTPUT: path.join(dir, '.out2') }, out: () => {}, root: dir, units: table });
  assert.match(readFileSync(path.join(dir, '.out2'), 'utf8'), /^scope=full\nreason=scripts\/ci\/probe-shards\.mjs changes the CI scripts/);
});
