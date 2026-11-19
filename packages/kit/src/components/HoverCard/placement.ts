/** The space between the anchor of a card and the card, in pixels. The stylesheet's hover bridge is this plus the border (`HoverCard.module.css`). */
export const GAP = 8;
/** The space kept between a card and the edge of the window, in pixels. */
export const MARGIN = 8;

export type Side = 'bottom' | 'top';

export type Box = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly width: number; readonly height: number };
export type Size = { readonly width: number; readonly height: number };

export type Placement = {
  readonly side: Side;
  /** Whole pixels, so a rectangle is the same in every engine. */
  readonly left: number;
  readonly top: number;
  /** Set only when neither side has room for the whole height: the card is limited to the room of the side chosen, and its body scrolls. */
  readonly maxHeight: number | undefined;
};

/**
 * Where a card of `size` goes against `anchor` inside `viewport`: below it when there is room for the whole card, else above it, else on
 * the side with more room (below on a tie), with its height limited to that room. It starts at the left edge of the anchor and is kept
 * `MARGIN` inside the window on that axis; it is `GAP` away from the anchor on the other, so it never covers it. The mock's `placeCard`
 * (shell-panel.js), except that a card with no room on either side is cut to the room there is, where the mock slid it over its trigger.
 * Unlike the tooltip's, a card is not centred on its anchor: it hangs from the anchor's start, as a menu does.
 */
export function place(anchor: Box, size: Size, viewport: Size): Placement {
  const below = viewport.height - MARGIN - GAP - anchor.bottom;
  const above = anchor.top - GAP - MARGIN;
  const side: Side = below >= size.height ? 'bottom' : above >= size.height ? 'top' : below >= above ? 'bottom' : 'top';
  const room = side === 'bottom' ? below : above;
  const height = Math.max(0, Math.min(size.height, room));
  const y = side === 'bottom' ? anchor.bottom + GAP : anchor.top - GAP - height;

  return {
    side,
    left: Math.round(Math.max(MARGIN, Math.min(anchor.left, viewport.width - MARGIN - size.width))),
    top: Math.round(Math.max(MARGIN, Math.min(y, viewport.height - MARGIN - height))),
    maxHeight: height < size.height ? height : undefined,
  };
}
