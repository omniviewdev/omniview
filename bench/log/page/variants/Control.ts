// C, the control: a scroller of plain `div` rows over the SAME window maths (the kit's `windowOf`, source) and the same feed, the same bound (100,000
// lines, head eviction), the same loop shape (the feed's wake-up asks for one frame; a frame reads within a 4 ms budget and draws once) and the same
// geometry (a 25 px sticky header, 24 px rows, a block as high as all the rows, the window moved to its first row, the list pinned to the end by writing
// `scrollTop` after the draw) in plain DOM: no React, no ANSI parse, no level detection, no search, no selection. It fixes what this machine and this
// engine give a windowed scroller that follows a stream: the floor the kit is measured against.
// With `sourceColumn` (a feed of more than one source) the control draws the source's name in a cell of its own, 168 px, as plain text: the data the kit's Source column shows, without its chip.
import type { LogFeed, LogFeedLine } from '../../../../packages/kit/src/log/types';
import { windowOf } from '../../../../packages/kit/src/log/window';
import type { Probe } from '../harness';

const ROW = 24;
const HEADER = 25;
const CAPACITY = 100_000;
const READ_SLICE = 2000;
const FEED_BUDGET_MS = 4;

let following = true;

export const probe: Probe = {
  scroller: () => document.querySelector<HTMLElement>('#stage [data-bench-scroller]'),
  headerHeight: () => HEADER,
  following: () => following,
};

const CSS = `
.c-list{position:relative;display:block;overflow:auto;box-sizing:border-box;background:#25282d;color:#d5d7db;font:13px/16px system-ui,sans-serif;overscroll-behavior:contain}
.c-canvas{box-sizing:border-box;width:max-content;min-width:100%}
.c-head{position:sticky;inset-block-start:0;z-index:1;display:flex;box-sizing:border-box;align-items:center;height:${HEADER}px;border-bottom:1px solid #3a3d44;background:#25282d;color:#9ba0a8}
.c-head>span{padding-inline:8px}
.c-sizer,.c-window{position:relative}
.c-row{display:flex;box-sizing:border-box;align-items:center;height:${ROW}px}
.c-time{flex:0 0 112px;box-sizing:border-box;padding-inline:12px 8px;color:#9ba0a8;font-variant-numeric:tabular-nums;white-space:nowrap}
.c-level{flex:0 0 96px;box-sizing:border-box;padding-inline:8px;white-space:nowrap}
.c-text{flex:1 0 auto;box-sizing:border-box;padding-inline:8px 12px;font:13px/18px ui-monospace,Menlo,monospace;white-space:pre}
.c-source{flex:0 0 168px;box-sizing:border-box;padding-inline:10px;color:#9ba0a8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
  const made = document.createElement(tag);
  made.className = className;
  return made;
};

/** Mounts the control into `stage`; returns what takes it down. `listHeight` is the height the scroller has (the kit's list gets the stage less its filter row and strip). */
export function mountControl(
  stage: HTMLElement,
  feed: LogFeed,
  options: { readonly overscan: number; readonly step: number; readonly listHeight: number; readonly sourceColumn?: boolean | undefined },
): () => void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  const scroller = element('div', 'c-list');
  scroller.dataset.benchScroller = '';
  scroller.style.height = `${options.listHeight}px`;
  const canvas = element('div', 'c-canvas');
  const head = element('div', 'c-head');
  for (const label of options.sourceColumn === true ? ['Time', 'Level', 'Source', 'Message'] : ['Time', 'Level', 'Message']) {
    const cell = document.createElement('span');
    cell.textContent = label;
    head.append(cell);
  }

  const sizer = element('div', 'c-sizer');
  const windowEl = element('div', 'c-window');
  sizer.append(windowEl);
  canvas.append(head, sizer);
  scroller.append(canvas);
  stage.append(scroller);

  const viewport = options.listHeight - HEADER;
  const ring = new Array<LogFeedLine | undefined>(CAPACITY);
  let ringHead = 0;
  let size = 0;
  let next = 1;
  let scrollTop = 0;
  let curStart = 0;
  let curEnd = 0;
  const rows: HTMLElement[] = [];
  following = true;

  const lineAt = (n: number) => ring[(ringHead + (n - (next - size))) % CAPACITY];

  const makeRow = (n: number): HTMLElement => {
    const line = lineAt(n);
    const row = element('div', 'c-row');
    row.dataset.n = String(n);
    const time = element('span', 'c-time');
    time.textContent = line?.timestamp.slice(11, 23) ?? '';
    const level = element('span', 'c-level');
    level.textContent = line?.level?.toUpperCase() ?? '';
    const text = element('span', 'c-text');
    text.textContent = line?.text ?? '';
    if (options.sourceColumn === true) {
      const source = element('span', 'c-source');
      source.textContent = line?.source ?? '';
      row.append(time, level, source, text);
    } else {
      row.append(time, level, text);
    }

    return row;
  };

  /** Make the mounted rows the ordinals `[startN, endN)`, keeping the ones that stay. */
  const reconcile = (startN: number, endN: number) => {
    if (rows.length === 0 || endN <= curStart || startN >= curEnd) {
      windowEl.replaceChildren();
      rows.length = 0;
      const fragment = document.createDocumentFragment();
      for (let n = startN; n < endN; n += 1) {
        const row = makeRow(n);
        rows.push(row);
        fragment.append(row);
      }

      windowEl.append(fragment);
      curStart = startN;
      curEnd = endN;
      return;
    }

    while (curStart < startN) {
      rows.shift()?.remove();
      curStart += 1;
    }

    while (curEnd > endN) {
      rows.pop()?.remove();
      curEnd -= 1;
    }

    for (let n = curStart - 1; n >= startN; n -= 1) {
      const row = makeRow(n);
      rows.unshift(row);
      windowEl.prepend(row);
    }

    if (curEnd < endN) {
      const fragment = document.createDocumentFragment();
      for (let n = curEnd; n < endN; n += 1) {
        const row = makeRow(n);
        rows.push(row);
        fragment.append(row);
      }

      windowEl.append(fragment);
    }

    curStart = startN;
    curEnd = endN;
  };

  let heightWritten = -1;
  let topWritten = -1;
  const render = () => {
    const maxTop = Math.max(0, size * ROW - viewport);
    const win = windowOf({ count: size, rowHeight: ROW, viewport, scrollTop: following ? maxTop : scrollTop, overscan: options.overscan, step: options.step });
    const first = next - size;
    reconcile(first + win.start, first + win.end);
    if (heightWritten !== size) {
      sizer.style.height = `${size * ROW}px`;
      heightWritten = size;
    }

    if (topWritten !== win.start) {
      windowEl.style.top = `${win.start * ROW}px`;
      topWritten = win.start;
    }

    if (following) {
      scroller.scrollTop = scroller.scrollHeight;
      scrollTop = scroller.scrollTop;
    }
  };

  const push = (line: LogFeedLine) => {
    if (size < CAPACITY) {
      ring[(ringHead + size) % CAPACITY] = line;
      size += 1;
    } else {
      ring[ringHead] = line;
      ringHead = (ringHead + 1) % CAPACITY;
    }

    next += 1;
  };

  let cancelFrame: number | undefined;
  const frame = () => {
    cancelFrame = undefined;
    const started = performance.now();
    let changed = false;
    let again = false;
    for (;;) {
      const batch = feed.read(READ_SLICE);
      for (const line of batch.lines) {
        push(line);
      }

      changed ||= batch.lines.length > 0;
      if (batch.lines.length === 0 || batch.held === 0) {
        break;
      }

      if (performance.now() - started >= FEED_BUDGET_MS) {
        again = true;
        break;
      }
    }

    if (changed) {
      render();
    }

    if (again) {
      request();
    }
  };

  function request() {
    cancelFrame ??= requestAnimationFrame(frame);
  }

  const onScroll = () => {
    scrollTop = scroller.scrollTop;
    following = scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    const maxTop = Math.max(0, size * ROW - viewport);
    const wanted = windowOf({ count: size, rowHeight: ROW, viewport, scrollTop: following ? maxTop : scrollTop, overscan: options.overscan, step: options.step });
    const first = next - size;
    if (first + wanted.start !== curStart || first + wanted.end !== curEnd) {
      render();
    }
  };

  scroller.addEventListener('scroll', onScroll, { passive: true });
  const unsubscribe = feed.subscribe(request);
  request();
  return () => {
    unsubscribe();
    if (cancelFrame !== undefined) {
      cancelAnimationFrame(cancelFrame);
    }

    scroller.removeEventListener('scroll', onScroll);
    scroller.remove();
    style.remove();
  };
}
