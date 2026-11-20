import assert from 'node:assert/strict';
import test from 'node:test';
import { clockOf, compareLogs, expectedLogs, LOGS_JOB } from './logs.mjs';

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
