// The page side of the log bench: the frame recorder, the source driver, the search driver and the probes the runner calls through `window.__bench`.
// It knows nothing of a log view's markup beyond what a variant tells it (`Probe`), so the kit's `LogView` (K) and the plain-DOM control (C) are read by
// one piece of code.
//
// The recorder is ONE requestAnimationFrame loop that runs for the whole life of the page (every variant pays for it equally):
//   interval     the rAF timestamp deltas; nearest-rank percentiles are taken by the runner (a real frame, never interpolated)
//   frame work   the time from the start of a rAF callback to the next message-channel macrotask: the callbacks, style, layout and the main-thread part of
//                paint of that frame (a task queued during the rendering step runs after it)
//   rows         the children of the element that holds the mounted rows, read from `childElementCount` (no layout is forced)
//   commits      React's own count of commits, cumulative, read from the DevTools hook the runner installs before React loads (see lib.mjs)
//   held         the lines the source holds for the reader (the backlog)
import type { LogFeedBatch, LogFeedLine } from '../../../packages/kit/src/log/types';
import type { SyntheticFeed } from '../../../packages/kit/src/components/LogView/syntheticFeed';

/** What a variant tells the harness about its markup. */
export type Probe = {
  /** The element that scrolls. */
  readonly scroller: () => HTMLElement | null;
  /** The height of what sticks above the rows, in px. */
  readonly headerHeight: () => number;
  /** The find field and its count lane (the kit variant only). */
  readonly input?: () => HTMLInputElement | null;
  readonly lane?: () => HTMLElement | null;
  /** Whether the list says it follows the end of the log. */
  readonly following: () => boolean;
};

declare global {
  interface Window {
    __bench: Harness;
    /** Commit times (performance.now), pushed by the DevTools hook the runner installs. Absent in a page the runner did not open. */
    __benchCommits?: number[];
    /** Counts of what the page did, installed by the init script of the runner before the page's own code runs. */
    __benchCounts?: { adds: number; removes: number; inStageAdds: number; inStageRemoves: number; rootCustomWrites: number; otherCustomWrites: number };
  }
}

const CAPACITY = 1 << 16;

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

/** The text the strip's ANSI-free rows carry: what the view searches and shows. */
const SGR = /\u001b\[[0-9;]*m/g;
const plain = (text: string) => text.replace(SGR, '');
const NUMBER = new Intl.NumberFormat('en-US');

export class Harness {
  readonly stamps = new Float64Array(CAPACITY);
  readonly startedAt = new Float64Array(CAPACITY);
  readonly work = new Float64Array(CAPACITY).fill(Number.NaN);
  readonly scrollTops = new Float64Array(CAPACITY).fill(Number.NaN);
  readonly rows = new Float64Array(CAPACITY).fill(Number.NaN);
  readonly commitsAt = new Float64Array(CAPACITY).fill(Number.NaN);
  readonly heldAt = new Float64Array(CAPACITY).fill(Number.NaN);
  readonly atEnd = new Int8Array(CAPACITY).fill(-1);
  frames = 0;

  probe: Probe | undefined;
  feed: SyntheticFeed | undefined;
  unmount: (() => void) | undefined;
  /** Sample the scroll offset every frame (the scroll workloads); the follow workload samples it every 30th frame. */
  sampleScroll = false;
  failure: string | undefined;
  lastRead: LogFeedLine | undefined;

  private readonly channel = new MessageChannel();
  private longTasks: Array<{ start: number; duration: number }> = [];
  private longFrames: Array<{ start: number; duration: number; blocking: number }> = [];
  private windowCache: HTMLElement | null = null;
  private frameWaiter: ((elapsed: number) => void) | null = null;
  private scrollAt: number | null = null;

  /** Resolves with the page's facts once the variant is mounted. */
  readonly ready: Promise<unknown>;
  private readonly resolveReady: (info: unknown) => void;
  private readonly rejectReady: (reason: Error) => void;

  constructor() {
    const ready = Promise.withResolvers<unknown>();
    this.ready = ready.promise;
    this.resolveReady = ready.resolve;
    this.rejectReady = ready.reject;
    ready.promise.catch(() => undefined);
    // From the first line of the page's script, before anything mounts: what the mount writes at the root is on the record (`rootWrites()`) until a run's `watchRoot()` starts its own window.
    this.watchRoot();
    this.channel.port1.onmessage = (event: MessageEvent<number>) => {
      const index = event.data;
      this.work[index] = performance.now() - (this.startedAt[index] ?? 0);
      if (this.scrollAt !== null && this.frameWaiter !== null) {
        const waiter = this.frameWaiter;
        const since = performance.now() - this.scrollAt;
        this.scrollAt = null;
        this.frameWaiter = null;
        waiter(since);
      }
    };

    // The scroll event that moves the window, stamped before any listener of the list runs (capture phase on the document).
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
                const frame = entry as PerformanceEntry & { blockingDuration?: number };
                this.longFrames.push({ start: entry.startTime, duration: entry.duration, blocking: frame.blockingDuration ?? 0 });
              }
            }
          }).observe({ type, buffered: false });
        } catch {
          // The engine has no such entry type: the signal stays empty and the report says so.
        }
      }
    }

    requestAnimationFrame(this.tick);
  }

  attach(probe: Probe, feed: SyntheticFeed, unmount: () => void) {
    this.probe = probe;
    this.feed = feed;
    this.unmount = unmount;
    const read = feed.read;
    // One reader: remember the newest line it took, to check later that the view shows it.
    Object.defineProperty(feed, 'read', {
      value: (max: number): LogFeedBatch => {
        const batch = read(max);
        const last = batch.lines.at(-1);
        if (last !== undefined) {
          this.lastRead = last;
        }

        return batch;
      },
    });
    void this.settle();
  }

  fail(message: string) {
    this.failure = message;
    this.rejectReady(new Error(message));
  }

  private async settle() {
    for (let guard = 0; guard < 600; guard += 1) {
      await nextFrame();
      if (this.probe?.scroller() != null) {
        await nextFrame();
        await nextFrame();
        this.resolveReady(this.info());
        return;
      }
    }

    this.fail('the list never appeared');
  }

  info() {
    const scroller = this.probe?.scroller();
    const stage = document.getElementById('stage');
    return {
      userAgent: navigator.userAgent,
      crossOriginIsolated: window.crossOriginIsolated,
      reactBuild: import.meta.env.BENCH_REACT_BUILD as string,
      stageHeight: stage?.getBoundingClientRect().height ?? null,
      listHeight: scroller?.clientHeight ?? null,
      headerHeight: this.probe?.headerHeight() ?? null,
      scrollerWidth: scroller?.clientWidth ?? null,
      elements: document.querySelectorAll('*').length,
    };
  }

  /** The geometry the list has now, once rows exist: what the windowing bound is computed from. */
  geometry() {
    const scroller = this.probe?.scroller();
    const row = scroller?.querySelector('[data-n]');
    const header = this.probe?.headerHeight() ?? 0;
    const rowHeight = row?.getBoundingClientRect().height ?? 0;
    const viewport = scroller === null || scroller === undefined ? 0 : scroller.clientHeight - header;
    return {
      rowHeight,
      header,
      viewport,
      clientHeight: scroller?.clientHeight ?? 0,
      scrollHeight: scroller?.scrollHeight ?? 0,
      scrollTop: scroller?.scrollTop ?? 0,
      // Rows a viewport touches at the worst alignment: its rows rounded up, and one more (a row cut at each edge), whatever the offset.
      visibleRowsMax: rowHeight > 0 ? Math.ceil(viewport / rowHeight) + 1 : 0,
    };
  }

  private windowElement(): HTMLElement | null {
    if (this.windowCache !== null && this.windowCache.isConnected) {
      return this.windowCache;
    }

    this.windowCache = this.probe?.scroller()?.querySelector('[data-n]')?.parentElement ?? null;
    return this.windowCache;
  }

  rowsMounted(): number {
    return this.windowElement()?.childElementCount ?? 0;
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
    if (probe === undefined) {
      return;
    }

    this.commitsAt[index] = window.__benchCommits?.length ?? 0;
    this.heldAt[index] = this.feed?.stats().held ?? Number.NaN;
    this.rows[index] = this.windowElement()?.childElementCount ?? 0;
    const everyFrame = this.sampleScroll;
    if (everyFrame || index % 30 === 0) {
      const scroller = probe.scroller();
      if (scroller !== null) {
        this.scrollTops[index] = scroller.scrollTop;
        this.atEnd[index] = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1 ? 1 : 0;
      }
    }
  }

  // ---- recording windows --------------------------------------------------------------------------------------------------------------

  begin(): number {
    this.longTasks = [];
    this.longFrames = [];
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

    // Commits that fell between the start of frame `index` and the start of the next: React's work for that frame.
    const commitsPerFrame: number[] = [];
    for (let index = from; index + 1 < to; index += 1) {
      commitsPerFrame.push((this.commitsAt[index + 1] ?? 0) - (this.commitsAt[index] ?? 0));
    }

    const sampledEnd = Array.from(this.atEnd.subarray(from, to)).filter((value) => value >= 0);
    return {
      frames: to - from,
      intervals,
      work: slice(this.work),
      scrollTops: slice(this.scrollTops),
      rows: slice(this.rows),
      held: slice(this.heldAt),
      commitsPerFrame,
      commitsTotal: (this.commitsAt[Math.max(from, to - 1)] ?? 0) - (this.commitsAt[from] ?? 0),
      atEndSamples: sampledEnd.length,
      atEndTrue: sampledEnd.filter((value) => value === 1).length,
      longTasks: this.longTasks,
      longFrames: this.longFrames,
    };
  }

  async idle(ms: number) {
    const from = this.begin();
    await sleep(ms);
    return this.end(from);
  }

  // ---- the source ---------------------------------------------------------------------------------------------------------------------

  /** Makes `count` lines at once, held for the reader. */
  fill(count: number) {
    this.feed?.emit(count);
  }

  /** Wait until the reader has taken every held line, then three frames more. */
  async drained(guardFrames = 1800) {
    for (let guard = 0; guard < guardFrames; guard += 1) {
      await nextFrame();
      if ((this.feed?.stats().held ?? 0) === 0) {
        await nextFrame();
        await nextFrame();
        await nextFrame();
        return this.feed?.stats();
      }
    }

    throw new Error(`the source still held ${this.feed?.stats().held ?? 0} lines after ${guardFrames} frames`);
  }

  startStream() {
    this.feed?.start();
  }

  stopStream() {
    this.feed?.stop();
  }

  stats() {
    return this.feed?.stats() ?? { received: 0, dropped: 0, held: 0 };
  }

  /** What the list shows of the newest line, against what the reader took last: following, under load, shows the end. */
  finalState() {
    const scroller = this.probe?.scroller();
    const rows = scroller?.querySelectorAll('[data-n]');
    const lastRow = rows === undefined || rows.length === 0 ? undefined : rows[rows.length - 1];
    const lastText = lastRow?.textContent ?? '';
    // The kit draws the text without its colour escapes and the control draws the line as the feed made it: the newest line is shown when either form is in the last row.
    const raw = this.lastRead === undefined ? '' : this.lastRead.text;
    const wanted = plain(raw);
    return {
      following: this.probe?.following() ?? false,
      atEnd: scroller === null || scroller === undefined ? false : scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1,
      lastRowShowsNewestLine: wanted !== '' && (lastText.includes(wanted) || lastText.includes(raw)),
      rowsMounted: this.rowsMounted(),
    };
  }

  // ---- scroll -------------------------------------------------------------------------------------------------------------------------

  scrollTop(): number {
    return this.probe?.scroller()?.scrollTop ?? 0;
  }

  async scrollTo(top: number) {
    const scroller = this.probe?.scroller();
    if (scroller !== null && scroller !== undefined) {
      scroller.scrollTop = top;
    }

    await nextFrame();
    await nextFrame();
  }

  /**
   * The old viewer's own workload (bench/render/log-viewer.bench.tsx): `pages` one-page steps down from the top, `gapMs` apart. Each sample runs from the
   * scroll event that moves the window to the end of the frame that shows the new rows.
   */
  async jumps(pages: number, gapMs: number) {
    const scroller = this.probe?.scroller();
    if (scroller === null || scroller === undefined) {
      throw new Error('no scroller');
    }

    const page = scroller.clientHeight - (this.probe?.headerHeight() ?? 0);
    const samples: number[] = [];
    const mounted: number[] = [];
    scroller.scrollTop = 0;
    await nextFrame();
    await nextFrame();
    for (let step = 1; step <= pages; step += 1) {
      await sleep(gapMs);
      const jump = Promise.withResolvers<number>();
      this.frameWaiter = jump.resolve;
      this.scrollAt = null;
      const before = scroller.scrollTop;
      scroller.scrollTop = step * page;
      // A write that leaves the offset where it was queues no scroll event, so there is none to wait for: the list has no page left to go down, and the log is shorter than the workload.
      if (scroller.scrollTop === before) {
        this.frameWaiter = null;
        throw new Error(`jump ${step} of ${pages} did not move the list: it is at ${before} px of ${scroller.scrollHeight} px, so the log is shorter than ${pages} pages`);
      }

      // The wait is bounded: a scroll event that never comes is an error, not a run that never ends.
      const waitMs = 5000;
      samples.push(await Promise.race([jump.promise, sleep(waitMs).then((): never => {
        this.frameWaiter = null;
        throw new Error(`jump ${step} of ${pages}: no frame came after the scroll in ${waitMs} ms`);
      })]));
      await nextFrame();
      mounted.push(this.rowsMounted());
    }

    return { samples, mounted, page };
  }

  // ---- search (the kit variant) ---------------------------------------------------------------------------------------------------------

  /** The count the find lane must read when a search has found everything: the lines of this source's first `lines` that match, by the view's own rule. */
  expectedMatches(query: string, regex: boolean, lines: number): number {
    const pattern = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const reference = new (this.feed!.constructor as new (options: { seed: number; maxHeld: number }) => SyntheticFeed)({ seed: 1, maxHeld: lines + 1 });
    reference.emit(lines);
    let count = 0;
    for (const line of reference.read(lines).lines) {
      if (pattern.test(plain(line.text))) {
        count += 1;
      }
    }

    return count;
  }

  private setValue(value: string) {
    const input = this.probe?.input?.();
    if (input === null || input === undefined) {
      throw new Error('no search field');
    }

    // The way a person's typing arrives: the native setter, then an `input` event the field's `onChange` hears.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** Turn the regular-expression toggle on or off, as the button does. */
  setRegex(on: boolean) {
    const button = document.querySelector<HTMLElement>('button[aria-label="Use regular expression"]');
    if (button === null) {
      throw new Error('no regex toggle');
    }

    if ((button.getAttribute('aria-pressed') === 'true') !== on) {
      button.click();
    }
  }

  /**
   * Put `query` in the field (all at once, or one character every `typeEveryMs`) and wait until the count lane says `expected`: the lines the search found
   * are all there are. Returns the time from the last input event to that text in the DOM, and the frames of the whole interaction.
   */
  async search(query: string, expected: number, typeEveryMs: number | undefined, timeoutMs = 15_000) {
    const lane = this.probe?.lane?.();
    if (lane === null || lane === undefined) {
      throw new Error('no count lane');
    }

    const wanted = expected === 0 ? 'No results' : `${NUMBER.format(expected)} of ${NUMBER.format(expected)}`;
    const done = Promise.withResolvers<number | null>();
    let started = 0;
    // Only the whole query's own count ends the search: a prefix of it can find the same lines (every line with "connection " has "connection reset").
    let accepting = false;
    let finished: number | null = null;
    const observer = new MutationObserver(() => {
      if (finished === null && accepting && lane.textContent === wanted) {
        finished = performance.now();
        done.resolve(finished);
      }
    });
    observer.observe(lane, { childList: true, characterData: true, subtree: true });
    const from = this.begin();
    if (typeEveryMs === undefined) {
      accepting = true;
      started = performance.now();
      this.setValue(query);
    } else {
      for (let length = 1; length <= query.length; length += 1) {
        accepting = length === query.length;
        started = performance.now();
        this.setValue(query.slice(0, length));
        if (length < query.length) {
          await sleep(typeEveryMs);
        }
      }
    }

    const timer = setTimeout(() => {
      done.resolve(null);
    }, timeoutMs);
    const end = await done.promise;
    clearTimeout(timer);
    observer.disconnect();
    // The frames after the text appeared: the rows that were marked, drawn.
    await nextFrame();
    await nextFrame();
    const record = this.end(from);
    return { doneMs: end === null ? null : end - started, lane: lane.textContent, wanted, record };
  }

  async clearSearch() {
    this.setValue('');
    await nextFrame();
    await nextFrame();
    await sleep(100);
  }

  // ---- facts --------------------------------------------------------------------------------------------------------------------------

  /** The shape of the mounted rows: how many elements each holds, and the document's. */
  shape() {
    const scroller = this.probe?.scroller();
    const perRow = new Map<number, number>();
    for (const row of scroller?.querySelectorAll('[data-n]') ?? []) {
      const elements = 1 + row.querySelectorAll('*').length;
      perRow.set(elements, (perRow.get(elements) ?? 0) + 1);
    }

    return { elementsInDocument: document.querySelectorAll('*').length, rowsMounted: this.rowsMounted(), elementsPerRow: Object.fromEntries(perRow), activeAnimations: document.getAnimations().length };
  }

  private rootRecords: string[] = [];
  private rootObserver: MutationObserver | undefined;

  /** From now on, record every attribute write on <html> and <body> (rule 4: no write at the document root). The theme provider writes before the page is ready. */
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

  /** React commits so far (the hook's count). */
  commits(): number {
    return window.__benchCommits?.length ?? 0;
  }
}
