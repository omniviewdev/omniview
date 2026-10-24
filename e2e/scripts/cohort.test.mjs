import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { copyCommittedSource } from './cohort.mjs';
import { toolEnvironment } from './execution.mjs';

test('one private committed source copy excludes foreign ignored build state and never writes it', () => {
  const arena = realpathSync(mkdtempSync(join(tmpdir(), 'omniview-cohort-source-')));
  const source = join(arena, 'foreign');
  const destination = join(arena, 'owned');
  const env = { ...toolEnvironment(process.env), HOME: arena };
  const execute = (command, args, options = {}) => execFileSync(command, args, { cwd: options.cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const git = (...args) => execute('git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', ...args]);
  try {
    mkdirSync(source);
    git('init', '--initial-branch=main');
    writeFileSync(join(source, '.gitignore'), 'node_modules/\ndist/\n');
    writeFileSync(join(source, 'package.json'), '{"name":"real-selected-source","version":"1.0.0"}\n');
    git('add', '.'); git('commit', '-m', 'Committed selected inputs');
    const ref = git('rev-parse', 'HEAD');
    for (const name of ['node_modules', 'dist']) {
      mkdirSync(join(source, name));
      writeFileSync(join(source, name, 'foreign-owner'), `unchanged ${name}`);
    }
    copyCommittedSource({ source, ref, destination, execute });
    assert.equal(execute('git', ['-C', destination, 'rev-parse', 'HEAD']), ref);
    assert.equal(readFileSync(join(destination, 'package.json'), 'utf8'), readFileSync(join(source, 'package.json'), 'utf8'));
    for (const name of ['node_modules', 'dist']) {
      assert.equal(existsSync(join(destination, name)), false);
      assert.equal(readFileSync(join(source, name, 'foreign-owner'), 'utf8'), `unchanged ${name}`);
    }
    assert.equal(git('status', '--porcelain', '--untracked-files=all'), '');
  } finally { rmSync(arena, { recursive: true, force: true }); }
});
