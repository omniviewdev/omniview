// The panel's size, as functions of the window's height (ch16 section G, S99 to S103). The numbers are the chapter's table: the panel is `max(240, 30% of the window)` at most 400 by
// default, never less than 120, never more than the window minus 312 (the page island keeps its room). Pure: the stylesheet reads the same expressions (`Panel.module.css`), so what
// the model says and what is drawn are one number, and the splitter's `aria-valuenow` is true.

/** The least a panel is drawn at. */
export const MIN_HEIGHT = 120;
/** What the window keeps above the panel: the top row, the page island's minimum and the gutters (ch16 S98). */
export const ROOM_ABOVE = 312;
/** A drag that is released below two thirds of the minimum hides the panel (S101). */
export const COLLAPSE_BELOW = (MIN_HEIGHT * 2) / 3;

const STEP = 16;
const STEP_LARGE = 64;

export type HeightLimits = { readonly min: number; readonly max: number };

/** The height of a panel nobody has resized: 30% of the window, at least 240 and at most 400. Not rounded, as the stylesheet's own expression is not. */
export function defaultHeight(viewport: number): number {
  return Math.min(400, Math.max(240, viewport * 0.3));
}

/** What the panel may be drawn at in a window this high. A window too short for the minimum gets the minimum, which is what the stylesheet's `clamp()` does. */
export function limitsOf(viewport: number): HeightLimits {
  return { min: MIN_HEIGHT, max: Math.max(MIN_HEIGHT, viewport - ROOM_ABOVE) };
}

/** The height the panel is drawn at: what the user chose, else the default, within the limits of this window. */
export function resolveHeight(chosen: number | null, viewport: number): number {
  const { min, max } = limitsOf(viewport);
  return Math.min(max, Math.max(min, chosen ?? defaultHeight(viewport)));
}

/** Whether a drag released at this raw height (not yet clamped) hides the panel instead of resizing it. */
export function collapses(raw: number): boolean {
  return raw < COLLAPSE_BELOW;
}

/** What a key does to the splitter: a new height, or the reset to the default. */
export type HeightKey = { readonly size: number } | { readonly reset: true };

/**
 * What a key on the splitter asks (S102): arrows move it 16 px, and Shift with an arrow, Page Up and Page Down 64; the handle is the panel's top edge, so Up grows the panel. Home goes to the
 * minimum and End to the maximum, Enter resets. No key collapses the panel, and a limit is where a key stops. `undefined` for a key that is not the splitter's.
 */
export function heightKey(current: number, viewport: number, key: string, shift: boolean): HeightKey | undefined {
  const { min, max } = limitsOf(viewport);
  const to = (size: number): HeightKey => ({ size: Math.min(max, Math.max(min, size)) });
  switch (key) {
    case 'ArrowUp':
      return to(current + (shift ? STEP_LARGE : STEP));
    case 'ArrowDown':
      return to(current - (shift ? STEP_LARGE : STEP));
    case 'PageUp':
      return shift ? undefined : to(current + STEP_LARGE);
    case 'PageDown':
      return shift ? undefined : to(current - STEP_LARGE);
    case 'Home':
      return shift ? undefined : to(min);
    case 'End':
      return shift ? undefined : to(max);
    case 'Enter':
      return shift ? undefined : { reset: true };
    default:
      return undefined;
  }
}
