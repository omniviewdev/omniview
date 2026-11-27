// What the Settings probe compares of the settings PAGE, in one place: each part by the selector that finds it in the design mock (the reference, measured by mock-settings-measure.mjs into mock-settings.json from the mock's own
// Settings tab) and by the selector that finds it in the shell (data-settings-part and the kit's data-ov-part, written by ui-next/shell/settings and the kit). Page-agnostic: the same reading runs on both sides. A part with `all` is
// every element that matches, in document order; the others are the first.
//
// The mock's settings are not the host's (its Terminal page has seven rows of kinds the host does not declare, in sections the host does not group them in), so what is compared is what does not depend on the words: the page's
// navigation rows (their height, their pitch, their inset from the navigation's own edge and their paint in each state), the heading's lane (the title's and the description's rectangles and type), where the list of rows starts, the
// separator between two rows, and the page states (what the page says when it cannot load): their anatomy, type and paint. The rows themselves are the form probe's (packages/kit/probes/form-probe.mjs: 16 cases of `H.settingRow`).

/** The parts of the page. `mock` is relative to the whole document; the mock's Settings page is `.settings-page` in the island, its sidebar `.settings-nav`. */
export const PARTS = [
  { name: 'nav', mock: '.settings-nav', shell: '[data-settings-part="nav"]' },
  { name: 'navFirst', mock: '.settings-nav .tree__row[data-key="appearance"]', shell: '[data-settings-part="tree"] [data-settings-page="appearance"]' },
  { name: 'navSecond', mock: '.settings-nav .tree__row[data-key="general"]', shell: '[data-settings-part="tree"] [data-settings-page="general"]' },
  { name: 'navThird', mock: '.settings-nav .tree__row[data-key="editor"]', shell: '[data-settings-part="tree"] [data-settings-page="editor"]' },
  { name: 'navSelected', mock: '.settings-nav .tree__row[aria-selected="true"]', shell: '[data-settings-part="tree"] [data-settings-page][aria-current="page"]' },
  { name: 'navGroup', mock: '.settings-nav .tree__row[data-key="core"]', shell: '[data-settings-branch="core"]' },
  { name: 'navGroupLabel', mock: '.settings-nav .tree__row[data-key="core"] .tree__label', shell: '[data-settings-branch="core"] [data-settings-part="tree-label"]' },
  { name: 'rowTitle', mock: '.settings-page .setting-row .setting-row__title', shell: '[data-settings-row] [data-ov-part="label"]' },
  { name: 'rowText', mock: '.settings-page .setting-row .setting-row__text', shell: '[data-settings-row] [data-ov-part="text"]' },
  { name: 'page', mock: '.settings-page', shell: '[data-settings-part="page"]' },
  { name: 'heading', mock: '.settings-page .heading', shell: '[data-settings-part="page"] > header' },
  { name: 'title', mock: '.settings-page .heading h1', shell: '[data-settings-part="page"] > header > :first-child' },
  { name: 'subtitle', mock: '.settings-page .heading .subtitle', shell: '[data-settings-part="page"] > header > p' },
  // Appearance has section headings; a flat host category such as Terminal starts its rows just below the page heading.
  { name: 'sectionHead', mock: '.settings-page .form-section__head', shell: '[data-settings-part="section-title"]' },
  { name: 'list', mock: '.settings-page .setting-list', shell: '[data-settings-part="rows"]' },
  { name: 'row', all: true, mock: '.settings-page .setting-row', shell: '[data-settings-row]' },
  // The mock's states sit under its unchanged header. In the shell, loading and failure replace the body; an empty inventory keeps the sidebar and reports the state in the content pane.
  { name: 'state', mock: '.settings-state', shell: '[data-settings-state]' },
  { name: 'stateStack', mock: '.settings-state > .empty2', shell: '[data-settings-state]' },
  { name: 'stateTitle', mock: '.settings-state .empty2 > b', shell: '[data-settings-state] > :nth-child(1)' },
  { name: 'stateText', mock: '.settings-state .empty2 > .tiny', shell: '[data-settings-state] > :nth-child(2)' },
  { name: 'stateButton', mock: '.settings-state .empty2 > button', shell: '[data-settings-part="retry"]' },
  { name: 'skeleton', mock: '.settings-state .skeleton', shell: '[data-settings-state="loading"]' },
  { name: 'skeletonBar', all: true, mock: '.settings-state .skeleton__bar', shell: '[data-settings-part="never"]' },
];

/** The paint of the parts, exactly: which computed properties are read of which part (the first element, or the `index`-th of an `all` part). A colour is read as the engine computes it (`rgb(...)`), so the two sides compare as strings. */
export const STYLES = [
  { name: 'navFirst', props: ['color', 'backgroundColor', 'borderTopLeftRadius', 'fontSize', 'fontWeight', 'lineHeight', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'] },
  { name: 'navSelected', props: ['color', 'backgroundColor', 'borderTopLeftRadius', 'fontSize', 'fontWeight', 'lineHeight'] },
  { name: 'navGroup', props: ['color', 'fontSize', 'fontWeight', 'lineHeight'] },
  { name: 'navGroupLabel', props: ['color', 'fontSize', 'fontWeight', 'lineHeight'] },
  { name: 'title', props: ['color', 'fontSize', 'fontWeight', 'lineHeight', 'paddingTop', 'paddingBottom', 'marginTop', 'marginBottom'] },
  { name: 'subtitle', props: ['color', 'fontSize', 'fontWeight', 'lineHeight', 'marginTop', 'marginBottom', 'whiteSpace', 'overflowX', 'textOverflow'] },
  { name: 'heading', props: ['marginBottom'] },
  { name: 'row', index: 0, props: ['boxShadow', 'borderTopWidth'] },
  { name: 'row', index: 1, props: ['boxShadow', 'borderTopWidth'] },
  { name: 'stateTitle', props: ['color', 'fontSize', 'fontWeight', 'lineHeight'] },
  { name: 'stateText', props: ['color', 'fontSize', 'fontWeight', 'lineHeight'] },
  { name: 'stateButton', props: ['color', 'backgroundColor', 'borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'fontSize', 'fontWeight', 'lineHeight', 'paddingLeft', 'columnGap'] },
  { name: 'stateStack', props: ['rowGap', 'color', 'textAlign', 'alignItems', 'justifyContent', 'flexDirection'] },
];

/** The rows of the navigation whose paint is read in each state: one that is another page, and the one that is on screen. The Core group's rows. */
export const NAV_STATES = [
  // Measure the selected row first: focusing the other page can make it current.
  { name: 'selected', mock: '.settings-nav .tree__row[aria-selected="true"]', shell: '[data-settings-part="tree"] [data-settings-page][aria-current="page"]' },
  { name: 'other', mock: '.settings-nav .tree__row[data-key="general"]', shell: '[data-settings-part="tree"] [data-settings-page="general"]' },
];

/** Reads every part of `parts` from the page on one `side` ('mock' or 'shell'): `{ [name]: [[x, y, w, h], ...] }` in viewport px, to 0.01, `[]` for a part that is not there. */
export function readParts(page, parts, side) {
  return page.evaluate(
    ([specs, which]) => {
      const r2 = (v) => Math.round(v * 100) / 100;
      const rect = (el) => {
        const b = el.getBoundingClientRect();
        return [r2(b.x), r2(b.y), r2(b.width), r2(b.height)];
      };
      const out = {};
      for (const spec of specs) {
        const selector = which === 'mock' ? spec.mock : spec.shell;
        out[spec.name] = spec.all ? [...document.querySelectorAll(selector)].map(rect) : [document.querySelector(selector)].filter(Boolean).map(rect);
      }
      return out;
    },
    [parts, side],
  );
}

/** Reads the paint (STYLES) of the parts in `parts`: `{ '<name>' or '<name>#<index>': { prop: value } }`. A part that is not there is left out. */
export function readStyles(page, parts, side) {
  return page.evaluate(
    ([specs, styles, which]) => {
      const out = {};
      for (const style of styles) {
        const spec = specs.find((candidate) => candidate.name === style.name);
        if (spec === undefined) continue;
        const selector = which === 'mock' ? spec.mock : spec.shell;
        const element = [...document.querySelectorAll(selector)][style.index ?? 0];
        if (element === undefined) continue;
        const computed = getComputedStyle(element);
        out[style.index === undefined ? style.name : `${style.name}#${style.index}`] = Object.fromEntries(style.props.map((prop) => [prop, computed[prop]]));
      }
      return out;
    },
    [parts, STYLES, side],
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The paint of the navigation's rows in the states rest, hover and focus (the focus reached as the keyboard reaches it, so it counts as focus-visible): the fill, the colour, the outline and the radius. Each state is read as
 * it really is: the page is asked whether the row is hovered and focused. A row that is not there is `null`.
 */
export async function readNavStates(page, side) {
  const out = {};
  for (const target of NAV_STATES) {
    out[target.name] = {};
    const handle = await page.$(target[side]);
    if (handle === null) {
      out[target.name] = null;
      continue;
    }
    for (const state of ['rest', 'hover', 'focus']) {
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await page.mouse.move(1, 1);
      if (state === 'hover') {
        const box = await handle.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
      } else if (state === 'focus') {
        // Prime keyboard modality before focusing a row. WebKit needs a non-modifier key after pointer input.
        // Keep the mock's recorded Shift and send the shell's extra key with focus outside the tree and search.
        await page.keyboard.press('Shift');
        if (side === 'shell') await page.keyboard.press('a');
        await handle.evaluate((element) => element.focus());
      }
      await sleep(150);
      out[target.name][state] = await handle.evaluate((element) => {
        const cs = getComputedStyle(element);
        return {
          matches: { hover: element.matches(':hover'), focus: document.activeElement === element, focusVisible: element.matches(':focus-visible') },
          color: cs.color,
          fill: cs.backgroundColor,
          radius: cs.borderTopLeftRadius,
          outline: cs.outlineStyle === 'none' ? 'none' : `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} offset ${cs.outlineOffset}`,
        };
      });
    }
  }
  await page.mouse.move(1, 1);
  return out;
}
