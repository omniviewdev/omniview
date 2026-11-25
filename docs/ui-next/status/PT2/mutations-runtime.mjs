// Negative controls for the runtime's `ActivityProvider` and the host screen's `ActivityTap` (PT2, item 2): each control is a FAULT written into one source file in memory, and the test it is named for must go red, by its own
// assertion. Each also has its ASSERTION_OFF pair: the same fault, with that ONE assertion deleted from the test file (in memory too, the line blanked so no other line moves), must leave the named test green. A fault that stays
// caught after its assertion is gone is caught twice over (reported, not a failure); one that does not go red at all, or only in a test it is not named for, is.
//
// The fault is made by a Vite transform that runs before the React plugin, in a copy of the repository's own vitest config (the pattern of `docs/ui-next/status/PT1/controls-fix-operations.mjs`): no file of the tree is touched, so
// another agent running a test beside this never sees it, and every run has a transformed-module cache of its own (a module cached by an earlier run is served without asking the plugin). A control whose text is not found exactly
// once in its file is reported as NOT APPLIED, never as caught.
//
// Run from the worktree root (after `pnpm --filter @omniviewdev/runtime run build`, which the tap's test reads):  node docs/ui-next/status/PT2/mutations-runtime.mjs [name-filter]
// Output, one line per control:  CAUGHT <name> | trips: <test> at <file>:<line> | also red: <n> | OFF: undetected|STILL RED at <line>   |   OTHER (red, but not in the test it is named for)   |   SURVIVED   |   NOT APPLIED
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = process.cwd();
const filter = process.argv[2];

const PROVIDER = {
  source: 'packages/omniviewdev-runtime/src/activity/ActivityProvider.tsx',
  test: 'packages/omniviewdev-runtime/src/activity/ActivityProvider.test.tsx',
  project: 'packages/omniviewdev-runtime',
  // What CI runs for the package ("Runtime contract regressions"): its own config, loaded by the runner.
  flags: ['--configLoader', 'runner'],
};
const TAP = {
  source: 'ui-next/plugins/host/PluginHostScreen.tsx',
  test: 'ui-next/plugins/host/PluginHostScreen.activity.test.tsx',
  project: '.',
  flags: [],
};

const T = {
  heartbeatFails: 'is unavailable from a heartbeat that failed while the subscription is made again',
  subscriptionFails: 'is unavailable from a subscription that failed, and its sentence is the error',
  heartbeatRecovers: 'is available again when a heartbeat gets through and the subscription is made again',
  noSpuriousResubscribe: 'does not subscribe again for a heartbeat that gets through while the subscription holds',
  eventClears: 'shows the host\'s observation-error event in `error` and not in `unavailable`',
  eventBeforeBeat: 'keeps an event that came while a heartbeat was in flight',
  eventBeforeSubscription: 'keeps an event that came while the subscription was being made again',
  subscriptionClearsEvent: 'takes an event away with a subscription that is made after it',
  notify: 'shows a failed `notify` in `error` and not in `unavailable`',
  details: 'shows a failed `openDetails` in `error` and not in `unavailable`',
  independent: 'does not take a failed `notify` or a failed `openDetails` away with a heartbeat or a subscription that succeeds',
  precedence: 'says the first of the failures it holds',
  unmount: 'leaves nothing behind when it unmounts',
  afterUnmount: 'does not recover a heartbeat that gets through after it unmounted',
  tapNotice: 'raises no row in Problems and wakes no tool',
  tapFollows: 'follows `unavailable` when it comes and when it clears',
  tapHolds: 'is the provider\'s `unavailable` when the observation failed',
};

const ERROR = 'const error = observationError ?? unavailable ?? notifyError ?? detailsError;';
const RELEASE = "        } else if (told === heard) {\n          setObservationError(undefined);\n        }";
const ATTACHED = "          feed = 'attached';\n          setUnavailable(undefined);\n";
const RECOVER = "        if (failure !== undefined || feed === 'failed') await connect();";
const NOTIFIED = '        setNotifyError(undefined);\n        return record;';
const TAP_PUSH = 'control.push(records, unavailable);';
const TAP_READ = 'const { records, unavailable } = useActivities();';
const TAP_DEPS = '}, [control, records, unavailable]);';

/** name, the target, its edits (each: the text, found exactly once, and what it becomes) and the test the control is named for (a part of its full title). */
const CONTROLS = [
  // `unavailable`: the observation's own failure.
  { name: 'subscription-success-keeps-unavailable', target: PROVIDER, edits: [[ATTACHED, "          feed = 'attached';\n"]], named: T.heartbeatFails },
  { name: 'heartbeat-failure-not-unavailable', target: PROVIDER, edits: [['          setUnavailable(failure);\n', '          void failure;\n']], named: T.heartbeatFails },
  { name: 'subscription-failure-not-unavailable', target: PROVIDER, edits: [["          feed = 'failed';\n          setUnavailable(parseAppError(cause).detail);", "          feed = 'failed';\n          void parseAppError(cause);"]], named: T.subscriptionFails },
  { name: 'failed-heartbeat-no-resubscribe', target: PROVIDER, edits: [[RECOVER, "        if (feed === 'failed') await connect();"]], named: T.heartbeatFails },
  { name: 'heartbeat-through-no-resubscribe', target: PROVIDER, edits: [[RECOVER, '        if (failure !== undefined) await connect();']], named: T.heartbeatRecovers },
  { name: 'heartbeat-always-resubscribes', target: PROVIDER, edits: [[RECOVER, "        if (failure !== undefined || feed !== 'attaching') await connect();"]], named: T.noSpuriousResubscribe },
  // The observation-error event: `error` only, until the next heartbeat or subscription that began after it.
  { name: 'event-never-cleared-by-heartbeat', target: PROVIDER, edits: [[RELEASE, '        }']], named: T.eventClears },
  { name: 'heartbeat-clears-an-event-it-did-not-see', target: PROVIDER, edits: [['        } else if (told === heard) {', '        } else {']], named: T.eventBeforeBeat },
  { name: 'subscription-clears-an-event-it-did-not-see', target: PROVIDER, edits: [['          if (told === heard) setObservationError(undefined);', '          setObservationError(undefined);']], named: T.eventBeforeSubscription },
  { name: 'subscription-never-clears-the-event', target: PROVIDER, edits: [['          if (told === heard) setObservationError(undefined);\n', '']], named: T.subscriptionClearsEvent },
  // The calls: `notify` and `openDetails`, each cleared by its own success only.
  { name: 'notify-failure-is-unavailable', target: PROVIDER, edits: [['        setNotifyError(parseAppError(cause).detail);', '        setUnavailable(parseAppError(cause).detail);']], named: T.notify },
  { name: 'notify-success-keeps-the-failure', target: PROVIDER, edits: [[NOTIFIED, '        return record;']], named: T.notify },
  { name: 'details-success-keeps-the-failure', target: PROVIDER, edits: [['          setDetailsError(undefined);\n', '']], named: T.details },
  { name: 'details-failure-held-as-notify', target: PROVIDER, edits: [['.catch((cause) => setDetailsError(parseAppError(cause).detail));', '.catch((cause) => setNotifyError(parseAppError(cause).detail));']], named: T.independent },
  { name: 'heartbeat-clears-the-calls', target: PROVIDER, edits: [[RELEASE, "        } else if (told === heard) {\n          setObservationError(undefined);\n          setNotifyError(undefined);\n          setDetailsError(undefined);\n        }"]], named: T.independent },
  { name: 'subscription-clears-the-calls', target: PROVIDER, edits: [[ATTACHED, `${ATTACHED}          setNotifyError(undefined);\n          setDetailsError(undefined);\n`]], named: T.independent },
  { name: 'notify-success-clears-details', target: PROVIDER, edits: [[NOTIFIED, '        setNotifyError(undefined);\n        setDetailsError(undefined);\n        return record;']], named: T.independent },
  // The order `error` says them in.
  { name: 'order-unavailable-before-event', target: PROVIDER, edits: [[ERROR, 'const error = unavailable ?? observationError ?? notifyError ?? detailsError;']], named: T.precedence },
  { name: 'order-notify-before-unavailable', target: PROVIDER, edits: [[ERROR, 'const error = observationError ?? notifyError ?? unavailable ?? detailsError;']], named: T.precedence },
  { name: 'order-details-before-notify', target: PROVIDER, edits: [[ERROR, 'const error = observationError ?? unavailable ?? detailsError ?? notifyError;']], named: T.precedence },
  // Nothing is left after unmount.
  { name: 'unmount-keeps-the-interval', target: PROVIDER, edits: [['      clearInterval(timer);\n', '']], named: T.unmount },
  { name: 'unmount-keeps-the-event-listener', target: PROVIDER, edits: [['      stopErrors();\n    };', '    };']], named: T.unmount },
  { name: 'unmount-keeps-the-subscription', target: PROVIDER, edits: [['      observer.abort();\n      stopErrors();', '      stopErrors();']], named: T.unmount },
  { name: 'heartbeat-recovered-after-unmount', target: PROVIDER, edits: [['        if (stopped) return;\n        if (failure !== undefined) {', '        if (failure !== undefined) {']], named: T.afterUnmount },
  // The tap hands the feed the observation's failure and nothing else's.
  { name: 'tap-hands-over-the-error', target: TAP, edits: [[TAP_READ, 'const { records, error } = useActivities();'], [TAP_PUSH, 'control.push(records, error);'], [TAP_DEPS, '}, [control, records, error]);']], named: T.tapNotice },
  { name: 'tap-hands-over-either', target: TAP, edits: [[TAP_READ, 'const { records, unavailable, error } = useActivities();'], [TAP_PUSH, 'control.push(records, unavailable ?? error);'], [TAP_DEPS, '}, [control, records, unavailable, error]);']], named: T.tapNotice },
  { name: 'tap-hands-over-nothing', target: TAP, edits: [[TAP_PUSH, 'control.push(records);']], named: T.tapHolds },
  { name: 'tap-ignores-unavailable-changes', target: TAP, edits: [[TAP_DEPS, '}, [control, records]);']], named: T.tapFollows },
];

const dir = mkdtempSync(path.join(tmpdir(), 'pt2-runtime-controls-'));
const config = (target) => path.join(dir, `${path.basename(target.project === '.' ? 'root' : target.project)}.config.mjs`);
for (const target of [PROVIDER, TAP]) {
  writeFileSync(
    config(target),
    `import base from ${JSON.stringify(path.join(root, target.project, 'vite.config.ts'))};
import { appendFileSync } from 'node:fs';
import path from 'node:path';
const spec = JSON.parse(process.env.CONTROL_SPEC ?? 'null');
const log = (line) => appendFileSync(process.env.CONTROL_LOG, line + '\\n');
const mutate = {
  name: 'pt2-control',
  enforce: 'pre',
  transform(code, id) {
    if (spec === null) return null;
    const file = id.split('?')[0];
    if (file === path.join(${JSON.stringify(root)}, spec.source)) {
      let text = code;
      for (const [find, replace] of spec.edits) {
        const parts = text.split(find);
        if (parts.length !== 2) { log('NOT APPLIED: ' + String(parts.length - 1) + ' occurrences of ' + JSON.stringify(find)); return null; }
        text = parts.join(replace);
      }
      log('APPLIED');
      return { code: text, map: null };
    }
    if (spec.off !== undefined && file === path.join(${JSON.stringify(root)}, spec.test)) {
      const lines = code.split('\\n');
      if (!lines[spec.off - 1].trim().startsWith('expect(')) { log('NOT APPLIED: line ' + String(spec.off) + ' of the test is not an assertion'); return null; }
      lines[spec.off - 1] = '';
      log('OFF');
      return { code: lines.join('\\n'), map: null };
    }
    return null;
  },
};
export default { ...base, cacheDir: process.env.CONTROL_CACHE, test: { ...base.test, fsModuleCachePath: process.env.CONTROL_CACHE + '/modules' }, plugins: [mutate, ...(base.plugins ?? [])] };
`,
  );
}

/** One run of the target's test file, with `spec` (or none) applied: which tests went red and where, and whether the fault (and the removal) was written. */
function run(target, spec) {
  // A cache of its own for every run: a module cached by an earlier run is served without asking the plugin, so no fault would be written.
  const cache = mkdtempSync(path.join(dir, 'cache-'));
  const log = path.join(dir, 'applied.log');
  const out = path.join(dir, 'out.json');
  writeFileSync(log, '');
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', ...target.flags, '--root', path.join(root, target.project), '--config', config(target), '--reporter=json', `--outputFile=${out}`, path.relative(path.join(root, target.project), path.join(root, target.test))],
    {
      cwd: path.join(root, target.project),
      env: { ...process.env, CONTROL_SPEC: JSON.stringify(spec ?? null), CONTROL_CACHE: cache, CONTROL_LOG: log, FORCE_COLOR: '0' },
      encoding: 'utf8',
    },
  );
  let json;
  try {
    json = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    throw new Error(`vitest wrote no report (exit ${String(result.status)}):\n${result.stderr}`);
  }

  const base = path.basename(target.test).replaceAll('.', '\\.');
  const failed = json.testResults.flatMap((file) =>
    file.assertionResults
      .filter((test) => test.status === 'failed')
      .map((test) => ({ name: test.fullName, line: Number(new RegExp(`${base}:(\\d+):\\d+`).exec(test.failureMessages.join('\n'))?.[1] ?? Number.NaN) })),
  );
  const wrote = readFileSync(log, 'utf8');
  return { failed, passed: json.numPassedTests, wrote, applied: spec === undefined || (wrote.includes('APPLIED') && !wrote.includes('NOT APPLIED')), unrunnable: json.numFailedTestSuites > 0 && json.numFailedTests === 0 };
}

let bad = 0;
try {
  for (const target of [PROVIDER, TAP]) {
    const baseline = run(target, undefined);
    console.log(`baseline ${target.test}: ${String(baseline.passed)} passed, ${String(baseline.failed.length)} failing (must be 0)`);
    if (baseline.failed.length > 0) {
      throw new Error(`the baseline is red: ${baseline.failed.map((test) => test.name).join('; ')}`);
    }
  }

  for (const control of CONTROLS.filter((candidate) => filter === undefined || candidate.name.includes(filter))) {
    const spec = { source: control.target.source, test: control.target.test, edits: control.edits };
    const result = run(control.target, spec);
    const trips = result.failed.find((test) => test.name.includes(control.named));
    const also = result.failed.filter((test) => test !== trips).length;
    if (!result.applied) {
      bad += 1;
      console.log(`NOT APPLIED ${control.name}: ${result.wrote.trim()}`);
    } else if (result.unrunnable) {
      bad += 1;
      console.log(`UNRUNNABLE ${control.name}: the test file did not run`);
    } else if (result.failed.length === 0) {
      bad += 1;
      console.log(`SURVIVED ${control.name}: no test went red`);
    } else if (trips === undefined) {
      bad += 1;
      console.log(`OTHER ${control.name}: red in ${result.failed.map((test) => `"${test.name}"`).join(', ')}, not in "${control.named}"`);
    } else {
      // The pair: the same fault, with the assertion it tripped deleted.
      const off = run(control.target, { ...spec, off: trips.line });
      const again = off.failed.find((test) => test.name.includes(control.named));
      if (!off.applied) {
        bad += 1;
        console.log(`NOT APPLIED ${control.name} (ASSERTION_OFF): ${off.wrote.trim()}`);
      } else {
        console.log(`CAUGHT ${control.name} | trips: "${control.named}" at ${path.basename(control.target.test)}:${String(trips.line)} | also red: ${String(also)} | OFF: ${again === undefined ? 'undetected' : `STILL RED at ${String(again.line)}`}`);
      }
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(bad === 0 ? 'every control was caught by the test it is named for' : `${String(bad)} control(s) were not caught by the test they are named for`);
process.exitCode = bad === 0 ? 0 : 1;
