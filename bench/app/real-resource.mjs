#!/usr/bin/env node
// Real managed host/provider boundary. Never installs a transport mock or starts Vite.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { cpuDelta, frameBytes, requireInstance, unavailable } from './resource-measurements.mjs';
import { hostResourceMetrics } from './host-resource-metrics.mjs';

const { values } = parseArgs({ options: {
  dev: { type: 'string' }, workspace: { type: 'string' }, 'workspace-id': { type: 'string' }, generation: { type: 'string' },
  runs: { type: 'string', default: '3' }, copies: { type: 'string', default: '1000' }, out: { type: 'string' },
  'host-metrics-socket': { type: 'string' },
} });
for (const key of ['dev', 'workspace', 'workspace-id', 'generation', 'host-metrics-socket', 'out']) if (!values[key]) throw new Error(`Require --${key}`);
const runs = Number(values.runs), copies = Number(values.copies);
if (!Number.isInteger(runs) || runs < 2 || !Number.isInteger(copies) || copies < 200 || copies > 10000) throw new Error('Require >=2 repeats and 200..10000 stress copies');
if (process.env.GOWORK !== 'off') throw new Error('Use clean baseline-env/GOWORK=off');
const workspace = await realpath(values.workspace);
const manifest = JSON.parse(await readFile(join(workspace, 'workspace.json'), 'utf8'));
if (manifest.workspaceID !== values['workspace-id']) throw new Error('Workspace UUID mismatch');
const cli = (...args) => JSON.parse(execFileSync(values.dev, [...args, '--workspace', workspace, '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
function inspect() {
  const response = cli('instance', 'inspect');
  if (response.status !== 'succeeded' || response.error || response.workspaceID !== values['workspace-id'] || response.generation !== values.generation) throw new Error('Authenticated instance selection failed');
  const instance = response.result;
  const expectedSource = join(workspace, manifest.repositories.find((repository) => repository.id === 'omniview').directory);
  requireInstance({ ...instance, hostSource: instance.process.source }, { workspaceID: values['workspace-id'], generation: values.generation, stateRoot: instance.stateRoot, hostSource: expectedSource });
  if (instance.kind !== 'development' || instance.process.workspaceID !== instance.workspaceID || instance.process.generation !== instance.generation) throw new Error('Not selected development host process');
  return instance;
}
const beforeInstance = inspect();
const status = cli('workspace', 'inspect');
const stateRoot = status.stateRoot ?? status.result?.stateRoot;
if (stateRoot !== beforeInstance.stateRoot) throw new Error('State root differs from workspace inspection');
const sourceProvenance = [];
for (const repository of manifest.repositories) {
  const path = join(workspace, repository.directory);
  const head = execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== repository.baseCommit) throw new Error(`Selected source changed: ${repository.id}`);
  const diff = execFileSync('git', ['-C', path, 'diff', '--binary', 'HEAD'], { maxBuffer: 16 * 1024 * 1024 });
  sourceProvenance.push({ ...repository, head, trackedDiffSHA256: createHash('sha256').update(diff).digest('hex') });
}
const fixtureRoot = join(workspace, 'omniview/e2e/fixtures/workspace-probe');
const fixtureHashes = {};
for (const relative of ['plugin.yaml', 'pkg/main.go', 'pkg/resource-benchmark.go', 'pkg/resource-corpus.json', 'pkg/resource-benchmark_test.go', 'pkg/resource-events_test.go', 'ui/src/ResourceBenchmark.tsx', 'ui/src/ProbePage.tsx', 'ui/package.json', 'ui/pnpm-lock.yaml', 'ui/tsconfig.json']) {
  const canonical = await readFile(join(fixtureRoot, relative));
  const managed = await readFile(join(workspace, 'workspace-probe', relative));
  if (!canonical.equals(managed)) throw new Error(`Managed probe differs from canonical fixture: ${relative}`);
  fixtureHashes[relative] = createHash('sha256').update(canonical).digest('hex');
}
const instrumentationHashes = {};
for (const relative of ['bench/app/real-resource.mjs', 'bench/app/resource-measurements.mjs', 'bench/app/host-resource-metrics.mjs', 'bench/app/export-resource-corpus.mjs', 'internal/devcontrol/host/resource_benchmark_metrics.go', 'internal/devcontrol/host/registration_enabled.go', 'internal/instance/profile.go']) {
  instrumentationHashes[relative] = createHash('sha256').update(await readFile(join(workspace, 'omniview', relative))).digest('hex');
}
const out = resolve(values.out);
await mkdir(dirname(out), { recursive: true });
const report = {
  schemaVersion: 1, evidence: 'real SDK provider process → host Go → Wails HTTP/events → runtime → diagnostic base-ui DataTable; Chromium browser only',
  at: new Date().toISOString(), environment: { platform: os.platform(), release: os.release(), arch: os.arch(), cpus: os.cpus(), memoryBytes: os.totalmem(), node: process.version, go: execFileSync('go', ['version'], { encoding: 'utf8' }).trim(), pnpm: execFileSync(process.env.OMNIVIEW_PNPM_EXECUTABLE ?? 'pnpm', ['--version'], { encoding: 'utf8' }).trim(), viewport: { width: 1440, height: 1000 } },
  instance: beforeInstance, sources: sourceProvenance, fixtureHashes, instrumentationHashes, repeats: runs, copies,
  samples: [], errors: [], network: [], screenshots: [], cleanup: [],
  availability: {
    hostQueryEvaluations: unavailable('No production query engine in selected source; provider copied-row counts are not evaluations'),
    queryLeases: unavailable('No query lease API in selected source'),
    hostRetainedHeap: 'Actual host devcontrol-only private Unix sampler; explicit post-GC snapshots outside timed phases, with sampling overhead recorded',
    hostForwardingRefcounts: unavailable('No measurement getter; runtime hook unmount and actual unsubscribe requests are observed separately'),
    nativeWebView: unavailable('Chromium CDP does not measure native WebView paint/input'),
    sourceStreamCount: unavailable('Provider watches count Watch lifetimes, not host gRPC event-listener streams'),
    productionGroupsExpansion: unavailable('Default Resources view does not configure these; diagnostic DataTable-only models measured separately'),
    bridgeBytes: 'HTTP encoded transfer bytes + serialized request payload bytes and WS payload bytes; no TLS/socket framing or gRPC protobuf-byte claim',
    numericTransport: 'Actual decoded SDK Struct/JS bodies recorded; canonical raw JSON is never transported out of band to hide rounding',
    paint: 'Visible table + two requestAnimationFrame opportunities; not compositor pixel latency',
    stressIdentity: 'Repeated unmodified canonical payload copies, indexed by diagnostic copy ordinal, not new native identities',
    sourceNetwork: 'Fixture implementation has no source networking; clean HOME is not host egress isolation',
  },
};
const hostMetrics = (forcedGC = false) => hostResourceMetrics(values['host-metrics-socket'], beforeInstance, forcedGC);
report.hostBefore = await hostMetrics(true);
const browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info'] });
report.environment.chromium = browser.version();
let context, page, cdp;
const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
function processSample(pid) {
  return { pid, capturedAt: new Date().toISOString(), ps: execFileSync('/bin/ps', ['-p', String(pid), '-o', 'pid=,time=,rss=,%cpu='], { encoding: 'utf8' }).trim(), units: 'pid cumulative-CPU-time RSS-KiB recent-%CPU; RSS is NOT retained heap' };
}
// Serialized by Playwright into the real application document.
function twoFrames() {
  const { promise, resolve } = Promise.withResolvers();
  requestAnimationFrame(() => requestAnimationFrame(resolve));
  return promise;
}
async function measure(name, action) {
  const cpuBefore = await metrics();
  const networkStart = report.network.length;
  const heapBefore = await hostMetrics(false);
  const hostBefore = processSample(beforeInstance.process.pid);
  const started = await page.evaluate(() => performance.now());
  const result = await action();
  await page.evaluate(twoFrames);
  const ended = await page.evaluate(() => performance.now());
  const cpuAfter = await metrics();
  const longTasks = await page.evaluate((since) => window.__p02LongTasks.filter((task) => task.startTime >= since), started);
  const sample = { name, started, ended, wallMs: ended - started, ...cpuDelta(cpuBefore, cpuAfter), browserHeapUsedBytes: cpuAfter.JSHeapUsedSize, longTasks, hostBefore, hostAfter: processSample(beforeInstance.process.pid), result, networkRange: [networkStart, report.network.length] };
  sample.hostHeapBefore = heapBefore;
  sample.hostHeapAfter = await hostMetrics(false);
  report.samples.push(sample);
  return sample;
}
try {
  context = await browser.newContext({ viewport: report.environment.viewport });
  page = await context.newPage();
  page.on('pageerror', (error) => report.errors.push(error.message));
  await page.addInitScript(() => {
    window.__p02LongTasks = [];
    window.__p02Input = [];
    document.addEventListener('input', (event) => {
      if (event.target.getAttribute?.('aria-label') !== 'P02 local filter') return;
      const sample = { at: performance.now(), value: event.target.value };
      requestAnimationFrame(() => requestAnimationFrame(() => { sample.twoFramesAt = performance.now(); window.__p02Input.push(sample); }));
    }, true);
    new PerformanceObserver((entries) => { for (const entry of entries.getEntries()) window.__p02LongTasks.push({ startTime: entry.startTime, duration: entry.duration }); }).observe({ type: 'longtask', buffered: true });
  });
  cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Network.enable');
  const requests = new Map();
  const sockets = new Map();
  cdp.on('Network.requestWillBeSent', ({ requestId, request, timestamp }) => {
    if (new URL(request.url).pathname !== '/wails/runtime') return;
    let methodID;
    try { methodID = JSON.parse(request.postData ?? '{}').args?.methodID; } catch { /* preserve unclassified bridge traffic */ }
    const endpoint = new URL(request.url);
    endpoint.search = ''; endpoint.hash = '';
    requests.set(requestId, { kind: 'wails-http', requestId, url: endpoint.href, timestamp, methodID, serializedRequestPayloadBytes: Buffer.byteLength(request.postData ?? '') });
  });
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength, timestamp }) => {
    const request = requests.get(requestId);
    if (request) { report.network.push({ ...request, finished: timestamp, encodedResponseTransferBytes: encodedDataLength }); requests.delete(requestId); }
  });
  cdp.on('Network.webSocketCreated', ({ requestId, url }) => {
    const endpoint = new URL(url);
    endpoint.search = ''; endpoint.hash = '';
    sockets.set(requestId, endpoint.href);
  });
  for (const [event, direction] of [['Network.webSocketFrameReceived', 'received'], ['Network.webSocketFrameSent', 'sent']]) {
    cdp.on(event, ({ requestId, response, timestamp }) => {
      const url = sockets.get(requestId);
      report.network.push({ kind: 'websocket-payload', url, timestamp, direction, opcode: response.opcode, bytes: frameBytes(response), isWails: !!url && new URL(url).port === new URL(beforeInstance.endpoints.browser).port });
    });
  }
  await page.goto(beforeInstance.endpoints.browser);
  await page.waitForFunction(({ generation, instanceID }) => window.__OMNIVIEW_INSTANCE__?.generation === generation && window.__OMNIVIEW_INSTANCE__?.instanceID === instanceID, beforeInstance);
  await page.goto(`${beforeInstance.endpoints.browser.replace(/\/$/, '')}/#/_plugin/workspace-probe`);
  await page.getByRole('button', { name: 'Toggle P02 benchmark' }).click();
  await page.waitForFunction(() => !!window.__p02);
  for (let repeat = 0; repeat < runs; repeat++) {
    for (const profile of ['cloud-bundled-pages', 'container-bundled-events', 'hypervisor-bundled-vms', 'kubernetes-snapshot']) {
      await page.evaluate(() => window.__p02.clearOwnedCache());
      for (const size of [0, copies]) {
        await measure(`${profile}/${size ? 'stress-copies' : 'native-finite'}/${repeat}`, async () => {
          await page.evaluate(({ profile, size }) => window.__p02.select(profile, size), { profile, size });
          await page.waitForFunction(({ size, profile }) => {
            const expected = size || (profile === 'kubernetes-snapshot' ? 1 : 2);
            const rows = Number(document.querySelector('[data-p02-table]')?.getAttribute('data-p02-rows'));
            return rows === expected && window.__p02.snapshot().samples.some((sample) => sample.phase === 'finite-table-two-frames' && sample.profile === profile && sample.copies === size);
          }, { size, profile });
          await page.locator('[data-p02-table] tbody tr').first().waitFor();
          return page.evaluate(() => ({ runtime: window.__p02.snapshot(), actualVisibleBody: document.querySelector('[data-p02-table] tbody')?.textContent }));
        });
        if (repeat === 0) {
          const screenshot = `${out}.${profile}.${size || 'native'}.png`;
          await page.screenshot({ path: screenshot });
          report.screenshots.push({ profile, copies: size, path: screenshot, phase: 'outside-timed-action' });
        }
        if (size) {
          await measure(`${profile}/typing-local-table/${repeat}`, async () => {
            await page.getByRole('textbox', { name: 'P02 local filter' }).pressSequentially('p02-nonmatch', { delay: 20 });
            await page.waitForFunction(() => document.querySelector('[data-p02-table]')?.getAttribute('data-p02-filtered') === '0');
            await page.getByRole('textbox', { name: 'P02 local filter' }).fill('');
            await page.evaluate(twoFrames);
            return page.evaluate(() => ({ inputFeedback: window.__p02Input.splice(0), semantics: 'immediate local diagnostic table filter; not default Resources 500ms debounce or CEL execution' }));
          });
          await measure(`${profile}/scroll/${repeat}`, () => page.locator('[data-p02-scroll]').evaluate(async (element) => {
            const moves = [];
            for (const ratio of [0.25, 0.5, 0.75, 1, 0]) {
              element.scrollTop = ratio * (element.scrollHeight - element.clientHeight);
              const { promise, resolve } = Promise.withResolvers();
              requestAnimationFrame(() => requestAnimationFrame(resolve));
              await promise;
              moves.push(element.scrollTop);
            }
            if (Math.max(...moves) === 0) throw new Error('Stress table did not scroll');
            return { moves, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
          }));
          await measure(`${profile}/diagnostic-detail-expand/${repeat}`, async () => { await page.getByRole('button', { name: 'Expand copy 0', exact: true }).click(); await page.locator('[data-p02-table] pre').waitFor(); await page.getByRole('button', { name: 'Expand copy 0', exact: true }).click(); });
          await measure(`${profile}/diagnostic-group/${repeat}`, async () => {
            await page.getByRole('button', { name: 'Toggle diagnostic groups' }).click();
            await page.waitForFunction(() => document.querySelector('[data-p02-table]')?.getAttribute('data-p02-grouped') === 'true');
            await page.evaluate(twoFrames);
            await page.getByRole('button', { name: 'Toggle diagnostic groups' }).click();
            await page.waitForFunction(() => document.querySelector('[data-p02-table]')?.getAttribute('data-p02-grouped') === 'false');
          });
        }
        const provider = await page.evaluate(() => window.__p02.metrics());
        report.samples.push({ name: `${profile}/provider-after/${size}/${repeat}`, provider });
        await page.evaluate(() => window.__p02.unmount());
        await cdp.send('HeapProfiler.collectGarbage');
        report.samples.push({ name: `${profile}/unmounted-retention/${size}/${repeat}`, postGC: await metrics(), hostPostGC: await hostMetrics(true), runtime: await page.evaluate(() => window.__p02.snapshot()) });
      }
      // Repeated actual table mounts deliberately retain React Query's inactive cache before explicit cleanup.
      for (let mount = 0; mount < 3; mount++) {
        await measure(`${profile}/remount/${repeat}/${mount}`, async () => { await page.evaluate(({ profile, copies }) => window.__p02.select(profile, copies), { profile, copies }); await page.locator('[data-p02-table] tbody tr').first().waitFor(); await page.evaluate(() => window.__p02.unmount()); });
      }
    }
    await page.getByRole('button', { name: 'Mount container event diagnostic' }).click();
    await page.waitForFunction(() => document.querySelector('[data-p02-event-state]')?.getAttribute('data-p02-event-state') === 'running');
    await page.waitForFunction(async () => (await window.__p02.metrics()).activeSourceWatches === 1);
    await page.waitForFunction(() => document.querySelector('[data-p02-source-synced]')?.getAttribute('data-p02-source-synced') === 'true');
    await measure(`container-bundled-events/sparse-update/${repeat}`, async () => {
      await page.evaluate(() => window.__p02.release());
      await page.waitForFunction(() => document.querySelector('[data-p02-event-state]')?.getAttribute('data-p02-event-state') === 'paused');
      await page.getByText('paused', { exact: true }).first().waitFor();
      return page.evaluate(() => window.__p02.snapshot());
    });
    report.cleanup.push({ repeat, providerBeforeStop: await page.evaluate(() => window.__p02.metrics()), stopped: await page.evaluate(() => window.__p02.stop()) });
    await cdp.send('HeapProfiler.collectGarbage');
    report.cleanup.push({ repeat, afterExplicitCacheRemoval: await page.evaluate(() => window.__p02.snapshot()), postGC: await metrics(), hostPostGC: await hostMetrics(true) });
    inspect();
  }
  report.instanceAfter = inspect();
  report.bridgeTotals = {
    httpEncodedResponseTransferBytes: report.network.filter((entry) => entry.kind === 'wails-http').reduce((sum, entry) => sum + entry.encodedResponseTransferBytes, 0),
    serializedRequestPayloadBytes: report.network.filter((entry) => entry.kind === 'wails-http').reduce((sum, entry) => sum + entry.serializedRequestPayloadBytes, 0),
    wailsSocketPayloadBytes: report.network.filter((entry) => entry.kind === 'websocket-payload' && entry.isWails).reduce((sum, entry) => sum + entry.bytes, 0),
    subscribeCallsObserved: report.network.filter((entry) => entry.kind === 'wails-http' && entry.methodID === 2856546527).length,
    unsubscribeCallsObserved: report.network.filter((entry) => entry.kind === 'wails-http' && entry.methodID === 3710015102).length,
  };
  if (report.errors.length) throw new Error(`Browser errors: ${report.errors.join('; ')}`);
} catch (error) {
  report.failure = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  try { if (page) report.cleanup.push({ final: await page.evaluate(() => window.__p02?.stop()) }); } catch (error) { report.cleanup.push({ finalError: String(error) }); process.exitCode = 1; }
  if (context) await context.close();
  await browser.close();
  report.cleanup.push({ chromiumClosed: true });
  try { report.hostAfter = await hostMetrics(true); } catch (error) { report.cleanup.push({ hostMetricsError: String(error) }); process.exitCode = 1; }
  // Canonical workspace down is coordinator-owned: this runner never stops a borrowed instance.
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(out);
}
