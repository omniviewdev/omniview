import { describe, expect, it } from 'vitest';
import { COLLAPSE_BELOW, collapses, defaultHeight, heightKey, limitsOf, resolveHeight } from './height';

// The size rules of the panel (ch16 section G, S99 to S103; the table "Bottom panel": default max(240, 30% of the window) at most 400, minimum 120, maximum the window minus 312).
// Ported from the mock's harness (tests/shell-model-harness/ShellStore/unit.cjs "persist: clamp on load and on resize" and ShellStore2-unit.cjs "layout paths persist per window
// and clamp on a smaller window"): the numbers 588, 388, 308 and 188 are theirs.

describe('the default height', () => {
  it('is 30% of the window, at least 240 and at most 400', () => {
    expect(defaultHeight(900)).toBe(270);
    expect(defaultHeight(800)).toBe(240);
    expect(defaultHeight(720)).toBe(240);
    expect(defaultHeight(1200)).toBe(360);
    expect(defaultHeight(1400)).toBe(400);
    expect(defaultHeight(2000)).toBe(400);
  });

  it('is not rounded: the stylesheet reads the same expression and a fraction of a pixel is the same fraction', () => {
    expect(defaultHeight(905)).toBe(271.5);
  });
});

describe('the limits', () => {
  it('are 120 at least and the window minus 312 at most', () => {
    expect(limitsOf(900)).toEqual({ min: 120, max: 588 });
    expect(limitsOf(700)).toEqual({ min: 120, max: 388 });
    expect(limitsOf(800)).toEqual({ min: 120, max: 488 });
  });

  it('never put the maximum below the minimum: a window too short for both gives the minimum, as the stylesheet\'s clamp does', () => {
    expect(limitsOf(400)).toEqual({ min: 120, max: 120 });
    expect(limitsOf(0)).toEqual({ min: 120, max: 120 });
  });
});

describe('the height that is drawn', () => {
  it('is the default while the user chose none', () => {
    expect(resolveHeight(null, 900)).toBe(270);
    expect(resolveHeight(null, 800)).toBe(240);
  });

  it('is what the user chose, within the limits of the window it is drawn in', () => {
    expect(resolveHeight(300, 900)).toBe(300);
    expect(resolveHeight(50, 900)).toBe(120);
    expect(resolveHeight(5000, 900)).toBe(588);
  });

  it('is clamped to the window it is drawn in, whatever the window: the same arithmetic as the stylesheet\'s clamp()', () => {
    expect(resolveHeight(500, 620)).toBe(308);
    expect(resolveHeight(500, 500)).toBe(188);
    expect(resolveHeight(5000, 700)).toBe(388);
    expect(resolveHeight(500, 1400)).toBe(500);
  });

  it('clamps the default too: a default of 240 in a window of 500 is 188', () => {
    expect(resolveHeight(null, 500)).toBe(188);
  });
});

describe('a release that collapses', () => {
  it('is below two thirds of the minimum: 80 px', () => {
    expect(COLLAPSE_BELOW).toBe(80);
    expect(collapses(79.9)).toBe(true);
    expect(collapses(80)).toBe(false);
    expect(collapses(0)).toBe(true);
    expect(collapses(120)).toBe(false);
  });
});

describe('the keys of the splitter (S102)', () => {
  const at = (key: string, shiftKey = false, current = 300, viewport = 900) => heightKey(current, viewport, key, shiftKey);

  it('arrows move 16 px, and Shift with an arrow, Page Up and Page Down 64: the handle moves up, so Up grows the panel', () => {
    expect(at('ArrowUp')).toEqual({ size: 316 });
    expect(at('ArrowDown')).toEqual({ size: 284 });
    expect(at('ArrowUp', true)).toEqual({ size: 364 });
    expect(at('ArrowDown', true)).toEqual({ size: 236 });
    expect(at('PageUp')).toEqual({ size: 364 });
    expect(at('PageDown')).toEqual({ size: 236 });
  });

  it('Home goes to the minimum and End to the maximum', () => {
    expect(at('Home')).toEqual({ size: 120 });
    expect(at('End')).toEqual({ size: 588 });
    expect(at('End', false, 300, 700)).toEqual({ size: 388 });
  });

  it('Enter resets to the default', () => {
    expect(at('Enter')).toEqual({ reset: true });
  });

  it('stops at the limits and collapses nothing: no key hides the panel', () => {
    expect(at('ArrowDown', false, 124)).toEqual({ size: 120 });
    expect(at('ArrowDown', false, 120)).toEqual({ size: 120 });
    expect(at('PageUp', false, 560)).toEqual({ size: 588 });
    expect(at('ArrowUp', false, 588)).toEqual({ size: 588 });
  });

  it('leaves every other key alone, and Shift with a key that has no large step', () => {
    expect(at('a')).toBeUndefined();
    expect(at('Tab')).toBeUndefined();
    expect(at('Home', true)).toBeUndefined();
    expect(at('End', true)).toBeUndefined();
    expect(at('Enter', true)).toBeUndefined();
    expect(at('PageUp', true)).toBeUndefined();
  });
});
