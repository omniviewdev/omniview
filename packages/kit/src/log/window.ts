// The windowing maths of the log list: which of N fixed-height rows are mounted (HLT-1, MNR-L1; register T-01, T-02).
//
// Provenance: the window of the old table's range extractor (T-02, lib #121: the mounted range is the viewport plus the overscan, rounded outwards to steps
// of four rows, so React renders a new window once per step and not once per row; a step of 2 measured +16.7% p99 and of 8 +11.2% p95 against 4,
// docs/ui-next/optimisations.md 1.3), which the kit carries for its table in table/useVirtualRows.ts on top of TanStack Virtual. The log list does not use
// TanStack Virtual: its rows are all one height, so the window is arithmetic, O(1) whatever the count, with nothing to rebuild when the count changes
// at the rate of a stream. A wrapped list, whose rows are not one height, is measured (wrappedWindow in the view, HLT-1).
export type WindowInput = {
  /** Rows in the list. */
  readonly count: number;
  /** The one height of a row, in px. */
  readonly rowHeight: number;
  /** The height of the area the rows scroll in, in px. */
  readonly viewport: number;
  /** How far the rows have scrolled, in px. */
  readonly scrollTop: number;
  /** Rows mounted beyond the viewport on each side, before the step rounds the window outwards. */
  readonly overscan: number;
  /** The window moves in steps of this many rows: 1 moves it for every row. */
  readonly step: number;
};

/** The rows mounted: from `start` up to, and not including, `end`. */
export type RowWindow = { readonly start: number; readonly end: number };

/** The rows `[start, end)` to mount for the viewport at `scrollTop`. */
export function windowOf({ count, rowHeight, viewport, scrollTop, overscan, step }: WindowInput): RowWindow {
  if (count <= 0) {
    return { start: 0, end: 0 };
  }

  const top = Math.max(0, scrollTop);
  const first = Math.min(Math.floor(top / rowHeight), count - 1);
  const last = Math.min(Math.max(Math.ceil((top + viewport) / rowHeight) - 1, first), count - 1);
  return {
    start: Math.max(0, Math.floor((first - overscan) / step) * step),
    end: Math.min(count, Math.ceil((last + 1 + overscan) / step) * step),
  };
}
