/** The space between a trigger and its menu, in pixels (the mock's menu, `shell-menu.js` GAP, and the old host menu's `sideOffset`). */
export const GAP = 4;
/** The space kept between a menu and the edge of the window, in pixels. */
export const MARGIN = 4;

export type Box = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly width: number; readonly height: number };
export type Size = { readonly width: number; readonly height: number };

export type Placement = {
  /** The side of the trigger the menu is on. */
  readonly side: 'bottom' | 'top';
  /** Whole pixels, so a rectangle is the same in every engine. */
  readonly left: number;
  readonly top: number;
  /** Set only when the menu fits on neither side: it is limited to the room of the side chosen and scrolls inside. */
  readonly maxHeight: number | undefined;
};

/**
 * Where a menu of `size` goes around the trigger `anchor` inside `viewport`: below the trigger with its end edge on the trigger's end edge,
 * `GAP` away from it; above the trigger when it does not fit below and does fit above; on the side with more room, limited to that room,
 * when it fits on neither. It is kept `MARGIN` inside the window on every edge. `rtl` puts the end edge on the other side. Computed once, when
 * the menu opens: it never follows the trigger (a scroll or a resize closes the menu instead).
 */
export function place(anchor: Box, size: Size, viewport: Size, rtl = false): Placement {
  const below = viewport.height - MARGIN - (anchor.bottom + GAP);
  const above = anchor.top - GAP - MARGIN;
  const side = size.height <= below ? 'bottom' : size.height <= above ? 'top' : below >= above ? 'bottom' : 'top';
  const room = side === 'bottom' ? below : above;
  const height = Math.max(0, Math.min(size.height, room));
  const width = Math.min(size.width, viewport.width - 2 * MARGIN);
  const x = rtl ? anchor.left : anchor.right - width;
  const y = side === 'bottom' ? anchor.bottom + GAP : anchor.top - GAP - height;
  return {
    side,
    left: Math.round(Math.max(MARGIN, Math.min(x, viewport.width - MARGIN - width))),
    top: Math.round(Math.max(MARGIN, Math.min(y, viewport.height - MARGIN - height))),
    maxHeight: height < size.height ? height : undefined,
  };
}
