import { vi } from 'vitest';
import {
  compileSearchPattern,
  execSafeSearch,
  execSafeSearchRange,
  MAX_MATCH_COUNT,
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
      (i) => lines[i],
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

    const { results } = execSafeSearch(pattern, 1, (i) => lines[i], buildMatch);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ lineIndex: 0, start: 0, end: 2 });
    expect(results[1]).toEqual({ lineIndex: 0, start: 3, end: 5 });
    expect(results[2]).toEqual({ lineIndex: 0, start: 6, end: 8 });
  });

  it('returns empty results when no matches', () => {
    const lines = ['nothing here'];
    const pattern = compileSearchPattern('xyz', defaultOpts)!;

    const { results, capped } = execSafeSearch(pattern, 1, (i) => lines[i], buildMatch);

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

  it('breaks inner loop on zero-length match', () => {
    // A pattern that could produce zero-length matches after the first real match
    // "a" followed by a lookahead — simulate by using a regex that matches empty after "a"
    // We test this indirectly: compileSearchPattern filters out empty-match patterns,
    // but if we construct one manually, execSafeSearch should still be safe.
    const pattern = /a?/g; // matches "" — would infinite loop without the guard
    const lines = ['bbb'];

    // Should not hang — the zero-length guard should break the inner loop
    const { results } = execSafeSearch(pattern, 1, (i) => lines[i], buildMatch);
    // First exec returns "" at index 0 → break
    expect(results).toEqual([]);
  });

  it('breaks inner loop on zero-length match (range variant)', () => {
    const pattern = /a?/g;
    const lines = ['bbb'];

    const { results } = execSafeSearchRange(pattern, 0, 1, (i) => lines[i], buildMatch);
    expect(results).toEqual([]);
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

      const { capped } = execSafeSearch(pattern, lines.length, (i) => lines[i], buildMatch);

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
      pattern, 2, 4, (i) => lines[i], buildMatch,
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
      pattern, 3, 5, (i) => lines[i], buildMatch,
    );

    expect(results).toHaveLength(1);
    expect(results[0].lineIndex).toBe(4);
  });

  it('respects custom matchBudget', () => {
    const lines = ['ab ab', 'ab ab', 'ab ab'];
    const pattern = compileSearchPattern('ab', defaultOpts)!;

    const { results, capped } = execSafeSearchRange(
      pattern, 0, 3, (i) => lines[i], buildMatch, 3,
    );

    expect(results).toHaveLength(3);
    expect(capped).toBe(true);
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
      pattern, 0, 0, (i) => lines[i], buildMatch,
    );

    expect(results).toEqual([]);
    expect(capped).toBe(false);
  });
});
