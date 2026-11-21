// The Pod logs side of the Pods cluster check: what `kubectl logs <pod> --timestamps` says a Pod's session in the host's Logs tool must print, and how a reading of the tool differs from it.
// Pure functions only (no process, no browser), so `logs.test.mjs` proves each failure mode without a cluster. The browser part is `checkLogs` and `checkLogsTwice` in parity.mjs.

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

// The Pod the check presses the Logs command of TWICE (P1b-3d, A22): a RUNNING Pod, made for the check by kubectl in the fixture's `checkout` namespace (a busybox that writes a line a second and never ends). A Pod of
// the fixture may be Completed or in no state to stream, and the `live-probe` Pod of the list's test is gone before this one is made.
export const LOGS_RUNNING = { namespace: 'checkout', name: 'logs-twice' };

// How long the check waits for the Pod it made to be Ready, and how long the process that carries `kubectl wait` may run: the wait's own deadline and room for kubectl to start, ask and print. The process used to be
// the wrapper's 60 s one, which killed a wait that had been asked for 90 (CodeRabbit, parity.mjs, #609).
export const READY_SECONDS = 90;
export const waitProcessMs = (seconds) => (seconds + 30) * 1000;

// Runs `body` with the Pod this check makes, and removes it whatever happens (CodeRabbit, parity.mjs, #609). The cleanup covers the CREATION too: a `kubectl run` that timed out after the API made the Pod used to
// leave it behind, and the next run found its name taken. A Pod of that name that is already there is not the check's, so it is neither made, used nor removed: the check stops and says so. `exists`, `create` and
// `remove` are the cluster's side, passed in, so each of these rules is tested without a cluster. A removal that fails is never lost: after a body that passed it fails the check (the Pod is still there, and the next run
// would stop at it); after a failure of the creation or the body it is `report`ed on its own and the first failure is the one thrown.
export async function withOwnedPod({ exists, create, remove }, body, { report = (message) => console.error(message) } = {}) {
  const name = `${LOGS_RUNNING.namespace}/${LOGS_RUNNING.name}`;
  if (await exists()) {
    throw new Error(`the Pod ${name} is already there: it is not this check's, so it is not used and not deleted; delete it and run the check again`);
  }

  let answer;
  let failure;
  let failed = false;
  try {
    await create();
    answer = await body();
  } catch (error) {
    failed = true;
    failure = error;
  }

  let cleanup;
  try {
    await remove();
  } catch (error) {
    cleanup = error;
  }

  const said = (error) => (error instanceof Error ? error.message : String(error));
  if (failed) {
    if (cleanup !== undefined) {
      report(`the Pod ${name} could not be deleted either (${said(cleanup)}): delete it by hand before the next run`);
    }

    throw failure;
  }

  if (cleanup !== undefined) {
    throw new Error(`the check passed, but the Pod ${name} could not be deleted (${said(cleanup)}): delete it by hand, or the next run stops at it`, { cause: cleanup });
  }

  return answer;
}

// The accessible name of the tab of a Pod's session when it is alone in the Logs tool. A22: a session draws its scope (here the connection) only to tell sessions of one title apart, so a lone session is named for the
// Pod and nothing else while it runs. SCT1 (the mock's 16-ide-shell.md): the accessible name is the whole name and the state, so a session that has ended is `<pod>, ended`: a person who cannot see the strip's
// info glyph (it is decoration) learns from the name that the session ended. The mock's strip words the same state `<name>, exited`; the host's word for a stream that ended is `ended`.
export function tabNameOf(podName, state) {
  return state === 'ended' ? `${podName}, ended` : podName;
}

// A reading of the tab's name (`undefined` when the tool shows no tab) against the name it must have: both parts, the Pod and, for a session that has ended, its state, as one exact name. The name of the rule
// before A22 (`<pod> · <connection>`) and an ended session named without its state are each a problem.
export function compareTabName(name, podName, state) {
  const wanted = tabNameOf(podName, state);
  if (name === undefined) {
    return [`there is no tab to name, wanted ${JSON.stringify(wanted)}`];
  }

  return name === wanted ? [] : [`the session's tab is named ${JSON.stringify(name)}, wanted ${JSON.stringify(wanted)}`];
}

function lonePodTabProblems(when, tabs, podName) {
  if (tabs.length !== 1) {
    return [`${when} the Logs tool holds ${String(tabs.length)} tabs (${JSON.stringify(tabs)}), wanted the one`];
  }

  return compareTabName(tabs[0], podName, 'running').map((problem) => `${when}: ${problem}`);
}

// The Logs command of a RUNNING Pod pressed twice shows its one session (A22: a session is its plugin and its target). `reading` is `{ before, first, second, closed }`: how many sessions the SDK held before the
// first press, then, after each step, the names of the Logs tool's tabs and how many sessions the SDK held (`closed` has the count only). After the first press: one tab, named for the Pod, and one SDK session
// more. After the second: the same one tab and the same number of SDK sessions (a second stream would be one more). Once the tab is closed: the number the SDK held before.
export function compareRepress(reading, podName) {
  const { before, first, second, closed } = reading;
  const problems = [...lonePodTabProblems('after the first press', first.tabs, podName), ...lonePodTabProblems('after the second press', second.tabs, podName)];
  if (first.sessions !== before + 1) {
    problems.push(`the SDK holds ${String(first.sessions)} sessions after the first press, wanted ${String(before + 1)}`);
  }

  if (second.sessions !== before + 1) {
    problems.push(`the SDK holds ${String(second.sessions)} sessions after the second press, wanted ${String(before + 1)}: the press started a second stream instead of showing the first`);
  }

  if (closed.sessions !== before) {
    problems.push(`the SDK holds ${String(closed.sessions)} sessions after the tab was closed, wanted ${String(before)}`);
  }

  return problems;
}
