// Where the focus goes when a sheet opens and when it closes, and what Tab does at the two ends of a sheet. The rule is the command palette's (`ui-next/shell/palette/focus.ts`: the element that had the
// focus is remembered when the dialog opens and given it back once the dialog has left, when the focus is lost), kept here because the kit imports nothing from the host. The one difference is the page:
// the kit cannot know it, so an element that is gone is given nothing back, and the caller decides where the focus goes then.

/** What has the focus now, if it is an element the user can come back to: not the body or the document element, which have it when nothing does. */
export function opener(doc: Document): HTMLElement | null {
  const { activeElement } = doc;
  return activeElement instanceof HTMLElement && activeElement !== doc.body && activeElement !== doc.documentElement ? activeElement : null;
}

/**
 * Gives the focus back to `element`, once the dialog has left and only if it is still in the document. It acts only on a focus that is lost, on the body or on nothing: a dialog that leaves takes its own
 * focus with it, and what is left is nothing. When something already holds the focus, someone sent it there while the sheet closed, and the user is meant to be there.
 */
export function restoreFocus(doc: Document, element: HTMLElement | null): void {
  const { activeElement } = doc;
  const lost = activeElement === null || activeElement === doc.body || activeElement === doc.documentElement;
  if (lost && element?.isConnected === true) {
    element.focus({ preventScroll: true });
  }
}

/** What Tab can stop on, before the layout is asked: links, buttons, fields, summaries, editable text and whatever has a tabindex. */
const CANDIDATES = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [contenteditable]:not([contenteditable="false"]), [tabindex]';

const candidates = (root: HTMLElement): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(CANDIDATES)];

/**
 * Whether Tab stops on `element` now: not disabled (a control unavailable for a reason, `aria-disabled`, is still a stop), not out of the order by a negative tabindex, not inert, and drawn: it has a box,
 * which `display: none` here or above takes away, and it is visible. The layout is asked here, when a key is pressed, and never while rendering.
 */
function stopsTab(element: HTMLElement): boolean {
  const index = element.getAttribute('tabindex');
  if (index !== null && Number.parseInt(index, 10) < 0) {
    return false;
  }

  if (element.matches(':disabled') || element.closest('[inert]') !== null) {
    return false;
  }

  return element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible';
}

/** The controls of `root` that Tab stops on, in document order. A positive tabindex is not a different order here: the sheet's controls are in the order of the markup. */
export function tabStops(root: HTMLElement): HTMLElement[] {
  return candidates(root).filter(stopsTab);
}

/**
 * Where Tab must send the focus instead of the browser, which would let it go to its own chrome or to the document: the first stop when Tab is pressed on the last, the last when Shift+Tab is pressed on the
 * first or on the dialog itself; `null` when the browser's own move stays inside. A focus outside `root` is never an end of it, so the page behind (inert, and not Tab's to take) is left to the browser. An end
 * is found from its own side, so a press asks the layout about the few controls it must and not about all of them.
 */
export function wrapTarget(root: HTMLElement, backwards: boolean): HTMLElement | null {
  const { activeElement } = root.ownerDocument;
  const found = candidates(root);
  if (backwards) {
    return activeElement === root || activeElement === found.find(stopsTab) ? (found.findLast(stopsTab) ?? null) : null;
  }

  return activeElement === found.findLast(stopsTab) ? (found.find(stopsTab) ?? null) : null;
}
