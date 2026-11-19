// What a row draws for its text: the line's painted runs (the colour of an ANSI escape) cut at the edges of the search matches. The row asks for this only
// when it HAS a match, so a plain row with no match renders a string and a keystroke renders the rows with matches (HLT-3, HLT-12).
import { describe, expect, it, vi } from 'vitest';
import { compileSearchPattern, EMPTY_MATCHES_PER_CLOCK_READ, execSafeSearch, SEARCH_TIME_BUDGET_MS } from './regexSafety';
import { matchRanges, rowRuns } from './runs';

describe('matchRanges', () => {
  it('lists where a pattern matches in a line, in order', () => {
    expect(matchRanges('ab cd ab', /ab/gi)).toEqual([[0, 2], [6, 8]]);
  });

  it('finds nothing in a line without the pattern, and leaves the pattern reusable', () => {
    const pattern = /ab/gi;
    expect(matchRanges('xx', pattern)).toEqual([]);
    expect(matchRanges('ab', pattern)).toEqual([[0, 2]]);
    expect(matchRanges('ab', pattern)).toEqual([[0, 2]]);
  });

  it('stops at its own limit', () => {
    expect(matchRanges('a'.repeat(100), /a/g).length).toBe(20);
    expect(matchRanges('a'.repeat(100), /a/g, 5).length).toBe(5);
  });

  it('returns no range for a zero-length match', () => {
    expect(matchRanges('abc', /x*/g)).toEqual([]);
  });

  it('goes on after a zero-length match to the match that consumes text: `\\b|foo` on `xfoo`', () => {
    // The first match of the pattern on the line is the empty word boundary at 0; `foo` starts at 1.
    expect(matchRanges('xfoo', /\b|foo/g)).toEqual([[1, 4]]);
    expect(matchRanges('xfoo xfoo', /\b|foo/g)).toEqual([[1, 4], [6, 9]]);
  });

  it('counts the ranges it returns against its limit, not the empty matches it passes', () => {
    expect(matchRanges('ab'.repeat(30), /(?=a)|b/g, 3)).toEqual([[1, 2], [3, 4], [5, 6]]);
  });

  // The row marks what the search found. The search that found a row's line scanned it under a clock (`execSafeSearchRange`: read every EMPTY_MATCHES_PER_CLOCK_READ empty matches, 100 ms in
  // all), and the row scans under the same one: a count of passes would end a line of 20,000 positions before its first match, which the search had found, and the row would not mark it.
  it('marks the match the search found on a line of many empty matches before it', () => {
    const text = `${'a'.repeat(20_000)}foo`;
    const found = execSafeSearch(/(?=a)|foo/g, 1, () => text, (_line, start, end) => [start, end]);
    expect(found.results).toEqual([[20_000, 20_003]]);
    expect(matchRanges(text, /(?=a)|foo/g)).toEqual(found.results);
  });

  // A row is drawn in a render: a line of millions of positions under a pattern that matches the empty string at each one (`(?=a)|foo`) must not hold it for as long as the line is long.
  it('stops at the clock on a line that is all empty matches, as the search does, after one reading\'s worth of them', () => {
    let readings = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (readings++ === 0 ? 0 : SEARCH_TIME_BUDGET_MS + 1));
    try {
      const pattern = /(?=a)|foo/g;
      const exec = vi.spyOn(pattern, 'exec');
      expect(matchRanges(`${'a'.repeat(1_000_000)}foo`, pattern)).toEqual([]);
      expect(exec.mock.calls.length).toBeLessThanOrEqual(EMPTY_MATCHES_PER_CLOCK_READ + 1);
    } finally {
      clock.mockRestore();
    }
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

    expect(matchRanges('😀b', pattern)).toEqual([[2, 3]]);
  });

  it('marks the ranges the search found: the engine and the row scan the same pattern the same way, empty matches before a match included', () => {
    const pattern = compileSearchPattern(String.raw`\b|foo`, { isRegex: true, caseSensitive: false });
    expect(pattern).not.toBeNull();

    const found = execSafeSearch(pattern!, 1, () => 'xfoo', (_line, start, end) => [start, end]);
    expect(found.results).toEqual([[1, 4]]);
    expect(matchRanges('xfoo', pattern!)).toEqual(found.results);
  });
});

describe('rowRuns', () => {
  const join = (runs: ReadonlyArray<{ text: string }>) => runs.map((run) => run.text).join('');

  it('is one run of the whole text when nothing is painted and nothing matches', () => {
    expect(rowRuns('plain text', undefined, [], 'found')).toEqual([{ text: 'plain text' }]);
  });

  it('is the painted runs themselves when nothing matches', () => {
    const painted = [{ text: 'a ' }, { text: 'b', hue: 'red' as const }];
    expect(rowRuns('a b', painted, [], 'found')).toBe(painted);
  });

  it('marks the match inside a plain line, with the text before and after', () => {
    expect(rowRuns('request failed', undefined, [[8, 14]], 'found')).toEqual([{ text: 'request ' }, { text: 'failed', mark: 'found' }]);
  });

  it('marks every match, and gives each the mark it was asked for (the current line is marked apart)', () => {
    expect(rowRuns('ab-ab', undefined, [[0, 2], [3, 5]], 'current')).toEqual([{ text: 'ab', mark: 'current' }, { text: '-' }, { text: 'ab', mark: 'current' }]);
  });

  it('cuts painted runs at a match edge and keeps their paint on both pieces', () => {
    const painted = [{ text: 'status ' }, { text: '1233ms', hue: 'amber' as const, bold: true }, { text: ' over' }];
    const runs = rowRuns('status 1233ms over', painted, [[9, 11]], 'found');
    expect(runs).toEqual([
      { text: 'status ' },
      { text: '12', hue: 'amber', bold: true },
      { text: '33', hue: 'amber', bold: true, mark: 'found' },
      { text: 'ms', hue: 'amber', bold: true },
      { text: ' over' },
    ]);
    expect(join(runs)).toBe('status 1233ms over');
  });

  it('marks a match that spans two painted runs in both', () => {
    const painted = [{ text: 'ab', hue: 'red' as const }, { text: 'cd' }];
    expect(rowRuns('abcd', painted, [[1, 3]], 'found')).toEqual([{ text: 'a', hue: 'red' }, { text: 'b', hue: 'red', mark: 'found' }, { text: 'c', mark: 'found' }, { text: 'd' }]);
  });

  it('handles matches at the very start and the very end', () => {
    expect(rowRuns('abc', undefined, [[0, 1], [2, 3]], 'found')).toEqual([{ text: 'a', mark: 'found' }, { text: 'b' }, { text: 'c', mark: 'found' }]);
  });

  it('always adds up to the text', () => {
    const text = 'the quick brown fox';
    const painted = [{ text: 'the ' }, { text: 'quick', hue: 'green' as const }, { text: ' brown fox' }];
    const runs = rowRuns(text, painted, [[0, 3], [4, 9], [16, 19]], 'found');
    expect(join(runs)).toBe(text);
  });
});
