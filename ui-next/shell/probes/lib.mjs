// Reads the targets of targets.mjs from a page (the mock or the shell) and compares two readings. Page-agnostic: the same functions run on both.
import { STATE_TARGETS, STYLES, TARGETS } from './targets.mjs';

const KEYS = { abs: ['x', 'y', 'w', 'h'], 'x-w': ['x', 'w'], 'x-w-h': ['x', 'w', 'h'], 'y-h': ['y', 'h'], size: ['w', 'h'] };

/** The rectangle of one reading, as compared: absolute, or relative to the top left of its base target. */
function measured(reading, target) {
  const rect = reading[target.name]?.rect;
  if (rect === undefined || rect === null) return undefined;
  const [x, y, w, h] = rect;
  const base = target.cmp.startsWith('rel:') ? reading[target.cmp.slice(4)]?.rect : [0, 0];
  if (base === undefined || base === null) return undefined;
  const round = (value) => Math.round(value * 100) / 100;
  return { x: round(x - base[0]), y: round(y - base[1]), w, h, cy: round(y - base[1] + h / 2) };
}

const keysOf = (target) => target.keys ?? (target.text ? ['x', 'w', 'cy'] : KEYS[target.cmp] ?? KEYS.abs);

/** Reads every target of `side` ('mock' or 'shell') from the page: rectangle, and the computed style the STYLES table asks for. */
export async function readSide(page, side) {
  const wanted = TARGETS.map((target) => {
    const style = STYLES.find((entry) => entry.name === target.name);
    return { name: target.name, selector: target[side], props: style?.props ?? [], path: style?.path ?? null, sharedFill: style?.sharedFill === true };
  });
  return page.evaluate((specs) => {
    const round = (value) => Math.round(value * 100) / 100;
    const out = {};
    for (const spec of specs) {
      const element = document.querySelector(spec.selector);
      if (element === null) {
        out[spec.name] = null;
        continue;
      }
      const box = element.getBoundingClientRect();
      const computed = getComputedStyle(element);
      const style = {};
      for (const prop of spec.props) {
        style[prop] = prop === 'edge'
          ? (parseFloat(computed.borderTopWidth) > 0 ? computed.borderTopColor : computed.boxShadow.match(/rgba?\([^)]*\)/)?.[0] ?? '')
          : computed[prop];
      }
      // The window paints one chrome surface. Compare its visible colour through an unpainted row, not transparent black.
      if (spec.sharedFill) {
        for (let parent = element.parentElement; style.backgroundColor === 'rgba(0, 0, 0, 0)' && parent !== null; parent = parent.parentElement) {
          style.backgroundColor = getComputedStyle(parent).backgroundColor;
        }
      }
      if (spec.path !== null) {
        const path = element.querySelector('path');
        style[spec.path] = path === null ? '' : getComputedStyle(path)[spec.path];
      }
      out[spec.name] = { rect: [round(box.x), round(box.y), round(box.width), round(box.height)], style };
    }
    return out;
  }, wanted);
}

/**
 * The differences between a reference reading (the mock) and the shell's, as strings, and the largest rectangle difference in px.
 * `stylesOnly` skips rectangles (the themes change colours only).
 */
export function compare(reference, got, { tolerance = 1, stylesOnly = false } = {}) {
  const problems = [];
  let worst = 0;
  for (const target of TARGETS) {
    if (stylesOnly) break;
    const mock = measured(reference, target);
    const shell = measured(got, target);
    if (mock === undefined) {
      problems.push(`${target.name}: the mock does not draw it (reference)`);
      continue;
    }
    if (shell === undefined) {
      problems.push(`${target.name}: the shell does not draw it`);
      continue;
    }
    for (const key of keysOf(target)) {
      const expected = mock[key] + (target.adjust?.[key] ?? 0);
      const delta = Math.round(Math.abs(expected - shell[key]) * 100) / 100;
      worst = Math.max(worst, delta);
      if (delta > tolerance) problems.push(`${target.name}.${key}: mock ${mock[key]}${target.adjust?.[key] ? ` (${target.adjust[key] > 0 ? '+' : ''}${target.adjust[key]} known)` : ''} shell ${shell[key]} (off by ${delta})`);
    }
  }
  for (const entry of STYLES) {
    const mock = reference[entry.name]?.style;
    const shell = got[entry.name]?.style;
    if (mock === undefined || shell === undefined) continue;
    for (const [prop, value] of Object.entries(mock)) {
      if (shell[prop] !== value) problems.push(`${entry.name} ${prop}: mock ${value} shell ${shell[prop]}`);
    }
  }
  return { problems, worst };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads the paint of the targets in STATE_TARGETS in the states rest, hover and focus (the focus reached as the keyboard reaches it, so it
 * counts as focus-visible): the fill and the outline. Each state is checked with matches() before it is read.
 */
export async function readStates(page, side) {
  const out = {};
  for (const target of STATE_TARGETS) {
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
        await page.keyboard.press('Shift');
        await handle.evaluate((element) => element.focus());
      }
      await sleep(150);
      out[target.name][state] = await handle.evaluate((element, fill) => {
        const matches = { hover: element.matches(':hover'), focus: document.activeElement === element, focusVisible: element.matches(':focus-visible') };
        const paint = getComputedStyle(fill === null ? element : (element.closest(fill) ?? element));
        const ring = getComputedStyle(element);
        return { matches, fill: paint.backgroundColor, outline: `${ring.outlineStyle} ${ring.outlineWidth} ${ring.outlineStyle === 'none' ? '' : ring.outlineColor}`.trim() };
      }, target[`${side}Fill`] ?? null);
    }
  }
  await page.mouse.move(1, 1);
  return out;
}

/** The states of the shell against the mock's: each state really in effect, then the fill and the outline equal. */
export function compareStates(reference, got) {
  const problems = [];
  for (const target of STATE_TARGETS) {
    for (const state of ['rest', 'hover', 'focus']) {
      const mock = reference[target.name]?.[state];
      const shell = got[target.name]?.[state];
      if (mock === undefined || shell === undefined) {
        problems.push(`${target.name} ${state}: not read`);
        continue;
      }
      if (state === 'hover' && !shell.matches.hover) problems.push(`${target.name} hover: not really hovered`);
      if (state === 'focus' && !(shell.matches.focus && shell.matches.focusVisible)) problems.push(`${target.name} focus: not really focus-visible`);
      for (const key of ['fill', 'outline']) {
        if (mock[key] !== shell[key]) problems.push(`${target.name} ${state} ${key}: mock ${mock[key]} shell ${shell[key]}`);
      }
    }
  }
  return problems;
}
