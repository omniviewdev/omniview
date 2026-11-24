// Runs the Ports tool's probe in WebKit and Chromium (docs/ui-next/status/PF1.md): the real host's window with NO plugin and a FAKE HOST of port forwards behind the real Ports tool (ports-fixture.tsx), in a production build of the fixture (every
// measurement) and a development build (React's Profiler counts commits there). The sections are in ports.mjs, which has its own header; the probes of CI are ports-a-probe.mjs and its siblings, each of which says which part runs, and a unit of
// negative controls runs this script with NEGATIVE_CONTROL set. Nothing here knows what a section asserts.
//
//   node ui-next/shell/probes/ports-a-probe.mjs        builds the fixture (once for the processes of a shard that share BUILD_CACHE), serves it, probes it in WebKit and Chromium at 1440 x 900 and 1280 x 800
//
//   FIXTURE_DIST=<dir> FIXTURE_DIST_DEV=<dir>   probe existing builds      ENGINES=webkit,chromium      VIEWPORTS=1440x900,1280x800      SECTIONS=geometry,states      REPORT=<file>   the report as JSON
//   PART=<a..>                run the sections of one part (the wrappers set it): every section is in one part and only one, and this refuses to start when it is not
//   NEGATIVE_CONTROL=<name>   perturb the page so ONE assertion must fail, in the section it belongs to, at EVERY viewport the control runs at (and in every engine it names); "detected" and exit 0 when only that assertion failed and it failed
//                             everywhere, "NOT DETECTED", "failed another assertion" or a list of the places where it did not fail, and exit 1, when not
//   NEGATIVE_CONTROL=all      every control twice, in a run of its own each: with its assertion, and with the assertion removed
//   ASSERTION_OFF=<regex>     drops the failures whose name matches, as if the assertion were not there: the control of it must then print NOT DETECTED (the proof that it trips that assertion and no other)
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedBuild } from '../../../packages/kit/probes/build-cache.mjs';
import { ENGINES, launch } from '../../../packages/kit/probes/probe-lib.mjs';
import { serve } from '../../../packages/kit/probes/serve.mjs';
import { AXE } from './harness.mjs';
import { createPortsSections, PORTS_CONTROLS, PORTS_DEVELOPMENT, PORTS_PARTS } from './ports.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const VIEWPORTS = Object.fromEntries((process.env.VIEWPORTS ?? '1440x900,1280x800').split(',').map((vp) => [vp, { width: Number(vp.split('x')[0]), height: Number(vp.split('x')[1]) }]));
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
const OFF = process.env.ASSERTION_OFF === undefined ? undefined : new RegExp(process.env.ASSERTION_OFF);
/** The part of the probe to run: the sections of one of the units of CI, or all of them. */
const PART = process.env.PART ?? '';
if (CONTROL !== '' && CONTROL !== 'all' && PORTS_CONTROLS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be all or one of ${Object.keys(PORTS_CONTROLS).join(', ')}`);

function build(mode) {
  const existing = mode === 'development' ? process.env.FIXTURE_DIST_DEV : process.env.FIXTURE_DIST;
  if (existing !== undefined && existing !== '') return existing;
  // React's development build is chosen by NODE_ENV, which `vite build` sets to production unless it is set. BUILD_CACHE (the shard runner sets it) shares the build with every process of a shard, the controls' included: the build is
  // given an environment without the control the process runs, so that no control can reach it, and every control plants its fault in the loaded page or in what the fixture reads of its address.
  return sharedBuild({ kind: 'ports-fixture', mode, build: (out, env) => execFileSync('node', [path.join(here, 'ports-build.mjs'), out, mode], { cwd: repo, env: { ...env, OMNIVIEW_UI: 'next', NODE_ENV: mode }, stdio: 'pipe' }) });
}

// NEGATIVE_CONTROL=all runs every control twice, in a run of its own: with its assertion (it must be detected by that assertion and no other) and with the assertion removed (ASSERTION_OFF: it must pass undetected, the proof that
// the control trips that assertion and nothing else). The fixtures are built once.
if (CONTROL === 'all') {
  const production = build('production');
  const development = build('development');
  const me = fileURLToPath(import.meta.url);
  // A child is given the environment of this run less ASSERTION_OFF: the first of each pair runs with its assertion on, whatever the caller set, and the second turns off exactly that assertion and no other.
  const inherited = { ...process.env };
  delete inherited.ASSERTION_OFF;
  let wrong = 0;
  for (const [name, control] of Object.entries(PORTS_CONTROLS)) {
    const run = (extra) => spawnSync(process.execPath, [me], { env: { ...inherited, FIXTURE_DIST: production, FIXTURE_DIST_DEV: development, NEGATIVE_CONTROL: name, ...extra }, encoding: 'utf8' });
    const withIt = run({});
    const without = run({ ASSERTION_OFF: `^${control.assertion.replaceAll('.', '\\.')}$` });
    const detected = withIt.status === 0 && /detected by/.test(withIt.stdout);
    const undetected = without.status === 1 && /NOT DETECTED/.test(without.stderr);
    if (!detected || !undetected) wrong += 1;
    console.log(`${name}: ${detected ? `detected by ${control.assertion}` : `NOT AS EXPECTED: ${(withIt.stdout + withIt.stderr).split('\n').filter((line) => /NEGATIVE/.test(line))[0] ?? 'no verdict'}`}; assertion removed: ${undetected ? 'passes undetected, as it must' : `NOT AS EXPECTED: ${(without.stdout + without.stderr).split('\n').filter((line) => /NEGATIVE/.test(line))[0] ?? 'no verdict'}`}`);
  }

  process.exit(wrong === 0 ? 0 : 1);
}

/** The longest a section may take at one size in one engine: the slowest takes about 10 s. */
const SECTION_LIMIT_MS = 150_000;
const failures = [];
/** Where the assertion a control is named for failed (`<engine> <viewport>`): the control must trip it at every one of the places it runs at. */
const detectedAt = new Set();
/** The engine and the viewport of the section that is running, for `detectedAt`. */
let at = '';
/** The run a call belongs to: each section runs under a token of its own (`running.run`), which is taken back when the section ends or times out. */
const running = new AsyncLocalStorage();
/**
 * Whether what is calling may still write: not once its section has timed out or ended. What is left of a section that timed out goes on in the pages that were closed under it, where every wait says false, and its checks would then fail
 * for that and for nothing the page did, into the results of the sections that run after it.
 */
const live = () => running.getStore()?.live !== false;
const report = {
  notes: [],
  numbers: new Proxy(
    {},
    {
      set: (target, key, value) => {
        if (live()) target[key] = value;
        return true;
      },
    },
  ),
};
let checked = 0;
/** A failure of the assertion `name`, unless it is turned off, and the place of it for the control the assertion is named for. */
function record(name, detail) {
  if (OFF !== undefined && OFF.test(name)) return;
  failures.push(`${name}: ${detail}`);
  if (CONTROL !== '' && name === PORTS_CONTROLS[CONTROL]?.assertion) detectedAt.add(at);
}

function check(name, ok, detail) {
  if (!live()) return;
  checked += 1;
  if (!ok) record(name, detail);
}

const note = (text) => {
  if (!live()) return;
  report.notes.push(text);
  console.log(text);
};
const round = (n) => Math.round(n * 100) / 100;

/** What axe-core finds in the part of the page `selector` names, one line for each rule. The page around the tool is the shell's, whose own findings its probes keep (the panel's handle outside a landmark). */
const runAxe = (page, selector) =>
  page.evaluate(async (context) => {
    const result = await window.axe.run(document.querySelector(context), { resultTypes: ['violations'] });
    return result.violations.map((violation) => `${violation.id} (${String(violation.nodes.length)}): ${violation.nodes[0].target.join(' ')}`);
  }, selector);

const SECTIONS = createPortsSections({ check, note, report, runAxe, axe: AXE });
{
  const named = Object.values(PORTS_PARTS).flat();
  const problems = [
    ...Object.keys(SECTIONS).filter((name) => !named.includes(name)).map((name) => `the section ${name} is in no part`),
    ...named.filter((name, index) => named.indexOf(name) !== index).map((name) => `the section ${name} is in two parts`),
    ...named.filter((name) => SECTIONS[name] === undefined).map((name) => `a part names the section ${name}, which does not exist`),
    ...Object.entries(PORTS_CONTROLS).filter(([, control]) => SECTIONS[control.section] === undefined).map(([name, control]) => `the control ${name} names the section ${control.section}, which does not exist`),
  ];
  if (problems.length > 0) throw new Error(`PORTS_PARTS must hold every section once: ${problems.join('; ')}`);
  if (PART !== '' && PORTS_PARTS[PART] === undefined) throw new Error(`PART must be one of ${Object.keys(PORTS_PARTS).join(', ')} or not set, it is ${JSON.stringify(PART)}`);
}

const wanted = CONTROL === '' ? (process.env.SECTIONS ?? (PART === '' ? Object.keys(SECTIONS) : PORTS_PARTS[PART]).join(',')).split(',') : [PORTS_CONTROLS[CONTROL].section];
const t0 = Date.now();
const dist = build('production');
const devDist = wanted.some((name) => PORTS_DEVELOPMENT.includes(name)) ? build('development') : undefined;
const prod = await serve(dist);
const dev = devDist === undefined ? undefined : await serve(devDist);
const origin = prod.url.replace(/\/$/, '');
const devOrigin = dev?.url.replace(/\/$/, '');
const seconds = {};
try {
  for (const engine of engineNames) {
    if (CONTROL !== '' && (PORTS_CONTROLS[CONTROL].engines ?? ['chromium']).includes(engine) === false) continue;
    let browser = await launch(engine);
    try {
      for (const [vp, viewport] of Object.entries(VIEWPORTS)) {
        for (const name of wanted) {
          const started = Date.now();
          at = `${engine} ${vp}`;
          const token = { live: true };
          let timer;
          let expire;
          // A section waits for conditions, each with a limit of its own: this is the limit of the section, so that a page that stops answering ends in a failure that names the section and not in a job that never ends. A section that knows it is
          // about to wait for longer than it may (the plant of a control) starts the limit again from now with `limit`.
          const limit = (ms) => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              expire(Object.assign(new Error(`the section took more than ${String(ms / 1000)} s`), { timedOut: true }));
            }, ms);
          };

          const expired = new Promise((_, reject) => {
            expire = reject;
            limit(SECTION_LIMIT_MS);
          });
          try {
            await Promise.race([running.run(token, () => SECTIONS[name]({ browser, origin, devOrigin, dist, viewport, vp, engine, limit, control: CONTROL === '' ? undefined : PORTS_CONTROLS[CONTROL] })), expired]);
          } catch (error) {
            // From here on nothing the section does is recorded, and it is not given the time to do it: its waits say false once its pages go.
            token.live = false;
            record(`${name}.error`, `${engine} ${vp}: ${String(error?.message ?? error).split('\n').slice(0, 4).join(' | ').slice(0, 600)}`);
            // The section that timed out is still running, in this browser, and would go on to measure while the next section runs: the browser is closed, which ends every page of it and so the section, and a new one is launched for the sections
            // that follow.
            if (error?.timedOut === true) {
              await browser.close().catch(() => undefined);
              browser = await launch(engine);
            }
          } finally {
            token.live = false;
            clearTimeout(timer);
          }

          seconds[`${name} ${engine} ${vp}`] = (Date.now() - started) / 1000;
        }
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
} finally {
  prod.server.close();
  dev?.server.close();
}

report.seconds = seconds;
report.totalSeconds = (Date.now() - t0) / 1000;
if (process.env.REPORT !== undefined) writeFileSync(process.env.REPORT, JSON.stringify({ ...report, failures }, null, 1));
console.log(`probe took ${String(round(report.totalSeconds))} s (load ${os.loadavg()[0].toFixed(1)})`);
if (CONTROL === '') {
  if (checked === 0 && failures.length === 0) {
    console.error(`FAIL: no assertion ran: SECTIONS=${wanted.join(',')} at ${Object.keys(VIEWPORTS).join(',')} selects nothing`);
    process.exitCode = 1;
  } else if (failures.length > 0) {
    console.error(`FAIL:\n${failures.map((line) => `  ${line}`).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS (${String(checked)} assertions)`);
  }
} else {
  const control = PORTS_CONTROLS[CONTROL];
  const named = control.assertion;
  const own = failures.filter((line) => line.startsWith(`${named}:`));
  const others = failures.filter((line) => !line.startsWith(`${named}:`));
  // The control runs in each engine it names at each viewport, and its assertion must fail at every one of those places: a fault that is seen at one size and missed at the other is a control that proves nothing about the second.
  const places = engineNames.filter((engine) => (control.engines ?? ['chromium']).includes(engine)).flatMap((engine) => Object.keys(VIEWPORTS).map((vp) => `${engine} ${vp}`));
  const missed = places.filter((place) => !detectedAt.has(place));
  if (places.length === 0) {
    // Not a run that did not detect: no section ran at all (the control runs in engines that ENGINES leaves out), which is the same silence as an assertion that is off and must not be taken for it.
    console.error(`NEGATIVE CONTROL "${CONTROL}": CONFIGURATION ERROR: it runs in ${(control.engines ?? ['chromium']).join(', ')} and ENGINES is ${engineNames.join(', ')}, so no section ran`);
    process.exitCode = 2;
  } else if (own.length > 0 && others.length === 0 && missed.length === 0) {
    console.log(`NEGATIVE CONTROL "${CONTROL}": detected by ${named}: ${own[0].slice(0, 200)}`);
  } else if (own.length > 0 && others.length === 0) {
    console.error(`NEGATIVE CONTROL "${CONTROL}": ${named} failed at ${[...detectedAt].join(', ')} and did NOT fail at ${missed.join(', ')}`);
    process.exitCode = 1;
  } else if (own.length === 0 && others.length === 0) {
    console.error(`NEGATIVE CONTROL "${CONTROL}": NOT DETECTED (${named} did not fail)`);
    process.exitCode = 1;
  } else {
    console.error(`NEGATIVE CONTROL "${CONTROL}": failed ${others.length > 0 ? `another assertion: ${others.map((line) => line.slice(0, 260)).join(' | ').slice(0, 900)}` : 'nothing it is named for'}`);
    process.exitCode = 1;
  }
}
