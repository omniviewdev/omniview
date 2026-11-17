// Page-agnostic measurement library for the kit's controls and icons: the same functions measure the design mock and the kit.
//
//   measure(page, locator)   rect, computed style, DOM element count and parts of one element in the states rest, hover, active and focus
//   summarize(record)        the compact, comparable form of one measurement: what mock-atoms.json stores
//   deviations(ref, got, o)  where a kit measurement differs from the mock's
//   normalizeFont, setContext  put both pages in one font, text size and density
//
// A probe needs Playwright's browsers (`pnpm exec playwright install webkit chromium`). They are run by hand, not by CI: see
// mock-measure.mjs (the reference) and kit-probe.mjs (the parts), and the part's status file for the last run.
import { createRequire } from 'node:module';

const pw = createRequire(import.meta.url)('playwright');

export const ENGINES = { webkit: pw.webkit, chromium: pw.chromium };
export const VIEWPORTS = { '1440x900': { width: 1440, height: 900 }, '1030x720': { width: 1030, height: 720 } };
export const STATES = ['rest', 'hover', 'active', 'focus'];

export const STYLE_PROPS = [
  'color', 'backgroundColor',
  'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderTopStyle', 'borderTopLeftRadius',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontSize', 'fontWeight', 'lineHeight', 'fontFamily', 'letterSpacing', 'columnGap',
  'cursor', 'outlineColor', 'outlineWidth', 'outlineStyle', 'outlineOffset', 'boxShadow',
  'opacity', 'display', 'alignItems', 'justifyContent', 'minWidth', 'minHeight',
  'whiteSpace', 'pointerEvents',
];

const AWAY = { x: 1, y: 1 };

/** Read one element: rect, computed style, DOM element count, icon and label parts. Runs in the page (self-contained). */
function readTarget(target, props) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const tb = target.getBoundingClientRect();
  const cs = getComputedStyle(target);
  const style = {};
  for (const p of props) style[p] = cs[p];

  let icon = null;
  const iconEl = target.querySelector('.ic, svg');
  if (iconEl) {
    const ib = iconEl.getBoundingClientRect();
    const svg = iconEl.matches('svg') ? iconEl : iconEl.querySelector('svg');
    let svgInfo = null;
    if (svg) {
      const sb = svg.getBoundingClientRect();
      svgInfo = {
        w: r2(sb.width), h: r2(sb.height),
        widthAttr: svg.getAttribute('width'), heightAttr: svg.getAttribute('height'),
        left: r2(sb.left - tb.left), top: r2(sb.top - tb.top),
      };
    }
    icon = {
      rect: { w: r2(ib.width), h: r2(ib.height) },
      style: { color: getComputedStyle(iconEl).color },
      left: r2(ib.left - tb.left),
      top: r2(ib.top - tb.top),
      svg: svgInfo,
    };
  }

  let label = null;
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const parent = n.parentElement;
    if (!parent) continue;
    const hidden = parent.closest('.ic, svg, [aria-hidden="true"]');
    if (hidden && target.contains(hidden)) continue;
    if (getComputedStyle(parent).visibility === 'hidden') continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rb = range.getBoundingClientRect();
    if (!rb.width && !rb.height) continue;
    label = {
      rect: { w: r2(rb.width), h: r2(rb.height) },
      left: r2(rb.left - tb.left),
      top: r2(rb.top - tb.top),
      text: n.textContent.trim(),
    };
    break;
  }

  return {
    rect: { w: r2(tb.width), h: r2(tb.height) },
    style,
    elements: 1 + target.querySelectorAll('*').length,
    parts: { icon, label },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for running CSS transitions/animations and two frames. */
async function settle(page) {
  await page.evaluate(async () => {
    const deadline = new Promise((r) => setTimeout(r, 1000));
    await Promise.race([Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))), deadline]);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

function matchState(handle) {
  return handle.evaluate((el) => ({
    hover: el.matches(':hover'),
    active: el.matches(':active'),
    focus: document.activeElement === el,
    focusVisible: el.matches(':focus-visible'),
  }));
}

/** Pointer away, nothing focused. */
async function reset(page, away) {
  await page.evaluate(() => {
    const a = document.activeElement;
    if (a && a !== document.body && typeof a.blur === 'function') a.blur();
  });
  await page.mouse.move(away.x, away.y);
  await settle(page);
}

function need(cond, state, got) {
  if (!cond) throw new Error(`state "${state}" not really active: ${JSON.stringify(got)}`);
}

async function focusViaKeyboard(page, handle) {
  // Sentinel sits immediately before the target in DOM and tab order, out of flow (fixed); removed again before measuring.
  await handle.evaluate((el) => {
    const s = document.createElement('span');
    s.setAttribute('tabindex', '0');
    s.setAttribute('data-probe-sentinel', '');
    s.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;outline:0;pointer-events:none';
    el.before(s);
    s.focus();
  });
  const refocusSentinel = () => handle.evaluate(() => {
    const s = document.querySelector('[data-probe-sentinel]');
    if (s) s.focus();
  });
  // Plain Tab first; WebKit on macOS skips buttons with Tab (only Alt+Tab reaches them), so try that second.
  let via = null;
  for (const [name, key] of [['tab', 'Tab'], ['alt-tab', 'Alt+Tab']]) {
    await refocusSentinel();
    for (let i = 0; i < 6 && !via; i += 1) {
      await page.keyboard.press(key);
      if (await handle.evaluate((el) => document.activeElement === el)) via = name;
    }
    if (via) break;
  }
  if (!via) {
    // Fallback: keyboard round trip from the sentinel, then script focus (keeps :focus-visible after keyboard use).
    await refocusSentinel();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await handle.focus();
    via = 'focus()';
  }
  await handle.evaluate(() => document.querySelectorAll('[data-probe-sentinel]').forEach((s) => s.remove()));
  return via;
}

/**
 * Measure one element in each state. Throws if a state is not really in effect.
 * Returns { [state]: { rect:{w,h}, style, elements, parts:{icon,label}, via? } }.
 */
export async function measure(page, locator, { states = STATES, away = AWAY } = {}) {
  await locator.waitFor({ state: 'visible' });
  const handle = await locator.elementHandle(); // pinned: the focus sentinel must not make the locator ambiguous
  const out = {};
  for (const state of states) {
    await reset(page, away);
    if (state === 'rest') {
      const m = await matchState(handle);
      need(!m.hover && !m.active && !m.focus, state, m);
      out[state] = await handle.evaluate(readTarget, STYLE_PROPS);
    } else if (state === 'hover' || state === 'active') {
      await handle.scrollIntoViewIfNeeded();
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 });
      if (state === 'active') await page.mouse.down();
      try {
        await settle(page);
        const m = await matchState(handle);
        need(m.hover, state, m);
        if (state === 'active') need(m.active, state, m);
        out[state] = await handle.evaluate(readTarget, STYLE_PROPS);
      } finally {
        if (state === 'active') {
          // Release OUTSIDE the element so no click is produced.
          await page.mouse.move(away.x, away.y, { steps: 2 });
          await page.mouse.up();
        }
      }
    } else if (state === 'focus') {
      const via = await focusViaKeyboard(page, handle);
      await settle(page);
      const m = await matchState(handle);
      need(m.focus && m.focusVisible, state, { ...m, via });
      out[state] = await handle.evaluate(readTarget, STYLE_PROPS);
      out[state].via = via;
    } else {
      throw new Error(`unknown state ${state}`);
    }
  }
  await reset(page, away);
  return out;
}

/** Deterministic UI font: sets the root custom property that holds the UI font stack. */
export async function normalizeFont(page, { rootVar }) {
  await page.evaluate((v) => document.documentElement.style.setProperty(v, 'Helvetica, Arial, sans-serif'), rootVar);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await settle(page);
}

/**
 * Set text scale and density on <html>. flavour 'mock': data-text-scale / data-density.
 * flavour 'kit': data-ov-text-size / data-ov-density. null/undefined removes the attribute.
 */
export async function setContext(page, { textScale, density, flavour = 'mock' } = {}) {
  if (flavour !== 'kit' && flavour !== 'mock') throw new Error(`flavour must be 'mock' or 'kit', got ${flavour}`);
  const names = flavour === 'kit'
    ? { scale: 'data-ov-text-size', density: 'data-ov-density' }
    : { scale: 'data-text-scale', density: 'data-density' };
  await page.evaluate(({ names, textScale, density }) => {
    const root = document.documentElement;
    const put = (n, v) => (v == null ? root.removeAttribute(n) : root.setAttribute(n, String(v)));
    put(names.scale, textScale);
    put(names.density, density);
  }, { names, textScale, density });
  await settle(page);
}

export { sleep, settle };

/** The comparable form of a measurement: one string per concern, so a difference names what differs. */
export function summarize(record, { withOutline = false } = {}) {
  const s = record.style;
  const sides = ['Top', 'Right', 'Bottom', 'Left'];
  const uniform = (kind) => new Set(sides.map((side) => s[`border${side}${kind}`])).size === 1;
  const out = {
    w: record.rect.w,
    h: record.rect.h,
    el: record.elements,
    color: s.color,
    bg: s.backgroundColor,
    border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}${uniform('Color') && uniform('Width') ? '' : ' (sides differ)'}`,
    radius: s.borderTopLeftRadius,
    pad: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
    font: `${s.fontSize}/${s.lineHeight} ${s.fontWeight} ${s.letterSpacing}`,
    gap: s.columnGap,
    cursor: s.cursor,
    layout: `${s.display} ${s.alignItems} ${s.justifyContent} ${s.whiteSpace}`,
    shadow: s.boxShadow,
    opacity: s.opacity,
    pointer: s.pointerEvents,
  };
  if (withOutline) {
    out.outline = `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor} ${s.outlineOffset}`;
  }

  const { icon, label } = record.parts;
  out.icon = icon === null ? null : { w: icon.rect.w, h: icon.rect.h, left: icon.left, top: icon.top, color: icon.style.color };
  out.label = label === null ? null : { w: label.rect.w, h: label.rect.h, left: label.left, top: label.top, text: label.text };
  return out;
}

/**
 * The differences between a reference summary (the mock) and a measurement of the kit, as strings. `tolerance` is in pixels for
 * every length; every string (colours, border, padding, font, gap, cursor, layout) must be equal. When the labels differ
 * (`sameLabel: false`) widths are compared without the label: the chrome width, width minus label width.
 */
export function deviations(reference, got, { tolerance = 1, sameLabel = true, withOutline = false, skip = [] } = {}) {
  const out = [];
  const near = (a, b) => Math.abs(a - b) <= tolerance;
  const note = (what, a, b) => {
    if (!skip.includes(what)) out.push(`${what}: mock ${JSON.stringify(a)} kit ${JSON.stringify(b)}`);
  };
  if (!near(reference.h, got.h)) note('height', reference.h, got.h);
  const chrome = (summary) => summary.w - (summary.label?.w ?? 0);
  if (sameLabel ? !near(reference.w, got.w) : !near(chrome(reference), chrome(got))) note(sameLabel ? 'width' : 'chrome width', sameLabel ? reference.w : chrome(reference), sameLabel ? got.w : chrome(got));
  for (const key of ['color', 'bg', 'border', 'radius', 'pad', 'font', 'gap', 'cursor', 'layout', 'shadow', 'opacity', 'pointer', ...(withOutline ? ['outline'] : [])]) {
    if (reference[key] !== got[key]) note(key, reference[key], got[key]);
  }

  for (const part of ['icon', 'label']) {
    const a = reference[part];
    const b = got[part];
    if ((a === null) !== (b === null)) {
      note(`${part} present`, a !== null, b !== null);
    } else if (a !== null && b !== null) {
      for (const key of part === 'icon' ? ['w', 'h', 'left', 'top'] : sameLabel ? ['w', 'h', 'left', 'top'] : ['h', 'left', 'top']) {
        if (!near(a[key], b[key])) note(`${part}.${key}`, a[key], b[key]);
      }

      if (part === 'icon' && a.color !== b.color) note('icon.color', a.color, b.color);
    }
  }

  return out;
}
