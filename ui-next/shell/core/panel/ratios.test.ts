import { describe, expect, it } from 'vitest';
import { equalRatios, fitRatios, minRatio, moveBoundary, PANE_MIN_PX, RATIO_EPSILON } from './ratios';

// The shares of the panes, as arithmetic: no state, no store. The minimum a pane may have is the layout's 80 px, and `minRatio` is the one place that turns it into a share.

const sum = (list: readonly number[]): number => list.reduce((total, one) => total + one, 0);

describe('equal shares', () => {
  it('are n shares of 1/n that sum to 1', () => {
    for (const n of [1, 2, 3, 7, 10]) {
      const shares = equalRatios(n);
      expect(shares, `n=${String(n)}`).toHaveLength(n);
      expect(shares.every((one) => one === 1 / n), `n=${String(n)}`).toBe(true);
      expect(Math.abs(sum(shares) - 1)).toBeLessThan(RATIO_EPSILON);
    }
  });
});

describe('the minimum share', () => {
  it('is 80 px of the extent, whatever the extent', () => {
    expect(PANE_MIN_PX).toBe(80);
    expect(minRatio(800, 2)).toBeCloseTo(0.1, 12);
    expect(minRatio(1280, 3)).toBeCloseTo(80 / 1280, 12);
    expect(minRatio(1440, 2, 120)).toBeCloseTo(120 / 1440, 12);
  });

  it('is never more than an equal share: panes that cannot each have 80 px share the extent equally', () => {
    expect(minRatio(200, 3)).toBeCloseTo(1 / 3, 12);
    expect(minRatio(80, 2)).toBeCloseTo(1 / 2, 12);
    expect(minRatio(0, 4)).toBeCloseTo(1 / 4, 12);
  });
});

describe('fitting shares to the minimum', () => {
  it('leaves shares that already respect it as they are', () => {
    expect(fitRatios([0.5, 0.3, 0.2], 0.1)).toEqual([0.5, 0.3, 0.2]);
  });

  it('raises a share below the minimum to it and takes the difference from the others in proportion', () => {
    const fitted = fitRatios([0.02, 0.58, 0.4], 0.1);
    expect(fitted[0]).toBeCloseTo(0.1, 12);
    expect(sum(fitted)).toBeCloseTo(1, 12);
    expect(fitted[1] / fitted[2]).toBeCloseTo(0.58 / 0.4, 9);
  });

  it('settles a chain: raising one share pushes another below the minimum, and that one is raised too', () => {
    const fitted = fitRatios([0.01, 0.01, 0.12, 0.86], 0.1);
    for (const one of fitted) {
      expect(one).toBeGreaterThanOrEqual(0.1 - RATIO_EPSILON);
    }

    expect(sum(fitted)).toBeCloseTo(1, 12);
  });

  it('gives equal shares where the minimum is an equal share (nothing else sums to 1)', () => {
    const fitted = fitRatios([0.7, 0.1, 0.1, 0.1], 0.25);
    for (const one of fitted) {
      expect(one).toBeCloseTo(0.25, 12);
    }
  });
});

describe('moving a sash', () => {
  it('moves the border between two panes and nothing else: what the two had together, they have together', () => {
    const moved = moveBoundary([0.25, 0.25, 0.5], 0, 0.1, 0.05);
    expect(moved[0]).toBeCloseTo(0.1, 12);
    expect(moved[1]).toBeCloseTo(0.4, 12);
    expect(moved[2]).toBe(0.5);
  });

  it('takes the position as a share of the whole: the sash after pane 1 sits at the shares before it plus its own', () => {
    const moved = moveBoundary([0.25, 0.25, 0.5], 1, 0.6, 0.05);
    expect(moved[0]).toBe(0.25);
    expect(moved[1]).toBeCloseTo(0.35, 12);
    expect(moved[2]).toBeCloseTo(0.4, 12);
  });

  it('stops where a pane would go below the minimum, on either side, and past either end', () => {
    expect(moveBoundary([0.5, 0.5], 0, 0, 0.1)[0]).toBeCloseTo(0.1, 12);
    expect(moveBoundary([0.5, 0.5], 0, 1, 0.1)[1]).toBeCloseTo(0.1, 12);
    expect(moveBoundary([0.5, 0.5], 0, Number.NEGATIVE_INFINITY, 0.1)[0]).toBeCloseTo(0.1, 12);
    expect(moveBoundary([0.5, 0.5], 0, 7, 0.1)[1]).toBeCloseTo(0.1, 12);
  });

  it('changes nothing for a boundary that is not there, a position that is not a number, or two panes that cannot both have the minimum', () => {
    expect(moveBoundary([0.5, 0.5], 1, 0.3, 0.1)).toEqual([0.5, 0.5]);
    expect(moveBoundary([0.5, 0.5], -1, 0.3, 0.1)).toEqual([0.5, 0.5]);
    expect(moveBoundary([0.5, 0.5], 0, Number.NaN, 0.1)).toEqual([0.5, 0.5]);
    expect(moveBoundary([0.04, 0.04, 0.92], 0, 0.05, 0.1)).toEqual([0.04, 0.04, 0.92]);
  });
});
