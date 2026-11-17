// What a roving group does to the DOM it holds, as functions of an element. The mock does the same (core.js, "roving focus"): the group
// acts on whatever buttons and links it holds, so any part, or plain markup, can be a member without knowing about the group.

/** The attribute a group carries, and the selector that finds the nearest one. */
export const GROUP = '[data-ov-roving]';

/** The elements a group moves between: buttons and links, and anything that says it is an item. */
const ITEM = 'button, a[href], [role="button"], [role="link"], [role="checkbox"], [role="switch"], [data-roving-item]';
/** What roves on its own: an item inside one of these, inside the group, belongs to it and not to the group. */
const BOUNDARY = '[popover], [role="menu"], [role="radiogroup"]';
const CURRENT = '[aria-current]:not([aria-current="false"]), [aria-selected="true"], [aria-pressed="true"]';
const CHECKED = '[aria-checked="true"]';

/** The items of a group in document order: not disabled, not hidden, not inside a nested group or a menu, radio group or popover of its own. */
export function rovingItems(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(ITEM)].filter((element) => {
    const boundary = element.closest(BOUNDARY);
    return element.closest(GROUP) === host && !element.matches(':disabled, [hidden]') && (boundary === null || boundary === host || !host.contains(boundary));
  });
}

/**
 * Which item is the tab stop: the one that last had the focus while it is still an item, else the first that is pressed, current or
 * selected (a selected row beats a switch that is on inside another row), else the first that is checked, else the first.
 */
export function stopIndex(items: readonly HTMLElement[], remembered: number | null): number {
  if (remembered !== null && remembered < items.length) {
    return remembered;
  }

  const current = items.findIndex((item) => item.matches(CURRENT));
  if (current >= 0) {
    return current;
  }

  return Math.max(0, items.findIndex((item) => item.matches(CHECKED)));
}

/** Exactly one item in the tab order. An item that already says what it should is not written to, so an unchanged render writes nothing. */
export function applyStop(items: readonly HTMLElement[], at: number): void {
  items.forEach((item, index) => {
    const want = index === at ? '0' : '-1';
    if (item.getAttribute('tabindex') !== want) {
      item.setAttribute('tabindex', want);
    }
  });
}

/** Puts the tab stop of a group where it belongs now. */
export function settle(host: HTMLElement, remembered: number | null): void {
  const items = rovingItems(host);
  applyStop(items, stopIndex(items, remembered));
}
