// The shares of the panes of a group: pure arithmetic on arrays of numbers. The layout owns pixels (the 80 px minimum of a pane, the extent of the panel); the model owns the ratios, and
// `minRatio` is the one place the two meet.

/** The least a pane may be along its axis, in pixels. The layout's rule, kept here so that the model and the layout cannot say two numbers. */
export const PANE_MIN_PX = 80;

/** How far from 1 the shares of a group may sum: they are floating point. */
export const RATIO_EPSILON = 1e-9;

/** `count` equal shares. */
export function equalRatios(count: number): readonly number[] {
  return [];
}

/**
 * The smallest share a pane may have in a panel `extent` pixels long that holds `count` panes: `minPx` of the extent, and never more than an equal share (where the panes cannot all have `minPx`, they
 * share the extent equally and none is below what it can be).
 */
export function minRatio(extent: number, count: number, minPx: number = PANE_MIN_PX): number {
  return 0;
}

/** The shares brought within the minimum: a share below `min` becomes `min` and the others give up the difference in proportion to what they have. Sums to 1. */
export function fitRatios(ratios: readonly number[], min: number): readonly number[] {
  return ratios;
}

/** The shares after the sash between pane `boundary` and the next is dragged to `position` (a share of the whole): the two panes it divides share what they had, neither below `min`; the others do not move. */
export function moveBoundary(ratios: readonly number[], boundary: number, position: number, min: number): readonly number[] {
  return ratios;
}
