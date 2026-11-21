// What the notification centre asks of the document: where its popover stands, and the focus. Plain DOM functions, kept out of the components so that the one place that may throw (`showPopover` on an element that is
// open already) and the places that read geometry are here and tested here (`centreDom.test.ts`).

/** The width of the centre's popover (the mock's `data-size="wide"`, 420 px) and of its Filter menu. */
export const CENTRE_WIDTH = 420;

/** Where a popover that opens above its invoker stands: its left edge, the distance from the window's bottom to its bottom edge, and the most height it may take. */
export type Place = { readonly x: number; readonly bottom: number; readonly max: number };

/** Where a menu that opens below its invoker stands: its left edge, its top edge, and the most height it may take. */
export type Below = { readonly x: number; readonly top: number; readonly max: number };

/** The window's size as the document says it: what a popover is placed in. */
const viewport = (): { readonly width: number; readonly height: number } => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight });

/**
 * The mock's `placePopover` (shell-widgets.js), for an invoker at the bottom of the window: 4 px above it, its right edge on the invoker's when the invoker is in the right half (else its left edge), 8 px from the
 * window's sides at least, and no taller than the room above it less 12 px (never under 120 px).
 */
export function placeAbove(invoker: Element, width: number = CENTRE_WIDTH): Place {
  const { width: across, height: down } = viewport();
  const box = invoker.getBoundingClientRect();
  const wide = Math.min(width, across - 16);
  const edge = box.left + box.width / 2 > across / 2 ? box.right - wide : box.left;
  return { x: Math.round(Math.max(8, Math.min(edge, across - 8 - wide))), bottom: Math.round(down - box.top + 4), max: Math.max(120, Math.round(box.top - 12)) };
}

/** A menu below the button that opens it (the mock's menu, 'bottom-end'): 4 px under it, its right edge on the button's, kept 8 px inside the window, and no taller than the room under it less 12 px (never under 120 px). */
export function placeBelow(invoker: Element, width: number): Below {
  const { width: across, height: down } = viewport();
  const box = invoker.getBoundingClientRect();
  const wide = Math.min(width, across - 16);
  return { x: Math.round(Math.max(8, Math.min(box.right - wide, across - 8 - wide))), top: Math.round(box.bottom + 4), max: Math.max(120, Math.round(down - box.bottom - 12)) };
}

/** Puts a popover in the top layer. One that is open already (a development build mounts an effect twice) is left as it is. */
export function showPopover(element: HTMLElement): void {
  try {
    element.showPopover();
  } catch {
    // It is open already: nothing to do.
  }
}

/** The rows of a list, in order, and the part of a row the focus rests on. */
export const ROW = '[data-notices-part="row"]';
export const TOGGLE = '[data-notices-part="rowToggle"]';

export const rowsOf = (list: ParentNode): HTMLElement[] => [...list.querySelectorAll<HTMLElement>(ROW)];

export const idOf = (row: Element): string => row.getAttribute('data-notices-id') ?? '';

/** The row an element is in, or `null`. */
export const rowOf = (node: EventTarget | null): HTMLElement | null => (node instanceof Element ? node.closest<HTMLElement>(ROW) : null);

/**
 * Exactly one row's controls are tab stops: the current row's (its title, its buttons), and no other row's (the mock's `syncRoving`). A row is one stop of the list and Tab goes through its own controls and on; the
 * arrows move between rows. Writes only where an attribute differs, so a draw that changed nothing writes nothing.
 */
export function applyStop(rows: readonly HTMLElement[], current: string): void {
  for (const row of rows) {
    const stop = idOf(row) === current ? '0' : '-1';
    for (const control of row.querySelectorAll('button')) {
      if (control.getAttribute('tabindex') !== stop) {
        control.setAttribute('tabindex', stop);
      }
    }
  }
}

/** Gives the focus to the title of a row, which is where the list's stop is; the row is brought into view. */
export function focusRow(row: HTMLElement | undefined): boolean {
  const toggle = row?.querySelector<HTMLElement>(TOGGLE);
  if (toggle === null || toggle === undefined) {
    return false;
  }

  toggle.focus({ preventScroll: true });
  toggle.scrollIntoView?.({ block: 'nearest' });
  return document.activeElement === toggle;
}

/** The focus when the centre opens: the title of the newest row, where the list's stop is (the mock's `centerOpened`); with no row, the popover itself, which is a stop of its own so that the keyboard is inside it. */
export function focusInto(list: ParentNode | null, popover: HTMLElement): void {
  const [first] = list === null ? [] : rowsOf(list);
  if (!focusRow(first)) {
    popover.focus({ preventScroll: true });
  }
}
