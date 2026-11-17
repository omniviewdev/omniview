import { describe, expect, it } from 'vitest';
import { GAP, MARGIN, place, type Box } from './placement';

// Where the one popup of a table goes, from the trigger's rectangle and the popup's measured size: below the trigger, its end edge on the
// trigger's end edge, flipped above when it does not fit below, kept 4 px inside the window. A pure function: the popup computes it once,
// when it opens (docs/ui-next/optimisations.md T-08).
const VIEWPORT = { width: 1000, height: 800 };
const SIZE = { width: 200, height: 120 };

const trigger = (left: number, top: number, width = 24, height = 24): Box => ({ left, top, width, height, right: left + width, bottom: top + height });

describe('the placement of a row menu', () => {
  it('keeps a 4 px gap to the trigger and a 4 px margin to the window', () => {
    expect(GAP).toBe(4);
    expect(MARGIN).toBe(4);
  });

  it('opens below the trigger, its end edge on the trigger\'s end edge', () => {
    const where = place(trigger(500, 100), SIZE, VIEWPORT);
    // The popup's right edge (left + 200) is the trigger's right edge (524); its top is the trigger's bottom (124) and the gap.
    expect(where).toEqual({ side: 'bottom', left: 324, top: 128, maxHeight: undefined });
  });

  it('opens above when it does not fit below and does fit above', () => {
    const where = place(trigger(500, 700), SIZE, VIEWPORT);
    // Room below: 800 - 4 - (724 + 4) = 68; room above: 700 - 4 - 4 = 692. Its bottom edge is the gap above the trigger.
    expect(where).toEqual({ side: 'top', left: 324, top: 700 - GAP - 120, maxHeight: undefined });
  });

  it('stays below when it fits exactly, and goes above one pixel later', () => {
    // Room below is 800 - 4 - (bottom + 4): a popup of 120 fits while bottom <= 672.
    expect(place(trigger(500, 648), SIZE, VIEWPORT).side).toBe('bottom');
    expect(place(trigger(500, 649), SIZE, VIEWPORT).side).toBe('top');
  });

  it('takes the side with more room and limits its height when it fits on neither, so the popup scrolls itself', () => {
    const short = { width: 1000, height: 200 };
    // Trigger at 90..114: room below 200 - 4 - 118 = 78, room above 90 - 8 = 82. The popup (120) fits on neither: above, 82 px tall.
    const where = place(trigger(500, 90), SIZE, short);
    expect(where.side).toBe('top');
    expect(where.maxHeight).toBe(82);
    expect(where.top).toBe(MARGIN);
    // The mirror: room below is the larger.
    const below = place(trigger(500, 80), SIZE, short);
    expect(below.side).toBe('bottom');
    expect(below.maxHeight).toBe(200 - MARGIN - (104 + GAP));
    expect(below.top).toBe(108);
  });

  it('keeps 4 px inside every edge of the window', () => {
    // Near the start edge: the end-aligned left would be negative.
    expect(place(trigger(10, 100), SIZE, VIEWPORT).left).toBe(MARGIN);
    // Beyond the end edge: the popup's right edge may not pass the margin.
    expect(place(trigger(990, 100), SIZE, VIEWPORT).left).toBe(VIEWPORT.width - MARGIN - SIZE.width);
    // Above the top edge (a trigger scrolled half out of view): the popup stays inside.
    expect(place(trigger(500, -20), SIZE, VIEWPORT).top).toBeGreaterThanOrEqual(MARGIN);
    // Below the bottom edge.
    const low = place(trigger(500, 900), SIZE, VIEWPORT);
    expect(low.top + SIZE.height).toBeLessThanOrEqual(VIEWPORT.height - MARGIN);
  });

  it('is never wider than the window less its margins', () => {
    const where = place(trigger(100, 100), { width: 2000, height: 120 }, VIEWPORT);
    expect(where.left).toBe(MARGIN);
  });

  it('aligns the other way in a right-to-left context: its end edge is the trigger\'s left edge', () => {
    const where = place(trigger(500, 100), SIZE, VIEWPORT, true);
    expect(where.left).toBe(500);
    expect(where.top).toBe(128);
    // And it is still kept inside the window.
    expect(place(trigger(950, 100), SIZE, VIEWPORT, true).left).toBe(VIEWPORT.width - MARGIN - SIZE.width);
  });

  it('gives whole pixels, so a rectangle is the same in every engine', () => {
    const where = place(trigger(500.4, 100.3, 23.6, 24.2), { width: 200.4, height: 120.5 }, VIEWPORT);
    expect(Number.isInteger(where.left)).toBe(true);
    expect(Number.isInteger(where.top)).toBe(true);
  });
});
