import { describe, expect, it } from 'vitest';
import { highlight, matchWord, mergeRuns, partsOf, scoreCandidate, wordsOf } from './match';

// The mock's matcher (design lab `shell-search.js`, "Matching and ranking"), as the palette's oracle: every word of the query must match (AND); a word matches a field whole, as a
// prefix, at the start of a word or a CamelCase hump, as a substring, or loosely, and loosely means one of two things a user means by a short word: its letters in order inside ONE
// word of the title ("dply" finds Deployments) or the first letters of consecutive words ("ei" finds EC2 Instances). Letters that wander across words match nothing (QA-SF-26).

describe('wordsOf', () => {
  it('lowercases, splits on any run of space and drops the empty', () => {
    expect(wordsOf('  Cart   API ')).toEqual(['cart', 'api']);
    expect(wordsOf('')).toEqual([]);
    expect(wordsOf('   ')).toEqual([]);
  });

  it('keeps at most eight words: the rest never narrow the search', () => {
    expect(wordsOf('a b c d e f g h i j')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });
});

describe('matchWord', () => {
  it('scores a whole text 100, a prefix 88, the start of a word 76 and a substring 58', () => {
    expect(matchWord('jobs', 'Jobs')).toEqual({ score: 100, runs: [[0, 4]] });
    expect(matchWord('cart', 'cart-api')).toEqual({ score: 88, runs: [[0, 4]] });
    expect(matchWord('api', 'cart-api')).toEqual({ score: 76, runs: [[5, 8]] });
    expect(matchWord('ar', 'cart-api')).toEqual({ score: 58, runs: [[1, 3]] });
  });

  it('prefers a later occurrence that starts a word to an earlier one inside a word', () => {
    expect(matchWord('ap', 'snap-api')).toEqual({ score: 76, runs: [[5, 7]] });
  });

  it('treats a CamelCase hump as the start of a word', () => {
    expect(matchWord('inst', 'MyInstances')).toEqual({ score: 76, runs: [[2, 6]] });
    // A digit is not a letter: the hump rule asks for a lower-case letter before the capital.
    expect(matchWord('inst', 'EC2Instances')).toEqual({ score: 58, runs: [[3, 7]] });
  });

  it('matches loosely by the letters in order inside one word (dply finds Deployments)', () => {
    const hit = matchWord('dply', 'Deployments');
    expect(hit?.runs).toEqual([[0, 1], [2, 3], [3, 4], [5, 6]]);
    expect(hit?.score).toBe(39);
  });

  it('matches loosely by the initials of consecutive words (ei finds EC2 Instances)', () => {
    expect(matchWord('ei', 'EC2 Instances')).toEqual({ score: 38, runs: [[0, 1], [4, 5]] });
  });

  it('never strings letters together across words (QA-SF-26: a resource noun typed in the palette ranked stray commands whose words held its letters in order)', () => {
    expect(matchWord('rod', 'Turn on developer mode')).toBeUndefined();
    expect(matchWord('rod', 'Reopen closed tab')).toBeUndefined();
    expect(matchWord('rod', 'Developer Tools: Dev plugins')).toBeUndefined();
  });

  it('refuses a loose match whose letters are spread over more than twice the word plus two', () => {
    expect(matchWord('abc', 'axxxxbxxxxcxxxx')).toBeUndefined();
    expect(matchWord('abc', 'a1b2c')?.score).toBe(38);
  });

  it('takes the first letters of words however far apart they are: that is what an initial is', () => {
    expect(matchWord('abc', 'a-----b-----c')?.score).toBe(40);
  });

  it('does not match loosely when asked not to, and never for a one-letter word', () => {
    expect(matchWord('dply', 'Deployments', false)).toBeUndefined();
    expect(matchWord('z', 'Deployments')).toBeUndefined();
    expect(matchWord('x', 'a-b')).toBeUndefined();
    expect(matchWord('d', 'Deployments')).toEqual({ score: 88, runs: [[0, 1]] });
  });

  it('is exact about text whose lower case is not as long as it is (no index drifts)', () => {
    // U+0130 lower-cases to two code units. The runs must still index the original text.
    const text = 'İstanbul-api';
    const hit = matchWord('api', text);
    expect(hit?.score).toBe(76);
    expect(text.slice(hit?.runs[0]?.[0], hit?.runs[0]?.[1])).toBe('api');
  });
});

describe('scoreCandidate', () => {
  it('needs every word to match a field (AND)', () => {
    expect(scoreCandidate(['cart', 'api'], { title: 'cart-api' })).toBe(88 * 6 + 76 * 6);
    expect(scoreCandidate(['cart', 'zzz'], { title: 'cart-api' })).toBeUndefined();
  });

  it('weighs the title 6, the keywords 3 and the context 1', () => {
    expect(scoreCandidate(['cart'], { title: 'cart-api' })).toBe(88 * 6);
    expect(scoreCandidate(['cart'], { title: 'zzz', keywords: 'cart' })).toBe(100 * 3);
    expect(scoreCandidate(['cart'], { title: 'zzz', context: 'cart' })).toBe(100);
    expect(scoreCandidate(['cart'], { title: 'cart-api', keywords: 'cart', context: 'cart' })).toBe(88 * 6);
  });

  it('lets only the title match loosely: a keyword or a context that merely contains the letters does not rank', () => {
    expect(scoreCandidate(['dply'], { title: 'Deployments' })).toBe(39 * 6);
    expect(scoreCandidate(['dply'], { title: 'zzz', keywords: 'Deployments' })).toBeUndefined();
    expect(scoreCandidate(['dply'], { title: 'zzz', context: 'Deployments' })).toBeUndefined();
  });

  it('adds 120 when the title holds the whole query as one phrase', () => {
    const phrase = scoreCandidate(['open', 'tab'], { title: 'Open tab' });
    const apart = scoreCandidate(['open', 'tab'], { title: 'Open a new tab' });
    expect(phrase).toBe(88 * 6 + 76 * 6 + 120);
    expect(apart).toBe(88 * 6 + 76 * 6);
  });

  it('matches the context by `matchContext` when there is one (a window name is not matched)', () => {
    expect(scoreCandidate(['window'], { title: 'Instances', context: 'us-east-1 · Window 2' })).toBe(76);
    expect(scoreCandidate(['window'], { title: 'Instances', context: 'us-east-1 · Window 2', matchContext: 'us-east-1' })).toBeUndefined();
  });

  it('scores nothing for an empty query: a list without a query is not ranked', () => {
    expect(scoreCandidate([], { title: 'cart-api' })).toBe(0);
  });
});

describe('highlight', () => {
  it('draws a word where the title matches it, else where the context does, and a keyword nowhere', () => {
    const runs = highlight(['cart', 'prod', 'zz'], 'cart-api', 'prod-eu · payments');
    expect(runs.title).toEqual([[0, 4]]);
    expect(runs.context).toEqual([[0, 4]]);
  });

  it('merges ranges that touch or overlap, in order', () => {
    expect(mergeRuns([[3, 5], [0, 2], [2, 3], [10, 12], [11, 14]])).toEqual([[0, 5], [10, 14]]);
    expect(mergeRuns([])).toEqual([]);
  });
});

describe('partsOf', () => {
  it('cuts a text at its ranges so a view can draw the matched parts in weight 600', () => {
    expect(partsOf('cart-api', [[0, 4]])).toEqual([{ text: 'cart', match: true }, { text: '-api', match: false }]);
    expect(partsOf('cart-api', [[1, 2], [5, 8]])).toEqual([{ text: 'c', match: false }, { text: 'a', match: true }, { text: 'rt-', match: false }, { text: 'api', match: true }]);
    expect(partsOf('cart', [])).toEqual([{ text: 'cart', match: false }]);
    expect(partsOf('', [])).toEqual([]);
  });

  it('clips a range that runs past the text and ignores one that is empty', () => {
    expect(partsOf('abc', [[1, 9], [2, 2]])).toEqual([{ text: 'a', match: false }, { text: 'bc', match: true }]);
  });
});

// Aliases (C1e). An alias is another NAME for a row: the short name a tool gives a thing (`ws` for Workshops, `rk` for Racks) that its title does not hold. A word that is a whole alias is a match on the
// row's name and ranks as one: with an exact title match (the whole word, 100 x the title's 6), and a word an alias begins with ranks with a prefix of a title (88 x 6). Ch16 SE1 writes the rule for a
// name: "an exact or prefix match on an object name outranks a substring or loose match in a command or page title". The mock has no aliases, and its keywords (weight 3) are kept exactly as they are:
// a keyword is a word a row is found by and never a name. Any other match of an alias (inside it, at the start of one of its parts) is a keyword's, and an alias never matches loosely.
describe('scoreCandidate: aliases', () => {
  const EXACT_TITLE = 100 * 6;
  const PREFIX_TITLE = 88 * 6;

  it('ranks a word that is a whole alias with an exact title match, and one an alias begins with, with a prefix of a title', () => {
    expect(scoreCandidate(['ns'], { title: 'Zebra', aliases: 'nameset ns' })).toBe(EXACT_TITLE);
    expect(scoreCandidate(['ns'], { title: 'Zebra', aliases: 'nameset ns' })).toBe(scoreCandidate(['zebra'], { title: 'Zebra' }));
    expect(scoreCandidate(['names'], { title: 'Zebra', aliases: 'nameset ns' })).toBe(PREFIX_TITLE);
    expect(scoreCandidate(['names'], { title: 'Zebra', aliases: 'nameset ns' })).toBe(scoreCandidate(['zeb'], { title: 'Zebra' }));
  });

  it('puts that above the start of a word of a title, a substring of one and a loose match in one: `ns` names Namesets, which no longer comes after Sensors and PinpointSlots', () => {
    // What the words were before: as a keyword `ns` is worth 76 x 3 and the title matches it loosely (34 x 6): Sensors (a substring, 58 x 6) and PinpointSlots (loosely, 39 x 6) outrank both.
    expect(scoreCandidate(['ns'], { title: 'Namesets', keywords: 'Nameset ns' })).toBe(76 * 3);
    const others = [scoreCandidate(['ns'], { title: 'Sensors' }), scoreCandidate(['ns'], { title: 'PinpointSlots' }), scoreCandidate(['ns'], { title: 'Open tab ns' })];
    expect(others).toEqual([58 * 6, 39 * 6, 76 * 6]);
    // As an alias it is a name.
    const named = scoreCandidate(['ns'], { title: 'Namesets', aliases: 'Nameset ns' });
    expect(named).toBe(EXACT_TITLE);
    for (const other of others) {
      expect(named).toBeGreaterThan(other ?? 0);
    }

    // A prefix of an alias is below a whole alias and above the start of a word in a title.
    expect(scoreCandidate(['ns'], { title: 'Zebra', aliases: 'nsx' })).toBe(PREFIX_TITLE);
    expect(PREFIX_TITLE).toBeGreaterThan(76 * 6);
  });

  it('is a title\'s rank and no more: the best of the fields is the score, so an alias never lowers what the title earned', () => {
    expect(scoreCandidate(['jobs'], { title: 'Jobs', aliases: 'job' })).toBe(EXACT_TITLE);
    expect(scoreCandidate(['job'], { title: 'Jobs', aliases: 'job' })).toBe(EXACT_TITLE);
    expect(scoreCandidate(['cron'], { title: 'CronJobs', aliases: 'cj' })).toBe(PREFIX_TITLE);
  });

  it('takes any one of the aliases, whatever its case, and however the aliases are spaced', () => {
    expect(scoreCandidate(['cj'], { title: 'CronJobs', aliases: 'cronjob CJ' })).toBe(EXACT_TITLE);
    expect(scoreCandidate(['cj'], { title: 'Zebra', aliases: '  cronjob   cj  ' })).toBe(EXACT_TITLE);
    expect(scoreCandidate(['cronj'], { title: 'Zebra', aliases: '  cronjob   cj  ' })).toBe(PREFIX_TITLE);
  });

  it('is not fooled by the end of an alias or its middle: those are a keyword\'s match', () => {
    expect(scoreCandidate(['set'], { title: 'Zebra', aliases: 'nameset' })).toBe(58 * 3);
    expect(scoreCandidate(['set'], { title: 'Zebra', aliases: 'name-set' })).toBe(76 * 3);
  });

  it('lets a word that is not the start of an alias match it as a keyword does: whole text of the aliases, never loosely', () => {
    expect(scoreCandidate(['pol'], { title: 'Zebra', aliases: 'netpol' })).toBe(58 * 3);
    expect(scoreCandidate(['npl'], { title: 'Zebra', aliases: 'netpol' })).toBeUndefined();
    expect(scoreCandidate(['dply'], { title: 'zzz', aliases: 'deployments' })).toBeUndefined();
  });

  it('needs every word to match a field (AND), the aliases being one of them', () => {
    expect(scoreCandidate(['ns', 'zeb'], { title: 'Zebra', aliases: 'ns' })).toBe(EXACT_TITLE + PREFIX_TITLE);
    expect(scoreCandidate(['ns', 'zzz'], { title: 'Zebra', aliases: 'ns' })).toBeUndefined();
    expect(scoreCandidate(['ns', 'sp'], { title: 'Zebra', aliases: 'ns sp' })).toBe(EXACT_TITLE + EXACT_TITLE);
  });

  it('leaves a keyword exactly as the mock weighs it: 3, never a name', () => {
    expect(scoreCandidate(['cart'], { title: 'zzz', keywords: 'cart' })).toBe(100 * 3);
    expect(scoreCandidate(['cart'], { title: 'zzz', keywords: 'cart', aliases: '' })).toBe(100 * 3);
    expect(scoreCandidate(['cart'], { title: 'zzz', keywords: 'cart-api shop' })).toBe(88 * 3);
    expect(scoreCandidate(['cart'], { title: 'zzz', keywords: 'shop cart' })).toBe(76 * 3);
  });

  it('scores a candidate with no aliases as it did', () => {
    expect(scoreCandidate(['cart'], { title: 'cart-api', context: 'x', keywords: 'y' })).toBe(88 * 6);
    expect(scoreCandidate(['cart'], { title: 'cart-api', aliases: undefined })).toBe(88 * 6);
  });
});

describe('highlight: aliases', () => {
  it('draws an alias nowhere: the user cannot see one, and a run that points at nothing is noise', () => {
    expect(highlight(['ns'], 'Zebra', 'prod-eu')).toEqual({ title: [], context: [] });
  });
});
