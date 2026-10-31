#!/usr/bin/env node
/**
 * Whole-app profiling: the production frontend (profiling build, see
 * vite.config.ts here) in Playwright Chromium with the Wails backend faked in
 * the page. Runs scripted scenarios and writes JSON plus a Markdown summary.
 * See bench/app/README.md.
 *
 *   node bench/app/run.mjs [--runs 5] [--only cold-start,pods] [--no-build] [--headed] [--out file.json]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { chromium } from 'playwright';
import { build, preview } from 'vite';

import { pluginAssetDirectory, requirePluginBundle } from './plugin-bundle.mjs';
const here = import.meta.dirname;
const root = path.resolve(here, '../..');
const configFile = path.join(here, 'vite.config.ts');

const { values: opts } = parseArgs({
  options: {
    runs: { type: 'string', default: '5' },
    only: { type: 'string' },
    'no-build': { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false },
    out: { type: 'string', default: path.join(here, 'results/latest.json') },
  },
});
const RUNS = Number(opts.runs);
const VIEWPORT = { width: 1440, height: 900 };
const POD_COUNT = 5_000;
const LOG_LINES = 10_000;
const SCROLL_PAGES = 30;
const DRAWER_TOGGLES = 10;
const POD_NAME = /^[a-z-]+-[0-9a-f]{10}-[0-9a-f]{5}$/;

// ---------------------------------------------------------------- build + serve

function ensurePluginBundle() {
  const assets = pluginAssetDirectory(root);
  if (process.env.OV_K8S_PLUGIN_DIST !== undefined || fs.existsSync(path.join(assets, 'entry.js'))) {
    requirePluginBundle(assets);
    return;
  }
  const ui = path.join(root, 'plugins/kubernetes/ui');
  if (!fs.existsSync(path.join(ui, 'package.json'))) {
    throw new Error('plugins/kubernetes is not checked out: git submodule update --init plugins/kubernetes');
  }
  console.log('Building the kubernetes plugin UI bundle (plugins/kubernetes/ui)…');
  for (const args of [['install', '--frozen-lockfile'], ['run', 'build']]) {
    const r = spawnSync('pnpm', args, { cwd: ui, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed in plugins/kubernetes/ui`);
  }
  requirePluginBundle(assets);
}

if (!opts['no-build']) {
  ensurePluginBundle();
  console.log('Building the profiling bundle (bench/app/dist)…');
  await build({ configFile, logLevel: 'warn' });
}
if (opts['no-build']) requirePluginBundle(pluginAssetDirectory(root));
const server = await preview({ configFile, logLevel: 'warn' });
const baseURL = server.resolvedUrls.local[0];

const browser = await chromium.launch({
  headless: !opts.headed,
  args: ['--enable-precise-memory-info'],
});

// ---------------------------------------------------------------- page plumbing

/** In every page: collect long tasks from the start of navigation. */
function installObservers() {
  window.__ovLongTasks = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__ovLongTasks.push({ start: e.startTime, duration: e.duration });
  }).observe({ type: 'longtask', buffered: true });
}

async function openPage(config) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((c) => { window.__OV_BENCH__ = c; }, config);
  await page.addInitScript(installObservers);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  return { page, cdp, errors, close: () => context.close() };
}

async function cdpMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

/**
 * Run `action` and report what it cost: wall time (as measured by the action in
 * the page, or around it), main-thread time from CDP, long tasks, React commits.
 */
async function measure(s, action) {
  const before = await cdpMetrics(s.cdp);
  const t0 = await s.page.evaluate(() => { window.__ovProfile.take(); return performance.now(); });
  const result = (await action()) ?? {};
  const t1 = await s.page.evaluate(() => performance.now());
  const after = await cdpMetrics(s.cdp);
  const tail = await s.page.evaluate((since) => ({
    profile: window.__ovProfile.take(),
    longTasks: window.__ovLongTasks.filter((t) => t.start >= since),
  }), t0);
  const busy = cpu(before, after);
  return {
    ...result,
    wallMs: result.wallMs ?? t1 - t0,
    ...busy,
    // Main-thread time per step: the work behind each scroll page / toggle, without the frame-wait floor.
    ...(result.steps ? { busyPerStepMs: busy.taskMs / result.steps } : {}),
    heapMB: after.JSHeapUsedSize / 2 ** 20,
    ...longTaskStats(tail.longTasks),
    ...react(tail.profile),
  };
}

const sec2ms = (v) => v * 1000;
function cpu(a, b) {
  const d = (k) => sec2ms((b[k] ?? 0) - (a[k] ?? 0));
  return { taskMs: d('TaskDuration'), scriptMs: d('ScriptDuration'), layoutMs: d('LayoutDuration'), styleMs: d('RecalcStyleDuration') };
}
function longTaskStats(tasks) {
  return {
    longTasks: tasks.length,
    longTaskMaxMs: tasks.reduce((m, t) => Math.max(m, t.duration), 0),
    // Total blocking time: the part of each long task beyond 50 ms.
    blockingMs: tasks.reduce((s, t) => s + Math.max(0, t.duration - 50), 0),
  };
}
function react(p) {
  return { commits: p.commits, renderMs: p.actualMs, maxCommitMs: p.maxActualMs, slowCommits: p.slowCommits };
}

const podsRoute = (id) => `#/_plugin/kubernetes/cluster/${id}/resources/${encodeURIComponent('k8s:/pods')}`;

/** Wait (polling every frame) until a pod name is on screen. */
async function waitForPodRow(page) {
  await page.getByText(POD_NAME).first().waitFor({ timeout: 30_000 });
}

/**
 * Scroll up to `pages` viewport steps within the available native page, then
 * return to the top. Each step waits for a painted frame, including React work
 * scheduled by the scroll handler. Runs in the page.
 */
function scrollPages({ pages, kind }) {
  const b = window.__ovBench;
  let target = null;
  if (kind === 'logs') {
    // The log list: the nearest scroll area around the viewer's search box.
    for (let n = document.querySelector('input[placeholder="Search in logs"]'); n && !target; n = n.parentElement) target = b.dom.findScrollable(n);
  } else {
    target = b.dom.findScrollable(document.body);
  }
  if (!target) throw new Error(`no scrollable ${kind} area`);
  const settle = () => new Promise((r) => requestAnimationFrame(() => setTimeout(() => requestAnimationFrame(r), 0)));
  return (async () => {
    target.scrollTop = 0;
    await settle();
    const viewport = target.clientHeight;
    const range = target.scrollHeight - viewport;
    if (viewport <= 0 || range <= 0 || !Number.isSafeInteger(pages) || pages <= 0) {
      throw new Error(`${kind}: no positive bounded scroll workload`);
    }
    const forwardSteps = Math.min(pages, Math.ceil(range / viewport));
    const expectedEnd = Math.min(forwardSteps * viewport, range);
    const t0 = performance.now();
    let previous = target.scrollTop;
    for (let i = 1; i <= forwardSteps; i++) {
      const expected = Math.min(i * viewport, range);
      target.scrollTop = expected;
      await settle();
      const actual = target.scrollTop;
      if (actual <= previous || Math.abs(actual - expected) > 1) {
        throw new Error(`${kind}: scroll step ${i} did not reach ${expected}px (was ${actual}px)`);
      }
      previous = actual;
    }
    const end = target.scrollTop;
    target.scrollTop = 0;
    await settle();
    const wallMs = performance.now() - t0;
    if (end <= 0 || Math.abs(end - expectedEnd) > 1 || target.scrollTop > 1) {
      throw new Error(`${kind}: bounded scroll or reset failed (${end}px, reset ${target.scrollTop}px)`);
    }
    const steps = forwardSteps + 1;
    return { wallMs, steps, forwardSteps, perStepMs: wallMs / steps, scrolledPx: end };
  })();
}

/**
 * Open the first pod row's action menu. Older plugin builds have no accessible
 * name on the button, so fall back to the right-most visible button in that row.
 */
async function openRowMenu(page) {
  const named = page.getByRole('button', { name: 'Row actions' }).first();
  if (await named.count()) return named.click();
  const at = await page.evaluate((re) => {
    const name = window.__ovBench.dom.findByText(document.body, new RegExp(re));
    const y = name.getBoundingClientRect();
    const mid = y.top + y.height / 2;
    const buttons = [...document.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.top <= mid && r.bottom >= mid && r.right <= window.innerWidth; });
    const last = buttons.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0];
    const r = last.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, POD_NAME.source);
  await page.mouse.click(at.x, at.y);
}

// ---------------------------------------------------------------- scenarios

const scenarios = {
  /** Shell only, no plugins: comparable to the native cold-start script (empty state dir). */
  async 'cold-start'() {
    return coldStart({ plugins: [] });
  },

  /** Shell plus the kubernetes plugin bundle, until the plugin's home card shows. */
  async 'cold-start-k8s'() {
    return coldStart({ plugins: ['kubernetes'] }, async (page) => {
      await page.getByText('No clusters connected').waitFor();
      return page.evaluate(() => performance.now());
    });
  },

  /** Open the native Pod page from a 5k-pod corpus, then scroll up to 30 viewport steps within that page. */
  async pods() {
    const s = await openPage({ plugins: ['kubernetes'], pods: POD_COUNT });
    try {
      await s.page.goto(baseURL);
      await s.page.evaluate(() => window.__ovBench.startup());
      await s.page.getByText('No clusters connected').waitFor();
      const open = await measure(s, async () => {
        const t0 = await s.page.evaluate((hash) => { const t = performance.now(); location.hash = hash; return t; }, podsRoute('bench'));
        await waitForPodRow(s.page);
        return { wallMs: (await s.page.evaluate(() => performance.now())) - t0 };
      });
      await s.page.waitForTimeout(500); // let metrics and follow-up queries settle
      const scroll = await measure(s, () => s.page.evaluate(scrollPages, { pages: SCROLL_PAGES, kind: 'pods' }));
      return { open, scroll, errors: s.errors };
    } finally {
      await s.close();
    }
  },

  /** Open a pod's logs from the row menu, stream 10k lines, scroll the viewer, toggle the drawer. */
  async logs() {
    const s = await openPage({ plugins: ['kubernetes'], pods: 100 });
    try {
      await s.page.goto(baseURL + podsRoute('bench'));
      await waitForPodRow(s.page);
      // Let metrics land first: older table builds re-mount rows then, closing an open row menu.
      await s.page.waitForTimeout(1000);
      const logsMenu = s.page.getByRole('menuitem', { name: /Logs/ });
      await openRowMenu(s.page);
      await logsMenu.waitFor();
      // Scope items to the Logs submenu; new parent actions are not log targets.
      const logsItem = s.page.getByRole('menu')
        .filter({ hasNot: logsMenu })
        .getByRole('menuitem').first();
      for (let i = 0; !(await logsItem.isVisible()); i++) {
        if (i === 10) throw new Error('the Logs submenu did not open');
        await logsMenu.hover();
        await s.page.waitForTimeout(200);
      }
      // Move onto the submenu item so it stays open before timing the click.
      await logsItem.hover();
      const open = await measure(s, async () => {
        const t0 = await s.page.evaluate(() => performance.now());
        await logsItem.click();
        await s.page.getByPlaceholder('Search in logs').waitFor();
        return { wallMs: (await s.page.evaluate(() => performance.now())) - t0 };
      });
      const sessionId = await s.page.evaluate(() => window.__ovBench.logSessions.at(-1));
      const stream = await measure(s, () => s.page.evaluate(async ({ id, count }) => {
        const { dom } = window.__ovBench;
        // The viewer's line counter ("10,000 lines"), found once so polling it is cheap.
        const isCounter = (e) => e.childElementCount <= 2 && /^[\d,]+\s*lines?$/.test(e.textContent.trim());
        const label = `${count.toLocaleString('en-US')} lines`;
        const t0 = performance.now();
        const streamed = window.__ovBench.streamLogs(id, count);
        const counter = await dom.waitFor(() => [...document.querySelectorAll('span, div, p')].find(isCounter), { label: 'line counter' });
        await streamed;
        await dom.waitFor(() => counter.isConnected && counter.textContent.trim() === label, { label });
        const wallMs = performance.now() - t0;
        // Whether follow mode kept the newest line on screen.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const following = !!window.__ovBench.dom.findByText(document.body, new RegExp(`^\\[#${count - 1}\\]`));
        return { wallMs, following };
      }, { id: sessionId, count: LOG_LINES }));
      const scroll = await measure(s, () => s.page.evaluate(scrollPages, { pages: SCROLL_PAGES, kind: 'logs' }));
      const drawer = await measure(s, () => s.page.evaluate(async (toggles) => {
        // The drawer is the element its resize code sizes inline; the toggle is the
        // right-most button in its top strip (labelled Minimize/Expand in newer builds).
        let el = document.querySelector('input[placeholder="Search in logs"]');
        while (el && !el.style.maxHeight) el = el.parentElement;
        if (!el) throw new Error('bottom drawer not found');
        const drawerEl = el;
        const toggle = () => {
          const labelled = document.querySelector('[aria-label="Minimize"], [aria-label="Expand"]');
          if (labelled) return labelled;
          const top = drawerEl.getBoundingClientRect().top;
          const strip = [...drawerEl.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().top - top < 40);
          return strip.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0];
        };
        const height = () => drawerEl.getBoundingClientRect().height;
        const t0 = performance.now();
        for (let i = 0; i < toggles; i++) {
          const before = height();
          toggle().click();
          await window.__ovBench.dom.waitFor(() => Math.abs(height() - before) > 50, { label: `drawer toggle ${i + 1}` });
          await new Promise((r) => requestAnimationFrame(() => setTimeout(() => requestAnimationFrame(r), 0)));
        }
        const wallMs = performance.now() - t0;
        return { wallMs, steps: toggles, perStepMs: wallMs / toggles };
      }, DRAWER_TOGGLES));
      return { open, stream, scroll, drawer, errors: s.errors };
    } finally {
      await s.close();
    }
  },
};

async function coldStart(config, untilReady) {
  const s = await openPage(config);
  try {
    await s.page.goto(baseURL);
    const startup = await s.page.evaluate(() => window.__ovBench.startup());
    const pluginReadyMs = untilReady ? await untilReady(s.page) : undefined;
    const tail = await s.page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        nav: { responseEnd: nav.responseEnd, domContentLoaded: nav.domContentLoadedEventEnd, load: nav.loadEventEnd },
        profile: window.__ovProfile.take(),
        longTasks: window.__ovLongTasks,
        calls: window.__ovBench.takeCalls(),
        unhandled: window.__ovBench.unhandledCalls(),
      };
    });
    const m = await cdpMetrics(s.cdp);
    return {
      // All times are ms from navigation start.
      mainStartMs: startup.ui_main_start_ms,
      committedMs: startup.ui_committed_ms,
      readyMs: startup.ui_ready_ms,
      pluginReadyMs,
      domContentLoadedMs: tail.nav.domContentLoaded,
      loadMs: tail.nav.load,
      ...cpu({}, m),
      heapMB: m.JSHeapUsedSize / 2 ** 20,
      ...longTaskStats(tail.longTasks),
      ...react(tail.profile),
      backendCalls: Object.values(tail.calls).reduce((a, b) => a + b, 0),
      unhandled: tail.unhandled,
      errors: s.errors,
    };
  } finally {
    await s.close();
  }
}

// ---------------------------------------------------------------- run + report

const selected = opts.only ? opts.only.split(',') : Object.keys(scenarios);
for (const name of selected) if (!scenarios[name]) throw new Error(`unknown scenario ${name}; have ${Object.keys(scenarios).join(', ')}`);

const results = {};
try {
  for (const name of selected) {
    // One discarded warmup run (disk cache, V8 code cache for the preview server's files).
    process.stdout.write(`${name}: warmup`);
    await scenarios[name]();
    results[name] = [];
    for (let i = 0; i < RUNS; i++) {
      process.stdout.write(` ${i + 1}`);
      results[name].push(await scenarios[name]());
    }
    process.stdout.write('\n');
  }
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}

const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' }).stdout.trim();
const meta = {
  date: new Date().toISOString(),
  commit: git('rev-parse', '--short', 'HEAD'),
  dirty: git('status', '--porcelain', '--untracked-files=no') !== '',
  k8sPlugin: spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: path.join(root, 'plugins/kubernetes'), encoding: 'utf8' }).stdout.trim(),
  chromium: browser.version(),
  host: `${os.type()} ${os.arch()}, ${os.cpus()[0]?.model}, ${Math.round(os.totalmem() / 2 ** 30)} GB`,
  runs: RUNS,
};

fs.mkdirSync(path.dirname(opts.out), { recursive: true });
fs.writeFileSync(opts.out, JSON.stringify({ meta, results }, null, 2));
const summary = (await import('./report.mjs')).summarize({ meta, results });
process.stdout.write('\n' + summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
console.log(`\nWrote ${path.relative(process.cwd(), opts.out)}`);
