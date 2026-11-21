import { describe, expect, it, vi } from 'vitest';
import { decide, HOME, PLACE, samePlace, WIDTHS, type Box, type Control, type Place, type Situation } from './placement';

// Where the stack stands (the mock's rule, shell-notify.js P7: home, where it stands, the nearest clear spot at 420 to 240 px, yield). A 1440 x 900 window: home is the box 1008..1428 wide, its bottom at 856 (12 px
// from the right edge, 44 above the bottom: the 32 px status bar and 12 px), and one toast is 86 px tall (a failure with its Retry, as the mock draws it).

const control = (box: Box, reached = true): Control => ({ box, reached: () => reached });
const at = (left: number, top: number, right: number, bottom: number, reached = true): Control => control({ left, top, right, bottom }, reached);

const situation = (over: Partial<Situation> = {}): Situation => ({
  controls: [],
  viewport: 1440,
  home: { right: 1428, bottom: 856, width: 420 },
  count: 1,
  height: 86,
  current: HOME,
  ...over,
});

describe('home', () => {
  it('is where an empty page leaves the stack', () => {
    expect(decide(situation())).toBe(HOME);
  });

  it('is where an empty stack is, whatever the page: there is nothing to place', () => {
    expect(decide(situation({ count: 0, controls: [at(1000, 780, 1400, 840)] }))).toBe(HOME);
  });

  it('is kept while the nearest control is exactly 4 px from the stack, and lost when it is nearer', () => {
    // The stack's top is 856 - 86 = 770: a control that ends at 766 is 4 px above it, and one that ends at 767 is 3.
    expect(decide(situation({ controls: [at(1100, 700, 1300, 766)] }))).toBe(HOME);
    expect(decide(situation({ controls: [at(1100, 700, 1300, 767)] }))).not.toBe(HOME);
  });

  it('is kept beside a control that is just as far: the sides count as the top does', () => {
    // A control to the left of the stack: its right edge at 1004 is 4 px from the stack's left, at 1008.
    expect(decide(situation({ controls: [at(900, 780, 1004, 840)] }))).toBe(HOME);
    expect(decide(situation({ controls: [at(900, 780, 1005, 840)] }))).not.toBe(HOME);
  });

  it('is not left for a control that does not answer at its centre: one clipped by a scroll area is not in the way', () => {
    expect(decide(situation({ controls: [at(1100, 780, 1300, 840, false)] }))).toBe(HOME);
  });

  it('asks the browser about no control while none is near: the common case costs no hit test', () => {
    const far = vi.fn(() => true);
    expect(decide(situation({ controls: [{ box: { left: 0, top: 0, right: 100, bottom: 40 }, reached: far }] }))).toBe(HOME);
    expect(far).not.toHaveBeenCalled();
  });

  it('asks about the control that is near, before it leaves home for it', () => {
    const near = vi.fn(() => true);
    expect(decide(situation({ controls: [{ box: { left: 1100, top: 780, right: 1300, bottom: 840 }, reached: near }] }))).not.toBe(HOME);
    expect(near).toHaveBeenCalled();
  });

  it('is the box of the natural height: a stack that stands narrower, and so is taller, leaves it when home is clear', () => {
    // The stack stands 280 wide, where it wraps two lines a toast: 86 + 2 x 16 = 118 tall. At home it is 86, its top 770; this control ends at 756, 10 px above that top and 14 px under the top of the taller box.
    const stands: Place = { mode: 'moved', x: 300, y: 738, w: 280 };
    expect(decide(situation({ current: stands, height: 118, controls: [at(1100, 700, 1300, 756)] }))).toBe(HOME);
  });
});

describe('where it stands', () => {
  const blocker = at(1100, 780, 1300, 808);

  it('goes to the nearest clear spot by distance from home: above the control, in the same column, 8 px clear of it', () => {
    // The control spans 780..808, so the gap above it ends at 780 - 8 = 772; the stack is 86 tall and its top is 686.
    expect(decide(situation({ controls: [blocker] }))).toEqual({ mode: 'moved', x: 1008, y: 686, w: 420 });
  });

  it('stays where it is while that spot is clear, though another is nearer to home', () => {
    const stands: Place = { mode: 'moved', x: 672, y: 770, w: 420 };
    expect(decide(situation({ controls: [blocker], current: stands }))).toBe(stands);
  });

  it('goes back home as soon as home is clear', () => {
    const stands: Place = { mode: 'moved', x: 1008, y: 686, w: 420 };
    expect(decide(situation({ controls: [], current: stands }))).toBe(HOME);
  });

  it('leaves where it stands when a control comes near it', () => {
    const stands: Place = { mode: 'moved', x: 1008, y: 686, w: 420 };
    const next = decide(situation({ controls: [blocker, at(1050, 600, 1200, 684)], current: stands }));
    expect(next.mode).toBe('moved');
    expect(next).not.toEqual(stands);
  });

  it('comes back from yield as soon as there is a spot, and home as soon as it is clear', () => {
    expect(decide(situation({ controls: [blocker], current: { mode: 'yield' } }))).toEqual({ mode: 'moved', x: 1008, y: 686, w: 420 });
    expect(decide(situation({ controls: [], current: { mode: 'yield' } }))).toBe(HOME);
  });

  it('stands 8 px clear of the control beside it, whatever the distance to home is', () => {
    // A column of controls from the top to 800 on the right: the nearest spot is beside it, its right edge 8 px from the control's left (1000 - 8 = 992, 420 wide: 572).
    expect(decide(situation({ controls: [at(1000, 0, 1440, 800)] }))).toEqual({ mode: 'moved', x: 572, y: 770, w: 420 });
  });

  it('yields when a control covers the window: nothing is clear at any width', () => {
    expect(decide(situation({ controls: [at(0, 0, 1440, 900)] }))).toEqual({ mode: 'yield' });
  });

  it('has the margins the rule says', () => {
    expect(PLACE).toEqual({ pad: 4, gap: 8, top: 8, edge: 12 });
  });
});

describe('narrower', () => {
  // A window 800 wide: home is 368..788. Two walls leave the column 208..512 (8 px from each wall): 304 px, so 280 fits and 320 does not.
  const walls = [at(12, 0, 200, 900), at(520, 0, 788, 900)];
  const narrow = (over: Partial<Situation> = {}) => situation({ viewport: 800, home: { right: 788, bottom: 856, width: 420 }, controls: walls, ...over });

  it('tries the widths in order, and takes the widest that has a spot: here 280, nearest to home at 232, and its stack is taller (it wraps two lines a toast)', () => {
    expect(decide(narrow())).toEqual({ mode: 'moved', x: 232, y: 856 - (86 + 32), w: 280 });
  });

  it('counts the lines of every toast: three toasts are three times as much taller', () => {
    expect(decide(narrow({ count: 3, height: 3 * 86 + 16 }))).toEqual({ mode: 'moved', x: 232, y: 856 - (3 * 86 + 16 + 3 * 32), w: 280 });
  });

  it('yields when no width has a spot: the gap is 160 px wide and the narrowest stack is 240', () => {
    expect(decide(narrow({ controls: [at(12, 0, 200, 900), at(376, 0, 788, 900)] }))).toEqual({ mode: 'yield' });
  });

  it('has the widths the rule says', () => {
    expect(WIDTHS).toEqual([420, 360, 320, 280, 240]);
  });

  it('yields in a window narrower than home when a control covers it: home is 300 wide there (the window less 12 px at each side) and nothing wider is tried', () => {
    const covered = situation({ viewport: 324, home: { right: 312, bottom: 856, width: 300 }, controls: [at(0, 0, 324, 900)] });
    expect(decide(covered)).toEqual({ mode: 'yield' });
  });
});

describe('samePlace', () => {
  it('compares what stands, member for member', () => {
    expect(samePlace(HOME, { mode: 'default' })).toBe(true);
    expect(samePlace({ mode: 'yield' }, { mode: 'yield' })).toBe(true);
    expect(samePlace({ mode: 'moved', x: 1, y: 2, w: 3 }, { mode: 'moved', x: 1, y: 2, w: 3 })).toBe(true);
    expect(samePlace({ mode: 'moved', x: 1, y: 2, w: 3 }, { mode: 'moved', x: 1, y: 2, w: 4 })).toBe(false);
    expect(samePlace(HOME, { mode: 'yield' })).toBe(false);
    expect(samePlace({ mode: 'moved', x: 1, y: 2, w: 3 }, HOME)).toBe(false);
  });
});
