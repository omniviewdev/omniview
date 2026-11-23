import { describe, expect, it } from 'vitest';
import { PICKER, placePicker } from './place';

// jsdom has no layout, so where the popup stands is decided here, by numbers: the component measures the face and the popup once and asks.

const WINDOW = { width: 1440, height: 900 };
const POPUP = { width: 320, height: 200 };

/** A face the size of a lane's: `width` wide and 28 px high, its top left corner at (left, top). */
const face = (left: number, top: number, width = 120) => ({ left, top, right: left + width, bottom: top + 28 });

describe('placePicker', () => {
  it('has the numbers of the design: 4 px under the face, 8 px from the window, at most 360 px tall', () => {
    expect(PICKER).toEqual({ gap: 4, margin: 8, height: 360 });
  });

  it('stands under the face, its left edge on the face\'s and 4 px between them', () => {
    expect(placePicker(face(12, 56), POPUP, WINDOW)).toEqual({ side: 'below', left: 12, edge: 56 + 28 + 4, maxHeight: 360 });
  });

  it('stays below while it fits to the pixel, and goes above the face when one pixel less would not fit', () => {
    // The face's bottom is at 128, so 300 px under it need a window at least 128 + 4 + 300 + 8 = 440 tall.
    expect(placePicker(face(12, 100), { width: 320, height: 300 }, { width: 1440, height: 440 }).side).toBe('below');
    // The face's bottom is at 628: 1000 - 8 - 632 = 360 px under it hold the 300 asked for; in a window 939 tall there are 299, and it goes above the face (600 - 4 - 8 = 588 px there).
    expect(placePicker(face(12, 600), { width: 320, height: 300 }, { width: 1440, height: 1000 }).side).toBe('below');
    expect(placePicker(face(12, 600), { width: 320, height: 300 }, { width: 1440, height: 939 }).side).toBe('above');
  });

  it('goes above the face when it does not fit below and does fit above, and hangs from its bottom edge there', () => {
    // The face is at 800 to 828 in a window 900 tall: 60 px under it, 788 above it.
    const placed = placePicker(face(12, 800), POPUP, WINDOW);

    expect(placed).toEqual({ side: 'above', left: 12, edge: 900 - (800 - 4), maxHeight: 360 });
    // The popup's bottom edge is 796 px from the top of the window, 4 px over the face, whatever its height is: it grows away from the face, and a shorter list stays against it.
    expect(WINDOW.height - placed.edge).toBe(796);
  });

  it('keeps to the side with more room, and is held to that room, when it fits on neither', () => {
    const short = { width: 1440, height: 400 };
    const tall = { width: 320, height: 360 };

    // 210 px under the face (178 + 4 and 8 from the bottom), 138 above it.
    expect(placePicker(face(12, 150), tall, short)).toEqual({ side: 'below', left: 12, edge: 182, maxHeight: 210 });
    // 110 px under the face, 238 above it.
    expect(placePicker(face(12, 250), tall, short)).toEqual({ side: 'above', left: 12, edge: 400 - (250 - 4), maxHeight: 238 });
  });

  it('never takes more than 360 px, however much room there is, and never more than the room', () => {
    expect(placePicker(face(12, 56), POPUP, { width: 1440, height: 5000 }).maxHeight).toBe(360);
    expect(placePicker(face(12, 56), POPUP, { width: 1440, height: 400 }).maxHeight).toBe(400 - 8 - (84 + 4));
  });

  it('is held to nothing, never to less, in a window with no room at all', () => {
    expect(placePicker(face(12, 2), POPUP, { width: 1440, height: 20 }).maxHeight).toBe(0);
  });

  it('moves left just far enough to keep the whole popup 8 px inside the right edge of the window', () => {
    expect(placePicker(face(1400, 56, 30), POPUP, WINDOW).left).toBe(1440 - 8 - 320);
    // It fits where the face is: it does not move.
    expect(placePicker(face(1100, 56), POPUP, WINDOW).left).toBe(1100);
    expect(placePicker(face(1112, 56), POPUP, WINDOW).left).toBe(1112);
    expect(placePicker(face(1113, 56), POPUP, WINDOW).left).toBe(1112);
  });

  it('keeps 8 px from the left edge of the window, and does so too when the popup is wider than the window', () => {
    expect(placePicker(face(2, 56), POPUP, WINDOW).left).toBe(8);
    expect(placePicker(face(-30, 56), POPUP, WINDOW).left).toBe(8);
    expect(placePicker(face(100, 56), { width: 500, height: 100 }, { width: 400, height: 900 }).left).toBe(8);
  });

  it('gives whole pixels, so a rectangle is the same in every engine', () => {
    const placed = placePicker({ left: 12.4, top: 56.2, right: 132.4, bottom: 84.6 }, POPUP, WINDOW);

    expect(placed.left).toBe(12);
    expect(placed.edge).toBe(89);
    expect(placePicker({ left: 12, top: 100.6, right: 100, bottom: 128.6 }, { width: 320, height: 900 }, { width: 1440, height: 400 }).maxHeight).toBe(Math.floor(400 - 8 - 132.6));
  });
});
