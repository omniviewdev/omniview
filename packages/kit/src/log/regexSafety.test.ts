// Provenance: the spec of the carried engine, `ui/providers/BottomDrawer/containers/LogViewer/utils/regexSafety.spec.ts` at origin/main ce60076a (5bd44b97), unchanged
// but for the vitest import (the kit's vitest has no globals) and a `!` where it reads a line it has just counted (the kit compiles with
// `noUncheckedIndexedAccess`), and for the two changes the engine itself has (regexSafety.ts, PR #544 review): the two tests that said a zero-length match ENDS the
// loop now say it is skipped and the loop goes on, and the cases of the pattern guard, of the empty match, of the offset a scan resumes at and of the clock read inside a line are added
// after the carried ones.
import { describe, expect, it, vi } from 'vitest';
import {
  compileSearchPattern,
  EMPTY_MATCHES_PER_CLOCK_READ,
  execSafeSearch,
  execSafeSearchRange,
  indexAfterEmptyMatch,
  isRiskyPattern,
  MAX_GROUP_DEPTH,
  MAX_MATCH_COUNT,
  MAX_PATTERN_LENGTH,
  SEARCH_TIME_BUDGET_MS,
} from './regexSafety';

describe('compileSearchPattern', () => {
  it('returns null for empty query', () => {
    expect(compileSearchPattern('', { isRegex: false, caseSensitive: false })).toBeNull();
  });

  it('compiles literal query (escapes metacharacters)', () => {
    const pattern = compileSearchPattern('foo.bar', { isRegex: false, caseSensitive: false });
    expect(pattern).not.toBeNull();
    // Should NOT match "fooXbar" — the dot is escaped
    expect(pattern!.test('fooXbar')).toBe(false);
    expect(pattern!.test('foo.bar')).toBe(true);
  });

  it('compiles regex query directly', () => {
    const pattern = compileSearchPattern('foo.bar', { isRegex: true, caseSensitive: false });
    expect(pattern).not.toBeNull();
    expect(pattern!.test('fooXbar')).toBe(true);
  });

  it('respects case sensitivity flag', () => {
    const sensitive = compileSearchPattern('Hello', { isRegex: false, caseSensitive: true });
    expect(sensitive!.test('hello')).toBe(false);
    expect(sensitive!.test('Hello')).toBe(true);

    const insensitive = compileSearchPattern('Hello', { isRegex: false, caseSensitive: false });
    expect(insensitive!.test('hello')).toBe(true);
  });

  it('returns null for invalid regex syntax', () => {
    expect(compileSearchPattern('[unclosed', { isRegex: true, caseSensitive: false })).toBeNull();
  });

  it.each(['.*', 'a?', 'foo|'])(
    'returns null for empty-match pattern "%s"',
    (query) => {
      expect(compileSearchPattern(query, { isRegex: true, caseSensitive: false })).toBeNull();
    },
  );

  it('has the global flag set', () => {
    const pattern = compileSearchPattern('test', { isRegex: false, caseSensitive: false });
    expect(pattern!.global).toBe(true);
  });

  // A paste of a whole file into the find field is a literal query, and the engine cannot compile a pattern that large (V8: "Regular expression too large", from about
  // 50,000 characters). The compile is inside the `try`, and so is the test of the empty string, which is what compiles the pattern for the first time in some engines.
  it('returns null for a literal too large for the engine to compile, and does not throw', () => {
    for (const isRegex of [false, true]) {
      expect(() => compileSearchPattern('x'.repeat(200_000), { isRegex, caseSensitive: false })).not.toThrow();
      expect(compileSearchPattern('x'.repeat(200_000), { isRegex, caseSensitive: false })).toBeNull();
    }
  });
});

// The guard against catastrophic backtracking. `pattern.exec` cannot be interrupted, and the time check of `execSafeSearchRange` runs between lines, so a pattern
// such as `(a*)*b` against a line of `a` characters would hold the thread for longer than anyone waits. The guard refuses, before the pattern is compiled, the
// shape that does this: a group repeated more than once whose body holds an unbounded repeat (`*`, `+`, `{n,}`) at any depth; and a pattern too long or nested too
// deep to be judged cheaply. It is a static check on the dominant exponential shape, not a proof: `(a|aa)+b` and `.*.*.*x` pass it (regexSafety.ts says so).
describe('compileSearchPattern: the guard against catastrophic backtracking', () => {
  const regex = { isRegex: true, caseSensitive: false };
  const literal = { isRegex: false, caseSensitive: false };

  it.each([
    String.raw`(a*)*b`,
    String.raw`(a+)+`,
    String.raw`(\w+\s?)+`,
    String.raw`(.*)*b`,
    String.raw`(?:a+){2,}`,
  ])('refuses a group that is repeated and holds an unbounded repeat: %s', (query) => {
    expect(compileSearchPattern(query, regex)).toBeNull();
  });

  it.each([
    String.raw`(((a+)b)c)+`,
    String.raw`(?:(?:(?:a+)b)c)+`,
    String.raw`(((a*)*)*)*b`,
    String.raw`((a+)?b)+`,
  ])('refuses it when the unbounded repeat is nested three deep: %s', (query) => {
    expect(compileSearchPattern(query, regex)).toBeNull();
  });

  it.each([
    String.raw`(a+?)+?`,
    String.raw`(a*)*?b`,
    String.raw`(\w+?\s?)+?b`,
    String.raw`(a+)+?c`,
  ])('refuses it with a lazy suffix: %s', (query) => {
    expect(compileSearchPattern(query, regex)).toBeNull();
  });

  it.each([
    String.raw`x(?=(\w+\s?)+$)`,
    String.raw`(?=(a+)+b)a`,
    String.raw`(?!(a*)*c)a`,
    String.raw`(?<=(a+)+)b`,
    String.raw`(?<!(a+)+)b`,
  ])('refuses it inside a lookahead or a lookbehind: %s', (query) => {
    expect(compileSearchPattern(query, regex)).toBeNull();
  });

  it.each([
    String.raw`(a+){2,}`,
    String.raw`(?:ab*){3,}`,
    String.raw`(a+){1,3}`,
    String.raw`(a+){2}`,
  ])('refuses a group repeated by a count above one: %s', (query) => {
    expect(compileSearchPattern(query, regex)).toBeNull();
  });

  it.each([
    String.raw`(?<word>\w+)+`,
    String.raw`(?:\d+)+`,
    String.raw`(a+|b)*c`,
    String.raw`(foo|bar+)+`,
  ])('refuses it in a group of any kind: %s', (query) => {
    expect(compileSearchPattern(query, regex)).toBeNull();
  });

  it.each([
    String.raw`[](a+)+`,
    String.raw`[^](a+)+`,
    String.raw`[\]](a+)+`,
    String.raw`\\(a+)+`,
    String.raw`[\\](a+)+`,
  ])('reads a class and an escape as the engine does, so no group is hidden by one: %s', (query) => {
    expect(compileSearchPattern(query, regex)).toBeNull();
  });

  it.each([
    String.raw`[\](a+)+]`,
    String.raw`\(a+\)+`,
    String.raw`[(a+)]+`,
  ])('and sees no group where the engine sees none: %s', (query) => {
    expect(compileSearchPattern(query, regex)).not.toBeNull();
  });

  it.each([
    String.raw`attempt [34]\)`,
    'error|warn',
    '(GET|POST) /api',
    String.raw`\d+ms`,
    '(?:ab)+',
    String.raw`[a-z]+\d*`,
    String.raw`^\s*\[.*\]`,
    'a{2,3}b',
    '(foo)?bar',
  ])('compiles the patterns a search is made of: %s', (query) => {
    expect(compileSearchPattern(query, regex)).not.toBeNull();
  });

  it.each([
    String.raw`(a+)?b`,
    String.raw`(a+){0,1}b`,
    String.raw`(a+){1}`,
    String.raw`(a+)(b+)`,
    String.raw`(a+)b*`,
    String.raw`(?:a|b)+c*`,
    String.raw`(\d{1,3}\.){3}\d{1,3}`,
    String.raw`(?=.*foo)(?=.*bar)`,
    String.raw`(ab)*c`,
  ])('compiles a group that holds only bounded repeats, or is repeated at most once, or is not the one repeated: %s', (query) => {
    expect(compileSearchPattern(query, regex)).not.toBeNull();
  });

  it.each([
    String.raw`(a+){x}`,
    String.raw`(a+){,5}`,
    String.raw`(a+){2`,
    String.raw`(a+){2,x}`,
    String.raw`a\{2,}`,
  ])('reads a brace that is not a repeat as the character, as the engine does: %s', (query) => {
    expect(compileSearchPattern(query, regex)).not.toBeNull();
  });

  it('accepts groups nested to MAX_GROUP_DEPTH and refuses one level more', () => {
    const nest = (depth: number) => `${'('.repeat(depth)}a${')'.repeat(depth)}`;
    expect(compileSearchPattern(nest(MAX_GROUP_DEPTH), regex)).not.toBeNull();
    expect(compileSearchPattern(nest(MAX_GROUP_DEPTH + 1), regex)).toBeNull();
  });

  it('accepts a pattern of MAX_PATTERN_LENGTH characters and refuses one more', () => {
    expect(compileSearchPattern('a'.repeat(MAX_PATTERN_LENGTH), regex)).not.toBeNull();
    expect(compileSearchPattern('a'.repeat(MAX_PATTERN_LENGTH + 1), regex)).toBeNull();
  });

  it('never judges a literal query: it is escaped, so what looks like a repeat is text, and its length is its own', () => {
    const pattern = compileSearchPattern('(a*)*b', literal);
    expect(pattern).not.toBeNull();
    expect(pattern!.test('aab')).toBe(false);
    expect(pattern!.test('x (a*)*b y')).toBe(true);
    expect(compileSearchPattern(`${'('.repeat(MAX_GROUP_DEPTH + 4)}a+${')+'.repeat(MAX_GROUP_DEPTH + 4)}${'x'.repeat(2 * MAX_PATTERN_LENGTH)}`, literal)).not.toBeNull();
  });

  it('refuses a megabyte of valid pattern by its length, without compiling or reading it', () => {
    const started = performance.now();
    expect(compileSearchPattern('a'.repeat(1_000_000), regex)).toBeNull();
    expect(performance.now() - started).toBeLessThan(50);
  });

  it('judges a pattern in one pass: 512 characters of nesting, escapes, braces and repeats cost well under 50 ms', () => {
    const shapes = [
      '('.repeat(MAX_PATTERN_LENGTH),
      '()'.repeat(MAX_PATTERN_LENGTH / 2),
      '(a+)'.repeat(MAX_PATTERN_LENGTH / 4),
      '(a+)?'.repeat(Math.floor(MAX_PATTERN_LENGTH / 5)),
      `a${'+'.repeat(MAX_PATTERN_LENGTH - 1)}`,
      `(${'a+'.repeat(MAX_PATTERN_LENGTH / 2 - 1)})`,
      '['.repeat(MAX_PATTERN_LENGTH),
      '\\'.repeat(MAX_PATTERN_LENGTH),
      '{1,'.repeat(Math.floor(MAX_PATTERN_LENGTH / 3)),
      `${'{'.repeat(MAX_PATTERN_LENGTH / 2)}${'1'.repeat(MAX_PATTERN_LENGTH / 2)}`,
      `${'(?:'.repeat(MAX_GROUP_DEPTH)}${'a*'.repeat(100)}${')*'.repeat(MAX_GROUP_DEPTH)}`,
    ];
    const started = performance.now();
    for (const shape of shapes) {
      expect(shape.length).toBeLessThanOrEqual(MAX_PATTERN_LENGTH);
      expect(typeof isRiskyPattern(shape)).toBe('boolean');
    }

    expect(performance.now() - started).toBeLessThan(50);
  });

  it('compiles a heavy but harmless pattern of 500 characters, nested to the bound, in well under 50 ms', () => {
    const alternative = `${'(?:'.repeat(MAX_GROUP_DEPTH)}a+${')?'.repeat(MAX_GROUP_DEPTH)}b`;
    const heavy = Array.from({ length: 6 }, () => alternative).join('|');
    expect(heavy.length).toBeGreaterThan(MAX_PATTERN_LENGTH - 20);
    expect(heavy.length).toBeLessThanOrEqual(MAX_PATTERN_LENGTH);
    const started = performance.now();
    const pattern = compileSearchPattern(heavy, regex);
    expect(performance.now() - started).toBeLessThan(50);
    expect(pattern).not.toBeNull();
  });
});

describe('execSafeSearch', () => {
  const defaultOpts = { isRegex: false, caseSensitive: false };

  function buildMatch(lineIndex: number, start: number, end: number) {
    return { lineIndex, start, end };
  }

  it('finds matches across multiple lines', () => {
    const lines = ['hello world', 'no match', 'hello again'];
    const pattern = compileSearchPattern('hello', defaultOpts)!;

    const { results, capped } = execSafeSearch(
      pattern,
      lines.length,
      (i) => lines[i] ?? '',
      buildMatch,
    );

    expect(capped).toBe(false);
    expect(results).toEqual([
      { lineIndex: 0, start: 0, end: 5 },
      { lineIndex: 2, start: 0, end: 5 },
    ]);
  });

  it('finds multiple matches per line', () => {
    const lines = ['ab ab ab'];
    const pattern = compileSearchPattern('ab', defaultOpts)!;

    const { results } = execSafeSearch(pattern, 1, (i) => lines[i] ?? '', buildMatch);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ lineIndex: 0, start: 0, end: 2 });
    expect(results[1]).toEqual({ lineIndex: 0, start: 3, end: 5 });
    expect(results[2]).toEqual({ lineIndex: 0, start: 6, end: 8 });
  });

  it('returns empty results when no matches', () => {
    const lines = ['nothing here'];
    const pattern = compileSearchPattern('xyz', defaultOpts)!;

    const { results, capped } = execSafeSearch(pattern, 1, (i) => lines[i] ?? '', buildMatch);

    expect(results).toEqual([]);
    expect(capped).toBe(false);
  });

  it('caps at MAX_MATCH_COUNT', () => {
    // Create a single line with enough matches to exceed the cap
    const line = 'a '.repeat(MAX_MATCH_COUNT + 100);
    const pattern = compileSearchPattern('a', defaultOpts)!;

    const { results, capped } = execSafeSearch(pattern, 1, () => line, buildMatch);

    expect(results).toHaveLength(MAX_MATCH_COUNT);
    expect(capped).toBe(true);
  });

  it('skips zero-length matches and ends, where a loop that did not move on would run for ever', () => {
    // A pattern that matches "" at every position: the scan has to pass each empty match by one position.
    const pattern = /a?/g;
    const lines = ['bbb'];

    // Should not hang: "" at 0, 1, 2 and 3, none of them a result.
    const { results } = execSafeSearch(pattern, 1, (i) => lines[i] ?? '', buildMatch);
    expect(results).toEqual([]);
  });

  it('skips zero-length matches and ends (range variant)', () => {
    const pattern = /a?/g;
    const lines = ['bbb'];

    const { results } = execSafeSearchRange(pattern, 0, 1, (i) => lines[i] ?? '', buildMatch);
    expect(results).toEqual([]);
  });

  it('goes on after a zero-length match to the match that consumes text: `\\b|foo` finds `foo` in `xfoo` after the empty word boundary at 0', () => {
    // The pattern does not match the empty STRING, so the compiler accepts it; its first match on the line is empty, at 0.
    const pattern = compileSearchPattern(String.raw`\b|foo`, { isRegex: true, caseSensitive: false });
    expect(pattern).not.toBeNull();

    const { results, capped } = execSafeSearch(pattern!, 1, () => 'xfoo', buildMatch);
    expect(results).toEqual([{ lineIndex: 0, start: 1, end: 4 }]);
    expect(capped).toBe(false);
  });

  it('finds every match that consumes text, however many empty ones lie before and between them', () => {
    const lines = ['ab', 'abab', 'zz'];
    const { results } = execSafeSearch(/(?=a)|b/g, lines.length, (i) => lines[i] ?? '', buildMatch);
    expect(results).toEqual([
      { lineIndex: 0, start: 1, end: 2 },
      { lineIndex: 1, start: 1, end: 2 },
      { lineIndex: 1, start: 3, end: 4 },
    ]);
  });

  it('moves past an empty match at an astral character by a code point under the u flag: one unit would land inside the pair and match there again', () => {
    const pattern = /(?=😀)|b/gu;
    const exec = pattern.exec.bind(pattern);
    let calls = 0;
    // A scan that does not end must fail this test, not hang the thread.
    pattern.exec = (text) => {
      calls += 1;
      if (calls > 100) {
        throw new Error('the scan does not end');
      }

      return exec(text);
    };

    const { results } = execSafeSearch(pattern, 1, () => '😀b', buildMatch);
    expect(results).toEqual([{ lineIndex: 0, start: 2, end: 3 }]);
  });

  it('respects time budget', () => {
    // Mock performance.now to exceed the budget after a few lines
    let callCount = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      callCount++;
      // After the first check (at line 512), return a value past the budget
      return callCount > 1 ? SEARCH_TIME_BUDGET_MS + 1 : 0;
    });

    try {
      const lines = new Array(2000).fill('match');
      const pattern = compileSearchPattern('match', defaultOpts)!;

      const { capped } = execSafeSearch(pattern, lines.length, (i) => lines[i] ?? '', buildMatch);

      // Should have stopped early
      expect(capped).toBe(true);
    } finally {
      vi.mocked(performance.now).mockRestore?.();
    }
  });
});

describe('execSafeSearchRange', () => {
  const defaultOpts = { isRegex: false, caseSensitive: false };

  function buildMatch(lineIndex: number, start: number, end: number) {
    return { lineIndex, start, end };
  }

  it('searches only within [startIndex, endIndex)', () => {
    const lines = ['hello world', 'no match', 'hello again', 'hello end'];
    const pattern = compileSearchPattern('hello', defaultOpts)!;

    // Search only lines [2, 4)
    const { results, capped } = execSafeSearchRange(
      pattern, 2, 4, (i) => lines[i] ?? '', buildMatch,
    );

    expect(capped).toBe(false);
    expect(results).toEqual([
      { lineIndex: 2, start: 0, end: 5 },
      { lineIndex: 3, start: 0, end: 5 },
    ]);
  });

  it('lineIndex in results matches actual array indices, not offset from 0', () => {
    const lines = ['aaa', 'bbb', 'aaa', 'bbb', 'aaa'];
    const pattern = compileSearchPattern('aaa', defaultOpts)!;

    // Search [3, 5) — only line 4 matches
    const { results } = execSafeSearchRange(
      pattern, 3, 5, (i) => lines[i] ?? '', buildMatch,
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.lineIndex).toBe(4);
  });

  it('respects custom matchBudget', () => {
    const lines = ['ab ab', 'ab ab', 'ab ab'];
    const pattern = compileSearchPattern('ab', defaultOpts)!;

    const { results, capped } = execSafeSearchRange(
      pattern, 0, 3, (i) => lines[i] ?? '', buildMatch, 3,
    );

    expect(results).toHaveLength(3);
    expect(capped).toBe(true);
  });

  it('keeps the match budget while it skips empty matches: it stops at the budget and says so', () => {
    const { results, capped } = execSafeSearchRange(/(?=a)|b/g, 0, 1, () => 'ab'.repeat(10), buildMatch, 3);
    expect(results).toEqual([
      { lineIndex: 0, start: 1, end: 2 },
      { lineIndex: 0, start: 3, end: 4 },
      { lineIndex: 0, start: 5, end: 6 },
    ]);
    expect(capped).toBe(true);
  });

  it('says where the match budget stopped it: the line of the last match, the offset after it, and whether the line has text left', () => {
    const lines = ['ab ab ab', 'ab'];
    const stopped = execSafeSearchRange(/ab/g, 0, 2, (i) => lines[i] ?? '', buildMatch, 2);
    expect(stopped.capped).toBe(true);
    expect(stopped.stoppedAt).toEqual({ lineIndex: 0, offset: 5, atEnd: false });

    // The budget fell on the last match of a line that ends with it: nothing is left in the line.
    const atEnd = execSafeSearchRange(/ab/g, 0, 2, (i) => lines[i] ?? '', buildMatch, 4);
    expect(atEnd.stoppedAt).toEqual({ lineIndex: 1, offset: 2, atEnd: true });

    // A scan that ran to its end, and one the clock stopped, have no place to go on from.
    expect(execSafeSearchRange(/ab/g, 0, 2, (i) => lines[i] ?? '', buildMatch).stoppedAt).toBeUndefined();
  });

  it('begins the first line at the offset it is given, and every later line at its start', () => {
    const lines = ['ab ab ab', 'ab ab'];
    const { results } = execSafeSearchRange(/ab/g, 0, 2, (i) => lines[i] ?? '', buildMatch, 100, 5);
    expect(results).toEqual([
      { lineIndex: 0, start: 6, end: 8 },
      { lineIndex: 1, start: 0, end: 2 },
      { lineIndex: 1, start: 3, end: 5 },
    ]);
    // A scan resumed from where a budget stopped it finds what a scan that was not stopped finds, and no match twice.
    const first = execSafeSearchRange(/ab/g, 0, 2, (i) => lines[i] ?? '', buildMatch, 2);
    const rest = execSafeSearchRange(/ab/g, 0, 2, (i) => lines[i] ?? '', buildMatch, 100, first.stoppedAt?.offset);
    expect([...first.results, ...rest.results]).toEqual(execSafeSearchRange(/ab/g, 0, 2, (i) => lines[i] ?? '', buildMatch).results);
  });

  // The clock is read between lines. A line of millions of characters under `(?=a)|foo` is millions of empty matches, passed one position at a time: the clock must be read inside
  // the line too, or the 100 ms budget is not one.
  it('reads the clock inside a line that is all empty matches, and stops when the budget is spent', () => {
    let readings = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (readings++ === 0 ? 0 : SEARCH_TIME_BUDGET_MS + 1));
    try {
      const pattern = /(?=a)|foo/g;
      const exec = vi.spyOn(pattern, 'exec');
      const { results, capped, stoppedAt } = execSafeSearchRange(pattern, 0, 1, () => `${'a'.repeat(1_000_000)}foo`, buildMatch);
      expect(capped).toBe(true);
      expect(results).toEqual([]);
      // A stop on the clock has no place to go on from, and it came after one reading's worth of empty matches, not after a million.
      expect(stoppedAt).toBeUndefined();
      expect(exec.mock.calls.length).toBeLessThanOrEqual(EMPTY_MATCHES_PER_CLOCK_READ + 1);
    } finally {
      clock.mockRestore();
    }
  });

  // The count of empty matches is the scan's, not a line's: two lines of half a reading's worth each are a reading's worth in all, and the clock is read where they add up to it, though neither
  // line has reached a reading by itself and the scan is far from the 512 lines after which it reads the clock between lines.
  it('adds the empty matches of a line to those of the next toward a reading of the clock', () => {
    let readings = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (readings++ === 0 ? 0 : SEARCH_TIME_BUDGET_MS + 1));
    try {
      const half = 'a'.repeat(EMPTY_MATCHES_PER_CLOCK_READ / 2);
      const { results, capped } = execSafeSearchRange(/(?=a)|foo/g, 0, 2, () => half, buildMatch);
      expect(results).toEqual([]);
      expect(capped).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  it('falls back to MAX_MATCH_COUNT when no budget given', () => {
    // Single line with many matches
    const line = 'a '.repeat(MAX_MATCH_COUNT + 100);
    const pattern = compileSearchPattern('a', defaultOpts)!;

    const { results, capped } = execSafeSearchRange(
      pattern, 0, 1, () => line, buildMatch,
    );

    expect(results).toHaveLength(MAX_MATCH_COUNT);
    expect(capped).toBe(true);
  });

  it('returns empty when startIndex equals endIndex', () => {
    const lines = ['hello'];
    const pattern = compileSearchPattern('hello', defaultOpts)!;

    const { results, capped } = execSafeSearchRange(
      pattern, 0, 0, (i) => lines[i] ?? '', buildMatch,
    );

    expect(results).toEqual([]);
    expect(capped).toBe(false);
  });
});

// Where a scan goes on after an empty match, in both scanners (this file's execSafeSearchRange and runs.ts' matchRanges).
describe('indexAfterEmptyMatch', () => {
  it('is one UTF-16 unit on for the patterns the engine builds (g and gi): a surrogate pair is two units to it', () => {
    expect(indexAfterEmptyMatch(/x/g, 'a😀b', 1)).toBe(2);
    expect(indexAfterEmptyMatch(/x/gi, 'abc', 0)).toBe(1);
  });

  it('is one code point on under the u flag and the v flag, where a pair is one character', () => {
    expect(indexAfterEmptyMatch(/x/gu, 'a😀b', 1)).toBe(3);
    expect(indexAfterEmptyMatch(new RegExp('x', 'gv'), 'a😀b', 1)).toBe(3);
  });

  it('is one unit on under the u flag for a character that is one unit, a lone surrogate and the end of the text', () => {
    expect(indexAfterEmptyMatch(/x/gu, 'abc', 1)).toBe(2);
    expect(indexAfterEmptyMatch(/x/gu, 'a\ud83db', 1)).toBe(2);
    expect(indexAfterEmptyMatch(/x/gu, 'ab', 2)).toBe(3);
  });
});
