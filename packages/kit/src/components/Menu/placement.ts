export const GAP = 4;
export const MARGIN = 4;
const OVERLAP = 2;

type Side = 'top' | 'bottom' | 'left' | 'right';
type Box = Pick<DOMRectReadOnly, 'left' | 'top' | 'right' | 'bottom'>;
type Size = Pick<DOMRectReadOnly, 'width' | 'height'>;

export type MenuPosition =
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | { readonly kind: 'trigger'; readonly rect: Box; readonly align: 'start' | 'end' }
  | { readonly kind: 'branch'; readonly panel: Box; readonly rowTop: number; readonly lead: number; readonly side: Side | undefined };

export type MenuPlacement = {
  readonly side: Side;
  readonly left: number;
  readonly top: number;
  readonly maxHeight: number | undefined;
  readonly maxWidth: number;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(value, max));

/** Keep the menu inside the viewport. Flip before clipping, then give any remaining height to the scrolling body. */
export function placeMenu(position: MenuPosition, size: Size, viewport: Size, rtl: boolean): MenuPlacement {
  const rightEdge = Math.max(MARGIN, viewport.width - MARGIN);
  const bottomEdge = Math.max(MARGIN, viewport.height - MARGIN);
  const maxWidth = rightEdge - MARGIN;
  const width = Math.min(Math.ceil(size.width), maxWidth);
  const naturalHeight = Math.ceil(size.height);
  let height: number;
  let side: Side;
  let left: number;
  let top: number;

  if (position.kind === 'branch') {
    const rightStart = position.panel.right - OVERLAP;
    const leftEnd = position.panel.left + OVERLAP;
    const right = rightEdge - rightStart;
    const leftRoom = leftEnd - MARGIN;
    const preferRight = position.side === 'right' || (position.side !== 'left' && !rtl);
    const toRight = preferRight ? width <= right || right >= leftRoom : !(width <= leftRoom || leftRoom >= right);
    side = toRight ? 'right' : 'left';
    left = toRight ? rightStart : leftEnd - width;
    top = position.rowTop - position.lead;
    height = Math.min(naturalHeight, bottomEdge - MARGIN);
  } else {
    let belowStart: number;
    let aboveEnd: number;
    if (position.kind === 'point') {
      const x = clamp(position.x, MARGIN, rightEdge);
      belowStart = clamp(position.y, MARGIN, bottomEdge);
      aboveEnd = belowStart;
      const rightRoom = rightEdge - x;
      const leftRoom = x - MARGIN;
      const toRight = rtl ? !(width <= leftRoom || leftRoom >= rightRoom) : width <= rightRoom || rightRoom >= leftRoom;
      left = toRight ? x : x - width;
    } else {
      const { rect } = position;
      belowStart = clamp(rect.bottom + GAP, MARGIN, bottomEdge);
      aboveEnd = clamp(rect.top - GAP, MARGIN, bottomEdge);
      left = (position.align === 'end') !== rtl ? rect.right - width : rect.left;
    }

    const below = bottomEdge - belowStart;
    const above = aboveEnd - MARGIN;
    if (position.kind === 'trigger' && position.align === 'start' && Math.max(below, above) < Math.min(naturalHeight, (bottomEdge - MARGIN) / 2)) {
      // A keyboard context target may cover most of the window. Place inside its visible part instead.
      const { rect } = position;
      const y = (clamp(rect.top, MARGIN, bottomEdge) + clamp(rect.bottom, MARGIN, bottomEdge)) / 2;
      return placeMenu({ kind: 'point', x: rtl ? rect.right : rect.left, y }, size, viewport, rtl);
    }

    side = naturalHeight <= below || (naturalHeight > above && below >= above) ? 'bottom' : 'top';
    height = Math.min(naturalHeight, side === 'bottom' ? below : above);
    top = side === 'bottom' ? belowStart : aboveEnd - height;
  }

  return {
    side,
    left: Math.round(clamp(left, MARGIN, rightEdge - width)),
    top: Math.round(clamp(top, MARGIN, bottomEdge - height)),
    maxHeight: height < naturalHeight ? height : undefined,
    maxWidth,
  };
}
