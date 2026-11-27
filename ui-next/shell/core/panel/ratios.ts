// The shares of the panes of a group: pure arithmetic on arrays of numbers. The layout owns pixels (the 80 px minimum of a pane, the extent of the panel); the model owns the ratios, and
// `minRatio` is the one place the two meet.

/** The least a pane may be along its axis, in pixels. The layout's rule, kept here so that the model and the layout cannot say two numbers. */
export const PANE_MIN_PX = 80;

/** How far from 1 the shares of a group may sum: they are floating point. */
export const RATIO_EPSILON = 1e-9;

/** `count` equal shares. */
export function equalRatios(count: number): readonly number[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, () => 1 / count);
}

/**
 * The smallest share a pane may have in a panel `extent` pixels long that holds `count` panes: `minPx` of the extent, and never more than an equal share (where the panes cannot all have `minPx`, they
 * share the extent equally and none is below what it can be).
 */
export function minRatio(extent: number, count: number, minPx: number = PANE_MIN_PX): number {
  const equal = count >= 1 ? 1 / count : 1;
  return extent > 0 && Number.isFinite(extent) ? Math.min(minPx / extent, equal) : equal;
}

/**
 * The shares brought within the minimum: a share below `min` becomes `min` and the others give up the difference in proportion to what they have, and a share that this takes below `min` is raised in its turn.
 * Shares that already respect `min` come back as they are (the same array). Sums to 1.
 */
export function fitRatios(ratios: readonly number[], min: number): readonly number[] {
  const count = ratios.length;
  if (count === 0 || ratios.every((one) => one >= min)) {
    return ratios;
  }

  if (min * count >= 1 - RATIO_EPSILON) {
    return equalRatios(count);
  }

  const fixed = new Array<boolean>(count).fill(false);
  for (;;) {
    let freeSum = 0;
    let fixedCount = 0;
    ratios.forEach((one, index) => {
      if (fixed[index]) {
        fixedCount += 1;
      } else {
        freeSum += one;
      }
    });

    const scale = freeSum > 0 ? (1 - fixedCount * min) / freeSum : 0;
    let again = false;
    ratios.forEach((one, index) => {
      if (!fixed[index] && one * scale < min) {
        fixed[index] = true;
        again = true;
      }
    });

    if (!again) {
      return ratios.map((one, index) => (fixed[index] ? min : one * scale));
    }

    if (fixed.every(Boolean)) {
      return equalRatios(count);
    }
  }
}

/**
 * The shares after the sash between pane `boundary` and the next is dragged to `position` (a share of the whole): the two panes it divides share what they had, neither below `min`; the others do not move.
 * A boundary that is not there, a position that is not a number, or two panes that cannot both have `min` change nothing (the same array).
 */
export function moveBoundary(ratios: readonly number[], boundary: number, position: number, min: number): readonly number[] {
  if (!Number.isInteger(boundary) || boundary < 0 || boundary + 1 >= ratios.length || Number.isNaN(position)) {
    return ratios;
  }

  const before = ratios.slice(0, boundary).reduce((total, one) => total + one, 0);
  const together = ratios[boundary] + ratios[boundary + 1];
  if (together < 2 * min) {
    return ratios;
  }

  const left = Math.min(together - min, Math.max(min, position - before));
  const moved = ratios.slice();
  moved[boundary] = left;
  moved[boundary + 1] = together - left;
  return moved;
}
