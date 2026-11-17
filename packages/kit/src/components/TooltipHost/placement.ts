/** The space between a trigger and its tooltip, in pixels. The stylesheet's hover bridge is this plus the border (`TooltipHost.module.css`). */
export const GAP = 8;
/** The space kept between a tooltip and the edge of the window, in pixels. */
export const MARGIN = 8;

export type Side = 'bottom' | 'top' | 'right' | 'left';
/** The first side with room wins (design 12, the tooltip host: "Below, then above, then right, then left"). */
const ORDER: readonly Side[] = ['bottom', 'top', 'right', 'left'];

export type Box = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly width: number; readonly height: number };
export type Size = { readonly width: number; readonly height: number };

export type Placement = {
  readonly side: Side;
  /** Whole pixels, so a rectangle is the same in every engine. */
  readonly left: number;
  readonly top: number;
  /** Set only when no side has room for the whole height: the tooltip is limited to the room of the side chosen. */
  readonly maxHeight: number | undefined;
};

/**
 * Where a tooltip of `size` goes around `anchor` inside `viewport`: on the first side that has room for it, centred on the anchor along
 * the other axis and kept `MARGIN` inside the window, `GAP` away from the anchor so it never covers it. When no side has room, above or
 * below, whichever has more, with the height limited to it. The mock's `place()` (core.js) otherwise; the mock's fallback could cover the trigger.
 */
export function place(anchor: Box, size: Size, viewport: Size): Placement {
  const room: Record<Side, number> = {
    bottom: viewport.height - MARGIN - GAP - anchor.bottom,
    top: anchor.top - GAP - MARGIN,
    right: viewport.width - MARGIN - GAP - anchor.right,
    left: anchor.left - GAP - MARGIN,
  };
  const fits = (side: Side) => room[side] >= (side === 'bottom' || side === 'top' ? size.height : size.width);
  // No side has room: the tooltip goes above or below, wherever there is more, and its height is limited to that room. A horizontal side
  // is never the fallback: the tooltip is taller than the room there, so clamping it into the window would slide it over the trigger.
  const side = ORDER.find(fits) ?? (room.bottom >= room.top ? 'bottom' : 'top');
  const vertical = side === 'bottom' || side === 'top';
  // Beside the trigger the height is limited by the window, not by the trigger: a tip taller than the window is cut to it, so it stays inside.
  const height = vertical ? Math.max(0, Math.min(size.height, room[side])) : Math.min(size.height, Math.max(0, viewport.height - 2 * MARGIN));

  let x: number;
  if (vertical) {
    x = anchor.left + (anchor.width - size.width) / 2;
  } else {
    x = side === 'right' ? anchor.right + GAP : anchor.left - GAP - size.width;
  }

  let y: number;
  if (vertical) {
    y = side === 'bottom' ? anchor.bottom + GAP : anchor.top - GAP - height;
  } else {
    y = anchor.top + (anchor.height - height) / 2;
  }

  return {
    side,
    left: Math.round(Math.max(MARGIN, Math.min(x, viewport.width - MARGIN - size.width))),
    top: Math.round(Math.max(MARGIN, Math.min(y, viewport.height - MARGIN - height))),
    maxHeight: height < size.height ? height : undefined,
  };
}
