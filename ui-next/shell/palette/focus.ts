import { focusPage } from '../panel/focus';

// Where the focus goes when the palette closes (ch05 "Escape closes command search and restores invoker"; ch16 S144). The palette takes the keyboard when it opens, so the element that had it is
// remembered at that moment and given it back when the palette closes. When that element is gone (a tab a command closed, a control that was removed) or cannot take the focus, the page takes
// it: an action never leaves the focus on the body. The Search control focuses itself when it is pressed (a Mac browser does not focus a button it was clicked on), so the element that
// opened the palette is the one that had the focus in every engine. A focus that was sent somewhere while the palette closed (a command that opens the panel puts it there) stays where it was sent.

export type Remembered = { readonly element: HTMLElement | null };

/** What has the focus now, if it is an element the user can come back to: not the body, which is where the focus is when nothing has it. */
export function rememberFocus(): Remembered {
  const { activeElement } = document;
  return { element: activeElement instanceof HTMLElement && activeElement !== document.body && activeElement !== document.documentElement ? activeElement : null };
}

/**
 * Gives the focus back to the remembered element, or to the page when it cannot take it. It acts only on a focus that is lost, on the body: a dialog that leaves takes its own focus with it, and
 * what is left is nothing. When something already holds the focus, someone sent it there while the palette closed, and the user is meant to be there.
 */
export function restoreFocus({ element }: Remembered): void {
  const { activeElement } = document;
  if (activeElement !== null && activeElement !== document.body && activeElement !== document.documentElement) {
    return;
  }

  if (element?.isConnected === true) {
    element.focus({ preventScroll: true });
    if (document.activeElement === element) {
      return;
    }
  }

  focusPage();
}
