import type { PaneAxis } from '../../core/panel';
import type { Geometry } from './sash';

/** The thickness of a sash in pixels: the stylesheet's (`PaneSash.module.css`), twice written because the model of the shares needs it to know how much of the deck the panes share. A sash that is drawn is measured instead. */
export const SASH_PX = 5;

const SASH = '[data-shell-part="paneSash"]';

/** The deck's length along its axis, content box. */
const lengthOf = (deck: HTMLElement, axis: PaneAxis): number => (axis === 'row' ? deck.clientWidth : deck.clientHeight);

/** The thickness a sash has now: the one drawn, else the stylesheet's. */
function thickness(deck: HTMLElement, axis: PaneAxis): number {
  const drawn = deck.querySelector<HTMLElement>(`:scope > ${SASH}`);
  if (drawn === null) {
    return SASH_PX;
  }

  const rect = drawn.getBoundingClientRect();
  return axis === 'row' ? rect.width : rect.height;
}

/** What a sash needs of the deck for a gesture: where the panes begin, how long they are together (the deck less its `panes - 1` sashes) and the thickness of a sash. Null when the deck has no room to measure. */
export function measure(deck: HTMLElement, axis: PaneAxis, panes: number): Geometry | null {
  const sash = thickness(deck, axis);
  const extent = lengthOf(deck, axis) - Math.max(0, panes - 1) * sash;
  if (!(extent > 0)) {
    return null;
  }

  const rect = deck.getBoundingClientRect();
  return { start: axis === 'row' ? rect.left + deck.clientLeft : rect.top + deck.clientTop, extent, sash };
}

/** The length the panes of a group of `panes` would share along the deck's axis. */
export function extentOf(deck: HTMLElement, axis: PaneAxis, panes: number): number {
  return lengthOf(deck, axis) - Math.max(0, panes - 1) * thickness(deck, axis);
}
