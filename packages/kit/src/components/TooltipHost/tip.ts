/** The attribute a trigger carries for the host: the plain text of its tip. */
export const TIP_ATTRIBUTE = 'data-ov-tip';
/** `"0"` on a trigger that opens at once, with no delay (the mock's `data-tooltip-delay`). */
export const TIP_DELAY_ATTRIBUTE = 'data-ov-tip-delay';
/** On an element whose text may be cut: a marker. The tip is its full text, shown only while the text is cut (see `data-ov-full`). */
export const CLIP_ATTRIBUTE = 'data-ov-clip';
/** The full text of a clipping element, when the element does not hold it as its own text. */
export const FULL_ATTRIBUTE = 'data-ov-full';

export type TipOptions = {
  /** `0`: open at once instead of after 500 ms, for a control whose name is all it has (a rail tool). The one delay a trigger may ask for. */
  readonly delay?: 0;
};

/** The data attributes of a tip: spread them on a trigger, or on a part, whose only pass-through is `data-*`. */
export type TipAttributes = {
  readonly 'data-ov-tip'?: string;
  readonly 'data-ov-tip-delay'?: '0';
};

/**
 * The tooltip of a trigger, as attributes for the one `TooltipHost` of the window to read: `<IconButton {...tip('Refresh list')} />`.
 * Plain text, newlines kept (they are lines in the tooltip); a blank text has no tip. No `title` is ever set: the host is the single
 * owner of a trigger's tooltip (design 12 section 4, 14 P1, 15 L4).
 *
 * A tip repeats what the trigger already says elsewhere and never alone carries a fact: an icon button's tip is its name, a reason is also
 * printed beside the control, an absolute time is also in the inspector (design 13 R2, 14 I2, P2).
 */
export function tip(text: string | undefined, options: TipOptions = {}): TipAttributes {
  if (typeof text !== 'string' || text.trim() === '') {
    return {};
  }

  return options.delay === 0 ? { [TIP_ATTRIBUTE]: text, [TIP_DELAY_ATTRIBUTE]: '0' } : { [TIP_ATTRIBUTE]: text };
}
