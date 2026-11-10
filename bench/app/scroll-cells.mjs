/**
 * One cell of the scroll matrix: a page session for (scenario, metric state, update workload,
 * CPU throttle), a warmup, and N trials, each measured as described in README.md.
 *
 * Input is never driven from the page: paced and reversal cells send wheel events from Node over
 * CDP (wheel-driver.mjs); the jump cell runs the existing in-page viewport-jump driver. The page
 * only observes (window.__ovBench.capture) and Node reads CDP's Performance metrics around the
 * capture window. Signals an engine cannot provide stay null.
 */
import { performance } from 'node:perf_hooks';

import { driveWheel, summarizeDrive, wheelSchedule } from './wheel-driver.mjs';
import { pathLength, requestedLagPx, round, sum, summarizeCoverage, summarizeFrames, summarizeLag } from './stats.mjs';
import { protocolDeviations } from './options.mjs';
import { captureProblems, schemaMismatch } from './capture-contract.mjs';
import { metricRefreshFor, wheelPlan, workloadParams } from './workloads.mjs';

export const VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const PODS_ROUTE = `#/_plugin/kubernetes/cluster/bench/resources/${encodeURIComponent('k8s:/pods')}`;
// The host's resource browser (ui/features/connections/ResourceBrowser.tsx): its generic ResourceTable over the same Pods.
const GENERIC_ROUTE = `#/resources/kubernetes/bench?type=${encodeURIComponent('k8s:/pods')}`;
const QUIESCE_MS = 1000;

const cleanUrl = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}`;
  } catch {
    return String(url).slice(0, 120);
  }
};
// The favicon request is the browser's, not the app's.
const benign = (url) => cleanUrl(url) === '/favicon.ico';

async function openSession(env, cell, config) {
  const context = await env.browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const log = { pageErrors: [], consoleErrors: [], requestFailures: [], httpErrors: [] };
  page.on('pageerror', (error) => log.pageErrors.push(String(error.message).slice(0, 300)));
  page.on('console', (message) => {
    if (message.type() === 'error') log.consoleErrors.push(`${message.text().slice(0, 240)} (${cleanUrl(message.location().url)})`);
  });
  page.on('requestfailed', (request) => {
    if (!benign(request.url())) log.requestFailures.push(`${cleanUrl(request.url())}: ${request.failure()?.errorText ?? 'failed'}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400 && !benign(response.url())) log.httpErrors.push(`${response.status()} ${cleanUrl(response.url())}`);
  });
  await page.addInitScript((value) => { window.__OV_BENCH__ = value; }, config);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cell.cpuThrottle });
  return { page, cdp, log, close: () => context.close() };
}

async function cdpMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((metric) => [metric.name, metric.value]));
}

/**
 * Differences of CDP's cumulative counters over a window. A counter the browser did not report
 * is null, never zero. `cdpNodes` counts renderer node objects, attached or detached and not
 * yet collected: churn, not retained DOM.
 */
export function cdpDelta(before, after) {
  const ms = (key) => (typeof before[key] === 'number' && typeof after[key] === 'number' ? round((after[key] - before[key]) * 1000, 2) : null);
  const count = (key) => (typeof before[key] === 'number' && typeof after[key] === 'number' ? after[key] - before[key] : null);
  const level = (key, scale = 1, digits = 2) => (typeof after[key] === 'number' ? round(after[key] / scale, digits) : null);
  return {
    taskMs: ms('TaskDuration'),
    scriptMs: ms('ScriptDuration'),
    layoutMs: ms('LayoutDuration'),
    styleMs: ms('RecalcStyleDuration'),
    threadMs: ms('ThreadTime'),
    layoutCount: count('LayoutCount'),
    styleRecalcCount: count('RecalcStyleCount'),
    cdpNodesDelta: count('Nodes'),
    cdpNodesEnd: level('Nodes'),
    layoutObjectsEnd: level('LayoutObjects'),
    jsListenersEnd: level('JSEventListeners'),
    heapMB: level('JSHeapUsedSize', 2 ** 20),
  };
}

const evaluate = (session, fn, arg) => session.page.evaluate(fn, arg);

/** Everything the app has asked for or been told since the last mark, by cause. */
const mark = (log) => ({ page: log.pageErrors.length, console: log.consoleErrors.length, request: log.requestFailures.length, http: log.httpErrors.length });
const sinceMark = (log, at) => ({
  pageErrors: log.pageErrors.slice(at.page),
  consoleErrors: log.consoleErrors.slice(at.console),
  requestFailures: log.requestFailures.slice(at.request),
  httpErrors: log.httpErrors.slice(at.http),
});

const delta = (after, before, key) => (after && before && typeof after[key] === 'number' && typeof before[key] === 'number' ? after[key] - before[key] : null);

/** Flatten the capture and driver results of one trial into the numeric columns the report reads. */
export function analyzeTrial({ capture, drive, driveSummary, schedule, plan, jump, cdp, windowMs, calls, fixtureBefore, fixtureAfter, settle, speed, originNodeEpochMs, keepRaw = false }) {
  const series = capture?.series ?? null;
  const originPageEpoch = capture?.timeOriginEpochMs ?? null;
  // The input window in the page's performance.now() timebase.
  let w0 = null;
  let w1 = null;
  if (jump) { w0 = jump.startedAtMs; w1 = jump.endedAtMs; }
  else if (drive && originPageEpoch !== null) {
    w0 = originNodeEpochMs + drive.t0 - originPageEpoch;
    w1 = originNodeEpochMs + drive.t0 + drive.lastSentMs - originPageEpoch;
  }
  const refreshMs = capture?.frames?.refreshMs ?? null;
  const frames = series && w0 !== null
    ? summarizeFrames(series.frames, { startMs: w0, endMs: w1, originMs: w0, refreshMs })
    : null;
  const coverage = series && w0 !== null ? summarizeCoverage(series.coverage, { startMs: w0, endMs: w1 }) : null;

  // Scroll lag behind the declared input, on aligned epoch clocks.
  let lag = null;
  let deliveredAtEnd = null;
  let pathPx = null;
  if (series && w0 !== null) {
    const t = series.coverage.t;
    const top = series.coverage.scrollTop;
    const inWindow = [];
    for (let i = 0; i < t.length; i++) if (t[i] >= w0 && t[i] <= w1) inWindow.push(i);
    if (inWindow.length) deliveredAtEnd = top[inWindow[inWindow.length - 1]];
    pathPx = t.length ? pathLength(top) : null;
    if (schedule && originPageEpoch !== null) {
      const planned = Array.from(schedule.plannedMs, (ms) => originNodeEpochMs + drive.t0 + ms);
      const samples = inWindow.map((i) => ({ epochMs: originPageEpoch + t[i], scrollTop: top[i] }));
      lag = summarizeLag(requestedLagPx({
        plannedEpochMs: planned, cumulativePx: Array.from(schedule.cumulativePx), startScrollTop: capture.scroller?.startScrollTop ?? plan.startPx, samples,
      }), speed);
    }
  }
  const startTop = capture?.scroller?.startScrollTop ?? null;
  const requestedPx = schedule ? schedule.requestedPx : jump ? jump.scrolledPx : null;
  const requestedPathPx = schedule ? Array.from(schedule.deltaY).reduce((total, value) => total + Math.abs(value), 0) : null;
  const wheel = capture?.input?.wheel ?? null;
  const react = capture?.react ?? null;
  const metricsBefore = fixtureBefore?.metrics ?? null;
  const metricsAfter = fixtureAfter?.metrics ?? null;
  const updatesBefore = fixtureBefore?.updates ?? null;
  const updatesAfter = fixtureAfter?.updates ?? null;
  const longTasks = capture?.longTasks ?? { supported: false };
  const loaf = capture?.longAnimationFrames ?? { supported: false };
  const settledTop = settle?.scrollTop ?? null;

  const flat = {
    windowMs: round(windowMs, 1),
    inputMs: schedule ? schedule.durationMs : jump ? round(jump.wallMs, 1) : null,
    inputEvents: schedule ? driveSummary.events : null,
    requestedPx,
    requestedPathPx,
    pageWheelEvents: wheel?.events ?? null,
    pageWheelPx: wheel ? wheel.sumDeltaY : null,
    deliveredPxAtInputEnd: deliveredAtEnd !== null && startTop !== null ? round(deliveredAtEnd - startTop, 1) : null,
    residualPxAtInputEnd: deliveredAtEnd !== null && startTop !== null && requestedPx !== null ? round(requestedPx - (deliveredAtEnd - startTop), 1) : null,
    deliveredPxSettled: settledTop !== null && startTop !== null ? round(settledTop - startTop, 1) : null,
    deliveredPathPx: pathPx === null ? null : round(pathPx, 1),
    settleMs: settle?.settleMs ?? null,
    driverHz: driveSummary?.actualHz ?? null,
    pageWheelHz: wheel?.ratePerSecond ?? null,
    driverLateP95Ms: driveSummary?.latenessMs.p95 ?? null,
    driverLateMaxMs: driveSummary?.latenessMs.max ?? null,
    ackP95Ms: driveSummary?.ackLatencyMs.p95 ?? null,
    wheelDelayP95Ms: wheel?.delayMs.p95 ?? null,
    wheelDelayMaxMs: wheel?.delayMs.max ?? null,
    frames: frames ? frames.frames : null,
    frameMeanMs: frames?.meanMs ?? null,
    frameP50Ms: frames?.p50Ms ?? null,
    frameP95Ms: frames?.p95Ms ?? null,
    frameP99Ms: frames?.p99Ms ?? null,
    frameMaxMs: frames?.maxMs ?? null,
    fpsMean: frames?.fpsMean ?? null,
    framesOver20Ms: frames?.over[20] ?? null,
    framesOver33Ms: frames?.over[33.4] ?? null,
    framesOver50Ms: frames?.over[50] ?? null,
    framesOver100Ms: frames?.over[100] ?? null,
    droppedFramesEstimate: frames?.droppedEstimate ?? null,
    coverageMin: coverage?.min ?? null,
    coverageP05: coverage?.p05 ?? null,
    coverageMean: coverage?.mean ?? null,
    coverageHoles: coverage?.holes ?? null,
    coverageHoleFraction: coverage?.holeFraction ?? null,
    coverageLongestHoleMs: coverage?.longestHoleMs ?? null,
    minAbovePx: coverage?.minAbovePx ?? null,
    minBelowPx: coverage?.minBelowPx ?? null,
    mountedRowsMin: coverage?.rows.min ?? null,
    mountedRowsMedian: coverage?.rows.p50 ?? null,
    mountedRowsMax: coverage?.rows.max ?? null,
    lagP50Px: lag?.p50Px ?? null,
    lagP95Px: lag?.p95Px ?? null,
    lagMaxPx: lag?.maxPx ?? null,
    lagP95Ms: lag?.p95Ms ?? null,
    lagMaxMs: lag?.maxMs ?? null,
    ...cdp,
    longTasks: longTasks.supported ? longTasks.count : null,
    longTaskMaxMs: longTasks.supported ? longTasks.maxMs : null,
    blockingMs: longTasks.supported ? longTasks.blockingMs : null,
    loafCount: loaf.supported ? loaf.count : null,
    loafMaxMs: loaf.supported ? loaf.maxMs : null,
    loafBlockingMs: loaf.supported ? loaf.blockingMs : null,
    commits: react ? react.commits : null,
    mountCommits: react ? react.mounts : null,
    updateCommits: react ? react.updates : null,
    renderMs: react ? round(react.actualMs, 1) : null,
    mountMs: react ? round(react.mountMs, 1) : null,
    updateMs: react ? round(react.updateMs, 1) : null,
    baseMs: react ? round(react.baseMs, 1) : null,
    maxCommitMs: react ? round(react.maxActualMs, 1) : null,
    slowCommits: react ? react.slowCommits : null,
    domElementsStart: capture?.dom?.elements.start ?? null,
    domElementsEnd: capture?.dom?.elements.end ?? null,
    domElementsMax: capture?.dom?.elements.max ?? null,
    mutationRowsAdded: capture?.mutations?.supported ? capture.mutations.rowsAdded : null,
    mutationRowsRemoved: capture?.mutations?.supported ? capture.mutations.rowsRemoved : null,
    mutationNodesAdded: capture?.mutations?.supported ? capture.mutations.nodesAdded : null,
    mutationNodesRemoved: capture?.mutations?.supported ? capture.mutations.nodesRemoved : null,
    mutationAttributes: capture?.mutations?.supported ? capture.mutations.attributes : null,
    backendCalls: calls ? sum(Object.values(calls)) : null,
    metricOpens: delta(metricsAfter, metricsBefore, 'opens'),
    metricAttaches: delta(metricsAfter, metricsBefore, 'attaches'),
    metricRefreshes: delta(metricsAfter, metricsBefore, 'refreshes'),
    metricCloses: delta(metricsAfter, metricsBefore, 'closes'),
    metricTargetsRequested: delta(metricsAfter, metricsBefore, 'targetsRequested'),
    metricDataFrames: delta(metricsAfter, metricsBefore, 'dataFrames'),
    updateEvents: delta(updatesAfter, updatesBefore, 'events'),
    updateUpserts: delta(updatesAfter, updatesBefore, 'upserts'),
    updateRemoves: delta(updatesAfter, updatesBefore, 'removes'),
    updateRecreates: delta(updatesAfter, updatesBefore, 'recreated'),
  };
  return {
    flat,
    detail: {
      window: { startMs: w0 === null ? null : round(w0, 1), endMs: w1 === null ? null : round(w1, 1) },
      frames,
      coverage,
      lag,
      driver: driveSummary ?? null,
      jump: jump ?? null,
      settle: settle ?? null,
      calls: calls ?? null,
      react: react ? { slow: react.slow } : null,
      longTasks: longTasks.supported ? longTasks.entries : null,
      longAnimationFrames: loaf.supported ? { count: loaf.count, maxMs: loaf.maxMs, blockingMs: loaf.blockingMs, scriptMs: loaf.scriptMs, renderMs: loaf.renderMs, styleAndLayoutMs: loaf.styleAndLayoutMs } : null,
      input: capture?.input ?? null,
      scroller: capture?.scroller ?? null,
      dom: capture?.dom ?? null,
      mutations: capture?.mutations ?? null,
      captureDropped: capture ? { frames: capture.frames?.dropped ?? null, coverage: capture.coverage?.dropped ?? null } : null,
      // The bounded raw series: always captured (the window analysis needs them), stored only with --raw.
      series: keepRaw && capture?.series ? capture.series : null,
    },
  };
}

/** A control trial has no page capture: only Node-side timing and CDP counters. */
/** The page always returns its raw series: the runner slices them by window. `--no-raw` only keeps them out of the JSON. */
const CAPTURE_OPTIONS = {
  full: (options) => ({ raw: true, mutations: options.mutations, coverageEveryFrames: options.coverageEvery }),
  frames: () => ({ raw: true, coverage: false, input: false, mutations: false, longAnimationFrames: false, domCountEveryMs: 0 }),
};

export async function runScrollCell(env, cell) {
  const { options } = env;
  const params = workloadParams(options, cell);
  const metricRefreshMs = metricRefreshFor(options, cell);
  const config = {
    plugins: ['kubernetes'],
    pods: options.pods,
    ...(cell.metrics === 'none' ? {} : { metrics: cell.metrics }),
    metricDelayMs: options.metricDelayMs,
    ...(metricRefreshMs === null ? {} : { metricRefreshMs }),
    metricChangedFraction: options.metricChangedFraction,
    instance: 'production',
  };
  const s = await openSession(env, cell, config);
  const session = { definition: { scenario: cell.scenario, surface: cell.surface ?? 'plugin', workload: { id: cell.workload.id, kind: cell.workload.kind, driver: cell.workload.driver, params }, metrics: cell.metrics, updates: cell.updates, cpuThrottle: cell.cpuThrottle } };
  const trials = [];
  const readyTimeout = 60_000 + 60_000 * cell.cpuThrottle;
  try {
    const loadStart = performance.now();
    await s.page.goto(env.baseURL + (cell.surface === 'generic' ? GENERIC_ROUTE : PODS_ROUTE));
    await evaluate(s, () => window.__ovBench.startup());
    await s.page.getByText(/^[a-z-]+-[0-9a-f]{10}-[0-9a-f]{5}$/).first().waitFor({ timeout: readyTimeout });
    const table = await evaluate(s, (arg) => window.__ovBench.scroll.prepare(arg), { expectedRows: options.pods, timeoutMs: readyTimeout });
    session.load = { toFirstRowAndReadyMs: round(performance.now() - loadStart, 0) };
    session.table = {
      columns: { count: table.header.count, headers: table.header.texts },
      rows: { served: options.pods, impliedByGeometry: table.body.impliedRows, mounted: table.body.mountedRows, rowHeightPx: table.body.rowHeightPx, cellsInFirstRow: table.body.cellsInFirstRow },
      scroller: table.scroller,
      domElements: table.dom.elements,
      viewport: table.viewport,
    };

    // Metric state: what the table did must match what the cell declares.
    if (cell.metrics !== 'none') await verifyMetricState(s, cell, session, readyTimeout);
    session.capabilities = await evaluate(s, () => window.__ovBench.capture.capabilities());
    // A page built by another harness revision must fail before anything is measured.
    const mismatch = schemaMismatch(session.capabilities.schema);
    if (mismatch) throw new Error(mismatch);
    session.display = await evaluate(s, () => window.__ovBench.capture.probeRefresh(600));
    session.notices = await evaluate(s, () => window.__ovBench.scroll.notices());
    // Everything that went wrong while the page loaded, before any trial.
    session.loadErrors = sinceMark(s.log, { page: 0, console: 0, request: 0, http: 0 });
    session.unhandledBackendCalls = await evaluate(s, () => window.__ovBench.unhandledCalls());
    await evaluate(s, () => window.__ovBench.takeCalls());

    const point = table.wheelPoint;
    const sendWheel = (deltaY) => s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY });
    // A resting pointer over the table, as a user's is while scrolling.
    await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });

    const kind = cell.workload.kind;
    let scale = 1;
    if (kind !== 'jump') {
      session.wheelCalibration = await calibrateWheel(s, point, sendWheel);
      scale = session.wheelCalibration.scale;
    }
    const geometry = { maxScroll: table.scroller.maxScroll, rowHeightPx: table.body.rowHeightPx };

    if (cell.updates === 'sparse') {
      await evaluate(s, (spec) => window.__ovBench.fixture.updates.start(spec), options.update);
    }

    // Warmup: the same workload, unmeasured.
    const warmStart = performance.now();
    if (kind === 'jump') {
      do { await evaluate(s, (arg) => window.__ovBench.scroll.pages(arg), { pages: options.jumpPages, kind: 'pods' }); }
      while ((performance.now() - warmStart) / 1000 < options.warmupSeconds);
    } else if (options.warmupSeconds > 0) {
      const warmPlan = wheelPlan({ ...options, trialSeconds: options.warmupSeconds }, cell, geometry);
      await evaluate(s, (px) => window.__ovBench.scroll.position(px), warmPlan.startPx);
      await driveWheel({ schedule: wheelSchedule({ hz: options.inputHz, segments: warmPlan.segments, scale }), send: sendWheel });
      await evaluate(s, () => window.__ovBench.scroll.waitSettled({ stableMs: 250, timeoutMs: 8000 }));
    }
    session.warmup = { seconds: options.warmupSeconds, measuredWallSeconds: round((performance.now() - warmStart) / 1000, 1) };

    const plan = kind === 'jump' ? null : wheelPlan(options, cell, geometry);
    const schedule = plan ? wheelSchedule({ hz: options.inputHz, segments: plan.segments, scale }) : null;
    if (plan) session.plan = { startPx: plan.startPx, marginPx: plan.marginPx, segments: plan.segments, wheelScale: scale, requestedPx: schedule.requestedPx, events: schedule.events };

    const captureMode = options.capture;
    for (let index = 1; index <= options.trials; index++) {
      process.stdout.write(` ${index}`);
      trials.push(await runTrial({ env, s, cell, plan, schedule, point, sendWheel, captureMode, index }));
    }

    if (options.overheadControl && captureMode !== 'off') {
      // One control trial per lighter level separates the cost of the whole capture from the cost of
      // its geometry reads (full against frames) and of the frame loop itself (frames against off).
      const controls = {};
      for (const mode of captureMode === 'full' ? ['frames', 'off'] : ['off']) {
        process.stdout.write(` control:${mode}`);
        controls[mode] = await runTrial({ env, s, cell, plan, schedule, point, sendWheel, captureMode: mode, index: 0 });
        trials.push(controls[mode]);
      }
      session.captureOverhead = overheadOf(captureMode, trials, controls);
    }
    if (cell.updates === 'sparse') session.updates = await evaluate(s, () => window.__ovBench.fixture.updates.stop());
    session.fixture = await evaluate(s, () => window.__ovBench.fixture.stats());
    session.errorsOverall = sinceMark(s.log, { page: 0, console: 0, request: 0, http: 0 });
    session.protocolDeviations = protocolDeviations(options, { reactBuild: env.reactBuild, refreshHz: session.display?.estimatedHz ?? null });
    return { session, trials };
  } catch (error) {
    session.failure = String(error?.stack ?? error);
    return { session, trials, failed: true };
  } finally {
    await s.close();
  }
}

async function verifyMetricState(s, cell, session, timeout) {
  const read = () => evaluate(s, () => window.__ovBench.fixture.stats().metrics);
  const headers = session.table.columns.headers;
  const showsMetrics = headers.some((text) => /^(cpu|memory)\b/i.test(text));
  if (cell.metrics === 'hidden') {
    await s.page.waitForTimeout(1500);
    const stats = await read();
    if (showsMetrics || stats.opens !== 0) {
      throw new Error(`metrics=hidden: expected no metric columns and no observation, saw headers [${headers.join(', ')}] and ${stats.opens} observation opens; the persisted column-visibility seed did not take effect`);
    }
  } else {
    const deadline = Date.now() + timeout;
    let stats = await read();
    while (!(stats.opens >= 1 && stats.dataFrames >= 1) && Date.now() < deadline) {
      await s.page.waitForTimeout(250);
      stats = await read();
    }
    if (!(stats.opens >= 1 && stats.dataFrames >= 1)) {
      throw new Error(`metrics=${cell.metrics}: no metric observation completed (opens ${stats.opens}, data frames ${stats.dataFrames}); the Pod table is not using the metric protocol`);
    }
    if (!showsMetrics) session.notes = [...(session.notes ?? []), `metric columns were not recognized by header text (${headers.join(', ')}), but an observation completed`];
  }
  session.metricsAtReady = await read();
}

/**
 * Send a short known wheel burst and compare it with what the page saw and the table did, so the
 * declared px/s is the px/s actually delivered. A scale other than 1 is applied to every later
 * delta and recorded; input that does not scroll at all is an error, not a measurement.
 */
async function calibrateWheel(s, point, sendWheel) {
  const startAt = 3000;
  await evaluate(s, (px) => window.__ovBench.scroll.position(px), startAt);
  await s.page.waitForTimeout(300);
  const before = await evaluate(s, () => window.__ovBench.scroll.read());
  const schedule = wheelSchedule({ hz: 60, segments: [{ durationMs: 10 * (1000 / 60), pxPerSec: 20 * 60 }] });
  await evaluate(s, () => window.__ovBench.capture.start({ frames: false, coverage: false, longTasks: false, longAnimationFrames: false, domCountEveryMs: 0 }));
  await driveWheel({ schedule, send: sendWheel });
  const settled = await evaluate(s, () => window.__ovBench.scroll.waitSettled({ stableMs: 300, timeoutMs: 4000 }));
  const capture = await evaluate(s, () => window.__ovBench.capture.stop());
  const observedPx = settled.scrollTop - before.scrollTop;
  const ratio = observedPx / schedule.requestedPx;
  if (!(observedPx > 0)) {
    throw new Error(`wheel input did not scroll the table (requested ${schedule.requestedPx} px at ${point.x},${point.y}; the page saw ${capture.input.wheel.events} wheel events)`);
  }
  const scale = Math.abs(ratio - 1) > 0.02 && ratio > 0.05 ? Math.min(20, Math.max(0.05, 1 / ratio)) : 1;
  await evaluate(s, (px) => window.__ovBench.scroll.position(px), 0);
  return {
    requestedPx: schedule.requestedPx,
    pageSawDeltaYSum: capture.input.wheel.sumDeltaY,
    pageSawEvents: capture.input.wheel.events,
    deltaModes: capture.input.wheel.deltaModes,
    observedScrollPx: observedPx,
    ratio: round(ratio, 4),
    scale: round(scale, 4),
  };
}

async function runTrial({ env, s, cell, plan, schedule, point, sendWheel, captureMode, index }) {
  const { options } = env;
  const kind = cell.workload.kind;
  const startPx = plan ? plan.startPx : 0;
  await evaluate(s, (px) => window.__ovBench.scroll.position(px), startPx);
  await s.page.waitForTimeout(QUIESCE_MS);
  await evaluate(s, () => window.__ovBench.scroll.waitSettled({ stableMs: 250, timeoutMs: 8000 }));
  const marker = mark(s.log);
  await evaluate(s, () => window.__ovBench.takeCalls());
  const fixtureBefore = await evaluate(s, () => window.__ovBench.fixture.stats());
  const captureOptions = captureMode === 'off' ? null : CAPTURE_OPTIONS[captureMode](options);

  const before = await cdpMetrics(s.cdp);
  const t0 = performance.now();
  if (captureOptions) await evaluate(s, (arg) => window.__ovBench.capture.start(arg), captureOptions);

  let drive = null;
  let driveSummary = null;
  let jump = null;
  let settle = null;
  if (kind === 'jump') {
    jump = await evaluate(s, (arg) => window.__ovBench.scroll.pages(arg), { pages: options.jumpPages, kind: 'pods' });
  } else {
    drive = await driveWheel({ schedule, send: sendWheel });
    driveSummary = summarizeDrive(schedule, drive);
    if (captureOptions) settle = await evaluate(s, () => window.__ovBench.scroll.waitSettled({ stableMs: 250, timeoutMs: 8000 }));
    else await s.page.waitForTimeout(1000);
  }
  const capture = captureOptions ? await evaluate(s, () => window.__ovBench.capture.stop()) : null;
  const after = await cdpMetrics(s.cdp);
  const windowMs = performance.now() - t0;
  const calls = await evaluate(s, () => window.__ovBench.takeCalls());
  const fixtureAfter = await evaluate(s, () => window.__ovBench.fixture.stats());
  const errors = sinceMark(s.log, marker);

  const analyzed = analyzeTrial({
    capture, drive, driveSummary, schedule, plan, jump, cdp: cdpDelta(before, after), windowMs, calls,
    fixtureBefore, fixtureAfter, settle, speed: options.speed, originNodeEpochMs: performance.timeOrigin, keepRaw: options.raw,
  });
  const contractProblems = captureProblems({ captureMode, capture, flat: analyzed.flat, kind });
  if (contractProblems.length) {
    throw new Error(`the page capture does not meet its ${captureMode} contract: ${contractProblems.join('; ')}`);
  }
  const errorList = [
    ...errors.pageErrors.map((message) => `page error: ${message}`),
    ...errors.consoleErrors.map((message) => `console error: ${message}`),
    ...errors.requestFailures.map((message) => `request failed: ${message}`),
    ...errors.httpErrors.map((message) => `http error: ${message}`),
  ];
  const notes = [];
  if (driveSummary && (driveSummary.failures || driveSummary.acknowledged < driveSummary.events)) {
    notes.push(`${driveSummary.events - driveSummary.acknowledged} of ${driveSummary.events} wheel events were not acknowledged${driveSummary.firstFailure ? `: ${driveSummary.firstFailure}` : ''}`);
  }
  // The browser coalesces wheel events, so fewer events than were sent is expected; lost distance is not.
  if (capture && analyzed.flat.pageWheelPx !== null && schedule && Math.abs(analyzed.flat.pageWheelPx - schedule.requestedPx) > Math.max(20, Math.abs(schedule.requestedPx) * 0.02)) {
    notes.push(`the page saw ${analyzed.flat.pageWheelPx} px of wheel input for ${schedule.requestedPx} px requested (${analyzed.flat.pageWheelEvents} of ${driveSummary.events} events): input was lost or rescaled`);
  }
  return {
    index,
    capture: captureMode,
    scroll: { ...analyzed.flat, detail: analyzed.detail },
    errors: errorList,
    notes,
  };
}

/** Control-trial CDP counters per second of window against the median of the captured trials. */
function overheadOf(captureMode, trials, controls) {
  const perSecond = (trial, key) => (typeof trial.scroll[key] === 'number' && trial.scroll.windowMs > 0 ? (trial.scroll[key] * 1000) / trial.scroll.windowMs : null);
  const keys = ['taskMs', 'scriptMs', 'layoutMs', 'styleMs', 'layoutCount', 'styleRecalcCount'];
  const measured = trials.filter((trial) => trial.index !== 0);
  const captured = {};
  for (const key of keys) {
    const values = measured.map((trial) => perSecond(trial, key)).filter((value) => value !== null).sort((a, b) => a - b);
    captured[key] = values.length ? round(values[values.length >> 1], 2) : null;
  }
  const against = {};
  for (const [mode, control] of Object.entries(controls)) {
    const level = {};
    const difference = {};
    for (const key of keys) {
      level[key] = round(perSecond(control, key), 2);
      difference[key] = captured[key] !== null && level[key] !== null ? round(captured[key] - level[key], 2) : null;
    }
    against[mode] = {
      control: level,
      difference,
      unavailable: mode === 'off'
        ? ['frame intervals, coverage and input accounting cannot be measured without the capture']
        : ['coverage, input accounting, long tasks and long animation frames are not captured at this level; frame intervals are'],
    };
  }
  return {
    captureMode,
    note: 'Per second of capture window: the median of the captured trials against one control trial per lighter level (a single sample each). A positive difference is what the heavier capture added.',
    capturedPerSecond: captured,
    controls: against,
  };
}
