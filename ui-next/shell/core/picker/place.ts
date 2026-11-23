// Where a scope picker's popup stands (HM1). Pure: the component measures the face and the popup once, when the popup opens, and asks; this decides. Nothing here reads a document or a style.
//
// Under the face with the two left edges aligned and 4 px between them; above the face when it does not fit below and does fit above; on the side with more room, held to that room, when it fits on neither; and never
// nearer than 8 px to an edge of the window. The popup is at most 360 px tall: what its list has more than that scrolls.

/** The space between the face and its popup, the space kept between the popup and the edge of the window, and the most height the popup takes, all in pixels. */
export const PICKER = { gap: 4, margin: 8, height: 360 } as const;

/** A rectangle in the window's coordinates, as `getBoundingClientRect` gives it. */
export type Box = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

export type Size = { readonly width: number; readonly height: number };

export type Placement = {
  /** The side of the face the popup is on. */
  readonly side: 'below' | 'above';
  /** The popup's left edge, in pixels from the left edge of the window. */
  readonly left: number;
  /**
   * Below: the popup's top edge, in pixels from the top edge of the window. Above: its BOTTOM edge, in pixels from the bottom edge of the window. A popup that is above hangs from the face, so it stays against it when its list gets
   * shorter (a filter narrows it) and grows away from it.
   */
  readonly edge: number;
  /** The most height the popup may take: 360 px, and never more than the room on its side, so a list that grows while the popup is open scrolls and does not leave the window. */
  readonly maxHeight: number;
};

/**
 * Where a popup of `size` goes for the face `anchor` in a window of `viewport`. `size` is what the popup measured when it was shown, which is its own height (at most 360 px) and the width its stylesheet gives it: the left
 * edge is the face's, moved just far enough to keep the whole popup 8 px inside the window.
 */
export function placePicker(anchor: Box, size: Size, viewport: Size): Placement {
  const below = viewport.height - PICKER.margin - (anchor.bottom + PICKER.gap);
  const above = anchor.top - PICKER.gap - PICKER.margin;
  const side = size.height <= below ? 'below' : size.height <= above ? 'above' : below >= above ? 'below' : 'above';
  const room = Math.max(0, side === 'below' ? below : above);
  return {
    side,
    left: Math.round(Math.max(PICKER.margin, Math.min(anchor.left, viewport.width - PICKER.margin - size.width))),
    edge: Math.round(side === 'below' ? anchor.bottom + PICKER.gap : viewport.height - (anchor.top - PICKER.gap)),
    maxHeight: Math.floor(Math.min(PICKER.height, room)),
  };
}
