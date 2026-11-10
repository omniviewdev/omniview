#!/usr/bin/env node
/**
 * Markdown report of a bench/app results file.
 *
 * - Legacy scenarios (cold-start, pods, logs): one table per scenario, one row per step, medians
 *   across runs (the first column also shows min–max).
 * - Scroll cells (pods-paced, pods-reversal, pods-jump): per cell, one table per signal family,
 *   one row per trial and a median row, with the declared workload, the observed table and every
 *   unavailable signal stated as unavailable (—), never as zero.
 * - `--compare baseline.json candidate.json`: provenance side by side and per-cell medians with
 *   deltas, refusing to pair results whose build variant, minifier, workload or harness differ.
 *
 *   node bench/app/report.mjs [results.json]
 *   node bench/app/report.mjs --compare baseline.json candidate.json
 */
import fs from 'node:fs';
import path from 'node:path';

import { median } from './stats.mjs';

const COLUMNS = {
  readyMs: 'interactive',
  pluginReadyMs: 'plugin home shown',
  wallMs: 'wall',
  steps: 'actual steps',
  forwardSteps: 'forward viewport steps',
  perStepMs: 'wall / step',
  busyPerStepMs: 'busy / step',
  taskMs: 'main thread busy',
  scriptMs: 'script',
  layoutStyleMs: 'layout + style',
  blockingMs: 'TBT',
  longTasks: 'long tasks',
  renderMs: 'React render',
  commits: 'commits',
  maxCommitMs: 'slowest commit',
  heapMB: 'heap MB',
};

const fmt = (v) => (v == null ? '' : Math.abs(v) >= 100 || Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1));

/** A run is either flat metrics (cold start) or { step: metrics }. */
function steps(run) {
  const nested = Object.entries(run).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
  return nested.length ? nested : [['', run]];
}

/** What this report may say about how a known workload delivers its Pod records. Any other id gets no such claim. */
const POD_DELIVERY = { 'whole-app/v1': 'a complete source-view collection of ' };

/**
 * Describe the workload from what the runner recorded. A result without a workload id is an unknown legacy
 * workload: it is never described as the current 5,000-record collection, whose size and delivery it may not share.
 */
function workloadLine(workload) {
  if (!workload?.id) {
    return 'Workload: unknown legacy workload (the runner recorded no workload id). Its Pod record count and delivery mode are not known, so it is not described as a recorded workload and must not be compared with one.';
  }
  const pods = workload.pods;
  const delivery = Object.hasOwn(POD_DELIVERY, workload.id) ? POD_DELIVERY[workload.id] : 'a corpus of ';
  const scroll = pods
    ? ` Pod scroll takes up to ${pods.scrollPages} viewport steps through ${delivery}${Number(pods.records).toLocaleString('en-US')} records, then resets. Actual steps include the reset; per-step timings use that count.`
    : '';
  return `Workload ${workload.id}:${scroll} Compare only matching workload ids and CPU throttles.`;
}

function frontendLine(frontend) {
  if (!frontend) return 'Frontend build configuration was not recorded for this result.';
  const reused = frontend.rebuilt === false ? ' It was reused from an earlier build, not rebuilt by this run.' : '';
  const overhead = frontend.reactDom === 'react-dom/profiling'
    ? ' React render, commit and slowest-commit columns include profiling overhead that a normal production build does not have.'
    : '';
  const minify = frontend.minify
    ? ` Minifier: ${frontend.minify.effective === false ? 'off' : JSON.stringify(frontend.minify.effective)} (${frontend.minify.setting === 'app' ? "the app's own configuration" : `forced ${frontend.minify.setting}`}).`
    : '';
  const manifest = frontend.manifest && frontend.manifest.state !== 'verified'
    ? ` Build manifest ${frontend.manifest.state}${frontend.manifest.reason ? `: ${frontend.manifest.reason}` : ''}.`
    : '';
  return `Frontend: ${frontend.reactDom} (${frontend.config}).${reused}${overhead}${minify}${manifest}`;
}

/** `abc1234`, `abc1234 (dirty)` or `unknown`. A commit the runner did not identify is never shown as one. */
function sourceLabel(commit, dirty) {
  if (!commit || commit === 'unknown') return 'unknown';
  return `${commit}${dirty === true ? ' (dirty)' : dirty === null ? ' (dirty state unknown)' : ''}`;
}

// ---------------------------------------------------------------- scroll cells

const DASH = '—';
const num = (v, digits = 1) => (typeof v === 'number' && Number.isFinite(v) ? (Number.isInteger(v) && digits <= 1 ? String(v) : v.toFixed(digits)) : DASH);
const pct = (v, digits = 1) => (typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : DASH);
const perSecond = (value, windowMs) => (typeof value === 'number' && windowMs > 0 ? (value * 1000) / windowMs : null);

/** Column groups of the per-cell tables: header, value of a trial's `scroll` object, digits. */
const FAMILIES = [
  ['Frame intervals and viewport coverage (input window)', [
    ['frames', 'frames', (s) => s.frames, 0],
    ['p50 ms', 'p50', (s) => s.frameP50Ms, 1],
    ['p95 ms', 'p95', (s) => s.frameP95Ms, 1],
    ['p99 ms', 'p99', (s) => s.frameP99Ms, 1],
    ['max ms', 'max', (s) => s.frameMaxMs, 1],
    ['>20 ms', 'o20', (s) => s.framesOver20Ms, 0],
    ['>33.4 ms', 'o33', (s) => s.framesOver33Ms, 0],
    ['>100 ms', 'o100', (s) => s.framesOver100Ms, 0],
    ['dropped (est.)', 'drop', (s) => s.droppedFramesEstimate, 0],
    ['coverage min', 'cmin', (s) => s.coverageMin, 3],
    ['coverage p05', 'cp05', (s) => s.coverageP05, 3],
    ['hole samples', 'holes', (s) => s.coverageHoles, 0],
    ['longest hole ms', 'hole', (s) => s.coverageLongestHoleMs, 0],
    ['min margin above/below px', 'margin', (s) => (typeof s.minAbovePx === 'number' && typeof s.minBelowPx === 'number' ? `${s.minAbovePx.toFixed(0)} / ${s.minBelowPx.toFixed(0)}` : null), 0],
    ['rows mounted min/med/max', 'rows', (s) => (typeof s.mountedRowsMin === 'number' ? `${s.mountedRowsMin} / ${s.mountedRowsMedian} / ${s.mountedRowsMax}` : null), 0],
  ]],
  ['Input delivery', [
    ['events sent', 'ev', (s) => s.inputEvents, 0],
    ['driver Hz', 'hz', (s) => s.driverHz, 1],
    ['late p95 ms', 'late', (s) => s.driverLateP95Ms, 2],
    ['ack p95 ms', 'ack', (s) => s.ackP95Ms, 2],
    ['page saw events', 'seen', (s) => s.pageWheelEvents, 0],
    ['page wheel delay p95 ms', 'delay', (s) => s.wheelDelayP95Ms, 1],
    ['requested px', 'req', (s) => s.requestedPx, 0],
    ['page saw px', 'pxseen', (s) => s.pageWheelPx, 0],
    ['delivered at input end px', 'del', (s) => s.deliveredPxAtInputEnd, 0],
    ['residual at input end px', 'res', (s) => s.residualPxAtInputEnd, 0],
    ['delivered settled px', 'dels', (s) => s.deliveredPxSettled, 0],
    ['path px', 'path', (s) => s.deliveredPathPx, 0],
    ['settle ms', 'settle', (s) => s.settleMs, 0],
    ['lag p50/p95/max px', 'lag', (s) => (typeof s.lagP95Px === 'number' ? `${s.lagP50Px} / ${s.lagP95Px} / ${s.lagMaxPx}` : null), 0],
    ['lag p95/max ms', 'lagms', (s) => (typeof s.lagP95Ms === 'number' ? `${s.lagP95Ms} / ${s.lagMaxMs}` : null), 0],
  ]],
  ['Main thread (capture window, CDP where available)', [
    ['window ms', 'win', (s) => s.windowMs, 0],
    ['task ms', 'task', (s) => s.taskMs, 0],
    ['script ms', 'script', (s) => s.scriptMs, 0],
    ['style ms', 'style', (s) => s.styleMs, 0],
    ['layout ms', 'layout', (s) => s.layoutMs, 0],
    ['style recalcs', 'recalcs', (s) => s.styleRecalcCount, 0],
    ['layouts', 'layouts', (s) => s.layoutCount, 0],
    ['long tasks', 'lt', (s) => s.longTasks, 0],
    ['longest ms', 'ltmax', (s) => s.longTaskMaxMs, 0],
    ['TBT ms', 'tbt', (s) => s.blockingMs, 0],
    ['LoAF', 'loaf', (s) => s.loafCount, 0],
    ['LoAF max ms', 'loafmax', (s) => s.loafMaxMs, 0],
    ['heap MB', 'heap', (s) => s.heapMB, 1],
  ]],
  ['React (profiling build only) and DOM', [
    ['commits', 'commits', (s) => s.commits, 0],
    ['mount commits', 'mc', (s) => s.mountCommits, 0],
    ['update commits', 'uc', (s) => s.updateCommits, 0],
    ['render ms', 'render', (s) => s.renderMs, 0],
    ['mount ms', 'mount', (s) => s.mountMs, 0],
    ['update ms', 'update', (s) => s.updateMs, 0],
    ['base ms', 'base', (s) => s.baseMs, 0],
    ['slowest ms', 'slow', (s) => s.maxCommitMs, 1],
    ['rows mounted/unmounted', 'rowmut', (s) => (typeof s.mutationRowsAdded === 'number' ? `${s.mutationRowsAdded} / ${s.mutationRowsRemoved}` : null), 0],
    ['DOM elements start/end/max', 'dom', (s) => (typeof s.domElementsEnd === 'number' ? `${s.domElementsStart} / ${s.domElementsEnd} / ${s.domElementsMax}` : null), 0],
    ['CDP node objects (+, incl. detached)', 'cdpn', (s) => s.cdpNodesDelta, 0],
  ]],
  ['Bridge, metric demand and updates', [
    ['backend calls', 'calls', (s) => s.backendCalls, 0],
    ['metric opens', 'mo', (s) => s.metricOpens, 0],
    ['attaches', 'ma', (s) => s.metricAttaches, 0],
    ['refreshes', 'mr', (s) => s.metricRefreshes, 0],
    ['targets requested', 'mt', (s) => s.metricTargetsRequested, 0],
    ['metric data frames', 'md', (s) => s.metricDataFrames, 0],
    ['update events', 'ue', (s) => s.updateEvents, 0],
    ['upserts', 'uu', (s) => s.updateUpserts, 0],
    ['removes', 'ur', (s) => s.updateRemoves, 0],
    ['recreated', 'urc', (s) => s.updateRecreates, 0],
  ]],
];

const columnValue = (column, scroll) => column[2](scroll);

function familyTable(trials) {
  const out = [];
  for (const [title, columns] of FAMILIES) {
    // A family with no available value in any trial is stated once. Inside an available family a signal the
    // engine did not supply stays a visible dash: unavailable is not zero and not silently absent.
    const available = columns.some((column) => trials.some((trial) => columnValue(column, trial.scroll ?? {}) != null));
    if (!available) { out.push(`_${title}: unavailable for this cell._`, ''); continue; }
    const present = columns;
    out.push(`${title}`, '', `| trial | ${present.map((c) => c[0]).join(' | ')} |`, `|---|${present.map(() => '--:').join('|')}|`);
    for (const trial of trials) {
      out.push(`| ${trial.index === 0 ? `control (${trial.capture ?? 'off'})` : trial.index} | ${present.map((c) => {
        const value = columnValue(c, trial.scroll ?? {});
        return typeof value === 'string' ? value : num(value, c[3]);
      }).join(' | ')} |`);
    }
    const measured = trials.filter((trial) => trial.index !== 0);
    if (measured.length > 1) {
      out.push(`| **median** | ${present.map((c) => {
        const values = measured.map((trial) => columnValue(c, trial.scroll ?? {}));
        if (values.some((value) => typeof value === 'string')) return DASH;
        const m = median(values.filter((value) => typeof value === 'number'));
        return m === null ? DASH : num(m, c[3]);
      }).join(' | ')} |`);
    }
    out.push('');
  }
  return out;
}

/** The sprint's nominal-scroll targets, stated as information about a paced cell, never as a gate. */
function targetLines(cell, trials) {
  if (cell.workload?.kind !== 'paced') return [];
  const measured = trials.filter((trial) => trial.index !== 0);
  const med = (pick) => median(measured.map((trial) => pick(trial.scroll ?? {})).filter((value) => typeof value === 'number'));
  const worst = (pick) => {
    const values = measured.map((trial) => pick(trial.scroll ?? {})).filter((value) => typeof value === 'number');
    return values.length ? Math.max(...values) : null;
  };
  const check = (value, limit) => (value === null ? `${DASH} (unavailable)` : `${value <= limit ? 'within' : 'over'} ${limit}`);
  const p95 = med((s) => s.frameP95Ms);
  const p99 = med((s) => s.frameP99Ms);
  const stall = worst((s) => Math.max(s.longTaskMaxMs ?? 0, s.frameMaxMs ?? 0));
  const stallAvailable = measured.some((trial) => typeof trial.scroll?.frameMaxMs === 'number' || typeof trial.scroll?.longTaskMaxMs === 'number');
  return [
    `Sprint nominal-scroll targets (#459), informational only and valid for a normal build at the reference protocol: frame interval p95 ${num(p95, 1)} ms (${check(p95, 20)} ms), p99 ${num(p99, 1)} ms (${check(p99, 33.4)} ms), worst main-thread stall or frame gap ${stallAvailable ? `${num(stall, 0)} ms (${check(stall, 100)} ms)` : DASH}. A requestAnimationFrame interval is not compositor output.`,
    '',
  ];
}

function scrollCellSection(key, cell, trials) {
  const def = cell.definition ?? {};
  const workload = def.workload ?? {};
  const p = workload.params ?? {};
  const out = [`#### ${key}`, ''];
  if (cell.failure) {
    out.push(`**Failed:** ${String(cell.failure).split('\n')[0]}`, '');
  }
  const declared = workload.kind === 'jump'
    ? `up to ${p.pages} viewport-sized jumps then a reset, in-page settling driver`
    : `${p.speedPxPerSecond} px/s as ${p.inputHz} wheel events/s from Node over CDP for ${p.trialSeconds} s${workload.kind === 'reversal' ? `, direction reversed every ${p.segmentSeconds} s` : ''}`;
  out.push(`Workload ${workload.id} (${workload.driver}): ${declared}; ${p.trials} trial(s) after a ${p.warmupSeconds} s warmup; ${p.pods} Pods, metrics ${def.metrics}, updates ${def.updates === 'none' || p.updates === 'none' ? 'none' : `sparse (${p.updates?.eventsPerSecond}/s × ${p.updates?.recordsPerEvent} Pods, recreate every ${p.updates?.recreateEvery}th, metric refresh ${p.updates?.metricRefreshMs} ms, ${(p.updates?.metricChangedFraction * 100).toFixed(0)}% of samples advance)`}; CPU throttle ${def.cpuThrottle}×.`);
  const t = cell.table;
  if (t) {
    out.push(`Observed table: ${t.columns.count} columns (${t.columns.headers.filter(Boolean).join(', ')}); ${t.rows.served} Pods served, ${t.rows.impliedByGeometry} implied by table height; ${t.rows.mounted} rows mounted at rest, ${t.rows.rowHeightPx} px each; ${t.domElements} attached DOM elements; scroll range ${num(t.scroller.maxScroll, 0)} px; viewport ${t.viewport.width}×${t.viewport.height}.`);
  }
  if (cell.display) {
    out.push(`Display: requestAnimationFrame idle cadence ${num(cell.display.medianMs, 2)} ms (≈ ${num(cell.display.estimatedHz, 1)} Hz), timer resolution ${num(cell.capabilities?.timerResolutionMs, 3)} ms.`);
  }
  if (cell.wheelCalibration) {
    const c = cell.wheelCalibration;
    out.push(`Wheel calibration: ${c.requestedPx} px requested, the page saw ${c.pageSawDeltaYSum} px in ${c.pageSawEvents} events, the table moved ${c.observedScrollPx} px (ratio ${c.ratio}); delta scale applied ${c.scale}.`);
  }
  if (cell.plan) {
    out.push(`Input plan: start offset ${cell.plan.startPx} px, ${cell.plan.events} events, ${cell.plan.requestedPx} px requested per trial.`);
  }
  if (cell.captureOverhead) {
    const overhead = cell.captureOverhead;
    out.push(`Measured capture overhead, ${overhead.note}`);
    for (const [mode, control] of Object.entries(overhead.controls ?? {})) {
      const d = control.difference;
      out.push(`- ${overhead.captureMode} − ${mode}: task ${num(d.taskMs, 1)} ms/s, script ${num(d.scriptMs, 1)} ms/s, style ${num(d.styleMs, 1)} ms/s, layout ${num(d.layoutMs, 1)} ms/s, style recalcs ${num(d.styleRecalcCount, 1)}/s, layouts ${num(d.layoutCount, 1)}/s. Unavailable without the heavier capture: ${control.unavailable.join('; ')}.`);
    }
  }
  if (cell.protocolDeviations?.length) out.push(`**Not the reference protocol:** ${cell.protocolDeviations.join('; ')}.`);
  out.push('');
  out.push(...familyTable(trials));
  out.push(...targetLines(def, trials));
  const notes = [];
  for (const trial of trials) {
    for (const error of trial.errors ?? []) notes.push(`trial ${trial.index}: ${error}`);
    for (const note of trial.notes ?? []) notes.push(`trial ${trial.index}: ${note}`);
  }
  for (const [kind, list] of Object.entries(cell.loadErrors ?? {})) for (const error of list) notes.push(`load ${kind}: ${error}`);
  for (const text of cell.notices ?? []) notes.push(`visible notice at ready: "${text}"`);
  if (cell.unhandledBackendCalls?.length) notes.push(`backend calls without a fixture (answered null): ${cell.unhandledBackendCalls.join(', ')}`);
  for (const note of cell.notes ?? []) notes.push(note);
  if (cell.metricsAtReady && def.metrics === 'hidden' && cell.metricsAtReady.opens) notes.push(`hidden metric columns opened ${cell.metricsAtReady.opens} observation(s)`);
  if (notes.length) out.push(...notes.map((note) => `- ${note}`), '');
  else out.push('No page errors, console errors, failed requests or notices were recorded for this cell.', '');
  return out;
}

const SIGNAL_LIMITS = [
  'Signal limits: frame intervals are requestAnimationFrame callbacks in the page, coverage is mounted-row geometry against the main thread\'s scroll offset, and neither is compositor output or a pixel check; keep native pixel evidence separate. Input is Node→CDP wheel events at the declared cadence, independent of the renderer; "page saw" counts what reached the page after browser input coalescing. CDP "node objects" include detached nodes not yet collected; attached DOM elements are counted separately. The fixture is an in-page fake Wails transport (no IPC, no native backend, no host or plugin process), so this is renderer-only evidence. Long tasks, long animation frames, JS heap and CDP counters are reported only where the engine supplies them; an unsupported signal is a dash.',
  '',
];

export function summarize({ meta, results }) {
  const plugin = meta.plugin;
  const bundle = plugin?.bundle?.treeSHA256 ? `, bundle sha256 ${plugin.bundle.treeSHA256.slice(0, 12)}` : '';
  const scenarioKeys = new Set(Object.keys(meta.scenarios ?? {}));
  const legacyResults = Object.entries(results).filter(([name]) => !scenarioKeys.has(name));
  const hasLegacy = legacyResults.length > 0;
  const out = [
    '### Whole-app profile (bench/app)',
    '',
    `Commit ${sourceLabel(meta.commit, meta.dirty)}, kubernetes plugin ${sourceLabel(meta.k8sPlugin, plugin?.checkout?.dirty)}${bundle}, Chromium ${meta.chromium}, ${meta.host}.`,
  ];
  if (hasLegacy) {
    out.push(
      `Median of ${meta.runs} runs, CPU throttle ${meta.cpuThrottle ?? 1}×, ms unless noted; first column also min–max. Startup times are from navigation start.`,
      workloadLine(meta.workload),
    );
  }
  out.push(frontendLine(meta.frontend));
  const graphics = meta.engine?.graphics;
  out.push(graphics?.state === 'available'
    ? `Graphics: ${graphics.renderer}; compositing ${graphics.compositing}, rasterization ${graphics.rasterization}; ${meta.engine.headless ? 'headless' : 'headed'}.`
    : 'Graphics acceleration was not recorded or could not be verified.');
  if (graphics?.compositing !== 'enabled' || graphics?.rasterization !== 'enabled') {
    out.push('**Diagnostic frame timings only: hardware compositing and rasterization are not verified.**');
  }
  if (meta.label || meta.appRoot) out.push(`Label ${meta.label ?? DASH}; app root ${meta.appRoot ?? DASH}.`);
  if (meta.ui) out.push(...uiLines(meta.ui));
  if (meta.harness?.treeSHA256) out.push(`Harness bytes: tree sha256 ${meta.harness.treeSHA256.slice(0, 12)} (${meta.harness.files} files); harness checkout ${sourceLabel(meta.harness.git?.short, meta.harness.git?.dirty)}.`);
  out.push('');
  const notes = new Set();
  if (meta.hostSource?.state === 'unknown') notes.add(`host source is unknown: ${meta.hostSource.reason}`);
  if (meta.currentHostSource && meta.hostSource?.state === 'identified'
    && (meta.currentHostSource.head !== meta.hostSource.head || meta.currentHostSource.trackedDiffSHA256 !== meta.hostSource.trackedDiffSHA256)) {
    notes.add('the app root has changed since this frontend was built: the recorded host source describes the build, not the checkout now');
  }
  if (!plugin) notes.add('kubernetes plugin commit was not verified as a separate checkout by the runner that wrote this result; it may name the host repository');
  else if (plugin.checkout?.state === 'unknown') notes.add(`kubernetes plugin source is unknown: ${plugin.checkout.reason}`);
  for (const [name, runs] of legacyResults) {
    const byStep = new Map();
    for (const run of runs) {
      for (const [step, m] of steps(run)) {
        const metrics = { ...m, layoutStyleMs: (m.layoutMs ?? 0) + (m.styleMs ?? 0) };
        if (!byStep.has(step)) byStep.set(step, {});
        for (const k of Object.keys(COLUMNS)) if (typeof metrics[k] === 'number') (byStep.get(step)[k] ??= []).push(metrics[k]);
        if (m.following === false) notes.add(`${name}/${step}: the log view did not stay on the newest line while streaming`);
        for (const e of m.errors ?? []) notes.add(`${name}: page error "${e}"`);
        if (m.unhandled?.length) notes.add(`${name}: backend calls without a fixture: ${m.unhandled.join(', ')}`);
      }
      for (const e of run.errors ?? []) notes.add(`${name}: page error "${e}"`);
    }
    const cols = Object.keys(COLUMNS).filter((k) => [...byStep.values()].some((v) => v[k]));
    out.push(`**${name}**`, '', `| step | ${cols.map((k) => COLUMNS[k]).join(' | ')} |`, `|---|${cols.map(() => '--:').join('|')}|`);
    for (const [step, v] of byStep) {
      const cells = cols.map((k, i) => {
        if (!v[k]) return '';
        const m = fmt(median(v[k]));
        return i === 0 && v[k].length > 1 ? `${m} (${fmt(Math.min(...v[k]))}–${fmt(Math.max(...v[k]))})` : m;
      });
      out.push(`| ${step || name} | ${cells.join(' | ')} |`);
    }
    out.push('');
  }
  if (scenarioKeys.size) {
    out.push('### Scroll cells', '');
    if (meta.protocol?.deviations?.length) out.push(`**This run differs from the reference protocol:** ${meta.protocol.deviations.join('; ')}.`, '');
    for (const key of scenarioKeys) out.push(...scrollCellSection(key, meta.scenarios[key], results[key] ?? []));
    out.push(...SIGNAL_LIMITS);
  }
  if (notes.size) out.push(...[...notes].map((n) => `- ${n}`), '');
  return out.join('\n');
}

function uiLines(ui) {
  const packages = ui.packages ?? ui;
  const out = [];
  for (const [name, info] of Object.entries(packages)) {
    if (!info || typeof info !== 'object' || !info.state) continue;
    if (info.state !== 'resolved') { out.push(`- ${name}: ${info.state} (${info.reason ?? 'no reason recorded'}); declared ${info.declared ?? DASH}`); continue; }
    const git = info.git?.state === 'identified' ? `, ${sourceLabel(info.git.short, info.git.dirty)}` : '';
    const dist = info.dist?.treeSHA256 ? `, dist sha256 ${info.dist.treeSHA256.slice(0, 12)}` : '';
    out.push(`- ${name} ${info.version ?? DASH} (declared ${info.declared ?? DASH}; ${info.source}${git}${dist})`);
  }
  return out.length ? ['Shared UI as resolved by the app root:', ...out] : [];
}

// ---------------------------------------------------------------- compare

/** Metrics compared per cell: label, value of a trial, whether larger is better, normalize per second. */
const COMPARED = [
  ['frame interval p50 ms', (s) => s.frameP50Ms, false, false],
  ['frame interval p95 ms', (s) => s.frameP95Ms, false, false],
  ['frame interval p99 ms', (s) => s.frameP99Ms, false, false],
  ['frame interval max ms', (s) => s.frameMaxMs, false, false],
  ['frames > 33.4 ms', (s) => s.framesOver33Ms, false, false],
  ['frames > 100 ms', (s) => s.framesOver100Ms, false, false],
  ['dropped frames (est.)', (s) => s.droppedFramesEstimate, false, false],
  ['coverage min', (s) => s.coverageMin, true, false],
  ['coverage p05', (s) => s.coverageP05, true, false],
  ['hole samples', (s) => s.coverageHoles, false, false],
  ['min margin below px', (s) => s.minBelowPx, true, false],
  ['min margin above px', (s) => s.minAbovePx, true, false],
  ['scroll lag p95 px', (s) => s.lagP95Px, false, false],
  ['scroll lag max px', (s) => s.lagMaxPx, false, false],
  ['residual at input end px', (s) => (typeof s.residualPxAtInputEnd === 'number' ? Math.abs(s.residualPxAtInputEnd) : null), false, false],
  ['page wheel delay p95 ms', (s) => s.wheelDelayP95Ms, false, false],
  ['main-thread task ms/s', (s) => s.taskMs, false, true],
  ['script ms/s', (s) => s.scriptMs, false, true],
  ['style ms/s', (s) => s.styleMs, false, true],
  ['layout ms/s', (s) => s.layoutMs, false, true],
  ['style recalcs/s', (s) => s.styleRecalcCount, false, true],
  ['layouts/s', (s) => s.layoutCount, false, true],
  ['CDP node objects created/s (incl. detached)', (s) => s.cdpNodesDelta, false, true],
  ['long tasks', (s) => s.longTasks, false, false],
  ['TBT ms', (s) => s.blockingMs, false, false],
  ['React commits/s', (s) => s.commits, false, true],
  ['React render ms/s', (s) => s.renderMs, false, true],
  ['React mount ms/s', (s) => s.mountMs, false, true],
  ['React update ms/s', (s) => s.updateMs, false, true],
  ['rows mounted (median)', (s) => s.mountedRowsMedian, false, false],
  ['DOM elements max', (s) => s.domElementsMax, false, false],
  ['rows mounted+unmounted/s', (s) => (typeof s.mutationRowsAdded === 'number' ? s.mutationRowsAdded + s.mutationRowsRemoved : null), false, true],
  ['backend calls/s', (s) => s.backendCalls, false, true],
  ['metric observation opens', (s) => s.metricOpens, false, false],
  ['metric targets requested', (s) => s.metricTargetsRequested, false, false],
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function aggregate(trials, pick, normalize) {
  const values = trials.filter((trial) => trial.index !== 0).map((trial) => {
    const scroll = trial.scroll ?? {};
    const value = pick(scroll);
    return normalize ? perSecond(value, scroll.windowMs) : value;
  }).filter((value) => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return null;
  return { median: median(values), min: Math.min(...values), max: Math.max(...values), n: values.length };
}

function comparability(a, b) {
  const reasons = [];
  const af = a.meta.frontend ?? {};
  const bf = b.meta.frontend ?? {};
  if (af.reactBuild !== bf.reactBuild || af.reactDom !== bf.reactDom) reasons.push(`React build differs (${af.reactDom ?? 'unknown'} vs ${bf.reactDom ?? 'unknown'}): normal and profiling timings are never comparable`);
  if (!same(af.minify?.effective, bf.minify?.effective)) reasons.push(`minifier differs (${JSON.stringify(af.minify?.effective ?? 'unknown')} vs ${JSON.stringify(bf.minify?.effective ?? 'unknown')})`);
  if (af.minify?.setting && af.minify.setting !== 'app') reasons.push(`the baseline forced the minifier (${af.minify.setting}), so it is not the app's own production build`);
  if (bf.minify?.setting && bf.minify.setting !== 'app') reasons.push(`the candidate forced the minifier (${bf.minify.setting}), so it is not the app's own production build`);
  if (a.meta.harness?.treeSHA256 && b.meta.harness?.treeSHA256 && a.meta.harness.treeSHA256 !== b.meta.harness.treeSHA256) reasons.push('the harness bytes differ: the two runs did not use the same harness');
  if (a.meta.engine?.name !== b.meta.engine?.name || a.meta.engine?.version !== b.meta.engine?.version) reasons.push(`engine differs (${a.meta.engine?.name} ${a.meta.engine?.version} vs ${b.meta.engine?.name} ${b.meta.engine?.version})`);
  if (a.meta.engine?.headless !== b.meta.engine?.headless) reasons.push('browser presentation differs: headed and headless runs are not comparable');
  const ag = a.meta.engine?.graphics;
  const bg = b.meta.engine?.graphics;
  if (ag?.state !== 'available' || bg?.state !== 'available') {
    reasons.push('graphics capabilities are unverified: repeat both runs with recorded renderer capabilities');
  } else if (!same(ag, bg)) {
    reasons.push('graphics capabilities differ: compare the same renderer, compositing and rasterization modes');
  }
  if (a.meta.environment?.cpuModel !== b.meta.environment?.cpuModel || a.meta.environment?.osRelease !== b.meta.environment?.osRelease) reasons.push('the machine or OS differs: compare runs on the same machine only');
  return reasons;
}

/** Side-by-side provenance and per-cell medians with deltas. Refuses pairs that are not comparable. */
export function compare(baseline, candidate) {
  const out = ['### Baseline vs candidate (bench/app)', ''];
  const sides = [['baseline', baseline.meta], ['candidate', candidate.meta]];
  out.push('| | baseline | candidate |', '|---|---|---|');
  const row = (label, pick) => out.push(`| ${label} | ${pick(baseline.meta)} | ${pick(candidate.meta)} |`);
  row('label', (m) => m.label ?? DASH);
  row('app root', (m) => m.appRoot ?? DASH);
  row('host source', (m) => sourceLabel(m.hostSource?.short, m.hostSource?.dirty));
  row('host tracked diff sha256', (m) => (m.hostSource?.trackedDiffSHA256 ? m.hostSource.trackedDiffSHA256.slice(0, 12) : DASH));
  row('frontend', (m) => `${m.frontend?.reactDom ?? 'unknown'}, minify ${m.frontend?.minify ? JSON.stringify(m.frontend.minify.effective) : 'unknown'}`);
  row('frontend bundle', (m) => (m.frontend?.bundle?.treeSHA256 ? `${m.frontend.bundle.treeSHA256.slice(0, 12)} (${(m.frontend.bundle.bytes / 2 ** 20).toFixed(1)} MB)` : DASH));
  const uiNames = new Set([...Object.keys(baseline.meta.ui?.packages ?? baseline.meta.ui ?? {}), ...Object.keys(candidate.meta.ui?.packages ?? candidate.meta.ui ?? {})]);
  for (const name of uiNames) {
    row(name, (m) => {
      const info = (m.ui?.packages ?? m.ui ?? {})[name];
      if (!info?.state) return DASH;
      if (info.state !== 'resolved') return info.state;
      return `${info.version} ${info.source}${info.git?.state === 'identified' ? ` ${sourceLabel(info.git.short, info.git.dirty)}` : ''}${info.dist?.treeSHA256 ? ` dist ${info.dist.treeSHA256.slice(0, 12)}` : ''}`;
    });
  }
  row('kubernetes plugin bundle', (m) => (m.plugin?.bundle?.treeSHA256 ? m.plugin.bundle.treeSHA256.slice(0, 12) : DASH));
  row('harness bytes', (m) => (m.harness?.treeSHA256 ? m.harness.treeSHA256.slice(0, 12) : DASH));
  row('engine', (m) => `${m.engine?.name ?? DASH} ${m.engine?.version ?? ''}`);
  row('machine', (m) => `${m.environment?.cpuModel ?? DASH}, ${m.environment?.osRelease ?? ''}`);
  out.push('');
  const reasons = comparability(baseline, candidate);
  for (const [label, side] of sides) {
    if (side.protocol?.deviations?.length) out.push(`**${label} differs from the reference protocol:** ${side.protocol.deviations.join('; ')}.`, '');
  }
  if (reasons.length) {
    out.push('**Not comparable — no deltas are computed:**', '', ...reasons.map((r) => `- ${r}`), '');
    return out.join('\n');
  }
  const keys = Object.keys(baseline.meta.scenarios ?? {}).filter((key) => candidate.meta.scenarios?.[key]);
  const missing = [...Object.keys(baseline.meta.scenarios ?? {}), ...Object.keys(candidate.meta.scenarios ?? {})].filter((key) => !(baseline.meta.scenarios?.[key] && candidate.meta.scenarios?.[key]));
  if (missing.length) out.push(`Cells present in only one result are not compared: ${[...new Set(missing)].join(', ')}.`, '');
  for (const key of keys) {
    const a = baseline.meta.scenarios[key];
    const b = candidate.meta.scenarios[key];
    out.push(`#### ${key}`, '');
    const aw = a.definition?.workload;
    const bw = b.definition?.workload;
    if (!same(aw, bw)) { out.push('Workload ids or declared parameters differ; this cell is not compared.', ''); continue; }
    if (a.failure || b.failure) { out.push(`A cell failed (${a.failure ? 'baseline' : 'candidate'}); not compared.`, ''); continue; }
    const shape = (cell) => ({ columns: cell.table?.columns?.count, mounted: cell.table?.rows?.mounted, implied: cell.table?.rows?.impliedByGeometry });
    if (!same(shape(a), shape(b))) {
      out.push(`The observed table differs (baseline ${JSON.stringify(shape(a))}, candidate ${JSON.stringify(shape(b))}); the deltas below compare different tables.`, '');
    }
    out.push('| metric | baseline median (min–max) | candidate median (min–max) | change |', '|---|--:|--:|--:|');
    const baseTrials = baseline.results[key] ?? [];
    const candTrials = candidate.results[key] ?? [];
    for (const [label, pick, higherBetter, normalize] of COMPARED) {
      const x = aggregate(baseTrials, pick, normalize);
      const y = aggregate(candTrials, pick, normalize);
      if (!x && !y) continue;
      const show = (v) => (v ? `${num(v.median, 2)} (${num(v.min, 2)}–${num(v.max, 2)})` : DASH);
      let change = DASH;
      if (x && y) {
        const difference = y.median - x.median;
        const ratio = x.median !== 0 ? difference / Math.abs(x.median) : null;
        const verdict = Math.abs(ratio ?? (difference === 0 ? 0 : 1)) < 0.02 ? 'same' : (difference < 0) === !higherBetter ? 'better' : 'worse';
        change = `${difference >= 0 ? '+' : ''}${num(difference, 2)}${ratio === null ? '' : ` (${(ratio * 100).toFixed(1)}%)`} ${verdict}`;
      }
      out.push(`| ${label} | ${show(x)} | ${show(y)} | ${change} |`);
    }
    out.push('');
  }
  out.push('Medians are over the measured trials of each result; "better" and "worse" use a 2% band and say nothing about significance with so few trials. Per-second rows divide each trial\'s counter by its capture window.', '');
  out.push(...SIGNAL_LIMITS);
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const load = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
  if (args[0] === '--compare') {
    if (args.length !== 3) throw new Error('usage: report.mjs --compare baseline.json candidate.json');
    process.stdout.write(compare(load(args[1]), load(args[2])));
  } else {
    const file = args[0] ?? path.join(import.meta.dirname, 'results/latest.json');
    process.stdout.write(summarize(load(file)));
  }
}
