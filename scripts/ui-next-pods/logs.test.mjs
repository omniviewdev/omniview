import assert from 'node:assert/strict';
import test from 'node:test';
import { busyPod, busyRate, busyReplayed, busyScript, clockOf, compareLogs, compareRate, compareRepress, compareTabName, expectedLogs, LOGS_BUSY, LOGS_JOB, LOGS_RUNNING, NO_RATE, RATE_BOUND_FACTOR, READY_SECONDS, readStrip, REPLAYED_AT_LEAST, SETTLED_SAMPLES, tabNameOf, waitProcessMs, withOwnedPod } from './logs.mjs';

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

// S1-host: the rate on the strip of a busy Pod (logs.mjs, `compareRate`). The check opens a Pod that writes a backlog and then 5 lines a second and reads the strip every 250 ms; what it reads is held to what the Pod makes.

// The Pod writes 5 lines a second in each of two containers: the strip is held to the 10 it makes, and the session replays 1,000 lines of each.
const BUSY = { perSecond: busyRate(LOGS_BUSY), replayed: busyReplayed(LOGS_BUSY) };
const strip = (lines, rate) => `${lines.toLocaleString('en-US')} lines · ${typeof rate === 'number' ? `${rate.toFixed(1)} lines/s` : NO_RATE} · Following`;
// The series a plugin that marks its replay gives: no rate until the source's word, then 0.0, then the Pod's own.
const told = [strip(250, undefined), strip(2000, undefined), strip(2001, 0), strip(2003, 7.2), strip(2004, 9.1), ...Array.from({ length: 20 }, (_, at) => strip(2005 + at, 9.5 + (at % 3) * 0.3))];

test('the Pod the rate is read from is the check\'s own: two containers, a backlog larger than the default tail in each, a known rate, and a script that writes the backlog at once and then a line every fifth of a second', () => {
  assert.deepEqual(LOGS_BUSY, { namespace: 'checkout', name: 'logs-busy', backlog: 3000, perSecond: 5, containers: ['a', 'b'] });
  assert.ok(LOGS_BUSY.backlog > REPLAYED_AT_LEAST, 'the backlog is more than the tail the session replays');
  assert.notEqual(`${LOGS_BUSY.namespace}/${LOGS_BUSY.name}`, `${LOGS_RUNNING.namespace}/${LOGS_RUNNING.name}`, 'it is not the Pod of the press-twice check');
  assert.equal(busyScript(LOGS_BUSY), 'i=0; while [ $i -lt 3000 ]; do i=$((i + 1)); echo "backlog $i"; done; while true; do echo live; sleep 0.2; done');
  assert.equal(busyRate(LOGS_BUSY), 10, 'the strip is held to what both containers make');
  assert.equal(busyReplayed(LOGS_BUSY), 2000, 'and the session replays the tail of each');
});

test('the Pod\'s manifest has a container for each name, each with the script, and its own name and namespace: one container could not show a second source\'s tail arriving after the first one\'s first live line', () => {
  const manifest = busyPod(LOGS_BUSY);
  assert.equal(manifest.kind, 'Pod');
  assert.deepEqual(manifest.metadata, { name: 'logs-busy', namespace: 'checkout' });
  assert.equal(manifest.spec.restartPolicy, 'Never');
  assert.deepEqual(manifest.spec.containers.map((container) => container.name), ['a', 'b']);
  for (const container of manifest.spec.containers) {
    assert.deepEqual(container.command, ['sh', '-c', busyScript(LOGS_BUSY)]);
    assert.equal(container.image, 'busybox:1.37.0');
  }
});

test('readStrip reads the count and the rate off the strip\'s text, and tells a rate from the words that say there is none', () => {
  assert.deepEqual(readStrip('1,000 lines · 4.9 lines/s · Following'), { lines: 1000, rate: 4.9 });
  assert.deepEqual(readStrip('27 of 1,170 lines · 1,234.6 lines/s · Following'), { lines: 1170, rate: 1234.6 });
  assert.deepEqual(readStrip('250 lines · No rate · Following'), { lines: 250, rate: 'none' });
  assert.deepEqual(readStrip('3 lines · 0.0 lines/s · Following'), { lines: 3, rate: 0 });
  assert.deepEqual(readStrip(''), { lines: undefined, rate: undefined });
  assert.equal(NO_RATE, 'No rate');
});

test('a strip that says no rate before its source speaks, then the Pod\'s own, agrees', () => {
  assert.deepEqual(compareRate(told, BUSY), []);
});

test('negative control: a sample above twice the Pod\'s rate (the backlog counted as the rate) is reported with the sample and the limit', () => {
  const burst = [...told.slice(0, 2), strip(2500, 53.5), ...told.slice(2)];
  assert.match(compareRate(burst, BUSY).join('\n'), /sample 3 of 26 reads 53\.5 lines\/s, the Pod writes 10 a second \(the limit is 20\)/);
  // The bound is a figure of the Pod's rate: a Pod of another rate has another one (twice 12 is 24: a sample of 20 is allowed, and of 30 is not).
  const twelve = (peak) => [strip(250, undefined), strip(1000, undefined), strip(1100, peak), ...Array.from({ length: 20 }, (_, at) => strip(1200 + at, 11 + (at % 3) * 0.5))];
  assert.deepEqual(compareRate(twelve(20), { perSecond: 12, replayed: 1000 }), []);
  assert.match(compareRate(twelve(30), { perSecond: 12, replayed: 1000 }).join('\n'), /sample 3 of 23 reads 30 lines\/s, the Pod writes 12 a second \(the limit is 24\)/);
  assert.equal(RATE_BOUND_FACTOR, 2);
});

test('negative control: a strip that never tells a rate (no source said its backlog was delivered) is reported, not passed as one that held its tongue', () => {
  const silent = Array.from({ length: 30 }, (_, at) => strip(1000 + at, undefined));
  assert.match(compareRate(silent, BUSY).join('\n'), /told a rate in 0 of 30 samples, wanted 8 or more/);
  assert.match(compareRate(silent.slice(0, SETTLED_SAMPLES - 1).map((text, at) => (at === 0 ? strip(1000, 4.9) : text)), BUSY).join('\n'), /told a rate in 1 of 7 samples/);
});

test('negative control: a strip that settles on 0.0, or on a rate that is not the Pod\'s, is reported', () => {
  const zero = [...told.slice(0, 5), ...Array.from({ length: 20 }, (_, at) => strip(1005 + at, 0))];
  assert.match(compareRate(zero, BUSY).join('\n'), /the last 8 samples read \[0,0,0,0,0,0,0,0\], wanted every one between 5 and 20 lines\/s/);
  const slow = [...told.slice(0, 5), ...Array.from({ length: 20 }, (_, at) => strip(2005 + at, 1))];
  assert.match(compareRate(slow, BUSY).join('\n'), /wanted every one between 5 and 20/);
  // One container's rate is not the Pod's: a strip that counted only half of what the Pod makes is off.
  const half = [...told.slice(0, 5), ...Array.from({ length: 20 }, (_, at) => strip(2005 + at, 4.8))];
  assert.match(compareRate(half, BUSY).join('\n'), /wanted every one between 5 and 20/);
  const lostIt = [...told.slice(0, -1), strip(1030, undefined)];
  assert.match(compareRate(lostIt, BUSY).join('\n'), /the last 8 samples read/);
});

test('negative control: a session that never replayed the backlog is a check that compared nothing with nothing, and is reported', () => {
  const fewLines = told.map((text, at) => strip(100 + at, readStrip(text).rate === 'none' ? undefined : readStrip(text).rate));
  assert.match(compareRate(fewLines, BUSY).join('\n'), /the strip counted 1[0-9][0-9] lines at most, wanted 2000 or more/);
  // A session that replayed one container's tail only is short of the two the Pod has.
  const oneTail = told.map((text, at) => strip(1000 + at, readStrip(text).rate === 'none' ? undefined : readStrip(text).rate));
  assert.match(compareRate(oneTail, BUSY).join('\n'), /wanted 2000 or more/);
});

test('the rate check\'s own Pod is owned the way the press-twice Pod is: one that is there already is not used, and one the check makes is deleted whatever happens', async () => {
  const calls = [];
  const pod = LOGS_BUSY;
  await assert.rejects(
    withOwnedPod({ pod, exists: async () => true, create: async () => calls.push('create'), remove: async () => calls.push('remove') }, async () => calls.push('body')),
    /the Pod checkout\/logs-busy is already there/,
  );
  assert.deepEqual(calls, []);
  const answered = await withOwnedPod({ pod, exists: async () => false, create: async () => calls.push('create'), remove: async () => calls.push('remove') }, async () => 'read');
  assert.equal(answered, 'read');
  assert.deepEqual(calls, ['create', 'remove']);
});
