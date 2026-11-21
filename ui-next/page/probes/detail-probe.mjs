// Probes the detail page on the fixture (detailCase.tsx: the real Shell in its document layout around the real DetailPage and the kit's parts, invented data), in WebKit and
// Chromium at 1440 x 900 and 1280 x 800 (decision A15), against the design mock's detail page (packages/kit/probes/mock-detail.json, made by mock-detail-measure.mjs from
// `?page=shell/page-kit-detail&lab=1`).
//
//   OMNIVIEW_UI=next node ui-next/page/probes/detail-probe.mjs
//
//   FIXTURE_DIST=<dir>   probe an existing build         ENGINES=webkit,chromium   VIEWPORTS=1440x900,1280x800      SHOTS=<dir>   a screenshot per engine and viewport
//   QUIET=1              print only what is not ok, and the summary
//
// Stages: rects (the header and its parts, the strip and its faces, the summary, the columns, the Details list, the table cards, the aside, each against the mock's node of the
// same name: 1 px, 2 px for what depends on its text; a text box whose words differ from the mock's is compared by y and height), shift (no part of the page moves by 0.001 px from
// the loading state to the ready one: the header, the identity line, the strip, the first face, the panel's top), keys (Tab reaches the strip's one stop, the arrows move and select,
// Home and End), counts (DOM elements of the page), gone (an object that is not there, K2c-2: a plugin that titles it "deleted" has its title over its message, one that gives no title has the page's
// "was not found", the header and the strip stay where the loading page had them, and the page never says both; the design mock words the two states, and a control swaps the expectations).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ENGINES, VIEWPORTS as KIT_VIEWPORTS, launch } from '../../../packages/kit/probes/probe-lib.mjs';
import { MOCK_DETAIL, buildFixture, openCase, readRects, round2, serve, sleep } from './lib.mjs';

const NATIVE = { '1440x900': { width: 1440, height: 900 }, '1280x800': { width: 1280, height: 800 } };
void KIT_VIEWPORTS;
const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? Object.keys(NATIVE).join(',')).split(',');
const QUIET = process.env.QUIET === '1';
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let lines = 0;
let failures = 0;
const say = (ok, where, what, detail = '') => {
  lines += 1;
  if (!ok) failures += 1;
  if (!ok || !QUIET) console.log(`${ok ? 'ok  ' : 'FAIL'} ${where} ${what}${detail === '' ? '' : `  ${detail}`}`);
};

const within = (list, mock, flex) => list.filter((key) => Math.abs((mock[key] ?? 0) - (list.got?.[key] ?? 0)) > flex).length === 0;
void within;

// mock name -> where the page draws it. `keys`: which of x y w h are compared (default all); `flex`: the tolerance (default 1 px); `i`: the index among the matches.
const section = (id) => `[data-detail-section="${id}"]`;
const TARGETS = [
  ['header', 'header'],
  ['breadcrumb', 'header nav[aria-label="Breadcrumb"]'],
  ['row', 'header [data-ov-row]'],
  ['tile', 'header [data-ov-row] > svg, header [data-ov-header-tile]', { keys: 'xy' }],
  ['title', 'header h1', { keys: 'xyh' }],
  ['meta', 'header [data-ov-meta]', { keys: 'xyh' }],
  ['state', 'header [data-ov-state-chip]', { keys: 'xyh' }],
  ['commands', 'header [role="group"][aria-label$=" commands"]', { keys: 'yh' }],
  ['tabs', '[data-ov-part="tabs"]'],
  ...[0, 1, 2, 3, 4].map((i) => [`tab${i}`, '[data-ov-part="tab"]', { keys: i === 0 ? 'xywh' : 'yh', i }]),
  // The pair's height is its tallest column's: the mock's aside holds a Usage card of charts (a metric panel is not a section kind of this contract), so only where it starts and how wide it is are compared.
  ['pair', '[data-detail-part="overview"]', { keys: 'xyw' }],
  ['main', '[data-detail-part="main"]', { keys: 'xy' }],
  ['summary', '[data-ov-part="status-summary"]', { keys: 'xyh' }],
  ['card0', section('details'), { keys: 'xy' }],
  ['card0Lane', `${section('details')} [data-ov-part="lane"]`, { keys: 'xyh' }],
  ['card0Heading', `${section('details')} [data-ov-part="heading"]`, { keys: 'xyh' }],
  ['card0Body', `${section('details')} [data-ov-part="body"]`, { keys: 'xy' }],
  ['kv', `${section('details')} dl`, { keys: 'xyh' }],
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [`kvRow${i}`, `${section('details')} [data-ov-part="row"]`, { keys: 'xyh', i }]),
  ['card1', section('parts'), { keys: 'xy' }],
  ['card1Lane', `${section('parts')} [data-ov-part="lane"]`, { keys: 'xyh' }],
  ['card1Table', `${section('parts')} table`, { keys: 'xy' }],
  ['card1Thead', `${section('parts')} thead`, { keys: 'xyh' }],
  ['card1Row0', `${section('parts')} tbody tr[data-ov-index]`, { keys: 'xyh', i: 0 }],
  ['card1Row1', `${section('parts')} tbody tr[data-ov-index]`, { keys: 'xyh', i: 1 }],
];

async function rects(browser, engine, viewportName, origin) {
  const where = `${engine} ${viewportName}`;
  const { page, context, errors } = await openCase(browser, origin, 'detail', NATIVE[viewportName], { ready: '[data-ov-part="tabs"]', extra: '&state=ready' });
  for (const error of errors) say(false, where, `page error: ${error}`);
  const read = await readRects(page, TARGETS.map(([name, sel, o]) => ({ name, sel, nth: o?.i ?? 0 })));
  const mock = (name) => MOCK_DETAIL.node('detail', engine, viewportName, name)?.r ?? null;
  for (const [name, , o] of TARGETS) {
    const want = mock(name);
    const got = read[name];
    if (want === null) {
      say(false, where, `${name}: the mock has no such node`);
      continue;
    }

    if (got === null || got === undefined) {
      say(false, where, `${name}: the page does not draw it`);
      continue;
    }

    // The mock's page header draws a breadcrumb row and the page's does too (path): the geometry is the same, so nothing is adjusted.
    const keys = (o?.keys ?? 'xywh').split('');
    const index = { x: 0, y: 1, w: 2, h: 3 };
    const tolerance = o?.flex ?? 1;
    const off = keys.map((key) => [key, round2(Math.abs(want[index[key]] - got[index[key]]))]).filter(([, delta]) => delta > tolerance);
    say(off.length === 0, where, `${name}`, off.length === 0 ? '' : `mock ${JSON.stringify(want)} page ${JSON.stringify(got)} off by ${off.map(([key, delta]) => `${key} ${delta}`).join(', ')}`);
  }

  // the aside wraps under the main column at 1280 (the mock's page container is 957 wide there) and stands beside it at 1440.
  const aside = await readRects(page, [{ name: 'aside', sel: '[data-detail-part="aside"]' }, { name: 'main', sel: '[data-detail-part="main"]' }]);
  const wraps = viewportName === '1280x800';
  say(aside.aside !== null && (wraps ? aside.aside[1] > aside.main[1] + aside.main[3] : aside.aside[0] > aside.main[0] + aside.main[2]), where, wraps ? 'the aside stacks under the main column' : 'the aside is beside the main column');
  if (viewportName === '1440x900') say(Math.abs(aside.aside[2] - 341.67) <= 1 && Math.abs(aside.main[2] - 763.33) <= 1, where, 'columns 763.33 and 341.67', `main ${aside.main[2]} aside ${aside.aside[2]}`);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `D1a-detail-${engine}-void-${viewportName}.png`) });
  await context.close();
}

/** Loading to ready: every named part keeps its rectangle (the width of the title is by design: the commands arrive beside it). */
async function shift(browser, engine, viewportName, origin) {
  const where = `${engine} ${viewportName} shift`;
  const { page, context } = await openCase(browser, origin, 'detail', NATIVE[viewportName], { ready: '[data-ov-part="tabs"]', extra: '&state=loading' });
  const specs = [
    { name: 'header', sel: 'header' },
    { name: 'row', sel: 'header [data-ov-row]' },
    { name: 'title', sel: 'header h1' },
    { name: 'meta', sel: 'header [data-ov-meta]' },
    { name: 'tabs', sel: '[data-ov-part="tabs"]' },
    { name: 'tab0', sel: '[data-ov-part="tab"]' },
    { name: 'panel', sel: '[role="tabpanel"][aria-labelledby]' },
  ];
  const before = await readRects(page, specs);
  await page.evaluate(() => window.__fixture?.ready());
  await page.waitForSelector('[data-detail-part="overview"]');
  await sleep(100);
  const after = await readRects(page, specs);
  for (const { name } of specs) {
    const a = before[name];
    const b = after[name];
    // A part that is missing in either state is a failure, not "no movement": null is not a rectangle that stayed.
    const present = a !== null && b !== null;
    const moved = present ? [0, 1].map((k) => round2(Math.abs(a[k] - b[k]))).filter((delta) => delta > 0.001) : [];
    const heightMoved = present && name !== 'panel' && Math.abs(a[3] - b[3]) > 0.001;
    const stayed = present && moved.length === 0 && !heightMoved;
    say(stayed, where, `${name} stays where it was`, stayed ? '' : `before ${JSON.stringify(a)} after ${JSON.stringify(b)}`);
  }

  await context.close();
}

/** The keyboard path through the strip: one Tab stop, the arrows move and select (they wrap), Home and End. */
async function keys(browser, engine, viewportName, origin) {
  const where = `${engine} ${viewportName} keys`;
  const { page, context } = await openCase(browser, origin, 'detail', NATIVE[viewportName], { ready: '[data-ov-part="tabs"]', extra: '&state=ready' });
  const stops = await page.evaluate(() => [...document.querySelectorAll('[data-ov-part="tabs"] [role="tab"]')].map((tab) => tab.getAttribute('tabindex')));
  say(stops.filter((stop) => stop === '0').length === 1 && stops.length === 5, where, 'the strip is one Tab stop', JSON.stringify(stops));
  await page.locator('[data-ov-part="tabs"] [role="tab"][aria-selected="true"]').focus();
  const selected = () => page.evaluate(() => document.querySelector('[data-ov-part="tabs"] [role="tab"][aria-selected="true"]')?.textContent?.trim());
  await page.keyboard.press('ArrowRight');
  say((await selected()) === 'Members 3', where, 'ArrowRight moves to the next tab and selects it', String(await selected()));
  await page.keyboard.press('End');
  say((await selected()) === 'Source', where, 'End selects the last tab', String(await selected()));
  await page.keyboard.press('ArrowRight');
  say((await selected()) === 'Overview', where, 'ArrowRight wraps to the first', String(await selected()));
  // Tab leaves the strip for the panel (a panel that starts with text is a stop of its own, as the tabs pattern asks), and Shift+Tab comes back to the selected tab.
  await page.keyboard.press('Tab');
  say(await page.evaluate(() => document.activeElement?.getAttribute('data-ov-part') === 'tab-panel'), where, 'Tab from the strip reaches the panel');
  await page.keyboard.press('Shift+Tab');
  say((await page.evaluate(() => document.activeElement?.getAttribute('aria-selected'))) === 'true', where, 'Shift+Tab goes back to the selected tab');
  const count = await page.evaluate(() => document.querySelector('[data-detail-part="overview"]')?.querySelectorAll('*').length ?? -1);
  say(count > 0, where, `the Overview is ${count} DOM elements`);
  await context.close();
}

const GONE = {
  deleted: { title: 'orders-api was deleted', hint: 'It no longer exists in north.' },
  'not-found': { title: 'orders-api was not found', hint: 'Item orders-api doesn\'t exist in north. It may have been deleted.' },
};

/** What the not-found body of the page says, and what is wrong with it against `want`. */
async function goneProblems(page, want) {
  const read = await page.evaluate(() => {
    const body = document.querySelector('[role="tabpanel"] [role="status"]');
    return {
      title: body?.querySelector('b')?.textContent ?? null,
      hint: body?.querySelector('span')?.textContent ?? null,
      heading: document.querySelector('header h1')?.textContent ?? null,
      tabs: document.querySelectorAll('[data-ov-part="tabs"] [role="tab"]').length,
      said: document.body.innerText,
    };
  });
  const problems = [];
  if (read.title !== want.title) problems.push(`title ${JSON.stringify(read.title)}, wanted ${JSON.stringify(want.title)}`);
  if (read.hint !== want.hint) problems.push(`hint ${JSON.stringify(read.hint)}, wanted ${JSON.stringify(want.hint)}`);
  if (read.heading !== 'orders-api') problems.push(`the page's heading is ${JSON.stringify(read.heading)}`);
  if (read.tabs !== 5) problems.push(`${read.tabs} tabs, wanted 5`);
  if (read.said.includes('was deleted') && read.said.includes('was not found')) problems.push('the page says both "was deleted" and "was not found"');
  return problems;
}

/** An object that is not there (K2c-2): each of the two states says its own title and message, keeps the header and the strip where the loading page had them, and a swapped expectation is caught. */
async function gone(browser, engine, viewportName, origin) {
  const where = `${engine} ${viewportName} gone`;
  const specs = [
    { name: 'header', sel: 'header' },
    { name: 'row', sel: 'header [data-ov-row]' },
    { name: 'title', sel: 'header h1' },
    { name: 'meta', sel: 'header [data-ov-meta]' },
    { name: 'tabs', sel: '[data-ov-part="tabs"]' },
    { name: 'tab0', sel: '[data-ov-part="tab"]' },
    { name: 'panel', sel: '[role="tabpanel"][aria-labelledby]' },
  ];
  const loading = await openCase(browser, origin, 'detail', NATIVE[viewportName], { ready: '[data-ov-part="tabs"]', extra: '&state=loading' });
  const before = await readRects(loading.page, specs);
  await loading.context.close();
  for (const state of ['deleted', 'not-found']) {
    const { page, context, errors } = await openCase(browser, origin, 'detail', NATIVE[viewportName], { ready: '[role="tabpanel"] [role="status"]', extra: `&state=${state}` });
    for (const error of errors) say(false, where, `page error: ${error}`);
    const problems = await goneProblems(page, GONE[state]);
    say(problems.length === 0, where, `${state}: the page says "${GONE[state].title}" over "${GONE[state].hint}", with its heading and five tabs`, problems.join('; '));
    // The same reading with the other state's words must fail: the reading is not satisfied by any page.
    const other = state === 'deleted' ? 'not-found' : 'deleted';
    say((await goneProblems(page, GONE[other])).length > 0, where, `${state}: control, the reading with the words of ${other} reports a problem`);
    const after = await readRects(page, specs);
    for (const { name } of specs.filter((spec) => spec.name !== 'panel')) {
      const a = before[name];
      const b = after[name];
      const stayed = a !== null && b !== null && [0, 1, 3].every((k) => round2(Math.abs(a[k] - b[k])) <= 0.001);
      say(stayed, where, `${state}: ${name} stays where the loading page had it`, stayed ? '' : `loading ${JSON.stringify(a)} ${state} ${JSON.stringify(b)}`);
    }

    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `K2c-2-detail-${state}-${engine}-void-${viewportName}.png`) });
    await context.close();
  }
}

const dist = buildFixture();
const { server, origin } = await serve(dist);
try {
  for (const engine of engineNames) {
    const browser = await launch(engine);
    try {
      for (const viewportName of viewportNames) {
        await rects(browser, engine, viewportName, origin);
        await shift(browser, engine, viewportName, origin);
        await keys(browser, engine, viewportName, origin);
        await gone(browser, engine, viewportName, origin);
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}

console.log(`${failures === 0 ? 'PASS' : 'FAIL'}: ${lines} readings, ${failures} outside the tolerance`);
process.exit(failures === 0 ? 0 : 1);
