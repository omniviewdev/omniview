// Probes the findings of the recorded tour of the new UI that concern the sidebar and the tab strip (step S3, docs/ui-next/status/S3.md), in WebKit and Chromium at 1440 x 900 and 1280 x 800 (decision A15), each against the
// design mock's own tree or strip where the mock has the rule, and on the host fixture where the finding is about the window. The strip probe (strip-probe.mjs) holds the rectangles of the strip, the page host and the load; this one
// holds what the tour found wrong or unclear in the text of a tab and in the room of a sidebar label, and the sidebar's groups after a plugin's unload.
//
//   node ui-next/shell/probes/tour-probe.mjs        builds the fixtures (OMNIVIEW_UI=next) into a temp dir, serves them, probes them
//
//   FIXTURE_DIST=<dir>   probe an existing build   BUILD_CACHE=<dir>   build once into <dir> and let the next run read it (the controls of the shard table do)   FONT_DELAY_MS=40   as a runner serves fonts
//   ENGINES=webkit,chromium   VIEWPORTS=1440x900,1280x800   (defaults: both of each)      REPORT=<file>   the full report as JSON      SHOTS=<dir>   a screenshot of the sidebar after the plugin's return, per engine and viewport
//   ONLY=<section>   runs one section alone (`names`, `titles`, `twins`, `memory`), for a developer who is working on it; it is not what CI runs
//
// What it checks, per engine and viewport:
//   names     the room a sidebar label gets beside its count, against the mock's own tree (demo finding D7; mock-sidebar.json, made by mock-sidebar-measure.mjs from the cases of names.mjs): the row, the glyph, the label and the digits sit
//             where the mock's do (1 px), the label and its count share the row's width as the mock's do, the slot holds three characters (the mock's two digits and the host's tilde) and the label of a count of that width is cut
//             when the mock's is and when it is not, never earlier; and a label that is cut says its whole name when it is pointed at (the kit's tooltip, the mock's clipped-cell tip), one that is not says nothing
//   titles    where a tab's title is cut, against the mock's own strip (demo finding D4; mock-strip-text.json, made by mock-strip-text-measure.mjs from the cases of strip-text-cases.mjs): a title of twelve graphemes or fewer is one part, a
//             longer one a head with an ellipsis and a tail that keeps its end, the faces are equal and 208 px at most however empty the strip is ("Small counts stop growing at 208px; remaining space belongs to the native drag lane",
//             S17a), and they give way together to 96 px when it is full; the face, the glyph, the title and each of its parts sit where the mock's do (1 px) and are cut as the mock's are
//   twins     what tells two tabs apart, against the mock's own strip (demo finding D8): a tab says its scope only when another tab of the strip would read the same (the mock: "The face carries NO scope by default"), and then the
//             shortest text that tells them apart, in the muted 12 px type after the title, which gives way before the title does; a lone tab and a tab that reads like no other say none
//   memory    the sidebar's groups survive a plugin's unload (demo finding D5): on the host fixture (`?groups=2`) the user opens the group the page is not in and closes the one it is in, the plugin's interface is taken away
//             (`window.__plugin.unload`: the sidebar leaves, the rail and the tab stay) and given back, and the sidebar is the sidebar it was: the same groups open and closed, and the plugin's hook told them again
//   controls  NEGATIVE_CONTROL=<name> runs only the section it is for (Chromium at 1440 x 900 unless ENGINES and VIEWPORTS say otherwise) with one perturbation, which the probe must see: the exit code is 0 when it did.
//             slot-wide: the slot holds four characters of the row's type, as it did before S3 (`names`); names-no-tip: a label that is cut carries no clip marker, so the tooltip never has its name (`names`);
//             title-cut: the tail of a title is not drawn (`titles`); twin-lone: a tab that has no twin draws a scope (`twins`); twin-hidden: twin tabs draw no scope (`twins`);
//             memory-lost: the sidebar comes back as a tree that remembered nothing would draw it, the page's group open and the other closed (`memory`).
//   ASSERTION_OFF=<control>   leaves out the assertion a control is named for: the control's perturbation must then pass undetected (the proof that each control trips its own assertion and no other)
// Exit code 1 when anything differs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINES, normalizeFont } from '../../../packages/kit/probes/probe-lib.mjs';
import { NATIVE_VIEWPORTS, buildFixtures, open, serveFixtures, sleep } from './harness.mjs';
import { NAMES_COUNTS, NAMES_LABELS } from './names.mjs';
import { TEXT_CASES } from './strip-text-cases.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sidebarReference = JSON.parse(readFileSync(path.join(here, 'mock-sidebar.json'), 'utf8'));
const textReference = JSON.parse(readFileSync(path.join(here, 'mock-strip-text.json'), 'utf8'));
// The negative controls: one perturbation of the page, which the probe must see, in the section it is for. With NEGATIVE_CONTROL the exit code is 0 when it did.
const PERTURBATIONS = {
  'slot-wide': { section: 'names', expected: /^names .*: the room a label is given beside its count differs from the mock's/ },
  'names-no-tip': { section: 'names', expected: /^names .*: a label that is cut does not say its whole name when it is pointed at/ },
  'title-cut': { section: 'titles', expected: /^titles .*: the tail of "payment-gateway · Deployment"/ },
  'twin-lone': { section: 'twins', expected: /^twins .*: a tab that reads like no other draws a scope/ },
  'twin-hidden': { section: 'twins', expected: /^twins .*: tabs that read alike do not tell themselves apart/ },
  'memory-lost': { section: 'memory', expected: /^memory .*: the sidebar does not come back as the user left it/ },
};
const CONTROL = process.env.NEGATIVE_CONTROL ?? '';
if (CONTROL !== '' && PERTURBATIONS[CONTROL] === undefined) throw new Error(`NEGATIVE_CONTROL must be one of ${Object.keys(PERTURBATIONS).join(', ')}`);
/** The control whose assertion is left out (ASSERTION_OFF): its perturbation must pass undetected. */
const REMOVE = process.env.ASSERTION_OFF ?? '';
if (REMOVE !== '' && PERTURBATIONS[REMOVE] === undefined) throw new Error(`ASSERTION_OFF must be one of ${Object.keys(PERTURBATIONS).join(', ')}`);
/** ONLY=<section> runs that one section alone. */
const ONLY = process.env.ONLY ?? '';
const SECTION_NAMES = ['names', 'titles', 'twins', 'memory'];
if (ONLY !== '' && !SECTION_NAMES.includes(ONLY)) throw new Error(`ONLY must be one of ${SECTION_NAMES.join(', ')}`);
const engineNames = (process.env.ENGINES ?? (CONTROL === '' ? Object.keys(ENGINES).join(',') : 'chromium')).split(',');
const viewportNames = (process.env.VIEWPORTS ?? (CONTROL === '' ? Object.keys(NATIVE_VIEWPORTS).join(',') : '1440x900')).split(',');
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const failures = [];
const report = { names: {}, titles: {}, twins: {}, memory: {}, notes: [] };
const fail = (where, what) => failures.push(`${where}: ${what}`);

const fixtureUrl = (origin, query) => `${origin}/shell/probes/fixture.html?${query}`;
const hostUrl = (origin, query = '') => `${origin}/shell/probes/host-fixture.html${query === '' ? '' : `?${query}`}`;

// ---------------------------------------------------------------------------------------------------------------------------
/** The rows of the sidebar of `?case=names`, by the id of their entry: the row, the glyph, the label's box (the room it was given) and the width of its text, whether it is cut, the count's slot and the digits in it. Code that runs in the page. */
const READ_NAMES = () => {
  const r2 = (value) => Math.round(value * 100) / 100;
  const rect = (el) => {
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return [r2(box.x), r2(box.y), r2(box.width), r2(box.height)];
  };
  const rows = Object.fromEntries(
    [...document.querySelectorAll('[role=treeitem]')].map((row) => {
      const label = row.children[1];
      const slot = row.querySelector('[data-shell-part="count"]');
      const range = document.createRange();
      range.selectNodeContents(label);
      return [row.getAttribute('data-id'), { row: rect(row), glyph: rect(row.children[0]), label: rect(label), text: r2(range.getBoundingClientRect().width), cut: label.scrollWidth > label.clientWidth, slot: rect(slot), digits: rect(slot?.firstElementChild), countText: slot === null ? null : (slot.querySelector('[aria-hidden="true"]') ?? slot).textContent }];
    }),
  );
  return { sidebar: rect(document.querySelector('[data-shell-region="sidebar"]')), rows };
};

/**
 * The room a sidebar label gets beside its count, against the mock's own tree (S3, demo finding D7). Five neutral labels beside four counts, in the sidebar the shell draws (244 px, the mock's default) and in the mock's `H.tree`
 * of the same rows (mock-sidebar.json): the row, the glyph, the label and the digits sit where the mock's do; the label and the slot of its count share the row as the mock's label and count do (the same indent, gaps and
 * padding); the slot holds three characters, the mock's two digits and the tilde the host puts before an estimate (the mock's own widest count of three characters is the measure), no more, because a label has the room
 * that is left; and the label of a count that fills the slot is cut when the mock's is and is not when it is not. A count the slot has room to spare for leaves the label less room than the mock's, by what the slot keeps: Q2a's
 * rule that a count which arrives moves no label. A label that is cut says its whole name when it is pointed at, as the mock's does, and one that is not says nothing.
 */
async function names(browser, engine, viewportName, viewport, origin) {
  const where = `names ${engine} ${viewportName}`;
  const cases = NAMES_LABELS.flatMap((label, l) => NAMES_COUNTS.map(({ value, approximate }, c) => ({ id: `${String(l)}-${String(c)}`, label, count: approximate ? { value, approximate } : value })));
  const { page, context, errors } = await open(browser, fixtureUrl(origin, `case=names&names=${encodeURIComponent(JSON.stringify(cases))}`), viewport);
  await normalizeFont(page, { rootVar: '--ov-font-ui' });
  // The perturbations of the controls, laid over the page once it is drawn: the slot held at four characters of the row's type (as before S3), and a label that carries no clip marker.
  if (CONTROL === 'slot-wide') await page.addStyleTag({ content: '[data-shell-part="count"] { min-inline-size: 4ch !important; font-size: var(--ov-fs-13) !important; }' });
  if (CONTROL === 'names-no-tip') await page.evaluate(() => document.querySelectorAll('[data-shell-region="sidebar"] [data-ov-clip]').forEach((element) => element.removeAttribute('data-ov-clip')));
  await sleep(250);
  const got = await page.evaluate(READ_NAMES);
  const mock = sidebarReference.data[engine][viewportName];
  report.names[`${engine} ${viewportName}`] = { got, mock: mock.rows };
  const near = (a, b) => Math.abs(a - b) <= 1;
  const text = (value) => `${value.toFixed(2)} px`;
  if (!near(got.sidebar?.[2] ?? 0, mock.sidebar[2])) fail(where, `the sidebar is ${text(got.sidebar?.[2] ?? 0)} wide, the mock's is ${text(mock.sidebar[2])}`);
  // The widest count of three characters the mock draws, which is what the slot holds: the digits of "~12" are the one a window shows most.
  const widest = NAMES_COUNTS.findIndex(({ approximate }) => approximate === true);
  const wanted = sidebarReference.data[engine][viewportName].rows[`0-${String(widest)}`].count[2];
  const slots = [];
  for (const [l, label] of NAMES_LABELS.entries()) {
    for (const [c, count] of NAMES_COUNTS.entries()) {
      const id = `${String(l)}-${String(c)}`;
      const row = `"${label}" with ${count.text}`;
      const m = mock.rows[id];
      const s = got.rows[id];
      if (s === undefined) {
        fail(where, `the entry ${row} is not in the sidebar`);
        continue;
      }
      // Where the parts of the row sit: the indent of the glyph and of the label from the row's start, the row's width, and where the digits end (7 px inside the row's end, as the mock's count does).
      const from = (box, row_) => box[0] - row_[0];
      const parts = [
        ['the row', s.row[2], m.row[2]],
        ['the glyph', from(s.glyph, s.row), from(m.glyph, m.row)],
        ['the label', from(s.label, s.row), from(m.label, m.row)],
        ['the label\'s text', s.text, m.text],
        ['the digits\' end', s.row[0] + s.row[2] - (s.digits[0] + s.digits[2]), m.row[0] + m.row[2] - (m.count[0] + m.count[2])],
      ];
      for (const [name, here_, there] of parts) if (!near(here_, there)) fail(where, `${name} of ${row} sits ${text(here_)} in, the mock's ${text(there)}`);
      // The label and the slot of its count share the row as the mock's label and count do: what the slot holds is what the label has less.
      if (!near(s.label[2] + s.slot[2], m.label[2] + m.count[2])) fail(where, `the label and the count of ${row} do not share the row as the mock's do: ${text(s.label[2])} and ${text(s.slot[2])} against ${text(m.label[2])} and ${text(m.count[2])}`);
      slots.push(s.slot[2]);
      if (REMOVE !== 'slot-wide') {
        // A count that fills the slot (three characters) leaves the label the room it has in the mock, and so cuts it when the mock's is cut and not when it is not.
        if (c >= 2 && s.cut !== m.cut) fail(where, `the room a label is given beside its count differs from the mock's: ${row} is ${s.cut ? '' : 'not '}cut here and ${m.cut ? '' : 'not '}cut in the mock (room ${text(s.label[2])}, the mock's ${text(m.label[2])})`);
      }
    }
  }
  // The slot is held at one width for every count that fits it, and that width is the mock's widest count of three characters and no more: a label is given the room that is left.
  if (new Set(slots.map((width) => width.toFixed(2))).size !== 1) fail(where, `the slot of a count is not held at one width whatever the count: ${[...new Set(slots.map(text))].join(', ')}`);
  if (REMOVE !== 'slot-wide' && !(slots[0] >= wanted - 0.01 && slots[0] <= wanted + 2)) fail(where, `the room a label is given beside its count differs from the mock's: the slot holds ${text(slots[0] ?? 0)}, the mock's widest count of three characters is ${text(wanted)}`);

  // A label that is cut says its whole name when it is pointed at, and one that is not says nothing: the kit's tooltip, the mock's clipped-cell tip (it measures when the pointer arrives, never in advance).
  const tipped = async (id, wait) => {
    await page.mouse.move(1, 1);
    await sleep(120);
    const target = page.locator(`[role=treeitem][data-id="${id}"] > :nth-child(2)`);
    await target.hover();
    try {
      // The tooltip opens after 500 ms: a label that says nothing is waited for a little longer than that, one that says its name for as long as a slow runner needs.
      await page.waitForSelector('[role=tooltip]:popover-open', { timeout: wait });
    } catch {
      return null;
    }
    return page.evaluate(() => document.querySelector('[role=tooltip]:popover-open')?.textContent ?? null);
  };
  const cutId = `${String(NAMES_LABELS.length - 1)}-${String(widest)}`;
  const fitId = `0-${String(widest)}`;
  if (REMOVE !== 'names-no-tip') {
    if (got.rows[cutId]?.cut !== true) fail(where, `the probe has no label that is cut to point at: ${cutId}`);
    const said = await tipped(cutId, 3000);
    if (said === null || !said.includes(NAMES_LABELS.at(-1))) fail(where, `a label that is cut does not say its whole name when it is pointed at: ${JSON.stringify(said)}`);
  }
  const quiet = await tipped(fitId, 900);
  if (quiet !== null) fail(where, `a label that is not cut says something when it is pointed at (${JSON.stringify(quiet)}): a tip never repeats what is drawn`);
  await page.mouse.move(1, 1);
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
/** What every tab of the strip draws, as the mock's reading (mock-strip-text-measure.mjs) has it: the face, the glyph, the room of the text, the title and its head and tail, the qualifier. The button is not read: the mock's is inside its face's 1 px border, this one fills its face, and the glyph and the text say where it ends. Code that runs in the page. */
const READ_TEXT = () => {
  const r2 = (value) => Math.round(value * 100) / 100;
  const rect = (el) => {
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return [r2(box.x), r2(box.y), r2(box.width), r2(box.height)];
  };
  const textWidth = (el) => {
    if (!el) return null;
    const range = document.createRange();
    range.selectNodeContents(el);
    return r2(range.getBoundingClientRect().width);
  };
  return [...document.querySelectorAll('[data-shell-part="tab"]')].map((face) => {
    const button = face.querySelector('[role=tab]');
    const content = button.children[1];
    const title = content.children[0];
    const head = title.children[0];
    const tail = title.children[1] ?? null;
    const qualifier = content.children[1] ?? null;
    // The mock's content box is the room its title and qualifier have; this one reserves the close control's 24 px as padding at its end, which is not room for text.
    const room = rect(content);
    if (room !== null) room[2] = r2(room[2] - parseFloat(getComputedStyle(content).paddingInlineEnd));
    return { face: rect(face), lead: rect(button.querySelector('svg')), content: room, title: rect(title), head: rect(head), headCut: head.scrollWidth > head.clientWidth, headText: textWidth(head), tail: rect(tail), tailText: tail === null ? null : textWidth(tail.firstElementChild), qualifier: rect(qualifier), qualifierText: qualifier === null ? null : qualifier.textContent };
  });
};

/** The tabs of a case, as the fixture opens them (`?case=titles`): read the same way, in the same font, as the mock's. */
async function readText(browser, engine, viewport, origin, pages, perturb) {
  const { page, context, errors } = await open(browser, fixtureUrl(origin, `case=titles&pages=${encodeURIComponent(JSON.stringify(pages))}`), viewport);
  await normalizeFont(page, { rootVar: '--ov-font-ui' });
  if (perturb !== undefined) await page.evaluate(perturb);
  await sleep(200);
  const got = await page.evaluate(READ_TEXT);
  await context.close();
  return { got, errors };
}

/** The rectangles of one tab of the shell against the mock's, within 1 px: the problems, one line for each part that is where the mock's is not (or that one engine draws and the other does not). */
function textDifferences(mock, got) {
  const problems = [];
  const near = (name, a, b) => {
    if (a === null && b === null) return;
    if (a === null || b === null) {
      problems.push(`${name}: ${a === null ? 'the mock draws none' : 'the shell draws none'}`);
      return;
    }
    for (const k of [0, 1, 2, 3]) if (Math.abs(a[k] - b[k]) > 1) problems.push(`${name}[${'xywh'[k]}]: mock ${a[k]} shell ${b[k]}`);
  };
  for (const part of ['face', 'lead', 'content', 'title', 'head', 'tail', 'qualifier']) near(part, mock[part], got[part]);
  if (mock.headCut !== got.headCut) problems.push(`the head is ${got.headCut ? '' : 'not '}cut, the mock's is ${mock.headCut ? '' : 'not '}cut`);
  for (const part of ['headText', 'tailText']) if ((mock[part] === null) !== (got[part] === null) || (mock[part] !== null && Math.abs(mock[part] - got[part]) > 1)) problems.push(`${part}: mock ${String(mock[part])} shell ${String(got[part])}`);
  if (mock.qualifierText !== got.qualifierText) problems.push(`the qualifier reads ${JSON.stringify(got.qualifierText)}, the mock's ${JSON.stringify(mock.qualifierText)}`);
  return problems;
}

/**
 * Where a tab's title is cut (S3, demo finding D4). Every case of strip-text-cases.mjs that is about a title, drawn by the shell and by the mock's own strip: the faces are 208 px with a lone tab and with the strip half empty (S17a: equal,
 * 96 to 208 px, "Small counts stop growing at 208px; remaining space belongs to the native drag lane"), a title of twelve graphemes or fewer is one part, a longer one is a head that ends in an ellipsis and a tail that keeps its end, and
 * every part is where the mock's is and is cut as the mock's is. The demo's `{name} · {Kind}` title (28 graphemes) does not fit the 148 px a 208 px face leaves its text, in the mock as it does not here: the head gives way and the tail
 * loses its start. That is the design; a tab's tooltip carries the whole identity ("Preserve full identity despite visual truncation", S17).
 */
async function titles(browser, engine, viewportName, viewport, origin) {
  for (const { id, pages } of TEXT_CASES.filter(({ id: name }) => !name.startsWith('twin') && name !== 'lone-scoped')) {
    const where = `titles ${engine} ${viewportName} ${id}`;
    const perturb = CONTROL === 'title-cut' ? () => document.querySelectorAll('[data-shell-part="tab"] [role=tab] > :nth-child(2) > :first-child > :nth-child(2)').forEach((tail) => tail.remove()) : undefined;
    const { got, errors } = await readText(browser, engine, viewport, origin, pages, perturb);
    const mock = textReference.data[engine][viewportName][id];
    report.titles[`${engine} ${viewportName} ${id}`] = { got, mock };
    if (got.length !== mock.length) {
      fail(where, `the shell draws ${got.length} tabs, the mock ${mock.length}`);
      continue;
    }
    // With the control's assertion left out (ASSERTION_OFF=title-cut) the section reads and checks nothing: a title whose tail is not drawn must then pass.
    if (REMOVE !== 'title-cut') {
      got.forEach((tab, index) => {
        const subject = `"${pages[index].title}"`;
        for (const problem of textDifferences(mock[index], tab)) {
          // A control that takes the tail away is seen as the tail of the demo's own title not being drawn.
          fail(where, problem.startsWith('tail') || problem.startsWith('tailText') ? `the tail of ${subject} is not where the mock's is: ${problem}` : `the title ${subject} is not cut as the mock's is: ${problem}`);
        }
      });
    }
    // What the spec says, whatever the mock does: a lone tab is 208 px whatever its title (S17a: equal faces, 208 px at most; a title does not widen its face), and a strip of twelve gives each 96 px at the least; the first tab's
    // title is one part when it has twelve graphemes or fewer.
    if (REMOVE !== 'title-cut') {
      const first = got[0];
      if (pages.length === 1 && Math.abs(first.face[2] - 208) > 0.01) fail(where, `the face is ${first.face[2]} px wide, wanted 208 (S17a: equal faces, 208 px at most, whatever the title)`);
      if (pages.length === 12 && first.face[2] < 95.99) fail(where, `the face is ${first.face[2]} px wide, wanted 96 at the least`);
      const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(pages[0].title)].length;
      if ((graphemes <= 12) !== (first.tail === null)) fail(where, `a title of ${graphemes} graphemes has ${first.tail === null ? 'no tail' : 'a tail'}: twelve or fewer is one part, longer is a head and a tail`);
      if (id === 'short' && first.headCut) fail(where, 'a short title is cut');
      if (id === 'named-kind' && !first.headCut) fail(where, 'the demo\'s title fits 148 px: it is the one that does not (the mock cuts it too)');
    }
    for (const error of errors) fail(`errors ${where}`, error);
  }
}

/** The qualifier each tab of a twin case draws, in the order of its tabs: what tells twins apart, and nothing on a tab that reads like no other. */
const QUALIFIERS = {
  'lone-scoped': [null],
  twins: ['north', 'south'],
  'twins-and-other': ['north', 'south', null],
  'twins-long': ['production-europe-west', 'production-america-east'],
  'twins-cut': ['north', 'south'],
};

/**
 * What tells two tabs apart (S3, demo finding D8). The tab strip of the mock shows no scope by default: "the muted 12px text after the title is a DISAMBIGUATOR. It shows only on tabs that would otherwise read the same", and then the
 * shortest text that tells them apart. A lone tab says none (a window has one connection and the tab strip names none), twins say theirs, a tab that reads like no other says none whatever the others do, and the qualifier gives way
 * before the title does (it keeps room for five characters at least, from a content width of 64 px). Every part of every tab is where the mock's is and the qualifier reads as the mock's does.
 */
async function twins(browser, engine, viewportName, viewport, origin) {
  for (const { id, pages } of TEXT_CASES.filter(({ id: name }) => name.startsWith('twin') || name === 'lone-scoped')) {
    const where = `twins ${engine} ${viewportName} ${id}`;
    // The perturbations of the controls: a tab that has no twin draws a scope of its own, and twins that draw none.
    const perturb =
      CONTROL === 'twin-lone'
        ? () => document.querySelectorAll('[data-shell-part="tab"] [role=tab]').forEach((button) => button.children[1].children.length === 1 && button.children[1].insertAdjacentHTML('beforeend', '<span>north</span>'))
        : CONTROL === 'twin-hidden'
          ? () => document.querySelectorAll('[data-shell-part="tab"] [role=tab]').forEach((button) => button.children[1].children[1]?.remove())
          : undefined;
    const { got, errors } = await readText(browser, engine, viewport, origin, pages, perturb);
    const mock = textReference.data[engine][viewportName][id];
    report.twins[`${engine} ${viewportName} ${id}`] = { got, mock };
    if (got.length !== mock.length) {
      fail(where, `the shell draws ${got.length} tabs, the mock ${mock.length}`);
      continue;
    }
    // With the assertion of a twin control left out (ASSERTION_OFF) the tabs are not compared with the mock's and that control's explicit check is not made: its perturbation must then pass.
    if (REMOVE !== 'twin-lone' && REMOVE !== 'twin-hidden') {
      got.forEach((tab, index) => {
        for (const problem of textDifferences(mock[index], tab)) fail(where, `tab ${index + 1}: ${problem}`);
      });
    }
    // What the spec says, whatever the mock does: the qualifier each tab draws is the one the case names (so that a shell and a mock that both draw nothing are not taken for agreeing).
    const drawn = got.map((tab) => tab.qualifierText);
    const wanted = QUALIFIERS[id];
    wanted.forEach((qualifier, index) => {
      if (qualifier === null && drawn[index] !== null && REMOVE !== 'twin-lone') fail(where, `a tab that reads like no other draws a scope: tab ${index + 1} says ${JSON.stringify(drawn[index])}`);
      if (qualifier !== null && drawn[index] !== qualifier && REMOVE !== 'twin-hidden') fail(where, `tabs that read alike do not tell themselves apart: tab ${index + 1} says ${JSON.stringify(drawn[index])}, wanted ${JSON.stringify(qualifier)}`);
    });
    for (const error of errors) fail(`errors ${where}`, error);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
/**
 * The sidebar's groups survive a plugin's unload (S3, demo finding D5: after a plugin was killed and came back the groups that were open were all closed again, while the page and the tabs returned). On the host fixture with two
 * groups the page on screen is in `group`: the user opens `second` and closes `group`, the plugin's interface is taken away (the sidebar leaves with it, its rail entry and the tab stay) and given back, and the sidebar is as the
 * user left it: `second` open, `group` closed, though the page's entry is inside it (coming back is not a change of page). The host's hook for the plugin's counts is told the groups that are open on screen, and the same
 * list when the plugin returns (it runs only while the plugin does). What a restart of the window does is the session's (S3a lists the groups as not saved): this is the window's life.
 */
async function memory(browser, engine, viewportName, viewport, origin) {
  const where = `memory ${engine} ${viewportName}`;
  const { page, context, errors } = await open(browser, hostUrl(origin, 'groups=2&dataMs=50&nodesMs=50&loadMs=50&inventoryMs=20'), viewport);
  await page.waitForSelector('[role=treeitem][data-id="gadgets"], [role=treeitem][data-id="widgets"]');
  const state = () => page.evaluate(() => Object.fromEntries(['group', 'second'].map((id) => [id, document.querySelector(`[role=treeitem][data-id="${id}"]`)?.getAttribute('aria-expanded') ?? null])));
  const told = () => page.evaluate(() => (window.__sidebarOpen ?? []).at(-1) ?? null);
  const group = page.locator('[role=treeitem][data-id="group"]');
  const second = page.locator('[role=treeitem][data-id="second"]');
  const before = await state();
  if (before.group !== 'true' || before.second !== 'false') fail(where, `the sidebar does not start with the page's group open and the other closed: ${JSON.stringify(before)}`);
  await second.click();
  await group.click();
  const left = await state();
  if (left.group !== 'false' || left.second !== 'true') fail(where, `the user's clicks did not open the second group and close the first: ${JSON.stringify(left)}`);
  if (JSON.stringify(await told()) !== JSON.stringify(['second'])) fail(where, `the host was not told that only the second group is open: ${JSON.stringify(await told())}`);

  // The plugin's interface leaves: the sidebar's tree is gone (and with it the plugin's hook, which is told nothing while it is not running).
  await page.evaluate(() => window.__plugin.unload('alpha'));
  await page.waitForSelector('[role=tree]', { state: 'detached', timeout: 10_000 });
  if ((await page.getByRole('tab', { name: 'Widgets' }).count()) !== 1) fail(where, 'the tab left with the plugin');
  // And comes back: the same sidebar, with no reload of the window.
  await page.evaluate(() => window.__plugin.reload('alpha'));
  await page.waitForSelector('[role=tree]', { timeout: 10_000 });
  await page.waitForSelector('[role=treeitem][data-id="second"]');
  // The perturbation of the control: what a sidebar that remembered nothing would draw, the page's group open and the other closed.
  if (CONTROL === 'memory-lost') {
    await second.click();
    await group.click();
  }
  await sleep(150);
  const after = await state();
  if (REMOVE !== 'memory-lost') {
    if (after.group !== 'false' || after.second !== 'true') fail(where, `the sidebar does not come back as the user left it: ${JSON.stringify(after)}, wanted the second group open and the first closed`);
    if (JSON.stringify(await told()) !== JSON.stringify(['second'])) fail(where, `the sidebar does not come back as the user left it: the host was told ${JSON.stringify(await told())}, wanted the second group`);
  }
  report.memory[`${engine} ${viewportName}`] = { before, left, after, told: await page.evaluate(() => window.__sidebarOpen ?? []) };
  if (SHOTS && CONTROL === '') await page.screenshot({ path: path.join(SHOTS, `sidebar-after-restart-${engine}-${viewportName}.png`) });
  for (const error of errors) fail(`errors ${where}`, error);
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------------
const production = await serveFixtures(buildFixtures('production'));
const SECTIONS = { names, titles, twins, memory };

for (const engineName of engineNames) {
  const browser = await (engineName === 'chromium' ? ENGINES.chromium.launch({ args: ['--font-render-hinting=none'] }) : ENGINES[engineName].launch());
  for (const viewportName of viewportNames) {
    const viewport = NATIVE_VIEWPORTS[viewportName];
    // A control runs the one section it is for; ONLY runs the one a developer names; otherwise every section runs.
    const wanted = CONTROL !== '' ? [PERTURBATIONS[CONTROL].section] : ONLY !== '' ? [ONLY] : SECTION_NAMES;
    for (const name of wanted) await SECTIONS[name](browser, engineName, viewportName, viewport, production.origin);
    console.log(engineName, viewportName, 'done');
  }
  await browser.close();
}

production.server.close();
if (process.env.REPORT) writeFileSync(process.env.REPORT, `${JSON.stringify(report, null, 2)}\n`);
if (CONTROL !== '') {
  const detected = failures.filter((line) => PERTURBATIONS[CONTROL].expected.test(line));
  console.log(`\nwhat the probe saw with the perturbation "${CONTROL}": ${failures.length} differences\n${failures.map((line) => `  ${line}`).join('\n')}`);
  console.log(detected.length > 0 ? `\nNEGATIVE CONTROL "${CONTROL}": detected (${detected.length} differences, e.g. ${detected[0]})` : `\nNEGATIVE CONTROL "${CONTROL}": NOT DETECTED (${failures.length} other failures)`);
  process.exit(detected.length > 0 ? 0 : 1);
}
if (failures.length > 0) {
  console.error(`\n${failures.length} failures:\n${failures.map((line) => `  ${line}`).join('\n')}`);
  process.exit(1);
}
console.log('\ntour probe: no failures');
