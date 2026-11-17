// The page side of the table bench: the recorder, the live-update driver and the probes the runner calls through `window.__bench`.
// It knows nothing about a table's markup beyond what a variant tells it (`Probe`), so S, A, R and C are read by one piece of code.
//
// The recorder is ONE requestAnimationFrame loop that runs for the whole life of the page (so every variant pays for it equally and the
// idle cadence is measured by the same code as the scroll):
//   interval     the rAF timestamp deltas; nearest-rank percentiles are taken by the runner (a real frame, never interpolated)
//   frame work   the time from the start of a rAF callback to the next message-channel macrotask: the callbacks, style, layout and the
//                main-thread part of paint of that frame (a task queued during the rendering step runs after it)
//   coverage     per frame, how far the mounted rows reach past the top and the bottom of the visible body (negative = a hole); read from
//                the first and last mounted row's index attribute and the scroll offset, never from a rectangle
// It records `scrollTop` and the mounted row range every frame; reading `scrollTop` after React's synchronous commit moves the layout the
// rendering step would do into the callback, the same for every variant.
import { createUpdates } from '../corpus/updates.mjs';

export type Row = {
  readonly key: string;
  readonly name: string;
  readonly namespace: string;
  readonly nameTail: number;
  readonly ready: { readonly ready: number; readonly total: number } | undefined;
  readonly status: { readonly word: string; readonly role: string | undefined } | undefined;
  readonly restarts: number | undefined;
  readonly createdAt: number | undefined;
  readonly node: string | undefined;
  readonly ip: string | undefined;
};

/** What a variant tells the harness about its markup. */
export type Probe = {
  /** The element that scrolls. */
  readonly scroller: () => HTMLElement | null;
  /** The element whose children are the mounted rows (and, for the spacer layout, two spacer rows). */
  readonly body: () => HTMLElement | null;
  /** The attribute that carries a mounted row's index among the sorted rows. */
  readonly indexAttribute: string;
  /** The height of what sticks above the body, in px. */
  readonly headerHeight: () => number;
  /** A way to click the Name column's sort control. */
  readonly sortControl: () => HTMLElement | null;
};

export type UpdateSpec = { readonly eventsPerSecond: number; readonly recordsPerEvent: number; readonly recreateEvery: number; readonly seed: number };

const CAPACITY = 1 << 15;

declare global {
  interface Window {
    __bench: Harness;
    /** Counts of what the page did, installed by the init script of the runner before the page's own code runs. */
    __benchCounts?: { adds: number; removes: number; inRegionAdds: number };
    /** Calls of the cells' render functions, counted by the variants that count (the count runs). */
    __cellCalls?: number;
  }
}

const nextFrame = () => {
  const { promise, resolve } = Promise.withResolvers<number>();
  requestAnimationFrame(resolve);
  return promise;
};
const sleep = (ms: number) => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
};
/** A macrotask after the current frame's rendering step: called from a rAF continuation, it runs once that frame has been laid out and painted. */
const afterRender = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    resolve();
  };
  channel.port2.postMessage(0);
  return promise;
};

export class Harness {
  readonly stamps = new Float64Array(CAPACITY);
  readonly startedAt = new Float64Array(CAPACITY);
  readonly work = new Float64Array(CAPACITY).fill(Number.NaN);
  readonly scrollTops = new Float64Array(CAPACITY).fill(Number.NaN);
  readonly firstIndex = new Float64Array(CAPACITY).fill(Number.NaN);
  readonly lastIndex = new Float64Array(CAPACITY).fill(Number.NaN);
  readonly above = new Float64Array(CAPACITY).fill(Number.NaN);
  readonly below = new Float64Array(CAPACITY).fill(Number.NaN);
  readonly mounted = new Float64Array(CAPACITY).fill(Number.NaN);
  frames = 0;

  probe: Probe | undefined;
  /** The rows the page was given, and the rows now (after live updates). */
  baseRows: readonly Row[] = [];
  latestRows: readonly Row[] = [];
  setRows: ((rows: readonly Row[]) => void) | undefined;

  private readonly channel = new MessageChannel();
  private rowHeight = 0;
  private header = 0;
  private longTasks: Array<{ start: number; duration: number }> = [];
  private longFrames: Array<{ start: number; duration: number; blocking: number; renderStart: number; styleAndLayoutStart: number }> = [];
  private scrollAt: number | null = null;
  private frameWaiter: ((elapsed: number) => void) | null = null;
  private updatesActive = false;
  private updateLedger = { events: 0, touches: 0, recreated: 0, removed: 0, added: 0 };
  private cellCallsAtStart = 0;

  /** React's own count of what it rendered (the profiling build; the normal build leaves it at zero): commits by phase and their durations. */
  readonly profile: { commits: number; mount: number; update: number; 'nested-update': number; actualMs: number; baseMs: number; log: Array<[string, number, number]> } = { commits: 0, mount: 0, update: 0, 'nested-update': 0, actualMs: 0, baseMs: 0, log: [] };
  failure: string | undefined;

  /** Resolves with the page's facts once a row is on screen. */
  readonly ready: Promise<unknown>;
  private readonly resolveReady: (info: unknown) => void;
  private readonly rejectReady: (reason: Error) => void;
  mountedAt = 0;
  firstRowAt = 0;

  constructor() {
    const ready = Promise.withResolvers<unknown>();
    this.ready = ready.promise;
    this.resolveReady = ready.resolve;
    this.rejectReady = ready.reject;
    // A page that failed before the runner asked is still a failure the runner sees; the console must not also report it unhandled.
    ready.promise.catch(() => undefined);
    this.channel.port1.onmessage = (event: MessageEvent<number>) => {
      const index = event.data;
      const elapsed = performance.now() - (this.startedAt[index] ?? 0);
      this.work[index] = elapsed;
      if (this.scrollAt !== null && this.frameWaiter !== null) {
        const waiter = this.frameWaiter;
        const since = performance.now() - this.scrollAt;
        this.scrollAt = null;
        this.frameWaiter = null;
        waiter(since);
      }
    };

    // The scroll event that moves the window, stamped before any listener of the table runs (capture phase on the document).
    document.addEventListener(
      'scroll',
      () => {
        if (this.frameWaiter !== null && this.scrollAt === null) {
          this.scrollAt = performance.now();
        }
      },
      { capture: true, passive: true },
    );

    if (typeof PerformanceObserver !== 'undefined') {
      for (const type of ['longtask', 'long-animation-frame']) {
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (type === 'longtask') {
                this.longTasks.push({ start: entry.startTime, duration: entry.duration });
              } else {
                const frame = entry as PerformanceEntry & { blockingDuration?: number; renderStart?: number; styleAndLayoutStart?: number };
                this.longFrames.push({ start: entry.startTime, duration: entry.duration, blocking: frame.blockingDuration ?? 0, renderStart: frame.renderStart ?? 0, styleAndLayoutStart: frame.styleAndLayoutStart ?? 0 });
              }
            }
          }).observe({ type, buffered: false });
        } catch {
          // The engine has no such entry type: the signal stays empty and the report says null.
        }
      }
    }

    requestAnimationFrame(this.tick);
  }

  /** The variant is mounted: measure what the geometry is, then say ready once a row has painted. */
  attach(probe: Probe, rows: readonly Row[], setRows: (rows: readonly Row[]) => void) {
    this.probe = probe;
    this.baseRows = rows;
    this.latestRows = rows;
    this.setRows = setRows;
  }

  /** The variant could not be built or never showed a row: the runner's `ready` rejects with this. */
  fail(message: string) {
    this.failure = message;
    this.rejectReady(new Error(message));
  }

  async settleFirstRow(started: number) {
    this.mountedAt = started;
    // The first frame in which a mounted row has a height: the table has measured itself, windowed and laid out. The page is first painted
    // when the macrotask after that frame runs, which is what "mount to the first row" ends at.
    for (let guard = 0; guard < 600; guard += 1) {
      await nextFrame();
      const probe = this.probe;
      const body = probe?.body();
      if (probe === undefined || body === null || body === undefined) {
        continue;
      }

      const row = [...body.children].find((child) => child.hasAttribute(probe.indexAttribute));
      if (row !== undefined && row.getBoundingClientRect().height > 0) {
        this.rowHeight = row.getBoundingClientRect().height;
        this.header = probe.headerHeight();
        await afterRender();
        this.firstRowAt = performance.now();
        // Two more frames: the fit and the window settle after the first measure.
        await nextFrame();
        await nextFrame();
        this.resolveReady(this.info());
        return;
      }
    }

    throw new Error('no row appeared');
  }

  info() {
    const scroller = this.probe?.scroller();
    return {
      userAgent: navigator.userAgent,
      crossOriginIsolated: window.crossOriginIsolated,
      reactBuild: import.meta.env.BENCH_REACT_BUILD as string,
      rows: this.baseRows.length,
      rowHeight: this.rowHeight,
      headerHeight: this.header,
      scrollerHeight: scroller?.clientHeight ?? null,
      scrollerWidth: scroller?.clientWidth ?? null,
      scrollRange: scroller === null || scroller === undefined ? null : scroller.scrollHeight - scroller.clientHeight,
      mountToFirstRowMs: this.firstRowAt - this.mountedAt,
      elements: document.querySelectorAll('*').length,
      mountedRows: this.mountedRows(),
    };
  }

  private mountedRows(): number {
    const probe = this.probe;
    const body = probe?.body();
    if (probe === undefined || body === null || body === undefined) {
      return 0;
    }

    let count = 0;
    for (const child of body.children) {
      if (child.hasAttribute(probe.indexAttribute)) {
        count += 1;
      }
    }

    return count;
  }

  private readonly tick = (stamp: number) => {
    requestAnimationFrame(this.tick);
    const index = this.frames;
    if (index >= CAPACITY) {
      return;
    }

    this.frames += 1;
    this.startedAt[index] = performance.now();
    this.stamps[index] = stamp;
    this.sample(index);
    this.channel.port2.postMessage(index);
  };

  private sample(index: number) {
    const probe = this.probe;
    const scroller = probe?.scroller();
    const body = probe?.body();
    if (probe === undefined || scroller === null || scroller === undefined || body === null || body === undefined || this.rowHeight === 0) {
      return;
    }

    const top = scroller.scrollTop;
    this.scrollTops[index] = top;
    let first: Element | null = body.firstElementChild;
    while (first !== null && !first.hasAttribute(probe.indexAttribute)) {
      first = first.nextElementSibling;
    }

    let last: Element | null = body.lastElementChild;
    while (last !== null && !last.hasAttribute(probe.indexAttribute)) {
      last = last.previousElementSibling;
    }

    if (first === null || last === null) {
      return;
    }

    const firstIndex = Number(first.getAttribute(probe.indexAttribute));
    const lastIndex = Number(last.getAttribute(probe.indexAttribute));
    const visible = scroller.clientHeight - this.header;
    this.firstIndex[index] = firstIndex;
    this.lastIndex[index] = lastIndex;
    this.above[index] = top - firstIndex * this.rowHeight;
    this.below[index] = (lastIndex + 1) * this.rowHeight - (top + visible);
    this.mounted[index] = lastIndex - firstIndex + 1;
  }

  // ---- recording windows -------------------------------------------------------------------------------------------------------------

  begin(): number {
    this.longTasks = [];
    this.longFrames = [];
    this.cellCallsAtStart = window.__cellCalls ?? 0;
    return this.frames;
  }

  /** The frames from `from` to now, as plain arrays. The last frame is dropped: its work has not been read yet. */
  end(from: number) {
    const to = Math.max(from, this.frames - 1);
    const slice = (array: Float64Array) => Array.from(array.subarray(from, to));
    const intervals: number[] = [];
    for (let index = from + 1; index < to; index += 1) {
      intervals.push((this.stamps[index] ?? 0) - (this.stamps[index - 1] ?? 0));
    }

    const rowCount = this.latestRows.length;
    let holes = 0;
    let boundary = 0;
    let scored = 0;
    let minAbove = Number.POSITIVE_INFINITY;
    let minBelow = Number.POSITIVE_INFINITY;
    for (let index = from; index < to; index += 1) {
      const above = this.above[index] ?? Number.NaN;
      const below = this.below[index] ?? Number.NaN;
      if (Number.isNaN(above) || Number.isNaN(below)) {
        continue;
      }

      const atStart = (this.firstIndex[index] ?? 0) === 0;
      const atEnd = (this.lastIndex[index] ?? 0) >= rowCount - 1;
      scored += 1;
      if (!atStart) {
        minAbove = Math.min(minAbove, above);
      }

      if (!atEnd) {
        minBelow = Math.min(minBelow, below);
      }

      if ((!atStart && above < -0.5) || (!atEnd && below < -0.5)) {
        holes += 1;
      } else if (atStart || atEnd) {
        boundary += 1;
      }
    }

    return {
      frames: to - from,
      intervals,
      work: slice(this.work),
      scrollTops: slice(this.scrollTops),
      mounted: slice(this.mounted),
      coverage: { scored, holes, boundary, minAbove: Number.isFinite(minAbove) ? minAbove : null, minBelow: Number.isFinite(minBelow) ? minBelow : null },
      longTasks: this.longTasks,
      longFrames: this.longFrames,
      cellCalls: (window.__cellCalls ?? 0) - this.cellCallsAtStart,
    };
  }

  async idle(ms: number) {
    const from = this.begin();
    await sleep(ms);
    return this.end(from);
  }

  scrollTop(): number {
    return this.probe?.scroller()?.scrollTop ?? 0;
  }

  async resetScroll() {
    const scroller = this.probe?.scroller();
    if (scroller !== null && scroller !== undefined) {
      scroller.scrollTop = 0;
    }

    await nextFrame();
    await nextFrame();
  }

  // ---- the live-update workload ------------------------------------------------------------------------------------------------------

  resetRows() {
    this.latestRows = this.baseRows;
    this.setRows?.(this.baseRows);
  }

  /** The seeded sparse workload of bench/render/fixtures/updates.ts at the row level: `eventsPerSecond` events, each touching `recordsPerEvent` rows. */
  startUpdates(spec: UpdateSpec) {
    this.updatesActive = true;
    this.updateLedger = { events: 0, touches: 0, recreated: 0, removed: 0, added: 0 };
    const generator = createUpdates(spec);
    const interval = 1000 / spec.eventsPerSecond;
    const origin = performance.now();
    let count = 0;
    const step = () => {
      if (!this.updatesActive) {
        return;
      }

      const result = generator.apply(this.latestRows as Row[]) as { rows: Row[]; touched: Array<{ kind: string }>; removed: number; added: number };
      this.latestRows = result.rows;
      this.updateLedger.events += 1;
      this.updateLedger.touches += result.touched.length;
      this.updateLedger.recreated += result.touched.filter((touch) => touch.kind === 'recreate').length;
      this.updateLedger.removed += result.removed;
      this.updateLedger.added += result.added;
      this.setRows?.(result.rows);
      count += 1;
      setTimeout(step, Math.max(0, origin + (count + 1) * interval - performance.now()));
    };

    setTimeout(step, interval);
  }

  stopUpdates() {
    this.updatesActive = false;
    return { ...this.updateLedger };
  }

  // ---- B1 and the sort ---------------------------------------------------------------------------------------------------------------

  /**
   * Bulk re-mount of the window (B1): a jump of the scroll position that replaces every mounted row. Each sample runs from the scroll
   * event that moves the window to the end of the frame that shows the new rows (the callbacks, React's render and commit, style, layout
   * and the main-thread part of paint), so the wait for the frame boundary is not in it.
   */
  async remount(runs: number, warmups: number) {
    const scroller = this.probe?.scroller();
    if (scroller === null || scroller === undefined) {
      throw new Error('no scroller');
    }

    const range = scroller.scrollHeight - scroller.clientHeight;
    const targets = [Math.round(range * 0.25), Math.round(range * 0.75)];
    const samples: number[] = [];
    const mountedRows: number[] = [];
    scroller.scrollTop = targets[0] ?? 0;
    await nextFrame();
    await nextFrame();
    for (let run = 0; run < warmups + runs; run += 1) {
      await sleep(60);
      const target = targets[(run + 1) % 2] ?? 0;
      const jump = Promise.withResolvers<number>();
      this.frameWaiter = jump.resolve;
      this.scrollAt = null;
      scroller.scrollTop = target;
      const elapsed = await jump.promise;
      await nextFrame();
      if (run >= warmups) {
        samples.push(elapsed);
        mountedRows.push(this.mountedRows());
      }
    }

    return { samples, mountedRows };
  }

  /** Sort by Name from a click to the next painted frame; alternates the direction. */
  async sort(runs: number) {
    const probe = this.probe;
    const samples: number[] = [];
    for (let run = 0; run < runs; run += 1) {
      await sleep(80);
      const control = probe?.sortControl();
      if (control === null || control === undefined) {
        throw new Error('no sort control');
      }

      const started = performance.now();
      control.click();
      await nextFrame();
      await afterRender();
      samples.push(performance.now() - started);
    }

    return samples;
  }

  // ---- facts -------------------------------------------------------------------------------------------------------------------------

  /** The shape of the mounted rows: how many elements each holds, and the document's. */
  shape() {
    const probe = this.probe;
    const body = probe?.body();
    const perRow = new Map<number, number>();
    if (probe !== undefined && body !== null && body !== undefined) {
      for (const child of body.children) {
        if (child.hasAttribute(probe.indexAttribute)) {
          const elements = 1 + child.querySelectorAll('*').length;
          perRow.set(elements, (perRow.get(elements) ?? 0) + 1);
        }
      }
    }

    return {
      elementsInDocument: document.querySelectorAll('*').length,
      mountedRows: this.mountedRows(),
      elementsPerRow: Object.fromEntries(perRow),
      activeAnimations: document.getAnimations().length,
    };
  }

  // ---- the count runs (counts.mjs): what React did for one controlled change ------------------------------------------------------------

  /** Re-render the page's root with the same rows: an unrelated parent update. Set by the page. */
  rerender: (() => void) | undefined;

  /** The text the identity cell of a mounted row shows (name, then namespace): a row's name and namespace together are unique in the corpus. */
  private mountedIdentities(): Set<string> {
    const probe = this.probe;
    const body = probe?.body();
    const identities = new Set<string>();
    if (probe === undefined || body === null || body === undefined) {
      return identities;
    }

    for (const child of body.children) {
      if (child.hasAttribute(probe.indexAttribute)) {
        identities.add(child.children[1]?.textContent ?? '');
      }
    }

    return identities;
  }

  /** One record replaced by a new object, as a live update delivers it: a row in view, or the last row (out of view). Returns the row's name. */
  patch(where: 'inView' | 'outOfView') {
    const mounted = this.mountedIdentities();
    const rows = this.latestRows.slice();
    const index = where === 'inView' ? rows.findIndex((row) => mounted.has(row.name + row.namespace)) : rows.findLastIndex((row) => !mounted.has(row.name + row.namespace));
    const row = rows[index];
    if (row === undefined) {
      throw new Error(`no row to patch ${where}`);
    }

    rows[index] = { ...row, restarts: (row.restarts ?? 0) + 1 };
    this.latestRows = rows;
    this.setRows?.(rows);
    return row.name;
  }

  private rootRecords: string[] = [];
  private rootObserver: MutationObserver | undefined;

  /** From now on, record every attribute write on <html> and <body> (B7, rule 4). The theme provider writes before the page is ready, so the runner starts this after. */
  watchRoot() {
    this.rootRecords = [];
    this.rootObserver?.disconnect();
    this.rootObserver = new MutationObserver((list) => {
      for (const record of list) {
        this.rootRecords.push(`${(record.target as Element).tagName}.${record.attributeName ?? ''}`);
      }
    });
    this.rootObserver.observe(document.documentElement, { attributes: true });
    this.rootObserver.observe(document.body, { attributes: true });
  }

  rootWrites(): string[] {
    for (const record of this.rootObserver?.takeRecords() ?? []) {
      this.rootRecords.push(`${(record.target as Element).tagName}.${record.attributeName ?? ''}`);
    }

    return this.rootRecords;
  }

  /** The widths of the first mounted row's cells, in px: the column plan as the engine laid it out. */
  cellWidths(): number[] {
    const probe = this.probe;
    const body = probe?.body();
    const row = body === null || body === undefined || probe === undefined ? undefined : [...body.children].find((child) => child.hasAttribute(probe.indexAttribute));
    return row === undefined ? [] : [...row.children].map((cell) => Math.round(cell.getBoundingClientRect().width * 100) / 100);
  }

  /** Jump through the whole scroll range in `steps` positions, reading the column widths after each: any change after the first reading is a refit while scrolling. */
  async sweepWidths(steps: number) {
    const scroller = this.probe?.scroller();
    if (scroller === null || scroller === undefined) {
      throw new Error('no scroller');
    }

    const range = scroller.scrollHeight - scroller.clientHeight;
    const readings: number[][] = [];
    for (let step = 0; step <= steps; step += 1) {
      scroller.scrollTop = Math.round((range * step) / steps);
      await nextFrame();
      await nextFrame();
      readings.push(this.cellWidths());
    }

    scroller.scrollTop = 0;
    await nextFrame();
    return readings;
  }
}
