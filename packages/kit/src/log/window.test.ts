// The windowing maths of the log list: which of N fixed-height rows are mounted (HLT-1, MNR-L1, T-01, T-02). The window is the viewport plus the overscan on
// each side, rounded OUTWARDS to whole steps, so it moves once per step and React renders a new window once per `step` rows, not once per row (the old table's
// range extractor, lib #121, carried by the kit's table in useVirtualRows.ts). O(1): nothing here depends on how many rows there are.
import { describe, expect, it } from 'vitest';
import { windowOf, type WindowInput } from './window';

const base: WindowInput = { count: 100_000, rowHeight: 24, viewport: 600, scrollTop: 0, overscan: 10, step: 4 };
const at = (scrollTop: number, over: Partial<WindowInput> = {}) => windowOf({ ...base, scrollTop, ...over });
const size = (window: { start: number; end: number }) => window.end - window.start;

describe('the window', () => {
  it('is the rows in view plus the overscan below, from the first row, ending on a step', () => {
    // 600 px of 24 px rows is 25 rows (0..24); ten more below is 35; the end rounds up to a multiple of 4.
    expect(at(0)).toEqual({ start: 0, end: 36 });
  });

  it('is empty for no rows, and the rows there are when there are fewer than the viewport holds', () => {
    expect(at(0, { count: 0 })).toEqual({ start: 0, end: 0 });
    expect(at(0, { count: 7 })).toEqual({ start: 0, end: 7 });
  });

  it('ends at the last row at the end of the log, and never past it', () => {
    const top = base.count * base.rowHeight - base.viewport;
    const window = at(top);
    expect(window.end).toBe(base.count);
    expect(window.start).toBeLessThan(base.count - 25);
    expect(at(top + 5000).end).toBe(base.count);
  });

  it('mounts a bounded number of rows whatever the count: the viewport, the overscan twice, and less than a step more on each side (MNR-L1)', () => {
    const bound = 25 + 1 + 2 * 10 + 2 * (4 - 1);
    for (const count of [1_000, 100_000, 5_000_000]) {
      for (const top of [0, 12_345, 987_654, count * 24]) {
        expect(size(at(top, { count })), `count ${count}, top ${top}`).toBeLessThanOrEqual(bound);
      }
    }
  });

  it('moves once per step at each edge: four rows of scrolling change the window at most twice, where a step of 1 changes it for every row', () => {
    const distinct = (step: number) => {
      const windows = new Set<string>();
      // 96 px is four rows of scrolling, from a start that is a step boundary.
      for (let top = 24 * 40; top < 24 * 44; top += 3) {
        windows.add(JSON.stringify(at(top, { step })));
      }

      return windows.size;
    };

    // The start and the end each round to a step at their own phase, so two edges move at most twice in four rows.
    expect(distinct(4)).toBeLessThanOrEqual(3);
    expect(distinct(1)).toBeGreaterThan(distinct(4));
    expect(at(24 * 48).start).toBeGreaterThan(at(24 * 40).start);
  });

  it('never leaves a hole in the viewport while it moves forward and back', () => {
    const covered = (top: number) => {
      const window = at(top);
      const first = Math.floor(top / 24);
      const last = Math.ceil((top + 600) / 24) - 1;
      expect(window.start, `top ${top}`).toBeLessThanOrEqual(first);
      expect(window.end, `top ${top}`).toBeGreaterThan(Math.min(last, base.count - 1));
    };

    for (let top = 0; top <= 40_000; top += 13) {
      covered(top);
    }

    for (let top = 40_000; top >= 0; top -= 37) {
      covered(top);
    }
  });

  it('is the viewport and the overscan with a step of 1', () => {
    expect(at(24 * 100, { step: 1 })).toEqual({ start: 90, end: 100 + 25 + 10 });
  });

  it('survives a viewport of nothing (before layout) and a scroll offset past the end', () => {
    expect(size(at(0, { viewport: 0 }))).toBeGreaterThanOrEqual(0);
    expect(at(1e12).end).toBe(base.count);
    expect(at(-50)).toEqual(at(0));
  });
});
