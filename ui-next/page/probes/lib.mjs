// What the page probe (page-probe.mjs) shares: building and serving the fixture, opening a case in an engine, reading rectangles from a page, comparing
// them with the design mock's reference (packages/kit/probes/mock-page.json), and the report. Page-agnostic: the same functions read any case.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveNode } from '../../../packages/kit/probes/mock-detail-measure.mjs';
import { expandEntry } from '../../../packages/kit/probes/mock-page-measure.mjs';
import { normalizeFont, settle } from '../../../packages/kit/probes/probe-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const round2 = (value) => Math.round(value * 100) / 100;

/** The design mock's detail page (packages/kit/probes/mock-detail.json, made by mock-detail-measure.mjs): `node(section, engine, viewport, name)` is `{ r: [x, y, w, h], x? }` or null. */
const DETAIL = JSON.parse(readFileSync(path.join(repo, 'packages/kit/probes/mock-detail.json'), 'utf8'));
export const MOCK_DETAIL = { node: (section, engine, viewport, name) => resolveNode(DETAIL, section, engine, viewport, name) };

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The mock's reference.                                                                                                            */
/* ------------------------------------------------------------------------------------------------------------------------------ */

export const MOCK = JSON.parse(readFileSync(path.join(repo, 'packages/kit/probes/mock-page.json'), 'utf8'));

/** One record of the reference for an engine and viewport: `section` is list, listNarrow, header (with an id), states (with an id), slot or search. */
export function reference(section, id, viewport, engine) {
  const entry = id === undefined ? MOCK[section]?.[viewport] : MOCK[section]?.[id]?.[viewport];
  if (entry === undefined) throw new Error(`The mock reference has no ${section}${id === undefined ? '' : `/${id}`} at ${viewport}`);
  return expandEntry(entry, engine);
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Build, serve, open.                                                                                                              */
/* ------------------------------------------------------------------------------------------------------------------------------ */

/** The fixture built with the repository's own Vite configuration into a temporary directory (FIXTURE_DIST: use a build that exists). */
export function buildFixture() {
  if (process.env.FIXTURE_DIST) return process.env.FIXTURE_DIST;
  const out = mkdtempSync(path.join(os.tmpdir(), 'page-probe-fixture-'));
  execFileSync('node', [path.join(here, 'build-fixture.mjs'), out], { cwd: repo, env: { ...process.env, OMNIVIEW_UI: 'next' }, stdio: 'pipe' });
  return out;
}

export function serve(dist) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const file = path.join(dist, url.pathname);
    try {
      if (!file.startsWith(dist)) throw new Error('outside');
      response.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream');
      response.end(readFileSync(file));
    } catch {
      response.statusCode = 404;
      response.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

/**
 * Opens a case of the fixture in a fresh context, in the engine's own browser: the font normalized as the mock's reference was (Helvetica for the UI
 * stack on both sides), nothing focused, the pointer away. `ready` is a selector that must be in the page before the case is read.
 */
export async function openCase(browser, origin, name, viewport, { ready, extra = '' } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 200)}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`${origin}/page/probes/fixture.html?case=${name}${extra}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-shell-part="window"]');
  if (ready) await page.waitForSelector(ready);
  await normalizeFont(page, { rootVar: '--ov-font-ui' });
  await page.mouse.move(1, 1);
  await settle(page);
  return { page, context, errors };
}

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Reading a page.                                                                                                                  */
/* ------------------------------------------------------------------------------------------------------------------------------ */

/**
 * Page side (self-contained). Reads each spec `{ name, sel, nth?, kind?, scope? }` from the page region (scope 'document': the whole document):
 *   kind 'rect' (default)  [x, y, w, h] of the element, 0.01 px
 *   kind 'text'            the same for the union of the element's text nodes (the range the mock records as `xr`), and the text
 *   kind 'count'           how many elements match
 *   kind 'style'           the computed values of `props`
 * A missing element is null.
 */
export function readInPage(specs) {
  const round = (value) => Math.round(value * 100) / 100;
  const region = document.querySelector('[data-shell-part="page"]') ?? document;
  const textNodes = (element) => {
    const out = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.textContent.trim() && !node.parentElement.closest('svg') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node);
    return out;
  };
  const out = {};
  for (const spec of specs) {
    const root = spec.scope === 'document' ? document : region;
    const found = [...root.querySelectorAll(spec.sel)];
    if (spec.kind === 'count') {
      out[spec.name] = found.length;
      continue;
    }

    const element = found[spec.nth ?? 0];
    if (element === undefined) {
      out[spec.name] = null;
      continue;
    }

    if (spec.kind === 'style') {
      const css = getComputedStyle(element);
      out[spec.name] = Object.fromEntries(spec.props.map((prop) => [prop, css.getPropertyValue(prop)]));
      continue;
    }

    if (spec.kind === 'text') {
      let union = null;
      const nodes = textNodes(element);
      for (const node of nodes) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        if (!box.width && !box.height) continue;
        union = union ? [Math.min(union[0], box.left), Math.min(union[1], box.top), Math.max(union[2], box.right), Math.max(union[3], box.bottom)] : [box.left, box.top, box.right, box.bottom];
      }

      out[spec.name] = union ? { rect: [round(union[0]), round(union[1]), round(union[2] - union[0]), round(union[3] - union[1])], text: nodes.map((node) => node.textContent).join(' ').replace(/\s+/g, ' ').trim() } : null;
      continue;
    }

    const box = element.getBoundingClientRect();
    out[spec.name] = [round(box.left), round(box.top), round(box.width), round(box.height)];
  }

  return out;
}

export const readRects = (page, specs) => page.evaluate(readInPage, specs);

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* Comparing rectangles.                                                                                                            */
/* ------------------------------------------------------------------------------------------------------------------------------ */

const KEY_INDEX = { x: 0, y: 1, w: 2, h: 3 };

/** One number of a rectangle: x, y, w, h, the right edge `r` or the bottom edge `b`. */
export function valueOf(rect, key) {
  if (key === 'r') return round2(rect[0] + rect[2]);
  if (key === 'b') return round2(rect[1] + rect[3]);
  return rect[KEY_INDEX[key]];
}

/** 1 px for a fixed size; 2 px for one that depends on its room or its text (`flex` lists those keys). */
export const tolerance = (key, flex = '') => (flex.includes(key) ? 2 : 1);

/**
 * The reference rectangle against the one read. `keys` are the numbers compared ('xywh' by default; a text box whose words differ is 'xyh'; a part
 * whose width the page decides is given its own expectation in `adjust`). `adjust` is an exact difference by construction, in px, applied to the
 * reference. Returns { delta, limit, ok, keys: {key: [mock, got, delta]} }.
 */
export function diffRect(ref, got, { keys = 'xywh', flex = '', adjust = {} } = {}) {
  const per = {};
  let delta = 0;
  let ok = true;
  for (const key of keys) {
    const want = round2(valueOf(ref, key) + (adjust[key] ?? 0));
    const have = valueOf(got, key);
    const d = round2(Math.abs(want - have));
    per[key] = [want, have, d];
    delta = Math.max(delta, d);
    if (d > tolerance(key, flex)) ok = false;
  }

  return { delta, ok, keys: per };
}

/** `x306 y92 w1117 h771`: the numbers of a comparison, for one side (`side` 0 is the mock's, 1 the page's). */
export const showKeys = (per, side) => Object.entries(per).map(([key, values]) => `${key}${values[side]}`).join(' ');

/* ------------------------------------------------------------------------------------------------------------------------------ */
/* The report.                                                                                                                      */
/* ------------------------------------------------------------------------------------------------------------------------------ */

export class Report {
  constructor() {
    this.failures = [];
    this.lines = 0;
    this.known = 0;
    this.worst = new Map();
  }

  /** A line of the report. `status` is ok, known (an accepted difference, with its reason in `note`) or FAIL. */
  line(where, target, mock, got, delta, status, note = '') {
    this.lines += 1;
    if (status === 'known') this.known += 1;
    if (status === 'FAIL') this.failures.push(`${where} ${target}: mock ${mock} got ${got} (delta ${delta})${note ? ` ${note}` : ''}`);
    if (typeof delta === 'number') this.worst.set(target, Math.max(this.worst.get(target) ?? 0, delta));
    console.log(`${where.padEnd(28)} ${target.padEnd(24)} mock ${String(mock).padEnd(30)} got ${String(got).padEnd(30)} ${typeof delta === 'number' ? `d${delta.toFixed(2)}`.padEnd(7) : String(delta).padEnd(7)} ${status}${note ? `  ${note}` : ''}`);
  }

  /** A failure with no numbers behind it (an error in the page, a behaviour that did not hold). */
  fail(where, what) {
    this.lines += 1;
    this.failures.push(`${where}: ${what}`);
    console.log(`${where.padEnd(28)} FAIL ${what}`);
  }

  note(where, what) {
    console.log(`${where.padEnd(28)} note ${what}`);
  }
}
