// Probes what the Logs strip says of the rate when a stream OPENS (S1-host, which replaced L4's inference from the lines' times): the host's own Logs session body (`LogSession`: the view, its model, the strip) over a feed that is told by
// its producer, as the runtime's stream is told by a backend that marks replays. The producer replays the source's last 5,000 lines in the first second, every one flagged as replay, says the replay is over BEFORE the
// last 1,500 of those lines were delivered (the host batches lines and sends events at once, so a marker overtakes the lines before it), and then writes 5 lines a second. The feed counts the lines its producer says are live
// (not flagged replay, from a source that has said its replay is over) when it accepts them (`LogFeedStats.live`). The strip's text is read every 250 ms, in the page, from the moment the producer starts, for 8 s. A second page
// per engine shows a source that is NEVER marked (the interim of a plugin that could not count its replay): no word comes, and the strip must say no rate for as long as the page lives. The demo read 7,878 lines/s at open on a source
// that writes 5 and took 8 s to come down (L4); the old inference ended it with the lines' times and a quiet gap, and a replay it could not tell (a second container's tail, a clock that was ahead) was counted again.
//
//   node ui-next/shell/probes/logs-open-probe.mjs      builds the fixture (OMNIVIEW_UI=next) into a temp dir, serves it, probes it, in WebKit and Chromium at 1440 x 900
//
//   FIXTURE_DIST=<dir>        probe an existing build of the fixture         FONT_DELAY_MS=40   as a runner serves fonts      ENGINES=webkit,chromium      REPORT=<file>   the report as JSON
//   NEGATIVE_CONTROL=<name>   perturb the page and run it in Chromium, twice: without the perturbation (the assertion the control is named for must hold) and with it (it must fail); "detected" and exit 0 when it did, "NOT DETECTED"
//                             and exit 1 when it did not. Each perturbation is the fault ONE assertion is there to see:
//                               counted-replay   the feed counts the lines flagged replay as live (a consumer that ignores the flag): the strip reads the burst                      -> rate.max
//                               no-wait          the feed has a count from the start and does not wait for the producer's word (a consumer that takes a source for live before it is told): 0.0 where it should say no rate  -> rate.unknown
//                               timeout-live     the source is never marked and the feed turns live after 3 s (an invented timeout): a figure where it should say no rate, for good                      -> never.unknown
//   ASSERTION_OFF=<regex>     drops the failures whose line matches, as if the assertion that says them were not there: the control's own is removed with it, and the control must then print NOT DETECTED
//
// Assertions (the name starts each line of a failure; samples are on the producer's clock, ms since it started):
//   premise.replay   the strip counted the whole replay (5,000 lines or more), the feed made at least 20 live lines and at least 1,000 lines flagged replay were delivered AFTER the marker: a feed that did nothing, or that spoke after
//                    the replay, would pass every number below
//   rate.unknown     every sample taken before the marker says no rate (the mock's words for a rate that is absent), and there is at least one: the strip does not guess before it is told
//   rate.max         no sample of the strip, from the first, reads above 10 lines/s: twice the 5 the feed writes (the replay is never counted, flagged or not, before the marker or after it)
//   rate.told        a rate near the feed's is on the strip within 6 s
//   rate.settled     from 5 s on, every sample reads between 3.5 and 6.5
//   premise.never    (second page) the strip counted the replay and the feed made at least 15 live lines, and no word came
//   never.unknown    (second page) every sample says no rate, at least 20 of them: nothing turns a source that is never marked live by waiting, and the strip says nothing more than that
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadConfigFromFile, mergeConfig } from 'vite';
import { ENGINES, launch } from '../../../packages/kit/probes/probe-lib.mjs';
import { serve } from '../../../packages/kit/probes/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
// Each control: the page it perturbs, the assertion it is named for, and the failures a perturbed run may have (the named one, and what follows from it).
const CONTROLS = {
  'counted-replay': { marker: 'ahead', named: 'rate.max', allowed: ['rate.max', 'rate.told', 'rate.settled'] },
  'no-wait': { marker: 'ahead', named: 'rate.unknown', allowed: ['rate.unknown'] },
  'timeout-live': { marker: 'never', named: 'never.unknown', allowed: ['never.unknown'] },
};
if (CONTROL !== '' && CONTROLS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be one of ${Object.keys(CONTROLS).join(', ')}`);
const OFF = process.env.ASSERTION_OFF === undefined ? undefined : new RegExp(process.env.ASSERTION_OFF);
const REPLAY = 5000;
const RATE = 5;
const SECONDS = 8;
const NEVER_SECONDS = 6;
const NO_RATE = 'No rate';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The fixture, built with the repository's own Vite configuration, as build-fixture.mjs builds the others (this probe's page is the only entry). */
async function buildFixture() {
  if (process.env.FIXTURE_DIST !== undefined && process.env.FIXTURE_DIST !== '') return process.env.FIXTURE_DIST;
  const outDir = mkdtempSync(path.join(os.tmpdir(), 'logs-open-fixture-'));
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(repo, 'vite.config.ts'));
  if (loaded === null) throw new Error('vite.config.ts not found');
  await build(mergeConfig(loaded.config, { configFile: false, logLevel: 'warn', mode: 'production', build: { outDir, emptyOutDir: true, rollupOptions: { input: [path.join(here, 'logs-open-fixture.html')] } } }));
  return outDir;
}

/** The strip's rate: a number, 'none' when it says no rate, undefined when the strip is not drawn yet or says neither. */
const rateOf = (text) => {
  if (text.includes(NO_RATE)) return 'none';
  const found = /([\d,.]+) lines\/s/.exec(text);
  return found === null ? undefined : Number(found[1].replace(/,/g, ''));
};
const countOf = (text) => {
  const found = /^(?:[\d,]+ of )?([\d,]+) lines?/.exec(text);
  return found === null ? 0 : Number(found[1].replace(/,/g, ''));
};

/** One run of the page in one engine: the series of the strip's text, and what the feed made. */
async function run(origin, engine, marker, control, seconds) {
  const browser = await launch(engine);
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const load = execFileSync('uptime', { encoding: 'utf8' }).trim().replace(/^.*load averages?: /, '');
    await page.goto(`${origin}/shell/probes/logs-open-fixture.html?marker=${marker}${control === '' ? '' : `&control=${control}`}`, { waitUntil: 'load' });
    await sleep(600 + seconds * 1000 + 500);
    const { series, made } = await page.evaluate(() => ({ series: window.__series, made: window.__feed.made }));
    return { series, made, errors, load, marker, seconds };
  } finally {
    await browser.close();
  }
}

/** The failures of one run, by assertion name. */
function judge(engine, { series, made, errors, marker }) {
  const out = [];
  const fail = (name, text) => {
    const line = `${name} [${engine}]: ${text}`;
    if (OFF === undefined || !OFF.test(line)) out.push(line);
  };
  for (const error of errors) fail('page.error', error);
  const drawn = series.filter(([, text]) => text !== '');
  const counted = Math.max(0, ...drawn.map(([, text]) => countOf(text)));
  if (marker === 'never') {
    if (counted < REPLAY || made.live < 15 || made.markerAt !== undefined) fail('premise.never', `the strip counted ${counted} lines at most (wanted ${REPLAY} or more), the feed made ${made.live} live lines (wanted 15 or more) and its marker came at ${made.markerAt} (wanted none)`);
    const figures = drawn.filter(([, text]) => rateOf(text) !== 'none');
    if (drawn.length < 20 || figures.length > 0) fail('never.unknown', `${drawn.length} samples, ${figures.length} of them not saying no rate (${figures.slice(0, 3).map(([at, text]) => `"${text}" at ${at} ms`).join(', ')}), wanted every one of at least 20 to say "${NO_RATE}"`);
    return out;
  }
  if (counted < REPLAY || made.live < 20 || made.afterMarker < 1000 || made.markerAt === undefined) fail('premise.replay', `the strip counted ${counted} lines at most (wanted ${REPLAY} or more), the feed made ${made.live} live lines (wanted 20 or more) and ${made.afterMarker} replay lines after its marker at ${made.markerAt} ms (wanted 1,000 or more)`);
  const before = drawn.filter(([at]) => made.markerAt !== undefined && at < made.markerAt);
  const guessed = before.filter(([, text]) => rateOf(text) !== 'none');
  if (before.length === 0 || guessed.length > 0) fail('rate.unknown', `${before.length} samples before the marker at ${made.markerAt} ms, ${guessed.length} of them not saying no rate (${guessed.slice(0, 3).map(([at, text]) => `"${text}" at ${at} ms`).join(', ')}), wanted at least one and every one to say "${NO_RATE}"`);
  const rates = drawn.map(([at, text]) => [at, rateOf(text)]).filter(([, rate]) => typeof rate === 'number');
  const top = rates.reduce((best, entry) => (entry[1] > best[1] ? entry : best), [0, 0]);
  if (top[1] > 2 * RATE) fail('rate.max', `the strip read ${top[1]} lines/s at ${top[0]} ms, the feed writes ${RATE} a second (the limit is ${2 * RATE})`);
  const told = rates.find(([, rate]) => rate >= 3.5 && rate <= 6.5);
  if (told === undefined || told[0] > 6000) fail('rate.told', `no rate near ${RATE} on the strip within 6 s of the producer's start (first: ${told === undefined ? 'none' : `${told[1]} at ${told[0]} ms`})`);
  const late = drawn.filter(([at]) => at >= 5000).map(([at, text]) => [at, rateOf(text)]);
  const off = late.filter(([, rate]) => typeof rate !== 'number' || rate < 3.5 || rate > 6.5);
  if (late.length === 0 || off.length > 0) fail('rate.settled', `from 5 s the strip read ${off.length > 0 ? off.slice(0, 3).map(([at, rate]) => `${String(rate)} at ${at} ms`).join(', ') : 'no sample at all'}, wanted 3.5 to 6.5`);
  return out;
}

const dist = await buildFixture();
const { server, url } = await serve(dist);
const origin = url.replace(/\/$/, '');
const report = { replay: REPLAY, rate: RATE, uptime: execFileSync('uptime', { encoding: 'utf8' }).trim(), runs: {} };
console.log(`uptime: ${report.uptime}`);
const failures = [];
const quote = (series) => series.filter((_, index) => index < 20 || index % 8 === 0).map(([at, text]) => `${String(at).padStart(6)} ms  ${text}`).join('\n');
const describe = (result) => `the feed made ${result.made.replayed} replayed (${result.made.afterMarker} after its marker at ${String(result.made.markerAt)} ms) and ${result.made.live} live lines`;

if (CONTROL === '') {
  for (const engine of engineNames) {
    // The two pages do not depend on each other: a source that is marked, and one that never is, side by side.
    const [marked, never] = await Promise.all([run(origin, engine, 'ahead', '', SECONDS), run(origin, engine, 'never', '', NEVER_SECONDS)]);
    report.runs[engine] = { marked: { ...marked, failures: judge(engine, marked) }, never: { ...never, failures: judge(engine, never) } };
    failures.push(...report.runs[engine].marked.failures, ...report.runs[engine].never.failures);
    console.log(`\n== ${engine} (load ${marked.load}); marked: ${describe(marked)}; the first 5 s every 250 ms, then every 2 s\n${quote(marked.series)}`);
    console.log(`\n== ${engine}, never marked: ${describe(never)}\n${quote(never.series)}`);
  }
} else {
  const { marker, named, allowed } = CONTROLS[CONTROL];
  const engine = engineNames.length === 1 || process.env.ENGINES !== undefined ? engineNames[0] : 'chromium';
  const seconds = marker === 'never' ? NEVER_SECONDS : SECONDS;
  // Side by side: the two pages do not depend on each other, and a step of the shard is held to the seconds of its table.
  const [clean, perturbed] = await Promise.all([run(origin, engine, marker, '', seconds), run(origin, engine, marker, CONTROL, seconds)]);
  const cleanFailures = judge(engine, clean).filter((line) => line.startsWith(named));
  const perturbedFailures = judge(engine, perturbed);
  const seen = perturbedFailures.filter((line) => line.startsWith(named));
  console.log(`\nwithout the perturbation (${engine}): ${cleanFailures.length === 0 ? `${named} holds` : cleanFailures[0]}\n${quote(clean.series)}\nwith it:\n${quote(perturbed.series)}`);
  const detected = cleanFailures.length === 0 && seen.length > 0 && perturbedFailures.every((line) => allowed.some((name) => line.startsWith(name)));
  console.log(detected ? `\nNEGATIVE CONTROL "${CONTROL}": detected (${seen[0]})` : `\nNEGATIVE CONTROL "${CONTROL}": NOT DETECTED (clean: ${cleanFailures.length} ${named} failures; perturbed: ${seen.length}; others: ${perturbedFailures.filter((line) => !allowed.some((name) => line.startsWith(name))).join(' | ')})`);
  console.log(`its assertion, to remove with ASSERTION_OFF: ^${named.replace('.', '\\.')} `);
  if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify({ control: CONTROL, clean, perturbed }, null, 1));
  server.close();
  process.exit(detected ? 0 : 1);
}

if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1));
server.close();
if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`\nthe strip said no rate before it was told, never read above ${2 * RATE} lines/s, settled on ${RATE}, and said no rate for a source that was never marked, in ${engineNames.join(' and ')}`);
