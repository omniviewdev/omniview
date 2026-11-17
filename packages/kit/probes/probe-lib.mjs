// Page-agnostic measurement library for the kit's controls and icons: the same functions measure the design mock and the kit.
//
//   measure(page, locator)   rect, computed style, DOM element count and parts of one element in the states rest, hover, active and focus
//   summarize(record)        the compact, comparable form of one measurement: what mock-reference.json stores
//   deviations(ref, got, o)  where a kit measurement differs from the mock's
//   normalizeFont          put a page in one font, for the probes whose references were measured that way (the table and shell probes)
//   awaitFonts, setContext   wait for the real fonts of a page; set text size and density
//
// A probe needs Playwright's browsers (`pnpm exec playwright install webkit chromium`). They are run by hand, not by CI: see
// mock-measure.mjs (the reference) and kit-probe.mjs (the parts), and the part's status file for the last run.
import { createRequire } from 'node:module';

const pw = createRequire(import.meta.url)('playwright');

export const ENGINES = { webkit: pw.webkit, chromium: pw.chromium };

/**
 * Launch an engine for a probe. Headless Chromium on Linux hints glyphs and rounds every advance to a whole pixel (a 26-character
 * sample is 189 px against 187.27 px in WebKit, and on macOS); `--font-render-hinting=none` gives it the linear advances the other two
 * engines use, so one set of reference widths holds on every platform the probes run on (measured: Linux and macOS agree to 1/64 px).
 */
export function launch(engineName) {
  return ENGINES[engineName].launch(engineName === 'chromium' ? { args: ['--font-render-hinting=none'] } : {});
}
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
  // The paint a chip hover layers as a gradient, and the keys a clipped text is judged by.
  'backgroundImage', 'overflowX', 'textOverflow', 'maxWidth', 'verticalAlign', 'textDecorationLine',
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

/** Wait for the transitions and animations that end (a spinner never does: it would cost the whole deadline) and for two frames. */
async function settle(page) {
  await page.evaluate(async () => {
    const deadline = new Promise((r) => setTimeout(r, 1000));
    const ending = document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? 0));
    await Promise.race([Promise.all(ending.map((a) => a.finished.catch(() => {}))), deadline]);
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

/**
 * Deterministic UI font: sets the root custom property that holds the UI font stack. For the probes whose references were measured in this
 * normalized font (the table and shell probes); the atoms and the fonts keep their real fonts (`awaitFonts`).
 */
export async function normalizeFont(page, { rootVar }) {
  await page.evaluate((v) => document.documentElement.style.setProperty(v, 'Helvetica, Arial, sans-serif'), rootVar);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await settle(page);
}

/** The pages keep their real fonts (the mock's own Inter, the kit's subset of it with the same advances): wait until they are loaded and the layout is still. */
export async function awaitFonts(page) {
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

/**
 * Page side (self-contained: it runs in the browser, pass it to `page.evaluate`): the node record of the table probes. It installs
 * `window.__rec`: `styleOf(el)`, the computed style that matters to a table with the defaults left out; `nodeOf(el, origin, { text })`,
 * the rect (relative to `origin`), style, classes, attributes, own text and text range of one element; `walk(root, origin)`, every
 * element below `root` in document order with its depth; `elements(el)`, `scrollerOf(el)`, `r2` and `px`. The mock's reference
 * (mock-table-measure.mjs) and the kit's table probe (table-probe.mjs) record a table with these same functions, so a record of the one
 * is comparable with a record of the other.
 */
export function installRecordLib() {
  const r2 = (n) => Math.round(n * 100) / 100;
  const px = (s) => String(s).replace(/(\d+\.\d{3,})px/g, (m, n) => `${r2(Number(n))}px`);
  const quad = (css, p) => ['Top', 'Right', 'Bottom', 'Left'].map((s) => css[`${p}${s}`]).join(' ');
  const side = (css, s) => (css[`border${s}Width`] === '0px' ? '0' : `${css[`border${s}Width`]} ${css[`border${s}Style`]} ${css[`border${s}Color`]}`);

  /** The computed style that matters to a table, defaults left out. Geometry is the node's rect, not a style. */
  const styleOf = (el) => {
    const css = getComputedStyle(el);
    const o = {};
    const put = (k, v, skip) => { if (v !== skip && v !== '' && v != null) o[k] = px(v); };
    o.color = css.color;
    put('bg', css.backgroundColor, 'rgba(0, 0, 0, 0)');
    put('bgImage', css.backgroundImage, 'none');
    put('bT', side(css, 'Top'), '0');
    put('bR', side(css, 'Right'), '0');
    put('bB', side(css, 'Bottom'), '0');
    put('bL', side(css, 'Left'), '0');
    put('radius', css.borderTopLeftRadius, '0px');
    put('pad', quad(css, 'padding'), '0px 0px 0px 0px');
    put('margin', quad(css, 'margin'), '0px 0px 0px 0px');
    o.font = `${css.fontSize}/${css.lineHeight} ${css.fontWeight}`;
    put('ls', css.letterSpacing, 'normal');
    put('fstyle', css.fontStyle, 'normal');
    put('nums', css.fontVariantNumeric, 'normal');
    put('mono', /monospace|Menlo|Consolas|Courier|SF Mono/i.test(css.fontFamily) ? 'yes' : '', '');
    if (/^(TD|TH)$/.test(el.tagName)) o.align = css.textAlign;
    put('valign', css.verticalAlign, 'baseline');
    put('ws', css.whiteSpace, 'normal');
    put('overflow', `${css.overflowX} ${css.overflowY}`, 'visible visible');
    put('textOverflow', css.textOverflow, 'clip');
    o.display = css.display;
    put('position', css.position, 'static');
    if (css.position === 'sticky') { o.top = css.top; o.left = css.left; put('z', css.zIndex, 'auto'); }
    else if (css.position === 'absolute' || css.position === 'fixed') { o.top = css.top; o.right = css.right; o.bottom = css.bottom; put('z', css.zIndex, 'auto'); }
    else if (css.position === 'relative') put('z', css.zIndex, 'auto');
    if (/flex|grid/.test(css.display)) { put('alignItems', css.alignItems, 'normal'); put('justify', css.justifyContent, 'normal'); put('dir', css.flexDirection, 'row'); }
    put('gap', css.columnGap, 'normal');
    if (/^(TR|TH|BUTTON|A)$/.test(el.tagName)) put('cursor', css.cursor, 'auto');
    if (css.outlineStyle !== 'none' && css.outlineWidth !== '0px') o.outline = `${css.outlineWidth} ${css.outlineStyle} ${css.outlineColor} ${css.outlineOffset}`;
    put('shadow', css.boxShadow, 'none');
    put('opacity', css.opacity, '1');
    put('box', css.boxSizing, 'border-box');
    if (css.minWidth !== '0px') put('minW', css.minWidth, 'auto');
    put('maxW', css.maxWidth, 'none');
    put('pe', css.pointerEvents, 'auto');
    put('visibility', css.visibility, 'visible');
    return o;
  };

  const ATTR_OK = /^(tabindex|role|scope|colspan|type|datetime|viewBox|width|height|aria-(?!description)[a-z]+|data-(tooltip[a-z-]*|clamp|full|fit|column-pinned|state-[a-z]+|icon-button|density))$/;
  const ownText = (el) => [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join('').trim();

  const nodeOf = (el, origin, { text = true } = {}) => {
    const b = el.getBoundingClientRect();
    const n = { t: el.tagName.toLowerCase(), r: [r2(b.left - origin.left), r2(b.top - origin.top), r2(b.width), r2(b.height)], s: styleOf(el) };
    const cls = (el.getAttribute('class') || '').trim().replace(/\s+/g, ' ');
    if (cls) n.c = cls;
    const attrs = {};
    for (const a of el.attributes) {
      if (a.name === 'data-action') attrs[a.name] = 'present';
      else if (ATTR_OK.test(a.name)) attrs[a.name] = a.value;
    }
    if (Object.keys(attrs).length) n.a = attrs;
    const vars = {};
    for (let i = 0; i < (el.style?.length ?? 0); i += 1) {
      const name = el.style[i];
      if (/^--(identifier|tile|viz|measure|prose|cell-max)/.test(name)) vars[name] = px(el.style.getPropertyValue(name).trim());
    }
    if (Object.keys(vars).length) n.v = vars;
    if (text) {
      const t = ownText(el);
      if (t) {
        n.x = t.slice(0, 80);
        const node = [...el.childNodes].find((c) => c.nodeType === 3 && c.textContent.trim());
        const range = document.createRange();
        range.selectNodeContents(node);
        const rb = range.getBoundingClientRect();
        n.xr = [r2(rb.left - origin.left), r2(rb.width)];
      }
    }
    if (!(el instanceof SVGElement) && el.scrollWidth > el.clientWidth + 0.5 && getComputedStyle(el).overflowX !== 'visible') n.cut = 1;
    return n;
  };

  /** Every element below `root`, in DOM order, with its depth; the inside of an svg is only counted. */
  const walk = (root, origin) => {
    const out = [];
    const visit = (el, depth) => {
      for (const c of el.children) {
        const n = nodeOf(c, origin);
        n.d = depth;
        out.push(n);
        if (c instanceof SVGElement) { n.inner = c.querySelectorAll('*').length; continue; }
        visit(c, depth + 1);
      }
    };
    visit(root, 0);
    return out;
  };

  const elements = (el) => 1 + el.querySelectorAll('*').length;

  const scrollerOf = (el) => {
    for (let e = el.parentElement; e; e = e.parentElement) {
      const o = getComputedStyle(e).overflowY;
      if (o === 'auto' || o === 'scroll') return e;
    }
    return null;
  };

  window.__rec = { r2, px, styleOf, nodeOf, walk, elements, scrollerOf };
}

/** The comparable form of a measurement: one string per concern, so a difference names what differs. */
export function summarize(record, { withOutline = false, extra = [] } = {}) {
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
    // A control that sits in a flex parent is blockified (inline-flex computes to flex): the layout is compared without it.
    layout: `${s.display.replace(/^inline-/, '')} ${s.alignItems} ${s.justifyContent} ${s.whiteSpace}`,
    shadow: s.boxShadow,
    opacity: s.opacity,
    pointer: s.pointerEvents,
  };
  if (withOutline) {
    out.outline = `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor} ${s.outlineOffset}`;
  }

  // Further computed-style keys a part is judged by (STYLE_PROPS holds them); compared exactly by `deviations({ extra })`.
  for (const key of extra) {
    out[key] = s[key];
  }

  const { icon, label } = record.parts;
  out.icon = icon === null ? null : { w: icon.rect.w, h: icon.rect.h, left: icon.left, top: icon.top, color: icon.style.color };
  out.label = label === null ? null : { w: label.rect.w, h: label.rect.h, left: label.left, top: label.top, text: label.text };
  return out;
}

/** A measured control in rest, hover and focus, in the form mock-table.json stores: a style (no geometry), a size, an icon and a label box. */
export const buttonStates = (m) => Object.fromEntries(Object.entries(m).map(([state, rec]) => {
  const { w, h, el, icon, label, ...style } = summarize(rec, { withOutline: state === 'focus' });
  return [state, { size: [w, h], n: el, s: style, ...(icon ? { icon: [icon.left, icon.top, icon.w, icon.h, icon.color] } : {}), ...(label ? { label: [label.left, label.w, label.text] } : {}) }];
}));

/**
 * The differences between a reference summary (the mock) and a measurement of the kit, as strings. `tolerance` is in pixels for
 * every length; every string (colours, border, padding, font, gap, cursor, layout) must be equal. When the labels differ
 * (`sameLabel: false`) widths are compared without the label: the chrome width, width minus label width.
 */
export function deviations(reference, got, { tolerance = 1, sameLabel = true, withOutline = false, skip = [], extra = [] } = {}) {
  const out = [];
  const near = (a, b) => Math.abs(a - b) <= tolerance;
  const note = (what, a, b) => {
    if (!skip.includes(what)) out.push(`${what}: mock ${JSON.stringify(a)} kit ${JSON.stringify(b)}`);
  };
  if (!near(reference.h, got.h)) note('height', reference.h, got.h);
  const chrome = (summary) => summary.w - (summary.label?.w ?? 0);
  if (sameLabel ? !near(reference.w, got.w) : !near(chrome(reference), chrome(got))) note(sameLabel ? 'width' : 'chrome width', sameLabel ? reference.w : chrome(reference), sameLabel ? got.w : chrome(got));
  // A control in a flex parent is blockified: inline-flex computes to flex, and the same layout is the same.
  const plain = (key, summary) => (key === 'layout' ? summary[key].replace(/^inline-/, '') : summary[key]);
  for (const key of ['color', 'bg', 'border', 'radius', 'pad', 'font', 'gap', 'cursor', 'layout', 'shadow', 'opacity', 'pointer', ...(withOutline ? ['outline'] : []), ...extra]) {
    if (plain(key, reference) !== plain(key, got)) note(key, reference[key], got[key]);
  }

  for (const part of ['icon', 'label']) {
    const a = reference[part];
    const b = got[part];
    if ((a === null) !== (b === null)) {
      note(`${part} present`, a !== null, b !== null);
    } else if (a !== null && b !== null) {
      // The height of a label's text range is the engine's measure of a text box (content area or line box), not geometry: left and top
      // say where the text sits, and the width says how long it is.
      for (const key of part === 'icon' ? ['w', 'h', 'left', 'top'] : sameLabel ? ['w', 'left', 'top'] : ['left', 'top']) {
        if (!near(a[key], b[key])) note(`${part}.${key}`, a[key], b[key]);
      }

      if (part === 'icon' && a.color !== b.color) note('icon.color', a.color, b.color);
    }
  }

  return out;
}
