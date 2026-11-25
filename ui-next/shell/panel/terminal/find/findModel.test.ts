import { describe, expect, it } from 'vitest';
import type { FindState } from '../engine';
import { keyOf, type KeyEventLike } from '../keys';
import { barKeyOf, canSearch, countText, FIND_FLAGS, INITIAL_FIND, isValid, optionsOf, toggled, withQuery, type FindInput } from './findModel';

// The find bar's rules with no DOM: what the bar holds (the query and the three switches), the guard that keeps a pattern the engine cannot read from reaching it, the words of the count lane, and which keys the bar
// itself takes (Escape, Enter, the keys that step a find, and the find chord itself).

const input = (over: Partial<FindInput> = {}): FindInput => ({ ...INITIAL_FIND, ...over });
const state = (index: number, count: number, capped = false): FindState => ({ index, count, capped });

describe('what the bar holds', () => {
  it('starts with no query and every switch off', () => {
    expect(INITIAL_FIND).toEqual({ query: '', caseSensitive: false, regex: false, wholeWord: false });
  });

  it('names the three switches by the engine\'s own option names, in the order the bar draws them: case, regular expression, whole word', () => {
    expect(FIND_FLAGS).toEqual(['caseSensitive', 'regex', 'wholeWord']);
  });

  it('changes the query and nothing else, and leaves the input it was given as it was', () => {
    const before = input({ query: 'a', regex: true, wholeWord: true });
    const after = withQuery(before, 'abc');
    expect(after).toEqual({ query: 'abc', caseSensitive: false, regex: true, wholeWord: true });
    expect(before.query).toBe('a');
    expect(after).not.toBe(before);
  });

  it.each(FIND_FLAGS)('flips %s and nothing else, and flips it back', (flag) => {
    const before = input({ query: 'q' });
    const after = toggled(before, flag);
    const others = FIND_FLAGS.filter((other) => other !== flag);
    expect(after[flag]).toBe(true);
    expect(after.query).toBe('q');
    for (const other of others) {
      expect(after[other]).toBe(false);
    }

    expect(before[flag]).toBe(false);
    expect(toggled(after, flag)).toEqual(before);
  });

  it('gives the engine its three options and not the query: the engine is given the query beside them', () => {
    expect(optionsOf(input({ query: 'zz', caseSensitive: true, wholeWord: true }))).toEqual({ caseSensitive: true, regex: false, wholeWord: true });
    expect(Object.keys(optionsOf(input({ query: 'zz' }))).sort()).toEqual(['caseSensitive', 'regex', 'wholeWord']);
  });
});

describe('the guard: a pattern the engine cannot read never reaches it', () => {
  it('reads a query as plain text while the regular expression switch is off, whatever it holds', () => {
    for (const query of ['(', ')', '[', 'a{2,1}', '*a', '\\', '?', '(?<n>a)(?<n>b)']) {
      expect(isValid(input({ query }))).toBe(true);
    }
  });

  it.each(['a', 'a|b', '^foo$', '\\d+', '[a-z]+', '(a)(b)', 'a{2,3}', '.*', '\\bword\\b', '(?<name>x)', '(?:x)', 'x*?', '\\p{L}', ']', '{', '\\u{61}'])('accepts the pattern %j with the switch on', (query) => {
    expect(isValid(input({ query, regex: true }))).toBe(true);
  });

  it.each(['(', ')', '[', 'a{2,1}', '*a', '+', '?', '\\', '(?<n>a)(?<n>b)', '(?<', '[b-a]', 'a**', '(?<1a>x)'])('rejects the pattern %j with the switch on', (query) => {
    expect(isValid(input({ query, regex: true }))).toBe(false);
  });

  it('takes an empty query as valid whatever the switches say: there is nothing to read', () => {
    expect(isValid(input({ query: '', regex: true }))).toBe(true);
    expect(isValid(input({ query: '', regex: false }))).toBe(true);
  });

  it('judges the query the other switches leave as it is: case and whole word change what matches, not whether the pattern parses', () => {
    expect(isValid(input({ query: '(', regex: true, caseSensitive: true }))).toBe(false);
    expect(isValid(input({ query: '(', regex: true, wholeWord: true }))).toBe(false);
    expect(isValid(input({ query: 'a+', regex: true, caseSensitive: true, wholeWord: true }))).toBe(true);
  });

  it('can be searched when there is a query and it is valid, and not otherwise', () => {
    expect(canSearch(input())).toBe(false);
    expect(canSearch(input({ query: 'a' }))).toBe(true);
    expect(canSearch(input({ query: '(' }))).toBe(true);
    expect(canSearch(input({ query: '(', regex: true }))).toBe(false);
    expect(canSearch(input({ query: '', regex: true }))).toBe(false);
    expect(canSearch(input({ query: '(a)', regex: true }))).toBe(true);
  });

  it('judges a pattern the same way every time it is asked: no pattern object with a position is kept between calls', () => {
    const pattern = input({ query: 'a', regex: true });
    expect([isValid(pattern), isValid(pattern), isValid(pattern)]).toEqual([true, true, true]);
  });
});

describe('the words of the count lane', () => {
  it('says nothing for an empty query, whatever the engine last said', () => {
    expect(countText(undefined, true, '')).toBe('');
    expect(countText(state(2, 12), true, '')).toBe('');
    expect(countText(state(-1, 0), true, '')).toBe('');
    expect(countText(state(0, 20_000, true), true, '')).toBe('');
  });

  it('says "Invalid pattern" for a pattern that does not parse, before anything else the engine said', () => {
    expect(countText(undefined, false, '(')).toBe('Invalid pattern');
    expect(countText(state(0, 3), false, '(')).toBe('Invalid pattern');
    expect(countText(state(-1, 0), false, '(')).toBe('Invalid pattern');
  });

  it('says nothing while the engine has not answered for this query', () => {
    expect(countText(undefined, true, 'a')).toBe('');
  });

  it('says "No results" for a query nothing matches', () => {
    expect(countText(state(-1, 0), true, 'a')).toBe('No results');
    expect(countText(state(0, 0), true, 'a')).toBe('No results');
  });

  it('counts the matches from 1: the engine\'s first match is "1 of N"', () => {
    expect(countText(state(0, 1), true, 'a')).toBe('1 of 1');
    expect(countText(state(0, 12), true, 'a')).toBe('1 of 12');
    expect(countText(state(2, 12), true, 'a')).toBe('3 of 12');
    expect(countText(state(11, 12), true, 'a')).toBe('12 of 12');
  });

  it('writes thousands with a comma, in both numbers', () => {
    expect(countText(state(1_233, 5_678), true, 'a')).toBe('1,234 of 5,678');
    expect(countText(state(999, 1_000), true, 'a')).toBe('1,000 of 1,000');
    expect(countText(state(0, 1_234_567), true, 'a')).toBe('1 of 1,234,567');
  });

  it('says the count is a floor when the engine stopped counting at its limit: 20,000 and more', () => {
    expect(countText(state(0, 20_000, true), true, 'a')).toBe('1 of 20,000+');
    expect(countText(state(19_999, 20_000, true), true, 'a')).toBe('20,000 of 20,000+');
    expect(countText(state(4, 20_000, true), true, 'a')).toBe('5 of 20,000+');
  });

  it('says the position is not known when the match the screen is on is not among those counted, and still says how many were', () => {
    expect(countText(state(-1, 20_000, true), true, 'a')).toBe('? of 20,000+');
    expect(countText(state(-1, 7), true, 'a')).toBe('? of 7');
  });

  it('does not put a plus on a count that is complete', () => {
    expect(countText(state(0, 20_000, false), true, 'a')).toBe('1 of 20,000');
  });

  it('is a pure function of what it is given', () => {
    const given = state(2, 12);
    expect(countText(given, true, 'a')).toBe(countText(given, true, 'a'));
    expect(given).toEqual(state(2, 12));
  });
});

describe('the words of the count lane when the search cannot be had', () => {
  it('says "Unavailable" for a search that could not be started, whatever the field holds: the lane is where the bar says what it cannot do', () => {
    expect(countText(undefined, true, '', true)).toBe('Unavailable');
    expect(countText(undefined, true, 'a', true)).toBe('Unavailable');
  });

  it('never puts a count beside those words: what the engine said before is not an answer for a search that cannot be had', () => {
    expect(countText(state(2, 12), true, 'a', true)).toBe('Unavailable');
    expect(countText(state(-1, 0), true, 'a', true)).toBe('Unavailable');
  });

  it('keeps "Invalid pattern" first: a pattern that does not parse is the person\'s to fix, whatever the search can do', () => {
    expect(countText(undefined, false, '(', true)).toBe('Invalid pattern');
  });

  it('says nothing of it unless it is asked to: the default is a search that can be had', () => {
    expect(countText(undefined, true, 'a')).toBe('');
    expect(countText(undefined, true, 'a', false)).toBe('');
    expect(countText(state(2, 12), true, 'a', false)).toBe('3 of 12');
  });

  // The lane is 100 px wide at the text size of 12 px and cuts what does not fit with an ellipsis. "Invalid pattern" is the longest of the words the lane was drawn for (about 80 px); "Unavailable" is about 68 px.
  it('keeps every word that is not a count within the length of "Invalid pattern": a longer one would be cut by the lane\'s ellipsis', () => {
    const words = [countText(undefined, false, '(', false), countText(undefined, true, 'a', true), countText(state(-1, 0), true, 'a')];
    expect(words).toEqual(['Invalid pattern', 'Unavailable', 'No results']);
    for (const word of words) {
      expect(word.length, word).toBeLessThanOrEqual('Invalid pattern'.length);
    }
  });
});

const key = (name: string, init: Partial<KeyEventLike> = {}): KeyEventLike => ({ key: name, code: name, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...init });
const letter = (name: string, init: Partial<KeyEventLike> = {}): KeyEventLike => key(name.toLowerCase(), { code: `Key${name.toUpperCase()}`, ...init });
const PLATFORMS = ['mac', 'other'] as const;

describe('the keys the bar takes', () => {
  describe.each(PLATFORMS)('on %s', (platform) => {
    it('closes on Escape, in the field or on a button', () => {
      expect(barKeyOf(key('Escape'), platform, true)).toEqual({ kind: 'close' });
      expect(barKeyOf(key('Escape'), platform, false)).toEqual({ kind: 'close' });
    });

    it('closes on Shift Escape too (VS Code does), and not on an Escape with Control, Alt or Command, which are chords of something else', () => {
      expect(barKeyOf(key('Escape', { shiftKey: true }), platform, true)).toEqual({ kind: 'close' });
      expect(barKeyOf(key('Escape', { ctrlKey: true }), platform, true)).toBeUndefined();
      expect(barKeyOf(key('Escape', { altKey: true }), platform, true)).toBeUndefined();
      expect(barKeyOf(key('Escape', { metaKey: true }), platform, true)).toBeUndefined();
    });

    it('steps forward on Enter and back on Shift Enter in the field: the Logs find bar and the design mock do, where VS Code\'s terminal binds them the other way round', () => {
      expect(barKeyOf(key('Enter'), platform, true)).toEqual({ kind: 'step', direction: 'next' });
      expect(barKeyOf(key('Enter', { shiftKey: true }), platform, true)).toEqual({ kind: 'step', direction: 'previous' });
    });

    it('leaves Enter on a button to the button: it presses it, and the press steps', () => {
      expect(barKeyOf(key('Enter'), platform, false)).toBeUndefined();
      expect(barKeyOf(key('Enter', { shiftKey: true }), platform, false)).toBeUndefined();
    });

    it('does not take Enter with Control, Alt or Command', () => {
      expect(barKeyOf(key('Enter', { ctrlKey: true }), platform, true)).toBeUndefined();
      expect(barKeyOf(key('Enter', { altKey: true }), platform, true)).toBeUndefined();
      expect(barKeyOf(key('Enter', { metaKey: true }), platform, true)).toBeUndefined();
    });

    it('steps on F3 and Shift F3, in the field and on a button', () => {
      expect(barKeyOf(key('F3'), platform, true)).toEqual({ kind: 'step', direction: 'next' });
      expect(barKeyOf(key('F3'), platform, false)).toEqual({ kind: 'step', direction: 'next' });
      expect(barKeyOf(key('F3', { shiftKey: true }), platform, true)).toEqual({ kind: 'step', direction: 'previous' });
      expect(barKeyOf(key('F3', { shiftKey: true }), platform, false)).toEqual({ kind: 'step', direction: 'previous' });
    });

    it('lets go of keys that are for typing, for the page, or for a text input', () => {
      expect(barKeyOf(letter('a'), platform, true)).toBeUndefined();
      expect(barKeyOf(key('Tab'), platform, true)).toBeUndefined();
      expect(barKeyOf(key('ArrowLeft'), platform, false)).toBeUndefined();
      expect(barKeyOf(key('F6'), platform, true)).toBeUndefined();
      expect(barKeyOf(key('F4'), platform, true)).toBeUndefined();
      expect(barKeyOf(key(' ', { code: 'Space' }), platform, false)).toBeUndefined();
    });

    it('leaves a key that an input method is composing to the input method: Escape cancels the composition and Enter confirms it', () => {
      expect(barKeyOf(key('Escape', { isComposing: true }), platform, true)).toBeUndefined();
      expect(barKeyOf(key('Enter', { isComposing: true }), platform, true)).toBeUndefined();
      expect(barKeyOf(key('Enter', { keyCode: 229 }), platform, true)).toBeUndefined();
      expect(barKeyOf(key('Escape', { keyCode: 229 }), platform, true)).toBeUndefined();
    });
  });

  it('steps on Command G and Command Shift G on a Mac, as the terminal does', () => {
    expect(barKeyOf(letter('g', { metaKey: true }), 'mac', true)).toEqual({ kind: 'step', direction: 'next' });
    expect(barKeyOf(letter('g', { metaKey: true }), 'mac', false)).toEqual({ kind: 'step', direction: 'next' });
    expect(barKeyOf(letter('g', { metaKey: true, shiftKey: true }), 'mac', true)).toEqual({ kind: 'step', direction: 'previous' });
  });

  it('does not take Command G with Option or Control on a Mac, nor a G with no Command', () => {
    expect(barKeyOf(letter('g', { metaKey: true, altKey: true }), 'mac', true)).toBeUndefined();
    expect(barKeyOf(letter('g', { metaKey: true, ctrlKey: true }), 'mac', true)).toBeUndefined();
    expect(barKeyOf(letter('g', { ctrlKey: true }), 'mac', true)).toBeUndefined();
    expect(barKeyOf(letter('g'), 'mac', true)).toBeUndefined();
  });

  it('does not take Control G or Command G on Windows and Linux: Control G is the shell\'s and Command is the window\'s there', () => {
    expect(barKeyOf(letter('g', { ctrlKey: true }), 'other', true)).toBeUndefined();
    expect(barKeyOf(letter('g', { ctrlKey: true, shiftKey: true }), 'other', true)).toBeUndefined();
    expect(barKeyOf(letter('g', { metaKey: true }), 'other', true)).toBeUndefined();
  });

  it('does not take F3 with Control, Alt or Command: those are other chords', () => {
    for (const platform of PLATFORMS) {
      expect(barKeyOf(key('F3', { ctrlKey: true }), platform, true)).toBeUndefined();
      expect(barKeyOf(key('F3', { altKey: true }), platform, true)).toBeUndefined();
      expect(barKeyOf(key('F3', { metaKey: true }), platform, true)).toBeUndefined();
    }
  });
});

// The find chord in the bar: Command F on a Mac, Control F and Control Shift F elsewhere, as the terminal's own keys say it (`keyOf` is the one classifier: the bar asks it and does not write the chord again). Pressed with the
// keyboard in the bar, no emulator is there to take it, so the bar takes it: the field gets the keyboard back with its text selected, and the key goes no further (a browser tab would open its own find).
describe('the find chord in the bar', () => {
  it('is Command F on a Mac, in the field and on a button', () => {
    expect(barKeyOf(letter('f', { metaKey: true }), 'mac', true)).toEqual({ kind: 'find' });
    expect(barKeyOf(letter('f', { metaKey: true }), 'mac', false)).toEqual({ kind: 'find' });
  });

  it('is Control F and Control Shift F on Windows and Linux (VS Code and JetBrains bind the first, the written spec the second), in the field and on a button', () => {
    expect(barKeyOf(letter('f', { ctrlKey: true }), 'other', true)).toEqual({ kind: 'find' });
    expect(barKeyOf(letter('f', { ctrlKey: true }), 'other', false)).toEqual({ kind: 'find' });
    expect(barKeyOf(letter('f', { ctrlKey: true, shiftKey: true }), 'other', true)).toEqual({ kind: 'find' });
    expect(barKeyOf(letter('f', { ctrlKey: true, shiftKey: true }), 'other', false)).toEqual({ kind: 'find' });
  });

  it('is not Control F on a Mac (the field\'s own move of the cursor), nor Command F on Windows and Linux (the window\'s), nor an F with Option', () => {
    expect(barKeyOf(letter('f', { ctrlKey: true }), 'mac', true)).toBeUndefined();
    expect(barKeyOf(letter('f', { metaKey: true }), 'other', true)).toBeUndefined();
    expect(barKeyOf(letter('f', { metaKey: true, altKey: true }), 'mac', true)).toBeUndefined();
    expect(barKeyOf(letter('f', { ctrlKey: true, altKey: true }), 'other', true)).toBeUndefined();
    expect(barKeyOf(letter('f'), 'mac', true)).toBeUndefined();
    expect(barKeyOf(letter('f'), 'other', true)).toBeUndefined();
  });

  it('leaves an F that an input method is composing to the input method', () => {
    expect(barKeyOf(letter('f', { metaKey: true, isComposing: true }), 'mac', true)).toBeUndefined();
    expect(barKeyOf(letter('f', { ctrlKey: true, keyCode: 229 }), 'other', true)).toBeUndefined();
  });

  // The bar and the terminal must never disagree about what the chord is: over every combination of the four modifiers, on both platforms, the bar takes the F exactly when the terminal's classifier calls it `find`.
  it.each(PLATFORMS)('is what the terminal\'s own key rules call a find, for every combination of the modifiers, on %s', (platform) => {
    for (let bits = 0; bits < 16; bits += 1) {
      const modifiers = { metaKey: (bits & 1) !== 0, ctrlKey: (bits & 2) !== 0, altKey: (bits & 4) !== 0, shiftKey: (bits & 8) !== 0 };
      const event = letter('f', modifiers);
      expect(barKeyOf(event, platform, true)?.kind === 'find', JSON.stringify(modifiers)).toBe(keyOf(event, platform, false) === 'find');
    }
  });
});
