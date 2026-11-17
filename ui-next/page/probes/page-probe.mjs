// Probes the list page's chrome on the fixture (fixture.tsx: the real Shell, ListPage and PageHeader around invented data), in WebKit and Chromium at 1440 x 900
// and 1030 x 720, against the design mock's measured rectangles (packages/kit/probes/mock-page.json, made by mock-page-measure.mjs).
//
//   OMNIVIEW_UI=next node ui-next/page/probes/page-probe.mjs        builds the fixture (build-fixture.mjs) into a temp dir, serves it, probes it
//
//   FIXTURE_DIST=<dir>                 probe an existing build instead of building
//   ENGINES=webkit,chromium            VIEWPORTS=1440x900,1030x720      (defaults: both of each)
//   STAGES=chrome,shift                the stages to run (default: all that exist: chrome, shift)
//   QUIET=1                            print only the lines that are not ok, and the summary
//   AUTOCLEAR=0                        skip the 8.5 s wait that proves the presenter clears a calm outcome by itself (default: waited, at 1440 x 900)
//
// The font is normalized as the mock's reference was (normalizeFont: Helvetica for the UI stack on both sides).
// Stages, in the order of the brief:
//   chrome   (a) the rectangles of the data view, the page header and its title, the command lane, the quick filters and each chip, the toolbar and the search
//            field, the table header, the first row and the footer with its count, and the 12/8/8 px gaps, against the mock's `list` and `listNarrow`
//   shift    (b) layout shift: a frame sampler around the page's own Refresh (idle, Refreshing…, Updated, cleared) and around every state of an operation in a
//            header on its own (with and without an identity line); no part may move by 0.001 px at any frame; the slot at rest is 0 px wide and 28 px high.
//            Chromium's layout-shift score is printed as information only: it also counts the presenter's own content and the facts that give way by design.
// Tolerances: 1 px for a fixed size, 2 px for one that depends on its room or its text; a text box whose words differ from the mock's is compared by x, y
// and height only. Exit code 1 when anything is outside them.
import { ENGINES, VIEWPORTS } from '../../../packages/kit/probes/probe-lib.mjs';
import { Report, buildFixture, diffRect, openCase, readRects, reference, round2, serve, showKeys, sleep } from './lib.mjs';
import { EPS, HEADER_PARTS, LIST_PARTS, OPERATIONS, frames, installSampler } from './shift.mjs';
import { ABSENT, CHIP_NAMES, CHROME, GAPS } from './targets.mjs';

const engineNames = (process.env.ENGINES ?? Object.keys(ENGINES).join(',')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? Object.keys(VIEWPORTS).join(',')).split(',');
const stages = (process.env.STAGES ?? 'chrome,shift').split(',');
const QUIET = process.env.QUIET === '1';

const report = new Report();
const say = report.line.bind(report);
report.line = (where, target, mock, got, delta, status, note) => {
  if (QUIET && status === 'ok') {
    report.lines += 1;
    if (typeof delta === 'number') report.worst.set(target, Math.max(report.worst.get(target) ?? 0, delta));
    return;
  }

  say(where, target, mock, got, delta, status, note);
};

/** The mock's rectangle for a target: a key or dotted path of the record, or a function of the record. */
function refOf(record, ref) {
  if (typeof ref === 'function') return ref(record);
  return ref.split('.').reduce((node, key) => node?.[key], record)?.r ?? null;
}

const specsOf = (targets) => targets.map((target) => ({ name: target.name, sel: target.sel, nth: target.nth, kind: target.kind }));

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* (a) The chrome of the list.                                                                                                      */
/* ------------------------------------------------------------------------------------------------------------------------------ */

async function chrome(browser, engine, viewportName, viewport, origin) {
  const { page, context, errors } = await openCase(browser, origin, 'list', viewport, { ready: 'tbody tr[data-ov-index]' });
  const read = await readRects(page, [
    ...specsOf(CHROME),
    ...ABSENT.map((item) => ({ name: `absent ${item.name}`, sel: item.sel, kind: 'count' })),
    ...CHIP_NAMES.map((name) => ({ name: `text ${name}`, sel: CHROME.find((t) => t.name === name).sel, nth: CHROME.find((t) => t.name === name).nth, kind: 'text' })),
    { name: 'slot', sel: '[data-ov-slot]' },
  ]);
  const rects = Object.fromEntries(CHROME.map((target) => [target.name, target.kind === 'text' ? read[target.name]?.rect : read[target.name]]));
  for (const error of errors) report.fail(`${engine} ${viewportName}`, `page error: ${error}`);

  for (const section of ['list', 'listNarrow']) {
    const record = reference(section, undefined, viewportName, engine);
    const where = `${section} ${viewportName} ${engine}`;
    for (const target of CHROME) {
      const want = refOf(record, target.ref);
      const got = rects[target.name];
      if (want === null || want === undefined) {
        report.fail(where, `${target.name}: the mock's record has no ${typeof target.ref === 'string' ? target.ref : 'part'}`);
        continue;
      }

      if (got === null || got === undefined) {
        report.fail(where, `${target.name}: the page does not draw it (${target.sel})`);
        continue;
      }

      const result = diffRect(want, got, target);
      const adjusted = target.adjust === undefined ? '' : `by construction ${JSON.stringify(target.adjust)}`;
      report.line(where, target.name, showKeys(result.keys, 0), showKeys(result.keys, 1), result.delta, result.ok ? 'ok' : 'FAIL', adjusted);
    }

    // The chips' words: the counts are the mock's (All 89, Running 78, Pending 0, Failed 2, Completed 9).
    const wantWords = CHIP_NAMES.map((name) => record[name]?.x).join(' | ');
    const gotWords = CHIP_NAMES.map((name) => read[`text ${name}`]?.text).join(' | ');
    report.line(where, 'chip words', wantWords, gotWords, wantWords === gotWords ? 0 : 'differ', wantWords === gotWords ? 'ok' : 'FAIL');

    for (const gap of GAPS) {
      const between = (side) => {
        const from = side === 'mock' ? refOf(record, CHROME.find((t) => t.name === gap.from).ref) : rects[gap.from];
        const to = side === 'mock' ? refOf(record, CHROME.find((t) => t.name === gap.to).ref) : rects[gap.to];
        return round2(to[1] - (from[1] + from[3]));
      };
      const mock = between('mock');
      const got = between('page');
      const delta = round2(Math.abs(mock - got));
      report.line(where, gap.name, `${mock} (design ${gap.want})`, got, delta, delta <= 1 && mock === gap.want ? 'ok' : 'FAIL');
    }

    for (const item of ABSENT.filter((entry) => entry.only === undefined || entry.only === viewportName)) {
      const count = read[`absent ${item.name}`];
      const drawn = record[item.ref] !== undefined && refOf(record, item.ref) !== null && refOf(record, item.ref)[2] > 0;
      report.line(where, item.name, drawn ? 'drawn' : 'absent', `${count} match`, 'n/a', count === item.count ? 'known' : 'FAIL', item.why);
    }
  }

  // The header of a list is the mock's `h-list` (a title and Refresh alone): title and Refresh to the pixel, with the slot declared and at rest.
  const header = reference('header', 'h-list', viewportName, engine);
  const where = `h-list ${viewportName} ${engine}`;
  const title = diffRect(header.title.r, rects.title, { flex: 'w' });
  report.line(where, 'title (Refresh alone)', showKeys(title.keys, 0), showKeys(title.keys, 1), title.delta, title.ok ? 'ok' : 'FAIL', 'the slot at rest takes no room beside the title');
  const refresh = diffRect(header.cmd0.r, rects.refresh);
  report.line(where, 'refresh (alone)', showKeys(refresh.keys, 0), showKeys(refresh.keys, 1), refresh.delta, refresh.ok ? 'ok' : 'FAIL');
  const slot = read.slot;
  const slotMock = reference('slot', undefined, viewportName, engine).rest.slot.r;
  const slotOk = slot !== null && slot[2] === 0 && slot[3] === 28;
  report.line(`slot ${viewportName} ${engine}`, 'slot at rest', `w${slotMock[2]} h${slotMock[3]}`, slot === null ? 'none' : `w${slot[2]} h${slot[3]}`, slot === null ? 'none' : round2(Math.abs(slot[2] - slotMock[2]) + Math.abs(slot[3] - slotMock[3])), slotOk ? 'ok' : 'FAIL');
  await context.close();
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* (b) Layout shift.                                                                                                                */
/* ------------------------------------------------------------------------------------------------------------------------------ */

function reportShift(where, label, state, extra = '') {
  const moves = Object.entries(state.moves);
  const phases = Object.entries(state.phases).map(([name, count]) => `${name}:${count}`).join(' ');
  if (moves.length === 0) {
    report.line(where, label, 'no move', `0 of ${state.frames} frames moved`, 0, 'ok', `${extra}${extra ? '; ' : ''}layout-shift ${state.shiftValue === null ? 'n/a' : state.shiftValue.toFixed(4)}; ${phases}`);
  } else {
    for (const [key, move] of moves) report.line(where, `${label} ${key}`, 'no move', `moved ${round2(move.max)} px in ${move.frames} frames, first in "${move.phase}"`, round2(move.max), 'FAIL');
  }

}

const slotText = (page) => page.evaluate(() => document.querySelector('[data-ov-slot]')?.textContent?.trim() ?? '');

/** The page's own Refresh, felt: idle, Refreshing… (at least 700 ms), Updated, then cleared (by Dismiss, or by the presenter's own clock after 8 s). */
async function refresh(browser, engine, viewportName, viewport, origin, { clearsItself }) {
  const where = `shift refresh ${viewportName} ${engine}`;
  const { page, context, errors } = await openCase(browser, origin, 'refresh', viewport, { ready: 'tbody tr[data-ov-index]' });
  for (const error of errors) report.fail(where, `page error: ${error}`);
  // The control: the title's width is a move by design (it shares its row with the slot), so a sampler that sees nothing of it is blind.
  await page.evaluate(installSampler, { specs: [...LIST_PARTS, { name: 'control title', sel: 'h1', ignore: 'xyh' }], eps: EPS });
  const button = '[role="group"][aria-label$=" commands"] button';
  await sleep(250);

  await page.evaluate(() => window.__sampler.phase('refreshing'));
  const clicked = Date.now();
  await page.click(button);
  await page.waitForFunction(() => document.querySelector('[data-ov-slot]')?.textContent?.includes('Refreshing'));
  const open = await readRects(page, [{ name: 'slot', sel: '[data-ov-slot]' }, { name: 'title', sel: 'h1' }]);
  await sleep(900);
  const stillRefreshing = (await slotText(page)).includes('Refreshing');

  await page.evaluate(() => {
    window.__sampler.phase('updated');
    window.__fixture.release();
  });
  await page.waitForFunction(() => document.querySelector('[data-ov-slot]')?.textContent?.includes('Updated'));
  const updatedAfter = Date.now() - clicked;
  await frames(page, 4);
  await sleep(300);

  if (clearsItself) {
    await page.evaluate(() => window.__sampler.phase('clears itself'));
    await sleep(8500);
  } else {
    await page.evaluate(() => window.__sampler.phase('dismissed'));
    await page.click('button[aria-label^="Dismiss"]');
  }

  await frames(page, 3);
  const slotAfter = await readRects(page, [{ name: 'slot', sel: '[data-ov-slot]' }]);
  await page.evaluate(() => window.__sampler.phase('rest'));
  await sleep(300);
  const state = await page.evaluate(() => window.__sampler.stop());
  const control = state.moves['control title.w'];
  if (control === undefined) report.fail(where, 'the sampler did not see the title shrink while the slot was open: it cannot see a move');
  delete state.moves['control title.w'];
  reportShift(where, 'list parts', state, `control: title shrank ${control === undefined ? 0 : round2(control.max)} px; ${clearsItself ? 'cleared by its own clock' : 'cleared by Dismiss'}; slot open ${open.slot?.[2]}x${open.slot?.[3]}, title ${open.title?.[2]}`);

  if (!stillRefreshing) report.fail(where, 'Refreshing… was gone before the read ended');
  if (updatedAfter < 700) report.fail(where, `Updated came ${updatedAfter} ms after the click: the refresh is felt for at least 700 ms`);
  if (await slotText(page) !== '') report.fail(where, `the slot is not clear at the end: "${await slotText(page)}"`);
  const rest = slotAfter.slot;
  if (rest === null || rest[2] !== 0 || rest[3] !== 28) report.fail(where, `the slot at rest is ${rest === null ? 'missing' : `${rest[2]} x ${rest[3]}`}, wanted 0 x 28`);
  await context.close();
}

/** A header on its own, in each shape, through every state of an operation; the slot at rest is 0 px wide and 28 px high. */
async function headers(browser, engine, viewportName, viewport, origin) {
  const { page, context, errors } = await openCase(browser, origin, 'header', viewport, { ready: 'header h1' });
  for (const error of errors) report.fail(`shift header ${viewportName} ${engine}`, `page error: ${error}`);
  for (const shape of ['list', 'list-full', 'detail', 'detail-long', 'disabled', 'note']) {
    const where = `shift ${shape} ${viewportName} ${engine}`;
    await page.evaluate(([name]) => window.__fixture.header(name, null), [shape]);
    await frames(page, 3);
    const rest = (await readRects(page, [{ name: 'slot', sel: '[data-ov-slot]' }])).slot;
    report.line(where, 'slot at rest', 'w0 h28', rest === null ? 'none' : `w${rest[2]} h${rest[3]}`, rest === null ? 'none' : Math.abs(rest[2]) + Math.abs(rest[3] - 28), rest !== null && rest[2] === 0 && rest[3] === 28 ? 'ok' : 'FAIL');
    await page.evaluate(installSampler, { specs: HEADER_PARTS, eps: EPS });
    for (const [label, spec] of OPERATIONS) {
      await page.evaluate(([name, record]) => {
        window.__sampler.phase(name);
        window.__fixture.operation(record);
      }, [label, spec]);
      await frames(page, 3);
    }

    const state = await page.evaluate(() => window.__sampler.stop());
    reportShift(where, 'header parts', state, `${OPERATIONS.length} states`);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('header h1');
  }

  await context.close();
}

/* ------------------------------------------------------------------------------------------------------------------------------ */

const built = buildFixture();
const { server, origin } = await serve(built);

for (const engineName of engineNames) {
  const browser = await ENGINES[engineName].launch();
  for (const viewportName of viewportNames) {
    const viewport = VIEWPORTS[viewportName];
    if (stages.includes('chrome')) await chrome(browser, engineName, viewportName, viewport, origin);
    if (stages.includes('shift')) {
      await refresh(browser, engineName, viewportName, viewport, origin, { clearsItself: false });
      if (process.env.AUTOCLEAR !== '0' && viewportName === '1440x900') await refresh(browser, engineName, viewportName, viewport, origin, { clearsItself: true });
      await headers(browser, engineName, viewportName, viewport, origin);
    }
  }

  await browser.close();
  console.log(engineName, 'done');
}

server.close();
console.log(`\n${report.lines} lines, ${report.known} known differences, ${report.failures.length} failures`);
if (report.failures.length > 0) {
  console.error(`\n${report.failures.length} failures:\n${report.failures.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}

console.log('page probe: no failures');
