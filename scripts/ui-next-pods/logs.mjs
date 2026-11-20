// The Pod logs side of the Pods cluster check: what `kubectl logs <pod> --timestamps` says a Pod's session in the host's Logs tool must print, and how a reading of the tool differs from it.
// Pure functions only (no process, no browser), so `logs.test.mjs` proves each failure mode without a cluster. The browser part is `checkLogs` in parity.mjs.

// The Pods whose logs the check opens: those of the fixture's Job `nightly-report` (docs/ui-next/slices/1a-pods-list/fixture.yaml), which write their line (`done`) and complete. A Job's Pod has a generated
// name, so kubectl names it; the Pod is Completed, so its log is fixed and the session reads it to its end whenever it is opened.
export const LOGS_JOB = { namespace: 'batch', name: 'nightly-report' };

// `kubectl logs <pod> --timestamps` (its output) -> the lines it prints: the RFC 3339 timestamp, then the line as the container wrote it.
export function expectedLogs(output) {
  return output
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const space = line.indexOf(' ');
      return { timestamp: line.slice(0, space), text: line.slice(space + 1) };
    });
}

const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/;

// The clock the Logs view prints for a timestamp (the kit's `formatClock`): `HH:MM:SS.mmm`, the milliseconds from the first three digits of the fraction. The check gives the page the UTC time zone, so the
// view's local clock is the timestamp's own. '' for text that is not a UTC time.
export function clockOf(timestamp) {
  const match = RFC3339_UTC.exec(timestamp);
  return match === null ? '' : `${match[1]}.${(match[2] ?? '').slice(0, 3).padEnd(3, '0')}`;
}

// What the session prints against what kubectl prints. `rows` is `[{ time, text }]`: the view's clock and line cell of each row, in order. Every line must be there, once, in order, with the clock of its timestamp.
// A Pod kubectl has no line for is a problem, never a pass: a check that compared nothing with nothing would be blind.
export function compareLogs(rows, expected) {
  const problems = [];
  if (expected.length === 0) {
    problems.push('kubectl has no line for this Pod, so the check cannot compare it');
  }

  if (rows.length !== expected.length) {
    problems.push(`the session has ${String(rows.length)} rows, kubectl has ${String(expected.length)} lines`);
  }

  expected.forEach((line, at) => {
    const row = rows[at];
    if (row === undefined) {
      return;
    }

    if (row.text !== line.text) {
      problems.push(`line ${String(at + 1)}: the row says ${JSON.stringify(row.text)}, kubectl says ${JSON.stringify(line.text)}`);
    } else if (row.time !== clockOf(line.timestamp)) {
      problems.push(`line ${String(at + 1)}: the row's clock is ${row.time}, kubectl's ${line.timestamp} reads ${clockOf(line.timestamp)}`);
    }
  });
  return problems;
}
