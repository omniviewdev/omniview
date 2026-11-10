#!/usr/bin/env node
/**
 * Whole-app profiling: the production frontend of a selected host checkout, in Playwright
 * Chromium with the Wails backend faked in the page. Runs scripted scenarios and writes JSON
 * plus a Markdown summary. See bench/app/README.md.
 *
 *   node bench/app/run.mjs [--runs 5] [--only cold-start,pods] [--no-build] [--headed] [--out file.json]
 *
 * Scroll baselines (paced wheel input, reversals, jumps; metric states; sparse updates):
 *
 *   node bench/app/run.mjs --react normal --only scroll --cpu-throttle 1,4 \
 *     --app-root /path/to/host --plugin-assets <kubernetes ui dist/assets> --plugin-metadata <plugin.json>
 *
 * `--build-only` builds and stops; `--serve-only` builds if needed and serves the frontend for a
 * native WebView. Nothing is written into `--app-root`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright';

import { buildFrontend, readBuildManifest, requireAppRoot, startPreview } from './build.mjs';
import { parseOptions, protocolDeviations, REFERENCE_PROTOCOL } from './options.mjs';
import {
  fileSHA256,
  gitSourceIdentity,
  hashDirectoryTree,
  hashPluginBundle,
  kubernetesSource,
  pluginAssetDirectory,
  pluginCheckoutIdentity,
  pluginMetadataFile,
  requirePluginBundle,
} from './plugin-bundle.mjs';
import { harnessIdentity, MANIFEST_NAME, uiPackageProvenance } from './provenance.mjs';
import { runScrollCell } from './scroll-cells.mjs';
import { scrollPages } from './scroll-driver.mjs';
import { buildCells } from './workloads.mjs';

const here = import.meta.dirname;
const harnessRoot = path.resolve(here, '../..');
const opts = parseOptions(process.argv.slice(2), { harnessRoot });
const appRoot = opts.appRoot;

const RUNS = opts.runs;
const CPU_THROTTLE = opts.cpuThrottles[0];
const VIEWPORT = { width: 1440, height: 900 };
const POD_COUNT = 5_000;
const LOG_LINES = 10_000;
const SCROLL_PAGES = 30;
const DRAWER_TOGGLES = 10;
const POD_NAME = /^[a-z-]+-[0-9a-f]{10}-[0-9a-f]{5}$/;

// Identity of what the legacy scenarios measure, recorded in every result that includes them. Change
// `id` whenever a scenario's fixture, record count or steps change, so results of different workloads
// are never compared as if they matched. bench/app/README.md defines what each id measures; results
// without an id are unknown legacy workloads. The parameters are the ones this runner actually applies.
const WORKLOAD = {
  id: 'whole-app/v1',
  viewport: VIEWPORT,
  pods: { records: POD_COUNT, scrollPages: SCROLL_PAGES },
  logs: { lines: LOG_LINES, scrollPages: SCROLL_PAGES, drawerToggles: DRAWER_TOGGLES },
};

// ---------------------------------------------------------------- plugin, build, serve

const pluginAssets = opts.pluginAssets ? pluginAssetDirectory(appRoot, opts.pluginAssets) : pluginAssetDirectory(appRoot);
const pluginMetadata = opts.pluginMetadata ? pluginMetadataFile(appRoot, opts.pluginMetadata) : pluginMetadataFile(appRoot);

function ensurePluginBundle() {
  if (opts.pluginAssets || process.env.OV_K8S_PLUGIN_DIST !== undefined || fs.existsSync(path.join(pluginAssets, 'entry.js'))) {
    requirePluginBundle(pluginAssets);
    return;
  }
  const ui = path.join(kubernetesSource(root), 'ui');
  if (!fs.existsSync(path.join(ui, 'package.json'))) {
    throw new Error(`Kubernetes checkout not found at ${ui}; set KUBERNETES_SOURCE to an external checkout`);
  }
  console.log(`Building the Kubernetes plugin UI bundle (${ui})…`);
  for (const args of [['install', '--frozen-lockfile'], ['run', 'build']]) {
    const r = spawnSync('pnpm', args, { cwd: ui, stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed in ${ui}`);
  }
  requirePluginBundle(pluginAssets);
}

let server;
let browser;
let closing = false;
async function cleanup() {
  if (closing) return;
  closing = true;
  await browser?.close().catch(() => undefined);
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(signal, () => { void cleanup().finally(() => process.exit(code)); });
}

// The app root's dependencies matter only when building (buildFrontend checks them); a reused build needs none.
let buildInfo;
if (opts.noBuild) {
  requirePluginBundle(pluginAssets);
  buildInfo = readBuildManifest(opts.dist);
  if (buildInfo.state !== 'verified' && opts.scroll.length) {
    throw new Error(`a reused build must carry a verified manifest to be measured by a scroll scenario (${buildInfo.reason}); rebuild it with this runner`);
  }
  if (buildInfo.state === 'verified' && opts.scroll.length && !opts.allowHarnessDrift) {
    // The page sampler is bundled into the build; the runner reads what it returns. A runner edited
    // after the build would read results the page never produced and report them as missing.
    const built = buildInfo.manifest.harness?.treeSHA256;
    const running = harnessIdentity(harnessRoot).treeSHA256;
    if (built !== running) {
      throw new Error(`the build was made by harness ${built?.slice(0, 12) ?? 'unknown'} and this runner is harness ${running.slice(0, 12)}: the page sampler and the runner can disagree. Rebuild it with this runner (--build-only), or pass --allow-harness-drift for a diagnostic run that is never compared.`);
    }
  }
  if (buildInfo.state === 'verified' && opts.reactExplicit && buildInfo.manifest.react !== opts.react) {
    throw new Error(`--react ${opts.react} contradicts the reused build, which is ${buildInfo.manifest.react}`);
  }
} else {
  ensurePluginBundle();
  console.log(`Building the ${opts.react} frontend of ${appRoot}\n  into ${opts.dist} …`);
  const manifest = await buildFrontend({ harnessRoot, options: opts, pluginAssets, pluginMetadata });
  buildInfo = { state: 'verified', manifest };
  console.log(`Built ${manifest.bundle.files} files, ${(manifest.bundle.bytes / 2 ** 20).toFixed(1)} MB, tree sha256 ${manifest.bundle.treeSHA256.slice(0, 12)}; minify ${JSON.stringify(manifest.minify.effective)}, React ${manifest.reactDom}, ${manifest.buildMs} ms.`);
}
if (opts.buildOnly) {
  console.log(JSON.stringify({ dist: opts.dist, manifest: path.join(opts.dist, MANIFEST_NAME), react: buildInfo.manifest.react, minify: buildInfo.manifest.minify, bundle: buildInfo.manifest.bundle }, null, 2));
  process.exit(0);
}

const buildManifest = buildInfo.state === 'verified' ? buildInfo.manifest : null;
const reactBuild = buildManifest?.react ?? 'unknown';

server = await startPreview({ harnessRoot, dist: opts.dist, pluginAssets, port: opts.port });
const baseURL = server.resolvedUrls.local[0];

if (opts.serveOnly) {
  const config = encodeURIComponent(JSON.stringify({ plugins: ['kubernetes'], pods: opts.pods, metrics: 'healthy', instance: 'production' }));
  console.log(`Serving the ${reactBuild} frontend (${opts.dist}) at ${baseURL}\n`
    + `Native WebView URL (edit the ovbench JSON for metrics hidden|unavailable|healthy):\n`
    + `  ${baseURL}?ovbench=${config}#/_plugin/kubernetes/cluster/bench/resources/${encodeURIComponent('k8s:/pods')}\n`
    + 'In the page: window.__ovBench.help(). Press Ctrl-C to stop.');
  await new Promise(() => {});
}

browser = await chromium.launch({
  headless: !opts.headed,
  args: ['--enable-precise-memory-info'],
});

// ---------------------------------------------------------------- provenance

/**
 * Identify the sources and plugin bytes about to be measured. The plugin commit is a claim about a real
 * checkout, never a guess from the metadata file's parent directory, which can belong to the host repository.
 */
function captureProvenance() {
  const manifest = buildManifest;
  const claimed = gitSourceIdentity(appRoot);
  return {
    // A verified manifest records the source that was built; without one only the claimed app root can say.
    hostSource: manifest?.hostSource ?? claimed,
    currentHostSource: manifest && path.resolve(manifest.appRoot) === appRoot ? claimed : null,
    frontend: {
      config: manifest ? 'bench/app/vite.config.ts' : 'unknown',
      reactBuild,
      reactDom: manifest?.reactDom ?? 'unknown',
      minify: manifest?.minify ?? null,
      configSHA256: manifest ? fileSHA256(path.join(harnessRoot, 'bench/app/vite.config.ts')) : null,
      rebuilt: !opts.noBuild,
      manifest: { state: buildInfo.state, reason: buildInfo.reason ?? null },
      distDir: opts.dist,
      bundle: hashDirectoryTree(opts.dist, { exclude: [MANIFEST_NAME] }),
    },
    plugin: {
      selection: {
        assets: opts.pluginAssets || process.env.OV_K8S_PLUGIN_DIST !== undefined ? 'override' : 'default',
        metadata: opts.pluginMetadata || process.env.OV_K8S_PLUGIN_METADATA !== undefined ? 'override' : 'default',
      },
      checkout: pluginCheckoutIdentity({ hostRoot: appRoot, metadataFile: pluginMetadata, assets: pluginAssets }),
      metadataSHA256: fileSHA256(pluginMetadata),
      bundle: hashPluginBundle(pluginAssets),
    },
  };
}

// ---------------------------------------------------------------- page plumbing (legacy scenarios)

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
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE });
  return { page, cdp, errors, close: () => context.close() };
}

async function cdpMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

/**
 * Run `action` and report what it cost: wall time (as measured by the action in
 * the page, or around it), main-thread time from CDP, long tasks, React commits.
 * The React columns exist only in the profiling build; the normal build has no <Profiler>,
 * so they are null, never zero.
 */
async function measure(s, action) {
  const before = await cdpMetrics(s.cdp);
  const t0 = await s.page.evaluate(() => { window.__ovProfile?.take(); return performance.now(); });
  const result = (await action()) ?? {};
  const t1 = await s.page.evaluate(() => performance.now());
  const after = await cdpMetrics(s.cdp);
  const tail = await s.page.evaluate((since) => ({
    profile: window.__ovProfile ? window.__ovProfile.take() : null,
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
  if (!p) return { commits: null, renderMs: null, maxCommitMs: null, slowCommits: null };
  return { commits: p.commits, renderMs: p.actualMs, maxCommitMs: p.maxActualMs, slowCommits: p.slowCommits };
}

const podsRoute = (id) => `#/_plugin/kubernetes/cluster/${id}/resources/${encodeURIComponent('k8s:/pods')}`;

/** Wait (polling every frame) until a pod name is on screen. */
async function waitForPodRow(page) {
  await page.getByText(POD_NAME).first().waitFor({ timeout: 30_000 });
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

// ---------------------------------------------------------------- legacy scenarios

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

  /** Acquire the complete 5,000-Pod source-view collection, then scroll up to 30 viewport steps through it (workload whole-app/v1). */
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
        // Labels such as Expand also belong to sidebar tree items. Resolve both
        // the measured element and its control from the log viewer's drawer.
        const drawerEl = document.querySelector('input[placeholder="Search in logs"]')?.closest('.BottomDrawer');
        if (!drawerEl) throw new Error('bottom drawer not found');
        const toggle = () => {
          const button = drawerEl.querySelector('[data-ov-drawer-strip] button[aria-label="Minimize"], [data-ov-drawer-strip] button[aria-label="Expand"]');
          if (!button || button.disabled) throw new Error('bottom drawer toggle not available');
          return button;
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
        profile: window.__ovProfile ? window.__ovProfile.take() : null,
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

const results = {};
const scenarioMeta = {};
const failures = [];
const cells = buildCells(opts);
try {
  for (const name of opts.legacy) {
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
  const env = { browser, baseURL, options: opts, reactBuild };
  for (const cell of cells) {
    process.stdout.write(`${cell.key}: warmup ${opts.warmupSeconds}s, trial`);
    const cellResult = await runScrollCell(env, cell);
    process.stdout.write('\n');
    results[cell.key] = cellResult.trials;
    scenarioMeta[cell.key] = cellResult.session;
    if (cellResult.failed) {
      failures.push(cell.key);
      console.error(`${cell.key} failed: ${cellResult.session.failure.split('\n')[0]}`);
    }
  }
} finally {
  const version = browser.version();
  await cleanup();
  browser = { version: () => version };
}

const provenance = captureProvenance();
const { hostSource, plugin, frontend } = provenance;
let playwrightVersion = null;
try {
  playwrightVersion = createRequire(import.meta.url)('playwright/package.json').version;
} catch {
  // Not resolvable through the package exports; the version stays unknown.
}
const meta = {
  date: new Date().toISOString(),
  commit: hostSource.short ?? 'unknown',
  dirty: hostSource.dirty ?? null,
  k8sPlugin: plugin.checkout.short ?? 'unknown',
  chromium: browser.version(),
  host: `${os.type()} ${os.arch()}, ${os.cpus()[0]?.model}, ${Math.round(os.totalmem() / 2 ** 30)} GB`,
  runs: RUNS,
  cpuThrottle: CPU_THROTTLE,
  ...(opts.legacy.length ? { workload: WORKLOAD } : {}),
  // Reusing a bundle cannot establish which React build produced it without a verified manifest. Its bytes remain identified.
  frontend,
  hostSource,
  currentHostSource: provenance.currentHostSource,
  plugin,
  label: opts.label,
  appRoot: buildManifest?.appRoot ?? appRoot,
  harness: { ...harnessIdentity(harnessRoot), builtWith: buildManifest?.harness?.treeSHA256 ?? null },
  ui: buildManifest ? buildManifest.ui : { observedAtRunNotAtBuild: true, packages: uiPackageProvenance(appRoot) },
  engine: { name: 'chromium', version: browser.version(), headless: !opts.headed, playwright: playwrightVersion, fixture: 'in-page fake Wails transport (no IPC, no native backend)' },
  environment: { node: process.version, platform: process.platform, arch: os.arch(), osRelease: os.release(), cpuModel: os.cpus()[0]?.model ?? null, cpuCount: os.cpus().length, memoryGB: Math.round(os.totalmem() / 2 ** 30) },
  ...(cells.length ? {
    protocol: { reference: REFERENCE_PROTOCOL, deviations: protocolDeviations(opts, { reactBuild }) },
    scenarios: scenarioMeta,
    options: {
      command: process.argv.slice(2),
      react: opts.react, minify: opts.minify, configLoader: opts.configLoader, cpuThrottles: opts.cpuThrottles, pods: opts.pods,
      metrics: opts.metrics, updates: opts.updates, update: opts.update, metricRefreshMs: opts.metricRefreshMs,
      metricChangedFraction: opts.metricChangedFraction, metricDelayMs: opts.metricDelayMs,
      warmupSeconds: opts.warmupSeconds, trialSeconds: opts.trialSeconds, trials: opts.trials,
      speedPxPerSecond: opts.speed, inputHz: opts.inputHz, reversalSegmentSeconds: opts.reversalSegmentSeconds, jumpPages: opts.jumpPages,
      capture: opts.capture, mutations: opts.mutations, raw: opts.raw, overheadControl: opts.overheadControl, smoke: opts.smoke,
    },
  } : {}),
};


fs.mkdirSync(path.dirname(opts.out), { recursive: true });
fs.writeFileSync(opts.out, JSON.stringify({ meta, results }, null, 2));
const summary = (await import('./report.mjs')).summarize({ meta, results });
process.stdout.write('\n' + summary);
if (opts.markdown) {
  fs.mkdirSync(path.dirname(opts.markdown), { recursive: true });
  fs.writeFileSync(opts.markdown, summary);
}
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
console.log(`\nWrote ${path.relative(process.cwd(), opts.out)}${opts.markdown ? ` and ${path.relative(process.cwd(), opts.markdown)}` : ''}`);
if (failures.length) {
  console.error(`${failures.length} cell(s) failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
