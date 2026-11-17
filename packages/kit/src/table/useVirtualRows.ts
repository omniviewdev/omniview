// The windowing engine of the table: which of N fixed-height rows are mounted. It is the carried adapter (useVirtualizerSnapshot, T-05)
// plus the old table's range extractor (T-02) behind the small API the inventory proposed:
//
//   useVirtualRows({ count, getScrollElement, rowHeight, overscan, rangeStep }) -> { items, totalSize, measure, scrollToIndex }
//
// The window is not rebuilt for every row the viewport crosses: it keeps the same mounted range while the viewport moves inside the
// overscan and moves in steps of `rangeStep` rows, so React renders a new window once per step, not once per row (lib #121; the old
// team measured a step of 2 at +16.7% p99 and a step of 8 at +11.2% p95 against 4, `docs/ui-next/optimisations.md` 1.3). The items array
// keeps its identity while the window is the same, which is what keeps the snapshot, and the rows keyed by index, from rendering.
import type { Range } from '@tanstack/react-virtual';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { useVirtualizerSnapshot } from './useVirtualizerSnapshot';

/** One mounted row: its position among the rows and its distance from the top of the body, in px. */
export type VirtualRow = { readonly index: number; readonly start: number };

export type VirtualRowsOptions = {
  readonly count: number;
  /** The element that scrolls. Read on every commit, so a ref works. */
  readonly getScrollElement: () => Element | null;
  /** The one height of every row, in px. A new value rebuilds the offsets. */
  readonly rowHeight: number;
  /** Rows mounted beyond the viewport on each side, before the step rounds the window outwards. */
  readonly overscan: number;
  /** The window moves in steps of this many rows. Default: 4, or half the overscan when that is less. 1 moves it for every row. */
  readonly rangeStep?: number | undefined;
};

export type VirtualRows = {
  /** The mounted rows in order. The same array while the window is the same. */
  readonly items: readonly VirtualRow[];
  /** The height of all rows, in px: the height the body must have. */
  readonly totalSize: number;
  /** Drop what is known of the row geometry and measure again, after the row height changed from outside. */
  readonly measure: () => void;
  readonly scrollToIndex: (index: number, options?: { readonly align?: 'start' | 'center' | 'end' | 'auto' }) => void;
};

/** The largest step the old table found best, in rows. */
export const DEFAULT_RANGE_STEP = 4;

/**
 * An extractor that rounds the window outwards to whole steps and returns the same array while the rounded window is the same.
 * Exported for the table's tests; the hook builds it.
 */
export function createStepRangeExtractor(step: number): (range: Range) => number[] {
  let start = -1;
  let end = -1;
  let indices: number[] = [];
  return (range) => {
    const nextStart = Math.max(0, Math.floor((range.startIndex - range.overscan) / step) * step);
    const nextEnd = Math.min(range.count - 1, Math.ceil((range.endIndex + range.overscan + 1) / step) * step - 1);
    if (start !== nextStart || end !== nextEnd) {
      start = nextStart;
      end = nextEnd;
      indices = Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
    }

    return indices;
  };
}

export function useVirtualRows({ count, getScrollElement, rowHeight, overscan, rangeStep }: VirtualRowsOptions): VirtualRows {
  const step = rangeStep ?? Math.min(DEFAULT_RANGE_STEP, Math.floor(overscan / 2));
  const rangeExtractor = useMemo(() => (step > 1 ? createStepRangeExtractor(step) : undefined), [step]);
  const estimateSize = useCallback(() => rowHeight, [rowHeight]);
  const virtualizer = useVirtualizerSnapshot<Element, Element>({ count, getScrollElement, estimateSize, overscan, ...(rangeExtractor === undefined ? {} : { rangeExtractor }) });
  const { measure } = virtualizer;
  const previousHeight = useRef(rowHeight);
  useLayoutEffect(() => {
    if (previousHeight.current === rowHeight) {
      return;
    }

    previousHeight.current = rowHeight;
    // Offsets are cached by row; a new height from outside (density, text size) invalidates them all.
    measure();
  }, [rowHeight, measure]);
  return { items: virtualizer.virtualItems, totalSize: virtualizer.totalSize, measure, scrollToIndex: virtualizer.scrollToIndex };
}
