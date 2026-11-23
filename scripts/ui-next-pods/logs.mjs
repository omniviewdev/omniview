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
export async function withOwnedPod({ exists, create, remove, pod = LOGS_RUNNING }, body, { report = (message) => console.error(message) } = {}) {
  const name = `${pod.namespace}/${pod.name}`;
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

// S1-host: the RATE on the Logs strip of a busy Pod. The plugin's stream replays a Pod's latest lines (its default tail is 1,000 for each container) before its live ones, and the strip used to count the replay as the rate (7,878
// lines/s on a Pod that writes 5: the demo's D2), and, with two containers, the tail of the second that arrived after the first one's first live line (53 lines/s on a Pod that writes 10), until the host learned to ask the plugin to
// say where each source's replay ends (replay markers: the plugin counts the lines at the head of each stream, flags them and says when the last is delivered). The Pod is made for the check (`LOGS_BUSY`: two containers, each a
// busybox that writes a backlog at once and then a known number of lines a second, never ending) and its session's strip is read every 250 ms after the Logs command is pressed.
export const LOGS_BUSY = { namespace: 'checkout', name: 'logs-busy', backlog: 3000, perSecond: 5, containers: ['a', 'b'] };

// What the Pod makes, all its containers together: the rate the strip is held to.
export const busyRate = ({ perSecond, containers }) => perSecond * containers.length;

// The lines the session replays at least: the tail of each container, which the plugin's request caps at 1,000 (below the backlog, so the replay is a tail and a rate made of it would be a burst).
export const busyReplayed = ({ containers }) => REPLAYED_AT_LEAST * containers.length;

// A container's script: its backlog at once, then `perSecond` lines a second for ever (a line, then a sleep of the share of a second one line takes).
export function busyScript({ backlog, perSecond }) {
  return `i=0; while [ $i -lt ${String(backlog)} ]; do i=$((i + 1)); echo "backlog $i"; done; while true; do echo live; sleep ${String(1 / perSecond)}; done`;
}

// The Pod as a manifest (`kubectl apply -f`): one container for each of `containers`, the same script in each.
export function busyPod(pod) {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: pod.name, namespace: pod.namespace },
    spec: { restartPolicy: 'Never', containers: pod.containers.map((name) => ({ name, image: 'busybox:1.37.0', command: ['sh', '-c', busyScript(pod)] })) },
  };
}

// What the strip says in place of a rate when none is known: the mock's words for a rate that is absent (cat-msg-c-eventbridge4.js, `EB.none('No rate')`).
export const NO_RATE = 'No rate';

// The strip's text (`1,000 lines · 4.9 lines/s · Following`) -> what it says: how many lines, and the rate as a number, 'none' when it says no rate, or undefined when it says neither (the strip is not on screen yet).
export function readStrip(text) {
  const lines = /^(?:[\d,]+ of )?([\d,]+) lines?/.exec(text);
  const rate = /([\d,.]+) lines\/s/.exec(text);
  return {
    lines: lines === null ? undefined : Number(lines[1].replace(/,/g, '')),
    rate: text.includes(NO_RATE) ? 'none' : rate === null ? undefined : Number(rate[1].replace(/,/g, '')),
  };
}

// The strip is bounded by what the Pod makes: no sample may read above this many times the Pod's rate, and the last SETTLED_SAMPLES must read between these shares of it. The bound is a figure, not a time, so a slow runner
// cannot break it; the counts are of samples, not seconds. The strip must also have counted the replay (REPLAYED_AT_LEAST lines: the plugin's default tail), or a rate made of it would not have shown and the check would be blind.
export const RATE_BOUND_FACTOR = 2;
export const RATE_SETTLED = { low: 0.5, high: 2 };
export const SETTLED_SAMPLES = 8;
export const TELLING_SAMPLES = 24;
export const REPLAYED_AT_LEAST = 1000;

// What the samples of the strip (its text every 250 ms, in order) say is wrong with the rate of a Pod that makes `perSecond` lines a second (all its containers together) and whose session replays `replayed` lines or more: it read
// above the bound at a sample (the replay counted as live), it told a rate in too few samples (no source said its backlog was delivered, or the strip never said so), it did not settle near the Pod's rate, or it never counted the
// replay (a check that compared nothing with nothing).
export function compareRate(texts, { perSecond, replayed = REPLAYED_AT_LEAST }) {
  const problems = [];
  const readings = texts.map(readStrip);
  const lines = Math.max(0, ...readings.map((reading) => reading.lines ?? 0));
  if (lines < replayed) {
    problems.push(`the strip counted ${String(lines)} lines at most, wanted ${String(replayed)} or more: the session did not replay the Pod's backlog, so a rate made of the replay would not show`);
  }

  const bound = RATE_BOUND_FACTOR * perSecond;
  readings.forEach((reading, at) => {
    if (typeof reading.rate === 'number' && reading.rate > bound) {
      problems.push(`sample ${String(at + 1)} of ${String(readings.length)} reads ${String(reading.rate)} lines/s, the Pod writes ${String(perSecond)} a second (the limit is ${String(bound)})`);
    }
  });
  const told = readings.filter((reading) => typeof reading.rate === 'number');
  if (told.length < SETTLED_SAMPLES) {
    problems.push(`the strip told a rate in ${String(told.length)} of ${String(readings.length)} samples, wanted ${String(SETTLED_SAMPLES)} or more: the source did not say its backlog was delivered, or the strip did not say what it was told`);
    return problems;
  }

  const low = RATE_SETTLED.low * perSecond;
  const high = RATE_SETTLED.high * perSecond;
  const off = readings.slice(-SETTLED_SAMPLES).filter((reading) => typeof reading.rate !== 'number' || reading.rate < low || reading.rate > high);
  if (off.length > 0) {
    problems.push(`the last ${String(SETTLED_SAMPLES)} samples read ${JSON.stringify(readings.slice(-SETTLED_SAMPLES).map((reading) => reading.rate))}, wanted every one between ${String(low)} and ${String(high)} lines/s (the Pod writes ${String(perSecond)})`);
  }

  return problems;
}
