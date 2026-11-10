/**
 * Page-side capture and scroll-control API for bench/app, installed on `window.__ovBench`.
 *
 * Everything here runs in the page and needs neither CDP nor Playwright, so the Playwright
 * runner, a native WebView driven by hand, and a human at a console all use the same code
 * and read the same numbers. What an engine cannot provide is reported as unavailable
 * (`supported: false`, `null`), never as zero.
 *
 * - `capture.start(options)` / `capture.stop()`: a bounded sampler. Frame timestamps come from
 *   one requestAnimationFrame loop; viewport coverage, scroll position and mounted-row count
 *   are read in that same callback; wheel and scroll events are counted by passive capture
 *   listeners; long tasks and long animation frames come from PerformanceObservers where the
 *   engine has them. Every series is a preallocated typed array of `maxSamples`; samples past
 *   the bound are counted as dropped, never grown.
 * - `scroll.*`: table location, readiness, positioning and the viewport-jump driver.
 *
 * Limits that every consumer must keep:
 * - A requestAnimationFrame callback and DOM geometry are not compositor output. They show
 *   whether the main thread produced frames and mounted rows, not what reached the screen.
 * - Coverage compares mounted rows with the scroll offset the main thread sees, which can lag
 *   the compositor's. `minAbovePx`/`minBelowPx` are the margin that absorbs that lead.
 * - Reading geometry in the sampler can force style and layout earlier than the frame would
 *   have run them. It never writes, so it cannot add layout work; its cost is measured by a
 *   control run without it (see the runner's `--overhead-control`).
 * - The input driver is never in the page: wheel input comes from outside (CDP or a native
 *   pointer). This module only observes it.
 */
import { round, summarizeFrames, summarizeCoverage, summarizeSeries } from '../stats.mjs';
import { scrollPages } from '../scroll-driver.mjs';
import { CAPTURE_SCHEMA } from '../capture-contract.mjs';

const SCHEMA = CAPTURE_SCHEMA;
const DEFAULT_MAX_SAMPLES = 16_384;
const HOLE_THRESHOLD = 0.999;
const MAX_ENTRIES = 512;

/** A decoded result object: JSON-shaped and documented in README.md. */
type Json = Record<string, unknown>;

interface TimedEntry { start: number; duration: number }
interface LoafRecord { start: number; duration: number; blocking: number | null; renderStart: number | null; styleAndLayoutStart: number | null; scriptMs: number }
/** The Long Animation Frames API entry; only Chromium has it. */
interface LoafEntry extends PerformanceEntry {
  blockingDuration?: number;
  renderStart?: number;
  styleAndLayoutStart?: number;
  scripts?: ReadonlyArray<{ duration: number }>;
}
type PerformanceWithMemory = Performance & { memory?: { usedJSHeapSize: number } };

interface RefreshProbe {
  samples: number;
  medianMs: number | null;
  meanMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  estimatedHz: number | null;
}

/** Table geometry and counts as `scroll.locate()` returns them. */
interface TableInfo {
  found: boolean;
  viewport: { width: number; height: number; devicePixelRatio: number };
  scroller?: { clientHeight: number; clientWidth: number; scrollHeight: number; scrollTop: number; maxScroll: number; rect: Json };
  /** Viewport coordinates a pointer should rest on for wheel input: the middle of the visible body. */
  wheelPoint?: { x: number; y: number };
  header?: { count: number; texts: string[]; bottom: number | null };
  body?: {
    mountedRows: number;
    firstIndex: number | null;
    lastIndex: number | null;
    rowHeightPx: number | null;
    totalHeightPx: number | null;
    impliedRows: number | null;
    cellsInFirstRow: number | null;
  };
  dom: { elements: number };
}

export interface CaptureOptions {
  label?: string;
  /** Capacity of every series. */
  maxSamples?: number;
  /** requestAnimationFrame timestamps. */
  frames?: boolean;
  /** Viewport coverage, scroll offset and mounted rows, once per `coverageEveryFrames` frames. */
  coverage?: boolean;
  coverageEveryFrames?: number;
  /** Wheel and scroll event accounting. */
  input?: boolean;
  longTasks?: boolean;
  longAnimationFrames?: boolean;
  /** Count DOM mutations (rows and nodes added and removed). Observer cost: attribution runs only. */
  mutations?: boolean;
  /** Element-count sampling period; 0 disables. */
  domCountEveryMs?: number;
  /** Include the raw series in the result. */
  raw?: boolean;
}

interface Run {
  options: Required<Omit<CaptureOptions, 'raw'>> & { raw: boolean };
  startedAt: number;
  scroller: HTMLElement | null;
  body: HTMLElement | null;
  viewTop: number;
  viewBottom: number;
  maxScroll: number;
  startScrollTop: number | null;
  rafId: number;
  tick: number;
  // frames
  frames: Float64Array;
  frameN: number;
  frameDropped: number;
  // coverage
  cT: Float64Array;
  cTop: Float64Array;
  cCum: Float64Array;
  cCov: Float32Array;
  cAbove: Float32Array;
  cBelow: Float32Array;
  cRows: Uint16Array;
  cEdge: Uint8Array;
  covN: number;
  covDropped: number;
  contiguityChecked: number;
  contiguityBroken: number;
  // wheel
  wheelN: number;
  wheelDy: number;
  wheelDx: number;
  wheelCum: number;
  wheelFirst: number;
  wheelLast: number;
  wheelModes: Record<string, number>;
  wT: Float64Array;
  wD: Float32Array;
  wDelay: Float32Array;
  wheelSampled: number;
  wheelDropped: number;
  delayUnavailable: number;
  // scroll events
  scrollN: number;
  scrollFirst: number;
  scrollLast: number;
  sT: Float64Array;
  scrollSampled: number;
  scrollDropped: number;
  // element counts
  domT: number[];
  domN: number[];
  lastDomAt: number;
  // observers
  longObserver: PerformanceObserver | null;
  longEntries: TimedEntry[];
  loafObserver: PerformanceObserver | null;
  loafEntries: LoafRecord[];
  mutationObserver: MutationObserver | null;
  mutationCounts: { rowsAdded: number; rowsRemoved: number; nodesAdded: number; nodesRemoved: number; attributes: number; records: number };
  onWheel: (event: WheelEvent) => void;
  onScroll: (event: Event) => void;
}

let current: Run | null = null;
let located: HTMLElement | null = null;
let refresh: RefreshProbe | null = null;

const countElements = () => document.getElementsByTagName('*').length;
function frames(n: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const step = (left: number) => requestAnimationFrame(() => (left <= 1 ? resolve() : step(left - 1)));
  step(n);
  return promise;
}

/** One animation frame plus a timer: lets the page paint and queued tasks run before the next poll. */
function pause(delayMs: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => setTimeout(resolve, delayMs));
  return promise;
}
const rect = (r: DOMRect) => ({ left: round(r.left, 2), top: round(r.top, 2), width: round(r.width, 2), height: round(r.height, 2) });

function supportedEntryTypes(): string[] {
  const observer: { supportedEntryTypes?: readonly string[] } | undefined = globalThis.PerformanceObserver;
  return Array.isArray(observer?.supportedEntryTypes) ? [...observer.supportedEntryTypes] : [];
}

/** Chromium's performance.memory, absent elsewhere. */
function jsHeapUsedBytes(): number | null {
  // Not in the DOM typings: view the same object through the type that has it.
  const chromium = performance as PerformanceWithMemory;
  return typeof chromium.memory?.usedJSHeapSize === 'number' ? chromium.memory.usedJSHeapSize : null;
}

const megabytes = (bytes: number | null) => (bytes === null ? null : round(bytes / 2 ** 20, 2));

/** Smallest positive step of performance.now(): 0.1 ms or finer in Chromium, 1 ms in Safari. */
function timerResolutionMs(): number | null {
  let best = Infinity;
  for (let i = 0; i < 12; i++) {
    const a = performance.now();
    let b = a;
    for (let spins = 0; b === a && spins < 2_000_000; spins++) b = performance.now();
    if (b > a) best = Math.min(best, b - a);
  }
  return Number.isFinite(best) ? round(best, 4) : null;
}

function capabilities(): Json {
  const entryTypes = supportedEntryTypes();
  return {
    schema: SCHEMA,
    userAgent: navigator.userAgent,
    react: import.meta.env.BENCH_REACT_BUILD || 'unknown',
    devicePixelRatio: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: screen.width, height: screen.height },
    visibilityState: document.visibilityState,
    timeOriginEpochMs: performance.timeOrigin,
    timerResolutionMs: timerResolutionMs(),
    features: {
      longTask: entryTypes.includes('longtask'),
      longAnimationFrame: entryTypes.includes('long-animation-frame'),
      jsHeap: jsHeapUsedBytes() !== null,
      mutationObserver: typeof MutationObserver !== 'undefined',
      reactProfiler: typeof window.__ovProfile?.take === 'function',
    },
  };
}

/** The scroller of the data table: the nearest scrollable ancestor of a table body with the most overflow. */
function findTableScroller(): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestOverflow = 0;
  for (const body of document.querySelectorAll('table > tbody')) {
    for (let node = body.parentElement; node; node = node.parentElement) {
      const overflowY = getComputedStyle(node).overflowY;
      if ((overflowY !== 'auto' && overflowY !== 'scroll') || node.scrollHeight <= node.clientHeight) continue;
      const overflow = node.scrollHeight - node.clientHeight;
      if (overflow > bestOverflow) { best = node as HTMLElement; bestOverflow = overflow; }
      break;
    }
  }
  return best;
}

function requireScroller(): HTMLElement {
  if (!located || !located.isConnected) located = findTableScroller();
  if (!located) throw new Error('no scrollable table found');
  return located;
}

/** Table geometry and counts. Forces layout: call it outside a measured window. */
function locate(): TableInfo {
  const viewport = { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio };
  const scroller = findTableScroller();
  if (!scroller) return { found: false, viewport, dom: { elements: countElements() } };
  located = scroller;
  const box = scroller.getBoundingClientRect();
  const head = scroller.querySelector('thead');
  const headBox = head?.getBoundingClientRect();
  const viewTop = Math.max(box.top, headBox?.bottom ?? box.top);
  const viewBottom = box.top + scroller.clientHeight;
  const headers = head ? Array.from(head.querySelectorAll('th')).map((th) => (th.textContent ?? '').trim()) : [];
  const body = scroller.querySelector('tbody');
  const rows = body ? (Array.from(body.children) as HTMLElement[]) : [];
  const first = rows[0];
  const last = rows[rows.length - 1];
  const rowHeight = first ? first.getBoundingClientRect().height : null;
  const bodyHeight = body ? body.getBoundingClientRect().height : null;
  const indexOf = (el?: HTMLElement) => {
    const value = el?.getAttribute('data-index');
    return value == null ? null : Number(value);
  };
  return {
    found: true,
    viewport,
    scroller: {
      clientHeight: scroller.clientHeight,
      clientWidth: scroller.clientWidth,
      scrollHeight: scroller.scrollHeight,
      scrollTop: scroller.scrollTop,
      maxScroll: scroller.scrollHeight - scroller.clientHeight,
      rect: rect(box),
    },
    /** Viewport coordinates a pointer should rest on for wheel input: the middle of the visible body. */
    wheelPoint: { x: round(box.left + box.width / 2, 1), y: round(viewTop + (viewBottom - viewTop) / 2, 1) },
    header: { count: headers.length, texts: headers, bottom: headBox ? round(headBox.bottom, 2) : null },
    body: {
      mountedRows: rows.length,
      firstIndex: indexOf(first),
      lastIndex: indexOf(last),
      rowHeightPx: rowHeight === null ? null : round(rowHeight, 3),
      totalHeightPx: bodyHeight === null ? null : round(bodyHeight, 1),
      impliedRows: rowHeight && bodyHeight !== null ? Math.round(bodyHeight / rowHeight) : null,
      cellsInFirstRow: first ? first.children.length : null,
    },
    dom: { elements: countElements() },
  };
}

/** Resolve once the table is mounted and its height has implied `expectedRows` and held still. */
async function prepare(options: { expectedRows?: number; timeoutMs?: number; stableMs?: number } = {}): Promise<TableInfo> {
  const { expectedRows, timeoutMs = 120_000, stableMs = 750 } = options;
  const deadline = performance.now() + timeoutMs;
  let lastHeight: number | null = -1;
  let stableSince = performance.now();
  for (;;) {
    const info = locate();
    const now = performance.now();
    const body = info.body;
    if (info.found && body && body.mountedRows > 0) {
      if (body.totalHeightPx !== lastHeight) { lastHeight = body.totalHeightPx; stableSince = now; }
      const implied = body.impliedRows;
      const sized = expectedRows == null || (implied != null && Math.abs(implied - expectedRows) <= 1);
      if (sized && now - stableSince >= stableMs) return info;
    }
    if (now > deadline) {
      throw new Error(`table not ready after ${timeoutMs} ms: found=${info.found}, mounted rows=${body?.mountedRows ?? 0}, implied rows=${body?.impliedRows ?? 'n/a'}, expected ${expectedRows ?? 'any'}`);
    }
    await pause(50);
  }
}

/** Idle requestAnimationFrame cadence: the refresh rate the page can see. */
function probeRefresh(durationMs = 600): Promise<RefreshProbe> {
  const { promise, resolve } = Promise.withResolvers<RefreshProbe>();
  const stamps: number[] = [];
  const tick = (ts: number) => {
    stamps.push(ts);
    if (ts - stamps[0] < durationMs) { requestAnimationFrame(tick); return; }
    // The first intervals include the wake-up from an idle compositor.
    const usable = stamps.slice(2);
    const summary = summarizeFrames(usable, { originMs: usable[0] ?? 0 });
    refresh = {
      samples: usable.length,
      medianMs: summary.p50Ms,
      meanMs: summary.meanMs,
      minMs: summary.minMs,
      maxMs: summary.maxMs,
      estimatedHz: summary.p50Ms ? round(1000 / summary.p50Ms, 1) : null,
    };
    resolve(refresh);
  };
  requestAnimationFrame(tick);
  return promise;
}

function geometry(run: Run) {
  const scroller = run.scroller;
  if (!scroller) return;
  const box = scroller.getBoundingClientRect();
  const head = scroller.querySelector('thead');
  run.viewTop = Math.max(box.top, head ? head.getBoundingClientRect().bottom : box.top);
  run.viewBottom = box.top + scroller.clientHeight;
  run.maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
}

function sampleCoverage(run: Run, ts: number) {
  const scroller = run.scroller;
  if (!scroller) return;
  if (run.covN >= run.cT.length) { run.covDropped++; return; }
  if (!run.body || !run.body.isConnected) run.body = scroller.querySelector('tbody');
  // Layout-dependent limits change only when rows or the window do: refresh them rarely.
  if (run.covN % 64 === 0) geometry(run);
  const body = run.body;
  const top = scroller.scrollTop;
  const rows = body ? body.childElementCount : 0;
  let coverage = 0;
  let above = 0;
  let below = 0;
  if (body && rows > 0) {
    const first = body.firstElementChild as HTMLElement;
    const last = body.lastElementChild as HTMLElement;
    const firstBox = first.getBoundingClientRect();
    const lastBox = last.getBoundingClientRect();
    const height = run.viewBottom - run.viewTop;
    const covered = Math.min(lastBox.bottom, run.viewBottom) - Math.max(firstBox.top, run.viewTop);
    coverage = height > 0 ? Math.min(1, Math.max(0, covered / height)) : 0;
    above = run.viewTop - firstBox.top;
    below = lastBox.bottom - run.viewBottom;
    // Mounted rows are a contiguous index range; verify it now and then rather than every frame.
    if (run.contiguityChecked < 4096 && run.covN % 16 === 0) {
      run.contiguityChecked++;
      let previous = Number(first.getAttribute('data-index'));
      for (let node = first.nextElementSibling; node; node = node.nextElementSibling) {
        const index = Number(node.getAttribute('data-index'));
        if (index !== previous + 1) { run.contiguityBroken++; break; }
        previous = index;
      }
    }
  }
  const n = run.covN++;
  run.cT[n] = ts;
  run.cTop[n] = top;
  run.cCum[n] = run.wheelCum;
  run.cCov[n] = coverage;
  run.cAbove[n] = above;
  run.cBelow[n] = below;
  run.cRows[n] = Math.min(rows, 65535);
  run.cEdge[n] = top <= 0.5 || top >= run.maxScroll - 0.5 ? 1 : 0;
}

/**
 * Options as given, without the keys that are `undefined`. A runner that passes an option it has no
 * value for must get the default, not an `undefined` spread over it: `coverageEveryFrames: undefined`
 * once turned the per-frame coverage sampler off without any error.
 */
function defined(input: CaptureOptions): CaptureOptions {
  // Object.fromEntries widens to an index signature; the keys are the caller's own.
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as CaptureOptions;
}

function start(input: CaptureOptions = {}): Json {
  if (current) throw new Error('a capture is already running; call capture.stop() first');
  const options = {
    label: '',
    maxSamples: DEFAULT_MAX_SAMPLES,
    frames: true,
    coverage: true,
    coverageEveryFrames: 1,
    input: true,
    longTasks: true,
    longAnimationFrames: true,
    mutations: false,
    domCountEveryMs: 1000,
    raw: false,
    ...defined(input),
  };
  for (const key of ['maxSamples', 'coverageEveryFrames', 'domCountEveryMs'] as const) {
    if (!Number.isFinite(options[key]) || options[key] < 0) throw new Error(`capture option ${key} must be a finite number of at least 0, got ${String(options[key])}`);
  }
  if (options.coverageEveryFrames < 1) throw new Error(`capture option coverageEveryFrames must be at least 1, got ${options.coverageEveryFrames}`);
  const max = Math.max(64, Math.min(Math.floor(options.maxSamples), 262_144));
  options.maxSamples = max;
  const scroller = options.coverage || options.input ? findTableScroller() : null;
  if (scroller) located = scroller;
  const entryTypes = supportedEntryTypes();
  const profile = window.__ovProfile;
  profile?.take();
  const run: Run = {
    options,
    startedAt: performance.now(),
    scroller,
    body: scroller ? scroller.querySelector('tbody') : null,
    viewTop: 0,
    viewBottom: 0,
    maxScroll: 0,
    startScrollTop: scroller ? scroller.scrollTop : null,
    rafId: 0,
    tick: 0,
    frames: new Float64Array(options.frames ? max : 0),
    frameN: 0,
    frameDropped: 0,
    cT: new Float64Array(options.coverage ? max : 0),
    cTop: new Float64Array(options.coverage ? max : 0),
    cCum: new Float64Array(options.coverage ? max : 0),
    cCov: new Float32Array(options.coverage ? max : 0),
    cAbove: new Float32Array(options.coverage ? max : 0),
    cBelow: new Float32Array(options.coverage ? max : 0),
    cRows: new Uint16Array(options.coverage ? max : 0),
    cEdge: new Uint8Array(options.coverage ? max : 0),
    covN: 0,
    covDropped: 0,
    contiguityChecked: 0,
    contiguityBroken: 0,
    wheelN: 0, wheelDy: 0, wheelDx: 0, wheelCum: 0, wheelFirst: -1, wheelLast: -1, wheelModes: {},
    wT: new Float64Array(options.input ? max : 0),
    wD: new Float32Array(options.input ? max : 0),
    wDelay: new Float32Array(options.input ? max : 0),
    wheelSampled: 0, wheelDropped: 0, delayUnavailable: 0,
    scrollN: 0, scrollFirst: -1, scrollLast: -1,
    sT: new Float64Array(options.input ? max : 0),
    scrollSampled: 0, scrollDropped: 0,
    domT: [], domN: [], lastDomAt: -Infinity,
    longObserver: null, longEntries: [], loafObserver: null, loafEntries: [],
    mutationObserver: null,
    mutationCounts: { rowsAdded: 0, rowsRemoved: 0, nodesAdded: 0, nodesRemoved: 0, attributes: 0, records: 0 },
    onWheel: () => undefined,
    onScroll: () => undefined,
  };
  if (scroller) geometry(run);

  run.onWheel = (event: WheelEvent) => {
    const t = performance.now();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (run.scroller?.clientHeight ?? window.innerHeight) : 1;
    const dy = event.deltaY * scale;
    run.wheelN++;
    run.wheelDy += dy;
    run.wheelDx += event.deltaX * scale;
    run.wheelCum += dy;
    run.wheelModes[event.deltaMode] = (run.wheelModes[event.deltaMode] ?? 0) + 1;
    if (run.wheelFirst < 0) run.wheelFirst = t;
    run.wheelLast = t;
    // Time from the event's own timestamp to this handler: the main thread's input queue delay.
    const delay = t - event.timeStamp;
    const valid = delay >= 0 && delay < 5000;
    if (!valid) run.delayUnavailable++;
    if (run.wheelSampled < run.wT.length) {
      const i = run.wheelSampled++;
      run.wT[i] = t;
      run.wD[i] = dy;
      run.wDelay[i] = valid ? delay : -1;
    } else run.wheelDropped++;
  };
  run.onScroll = (event: Event) => {
    if (run.scroller && event.target !== run.scroller) return;
    const t = performance.now();
    run.scrollN++;
    if (run.scrollFirst < 0) run.scrollFirst = t;
    run.scrollLast = t;
    if (run.scrollSampled < run.sT.length) run.sT[run.scrollSampled++] = t;
    else run.scrollDropped++;
  };
  if (options.input) {
    window.addEventListener('wheel', run.onWheel, { capture: true, passive: true });
    document.addEventListener('scroll', run.onScroll, { capture: true, passive: true });
  }
  if (options.longTasks && entryTypes.includes('longtask')) {
    run.longObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (run.longEntries.length < MAX_ENTRIES) run.longEntries.push({ start: entry.startTime, duration: entry.duration });
      }
    });
    run.longObserver.observe({ type: 'longtask' });
  }
  if (options.longAnimationFrames && entryTypes.includes('long-animation-frame')) {
    run.loafObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as LoafEntry[]) {
        if (run.loafEntries.length >= MAX_ENTRIES) break;
        let scriptMs = 0;
        for (const script of entry.scripts ?? []) scriptMs += script.duration;
        run.loafEntries.push({
          start: entry.startTime, duration: entry.duration, blocking: entry.blockingDuration ?? null,
          renderStart: entry.renderStart ?? null, styleAndLayoutStart: entry.styleAndLayoutStart ?? null, scriptMs,
        });
      }
    });
    run.loafObserver.observe({ type: 'long-animation-frame' });
  }
  if (options.mutations && typeof MutationObserver !== 'undefined') {
    const counts = run.mutationCounts;
    run.mutationObserver = new MutationObserver((records) => {
      counts.records += records.length;
      for (const record of records) {
        if (record.type === 'attributes') { counts.attributes++; continue; }
        for (const node of record.addedNodes) {
          if (node.nodeType !== 1) continue;
          counts.nodesAdded++;
          if ((node as Element).tagName === 'TR') counts.rowsAdded++;
        }
        for (const node of record.removedNodes) {
          if (node.nodeType !== 1) continue;
          counts.nodesRemoved++;
          if ((node as Element).tagName === 'TR') counts.rowsRemoved++;
        }
      }
    });
    run.mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true });
  }

  const onFrame = (ts: number) => {
    if (current !== run) return;
    if (options.frames) {
      if (run.frameN < run.frames.length) run.frames[run.frameN++] = ts;
      else run.frameDropped++;
    }
    if (options.coverage && ++run.tick % Math.max(1, options.coverageEveryFrames) === 0) sampleCoverage(run, ts);
    if (options.domCountEveryMs > 0 && ts - run.lastDomAt >= options.domCountEveryMs) {
      run.lastDomAt = ts;
      run.domT.push(ts);
      run.domN.push(countElements());
    }
    run.rafId = requestAnimationFrame(onFrame);
  };
  current = run;
  run.domT.push(run.startedAt);
  run.domN.push(countElements());
  run.rafId = requestAnimationFrame(onFrame);
  return { id: options.label, startedAtMs: run.startedAt, timeOriginEpochMs: performance.timeOrigin, scrollerFound: !!scroller, maxSamples: max };
}

const rounded = (values: ArrayLike<number>, n: number, digits: number): number[] => {
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = round(values[i], digits) as number;
  return out;
};

function stop(): Json {
  const run = current;
  if (!run) throw new Error('no capture is running');
  current = null;
  cancelAnimationFrame(run.rafId);
  window.removeEventListener('wheel', run.onWheel, true);
  document.removeEventListener('scroll', run.onScroll, true);
  const endedAt = performance.now();
  run.domT.push(endedAt);
  run.domN.push(countElements());
  run.longObserver?.takeRecords?.().forEach((entry) => {
    if (run.longEntries.length < MAX_ENTRIES) run.longEntries.push({ start: entry.startTime, duration: entry.duration });
  });
  run.longObserver?.disconnect();
  run.loafObserver?.disconnect();
  run.mutationObserver?.takeRecords();
  run.mutationObserver?.disconnect();
  const profile = window.__ovProfile;
  const react = profile ? profile.take() : null;
  const entryTypes = supportedEntryTypes();
  const o = run.options;
  const refreshMs = refresh?.medianMs ?? null;

  const frameTimes = run.frames.subarray(0, run.frameN);
  const coverageSeries = {
    t: run.cT.subarray(0, run.covN), coverage: run.cCov.subarray(0, run.covN), above: run.cAbove.subarray(0, run.covN),
    below: run.cBelow.subarray(0, run.covN), rows: run.cRows.subarray(0, run.covN), edge: run.cEdge.subarray(0, run.covN),
  };
  let minTop: number | null = null;
  let maxTop: number | null = null;
  let endTop: number | null = null;
  let travelled = 0;
  for (let i = 0; i < run.covN; i++) {
    const top = run.cTop[i];
    minTop = minTop === null ? top : Math.min(minTop, top);
    maxTop = maxTop === null ? top : Math.max(maxTop, top);
    if (i > 0) travelled += Math.abs(top - run.cTop[i - 1]);
    endTop = top;
  }
  const longMs = run.longEntries.map((entry) => entry.duration as number);
  const loaf = run.loafEntries;
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const delays: number[] = [];
  for (let i = 0; i < run.wheelSampled; i++) if (run.wDelay[i] >= 0) delays.push(run.wDelay[i]);

  const result: Json = {
    schema: SCHEMA,
    label: o.label,
    startedAtMs: round(run.startedAt, 2),
    endedAtMs: round(endedAt, 2),
    durationMs: round(endedAt - run.startedAt, 2),
    timeOriginEpochMs: performance.timeOrigin,
    options: { ...o },
    scroller: run.scroller ? {
      startScrollTop: run.startScrollTop,
      endScrollTop: endTop,
      minScrollTop: minTop,
      maxScrollTop: maxTop,
      travelledPx: round(travelled, 1),
      maxScroll: run.maxScroll,
    } : null,
    frames: o.frames ? {
      supported: true,
      count: run.frameN,
      dropped: run.frameDropped,
      refreshMs,
      summary: summarizeFrames(frameTimes, { originMs: run.startedAt, refreshMs }),
    } : { supported: false },
    coverage: o.coverage && run.scroller ? {
      supported: true,
      samples: run.covN,
      dropped: run.covDropped,
      contiguityChecked: run.contiguityChecked,
      contiguityBroken: run.contiguityBroken,
      summary: summarizeCoverage(coverageSeries, { fullThreshold: HOLE_THRESHOLD }),
    } : { supported: false },
    input: o.input ? {
      supported: true,
      wheel: {
        events: run.wheelN, sumDeltaY: round(run.wheelDy, 1), sumDeltaX: round(run.wheelDx, 1), deltaModes: run.wheelModes,
        firstAtMs: run.wheelFirst < 0 ? null : round(run.wheelFirst, 2), lastAtMs: run.wheelLast < 0 ? null : round(run.wheelLast, 2),
        ratePerSecond: run.wheelN > 1 && run.wheelLast > run.wheelFirst ? round(((run.wheelN - 1) * 1000) / (run.wheelLast - run.wheelFirst), 2) : null,
        sampled: run.wheelSampled, dropped: run.wheelDropped,
        delayUnavailable: run.delayUnavailable, delayMs: summarizeSeries(delays, 2),
      },
      scroll: {
        events: run.scrollN, firstAtMs: run.scrollFirst < 0 ? null : round(run.scrollFirst, 2), lastAtMs: run.scrollLast < 0 ? null : round(run.scrollLast, 2),
        sampled: run.scrollSampled, dropped: run.scrollDropped,
      },
    } : { supported: false },
    longTasks: o.longTasks && entryTypes.includes('longtask') ? {
      supported: true, count: longMs.length, maxMs: longMs.length ? round(Math.max(...longMs), 1) : 0,
      blockingMs: round(sum(longMs.map((d) => Math.max(0, d - 50))), 1), entries: run.longEntries.map((e) => ({ start: round(e.start, 1), duration: round(e.duration, 1) })),
    } : { supported: false },
    longAnimationFrames: o.longAnimationFrames && entryTypes.includes('long-animation-frame') ? {
      supported: true, count: loaf.length,
      maxMs: loaf.length ? round(Math.max(...loaf.map((e) => e.duration as number)), 1) : 0,
      blockingMs: round(sum(loaf.map((e) => e.blocking ?? 0)), 1),
      scriptMs: round(sum(loaf.map((e) => e.scriptMs)), 1),
      renderMs: round(sum(loaf.map((e) => (e.renderStart ? Math.max(0, e.start + e.duration - e.renderStart) : 0))), 1),
      styleAndLayoutMs: round(sum(loaf.map((e) => (e.styleAndLayoutStart ? Math.max(0, e.start + e.duration - e.styleAndLayoutStart) : 0))), 1),
      entries: loaf.map((e) => ({ ...e, start: round(e.start, 1), duration: round(e.duration, 1) })),
    } : { supported: false },
    dom: {
      // Attached elements in the document, not renderer-allocated node objects.
      elements: { start: run.domN[0], end: run.domN[run.domN.length - 1], min: Math.min(...run.domN), max: Math.max(...run.domN), samples: run.domN.length },
    },
    mutations: run.mutationObserver ? { supported: true, ...run.mutationCounts } : { supported: false },
    react,
    jsHeapUsedMB: megabytes(jsHeapUsedBytes()),
  };
  if (o.raw) {
    result.series = {
      frames: rounded(frameTimes, run.frameN, 1),
      coverage: {
        t: rounded(coverageSeries.t, run.covN, 1), scrollTop: rounded(run.cTop, run.covN, 1), wheelCumulative: rounded(run.cCum, run.covN, 1),
        coverage: rounded(coverageSeries.coverage, run.covN, 4), above: rounded(coverageSeries.above, run.covN, 1),
        below: rounded(coverageSeries.below, run.covN, 1), rows: Array.from(coverageSeries.rows), edge: Array.from(coverageSeries.edge),
      },
      wheel: { t: rounded(run.wT, run.wheelSampled, 1), deltaY: rounded(run.wD, run.wheelSampled, 2), delayMs: rounded(run.wDelay, run.wheelSampled, 2) },
      scroll: rounded(run.sT, run.scrollSampled, 1),
      dom: { t: rounded(run.domT, run.domT.length, 1), elements: run.domN },
    };
  }
  return result;
}

/** Wait until the scroller has not moved for `stableMs`. `settleMs` is when it last moved. */
function waitSettled(options: { stableMs?: number; timeoutMs?: number } = {}): Promise<Json> {
  const { stableMs = 250, timeoutMs = 5000 } = options;
  const scroller = requireScroller();
  const { promise, resolve } = Promise.withResolvers<Json>();
  const begin = performance.now();
  let last = scroller.scrollTop;
  let lastMove = begin;
  const check = () => {
    const now = performance.now();
    const top = scroller.scrollTop;
    if (top !== last) { last = top; lastMove = now; }
    if (now - lastMove >= stableMs) resolve({ settled: true, settleMs: round(lastMove - begin, 1), scrollTop: top, waitedMs: round(now - begin, 1) });
    else if (now - begin >= timeoutMs) resolve({ settled: false, settleMs: round(lastMove - begin, 1), scrollTop: top, waitedMs: round(now - begin, 1) });
    else requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
  return promise;
}

async function position(px: number): Promise<Json> {
  const scroller = requireScroller();
  scroller.scrollTop = px;
  await frames(2);
  return read();
}

function read(): Json {
  const scroller = requireScroller();
  return { scrollTop: scroller.scrollTop, maxScroll: scroller.scrollHeight - scroller.clientHeight, clientHeight: scroller.clientHeight };
}

/** Visible alerts and status messages (toasts, banners): evidence that the screen was not in a clean state. */
function notices(): string[] {
  const out: string[] = [];
  for (const node of document.querySelectorAll('[role="alert"], [role="status"]')) {
    const text = (node.textContent ?? '').trim().replace(/\s+/g, ' ');
    if (text) out.push(text.slice(0, 200));
    if (out.length >= 10) break;
  }
  return out;
}

async function pages(options: { pages: number; kind?: 'pods' | 'logs' }): Promise<Json> {
  const startedAtMs = performance.now();
  const result = await scrollPages({ pages: options.pages, kind: options.kind ?? 'pods' });
  return { ...result, startedAtMs, endedAtMs: performance.now() };
}

const HELP = [
  'window.__ovBench.capture   capabilities() probeRefresh(ms) start(options) stop() isRunning()',
  'window.__ovBench.scroll    locate() prepare({expectedRows}) position(px) read() waitSettled() notices() pages({pages})',
  'window.__ovBench.fixture   stats() updates.start(spec) updates.stop() updates.ledger()',
  'Drive wheel input from outside the page (CDP or a native pointer) at scroll.locate().wheelPoint, between capture.start() and capture.stop().',
  'capture.stop() returns summaries; start({ raw: true }) adds the bounded raw series.',
].join('\n');

export function installCapture() {
  return {
    capture: {
      capabilities,
      probeRefresh,
      start,
      stop,
      isRunning: () => current !== null,
    },
    scroll: { locate, prepare, position, read, waitSettled, notices, pages },
    help: () => HELP,
  };
}
