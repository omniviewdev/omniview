// What a key does in a strip of tabs that is one tab stop, as a function of the key and where the focus is (ch16 S53, S54; the strip of the top row, and the panel's tool and session
// strips). Framework-free: the DOM adapter (../tablist.ts) reads the event and moves the focus.

/** Where a key sends the focus (an index into the strip), where it asks the tab to go, or asks to close the tab it is on. */
export type TablistKey = { readonly to: number } | { readonly move: number } | { readonly close: true };

/**
 * The answer for one key: arrows move the focus and never select (the tab is the button's own click, so Enter and Space select it), and wrap; Home and End go to the ends; Delete and
 * Backspace close the tab when `closable`. `at` is the index of the tab the key was pressed on. With `moving` (Alt and Shift held, ch16 S45) the same four keys ask the tab to move to that
 * place instead: the arrows do not wrap, and Delete and Backspace are nothing. A key that is not the strip's, and any key in an empty strip, has no answer.
 */
export function tablistKey(key: string, at: number, count: number, rtl: boolean, closable: boolean, moving = false): TablistKey | undefined {
  if (count === 0) {
    return undefined;
  }

  const go = (to: number): TablistKey => (moving ? { move: to } : { to });
  switch (key) {
    case 'ArrowRight':
    case 'ArrowLeft': {
      const step = (key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1);
      return go(moving ? Math.min(Math.max(at + step, 0), count - 1) : (at + step + count) % count);
    }

    case 'Home':
      return go(0);
    case 'End':
      return go(count - 1);
    case 'Delete':
    case 'Backspace':
      return closable && !moving ? { close: true } : undefined;
    default:
      return undefined;
  }
}
