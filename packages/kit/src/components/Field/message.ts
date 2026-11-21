/**
 * What the lane of a field can say, in the order of design S127: the lowest rank first. An error and a warning have a glyph and a word for
 * assistive technology besides their colour; a check that is running says so, and its loader comes after a second; a check that could not
 * be made says so with Retry (the value is not applied); a saved value says it for two seconds; an info is a standing note (a restart, a
 * reason); a hint is the line the field says when it has nothing else to say.
 */
export type FieldMessageKind = 'error' | 'warning' | 'checking' | 'retry' | 'saved' | 'info' | 'hint';

export type FieldMessage = {
  readonly kind: FieldMessageKind;
  /** At most 80 characters, written "Problem. Fix." (design S127). Empty: a check says "Checking…", a retry "Couldn’t check", a save "Saved"; any other kind says nothing. */
  readonly text: string;
  /** What did not fit in the line: all of the message, as the tip of the text and the description of the control. */
  readonly detail?: string | undefined;
  /** The lane offers Retry (with the Field's `onRetry`): a check that could not be made, a value the host could not apply. */
  readonly retry?: boolean | undefined;
};

export const RANK: Readonly<Record<FieldMessageKind, number>> = { error: 0, warning: 1, checking: 2, retry: 3, saved: 4, info: 5, hint: 6 };

/** What a kind says when it is given no words. */
export const DEFAULT_TEXT: Readonly<Partial<Record<FieldMessageKind, string>>> = { checking: 'Checking…', retry: 'Couldn’t check', saved: 'Saved' };

/** What assistive technology hears before the text, so that an error is never only red. */
export const KIND_WORD: Readonly<Partial<Record<FieldMessageKind, string>>> = { error: 'Error: ', warning: 'Warning: ', retry: 'Warning: ' };

/** The words of a message, or an empty string when it has none to say. */
export const wordsOf = (message: FieldMessage): string => (message.text.trim() === '' ? (DEFAULT_TEXT[message.kind] ?? '') : message.text);

/**
 * The one message that shows: the field's own, or its reason (an info) when the reason outranks it. A tie goes to the field's own, so a
 * message that says the same thing as the reason is said once.
 */
export function pick(message: FieldMessage | undefined, reason: string | undefined): FieldMessage | undefined {
  const own = message === undefined || wordsOf(message) === '' ? undefined : message;
  if (reason === undefined) {
    return own;
  }

  const unavailable: FieldMessage = { kind: 'info', text: reason };
  return own === undefined || RANK[unavailable.kind] < RANK[own.kind] ? unavailable : own;
}
