// The vitest summary (scripts/vitest-failures.mjs): fed reports as vitest 5's JSON reporter wrote them (trimmed to the fields it reads), one passing and one failing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { render, summarize } from './vitest-failures.mjs';

const script = fileURLToPath(new URL('./vitest-failures.mjs', import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), 'vitest-failures-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const passing = {
  numTotalTestSuites: 2, numPassedTestSuites: 2, numFailedTestSuites: 0, numTotalTests: 3, numPassedTests: 3, numFailedTests: 0, numPendingTests: 0, success: true,
  testResults: [
    { name: '/repo/ui/a.test.ts', status: 'passed', message: '', assertionResults: [{ fullName: 'a works', title: 'a works', status: 'passed', failureMessages: [] }, { fullName: 'a also', title: 'a also', status: 'passed', failureMessages: [] }] },
    { name: '/repo/ui/b.test.ts', status: 'passed', message: '', assertionResults: [{ fullName: 'b works', title: 'b works', status: 'passed', failureMessages: [] }] },
  ],
};
const failing = {
  numTotalTestSuites: 2, numPassedTestSuites: 0, numFailedTestSuites: 2, numTotalTests: 2, numPassedTests: 1, numFailedTests: 1, numPendingTests: 0, success: false,
  testResults: [
    {
      name: '/repo/ui/a.test.ts', status: 'failed', message: '',
      assertionResults: [
        { ancestorTitles: ['group'], fullName: 'group fails here', title: 'fails here', status: 'failed', failureMessages: ['AssertionError: expected 2 to be 3 // Object.is equality\n    at /repo/ui/a.test.ts:3:40\n    at file:///repo/node_modules/vitest/dist/x.js:1:1'] },
        { fullName: 'passes', title: 'passes', status: 'passed', failureMessages: [] },
      ],
    },
    { name: '/repo/ui/broken.test.ts', status: 'failed', message: 'Error: Failed to resolve import "./missing" from "ui/broken.test.ts"', assertionResults: [] },
  ],
};

test('a passing report is one line of counts', () => {
  assert.equal(summarize('Component tests', passing), '**Component tests**: 3 of 3 tests passed in 2 files\n');
});

test('a failing report names the file, the test and the first assertion line, without the stack', () => {
  const markdown = summarize('Component tests', failing, '/repo/');
  assert.match(markdown, /^### Component tests: 1 of 2 tests failed/);
  assert.match(markdown, /- `ui\/a\.test\.ts` \*\*group fails here\*\*\n  `AssertionError: expected 2 to be 3 \/\/ Object\.is equality`/);
  assert.match(markdown, /- `ui\/broken\.test\.ts` \*\*\(the file failed before its tests ran\)\*\*\n  `Error: Failed to resolve import/);
  assert.doesNotMatch(markdown, /node_modules|a\.test\.ts:3:40/);
});

test('at most 30 tests are named and a message is cut at 300 characters', () => {
  const many = { ...failing, numFailedTests: 40, testResults: [{ name: '/repo/x.test.ts', status: 'failed', message: '', assertionResults: Array.from({ length: 40 }, (_, i) => ({ fullName: `t${i}`, status: 'failed', failureMessages: ['E'.repeat(500)] })) }] };
  const markdown = summarize('Many', many);
  assert.equal(markdown.match(/\*\*t\d+\*\*/g).length, 30);
  assert.match(markdown, /and 10 more/);
  assert.ok(!markdown.includes('E'.repeat(301)));
});

test('the command prints the summary in a log group, appends it to the summary file, says plainly that a report is missing or truncated, and exits 0', () => {
  writeFileSync(path.join(dir, 'pass.json'), JSON.stringify(passing));
  writeFileSync(path.join(dir, 'fail.json'), JSON.stringify(failing));
  writeFileSync(path.join(dir, 'bad.json'), '{');
  const run = spawnSync(process.execPath, [script, `One=${path.join(dir, 'pass.json')}`, `Gone=${path.join(dir, 'none.json')}`, `Two=${path.join(dir, 'fail.json')}`, `Bad=${path.join(dir, 'bad.json')}`], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md') } });
  assert.equal(run.status, 0);
  assert.equal(readFileSync(path.join(dir, 'summary.md'), 'utf8'), run.stdout.replace(/^::group::.*\n/, '').replace(/\n::endgroup::\n$/, ''));
  assert.match(run.stdout, /^::group::[\s\S]*\*\*One\*\*: 3 of 3[\s\S]*### Gone: no report was written[\s\S]*### Two: 1 of 2[\s\S]*### Bad: the report could not be read[\s\S]*::endgroup::\n$/);
});
