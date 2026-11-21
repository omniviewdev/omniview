// Probes the rate on the Logs strip at OPEN (L4, demo defect D2): the host's own Logs session body (`LogSession`: the view, its model, the strip) over a feed that does what a real stream does when it opens on a source that has been
// writing for a while. It replays the source's last 5,000 lines in the first half second, each stamped with the time it was written, with nothing to say they are a replay (the runtime's stream has no marker, docs/ui-next/status/L4.md),
// and then writes 5 lines a second. The strip's text is read every 250 ms, in the page, from the first frame, for 8 s. The demo read 7,878 lines/s at open on a source that writes 5, then 1,958, 1,131, 716, and took 8 s to come down.
//
//   node ui-next/shell/probes/logs-open-probe.mjs      builds the fixture (OMNIVIEW_UI=next) into a temp dir, serves it, probes it, in WebKit and Chromium at 1440 x 900
//
//   FIXTURE_DIST=<dir>        probe an existing build of the fixture         FONT_DELAY_MS=40   as a runner serves fonts      ENGINES=webkit,chromium      REPORT=<file>   the report as JSON
//   NEGATIVE_CONTROL=fresh    perturb the page: the replay is stamped with the instant it is delivered (a feed that gives the view no way to tell a replay from live lines), so the strip reads the burst. Run in Chromium, twice: without
//                             the perturbation (the assertion must hold) and with it (it must fail); "detected" and exit 0 when it did, "NOT DETECTED" and exit 1 when it did not.
//   ASSERTION_OFF=<regex>     drops the failures whose line matches, as if the assertion that says them were not there: the control's own (`rate.max`) is removed with it, and the control must then print NOT DETECTED
//
// Assertions (the name starts each line of a failure):
//   premise.replay   the strip counted the whole replay (5,000 lines or more) and the feed made at least 25 live lines: a feed that did nothing would pass every number below
//   rate.max         no sample of the strip, from the first, reads above 10 lines/s: twice the 5 the feed writes (the placeholder before a rate is known is 0.0, as the mock's strip reads while its seeded lines are not counted)
//   rate.told        a rate near the feed's is on the strip within 5 s of the open (the replay is not waited for beyond the window the rate is told over)
//   rate.settled     from 5 s on, every sample reads between 3.5 and 6.5
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
if (CONTROL !== '' && CONTROL !== 'fresh') throw new Error('NEGATIVE_CONTROL must be fresh');
const OFF = process.env.ASSERTION_OFF === undefined ? undefined : new RegExp(process.env.ASSERTION_OFF);
const REPLAY = 5000;
const RATE = 5;
const SECONDS = 8;
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

const rateOf = (text) => {
  const found = /([\d,.]+) lines\/s/.exec(text);
  return found === null ? undefined : Number(found[1].replace(/,/g, ''));
};
const countOf = (text) => {
  const found = /^(?:[\d,]+ of )?([\d,]+) lines?/.exec(text);
  return found === null ? 0 : Number(found[1].replace(/,/g, ''));
};

/** One run of the page in one engine: the series of the strip's text, and what the feed made. */
async function run(origin, engine, control) {
  const browser = await launch(engine);
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const load = execFileSync('uptime', { encoding: 'utf8' }).trim().replace(/^.*load averages?: /, '');
    await page.goto(`${origin}/shell/probes/logs-open-fixture.html${control === '' ? '' : `?control=${control}`}`, { waitUntil: 'load' });
    await sleep(SECONDS * 1000 + 500);
    const { series, made } = await page.evaluate(() => ({ series: window.__series, made: window.__feed.made }));
    return { series, made, errors, load };
  } finally {
    await browser.close();
  }
}

/** The failures of one run, by assertion name. */
function judge(engine, { series, made, errors }) {
  const out = [];
  const fail = (name, text) => {
    const line = `${name} [${engine}]: ${text}`;
    if (OFF === undefined || !OFF.test(line)) out.push(line);
  };
  for (const error of errors) fail('page.error', error);
  const counted = Math.max(0, ...series.map(([, text]) => countOf(text)));
  if (counted < REPLAY || made.live < 25) fail('premise.replay', `the strip counted ${counted} lines at most (wanted ${REPLAY} or more) and the feed made ${made.live} live lines (wanted 25 or more)`);
  const rates = series.map(([at, text]) => [at, rateOf(text)]).filter(([, rate]) => rate !== undefined);
  const top = rates.reduce((best, entry) => (entry[1] > best[1] ? entry : best), [0, 0]);
  if (top[1] > 2 * RATE) fail('rate.max', `the strip read ${top[1]} lines/s at ${top[0]} ms, the feed writes ${RATE} a second (the limit is ${2 * RATE})`);
  const told = rates.find(([, rate]) => rate >= 3.5 && rate <= 6.5);
  if (told === undefined || told[0] > 5000) fail('rate.told', `no rate near ${RATE} on the strip within 5 s (first: ${told === undefined ? 'none' : `${told[1]} at ${told[0]} ms`})`);
  const late = rates.filter(([at]) => at >= 5000);
  const off = late.filter(([, rate]) => rate < 3.5 || rate > 6.5);
  if (late.length === 0 || off.length > 0) fail('rate.settled', `from 5 s the strip read ${off.length > 0 ? off.slice(0, 3).map(([at, rate]) => `${rate} at ${at} ms`).join(', ') : 'no rate at all'}, wanted 3.5 to 6.5`);
  return out;
}

const dist = await buildFixture();
const { server, url } = await serve(dist);
const origin = url.replace(/\/$/, '');
const report = { replay: REPLAY, rate: RATE, uptime: execFileSync('uptime', { encoding: 'utf8' }).trim(), runs: {} };
console.log(`uptime: ${report.uptime}`);
const failures = [];
const quote = (series) => series.filter((_, index) => index < 20 || index % 8 === 0).map(([at, text]) => `${String(at).padStart(6)} ms  ${text}`).join('\n');

for (const engine of CONTROL === '' ? engineNames : [engineNames.length === 1 || process.env.ENGINES !== undefined ? engineNames[0] : 'chromium']) {
  if (CONTROL === '') {
    const result = await run(origin, engine, '');
    report.runs[engine] = { ...result, failures: judge(engine, result) };
    failures.push(...report.runs[engine].failures);
    console.log(`\n== ${engine} (load ${result.load}); the feed made ${result.made.replayed} replayed and ${result.made.live} live lines; the first 5 s every 250 ms, then every 2 s\n${quote(result.series)}`);
  } else {
    // Side by side: the two pages do not depend on each other, and a step of the shard is held to the seconds of its table.
    const [clean, perturbed] = await Promise.all([run(origin, engine, ''), run(origin, engine, CONTROL)]);
    const cleanFailures = judge(engine, clean).filter((line) => line.startsWith('rate.max'));
    const seen = judge(engine, perturbed).filter((line) => line.startsWith('rate.max'));
    console.log(`\nwithout the perturbation (${engine}): ${cleanFailures.length === 0 ? 'rate.max holds' : cleanFailures[0]}\n${quote(clean.series)}\nwith it:\n${quote(perturbed.series)}`);
    const detected = cleanFailures.length === 0 && seen.length > 0 && judge(engine, perturbed).every((line) => line.startsWith('rate.max') || line.startsWith('rate.told') || line.startsWith('rate.settled'));
    console.log(detected ? `\nNEGATIVE CONTROL "${CONTROL}": detected (${seen[0]})` : `\nNEGATIVE CONTROL "${CONTROL}": NOT DETECTED (clean: ${cleanFailures.length} rate.max failures; perturbed: ${seen.length})`);
    console.log('its assertion, to remove with ASSERTION_OFF: ^rate\\.max ');
    if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify({ control: CONTROL, clean, perturbed }, null, 1));
    server.close();
    process.exit(detected ? 0 : 1);
  }
}

if (process.env.REPORT) writeFileSync(process.env.REPORT, JSON.stringify(report, null, 1));
server.close();
if (failures.length > 0) {
  console.log(`\n${failures.length} failure(s):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`\nthe strip never read above ${2 * RATE} lines/s and settled on ${RATE} in ${engineNames.join(' and ')}`);
