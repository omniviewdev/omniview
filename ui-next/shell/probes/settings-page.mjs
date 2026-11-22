// Section `page` of the Settings probe: the settings PAGE as the sheet draws it (the Settings window draws the same body, which the section `window` reads), against the design mock's own Settings page (mock-settings.json, measured by
// mock-settings-measure.mjs from the mock's Settings tab on its Terminal page in WebKit and Chromium at 1440 x 900 and 1280 x 800, in Void and Light). What the 16 row cases of the kit's form probe hold (a row's own parts) is not repeated:
// this is the page around the rows.
//
//   nav        a page's row in the navigation against the mock's tree row: its height, the pitch of two rows, the inset from the navigation's edge, its type and its radius                                  page.nav
//   navstates  the paint of that row in the states rest, hover and focus (a keyboard focus), for another page's row and for the page on screen, exactly, in Void and Light                          page.navstates
//   group      the group's label ("Core") and its row against the mock's group row                                                                                                                page.group
//   heading    the page heading against the mock's: the title's and the description's type and colour, the title's lane and the description under it, a description that is one line                     page.heading.*
//   list       where the rows start under the heading (the mock's section titles are not built, so the mock's own gap is the reference), the rows in the host's order, each row as high as its content makes it       page.list.*, page.rows.*
//              (6 + 16 + the description's one or two lines + the 16 px lane + 6: S126), the separators between rows, and the column the controls end in
//   scroll     the pane scrolls and nothing else does: the heading goes with the rows, the navigation and the header stay, the last row has the page's inset under it, and a new page starts at the top, as the mock's does   page.scroll.*
//   states     loading, could not load and nothing to show, against the mock's page states (`.settings-state`), and what each does                                                                  page.states.*
//   paint      the tokens the page's paint names, resolved in each of the nine themes                                                                                                            page.paint
//
// What the shell does not draw and the mock does (each is the shell's decision, docs/ui-next/status/ST1.md section 4): the sections the rows are grouped in, the status slot and the page menu at the end of the heading, a glyph and
// a tree toggle on each row of the navigation, the search above it, the Plugins group, the 244 px width (the original window's 212 is used), and a skeleton for loading. They are counted and printed, never compared.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, fail, goToPage, near, note, openFixture, openSheet, PAGES, plant, round, sleep, THEMES, wants } from './settings-lib.mjs';
import { NAV_STATES, PARTS, readNavStates, readParts, readStyles } from './settings-targets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MOCK = JSON.parse(readFileSync(path.join(here, 'mock-settings.json'), 'utf8')).data;
const mockOf = (env, theme) => MOCK[env.engine][env.viewportName][theme];
const REFERENCE_THEMES = ['void', 'light'];

/** The sheet open on a page of the fixture, the keyboard and the pointer away from it, as a reading of the page at rest wants. */
async function openOn(env, pageId, { theme, query = 'case=sheet' } = {}) {
  const opened = await openFixture(env, query, { theme });
  await openSheet(opened.page);
  if (pageId !== undefined) await goToPage(opened.page, pageId);
  await plant(env, opened.page);
  await opened.page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await opened.page.mouse.move(2, 2);
  await sleep(150);
  return opened;
}

const reading = async (page) => ({ parts: await readParts(page, PARTS, 'shell'), styles: await readStyles(page, PARTS, 'shell') });
const box = (r, name, index = 0) => r.parts[name]?.[index] ?? null;
const style = (r, name, key) => r.styles[name]?.[key];
const sameStyle = (where, id, what, mock, shell, name, keys) => {
  for (const key of keys) {
    const was = style(mock, name, key);
    const now = style(shell, name, key);
    check(was === now, where, id, `${what}: ${key} is ${JSON.stringify(now)}, the mock's is ${JSON.stringify(was)}`);
  }
};

// ---------------------------------------------------------------------------------------------------------------------------
async function navPart(env) {
  for (const theme of REFERENCE_THEMES) {
    const where = `${env.engine}@${env.viewportName} ${theme}`;
    const { page, context } = await openOn(env, 'terminal', { theme });
    try {
      const shell = await reading(page);
      const mock = mockOf(env, theme);
      const [first, second, third] = ['navFirst', 'navSecond', 'navThird'].map((name) => box(shell, name));
      const [mFirst, mSecond, mThird] = ['navFirst', 'navSecond', 'navThird'].map((name) => box(mock, name));
      if ([first, second, third].includes(null)) {
        fail(where, 'page.nav', 'the navigation does not draw the rows of Appearance, General and Editor');
        continue;
      }
      if (theme === 'void') {
        check(near(first[3], mFirst[3]), where, 'page.nav', `a page's row is ${first[3]} px high, the mock's tree row ${mFirst[3]}`);
        check(near(second[3], mSecond[3]) && near(third[3], mThird[3]), where, 'page.nav', `the rows are ${second[3]} and ${third[3]} px high, the mock's ${mSecond[3]} and ${mThird[3]}`);
        check(near(second[1] - first[1], mSecond[1] - mFirst[1]) && near(third[1] - second[1], mThird[1] - mSecond[1]), where, 'page.nav', `two rows are ${round(second[1] - first[1])} px apart, the mock's ${mSecond[1] - mFirst[1]}`);
        const navBox = box(shell, 'nav');
        const mNav = box(mock, 'nav');
        // The mock's rows stand 5 px inside the navigation (its tree owns that inset, X5); 5 is not on the closed spacing scale, so the shell's is 6. One pixel is the tolerance of x everywhere in the probes.
        check(near(first[0] - navBox[0], mFirst[0] - mNav[0], 1.01), where, 'page.nav', `a row starts ${round(first[0] - navBox[0])} px inside the navigation, the mock's ${mFirst[0] - mNav[0]}`);
      }
      sameStyle(where, 'page.nav', 'a page\'s row', mock, shell, 'navFirst', ['color', 'borderTopLeftRadius', 'fontSize', 'fontWeight', 'lineHeight', 'paddingTop', 'paddingBottom', 'backgroundColor']);
    } finally {
      await context.close();
    }
  }
}

async function navStatesPart(env) {
  for (const theme of REFERENCE_THEMES) {
    const where = `${env.engine}@${env.viewportName} ${theme}`;
    const { page, context } = await openOn(env, 'terminal', { theme });
    try {
      const states = await readNavStates(page, 'shell');
      const mock = mockOf(env, theme).navStates;
      for (const target of NAV_STATES) {
        for (const state of ['rest', 'hover', 'focus']) {
          const was = mock[target.name]?.[state];
          const now = states[target.name]?.[state];
          if (was === undefined || now === undefined) {
            fail(where, 'page.navstates', `${target.name} ${state}: not read`);
            continue;
          }
          if (state === 'hover') check(now.matches.hover, where, 'page.navstates', `${target.name} hover: the row is not hovered`);
          if (state === 'focus') check(now.matches.focus && now.matches.focusVisible, where, 'page.navstates', `${target.name} focus: the row does not have a keyboard focus`);
          for (const key of ['fill', 'color', 'radius', 'outline']) check(was[key] === now[key], where, 'page.navstates', `${target.name} ${state} ${key}: the mock's is ${was[key]}, the shell's ${now[key]}`);
        }
      }
    } finally {
      await context.close();
    }
  }
}

async function groupPart(env) {
  const where = `${env.engine}@${env.viewportName} void`;
  const { page, context } = await openOn(env, 'terminal');
  try {
    const shell = await reading(page);
    const mock = mockOf(env, 'void');
    // The mock's group is a tree row (24 px, a toggle and a glyph, its label in 600 at 13 px in the text colour); the shell's is a label.
    const group = box(shell, 'navGroup');
    const mGroup = box(mock, 'navGroup');
    const first = box(shell, 'navFirst');
    const mFirst = box(mock, 'navFirst');
    if (group === null || first === null) return fail(where, 'page.group.label', 'the navigation has no group label');
    check(near(group[3], mGroup[3]), where, 'page.group.size', `the group's row is ${group[3]} px high, the mock's ${mGroup[3]}`);
    check(near(first[1] - (group[1] + group[3]), mFirst[1] - (mGroup[1] + mGroup[3])), where, 'page.group.size', `the first page's row is ${round(first[1] - (group[1] + group[3]))} px under the group, the mock's ${mFirst[1] - (mGroup[1] + mGroup[3])}`);
    const type = (r) => `${style(r, 'navGroupLabel', 'fontSize')} ${style(r, 'navGroupLabel', 'fontWeight')} ${style(r, 'navGroupLabel', 'color')}`;
    check(type(shell) === type(mock), where, 'page.group.size', `the group's label is ${type(shell)}, the mock's ${type(mock)}`);
    const facts = await page.evaluate(() => {
      const label = document.querySelector('[data-settings-part="nav"] > [aria-hidden="true"]');
      const group = document.querySelector('[data-settings-part="nav"] [role="group"]');
      return { text: label?.textContent, named: group?.getAttribute('aria-label'), tabbable: label?.matches('a, button, [tabindex]') ?? false };
    });
    check(facts.text === 'Core' && facts.named === 'Core', where, 'page.group.label', `the group says ${JSON.stringify(facts.text)} and the list is named ${JSON.stringify(facts.named)}, wanted Core twice (the label is for the eye, the list's name for assistive technology)`);
    check(!facts.tabbable, where, 'page.group.label', 'the group\'s label is a tab stop');
  } finally {
    await context.close();
  }
}

async function headingPart(env) {
  for (const theme of REFERENCE_THEMES) {
    const where = `${env.engine}@${env.viewportName} ${theme}`;
    const { page, context } = await openOn(env, 'terminal', { theme });
    try {
      const shell = await reading(page);
      const mock = mockOf(env, theme);
      sameStyle(where, 'page.heading.type', 'the page title', mock, shell, 'title', ['color', 'fontSize', 'fontWeight', 'lineHeight']);
      sameStyle(where, 'page.heading.type', 'the description', mock, shell, 'subtitle', ['color', 'fontSize', 'fontWeight', 'lineHeight']);
      if (theme !== 'void') continue;
      const [heading, title, subtitle] = ['heading', 'title', 'subtitle'].map((name) => box(shell, name));
      const [mHeading, mTitle, mSubtitle] = ['heading', 'title', 'subtitle'].map((name) => box(mock, name));
      check(near(title[3], mTitle[3]), where, 'page.heading.lane', `the title's lane is ${title[3]} px high, the mock's ${mTitle[3]} (S124: a 28 px title lane)`);
      check(near(subtitle[1] - title[1], mSubtitle[1] - mTitle[1]), where, 'page.heading.lane', `the description starts ${round(subtitle[1] - title[1])} px under the title's top, the mock's ${mSubtitle[1] - mTitle[1]}`);
      check(near(heading[3], mHeading[3]), where, 'page.heading.lane', `the heading is ${heading[3]} px high, the mock's ${mHeading[3]}`);
      check(near(subtitle[3], mSubtitle[3]), where, 'page.heading.lane', `the description is ${subtitle[3]} px high, the mock's ${mSubtitle[3]}: one line`);
      sameStyle(where, 'page.heading.oneline', 'the description', mock, shell, 'subtitle', ['whiteSpace', 'overflowX', 'textOverflow']);
    } finally {
      await context.close();
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
/** The rows of the page on screen, from the page: the id, the rectangles of the row, its description and its trailing slot, the lines the description has. Runs in the page. */
const READ_ROWS = () => {
  const r2 = (value) => Math.round(value * 100) / 100;
  const rect = (element) => {
    if (element === null) return null;
    const b = element.getBoundingClientRect();
    return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)];
  };
  return [...document.querySelectorAll('[data-settings-row]')].map((row) => {
    const help = row.querySelector('[data-ov-part="help"]');
    const lane = row.querySelector('[data-ov-part="lane"]');
    const slot = row.querySelector('[data-ov-part="trailing"]');
    const control = row.querySelector('[data-ov-part="control"]');
    const shadow = getComputedStyle(row);
    return { id: row.getAttribute('data-settings-row'), row: rect(row), help: rect(help), lane: rect(lane), slot: rect(slot), control: rect(control), shadow: shadow.boxShadow, border: shadow.borderTopWidth };
  });
};

async function listPart(env) {
  const where = `${env.engine}@${env.viewportName} void`;
  const { page, context } = await openOn(env, 'terminal');
  try {
    const shell = await reading(page);
    const mock = mockOf(env, 'void');
    const heading = box(shell, 'heading');
    const list = box(shell, 'list');
    const mHeading = box(mock, 'heading');
    const mList = box(mock, 'list');
    const mSection = box(mock, 'sectionHead');
    // The mock puts a section title (16 px) and 8 px under it between its heading's margin and its first row; the host declares no sections, so the rows follow the heading's margin at once.
    const wanted = mList[1] - (mHeading[1] + mHeading[3]) - (mSection[3] + 8);
    check(near(list[1] - (heading[1] + heading[3]), wanted), where, 'page.list.start', `the rows start ${round(list[1] - (heading[1] + heading[3]))} px under the heading, the mock's ${wanted} (its 12 px margin, without the section title the host does not declare)`);
    // Every page: the host's order, the height each row's content makes it, no gap between two rows, the separator (the mock's own, which the first row does not have), the column the controls end in.
    const wantSeparator = style(mock, 'row#1', 'boxShadow');
    const wantFirst = style(mock, 'row#0', 'boxShadow');
    for (const entry of PAGES) {
      await goToPage(page, entry.id);
      await plant(env, page, 'rows');
      await sleep(80);
      const rows = await page.evaluate(READ_ROWS);
      const here_ = `${where} ${entry.id}`;
      check(rows.length > 0, here_, 'page.rows.order', 'the page draws no rows');
      const ids = rows.map((row) => row.id);
      const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      check(JSON.stringify(ids) === JSON.stringify(sorted), here_, 'page.rows.order', `the rows are ${ids.slice(0, 4).join(', ')}..., not in the host's order (by id)`);
      rows.forEach((row, index) => {
        const lines = row.help === null ? 0 : Math.min(32, row.help[3]);
        const want = 6 + 16 + lines + 16 + 6;
        check(row.lane !== null && near(row.lane[3], 16), here_, 'page.rows.height', `${row.id} has no 16 px lane reserved (${JSON.stringify(row.lane)})`);
        check(near(row.row[3], want), here_, 'page.rows.height', `${row.id} is ${row.row[3]} px high, its content makes it ${want} (6 + 16 + ${lines} + 16 + 6)`);
        if (index > 0) check(near(row.row[1], rows[index - 1].row[1] + rows[index - 1].row[3]), here_, 'page.rows.pitch', `${row.id} starts ${round(row.row[1] - rows[index - 1].row[1] - rows[index - 1].row[3])} px under the row above it, wanted none`);
        check(row.slot !== null && near(row.slot[2], 24) && near(row.slot[3], 24), here_, 'page.rows.column', `${row.id} has a slot of ${JSON.stringify(row.slot?.slice(2))} for its Reset, wanted 24 x 24 in every row`);
        check(row.slot !== null && near(row.slot[0] + row.slot[2], row.row[0] + row.row[2], 1.01), here_, 'page.rows.column', `${row.id}'s slot ends at ${row.slot === null ? '?' : round(row.slot[0] + row.slot[2])}, not at the row's end ${round(row.row[0] + row.row[2])}`);
        if (index === 0) {
          check(row.shadow === wantFirst && row.border === '0px', here_, 'page.rows.separator', `the first row draws a separator (${row.shadow}, border ${row.border}), the mock's ${wantFirst}`);
        } else {
          check(row.shadow === wantSeparator, here_, 'page.rows.separator', `${row.id}'s separator is ${row.shadow}, the mock's ${wantSeparator}`);
          check(row.border === '0px', here_, 'page.rows.separator', `${row.id} has a border of ${row.border}: the separator is the list's, not a border`);
        }
      });
      const ends = new Set(rows.map((row) => round(row.control[0] + row.control[2])));
      check(ends.size === 1, here_, 'page.rows.column', `the controls' columns end at ${[...ends].join(', ')}: one column was wanted`);
    }
  } finally {
    await context.close();
  }
}

async function listLightPart(env) {
  // The separator's colour in Light, the other theme the mock was measured in.
  const where = `${env.engine}@${env.viewportName} light`;
  const { page, context } = await openOn(env, 'terminal', { theme: 'light' });
  try {
    const rows = await page.evaluate(READ_ROWS);
    const was = style(mockOf(env, 'light'), 'row#1', 'boxShadow');
    check(rows[1]?.shadow === was, where, 'page.rows.separator', `the second row's separator is ${rows[1]?.shadow}, the mock's ${was}`);
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function scrollPart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const { page, context } = await openOn(env, 'telemetry');
  try {
    const read = () =>
      page.evaluate(() => {
        const r2 = (value) => Math.round(value * 100) / 100;
        const rect = (element) => {
          const b = element.getBoundingClientRect();
          return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)];
        };
        const content = document.querySelector('[data-settings-part="content"]');
        const rows = [...document.querySelectorAll('[data-settings-row]')];
        const style = getComputedStyle(content);
        return {
          content: rect(content),
          top: content.scrollTop,
          scrollHeight: content.scrollHeight,
          clientHeight: content.clientHeight,
          overflowY: style.overflowY,
          overflowX: style.overflowX,
          overscroll: style.overscrollBehaviorY,
          nav: rect(document.querySelector('[data-settings-part="nav"]')),
          navTop: document.querySelector('[data-settings-part="nav"]').scrollTop,
          header: rect(document.querySelector('dialog [data-ov-part="header"]') ?? document.querySelector('[data-settings-part="caption"]')),
          heading: rect(document.querySelector('[data-settings-part="page"] > header')),
          lastRow: rect(rows[rows.length - 1]),
          rows: rows.length,
        };
      });
    const at = await read();
    check(at.overflowY === 'auto' && at.overflowX === 'hidden', where, 'page.scroll.pane', `the page's pane has overflow ${at.overflowX} / ${at.overflowY}, wanted hidden / auto`);
    check(at.overscroll === 'contain', where, 'page.scroll.pane', `the page's pane has overscroll-behavior ${at.overscroll}, wanted contain (a scroll that reaches its end does not scroll the page behind)`);
    check(at.scrollHeight > at.clientHeight + 100, where, 'page.scroll.pane', `Telemetry's ${at.rows} rows do not overflow the pane (${at.scrollHeight} in ${at.clientHeight}): the check needs a long page`);
    // A wheel over the page scrolls the page's pane, and the heading goes with the rows; the header and the navigation stay.
    const centre = [at.content[0] + at.content[2] / 2, at.content[1] + at.content[3] / 2];
    await page.mouse.move(centre[0], centre[1]);
    await page.mouse.wheel(0, 300);
    await page.waitForFunction(() => document.querySelector('[data-settings-part="content"]').scrollTop > 0, null, { timeout: 2000 }).catch(() => undefined);
    await sleep(150);
    const moved = await read();
    check(moved.top > 100, where, 'page.scroll.wheel', `a wheel of 300 px moved the page's pane ${moved.top} px`);
    check(near(moved.heading[1], at.heading[1] - moved.top, 1.01), where, 'page.scroll.wheel', `the heading is at ${moved.heading[1]} after a scroll of ${moved.top}, wanted ${round(at.heading[1] - moved.top)}: it goes with the rows`);
    check(JSON.stringify(moved.nav) === JSON.stringify(at.nav) && moved.navTop === 0, where, 'page.scroll.wheel', 'the navigation moved or scrolled with the page');
    check(JSON.stringify(moved.header) === JSON.stringify(at.header), where, 'page.scroll.wheel', 'the header moved with the page');
    // To the end: the last row stands the page's inset (24 px) above the pane's edge.
    await page.evaluate(() => {
      const content = document.querySelector('[data-settings-part="content"]');
      content.scrollTop = content.scrollHeight;
    });
    await sleep(120);
    const end = await read();
    check(near(end.content[1] + end.content[3] - (end.lastRow[1] + end.lastRow[3]), 24, 1.01), where, 'page.scroll.end', `the last row ends ${round(end.content[1] + end.content[3] - (end.lastRow[1] + end.lastRow[3]))} px above the pane's edge, wanted the page's 24 px inset`);
    // A new page starts at the top, as the mock's does (a page opened from a scrolled one is not left where the last one was).
    await goToPage(page, 'developer');
    await sleep(150);
    const next = await read();
    check(next.top === 0, where, 'page.scroll.reset', `Developer Settings opened scrolled ${next.top} px down (the page before was scrolled ${end.top}): a page starts at the top`);
    check(near(next.heading[1], next.content[1] + 16, 1.01), where, 'page.scroll.reset', `Developer Settings' heading is at ${next.heading[1]}, wanted ${round(next.content[1] + 16)}: the page's top is out of sight`);
    // A page that fits has nothing to scroll.
    await goToPage(page, 'appearance');
    await sleep(120);
    const short = await read();
    check(short.scrollHeight <= short.clientHeight, where, 'page.scroll.fits', `Appearance has three rows and scrolls (${short.scrollHeight} in ${short.clientHeight})`);
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
/** What a state of the body is: the box, the stack's children and their type, the Tab stops of the open sheet. Runs in the page. */
const READ_STATE = () => {
  const r2 = (value) => Math.round(value * 100) / 100;
  const rect = (element) => {
    if (element === null || element === undefined) return null;
    const b = element.getBoundingClientRect();
    return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)];
  };
  const type = (element) => {
    if (element === null || element === undefined) return null;
    const s = getComputedStyle(element);
    return `${s.fontSize}/${s.lineHeight} ${s.fontWeight} ${s.color}`;
  };
  const state = document.querySelector('[data-settings-state]');
  const body = document.querySelector('dialog [data-ov-part="body"]') ?? document.querySelector('[data-settings-part="window"]');
  const kids = state === null ? [] : [...state.children];
  const stops = [...document.querySelectorAll('dialog button, dialog input, dialog select, dialog [tabindex]')].filter((element) => element.getAttribute('tabindex') !== '-1').map((element) => element.getAttribute('aria-label') ?? element.textContent);
  return {
    kind: state?.getAttribute('data-settings-state') ?? null,
    role: state?.getAttribute('role') ?? null,
    text: state?.textContent ?? null,
    state: rect(state),
    body: rect(body),
    kids: kids.map((kid) => ({ tag: kid.tagName.toLowerCase(), rect: rect(kid), type: type(kid), text: kid.textContent })),
    stack: state === null ? null : (({ rowGap, alignItems, justifyContent, flexDirection, textAlign }) => ({ rowGap, alignItems, justifyContent, flexDirection, textAlign }))(getComputedStyle(state)),
    navs: document.querySelectorAll('[data-settings-part="nav"]').length,
    rows: document.querySelectorAll('[data-settings-row]').length,
    retry: rect(document.querySelector('[data-settings-part="retry"]')),
    focus: document.activeElement?.getAttribute('data-settings-part') ?? document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName.toLowerCase() ?? null,
    stops,
  };
};

async function statesPart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const centred = (r, id, what) => {
    const cx = r.state[0] + r.state[2] / 2 - (r.body[0] + r.body[2] / 2);
    const cy = r.state[1] + r.state[3] / 2 - (r.body[1] + r.body[3] / 2);
    check(Math.abs(cx) <= 1.5 && Math.abs(cy) <= 1.5, where, id, `${what} is ${round(cx)} px and ${round(cy)} px off the centre of the sheet's body`);
  };
  // Loading: the host has not answered. One line, a status, nothing to change but Close.
  {
    const { page, context } = await openFixture(env, 'case=sheet&host=held');
    try {
      await page.keyboard.press((await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+Comma' : 'Control+Comma');
      await page.waitForSelector('dialog[open] [data-settings-state="loading"]', { timeout: 10_000 });
      await plant(env, page);
      await sleep(150);
      const r = await page.evaluate(READ_STATE);
      check(r.role === 'status' && /^Loading settings/.test(r.text ?? ''), where, 'page.states.loading', `loading is a ${r.role} saying ${JSON.stringify(r.text)}, wanted a status that says Loading settings…`);
      check(r.navs === 0 && r.rows === 0, where, 'page.states.loading', `${r.navs} navigations and ${r.rows} rows while loading: nothing is to be changed yet`);
      check(JSON.stringify(r.stops) === JSON.stringify(['Close']), where, 'page.states.loading', `the Tab stops while loading are ${JSON.stringify(r.stops)}, wanted Close alone`);
      centred(r, 'page.states.loading', 'the loading line');
      await page.evaluate(() => window.__release());
      await page.waitForSelector('dialog[open] [data-settings-row]', { timeout: 5000 });
      const after = await page.evaluate(READ_STATE);
      check(after.kind === null && after.navs === 1, where, 'page.states.loading', 'the host\'s answer did not replace the loading line with the pages');
    } finally {
      await context.close();
    }
  }
  // Could not load: an alert with the one thing to do, the keyboard on it, and Retry asks again.
  {
    const { page, context } = await openFixture(env, 'case=sheet&host=failed');
    try {
      await page.keyboard.press((await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+Comma' : 'Control+Comma');
      await page.waitForSelector('dialog[open] [data-settings-state="failed"]', { timeout: 10_000 });
      await plant(env, page);
      await sleep(150);
      const r = await page.evaluate(READ_STATE);
      check(r.role === 'alert', where, 'page.states.failed', `could not load is a ${r.role}, wanted an alert`);
      check(r.kids.length === 3 && /Couldn.t load settings/.test(r.kids[0]?.text ?? '') && r.kids[2]?.tag === 'button' && r.kids[2]?.text === 'Retry', where, 'page.states.failed', `could not load draws ${JSON.stringify(r.kids.map((kid) => `${kid.tag}:${kid.text}`))}, wanted a title, a sentence and Retry`);
      check(r.focus === 'retry', where, 'page.states.failed', `the keyboard is on ${r.focus}, wanted Retry: the one thing to do`);
      check(JSON.stringify(r.stops) === JSON.stringify(['Close', 'Retry']), where, 'page.states.failed', `the Tab stops are ${JSON.stringify(r.stops)}, wanted Close and Retry`);
      centred(r, 'page.states.failed', 'the alert');
      // Against the mock's `H.empty` of a page that could not load: the title and the sentence's type, the 8 px between them and Retry, the button's height, everything centred.
      const mock = mockOf(env, 'void').failed;
      const shell = await reading(page);
      const [title, sentence, button] = r.kids.map((kid) => kid.rect);
      const mTitle = box(mock, 'stateTitle');
      const mText = box(mock, 'stateText');
      const mButton = box(mock, 'stateButton');
      sameStyle(where, 'page.states.type', 'the title', mock, shell, 'stateTitle', ['color', 'fontSize', 'fontWeight', 'lineHeight']);
      sameStyle(where, 'page.states.type', 'the sentence', mock, shell, 'stateText', ['color', 'fontSize', 'fontWeight', 'lineHeight']);
      check(near(sentence[1] - (title[1] + title[3]), mText[1] - (mTitle[1] + mTitle[3])), where, 'page.states.anatomy', `the sentence is ${round(sentence[1] - (title[1] + title[3]))} px under the title, the mock's ${mText[1] - (mTitle[1] + mTitle[3])}`);
      check(near(button[1] - (sentence[1] + sentence[3]), mButton[1] - (mText[1] + mText[3])), where, 'page.states.anatomy', `Retry is ${round(button[1] - (sentence[1] + sentence[3]))} px under the sentence, the mock's ${mButton[1] - (mText[1] + mText[3])}`);
      check(near(button[3], mButton[3]), where, 'page.states.anatomy', `Retry is ${button[3]} px high, the mock's ${mButton[3]}`);
      const centre = (rect) => rect[0] + rect[2] / 2;
      check(Math.abs(centre(title) - centre(sentence)) <= 1 && Math.abs(centre(title) - centre(button)) <= 1, where, 'page.states.anatomy', 'the title, the sentence and Retry do not share one centre');
      sameStyle(where, 'page.states.type', 'the stack', mock, shell, 'stateStack', ['textAlign', 'alignItems', 'flexDirection']);
      // Retry asks the host again: it answers this time, and the pages are there.
      const before = await page.evaluate(() => window.__host.calls.snapshot);
      await page.locator('[data-settings-part="retry"]').click();
      await page.waitForSelector('dialog[open] [data-settings-row]', { timeout: 5000 });
      const asked = (await page.evaluate(() => window.__host.calls.snapshot)) - before;
      check(asked === 1, where, 'page.states.failed', `Retry asked the host ${asked} times, wanted once`);
    } finally {
      await context.close();
    }
  }
  // Nothing to show: a host with no settings.
  {
    const { page, context } = await openFixture(env, 'case=sheet&host=empty');
    try {
      await page.keyboard.press((await page.evaluate(() => /mac/i.test(navigator.platform))) ? 'Meta+Comma' : 'Control+Comma');
      await page.waitForSelector('dialog[open] [data-settings-state="empty"]', { timeout: 10_000 });
      await plant(env, page);
      await sleep(150);
      const r = await page.evaluate(READ_STATE);
      check(r.role === null && /no settings/i.test(r.text ?? ''), where, 'page.states.empty', `nothing to show is a ${r.role} saying ${JSON.stringify(r.text)}, wanted a plain line that says the host has no settings`);
      check(r.navs === 0 && r.rows === 0, where, 'page.states.empty', `${r.navs} navigations and ${r.rows} rows for a host with no settings`);
      centred(r, 'page.states.empty', 'the empty line');
    } finally {
      await context.close();
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
/**
 * The paint the page's tokens name, in every theme: the selected row, a hovered row, a focused one, the title, the description, the group's label, a separator and the sheet's fill are read as the engine computes them and
 * compared with the token each is made of (a probe element resolves the token in the same place). Runs in the page; `theme` is flipped on <html> first.
 */
const READ_TOKENS = () => {
  const dialog = document.querySelector('dialog[open]') ?? document.body;
  const probe = document.createElement('div');
  dialog.append(probe);
  const resolve = (property, value) => {
    probe.style.cssText = `${property}: ${value}`;
    return getComputedStyle(probe)[property];
  };
  const q = (selector) => document.querySelector(selector);
  const selected = getComputedStyle(q('[data-settings-part="nav"] [aria-current="page"]'));
  const group = getComputedStyle(q('[data-settings-part="nav"] > [aria-hidden="true"]'));
  const title = getComputedStyle(q('[data-settings-part="page"] > header > h3'));
  const subtitle = getComputedStyle(q('[data-settings-part="page"] > header > p'));
  const rows = [...document.querySelectorAll('[data-settings-row]')];
  const frame = getComputedStyle(q('dialog [data-ov-part="frame"]') ?? q('[data-settings-part="window"]'));
  const result = {
    selectedFill: [selected.backgroundColor, resolve('background-color', 'var(--ov-selection-inactive)')],
    title: [title.color, resolve('color', 'var(--ov-fg)')],
    subtitle: [subtitle.color, resolve('color', 'var(--ov-fg-muted)')],
    group: [group.color, resolve('color', 'var(--ov-fg-muted)')],
    separator: [rows[1] === undefined ? 'none' : getComputedStyle(rows[1]).boxShadow.replace(/^(.*?\)).*$/, '$1'), resolve('color', 'var(--ov-border-subtle)')],
    frame: [frame.backgroundColor, resolve('background-color', 'var(--ov-bg-dialog)')],
  };
  probe.remove();
  return result;
};

async function paintPart(env) {
  const where = `${env.engine}@${env.viewportName}`;
  const { page, context } = await openOn(env, 'terminal');
  try {
    for (const theme of THEMES) {
      await page.evaluate((id) => document.documentElement.setAttribute('data-ov-theme', id), theme);
      await sleep(80);
      const read = await page.evaluate(READ_TOKENS);
      for (const [name, [got, token]] of Object.entries(read)) check(got === token, `${where} ${theme}`, 'page.paint', `${name} is ${got}, the token it names is ${token}`);
    }
  } finally {
    await context.close();
  }
}

/** Runs the parts of the section `page` for one engine and viewport. */
export async function pageSection(env) {
  const timed = async (part, run) => {
    const from = Date.now();
    await run(env);
    note('page', `seconds ${env.engine}@${env.viewportName} ${part}`, round((Date.now() - from) / 1000));
  };
  if (wants(env, 'nav')) await timed('nav', navPart);
  if (wants(env, 'navstates')) await timed('navstates', navStatesPart);
  if (wants(env, 'group')) await timed('group', groupPart);
  if (wants(env, 'heading')) await timed('heading', headingPart);
  if (wants(env, 'list')) {
    await timed('list', listPart);
    await timed('list light', listLightPart);
  }
  if (wants(env, 'scroll')) await timed('scroll', scrollPart);
  if (wants(env, 'states')) await timed('states', statesPart);
  if (wants(env, 'paint')) await timed('paint', paintPart);
}
