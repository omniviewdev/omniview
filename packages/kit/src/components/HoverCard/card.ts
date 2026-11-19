/** The attribute a trigger carries for the host: the key of its card, which the host's `render` turns into content. */
export const CARD_ATTRIBUTE = 'data-ov-card';
/** `"down"` on a trigger whose card can be reached with the Down arrow: it opens the card at once and moves the focus into it. */
export const CARD_ARROW_ATTRIBUTE = 'data-ov-card-arrow';
/** On the ancestor of a trigger that the card is placed against and never covers (a tab with its close button), when it is not the trigger itself. */
export const CARD_ANCHOR_ATTRIBUTE = 'data-ov-card-anchor';

/** The data attributes of a card trigger: spread them on any element, or on a part, whose only pass-through is `data-*`. */
export type HoverCardAttributes = {
  readonly 'data-ov-card'?: string;
  readonly 'data-ov-card-arrow'?: 'down';
};

/**
 * The card of a trigger, as attributes for the one `HoverCardHost` of the window to read: `<button {...hoverCard('session-7')}>`. The key
 * is the host's own business (its `render` answers it with content); a blank or missing key has no card. Nothing is bound to the element:
 * the host listens on the document, so a thousand triggers cost what one does.
 *
 * `arrow: 'down'` makes the card reachable from the keyboard: the Down arrow on the focused trigger opens the card at once and moves the
 * focus to its first control (WCAG 1.4.13 asks for a card that can be reached and does not take the focus on its own). Give it to a trigger
 * whose card holds a link or a button.
 */
export function hoverCard(key: string | undefined, options: { readonly arrow?: 'down' } = {}): HoverCardAttributes {
  if (typeof key !== 'string' || key.trim() === '') {
    return {};
  }

  return options.arrow === 'down' ? { [CARD_ATTRIBUTE]: key, [CARD_ARROW_ATTRIBUTE]: 'down' } : { [CARD_ATTRIBUTE]: key };
}

/**
 * Marks the element the card is placed against: an ancestor of the trigger, so that a card for the label of a tab opens below the whole tab
 * and never covers its close button. Without it the anchor is the trigger itself. Spread it on the ancestor: `<div {...hoverCardAnchor()}>`.
 */
export function hoverCardAnchor(): { readonly 'data-ov-card-anchor': '' } {
  return { [CARD_ANCHOR_ATTRIBUTE]: '' };
}
