// Negative controls for the Operations fixes of PT1 (activity feed error, `unavailable`, `running`, the mock's `ago`, the per-failure read deadline): each control is a FAULT written into one source file, and the tests named for it must go red.
// The fault is made in memory by a Vite transform that runs before the React plugin, in a copy of the repository's own vitest config: no file of the tree is touched, so another agent running a test beside this never sees it, and the
// transformed-module cache of the tree is not read or written (a mutated module cached under the original's key would poison the next real run). A control whose text is not found in its file is reported as NOT APPLIED, never as caught.
//
// Run from the worktree root:  node docs/ui-next/status/PT1/controls-fix-operations.mjs [name-filter]
// Output, one line per control:  CAUGHT <name>: <n> failing | trips: <the test it is named for> | first: <the first test that went red>   |   OTHER (caught, but not by the test it is named for)   |   SURVIVED   |   NOT APPLIED
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const filter = process.argv[2];
const PANEL = 'ui-next/shell/panel';
const FEED = `${PANEL}/activity.ts`;
const MODEL = `${PANEL}/operations/model.ts`;
const BODY = `${PANEL}/operations/OperationsBody.tsx`;
const AGO = `${PANEL}/operations/ago.ts`;
const TOOL = `${PANEL}/operations/tool.ts`;
const T_FEED = [`${PANEL}/activity.test.ts`];
const T_MODEL = [`${PANEL}/operations/model.test.ts`];
const T_BODY = [`${PANEL}/operations/OperationsBody.test.tsx`];
const T_AGO = [`${PANEL}/operations/ago.test.ts`, `${PANEL}/operations/OperationsBody.test.tsx`];
const T_TOOL = [`${PANEL}/operations/tool.test.ts`, `${PANEL}/operations/OperationsBody.test.tsx`];

/** name, the file the fault is in, the text it replaces (the first occurrence), what it becomes, and the test files that must catch it. */
const CONTROLS = [
  // The feed carries the provider's failure.
  { name: 'feed-error-never-held', file: FEED, find: 'getError: () => failure,', replace: 'getError: () => undefined,', tests: T_FEED },
  { name: 'feed-error-not-cleared', file: FEED, find: '      failure = error;', replace: '      failure = error ?? failure;', tests: T_FEED },
  { name: 'feed-error-change-silent', file: FEED, find: 'if (next === records && error === failure) {', replace: 'if (next === records) {', tests: T_FEED },
  { name: 'feed-always-notifies', file: FEED, find: 'if (next === records && error === failure) {', replace: 'if (false) {', tests: T_FEED },
  // The model says it (`unavailable`) and says whether a failed cancel is still running (`running`).
  { name: 'unavailable-never-set', file: MODEL, find: 'unavailable: failure };', replace: 'unavailable: undefined };', tests: T_MODEL },
  { name: 'model-ignores-error-change', file: MODEL, find: 'if (records !== held || error !== failure) {', replace: 'if (records !== held) {', tests: T_MODEL },
  { name: 'snapshot-ignores-error', file: MODEL, find: ' && failure === previous.unavailable) {', replace: ') {', tests: T_MODEL },
  { name: 'running-always-true', file: MODEL, find: 'running: entries.get(id)?.row.active ?? false,', replace: 'running: true,', tests: T_MODEL },
  { name: 'running-true-for-a-gone-row', file: MODEL, find: 'running: entries.get(id)?.row.active ?? false,', replace: 'running: entries.get(id)?.row.active ?? true,', tests: T_MODEL },
  { name: 'running-always-false', file: MODEL, find: 'running: entries.get(id)?.row.active ?? false,', replace: 'running: false,', tests: T_MODEL },
  // The body says it, in place of "No operations" and never over the rows it holds.
  { name: 'unavailable-ignored', file: BODY, find: 'return unavailable === undefined ? (', replace: 'return true ? (', tests: T_BODY },
  { name: 'unavailable-hides-rows', file: BODY, find: 'if (rows.length === 0) {', replace: 'if (rows.length === 0 || unavailable !== undefined) {', tests: T_BODY },
  {
    name: 'unavailable-is-a-status',
    file: BODY,
    find: '<ErrorBody title={OPERATIONS_UNAVAILABLE.title} message={unavailable} />',
    replace: '<PanelEmpty icon={OPERATIONS_ICON} title={OPERATIONS_UNAVAILABLE.title} hint={unavailable} />',
    tests: T_BODY,
  },
  { name: 'unavailable-sentence-dropped', file: BODY, find: 'message={unavailable} />', replace: 'message={undefined} />', tests: T_BODY },
  { name: 'unavailable-title-words', file: TOOL, find: 't read operations', replace: 't load operations', tests: T_TOOL },
  // The Started words are the mock's.
  { name: 'ago-no-nan-guard', file: AGO, find: 'if (!Number.isFinite(time)) {', replace: 'if (false) {', tests: T_AGO },
  { name: 'ago-just-now-until-60-seconds', file: AGO, find: 'if (seconds < 45) {', replace: 'if (seconds < 60) {', tests: T_AGO },
  { name: 'ago-seconds-floor', file: AGO, find: 'Math.round((now - time) / SECOND)', replace: 'Math.floor((now - time) / SECOND)', tests: T_AGO },
  { name: 'ago-minutes-floor', file: AGO, find: 'const minutes = Math.round(seconds / 60);', replace: 'const minutes = Math.floor(seconds / 60);', tests: T_AGO },
  { name: 'ago-hours-floor', file: AGO, find: 'const hours = Math.round(minutes / 60);', replace: 'const hours = Math.floor(minutes / 60);', tests: T_AGO },
  { name: 'ago-days-floor', file: AGO, find: 'const days = Math.round(hours / 24);', replace: 'const days = Math.floor(hours / 24);', tests: T_AGO },
  { name: 'ago-hours-from-seconds', file: AGO, find: 'const hours = Math.round(minutes / 60);', replace: 'const hours = Math.round(seconds / 3600);', tests: T_AGO },
  { name: 'ago-days-from-seconds', file: AGO, find: 'const days = Math.round(hours / 24);', replace: 'const days = Math.round(seconds / 86_400);', tests: T_AGO },
  { name: 'ago-changes-at-whole-second', file: AGO, find: 'changesAt: time + until * SECOND - SECOND / 2', replace: 'changesAt: time + until * SECOND', tests: T_AGO },
  { name: 'ago-minute-ends-early', file: AGO, find: '60 * minutes + 30)', replace: '60 * minutes)', tests: T_AGO },
  { name: 'ago-hour-ends-late', file: AGO, find: '3600 * hours + 1770', replace: '3600 * hours + 1800', tests: T_AGO },
  { name: 'ago-day-ends-late', file: AGO, find: '86_400 * days + 41_370', replace: '86_400 * days + 43_200', tests: T_AGO },
  { name: 'ago-hour-words', file: AGO, find: '${String(hours)} h ago', replace: '${String(hours)} hr ago', tests: T_AGO },
  { name: 'stamp-has-seconds', file: AGO, find: '.slice(0, 16)', replace: '.slice(0, 19)', tests: T_AGO },
  { name: 'stamp-no-nan-guard', file: AGO, find: "Number.isNaN(instant.getTime()) ? ''", replace: "false ? ''", tests: T_AGO },
  {
    name: 'stamp-local-time',
    file: AGO,
    find: '`${instant.toISOString()',
    replace: '`${new Date(at - instant.getTimezoneOffset() * 60_000).toISOString()',
    tests: T_AGO,
    // A machine already in UTC cannot tell: the control runs where the day is not the same.
    env: { TZ: 'Pacific/Kiritimati' },
  },
  { name: 'started-without-tip', file: BODY, find: '{...tip(stampOf(at))}', replace: '', tests: T_AGO },
  { name: 'started-tip-has-words', file: BODY, find: '{...tip(stampOf(at))}', replace: '{...tip(`${stampOf(at)} · ${words}`)}', tests: T_AGO },
  // Each failure keeps its own second.
  { name: 'read-after-999ms', file: BODY, find: 'const READ_AFTER_MS = 1000;', replace: 'const READ_AFTER_MS = 999;', tests: T_BODY },
  {
    name: 'read-restarts-everyone',
    file: BODY,
    find: 'const fresh = ids.filter((id) => !listed.current.has(id));',
    replace: 'for (const stale of timers.current) { clearTimeout(stale); } timers.current.clear(); listed.current.clear(); const fresh = ids;',
    tests: T_BODY,
  },
  { name: 'read-asks-twice', file: BODY, find: 'void operations.markRead(due);', replace: 'void operations.markRead(due); for (const id of due) { listed.current.delete(id); }', tests: T_BODY },
  { name: 'read-ignores-leave-and-return', file: BODY, find: 'const due = listing.ids.filter((id) => listed.current.get(id) === listing);', replace: 'const due = listing.ids;', tests: T_BODY },
  { name: 'read-never-forgets-an-id', file: BODY, find: 'if (!unreadNow.has(id)) {', replace: 'if (false) {', tests: T_BODY },
  { name: 'read-timers-survive-leaving', file: BODY, find: 'for (const timer of timers.current) {', replace: 'for (const timer of []) {', tests: T_BODY },
  { name: 'read-one-listing-keeps-only-the-last-timer', file: BODY, find: 'timers.current.add(timer);', replace: 'timers.current.clear(); timers.current.add(timer);', tests: T_BODY },
];

/** The assertion each control is named for: a part of the title of a test that must be among the ones that go red. A control that is caught only by other tests is caught for another reason, and proves nothing about its own. */
const NAMED = {
  'feed-error-never-held': 'holds the sentence a push carries',
  'feed-error-not-cleared': 'has no error again when a push carries none',
  'feed-error-change-silent': 'tells its listeners when only the error changes',
  'feed-always-notifies': 'for no push of the one it has',
  'unavailable-never-set': 'is the feed\'s sentence, with no row, when the first read failed',
  'model-ignores-error-change': 'tells its listeners once for a change of the error alone',
  'snapshot-ignores-error': 'tells its listeners once for a change of the error alone',
  'running-always-true': 'tells the host the work is not running when the task was',
  'running-true-for-a-gone-row': 'when the task is gone from the feed before the answer comes',
  'running-always-false': 'tells the host the work is still running when the task is',
  'unavailable-ignored': 'says so in place of "No operations"',
  'unavailable-hides-rows': 'keeps the rows listed when the service fails after it worked',
  'unavailable-is-a-status': 'says so in place of "No operations"',
  'unavailable-sentence-dropped': 'says so in place of "No operations"',
  'unavailable-title-words': 'says in the host\'s words that the service could not be read',
  'ago-no-nan-guard': 'says nothing for a date that is not a date',
  'ago-just-now-until-60-seconds': 'a start 44500 ms ago reads 1 min ago',
  'ago-seconds-floor': 'with the clock 500 ms into the second',
  'ago-minutes-floor': 'a start 1060000 ms ago reads 18 min ago',
  'ago-hours-floor': 'a start 5370000 ms ago reads 2 h ago',
  'ago-days-floor': 'a start 127770000 ms ago reads 2 d ago',
  'ago-hours-from-seconds': 'a start 5370000 ms ago reads 2 h ago',
  'ago-days-from-seconds': 'a start 127770000 ms ago reads 2 d ago',
  'ago-changes-at-whole-second': 'with the clock 0 ms after the start, the next words begin at 44500 ms',
  'ago-minute-ends-early': 'with the clock 44500 ms after the start, the next words begin at 89500 ms',
  'ago-hour-ends-late': 'with the clock 3569500 ms after the start, the next words begin at 5369500 ms',
  'ago-day-ends-late': 'with the clock 84569500 ms after the start, the next words begin at 127769500 ms',
  'ago-hour-words': 'a start 3570000 ms ago reads 1 h ago',
  'stamp-has-seconds': 'is the instant in UTC to the minute',
  'stamp-no-nan-guard': 'is nothing for a time that is not a time',
  'stamp-local-time': 'is UTC whatever the time zone of the machine is',
  'started-without-tip': 'and the absolute stamp in UTC as its tip',
  'started-tip-has-words': 'and the absolute stamp in UTC as its tip',
  'read-after-999ms': 'marks the unread ones when the tool has been on screen for a second, and not before',
  'read-restarts-everyone': 'keeps the second of each failure from when the tool listed it',
  'read-asks-twice': 'asks for an id once while it stays unread',
  'read-ignores-leave-and-return': 'begins a new second for an id that was read from another window',
  'read-never-forgets-an-id': 'begins a new second for an id that was read from another window',
  'read-timers-survive-leaving': 'leaves no timer behind',
  'read-one-listing-keeps-only-the-last-timer': 'leaves no timer behind',
};

const dir = mkdtempSync(path.join(tmpdir(), 'ops-controls-'));
const config = path.join(dir, 'config.mjs');
writeFileSync(
  config,
  `import base from ${JSON.stringify(path.join(root, 'vite.config.ts'))};
import { appendFileSync } from 'node:fs';
import path from 'node:path';
const spec = JSON.parse(process.env.CONTROL_SPEC ?? 'null');
const mutate = {
  name: 'ops-control',
  enforce: 'pre',
  transform(code, id) {
    if (spec === null || id.split('?')[0] !== path.join(${JSON.stringify(root)}, spec.file)) return null;
    if (!code.includes(spec.find)) { appendFileSync(process.env.CONTROL_LOG, 'NOT APPLIED\\n'); return null; }
    appendFileSync(process.env.CONTROL_LOG, 'APPLIED\\n');
    return { code: code.replace(spec.find, () => spec.replace), map: null };
  },
};
export default { ...base, cacheDir: process.env.CONTROL_CACHE, test: { ...base.test, fsModuleCachePath: process.env.CONTROL_CACHE + '/modules' }, plugins: [mutate, ...(base.plugins ?? [])] };
`,
);

/** One run of vitest on `tests`, with `spec` (or none) applied: how many tests failed, which, and whether the fault was written. */
function run(spec, tests, env) {
  // A cache of its own for every run: a module cached by an earlier run is served without asking the plugin, so no fault would be written (the first version of this script reported every control as NOT APPLIED for that reason).
  const cache = mkdtempSync(path.join(dir, 'cache-'));
  const log = path.join(dir, 'applied.log');
  const out = path.join(dir, 'out.json');
  writeFileSync(log, '');
  const result = spawnSync('pnpm', ['exec', 'vitest', 'run', '--root', root, '--config', config, '--reporter=json', `--outputFile=${out}`, ...tests], {
    cwd: root,
    env: { ...process.env, ...env, CONTROL_SPEC: JSON.stringify(spec ?? null), CONTROL_CACHE: cache, CONTROL_LOG: log },
    encoding: 'utf8',
  });
  let json;
  try {
    json = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    throw new Error(`vitest wrote no report (exit ${String(result.status)}):\n${result.stderr}`);
  }

  const failed = json.testResults.flatMap((file) => file.assertionResults.filter((test) => test.status === 'failed').map((test) => test.fullName));
  const wrote = readFileSync(log, 'utf8');
  return { failed, passed: json.numPassedTests, applied: spec === undefined ? true : wrote.includes('APPLIED') && !wrote.includes('NOT APPLIED'), unrunnable: json.numFailedTestSuites > 0 && json.numFailedTests === 0 };
}

let bad = 0;
try {
  const all = [...new Set(CONTROLS.flatMap((control) => control.tests))];
  const baseline = run(undefined, all, {});
  console.log(`baseline: ${String(baseline.passed)} passed, ${String(baseline.failed.length)} failing (must be 0)`);
  if (baseline.failed.length > 0) {
    throw new Error(`the baseline is red: ${baseline.failed.join('; ')}`);
  }

  for (const control of CONTROLS.filter((candidate) => filter === undefined || candidate.name.includes(filter))) {
    const result = run(control, control.tests, control.env ?? {});
    if (!result.applied) {
      bad += 1;
      console.log(`NOT APPLIED ${control.name}: the text is not in ${control.file}`);
    } else if (result.unrunnable) {
      bad += 1;
      console.log(`UNRUNNABLE  ${control.name}: a suite failed to run, which is not a catch`);
    } else if (result.failed.length === 0) {
      bad += 1;
      console.log(`SURVIVED    ${control.name}: nothing noticed`);
    } else if (NAMED[control.name] !== undefined && !result.failed.some((name) => name.includes(NAMED[control.name]))) {
      bad += 1;
      console.log(`OTHER       ${control.name}: caught by ${String(result.failed.length)} tests, none of them its own ("${NAMED[control.name]}"); first: × ${result.failed[0]}`);
    } else {
      console.log(`CAUGHT   ${control.name}: ${String(result.failed.length)} failing | trips: "${NAMED[control.name] ?? ''}" | first: × ${result.failed[0]}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exitCode = bad === 0 ? 0 : 1;
