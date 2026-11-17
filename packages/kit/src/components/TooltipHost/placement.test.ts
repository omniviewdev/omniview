import { describe, expect, it } from 'vitest';
import { GAP, MARGIN, place, type Box } from './placement';

const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height, right: left + width, bottom: top + height });
const VIEWPORT = { width: 1440, height: 900 };
const TIP = { width: 120, height: 34 };

describe('place', () => {
  it('puts the tooltip below its trigger, centred, 8 px away (design 12, the tooltip host: "Below, then above, then right, then left")', () => {
    const result = place(box(400, 300, 100, 28), TIP, VIEWPORT);
    expect(result).toMatchObject({ side: 'bottom', left: 390, top: 336 });
    expect(GAP).toBe(8);
    expect(MARGIN).toBe(8);
  });

  it('goes above when there is no room below, and takes the first side with room', () => {
    expect(place(box(400, 860, 100, 28), TIP, VIEWPORT)).toMatchObject({ side: 'top', top: 860 - GAP - TIP.height });
    // Room below is exactly the height: 900 - 8 (margin) - 8 (gap) - (900 - 8 - 8 - 34 = 850) = 34, so it still fits below.
    expect(place(box(400, 822, 100, 28), TIP, VIEWPORT).side).toBe('bottom');
    expect(place(box(400, 823, 100, 28), TIP, VIEWPORT).side).toBe('top');
  });

  it('goes to the right, then the left, when neither above nor below has room', () => {
    const tall = { width: 120, height: 400 };
    expect(place(box(100, 300, 100, 300), tall, { width: 1440, height: 500 })).toMatchObject({ side: 'right', left: 208 });
    expect(place(box(1200, 100, 100, 300), tall, { width: 1440, height: 500 }).side).toBe('right');
    expect(place(box(1300, 100, 120, 300), { width: 160, height: 400 }, { width: 1440, height: 500 })).toMatchObject({ side: 'left', left: 1300 - GAP - 160 });
  });

  it('keeps the cross axis 8 px inside the viewport', () => {
    expect(place(box(2, 300, 20, 28), TIP, VIEWPORT).left).toBe(MARGIN);
    expect(place(box(1430, 300, 8, 28), TIP, VIEWPORT).left).toBe(1440 - MARGIN - TIP.width);
    expect(place(box(0, 0, 28, 28), TIP, VIEWPORT).top).toBe(36);
  });

  it('rounds to whole pixels, as the mock does, so a rectangle is the same in every engine', () => {
    const result = place(box(400.4, 300.2, 101, 27.6), { width: 121, height: 34 }, VIEWPORT);
    expect(Number.isInteger(result.left)).toBe(true);
    expect(Number.isInteger(result.top)).toBe(true);
    expect(result.left).toBe(Math.round(400.4 + (101 - 121) / 2));
    expect(result.top).toBe(Math.round(300.2 + 27.6 + GAP));
  });

  it('never covers its trigger on the side it chose', () => {
    for (const anchor of [box(400, 300, 100, 28), box(400, 860, 100, 28), box(10, 300, 60, 28), box(1380, 300, 60, 28)]) {
      const result = place(anchor, TIP, VIEWPORT);
      const rect = box(result.left, result.top, TIP.width, result.maxHeight ?? TIP.height);
      const overlaps = rect.left < anchor.right && rect.right > anchor.left && rect.top < anchor.bottom && rect.bottom > anchor.top;
      expect(overlaps, JSON.stringify({ anchor, result })).toBe(false);
    }
  });

  it('never covers its trigger when no side has room: a vertical side with a limited height, not a clamped horizontal one', () => {
    // 600 x 400 window, a trigger at (250, 180) of 100 x 28, a tip of 280 x 300: below has 176, above 164, right and left 234 (less than 280).
    const anchor = box(250, 180, 100, 28);
    const result = place(anchor, { width: 280, height: 300 }, { width: 600, height: 400 });
    expect(result.side).toBe('bottom');
    expect(result.maxHeight).toBe(176);
    const rect = box(result.left, result.top, 280, result.maxHeight ?? 300);
    const overlaps = rect.left < anchor.right && rect.right > anchor.left && rect.top < anchor.bottom && rect.bottom > anchor.top;
    expect(overlaps, JSON.stringify(result)).toBe(false);
    expect(place(box(250, 200, 100, 28), { width: 280, height: 300 }, { width: 600, height: 400 }).side).toBe('top');
  });

  it('cuts a tip taller than the window to the window when it goes beside the trigger, and keeps it inside', () => {
    const result = place(box(720, 400, 60, 28), { width: 300, height: 1218 }, VIEWPORT);
    expect(result.side).toBe('right');
    expect(result.maxHeight).toBe(900 - 2 * MARGIN);
    expect(result.top).toBe(MARGIN);
    expect(result.top + (result.maxHeight ?? 0)).toBe(900 - MARGIN);
  });

  it('takes the side with the most room when none fits, and limits the height to it', () => {
    const huge = { width: 280, height: 700 };
    const result = place(box(400, 300, 100, 28), huge, { width: 1440, height: 800 });
    // Below: 800 - 16 - 328 = 456; above: 300 - 16 = 284; right: 1440 - 16 - 500 = 924 >= 280 fits, so the right side wins.
    expect(result.side).toBe('right');
    const squeezed = place(box(100, 300, 1200, 28), { width: 280, height: 700 }, { width: 1440, height: 800 });
    expect(squeezed.side).toBe('bottom');
    expect(squeezed.maxHeight).toBe(800 - MARGIN - GAP - 328);
    expect(squeezed.top).toBe(336);
  });

  it('leaves max-height alone when the tooltip fits', () => {
    expect(place(box(400, 300, 100, 28), TIP, VIEWPORT).maxHeight).toBeUndefined();
  });

  it('puts a tooltip wider than the viewport at the left margin', () => {
    expect(place(box(100, 300, 20, 28), { width: 600, height: 34 }, { width: 400, height: 900 }).left).toBe(MARGIN);
  });
});
