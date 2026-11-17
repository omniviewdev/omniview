// The windowing engine of the table (register T-01, T-02, T-05; MNR-T1, MNR-T2). jsdom has no layout, so the viewport and the scroll
// offset are stubbed on the one element the hook watches; what is asserted is which rows are mounted and how often React renders.
import { act, fireEvent, render } from '@testing-library/react';
import { Profiler, useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useVirtualRows, type VirtualRows, type VirtualRowsOptions } from './useVirtualRows';

type Probe = Omit<VirtualRowsOptions, 'getScrollElement'> & { viewport: number };

let commits = 0;
let latest: VirtualRows | undefined;

function Rows({ viewport, ...options }: Probe) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = useVirtualRows({ ...options, getScrollElement: () => ref.current });
  latest = rows;
  return (
    <div ref={ref} data-testid="scroll" data-viewport={viewport}>
      <div data-testid="items">{rows.items.map((item) => item.index).join(',')}</div>
      <div data-testid="size">{rows.totalSize}</div>
    </div>
  );
}

// The hook reads clientHeight at mount and scrollTop on every scroll event.
const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return Number(this.getAttribute('data-viewport') ?? 0);
  },
});
afterEach(() => {
  commits = 0;
  latest = undefined;
});
void clientHeight;

function mount(probe: Probe) {
  const view = render(
    <Profiler id="rows" onRender={() => (commits += 1)}>
      <Rows {...probe} />
    </Profiler>,
  );
  const scroll = view.getByTestId('scroll');
  let offset = 0;
  Object.defineProperty(scroll, 'scrollTop', { configurable: true, get: () => offset, set: (value: number) => (offset = value) });
  return {
    view,
    items: () =>
      (view.getByTestId('items').textContent ?? '')
        .split(',')
        .filter(Boolean)
        .map(Number),
    size: () => Number(view.getByTestId('size').textContent),
    scrollTo: (top: number) => {
      act(() => {
        offset = top;
        fireEvent.scroll(scroll);
      });
    },
    rerender: (next: Probe) =>
      view.rerender(
        <Profiler id="rows" onRender={() => (commits += 1)}>
          <Rows {...next} />
        </Profiler>,
      ),
  };
}

const base: Probe = { count: 5000, rowHeight: 40, overscan: 8, rangeStep: 4, viewport: 600 };

describe('windowing', () => {
  it('mounts the rows in view plus the overscan, in order, and knows the total height', () => {
    const rows = mount(base);
    const items = rows.items();
    // 600 px of 40 px rows is 15 rows (0 to 14); eight more below, and the window ends on a step boundary.
    expect(items[0]).toBe(0);
    expect(items.at(-1)).toBe(23);
    expect(items).toEqual(Array.from({ length: items.length }, (_, index) => index));
    expect(rows.size()).toBe(5000 * 40);
  });

  it('mounts a small, bounded window whatever the row count (MNR-T1: at most 40 elements a row times a few dozen rows)', () => {
    const rows = mount({ ...base, count: 5025 });
    expect(rows.items().length).toBeLessThanOrEqual(30);
    rows.scrollTo(100_000);
    expect(rows.items().length).toBeLessThanOrEqual(30);
  });

  it('never leaves a hole in the viewport while the offset moves forward and back (MNR-T2)', () => {
    const rows = mount(base);
    const covered = (top: number) => {
      const first = Math.floor(top / 40);
      const last = Math.ceil((top + 600) / 40) - 1;
      const mounted = new Set(rows.items());
      for (let index = first; index <= last; index += 1) expect(mounted.has(index), `row ${index} at offset ${top}`).toBe(true);
    };
    for (let top = 0; top <= 8000; top += 13) {
      rows.scrollTo(top);
      covered(top);
    }

    for (let top = 8000; top >= 0; top -= 37) {
      rows.scrollTo(top);
      covered(top);
    }
  });
});

describe('the range moves in steps (T-02, T-05)', () => {
  it('a scroll that stays inside a step renders nothing', () => {
    const rows = mount(base);
    const before = commits;
    // One row at a time, three rows: the window (a step of four rows) is the same, so React is not asked to render.
    rows.scrollTo(40);
    rows.scrollTo(80);
    rows.scrollTo(120);
    expect(commits).toBe(before);
  });

  it('renders a new window once a step, not once a row', () => {
    const rows = mount(base);
    const before = commits;
    for (let row = 1; row <= 40; row += 1) rows.scrollTo(row * 40);
    const renders = commits - before;
    expect(renders).toBeGreaterThanOrEqual(8);
    expect(renders).toBeLessThanOrEqual(11);
  });

  it('a step of one renders for every row (the control that shows the step does the work)', () => {
    const rows = mount({ ...base, rangeStep: 1 });
    const before = commits;
    for (let row = 1; row <= 40; row += 1) rows.scrollTo(row * 40);
    expect(commits - before).toBeGreaterThanOrEqual(35);
  });

  it('keeps the window array when the range does not change, so a list of rows keyed by index keeps its elements', () => {
    const rows = mount(base);
    const first = latest?.items;
    rows.scrollTo(40);
    expect(latest?.items).toBe(first);
  });
});

describe('changes of the inputs', () => {
  it('follows the row count and a new row height (a density or text size change)', () => {
    const rows = mount(base);
    rows.rerender({ ...base, count: 5001 });
    expect(rows.size()).toBe(5001 * 40);
    rows.rerender({ ...base, count: 5001, rowHeight: 48 });
    expect(rows.size()).toBe(5001 * 48);
    const starts = latest?.items.map((item) => item.start) ?? [];
    expect(starts.slice(0, 3)).toEqual([0, 48, 96]);
  });

  it('is empty for no rows', () => {
    const rows = mount({ ...base, count: 0 });
    expect(rows.items()).toEqual([]);
    expect(rows.size()).toBe(0);
  });
});
