import type { Platform } from '../../../core/chords';
import type { FindOptions, FindState } from '../engine';
import { keyOf, type KeyEventLike } from '../keys';

// The find bar's rules with no DOM (the view is `FindBar.tsx`, the behaviour is `findSession.ts`): what the bar holds, the guard that keeps a pattern the engine cannot read from reaching it, the words of the count
// lane (the written spec's FBR1: `3 of 12`, `No results`, `Invalid pattern`, nothing), and which keys the bar takes for itself.

/** The three switches of the bar, by the engine's own option names, in the order the bar draws them: Match case, Use regular expression, Match whole word. */
export type FindFlag = 'caseSensitive' | 'regex' | 'wholeWord';

export const FIND_FLAGS: readonly FindFlag[] = ['caseSensitive', 'regex', 'wholeWord'];

/** What the bar holds: the text in the field and the three switches. The engine is given the switches as its options and the text beside them. */
export type FindInput = FindOptions & { readonly query: string };

export const INITIAL_FIND: FindInput = Object.freeze({ query: '', caseSensitive: false, regex: false, wholeWord: false });

export const withQuery = (input: FindInput, query: string): FindInput => ({ ...input, query });

export const toggled = (input: FindInput, flag: FindFlag): FindInput => ({ ...input, [flag]: !input[flag] });

export const optionsOf = ({ caseSensitive, regex, wholeWord }: FindInput): FindOptions => ({ caseSensitive, regex, wholeWord });

/**
 * Whether the engine can read the query. Text is always readable; with the regular expression switch on, the query has to parse as one. The search compiles it with the global flag and the case flag, which change what
 * matches and never whether the pattern parses, so the same grammar is checked here. An empty query is valid: there is nothing to read. A pattern that is not valid never reaches the engine (the bar says so instead).
 */
export function isValid({ query, regex }: FindInput): boolean {
  if (!regex || query === '') {
    return true;
  }

  try {
    RegExp(query, 'g');
    return true;
  } catch {
    return false;
  }
}

/** Whether there is something to look for: a query, and one the engine can read. */
export const canSearch = (input: FindInput): boolean => input.query !== '' && isValid(input);

const NUMBER = new Intl.NumberFormat('en-US');

/**
 * The text of the count lane, a lane of fixed width inside the field: which match of how many, `No results`, `Invalid pattern`, `Unavailable`, or nothing. `state` is where the engine says the find stands (`index` is
 * 0-based and -1 for none), `valid` whether the query parses (`isValid`), and `unavailable` whether the search could not be had (the screen's finder failed to load, and no request has got it since). A pattern that does not
 * parse is the person's to fix, so its words come first; a search that cannot be had has no count to show, whatever the engine said before. The lane is 100 px wide and cuts a word that does not fit with an ellipsis, so its
 * words are short (`Unavailable` is about 68 px at 12 px, `Invalid pattern` about 80). The count is a floor when the engine stopped at its limit (`capped`: `20,000+`). When the match the screen is on is not among those
 * the engine counted, the position is not known and the lane says so with a question mark, as VS Code's find does (`? of 20,000+`).
 */
export function countText(state: FindState | undefined, valid: boolean, query: string, unavailable = false): string {
  if (!valid) {
    return 'Invalid pattern';
  }

  if (unavailable) {
    return 'Unavailable';
  }

  if (query === '' || state === undefined) {
    return '';
  }

  if (state.count === 0) {
    return 'No results';
  }

  const total = `${NUMBER.format(state.count)}${state.capped ? '+' : ''}`;
  return `${state.index < 0 ? '?' : NUMBER.format(state.index + 1)} of ${total}`;
}

/** What a key does in the bar: close it, bring the keyboard to the field (the find chord), or step the find. */
export type BarAction = { readonly kind: 'close' } | { readonly kind: 'find' } | { readonly kind: 'step'; readonly direction: 'next' | 'previous' };

/**
 * The keys the bar takes for itself, whether the focus is in the field (`inField`) or on one of its buttons:
 *   Escape                       closes it, the first time it is pressed (the field would clear its text first; the mock closes without clearing, and so does VS Code's find)
 *   Enter, Shift Enter           in the field, the next and the previous match. VS Code's terminal binds them the other way round (Enter goes back, Shift Enter forward); the Logs find bar and the design mock go forward on
 *                                Enter, and this bar agrees with them. On a button Enter presses the button, and the press steps
 *   F3, Shift F3, Command G      the next and the previous match; Command G only on a Mac (the terminal's own rules, `keyOf`)
 *   the find chord               Command F on a Mac, Control F and Control Shift F elsewhere: the bar is beside the terminal's screen and not in it, so no key rule of the screen sees a key pressed in the bar, and the chord is the bar's
 *                                there, which brings the keyboard to the field with its text selected (a browser tab would otherwise open its own find). It is the terminal's own classifier that says what the chord is (`keyOf`), never a copy of it
 * A key an input method is composing is the input method's, and a chord with Control, Alt or Command that is not one of these is not the bar's.
 */
export function barKeyOf(event: KeyEventLike, platform: Platform, inField: boolean): BarAction | undefined {
  if (event.isComposing === true || event.keyCode === 229) {
    return undefined;
  }

  const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
  if (event.key === 'Escape') {
    return plain ? { kind: 'close' } : undefined;
  }

  if (event.key === 'Enter') {
    return plain && inField ? { kind: 'step', direction: event.shiftKey ? 'previous' : 'next' } : undefined;
  }

  const key = keyOf(event, platform, false);
  if (key === 'find') {
    return { kind: 'find' };
  }

  if (key === 'findNext') {
    return { kind: 'step', direction: 'next' };
  }

  return key === 'findPrevious' ? { kind: 'step', direction: 'previous' } : undefined;
}
