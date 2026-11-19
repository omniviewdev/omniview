import { describe, expect, it } from 'vitest';
import { tablistKey } from './tablist';

// The keyboard contract of a strip of tabs that is one tab stop (the shell's tab strip, S1b, and the panel's tool and session strips, P1a): arrows move the focus and select nothing, and
// wrap; Home and End go to the ends; Enter and Space are the button's own click; Delete and Backspace close a tab that can be closed. Written once here so that every strip of the shell is
// the same strip (the lead's rule for P1a: reuse, do not fork).

describe('the keys of a strip of tabs', () => {
  const key = (name: string, at = 1, count = 4, rtl = false, closable = true) => tablistKey(name, at, count, rtl, closable);

  it('arrows move to the next and the previous tab, and wrap at both ends', () => {
    expect(key('ArrowRight')).toEqual({ to: 2 });
    expect(key('ArrowLeft')).toEqual({ to: 0 });
    expect(key('ArrowRight', 3)).toEqual({ to: 0 });
    expect(key('ArrowLeft', 0)).toEqual({ to: 3 });
  });

  it('arrows are mirrored in a right-to-left strip', () => {
    expect(key('ArrowRight', 1, 4, true)).toEqual({ to: 0 });
    expect(key('ArrowLeft', 1, 4, true)).toEqual({ to: 2 });
  });

  it('Home goes to the first tab and End to the last', () => {
    expect(key('Home', 2)).toEqual({ to: 0 });
    expect(key('End', 1)).toEqual({ to: 3 });
  });

  it('Delete and Backspace close the tab, when it can be closed', () => {
    expect(key('Delete')).toEqual({ close: true });
    expect(key('Backspace')).toEqual({ close: true });
    expect(key('Delete', 1, 4, false, false)).toBeUndefined();
    expect(key('Backspace', 1, 4, false, false)).toBeUndefined();
  });

  it('leaves Enter, Space (the button\'s own click), the vertical arrows and every other key alone', () => {
    for (const other of ['Enter', ' ', 'ArrowUp', 'ArrowDown', 'Tab', 'a', 'Escape', 'PageUp']) {
      expect(key(other), other).toBeUndefined();
    }
  });

  it('has nowhere to go in a strip with no tab', () => {
    expect(key('ArrowRight', 0, 0)).toBeUndefined();
    expect(key('Home', 0, 0)).toBeUndefined();
    expect(key('Delete', 0, 0)).toBeUndefined();
  });

  it('a strip of one tab stays on it', () => {
    expect(key('ArrowRight', 0, 1)).toEqual({ to: 0 });
    expect(key('ArrowLeft', 0, 1)).toEqual({ to: 0 });
  });
});
