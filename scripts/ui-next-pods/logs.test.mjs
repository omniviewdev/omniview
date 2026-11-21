import assert from 'node:assert/strict';
import test from 'node:test';
import { clockOf, compareLogs, compareRepress, compareTabName, expectedLogs, LOGS_JOB, LOGS_RUNNING, READY_SECONDS, tabNameOf, waitProcessMs, withOwnedPod } from './logs.mjs';

const expected = expectedLogs('2026-11-20T02:43:18.137683626Z done\n2026-11-20T02:43:19.250000000Z second line\n');
const rows = [
  { time: '02:43:18.137', text: 'done' },
  { time: '02:43:19.250', text: 'second line' },
];

test('the Pods the check opens are those of the fixture\'s Job, which write their lines and complete', () => {
  assert.deepEqual(LOGS_JOB, { namespace: 'batch', name: 'nightly-report' });
});

test('expectedLogs reads what `kubectl logs --timestamps` prints: the timestamp, then the line as it was written', () => {
  assert.deepEqual(expected, [
    { timestamp: '2026-11-20T02:43:18.137683626Z', text: 'done' },
    { timestamp: '2026-11-20T02:43:19.250000000Z', text: 'second line' },
  ]);
  assert.deepEqual(expectedLogs('2026-11-20T02:43:18.1Z a  b\n2026-11-20T02:43:19.000000001Z \n'), [
    { timestamp: '2026-11-20T02:43:18.1Z', text: 'a  b' },
    { timestamp: '2026-11-20T02:43:19.000000001Z', text: '' },
  ]);
  assert.deepEqual(expectedLogs(''), []);
});

test('clockOf is the clock the Logs view prints: HH:MM:SS.mmm from the first three digits of the fraction, in UTC', () => {
  assert.equal(clockOf('2026-11-20T02:43:18.137683626Z'), '02:43:18.137');
  assert.equal(clockOf('2026-11-20T02:43:18.5Z'), '02:43:18.500');
  assert.equal(clockOf('2026-11-20T02:43:18Z'), '02:43:18.000');
  assert.equal(clockOf('not a time'), '');
});

test('a session that prints the lines kubectl prints, with their clocks, agrees', () => {
  assert.deepEqual(compareLogs(rows, expected), []);
});

test('negative control: a changed line, a changed clock, a missing row and an extra row are each reported', () => {
  assert.match(compareLogs([rows[0], { ...rows[1], text: 'second lin' }], expected).join('\n'), /line 2: the row says "second lin", kubectl says "second line"/);
  assert.match(compareLogs([{ ...rows[0], time: '02:43:18.138' }, rows[1]], expected).join('\n'), /line 1: the row's clock is 02:43:18\.138, kubectl's 2026-11-20T02:43:18\.137683626Z reads 02:43:18\.137/);
  assert.match(compareLogs([rows[0]], expected).join('\n'), /the session has 1 rows, kubectl has 2 lines/);
  assert.match(compareLogs([...rows, { time: '02:43:20.000', text: 'extra' }], expected).join('\n'), /the session has 3 rows, kubectl has 2 lines/);
});

test('negative control: a session with no row where kubectl has lines is a problem, and a Pod kubectl has no line for is never a pass', () => {
  assert.notDeepEqual(compareLogs([], expected), []);
  assert.match(compareLogs([], []).join('\n'), /kubectl has no line/);
  assert.match(compareLogs(rows, []).join('\n'), /kubectl has no line/);
});

test('negative control: a row that is not a line (the marker where lines were dropped has no text cell) never reads as agreeing', () => {
  assert.match(compareLogs([{ time: '', text: '' }, rows[1]], expected).join('\n'), /line 1/);
});

const POD = 'nightly-report-gzjwl';

test('a session alone in the tool is named for its Pod while it runs, and for the Pod and its state once it has ended (A22: no scope for a lone session; SCT1: the name carries the state)', () => {
  assert.equal(tabNameOf(POD, 'running'), POD);
  assert.equal(tabNameOf(POD, 'ended'), `${POD}, ended`);
  assert.deepEqual(compareTabName(POD, POD, 'running'), []);
  assert.deepEqual(compareTabName(`${POD}, ended`, POD, 'ended'), []);
});

test('negative control: the name of the old rule (the Pod, then the connection), an ended session named without its state, a running one named with it, another Pod and no tab are each reported', () => {
  assert.match(compareTabName(`${POD} · kind-check`, POD, 'ended').join('\n'), /named "nightly-report-gzjwl · kind-check", wanted "nightly-report-gzjwl, ended"/);
  assert.match(compareTabName(`${POD} · kind-check, ended`, POD, 'ended').join('\n'), /named "nightly-report-gzjwl · kind-check, ended", wanted "nightly-report-gzjwl, ended"/);
  assert.match(compareTabName(POD, POD, 'ended').join('\n'), /named "nightly-report-gzjwl", wanted "nightly-report-gzjwl, ended"/);
  assert.match(compareTabName(`${POD}, ended`, POD, 'running').join('\n'), /named "nightly-report-gzjwl, ended", wanted "nightly-report-gzjwl"/);
  assert.match(compareTabName('another-pod, ended', POD, 'ended').join('\n'), /named "another-pod, ended"/);
  assert.match(compareTabName(undefined, POD, 'ended').join('\n'), /there is no tab to name/);
});

const RUNNING = LOGS_RUNNING.name;
const repressed = { before: 2, first: { tabs: [RUNNING], sessions: 3 }, second: { tabs: [RUNNING], sessions: 3 }, closed: { sessions: 2 } };

test('a running Pod pressed twice shows its one session: one tab named for the Pod, one SDK session more, and the SDK back to what it held once the tab is closed', () => {
  assert.deepEqual(LOGS_RUNNING, { namespace: 'checkout', name: 'logs-twice' });
  assert.deepEqual(compareRepress(repressed, RUNNING), []);
});

test('negative control: a second tab, a second stream, a tab named with a number or a scope, a session left open and no first session are each reported', () => {
  assert.match(compareRepress({ ...repressed, second: { tabs: [RUNNING, `${RUNNING} (2)`], sessions: 3 } }, RUNNING).join('\n'), /after the second press the Logs tool holds 2 tabs/);
  assert.match(compareRepress({ ...repressed, second: { tabs: [RUNNING], sessions: 4 } }, RUNNING).join('\n'), /the SDK holds 4 sessions after the second press, wanted 3/);
  assert.match(compareRepress({ ...repressed, second: { tabs: [`${RUNNING} (2)`], sessions: 3 } }, RUNNING).join('\n'), /after the second press: the session's tab is named "logs-twice \(2\)", wanted "logs-twice"/);
  assert.match(compareRepress({ ...repressed, first: { tabs: [`${RUNNING} · kind-check`], sessions: 3 } }, RUNNING).join('\n'), /after the first press: the session's tab is named "logs-twice · kind-check"/);
  assert.match(compareRepress({ ...repressed, closed: { sessions: 3 } }, RUNNING).join('\n'), /the SDK holds 3 sessions after the tab was closed, wanted 2/);
  assert.match(compareRepress({ ...repressed, first: { tabs: [], sessions: 2 } }, RUNNING).join('\n'), /after the first press the Logs tool holds 0 tabs/);
});

// CodeRabbit (parity.mjs, #609): the Pod the press-twice case makes was created outside the `try` that deletes it, so a creation that timed out after the API made the Pod left it behind, and the next run found its
// name taken; and the readiness wait asked for 90 s from a process that was killed at 60 s.
const ports = (calls, over = {}) => ({
  exists: async () => false,
  create: async () => {
    calls.push('create');
  },
  remove: async () => {
    calls.push('remove');
  },
  ...over,
});

test('a Pod the check makes is created, used and removed, and what the body answers is what the check answers', async () => {
  const calls = [];
  const answer = await withOwnedPod(ports(calls), async () => {
    calls.push('body');
    return 7;
  });
  assert.equal(answer, 7);
  assert.deepEqual(calls, ['create', 'body', 'remove']);
});

test('negative control: a creation that fails, a body that fails and a removal that fails each still leave the Pod removed, and the failure that is reported is the first one', async () => {
  const created = [];
  await assert.rejects(
    withOwnedPod(ports(created, { create: async () => { created.push('create'); throw new Error('the command timed out after the API made the Pod'); } }), async () => created.push('body')),
    /the command timed out after the API made the Pod/,
  );
  assert.deepEqual(created, ['create', 'remove'], 'the creation is inside the cleanup: a Pod the timed-out command made is removed');

  const used = [];
  await assert.rejects(withOwnedPod(ports(used), async () => { throw new Error('the body failed'); }), /the body failed/);
  assert.deepEqual(used, ['create', 'remove']);

  const cleaned = [];
  const reported = [];
  await assert.rejects(
    withOwnedPod(ports(cleaned, { remove: async () => { cleaned.push('remove'); throw new Error('the removal failed'); } }), async () => { throw new Error('the body failed'); }, { report: (message) => reported.push(message) }),
    /the body failed/,
  );
  assert.deepEqual(cleaned, ['create', 'remove'], 'a removal that fails does not hide the failure of the body');
  assert.match(reported.join('\n'), /the removal failed/, 'and it is reported on its own');
});

test('negative control: a removal that fails after a body that passed is a failure of the check: the Pod is still there and the next run would stop at it (CodeRabbit, #609)', async () => {
  const quiet = [];
  await assert.rejects(
    withOwnedPod(ports(quiet, { remove: async () => { quiet.push('remove'); throw new Error('the removal failed'); } }), async () => 'ok', { report: () => undefined }),
    /checkout\/logs-twice could not be deleted.*the removal failed/,
  );
  assert.deepEqual(quiet, ['create', 'remove']);
});

test('negative control: a Pod that was already there is not the check\'s: it is not made, used or removed, and a cluster that cannot be asked makes nothing', async () => {
  const there = [];
  await assert.rejects(
    withOwnedPod(ports(there, { exists: async () => true }), async () => there.push('body')),
    /checkout\/logs-twice is already there/,
  );
  assert.deepEqual(there, [], 'nothing was created, used or removed');
  const unknown = [];
  await assert.rejects(withOwnedPod(ports(unknown, { exists: async () => { throw new Error('the cluster did not answer'); } }), async () => unknown.push('body')), /the cluster did not answer/);
  assert.deepEqual(unknown, [], 'a cluster that cannot say whether the Pod is there gets nothing made and nothing removed');
});

test('the process that carries the readiness wait outlives the wait it carries, with room to start and print', () => {
  assert.equal(READY_SECONDS, 90);
  assert.ok(waitProcessMs(READY_SECONDS) >= READY_SECONDS * 1000 + 10_000, `the process may run ${String(waitProcessMs(READY_SECONDS))} ms for a wait of ${String(READY_SECONDS)} s`);
  assert.ok(waitProcessMs(1) > 1_000);
});
