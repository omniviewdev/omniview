import assert from 'node:assert/strict';
import test from 'node:test';
import { changingBetween, compareReading, converge, MOST_CHANGING } from './agreement.mjs';
import { chipTexts, quickFilterCounts } from './oracle.mjs';

const row = (name, status) => ({ name, ready: '1/1', status });
const STABLE = [row('shop/web-1', 'Running'), row('shop/web-2', 'Running'), row('shop/job-1', 'Completed'), row('shop/waiting', 'Pending'), row('shop/bad-image', 'ImagePullBackOff')];
// The Pod that flaps by design: `Running` for a second after each restart, `Error` or `CrashLoopBackOff` otherwise.
const running = row('shop/loop', 'Running');
const failed = row('shop/loop', 'CrashLoopBackOff');

/** What the page reads when it shows exactly `rows`. */
const reading = (rows, overrides = {}) => ({
  state: 'ready',
  names: rows.map((entry) => entry.name).sort(),
  rowCount: rows.length,
  count: `${String(rows.length)} Pods`,
  filters: chipTexts(quickFilterCounts(rows)),
  status: `ready (${String(rows.length)} Pods)`,
  message: '',
  ...overrides,
});

test('a page that shows what kubectl shows agrees, and says which table it matched', () => {
  const rows = [...STABLE, failed];
  const result = compareReading(reading(rows), rows, rows);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.changing, []);
  assert.equal(result.matched.count, '6 Pods');
  assert.deepEqual(result.matched.filters, ['All 6', 'Running 2', 'Pending 1', 'Failed 2', 'Completed 1']);
});

test('the Pod that kubectl changed between its two reads may read either way on the page (the first CI run of N19d)', () => {
  const before = [...STABLE, running];
  const after = [...STABLE, failed];
  for (const shown of [running, failed]) {
    const result = compareReading(reading([...STABLE, shown]), before, after);
    assert.deepEqual(result.problems, [], `the page shows the Pod as ${shown.status}`);
    assert.deepEqual(result.changing, ['shop/loop']);
  }
});

test('negative control: a Pod that kubectl reports the same way in both reads is held to it', () => {
  const steady = [...STABLE, failed];
  // kubectl: the Pod is CrashLoopBackOff before and after; the page counts it as Running: a persistent mismatch.
  const wrong = compareReading(reading([...STABLE, running]), steady, steady);
  assert.equal(wrong.problems.length, 1);
  assert.match(wrong.problems[0], /the quick filters read \["All 6","Running 3","Pending 1","Failed 1","Completed 1"\], kubectl says \["All 6","Running 2","Pending 1","Failed 2","Completed 1"\]/);
});

test('negative control: the allowance is for the Pod that changed and for nobody else', () => {
  // kubectl: `loop` changed between the reads; `job-1` is Completed in both. The page counts `job-1` as Running, whichever way it shows `loop`.
  const before = [...STABLE, running];
  const after = [...STABLE, failed];
  const other = STABLE.map((entry) => (entry.name === 'shop/job-1' ? row(entry.name, 'Running') : entry));
  for (const shown of [running, failed]) {
    assert.notDeepEqual(compareReading(reading([...other, shown]), before, after).problems, [], `the page shows the flapping Pod as ${shown.status}`);
  }
});

test('negative control: a Pod kubectl lists in both reads must be on the page once, and the page lists no Pod kubectl never listed', () => {
  const rows = [...STABLE, failed];
  const missing = compareReading(reading(rows.slice(1)), rows, rows);
  assert.match(missing.problems.join('\n'), /the page lists 5 Pods, kubectl lists 6 \(missing 1, extra 0, duplicated 0\)/);
  const extra = compareReading(reading([...rows, row('shop/ghost', 'Running')]), rows, rows);
  assert.match(extra.problems.join('\n'), /extra 1/);
  const twice = compareReading(reading([...rows, rows[0]]), rows, rows);
  assert.match(twice.problems.join('\n'), /duplicated 1/);
});

test('a Pod that only one read lists may be listed or not', () => {
  const before = STABLE;
  const after = [...STABLE, row('shop/new', 'Pending')];
  assert.deepEqual(compareReading(reading(STABLE), before, after).problems, []);
  assert.deepEqual(compareReading(reading(after), before, after).problems, []);
  assert.notDeepEqual(compareReading(reading([...STABLE, row('shop/other', 'Pending')]), before, after).problems, []);
});

test('a page that is not showing its rows, or cannot show them all, does not agree', () => {
  const rows = [...STABLE, failed];
  assert.deepEqual(compareReading({ ...reading([]), state: 'empty', status: 'empty: No Plugins' }, rows, rows).problems, ['the page is empty: No Plugins']);
  assert.match(compareReading(reading(rows, { rowCount: 40 }), rows, rows).problems[0], /the table holds 40 rows and 6 are mounted/);
});

test('more Pods changing between the reads than the allowance can honestly cover is a cluster that is not at rest', () => {
  const many = Array.from({ length: MOST_CHANGING + 1 }, (_, index) => `shop/flap-${String(index)}`);
  const before = many.map((name) => row(name, 'Running'));
  const after = many.map((name) => row(name, 'CrashLoopBackOff'));
  const result = compareReading(reading(before), before, after);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /7 Pods changed between the two reads of kubectl/);
  assert.equal(changingBetween(before, after).changing.length, 7);
});

// The loop: kubectl, the page, kubectl, for every attempt; the clock and the wait are the test's.
function clock() {
  let time = 0;
  return {
    now: () => time,
    pause: (ms) => {
      time += ms;
      return Promise.resolve();
    },
  };
}

test('converge reads again, with fresh reads of both: the CI case, where the first reading of kubectl was the transient', async () => {
  const calls = [];
  let kubectlReads = 0;
  const result = await converge({
    // kubectl's first two reads (the first attempt) are the moment after a restart; the Pod is CrashLoopBackOff from then on. The page shows it so throughout.
    kubectl: () => {
      calls.push('kubectl');
      kubectlReads += 1;
      return Promise.resolve([...STABLE, kubectlReads <= 2 ? running : failed]);
    },
    readPage: () => {
      calls.push('page');
      return Promise.resolve(reading([...STABLE, failed]));
    },
    timeoutMs: 30_000,
    ...clock(),
  });
  assert.equal(result.agreed, true);
  assert.equal(result.attempt, 2, 'the first attempt mismatches (kubectl says the Pod is Running in both reads), the second agrees');
  assert.deepEqual(calls, ['kubectl', 'page', 'kubectl', 'kubectl', 'page', 'kubectl'], 'kubectl is read before and after every reading of the page');
});

test('converge agrees at once when the flap is inside the attempt', async () => {
  let reads = 0;
  const result = await converge({
    kubectl: () => {
      reads += 1;
      return Promise.resolve([...STABLE, reads === 1 ? running : failed]);
    },
    readPage: () => Promise.resolve(reading([...STABLE, running])),
    timeoutMs: 30_000,
    ...clock(),
  });
  assert.equal(result.agreed, true);
  assert.equal(result.attempt, 1);
});

test('negative control: converge never agrees with a page that is persistently wrong, and gives up at the deadline with the last attempt', async () => {
  const attempts = [];
  const result = await converge({
    kubectl: () => Promise.resolve([...STABLE, failed]),
    readPage: () => {
      attempts.push('page');
      return Promise.resolve(reading([...STABLE, running]));
    },
    timeoutMs: 3000,
    intervalMs: 1000,
    ...clock(),
  });
  assert.equal(result.agreed, false);
  assert.equal(attempts.length, 4, 'attempts at 0, 1, 2 and 3 s: it stops at the deadline');
  assert.match(result.problems.join('\n'), /the quick filters read/);
  assert.equal(result.read.state, 'ready');
});
