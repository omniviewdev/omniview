import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ancestry, checkPin, compareNames } from './pin.mjs';

const HOST_NAMES = ['react', 'react/jsx-runtime', 'react/compiler-runtime', 'react/jsx-dev-runtime', '@omniviewdev/kit', '@omniviewdev/runtime/ui/v1'];

// A host repository of three commits on `main` and one on a side branch, and a plugin checkout that vendors from one of them.
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pin-'));
const host = path.join(base, 'host');
const git = (...args) => execFileSync('git', ['-C', host, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).trim();
fs.mkdirSync(host);
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'pin@example.invalid');
git('config', 'user.name', 'pin');
git('config', 'commit.gpgsign', 'false');
const commit = (message) => {
  fs.writeFileSync(path.join(host, 'file'), message);
  git('add', 'file');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
};
const first = commit('first');
const second = commit('second');
git('checkout', '-q', '-b', 'side');
const side = commit('side');
git('checkout', '-q', 'main');
const third = commit('third');
test.after(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

function plugin(names, hostCommit) {
  const dir = fs.mkdtempSync(path.join(base, 'plugin-'));
  fs.mkdirSync(path.join(dir, 'ui/vendor'), { recursive: true });
  if (names !== undefined) fs.writeFileSync(path.join(dir, 'ui/vendor/shared-specifiers.json'), `${JSON.stringify(names, null, 2)}\n`);
  if (hostCommit !== undefined) fs.writeFileSync(path.join(dir, 'ui/vendor/HOST_COMMIT'), `${hostCommit}\n`);
  return dir;
}

const check = (dir, hostRef = 'main') => checkPin({ pluginDir: dir, hostNames: HOST_NAMES, hostRepo: host, hostRef });

test('compareNames says which side has what the other lacks, in any order', () => {
  assert.deepEqual(compareNames(['b', 'a'], ['a', 'b']), { onlyPlugin: [], onlyHost: [] });
  assert.deepEqual(compareNames(['a', 'c'], ['a', 'b']), { onlyPlugin: ['c'], onlyHost: ['b'] });
});

test('a pin whose list is the host\'s and whose host commit the host contains fits', () => {
  assert.deepEqual(check(plugin([...HOST_NAMES].reverse(), second)), []);
  assert.deepEqual(check(plugin(HOST_NAMES, third)), [], 'the host commit itself fits');
});

test('negative control: a list that lacks a name the host shares, or has one it does not, is a problem that names it', () => {
  const lacks = check(plugin(HOST_NAMES.filter((name) => name !== '@omniviewdev/kit'), second));
  assert.equal(lacks.length, 1);
  assert.match(lacks[0], /the host shares "@omniviewdev\/kit", which the plugin does not list/);
  const extra = check(plugin([...HOST_NAMES, '@omniviewdev/base-ui'], second));
  assert.equal(extra.length, 1);
  assert.match(extra[0], /the plugin lists "@omniviewdev\/base-ui", which the host does not share/);
});

test('negative control: a host commit the host does not contain is a problem, and so is one it has never seen', () => {
  assert.match(check(plugin(HOST_NAMES, side)).join('\n'), /is not main or one of its ancestors/);
  assert.match(check(plugin(HOST_NAMES, third), second).join('\n'), /is not .* or one of its ancestors/, 'a plugin packed from a newer host than the one under test');
  assert.match(check(plugin(HOST_NAMES, 'f'.repeat(40))).join('\n'), /is not known to this checkout/);
  assert.match(check(plugin(HOST_NAMES, 'not a commit')).join('\n'), /is not a full commit id/);
});

test('files that are missing are problems of their own, and both are reported', () => {
  const problems = check(plugin(undefined, undefined));
  assert.equal(problems.length, 2);
  assert.match(problems[0], /cannot read .*shared-specifiers\.json/);
  assert.match(problems[1], /cannot read .*HOST_COMMIT/);
});

test('ancestry tells yes, no and unknown', () => {
  assert.equal(ancestry(host, first, 'main'), 'yes');
  assert.equal(ancestry(host, third, 'main'), 'yes');
  assert.equal(ancestry(host, side, 'main'), 'no');
  assert.equal(ancestry(host, 'e'.repeat(40), 'main'), 'unknown');
});
