import { describe, expect, it } from 'vitest';
import { GAP, MARGIN, place, type Box } from './placement';

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height, right: left + width, bottom: top + height });
const VIEWPORT = { width: 1440, height: 900 };
const CARD = { width: 300, height: 180 };

const overlaps = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('place', () => {
  it('puts the card below its anchor, from the anchor\'s left edge, 8 px away (16 SCD1: below first)', () => {
    const result = place(box(400, 300, 120, 28), CARD, VIEWPORT);
    expect(result).toEqual({ side: 'bottom', left: 400, top: 300 + 28 + GAP, maxHeight: undefined });
    expect(GAP).toBe(8);
    expect(MARGIN).toBe(8);
  });

  it('is not centred on the anchor: a wide anchor and a narrow one both give the card their start', () => {
    expect(place(box(400, 300, 20, 28), CARD, VIEWPORT).left).toBe(400);
    expect(place(box(400, 300, 600, 28), CARD, VIEWPORT).left).toBe(400);
  });

  it('goes above when there is no room below, and takes the first side with room', () => {
    // Room below is 900 - 8 (margin) - 8 (gap) - bottom; it equals the height of 180 at bottom = 704, and one pixel more sends the card above.
    expect(place(box(400, 676, 120, 28), CARD, VIEWPORT).side).toBe('bottom');
    expect(place(box(400, 677, 120, 28), CARD, VIEWPORT)).toEqual({ side: 'top', left: 400, top: 677 - GAP - CARD.height, maxHeight: undefined });
  });

  it('stays below while it fits there: the room above has no say until below fails', () => {
    expect(place(box(400, 400, 120, 28), CARD, VIEWPORT).side).toBe('bottom');
    expect(place(box(400, 400, 120, 28), CARD, { width: 1440, height: 700 })).toMatchObject({ side: 'bottom', top: 436 });
  });

  it('takes the side with more room when neither fits, below on a tie, and limits its height to that room', () => {
    const tall = { width: 300, height: 360 };
    const viewport = { width: 600, height: 400 };
    // Anchor at (250, 150), 100 x 28: below has 400 - 16 - 178 = 206, above 150 - 16 = 134. The card is cut to 206 and ends at the bottom margin.
    expect(place(box(250, 150, 100, 28), tall, viewport)).toEqual({ side: 'bottom', left: 250, top: 186, maxHeight: 206 });
    // Anchor at (250, 250): below has 400 - 16 - 278 = 106, above 250 - 16 = 234. The card is cut to 234 and starts at the top margin.
    expect(place(box(250, 250, 100, 28), tall, viewport)).toEqual({ side: 'top', left: 250, top: MARGIN, maxHeight: 234 });
    // Anchor at (250, 160), 100 x 80: below has 400 - 16 - 240 = 144 and above 160 - 16 = 144. A tie is below.
    expect(place(box(250, 160, 100, 80), tall, viewport)).toEqual({ side: 'bottom', left: 250, top: 248, maxHeight: 144 });
  });

  it('never covers its anchor, on the side it chose, whether or not it had to be cut', () => {
    const anchors = [box(400, 300, 100, 28), box(400, 860, 100, 28), box(10, 20, 60, 28), box(1380, 700, 60, 28), box(0, 0, 28, 28), box(250, 150, 100, 28), box(250, 250, 100, 28)];
    const sizes = [CARD, { width: 300, height: 360 }, { width: 336, height: 880 }];
    for (const anchor of anchors) {
      for (const size of sizes) {
        for (const viewport of [VIEWPORT, { width: 600, height: 400 }]) {
          const result = place(anchor, size, viewport);
          const card = box(result.left, result.top, size.width, result.maxHeight ?? size.height);
          expect(overlaps(card, anchor), JSON.stringify({ anchor, size, viewport, result })).toBe(false);
        }
      }
    }
  });

  it('keeps the left edge 8 px inside the window on both sides', () => {
    expect(place(box(2, 300, 20, 28), CARD, VIEWPORT).left).toBe(MARGIN);
    expect(place(box(1430, 300, 8, 28), CARD, VIEWPORT).left).toBe(1440 - MARGIN - CARD.width);
    // The right-most left edge is 1440 - 8 - 300 = 1132.
    expect(place(box(1131, 300, 20, 28), CARD, VIEWPORT).left).toBe(1131);
    expect(place(box(1132, 300, 20, 28), CARD, VIEWPORT).left).toBe(1132);
    expect(place(box(1133, 300, 20, 28), CARD, VIEWPORT).left).toBe(1132);
  });

  it('puts a card wider than the window at the left margin', () => {
    expect(place(box(100, 300, 20, 28), { width: 600, height: 100 }, { width: 400, height: 900 }).left).toBe(MARGIN);
  });

  it('rounds to whole pixels, as the mock does, so a rectangle is the same in every engine', () => {
    const result = place(box(400.4, 300.2, 101, 27.6), { width: 121, height: 34 }, VIEWPORT);
    expect(Number.isInteger(result.left)).toBe(true);
    expect(Number.isInteger(result.top)).toBe(true);
    expect(result.left).toBe(400);
    expect(result.top).toBe(Math.round(300.2 + 27.6 + GAP));
    expect(place(box(1131.6, 300, 20, 28), CARD, VIEWPORT).left).toBe(1132);
  });

  it('cuts a card taller than the window to the room below an anchor at the top of it, so that it ends at the bottom margin', () => {
    const result = place(box(100, 4, 60, 4), { width: 200, height: 880 }, VIEWPORT);
    expect(result).toEqual({ side: 'bottom', left: 100, top: 16, maxHeight: 876 });
    expect(result.top + 876).toBe(900 - MARGIN);
  });

  it('leaves the card alone when it fits: no height limit', () => {
    expect(place(box(400, 300, 100, 28), CARD, VIEWPORT).maxHeight).toBeUndefined();
    expect(place(box(400, 860, 100, 28), CARD, VIEWPORT).maxHeight).toBeUndefined();
  });

  it('has no side beside the anchor: a card is below or above it, never to the right or left', () => {
    const sides = new Set<string>();
    for (const left of [0, 400, 1400]) {
      for (const top of [0, 300, 880]) {
        sides.add(place(box(left, top, 40, 20), CARD, VIEWPORT).side);
      }
    }

    expect([...sides].sort()).toEqual(['bottom', 'top']);
  });

  it('gives no negative height and no inverted range for a window with no room at all', () => {
    const result = place(box(10, 10, 20, 20), { width: 100, height: 100 }, { width: 200, height: 30 });
    expect(result.maxHeight).toBe(0);
    expect(result.top).toBeGreaterThanOrEqual(MARGIN);
  });
});
