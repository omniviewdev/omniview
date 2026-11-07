import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync as spawnProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkFiles, changedFiles } from './check.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'ui-audit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'ui'));
  return { root, put: async (file, content) => {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  } };
}
const rules = findings => findings.map(finding => finding.rule);
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
const spawnSync = (command, args, options = {}) => spawnProcess(command, args, {
  env: { ...process.env, GITHUB_BASE_REF: '' },
  ...options,
});

test('flags native JSX controls, but preserves semantic markup and domain colors', async t => {
  const { root, put } = await fixture(t);
  await put('ui/View.tsx', 'const view = <section><label>Name</label><div style={{color:"#123456",width:17}}/><input/><select/><textarea/><button/></section>;');
  assert.deepEqual(rules(await checkFiles(root, ['ui/View.tsx'])), Array(4).fill('native-control'));
});

test('resolves React aliases, namespace imports, and destructuring; respects shadowing', async t => {
  const { root, put } = await fixture(t);
  await put('ui/View.tsx', `import R, {createElement as make} from 'react';
import * as ReactNS from 'react';
const alias = make;
const {createElement: destructured} = R;
const first = make('input');
const second = R.createElement('button');
const third = ReactNS.createElement('select');
const fourth = alias('textarea');
const fifth = destructured('button');
function custom(make: Function, R: any) { make('input'); R.createElement('button'); }
const fake = {createElement() {}};
fake.createElement('input');`);
  assert.equal((await checkFiles(root, ['ui/View.tsx'])).length, 5);
});

test('detects native datetime behind bound library wrappers, not lookalike components', async t => {
  const { root, put } = await fixture(t);
  await put('ui/View.tsx', `import {Input as Field} from '@omniviewdev/base-ui';
import {createElement as h} from 'react';
const a = <Field.Control type="datetime-local"/>;
const b = h(Field.Control, {type:'datetime-local'});
const Input = {Control: () => null};
const c = <Input.Control type="datetime-local"/>;
const d = <input type={'datetime-local'}/>;`);
  assert.deepEqual(rules(await checkFiles(root, ['ui/View.tsx'])), ['native-datetime', 'native-datetime', 'native-control', 'native-datetime']);
});

test('rejects legacy imports, reexports, dynamic imports, and requires', async t => {
  const { root, put } = await fixture(t);
  await put('ui/legacy.ts', `import Box from '@mui/material/Box';
export { css } from '@emotion/react';
const old = import('@omniviewdev/ui');
const styled = require('@material-ui/core');
import {Button} from '@omniviewdev/base-ui';`);
  assert.deepEqual(rules(await checkFiles(root, ['ui/legacy.ts'])), Array(4).fill('legacy-ui-import'));
});

test('flags explicit control resets without banning structural resets or numeric CSS', async t => {
  const { root, put } = await fixture(t);
  await put('ui/view.css', 'button { all: unset; } .IconButton { all: unset; } .layout { all: unset; color: #abcdef; width: 17px; }');
  await put('ui/View.tsx', 'const a = <button style={{all:"unset"}}/>; const b = <div style={{all:"unset"}}/>;');
  assert.deepEqual(rules(await checkFiles(root, ['ui/view.css'])), ['control-reset', 'control-reset']);
  assert.deepEqual(rules(await checkFiles(root, ['ui/View.tsx'])), ['control-reset', 'native-control'].sort());
});

test('excludes tests, stories, generated files, and library implementation directories', async t => {
  const { root, put } = await fixture(t);
  const files = ['ui/View.test.tsx', 'ui/View.stories.tsx', 'ui/generated/View.tsx', 'packages/base-ui/src/Button.tsx'];
  for (const file of files) await put(file, 'const x = <button/>;');
  assert.deepEqual(await checkFiles(root, files), []);
});

test('baseline permits debt and line movement, but counts newly duplicated violations and untracked files', async t => {
  const { root, put } = await fixture(t);
  git(root, 'init');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture');
  await put('ui/View.tsx', 'const a = <button/>;');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'baseline');
  await put('ui/View.tsx', '\n\nconst a = <button/>;');
  assert.deepEqual(await checkFiles(root, ['ui/View.tsx']), []);
  await put('ui/View.tsx', '\nconst a = <button/>; const b = <button/>;');
  assert.equal((await checkFiles(root, ['ui/View.tsx'])).length, 1);
  await put('ui/New.tsx', 'const a = <input/>;');
  assert.equal((await checkFiles(root, ['ui/New.tsx'])).length, 1);
});

test('source and CSS parse errors fail closed', async t => {
  const { root, put } = await fixture(t);
  await put('ui/View.tsx', 'const a = <button');
  await put('ui/view.css', 'button {');
  const findings = await checkFiles(root, ['ui/View.tsx', 'ui/view.css']);
  assert.deepEqual([...new Set(findings.filter(finding => finding.rule === 'parse-error').map(finding => finding.file))].sort(),
    ['ui/View.tsx', 'ui/view.css']);
});

test('rejects traversal, missing files, and untracked symlink escapes', async t => {
  const { root, put } = await fixture(t);
  await assert.rejects(checkFiles(root, ['../escape.tsx']), /escapes root/);
  await assert.rejects(checkFiles(root, ['ui/missing.tsx']));
  const outside = await mkdtemp(path.join(tmpdir(), 'ui-audit-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'View.tsx'), 'const a = <button/>;');
  await symlink(path.join(outside, 'View.tsx'), path.join(root, 'ui', 'Link.tsx'));
  await assert.rejects(checkFiles(root, ['ui/Link.tsx']), /symlink escapes root/);
});

test('CLI prints actionable findings and returns failure; clean structural UI passes', async t => {
  const { root, put } = await fixture(t);
  const cli = fileURLToPath(new URL('./check.mjs', import.meta.url));
  await put('ui/View.tsx', 'const a = <button/>;');
  const bad = spawnSync(process.execPath, [cli, '--root', root, 'ui/View.tsx'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /ui\/View.tsx:1 native-control:.*@omniviewdev\/base-ui/);
  await put('ui/View.tsx', 'const a = <section><h1>Hello</h1></section>;');
  assert.equal(spawnSync(process.execPath, [cli, '--root', root, 'ui/View.tsx']).status, 0);
});

test('CLI without file arguments audits staged and untracked UI changes', async t => {
  const { root, put } = await fixture(t);
  git(root, 'init');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture');
  await put('ui/View.tsx', 'const a = <section/>;');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'baseline');
  await put('ui/View.tsx', 'const a = <button/>;');
  git(root, 'add', '.');
  await put('ui/New.tsx', 'const a = <input/>;');
  const cli = fileURLToPath(new URL('./check.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--root', root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ui\/View.tsx:1 native-control/);
  assert.match(result.stderr, /ui\/New.tsx:1 native-control/);
});

test('selected baseline catches clean committed changes and rejects invalid explicit refs', async t => {
  const { root, put } = await fixture(t);
  git(root, 'init');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture');
  await put('ui/View.tsx', 'const a = <section/>;');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'baseline');
  const base = git(root, 'rev-parse', 'HEAD').toString().trim();
  await put('ui/View.tsx', 'const a = <button/>;');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'new control');
  assert.deepEqual(await changedFiles(root), []);
  assert.deepEqual(await changedFiles(root, { base }), ['ui/View.tsx']);
  assert.deepEqual(await checkFiles(root, ['ui/View.tsx']), []);
  assert.deepEqual(rules(await checkFiles(root, ['ui/View.tsx'], { base })), ['native-control']);
  await assert.rejects(checkFiles(root, ['ui/View.tsx'], { base: 'missing-base-ref' }), /Cannot resolve audit base/);
  await assert.rejects(changedFiles(root, { base: 'missing-base-ref' }), /Cannot resolve audit base/);
  const cli = fileURLToPath(new URL('./check.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--root', root, '--base', base], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ui\/View.tsx:1 native-control/);
  const invalid = spawnSync(process.execPath, [cli, '--root', root, '--base', 'missing-base-ref'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Cannot resolve audit base/);
});

test('explicit baseline outside Git fails instead of silently disabling comparison', async t => {
  const { root, put } = await fixture(t);
  await put('ui/View.tsx', 'const a = <section/>;');
  await assert.rejects(checkFiles(root, ['ui/View.tsx'], { base: 'HEAD' }), /Cannot resolve audit base/);
});

test('GitHub PR environment selects merge-base and fails closed when remote base is unavailable', async t => {
  const { root, put } = await fixture(t);
  git(root, 'init');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture');
  await put('ui/View.tsx', 'const a = <section/>;');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'baseline');
  git(root, 'update-ref', 'refs/remotes/origin/audit-base', 'HEAD');
  await put('ui/View.tsx', 'const a = <button/>;');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'new control');
  const cli = fileURLToPath(new URL('./check.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--root', root], {
    encoding: 'utf8', env: { ...process.env, GITHUB_BASE_REF: 'audit-base' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ui\/View.tsx:1 native-control/);
  const missing = spawnSync(process.execPath, [cli, '--root', root], {
    encoding: 'utf8', env: { ...process.env, GITHUB_BASE_REF: 'missing-remote-base' },
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Cannot determine GitHub PR audit base/);
});

test('resolves native temporal props through object spreads and const aliases with overrides', async t => {
  const { root, put } = await fixture(t);
  await put('ui/View.tsx', `import {Input} from '@omniviewdev/base-ui';
import React from 'react';
const temporal = {type: 'datetime-local'};
const alias = temporal;
const nested = {...alias};
const first = <Input.Control {...{type: 'datetime-local'}}/>;
const second = <Input.Control {...nested}/>;
const third = React.createElement(Input.Control, {...alias});
const safe = <Input.Control {...nested} type="text"/>;
const safeObject = React.createElement(Input.Control, {...alias, type:'text'});
const styles = {all:'unset'};
const reset = <Input.Control style={styles}/>;
`);
  assert.deepEqual(rules(await checkFiles(root, ['ui/View.tsx'])).sort(),
    ['control-reset', 'native-datetime', 'native-datetime', 'native-datetime']);
});

test('uses current straight-line alias assignment rather than stale initializers', async t => {
  const { root, put } = await fixture(t);
  await put('ui/View.tsx', `import React from 'react';
const custom = (...args: unknown[]) => null;
let forward = custom;
forward = React.createElement;
forward('input');
let reverse = React.createElement;
reverse = custom;
reverse('button');
let untouched = custom;
untouched('textarea');
`);
  assert.deepEqual(rules(await checkFiles(root, ['ui/View.tsx'])), ['native-control']);
});

test('requires review for branch-dependent aliases with proven React possibilities', async t => {
  const { root, put } = await fixture(t);
  await put('ui/View.tsx', `import React from 'react';
const custom = (...args: unknown[]) => null;
let factory = custom;
if (Math.random()) factory = React.createElement;
factory('input');
let safe = custom;
if (Math.random()) safe = custom;
safe('button');
`);
  assert.deepEqual(rules(await checkFiles(root, ['ui/View.tsx'])), ['ambiguous-react-control']);
});

test('returns stable normalized identity for gate baseline comparisons', async t => {
  const { root, put } = await fixture(t);
  await put('ui/View.tsx', `import {Input} from '@omniviewdev/base-ui';
const view = <Input.Control type={ 'datetime-local' }/>;`);
  const findings = await checkFiles(root, ['ui/View.tsx']);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].identity, "type={ 'datetime-local' }");
});
